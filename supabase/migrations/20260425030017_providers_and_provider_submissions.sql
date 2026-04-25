-- Providers table + provider-or-facility submissions (issue #13 phase A).
--
-- Lets a submission reference a provider (individual physician), a facility,
-- or both, with the hard constraint that at least one must be set. Most
-- patients remember their doctor but not the surgery-center name, so a
-- facility-required schema has a UX floor.
--
-- NPPES ingest (phase B) and provider-picker UI (phase C) land separately.
-- This migration is backend-only; the frontend can continue to submit with
-- facility_id set, and the RPC accepts the extra param as optional.

-- ---------------------------------------------------------------------------
-- providers: individual physicians from NPPES Type-1. No PII beyond what
-- NPPES publishes freely.
-- ---------------------------------------------------------------------------

create table providers (
    id uuid primary key default gen_random_uuid(),
    npi text not null,
    first_name text not null,
    last_name text not null,
    credential text,
    primary_taxonomy_code text,
    primary_taxonomy_label text,
    practice_state text,
    practice_city text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint providers_npi_shape check (npi ~ '^\d{10}$'),
    constraint providers_state_format check (practice_state is null or practice_state ~ '^[A-Z]{2}$')
);

create unique index providers_npi_key on providers (npi);
create index providers_last_name_idx on providers (lower(last_name));
create index providers_state_idx on providers (practice_state);

create trigger providers_set_updated_at
    before update on providers
    for each row execute function set_updated_at();

alter table providers enable row level security;

create policy providers_select_public on providers
    for select
    to anon, authenticated
    using (true);

-- ---------------------------------------------------------------------------
-- submissions: facility_id becomes nullable; add provider_id; require at
-- least one of the two. Existing rows keep their facility_id unchanged.
-- ---------------------------------------------------------------------------

alter table submissions alter column facility_id drop not null;

alter table submissions
    add column provider_id uuid references providers(id) on delete set null;

alter table submissions
    add constraint submissions_has_facility_or_provider
    check (facility_id is not null or provider_id is not null);

create index submissions_provider_idx on submissions (provider_id);

-- ---------------------------------------------------------------------------
-- rates: add provider_id so confirmation materializes both sides. The cash
-- rate-must-have-attribution constraint mirrors submissions.
-- ---------------------------------------------------------------------------

alter table rates
    add column provider_id uuid references providers(id) on delete set null;

alter table rates
    add constraint rates_cash_has_facility_or_provider
    check (rate_type <> 'cash' or facility_id is not null or provider_id is not null);

create index rates_provider_idx on rates (provider_id);

-- ---------------------------------------------------------------------------
-- submit_quote: drop + recreate with p_provider_id. Facility is no longer
-- mandatory; at least one of (facility, provider) must be supplied. Error
-- vocabulary grows by `missing_provider_or_facility` and `unknown_provider`.
-- ---------------------------------------------------------------------------

drop function submit_quote(text, uuid, text[], numeric, int, boolean, inet);

create function submit_quote(
    p_email text,
    p_facility_id uuid,
    p_procedure_codes text[],
    p_quoted_price numeric,
    p_quote_year int,
    p_had_procedure boolean,
    p_submitter_ip inet,
    p_provider_id uuid default null
) returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
    as $$
declare
    v_ip_hash text;
    v_token text;
    v_token_hash text;
    v_submission_id uuid;
    v_email_count int;
    v_ip_count int;
    c_email_limit constant int := 5;
    c_ip_limit constant int := 20;
begin
    if p_email is null
       or length(p_email) > 254
       or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        return jsonb_build_object('ok', false, 'error', 'invalid_email');
    end if;
    if p_quoted_price is null or p_quoted_price <= 0 then
        return jsonb_build_object('ok', false, 'error', 'invalid_price');
    end if;
    if p_quote_year is null or p_quote_year < 2000 or p_quote_year > extract(year from current_date)::int then
        return jsonb_build_object('ok', false, 'error', 'invalid_year');
    end if;
    if p_procedure_codes is null or array_length(p_procedure_codes, 1) is null then
        return jsonb_build_object('ok', false, 'error', 'invalid_procedure_codes');
    end if;
    if p_had_procedure is null then
        return jsonb_build_object('ok', false, 'error', 'missing_had_procedure');
    end if;
    if p_submitter_ip is null then
        return jsonb_build_object('ok', false, 'error', 'missing_ip');
    end if;

    if p_facility_id is null and p_provider_id is null then
        return jsonb_build_object('ok', false, 'error', 'missing_provider_or_facility');
    end if;
    if p_facility_id is not null
       and not exists (select 1 from facilities where id = p_facility_id) then
        return jsonb_build_object('ok', false, 'error', 'unknown_facility');
    end if;
    if p_provider_id is not null
       and not exists (select 1 from providers where id = p_provider_id) then
        return jsonb_build_object('ok', false, 'error', 'unknown_provider');
    end if;

    v_ip_hash := _hash_submitter_ip(p_submitter_ip);

    perform pg_advisory_xact_lock(hashtext(v_ip_hash)::bigint);

    select count(*) into v_email_count
    from submissions
    where email = lower(p_email)
      and created_at >= date_trunc('day', now() at time zone 'UTC');

    if v_email_count >= c_email_limit then
        return jsonb_build_object('ok', false, 'error', 'rate_limited_email');
    end if;

    select count(*) into v_ip_count
    from submissions
    where submitter_ip_hash = v_ip_hash
      and created_at >= date_trunc('day', now() at time zone 'UTC');

    if v_ip_count >= c_ip_limit then
        return jsonb_build_object('ok', false, 'error', 'rate_limited_ip');
    end if;

    v_token := encode(gen_random_bytes(32), 'hex');
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

    insert into submissions (
        email, facility_id, provider_id, procedure_codes, quoted_price,
        quote_year, had_procedure, token_hash, submitter_ip_hash
    ) values (
        lower(p_email), p_facility_id, p_provider_id, p_procedure_codes,
        p_quoted_price, p_quote_year, p_had_procedure, v_token_hash, v_ip_hash
    ) returning id into v_submission_id;

    return jsonb_build_object(
        'ok', true,
        'submission_id', v_submission_id,
        'token', v_token
    );
end;
$$;

revoke all on function submit_quote(text, uuid, text[], numeric, int, boolean, inet, uuid)
    from public, anon, authenticated;
grant execute on function submit_quote(text, uuid, text[], numeric, int, boolean, inet, uuid)
    to service_role;

-- ---------------------------------------------------------------------------
-- confirm_submission: materialize provider_id onto the rate along with
-- facility_id. Signature is unchanged (still takes a token).
-- ---------------------------------------------------------------------------

drop function confirm_submission(text);

create function confirm_submission(p_token text) returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
    as $$
declare
    v_token_hash text;
    v_submission submissions%rowtype;
    v_rate_id uuid;
begin
    if p_token is null or length(p_token) = 0 then
        return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    v_token_hash := encode(digest(p_token, 'sha256'), 'hex');

    select * into v_submission
    from submissions
    where token_hash = v_token_hash
    for update;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_submission.submission_status = 'confirmed' then
        return jsonb_build_object('ok', false, 'error', 'already_confirmed');
    end if;

    if v_submission.submission_status = 'rejected' then
        return jsonb_build_object('ok', false, 'error', 'rejected');
    end if;

    if v_submission.token_expires_at < now() then
        return jsonb_build_object('ok', false, 'error', 'token_expired');
    end if;

    insert into rates (
        rate_type, facility_id, provider_id, procedure_codes, price, rate_year,
        source_submission_id
    ) values (
        'cash', v_submission.facility_id, v_submission.provider_id,
        v_submission.procedure_codes, v_submission.quoted_price,
        v_submission.quote_year, v_submission.id
    ) returning id into v_rate_id;

    update submissions
    set submission_status = 'confirmed',
        confirmed_at = now(),
        rate_id = v_rate_id
    where id = v_submission.id;

    return jsonb_build_object('ok', true, 'rate_id', v_rate_id);
end;
$$;

revoke all on function confirm_submission(text) from public;
grant execute on function confirm_submission(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- search_rates: add provider columns to the allowlist. Same omissions as
-- before (no rates.id, no source_submission_id). Provider PII surface is
-- limited to what NPPES already publishes publicly.
-- ---------------------------------------------------------------------------

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

    -- `state` filter matches on facility OR provider practice state so
    -- provider-only submissions show up under the submitter's state. Rows
    -- with neither set are excluded from state-filtered results (they still
    -- appear under "all states").
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
