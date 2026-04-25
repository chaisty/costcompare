-- resend_confirmation_token RPC tests.
-- Covers the happy path, vague-no-match privacy, expired-token exclusion,
-- and the resend_count cap.

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- Fixtures.
insert into facilities (id, external_id, name, facility_type, state)
values ('11111111-1111-1111-1111-111111111111'::uuid, 'RESEND-FAC-001',
        'Resend Test ASC', 'asc', 'CA');

-- ---------------------------------------------------------------------------
-- Privilege: service-role only (matches submit_quote).
-- ---------------------------------------------------------------------------

select ok(
    not has_function_privilege('anon', 'public.resend_confirmation_token(text)', 'EXECUTE'),
    'anon lacks EXECUTE on resend_confirmation_token'
);

select ok(
    has_function_privilege('service_role', 'public.resend_confirmation_token(text)', 'EXECUTE'),
    'service_role has EXECUTE on resend_confirmation_token'
);

-- ---------------------------------------------------------------------------
-- No-match returns vague success (privacy: never leak email-in-DB).
-- ---------------------------------------------------------------------------

set local role service_role;

select is(
    (select (resend_confirmation_token('never-submitted@example.com')->>'ok')::boolean),
    true,
    'unknown email still returns ok=true (vague success)'
);

select is(
    (select (resend_confirmation_token('never-submitted@example.com')->>'sent')::boolean),
    false,
    'unknown email returns sent=false'
);

-- Invalid email fails at validation.
select is(
    (resend_confirmation_token('not-an-email')->>'error')::text,
    'invalid_email',
    'malformed email rejected'
);

-- ---------------------------------------------------------------------------
-- Happy path: pending submission gets a new token + sent=true.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;

do $$
declare
    v_result jsonb;
    v_old_token text;
    v_old_token_hash text;
    v_resend_result jsonb;
    v_new_token text;
    v_after_hash text;
begin
    delete from rates;
    delete from submissions;

    v_result := submit_quote(
        'resend-test@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 5500.00, 2025, true,
        '10.0.0.50'::inet
    );
    v_old_token := v_result->>'token';
    select token_hash into v_old_token_hash from submissions where email = 'resend-test@example.com';

    v_resend_result := resend_confirmation_token('resend-test@example.com');
    v_new_token := v_resend_result->>'token';
    select token_hash into v_after_hash from submissions where email = 'resend-test@example.com';

    if (v_resend_result->>'ok')::boolean is not true then
        raise exception 'resend ok=false: %', v_resend_result;
    end if;
    if (v_resend_result->>'sent')::boolean is not true then
        raise exception 'resend sent=false: %', v_resend_result;
    end if;
    if v_new_token = v_old_token then
        raise exception 'resend returned the same token; expected rotation';
    end if;
    if v_after_hash = v_old_token_hash then
        raise exception 'resend did not rotate token_hash';
    end if;
end;
$$;

select is(
    (select resend_count from submissions where email = 'resend-test@example.com'),
    1,
    'resend_count incremented to 1'
);

-- Confirm the rotated token still confirms cleanly. Need to capture the new
-- plaintext token through a fresh resend (the previous DO block is closed).
do $$
declare
    v_resend jsonb;
    v_token text;
    v_confirm jsonb;
begin
    -- Reset the row so confirm_submission has a clean canvas.
    update submissions
    set submission_status = 'pending',
        confirmed_at = null,
        rate_id = null
    where email = 'resend-test@example.com';
    delete from rates where source_submission_id in
        (select id from submissions where email = 'resend-test@example.com');

    v_resend := resend_confirmation_token('resend-test@example.com');
    v_token := v_resend->>'token';
    v_confirm := confirm_submission(v_token);

    if (v_confirm->>'ok')::boolean is not true then
        raise exception 'confirm with rotated token failed: %', v_confirm;
    end if;
end;
$$;

select is(
    (select submission_status::text from submissions where email = 'resend-test@example.com'),
    'confirmed',
    'submission confirmed via rotated token'
);

-- ---------------------------------------------------------------------------
-- Resend cap (3). Once a submission has been resent 3 times, further resends
-- are rejected with resend_limit_exceeded.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;

do $$
begin
    delete from rates;
    delete from submissions;
    perform submit_quote(
        'capped@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 5500.00, 2025, true,
        '10.0.0.51'::inet
    );

    -- Bump resend_count via three resends.
    perform resend_confirmation_token('capped@example.com');
    perform resend_confirmation_token('capped@example.com');
    perform resend_confirmation_token('capped@example.com');
end;
$$;

select is(
    (select resend_count from submissions where email = 'capped@example.com'),
    3,
    'resend_count caps at 3 after three resends'
);

select is(
    (resend_confirmation_token('capped@example.com')->>'error')::text,
    'resend_limit_exceeded',
    'fourth resend rejected with resend_limit_exceeded'
);

-- ---------------------------------------------------------------------------
-- Expired tokens are excluded — caller appears to have no pending submission.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;

do $$
begin
    delete from rates;
    delete from submissions;

    perform submit_quote(
        'expired@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 5500.00, 2025, true,
        '10.0.0.52'::inet
    );
    update submissions
    set token_expires_at = now() - interval '1 hour'
    where email = 'expired@example.com';
end;
$$;

select is(
    (resend_confirmation_token('expired@example.com')->>'sent')::boolean,
    false,
    'expired-token submission is invisible to resend (vague success)'
);

select is(
    (resend_confirmation_token('expired@example.com')->>'ok')::boolean,
    true,
    'expired-token submission still returns ok=true'
);

select * from finish();

rollback;
