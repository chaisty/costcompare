-- RLS policies and RPCs (submit_quote, confirm_submission, reject_submission).

-- Enable RLS, default-deny on every table.

alter table procedures enable row level security;
alter table facilities enable row level security;
alter table rates enable row level security;
alter table submissions enable row level security;

-- Public read on reference / public tables.

create policy procedures_select_public on procedures
    for select
    to anon, authenticated
    using (true);

create policy facilities_select_public on facilities
    for select
    to anon, authenticated
    using (true);

create policy rates_select_public on rates
    for select
    to anon, authenticated
    using (true);

-- submissions: NO policies for anon/authenticated. Default-deny applies.
-- Only service_role bypasses RLS. Writes happen via the RPCs below,
-- which use SECURITY DEFINER (owner: postgres) to do privileged work.

-- IP pepper: environment-scoped secret used in the salted-hash construction.
-- Local dev falls back to a well-known value; production MUST set
-- app.ip_pepper via `alter database postgres set app.ip_pepper = '<secret>';`.

create function _ip_pepper() returns text
    language sql
    stable
    set search_path = public, extensions
    as $$
    select coalesce(nullif(current_setting('app.ip_pepper', true), ''),
                    'dev-pepper-do-not-use-in-prod');
$$;

-- CRITICAL: the pepper must not be readable by any non-privileged role. If
-- anon could call _ip_pepper(), they could recover it from PostgREST and the
-- IP-hash construction would be defeated. Revoke from everyone except the
-- function owner + service_role; _hash_submitter_ip below has the same rule.
revoke all on function _ip_pepper() from public, anon, authenticated;

-- Deterministic IP hash for same-day rate-limit matching.
-- Same IP + same day (UTC) + same pepper -> same hash. Next UTC day -> new hash.
-- UTC is used explicitly so session-timezone drift can't reshape the bucket
-- boundary and silently reset the rate-limit window.

create function _hash_submitter_ip(p_ip inet) returns text
    language sql
    stable
    set search_path = public, extensions
    as $$
    select encode(
        digest(
            _ip_pepper()
                || to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD')
                || host(p_ip),
            'sha256'
        ),
        'hex'
    );
$$;

revoke all on function _hash_submitter_ip(inet) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- submit_quote: creates a pending submission, returns the plaintext token.
-- Callable by service_role only (invoked from the Edge Function, not anon).
-- The plaintext token is returned once to the caller for inclusion in the
-- confirmation email; it is not stored, only its SHA-256 hash.
-- ----------------------------------------------------------------------------

create function submit_quote(
    p_email text,
    p_facility_id uuid,
    p_procedure_codes text[],
    p_quoted_price numeric,
    p_quote_year int,
    p_had_procedure boolean,
    p_submitter_ip inet
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
    -- Input validation (belt-and-suspenders; Edge Function validates first).
    -- Simple RFC-ish shape check: one @, a dot in the domain, no whitespace,
    -- total length <= 254. Exhaustive RFC 5321 validation is out of scope for
    -- a last-line-of-defense check.
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
    if not exists (select 1 from facilities where id = p_facility_id) then
        return jsonb_build_object('ok', false, 'error', 'unknown_facility');
    end if;

    v_ip_hash := _hash_submitter_ip(p_submitter_ip);

    -- Serialize rate-limit checks per-IP via transaction-scoped advisory lock
    -- so concurrent submissions from the same origin can't both read the
    -- count as below-limit and both succeed past the cap. hashtext() fits
    -- the IP hash into the 4-byte key pg_advisory_xact_lock expects.
    perform pg_advisory_xact_lock(hashtext(v_ip_hash)::bigint);

    -- Rate limits: per-email and per-IP within the current UTC day.
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

    -- Generate 256-bit token, store only its hash.
    v_token := encode(gen_random_bytes(32), 'hex');
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

    insert into submissions (
        email, facility_id, procedure_codes, quoted_price, quote_year,
        had_procedure, token_hash, submitter_ip_hash
    ) values (
        lower(p_email), p_facility_id, p_procedure_codes, p_quoted_price,
        p_quote_year, p_had_procedure, v_token_hash, v_ip_hash
    ) returning id into v_submission_id;

    return jsonb_build_object(
        'ok', true,
        'submission_id', v_submission_id,
        'token', v_token
    );
end;
$$;

-- Supabase grants EXECUTE to anon/authenticated by default on new functions in
-- public. Revoke from all non-service roles so submit_quote is service-role-only.
revoke all on function submit_quote(text, uuid, text[], numeric, int, boolean, inet) from public, anon, authenticated;
grant execute on function submit_quote(text, uuid, text[], numeric, int, boolean, inet) to service_role;

-- ----------------------------------------------------------------------------
-- confirm_submission: flips a pending submission to confirmed and materializes
-- the public rate row. The plaintext token is the only credential needed; this
-- function is anon-callable because the token itself is unguessable.
-- ----------------------------------------------------------------------------

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

    -- Lock the row for the duration of the transaction so concurrent
    -- confirm calls with the same token serialize and the second one sees
    -- the status transition the first made.
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
        rate_type, facility_id, procedure_codes, price, rate_year,
        source_submission_id
    ) values (
        'cash', v_submission.facility_id, v_submission.procedure_codes,
        v_submission.quoted_price, v_submission.quote_year, v_submission.id
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

-- ----------------------------------------------------------------------------
-- reject_submission: service-role-only. Takes a submission down and deletes
-- its public rate row (ON DELETE CASCADE on rates.source_submission_id would
-- not fire here because we're keeping the submission for audit).
-- ----------------------------------------------------------------------------

create function reject_submission(p_submission_id uuid) returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
    as $$
declare
    v_rate_id uuid;
begin
    update submissions
    set submission_status = 'rejected'
    where id = p_submission_id
    returning rate_id into v_rate_id;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    if v_rate_id is not null then
        delete from rates where id = v_rate_id;
        update submissions set rate_id = null where id = p_submission_id;
    end if;

    return jsonb_build_object('ok', true);
end;
$$;

revoke all on function reject_submission(uuid) from public, anon, authenticated;
grant execute on function reject_submission(uuid) to service_role;
