-- search_rates: expose facility_external_id so the UI can render a
-- "Medicare-certified" badge for facilities sourced from the CMS POS ETL.
-- POS-sourced rows always have external_id set (the CMS provider number /
-- CCN); CTSS-sourced rows leave it null unless the upsert cross-matched
-- with an existing POS row by name+state.
--
-- This is a column-allowlist-only change to the RPC body. Drop + recreate
-- because Postgres doesn't let us alter the RETURNS jsonb shape mid-flight.

drop function search_rates(text, text, rate_type, int, int, int, int);

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
    v_offset := greatest(coalesce(p_offset, 0), 0);
    if v_offset > 10000 then
        return jsonb_build_object('ok', false, 'error', 'offset_too_large');
    end if;

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
            r.confidence_note
        from rates r
        left join facilities f on f.id = r.facility_id
        left join providers p on p.id = r.provider_id
        where p_procedure_code = any(r.procedure_codes)
          and (v_state is null or f.state = v_state or p.practice_state = v_state)
          and (p_rate_type is null or r.rate_type = p_rate_type)
          and r.rate_year between v_year_from and v_year_to
        order by r.price asc, r.facility_id asc nulls last, r.provider_id asc nulls last
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

revoke all on function search_rates(text, text, rate_type, int, int, int, int)
    from public, anon, authenticated;
grant execute on function search_rates(text, text, rate_type, int, int, int, int)
    to anon, authenticated, service_role;
