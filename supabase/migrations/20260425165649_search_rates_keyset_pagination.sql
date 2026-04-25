-- Keyset pagination for search_rates.
--
-- Why: ORDER BY (price, ...) with OFFSET drifts under concurrent inserts. A
-- new lower-priced row inserted between page fetches shifts all later pages
-- and a client paging by offset will see duplicates or skip rows. With small
-- MVP volume this is theoretical, but the fix is cheap and the API shape
-- becomes simpler (single opaque cursor) so do it now rather than after a
-- hypothetical scale-up.
--
-- Why a separate `search_token` instead of using `rates.id`:
--   For cash rates, rates.id == submissions.rate_id (set by confirm_submission).
--   The search response intentionally omits rates.id as defense-in-depth so a
--   future leak elsewhere can't correlate a public price to a private
--   submission. The cursor would re-leak rates.id if we used it. A separate,
--   freshly-random per-row token has no relationship to submission state and
--   is safe to surface.
--
-- API shape change: `p_offset` is replaced by `p_after_cursor` (opaque text).
-- The response's `offset` field becomes `next_cursor` (only present when
-- has_more is true). The web client is updated atomically in this PR.

-- ---------------------------------------------------------------------------
-- search_token column. Volatile DEFAULT (gen_random_bytes is volatile)
-- triggers a per-row rewrite, so existing rows each receive a fresh value
-- rather than a single shared default.
-- ---------------------------------------------------------------------------

alter table rates
    add column search_token text not null
    default encode(gen_random_bytes(12), 'hex');

-- Order index aligned with the RPC's ORDER BY. (price, search_token) is unique
-- in practice (token has 96 bits of entropy) so this is a stable keyset.
create index idx_rates_search_keyset on rates (price asc, search_token asc);

-- ---------------------------------------------------------------------------
-- search_rates (drop + recreate; signature changes).
-- The cursor codec (encode + decode) is inlined rather than split into a
-- helper so anon doesn't need EXECUTE on a separate function. Decode is in
-- the validation block; encode is in the has_more branch.
-- ---------------------------------------------------------------------------

drop function search_rates(text, text, rate_type, int, int, int, int);

create function search_rates(
    p_procedure_code text default '64628',
    p_state text default null,
    p_rate_type rate_type default null,
    p_year_from int default null,
    p_year_to int default null,
    p_limit int default 50,
    p_after_cursor text default null
) returns jsonb
    language plpgsql
    stable
    security invoker
    set search_path = public, extensions
    as $$
declare
    v_state text;
    v_year_from int;
    v_year_to int;
    v_limit int;
    v_cursor jsonb;
    v_after_price numeric;
    v_after_token text;
    v_rows jsonb;
    v_results jsonb;
    v_has_more boolean;
    v_last jsonb;
    v_next_cursor text;
begin
    if p_procedure_code is null
       or length(p_procedure_code) = 0
       or length(p_procedure_code) > 10 then
        return jsonb_build_object('ok', false, 'error', 'invalid_procedure_code');
    end if;

    v_state := case when p_state is null then null else upper(trim(p_state)) end;
    if v_state is not null and v_state !~ '^[A-Z]{2}$' then
        return jsonb_build_object('ok', false, 'error', 'invalid_state');
    end if;

    v_year_from := coalesce(p_year_from, 2000);
    v_year_to := coalesce(p_year_to, 2100);
    if v_year_from < 2000
       or v_year_to > 2100
       or v_year_from > v_year_to then
        return jsonb_build_object('ok', false, 'error', 'invalid_year_range');
    end if;

    v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

    -- Cursor: opaque base64-encoded JSON {p: price-as-text, t: search_token}.
    -- Reject malformed input rather than silently treating as no-cursor — a
    -- caller passing junk almost always indicates a bug worth surfacing.
    if p_after_cursor is not null and length(p_after_cursor) > 0 then
        if length(p_after_cursor) > 200 then
            return jsonb_build_object('ok', false, 'error', 'invalid_cursor');
        end if;
        begin
            v_cursor := convert_from(decode(p_after_cursor, 'base64'), 'utf8')::jsonb;
        exception when others then
            return jsonb_build_object('ok', false, 'error', 'invalid_cursor');
        end;
        if jsonb_typeof(v_cursor) <> 'object'
           or v_cursor->>'p' is null
           or v_cursor->>'t' is null
           or length(v_cursor->>'t') > 64 then
            return jsonb_build_object('ok', false, 'error', 'invalid_cursor');
        end if;
        begin
            v_after_price := (v_cursor->>'p')::numeric;
        exception when others then
            return jsonb_build_object('ok', false, 'error', 'invalid_cursor');
        end;
        v_after_token := v_cursor->>'t';
    end if;

    -- Page rows. WHERE includes the keyset comparison when a cursor is set.
    -- (price, search_token) > (after_price, after_token) is row comparison —
    -- equivalent to the lexicographic "next page" boundary.
    select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.price asc, r.search_token asc), '[]'::jsonb)
    into v_rows
    from (
        select
            r.rate_type,
            r.price,
            r.rate_year,
            r.procedure_codes,
            r.facility_id,
            f.name as facility_name,
            f.state as facility_state,
            f.external_id as facility_external_id,
            r.provider_id,
            case
                when p.id is not null then trim(concat_ws(' ', p.first_name, p.last_name))
                else null
            end as provider_name,
            p.credential as provider_credential,
            p.primary_taxonomy_label as provider_specialty,
            p.practice_state as provider_state,
            r.locality,
            r.payer,
            r.plan_variant,
            r.source_url,
            r.source_fetched_at,
            r.confidence_note,
            r.search_token
        from rates r
        left join facilities f on f.id = r.facility_id
        left join providers p on p.id = r.provider_id
        where p_procedure_code = any(r.procedure_codes)
          and (v_state is null or f.state = v_state or p.practice_state = v_state)
          and (p_rate_type is null or r.rate_type = p_rate_type)
          and r.rate_year between v_year_from and v_year_to
          and (v_after_price is null
               or (r.price, r.search_token) > (v_after_price, v_after_token))
        order by r.price asc, r.search_token asc
        limit v_limit + 1
    ) r;

    v_has_more := jsonb_array_length(v_rows) > v_limit;
    if v_has_more then
        v_last := v_rows->(v_limit - 1);
        v_results := v_rows - (jsonb_array_length(v_rows) - 1);
        v_next_cursor := encode(
            convert_to(
                jsonb_build_object(
                    'p', (v_last->>'price'),
                    't', (v_last->>'search_token')
                )::text,
                'utf8'
            ),
            'base64'
        );
    else
        v_results := v_rows;
        v_next_cursor := null;
    end if;

    -- Strip search_token from the public response. It's an internal pagination
    -- handle, not part of the column allowlist; clients use it only via the
    -- opaque next_cursor. Done after slicing so v_last->>'search_token' is
    -- still available above. Re-aggregate WITH ORDINALITY so the original
    -- (price, search_token) order is preserved.
    select coalesce(jsonb_agg(elem - 'search_token' order by ord), '[]'::jsonb)
    into v_results
    from jsonb_array_elements(v_results) with ordinality as t(elem, ord);

    return jsonb_build_object(
        'ok', true,
        'results', v_results,
        'limit', v_limit,
        'has_more', v_has_more,
        'next_cursor', v_next_cursor
    );
end;
$$;

revoke all on function search_rates(text, text, rate_type, int, int, int, text)
    from public, anon, authenticated;
grant execute on function search_rates(text, text, rate_type, int, int, int, text)
    to anon, authenticated, service_role;
