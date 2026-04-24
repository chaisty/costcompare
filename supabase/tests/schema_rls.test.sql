-- RLS + RPC tests for the initial schema.
-- Run via: npx supabase test db
-- pgTAP docs: https://pgtap.org/documentation.html

begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

-- ---------------------------------------------------------------------------
-- Seed fixtures for the test. A facility row is needed for every submission.
-- ---------------------------------------------------------------------------

insert into facilities (id, external_id, name, facility_type, state)
values ('11111111-1111-1111-1111-111111111111'::uuid, 'TEST-001',
        'Test ASC', 'asc', 'CA');

-- ---------------------------------------------------------------------------
-- Schema shape assertions (cheap sanity checks).
-- ---------------------------------------------------------------------------

select has_table('public', 'procedures', 'procedures table exists');
select has_table('public', 'facilities', 'facilities table exists');
select has_table('public', 'submissions', 'submissions table exists');
select has_table('public', 'rates', 'rates table exists');

select has_enum('public', 'rate_type', 'rate_type enum exists');
select has_enum('public', 'submission_status', 'submission_status enum exists');

-- Rates carry provenance columns per issue #1 acceptance criteria.
select has_column('public', 'rates', 'source_url',
    'rates.source_url exists for provenance');
select has_column('public', 'rates', 'source_fetched_at',
    'rates.source_fetched_at exists for provenance');

-- No email column in the public-facing rates table. The load-bearing
-- no-email-leak invariant starts here: email simply does not live anywhere
-- an anon query can reach.
select hasnt_column('public', 'rates', 'email',
    'rates has no email column (no-email-leak defense-in-depth)');

-- Intracept seed is present.
select results_eq(
    $$ select primary_code, procedure_codes, name from procedures where primary_code = '64628' $$,
    $$ values ('64628'::text, array['64628']::text[], 'Intracept'::text) $$,
    'Intracept seeded with CPT 64628 only'
);

-- ---------------------------------------------------------------------------
-- Anon role: reads on public tables.
-- ---------------------------------------------------------------------------

set local role anon;

select ok(
    (select count(*) from procedures) >= 1,
    'anon can select from procedures'
);

select ok(
    (select count(*) from facilities) >= 1,
    'anon can select from facilities'
);

select lives_ok(
    $$ select * from rates $$,
    'anon can select from rates (empty is fine)'
);

-- ---------------------------------------------------------------------------
-- Anon role: submissions are invisible. RLS default-deny: anon sees zero rows
-- regardless of how many exist. Seed a row as postgres, then verify anon gets
-- zero back.
-- ---------------------------------------------------------------------------

reset role;

insert into submissions (
    email, facility_id, procedure_codes, quoted_price, quote_year,
    had_procedure, token_hash, submitter_ip_hash
) values (
    'alice@example.com', '11111111-1111-1111-1111-111111111111'::uuid,
    array['64628'], 4500.00, 2026, true,
    'fakehash_for_rls_test', 'fakeiphash'
);

set local role anon;

select is(
    (select count(*)::int from submissions),
    0,
    'anon sees zero rows in submissions (RLS default-deny)'
);

select is(
    (select count(*)::int from submissions where email = 'alice@example.com'),
    0,
    'anon cannot read submission rows even by known email'
);

-- ---------------------------------------------------------------------------
-- Anon role: direct writes are blocked.
-- INSERT throws; UPDATE/DELETE silently affect zero rows.
-- ---------------------------------------------------------------------------

select throws_ok(
    $$ insert into submissions (email, facility_id, procedure_codes,
         quoted_price, quote_year, had_procedure, token_hash, submitter_ip_hash)
       values ('bob@example.com', '11111111-1111-1111-1111-111111111111'::uuid,
         array['64628'], 100, 2026, false, 'h', 'h') $$,
    '42501',
    null,
    'anon cannot INSERT into submissions'
);

select throws_ok(
    $$ insert into rates (rate_type, procedure_codes, price, rate_year,
         source_submission_id)
       values ('medicare', array['64628'], 2000, 2026, null) $$,
    '42501',
    null,
    'anon cannot INSERT into rates'
);

-- Seed a rates row as postgres, then prove anon cannot mutate it.
-- Without a seeded row, UPDATE/DELETE silently affect zero rows either because
-- there's nothing to match or because RLS filters it out — we want to
-- distinguish those cases.
reset role;

insert into submissions (
    id, email, facility_id, procedure_codes, quoted_price, quote_year,
    had_procedure, token_hash, submitter_ip_hash, submission_status
) values (
    '22222222-2222-2222-2222-222222222222'::uuid,
    'confirmed@example.com', '11111111-1111-1111-1111-111111111111'::uuid,
    array['64628'], 9999.99, 2026, true,
    'fakehash_for_rates_test', 'fakeiphash_rates', 'confirmed'
);

insert into rates (id, rate_type, facility_id, procedure_codes, price,
                   rate_year, source_submission_id)
values ('33333333-3333-3333-3333-333333333333'::uuid, 'cash',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 9999.99, 2026,
        '22222222-2222-2222-2222-222222222222'::uuid);

set local role anon;

-- Try to mutate as anon. RLS with no UPDATE/DELETE policy filters the USING
-- clause to zero rows, so these statements run without error but leave the
-- seeded row untouched. Evidence of immutability is the unchanged price
-- and the row still existing after DELETE.
select lives_ok(
    $$ update rates set price = 1 where true $$,
    'anon UPDATE on rates does not throw'
);

select is(
    (select price from rates where id = '33333333-3333-3333-3333-333333333333'::uuid),
    9999.99::numeric(10, 2),
    'anon UPDATE did not mutate the row'
);

select lives_ok(
    $$ delete from rates where true $$,
    'anon DELETE on rates does not throw'
);

select is(
    (select count(*)::int from rates where id = '33333333-3333-3333-3333-333333333333'::uuid),
    1,
    'anon DELETE did not remove the row'
);

-- ---------------------------------------------------------------------------
-- No-email-leak: a join from rates to submissions must not let anon reach
-- the email column. This is the single most load-bearing security invariant
-- in the project; CLAUDE.md §Security calls it out by name.
-- ---------------------------------------------------------------------------

select is(
    (select count(*)::int
     from rates r
     join submissions s on s.id = r.source_submission_id
     where s.email is not null),
    0,
    'anon cannot reach submissions.email via a rates JOIN'
);

-- Same idea at the function level: cannot call the private helpers to
-- recover the pepper and reverse the IP hash.
select ok(
    not has_function_privilege('anon', 'public._ip_pepper()', 'EXECUTE'),
    'anon lacks EXECUTE on _ip_pepper'
);

select ok(
    not has_function_privilege('anon', 'public._hash_submitter_ip(inet)', 'EXECUTE'),
    'anon lacks EXECUTE on _hash_submitter_ip'
);

-- ---------------------------------------------------------------------------
-- Anon role: RPC execution privileges.
-- Check grants directly rather than attempting execution — pgTAP's throws_ok
-- against a 42501-on-EXECUTE has a SEGV regression, and a privilege check
-- is what we actually want to assert anyway.
-- ---------------------------------------------------------------------------

reset role;

select ok(
    not has_function_privilege(
        'anon',
        'public.submit_quote(text, uuid, text[], numeric, int, boolean, inet)',
        'EXECUTE'
    ),
    'anon lacks EXECUTE on submit_quote'
);

select ok(
    not has_function_privilege(
        'anon',
        'public.reject_submission(uuid)',
        'EXECUTE'
    ),
    'anon lacks EXECUTE on reject_submission'
);

select ok(
    has_function_privilege(
        'anon',
        'public.confirm_submission(text)',
        'EXECUTE'
    ),
    'anon has EXECUTE on confirm_submission'
);

-- confirm_submission with bogus token returns an error object, never raises.
set local role anon;

select is(
    (select (confirm_submission('not-a-real-token')->>'error')::text),
    'invalid_token',
    'confirm_submission with bogus token returns invalid_token error'
);

-- ---------------------------------------------------------------------------
-- Service-role: happy path. submit_quote -> confirm_submission -> rate appears.
-- ---------------------------------------------------------------------------

reset role;

-- Clean slate for the happy path.
delete from rates;
delete from submissions;

-- Execute submit_quote as service_role (as it will be called in prod).
set local role service_role;

select ok(
    (select (submit_quote(
        'carol@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 5200.00, 2026, true,
        '10.0.0.1'::inet
    )->>'ok')::boolean),
    'submit_quote succeeds with valid input'
);

-- Capture the plaintext token returned by submit_quote, then confirm it.
do $$
declare
    v_result jsonb;
    v_token text;
    v_confirm jsonb;
begin
    delete from rates;
    delete from submissions;

    v_result := submit_quote(
        'dave@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 6100.00, 2025, true,
        '10.0.0.2'::inet
    );
    v_token := v_result->>'token';

    v_confirm := confirm_submission(v_token);

    if (v_confirm->>'ok')::boolean is not true then
        raise exception 'confirm failed: %', v_confirm;
    end if;
end;
$$;

reset role;

select is(
    (select count(*)::int from rates where rate_type = 'cash'),
    1,
    'after confirm, one cash rate exists'
);

select is(
    (select submission_status::text from submissions where email = 'dave@example.com'),
    'confirmed',
    'submission status flipped to confirmed'
);

-- Anon can see the materialized rate.
set local role anon;

select is(
    (select count(*)::int from rates where rate_type = 'cash'),
    1,
    'anon can see the materialized cash rate'
);

-- Service role CAN read submission email (per AC "service role can read
-- everything"). Using the existing dave@example.com row from the happy path.
reset role;
set local role service_role;

select is(
    (select email from submissions where email = 'dave@example.com'),
    'dave@example.com',
    'service_role can read submissions.email'
);

reset role;

-- ---------------------------------------------------------------------------
-- Double-confirm is rejected.
-- ---------------------------------------------------------------------------

reset role;

do $$
declare
    v_result jsonb;
    v_token text;
    v_first jsonb;
    v_second jsonb;
begin
    delete from rates;
    delete from submissions;

    v_result := submit_quote(
        'eve@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 4900.00, 2026, true,
        '10.0.0.3'::inet
    );
    v_token := v_result->>'token';
    v_first := confirm_submission(v_token);
    v_second := confirm_submission(v_token);

    perform set_config('_test.first', v_first::text, true);
    perform set_config('_test.second', v_second::text, true);
end;
$$;

select is(
    (select (current_setting('_test.second')::jsonb ->> 'error')::text),
    'already_confirmed',
    'second confirm returns already_confirmed'
);

-- ---------------------------------------------------------------------------
-- Reject removes the public rate but preserves the submission row.
-- ---------------------------------------------------------------------------

do $$
declare
    v_result jsonb;
    v_token text;
    v_submission_id uuid;
begin
    delete from rates;
    delete from submissions;

    v_result := submit_quote(
        'frank@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 7200.00, 2026, false,
        '10.0.0.4'::inet
    );
    v_token := v_result->>'token';
    v_submission_id := (v_result->>'submission_id')::uuid;

    perform confirm_submission(v_token);
    perform reject_submission(v_submission_id);
end;
$$;

select is(
    (select count(*)::int from rates where rate_type = 'cash'),
    0,
    'after reject_submission, cash rate is removed'
);

select is(
    (select submission_status::text from submissions where email = 'frank@example.com'),
    'rejected',
    'submission row remains with status rejected'
);

-- ---------------------------------------------------------------------------
-- Expired token: confirm_submission returns token_expired and does not
-- materialize a rate row. Fast-forward the expiry via a direct UPDATE.
-- ---------------------------------------------------------------------------

do $$
declare
    v_result jsonb;
    v_token text;
    v_submission_id uuid;
    v_confirm jsonb;
begin
    delete from rates;
    delete from submissions;

    v_result := submit_quote(
        'gina@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 5000, 2026, true,
        '10.0.0.7'::inet
    );
    v_token := v_result->>'token';
    v_submission_id := (v_result->>'submission_id')::uuid;

    update submissions
    set token_expires_at = now() - interval '1 minute'
    where id = v_submission_id;

    v_confirm := confirm_submission(v_token);

    perform set_config('_test.expired', v_confirm::text, true);
end;
$$;

select is(
    (select (current_setting('_test.expired')::jsonb ->> 'error')::text),
    'token_expired',
    'confirm_submission rejects expired tokens'
);

select is(
    (select count(*)::int from rates where rate_type = 'cash'),
    0,
    'expired-token confirm did not materialize a rate'
);

-- ---------------------------------------------------------------------------
-- Rate limits: per-email cap is 5/day. 6th submission from the same email
-- returns rate_limited_email and is not inserted.
-- ---------------------------------------------------------------------------

do $$
declare
    i int;
    v_result jsonb;
    v_last jsonb;
begin
    delete from submissions;
    for i in 1..5 loop
        v_result := submit_quote(
            'spammer@example.com',
            '11111111-1111-1111-1111-111111111111'::uuid,
            array['64628'], 1000 + i, 2026, true,
            ('10.1.0.' || i)::inet
        );
        if (v_result->>'ok')::boolean is not true then
            raise exception 'unexpected rate-limit on iteration %: %', i, v_result;
        end if;
    end loop;
    v_last := submit_quote(
        'spammer@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 2000, 2026, true,
        '10.1.0.6'::inet
    );
    perform set_config('_test.rl_email', v_last::text, true);
end;
$$;

select is(
    (select (current_setting('_test.rl_email')::jsonb ->> 'error')::text),
    'rate_limited_email',
    '6th submission from same email hits rate_limited_email'
);

-- Per-IP cap is 20/day. 21st from the same IP returns rate_limited_ip.
do $$
declare
    i int;
    v_result jsonb;
    v_last jsonb;
begin
    delete from submissions;
    for i in 1..20 loop
        v_result := submit_quote(
            ('user' || i || '@example.com'),
            '11111111-1111-1111-1111-111111111111'::uuid,
            array['64628'], 1000 + i, 2026, true,
            '10.2.0.99'::inet
        );
        if (v_result->>'ok')::boolean is not true then
            raise exception 'unexpected rate-limit on iteration %: %', i, v_result;
        end if;
    end loop;
    v_last := submit_quote(
        'overflow@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 3000, 2026, true,
        '10.2.0.99'::inet
    );
    perform set_config('_test.rl_ip', v_last::text, true);
end;
$$;

select is(
    (select (current_setting('_test.rl_ip')::jsonb ->> 'error')::text),
    'rate_limited_ip',
    '21st submission from same IP hits rate_limited_ip'
);

-- ---------------------------------------------------------------------------
-- submit_quote rejects unknown facility.
-- ---------------------------------------------------------------------------

select is(
    (select (submit_quote(
        'grace@example.com',
        '00000000-0000-0000-0000-000000000000'::uuid,
        array['64628'], 1000, 2026, true,
        '10.0.0.5'::inet
    )->>'error')::text),
    'unknown_facility',
    'submit_quote rejects unknown facility'
);

-- ---------------------------------------------------------------------------
-- submit_quote rejects invalid email.
-- ---------------------------------------------------------------------------

select is(
    (select (submit_quote(
        'not-an-email',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 1000, 2026, true,
        '10.0.0.6'::inet
    )->>'error')::text),
    'invalid_email',
    'submit_quote rejects invalid email'
);

select * from finish();
rollback;
