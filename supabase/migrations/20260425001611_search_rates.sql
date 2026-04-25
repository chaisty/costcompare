-- Public search endpoint for confirmed rates.
-- Issue #4. Called by the frontend via PostgREST at /rest/v1/rpc/search_rates.
--
-- Design: SECURITY INVOKER so the existing RLS on rates + facilities (both
-- anon-SELECT-allowed) applies naturally — no bypass. Input bounds and the
-- explicit column allowlist live in SQL so PostgREST's query surface can't be
-- used to pull columns we don't intend to expose.

create function search_rates(
    p_procedure_code text default '64628',
    p_state text default null,
    p_rate_type rate_type default null,
    p_year_from int default null,
    p_year_to int default null,
    p_limit int default 50,
    p_offset int default 0
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
    v_offset int;
    v_rows jsonb;
    v_results jsonb;
    v_has_more boolean;
begin
    -- Procedure code: single CPT-ish string. The column is `text[]` so multiple
    -- codes per row are supported, but callers filter by one code at a time.
    if p_procedure_code is null
       or length(p_procedure_code) = 0
       or length(p_procedure_code) > 10 then
        return jsonb_build_object('ok', false, 'error', 'invalid_procedure_code');
    end if;

    -- State: optional 2-letter US code. Normalize to upper before matching.
    v_state := case when p_state is null then null else upper(trim(p_state)) end;
    if v_state is not null and v_state !~ '^[A-Z]{2}$' then
        return jsonb_build_object('ok', false, 'error', 'invalid_state');
    end if;

    -- Year range: default to the full allowed range if unspecified. Caller
    -- may pass one side and leave the other null.
    v_year_from := coalesce(p_year_from, 2000);
    v_year_to := coalesce(p_year_to, 2100);
    if v_year_from < 2000
       or v_year_to > 2100
       or v_year_from > v_year_to then
        return jsonb_build_object('ok', false, 'error', 'invalid_year_range');
    end if;

    -- Pagination: clamp limit to [1, 200]; reject offsets past 10k outright
    -- so a bad actor can't force deep-sequence scans as a mini-DoS.
    v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    if v_offset > 10000 then
        return jsonb_build_object('ok', false, 'error', 'offset_too_large');
    end if;

    -- Explicit column list. Notable omissions:
    --   source_submission_id — internal FK into the private submissions table.
    --   rates.id             — omitted defense-in-depth. For cash rates, id
    --                          equals submissions.rate_id (see rls.sql's
    --                          confirm_submission body), so if a rate_id
    --                          ever leaks via another path, correlation to a
    --                          confirmed submitter becomes possible. Callers
    --                          shouldn't need it; if a stable handle becomes
    --                          necessary later, add an opaque public id.
    --   created_at           — not useful to callers; hides activity timing.
    -- We fetch limit+1 rows and trim so has_more can be reported cheaply
    -- without a separate count(*) query.
    --
    -- Pagination caveat: ORDER BY (price, id) is deterministic but not stable
    -- under concurrent inserts. A new lower-priced row inserted between page
    -- fetches will shift later pages and a client paging with offset may see
    -- a duplicate or skip. Acceptable for MVP; revisit if ingest volume grows.
    select coalesce(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
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
            r.locality,
            r.payer,
            r.plan_variant,
            r.source_url,
            r.source_fetched_at,
            r.confidence_note
        from rates r
        left join facilities f on f.id = r.facility_id
        where p_procedure_code = any(r.procedure_codes)
          and (v_state is null or f.state = v_state)
          and (p_rate_type is null or r.rate_type = p_rate_type)
          and r.rate_year between v_year_from and v_year_to
        order by r.price asc, r.id asc
        limit v_limit + 1
        offset v_offset
    ) r;

    v_has_more := jsonb_array_length(v_rows) > v_limit;
    if v_has_more then
        v_results := v_rows - (jsonb_array_length(v_rows) - 1);
    else
        v_results := v_rows;
    end if;

    return jsonb_build_object(
        'ok', true,
        'results', v_results,
        'limit', v_limit,
        'offset', v_offset,
        'has_more', v_has_more
    );
end;
$$;

-- Supabase auto-grants EXECUTE to anon/authenticated on new public functions.
-- That's what we want here, but do it explicitly so intent is obvious and so
-- a future tightening of the default doesn't silently break the endpoint.
-- Revoke from every non-elevated role first (matches the rls.sql pattern),
-- then re-grant to the specific roles we mean to expose.
revoke all on function search_rates(text, text, rate_type, int, int, int, int)
    from public, anon, authenticated;
grant execute on function search_rates(text, text, rate_type, int, int, int, int)
    to anon, authenticated, service_role;
