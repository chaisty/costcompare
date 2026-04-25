-- Provider-or-facility submission path (issue #13 phase A).
-- Covers the schema + RPC changes; the NPPES ETL and frontend picker land
-- separately. Seeds a synthetic provider row here rather than waiting on a
-- real NPPES import so the RPC paths can be exercised in isolation.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- ---------------------------------------------------------------------------
-- Schema assertions: providers table + nullability + CHECK constraints.
-- ---------------------------------------------------------------------------

select has_table('public', 'providers', 'providers table exists');
select has_column('public', 'providers', 'npi', 'providers.npi column exists');
select has_column('public', 'submissions', 'provider_id', 'submissions.provider_id exists');
select has_column('public', 'rates', 'provider_id', 'rates.provider_id exists');

select col_is_null(
    'public', 'submissions', 'facility_id',
    'submissions.facility_id is nullable'
);

-- Anon read is granted on providers (public PII-free roster).
set local role anon;
select lives_ok(
    $$ select * from providers $$,
    'anon can select from providers'
);
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------

insert into facilities (id, external_id, name, facility_type, state)
values ('11111111-1111-1111-1111-111111111111'::uuid, 'PROV-FAC-001',
        'Fixture ASC', 'asc', 'CA');

insert into providers (id, npi, first_name, last_name, credential,
                       primary_taxonomy_code, primary_taxonomy_label,
                       practice_state, practice_city)
values ('22222222-2222-2222-2222-222222222222'::uuid,
        '1234567890', 'Jane', 'Smith', 'MD',
        '208VP0014X', 'Interventional Pain Medicine', 'CA', 'San Francisco');

-- ---------------------------------------------------------------------------
-- submit_quote: provider-only submission (facility_id null, provider_id set).
-- ---------------------------------------------------------------------------

set local role service_role;

select is(
    (select (submit_quote(
        'solo-provider@example.com',
        null,
        array['64628'], 7500.00, 2025, true,
        '10.20.30.40'::inet,
        '22222222-2222-2222-2222-222222222222'::uuid
    )->>'ok')::boolean),
    true,
    'submit_quote accepts provider-only (facility null, provider set)'
);

select is(
    (select provider_id from submissions where email = 'solo-provider@example.com'),
    '22222222-2222-2222-2222-222222222222'::uuid,
    'provider_id stored on submissions row'
);

select is(
    (select facility_id from submissions where email = 'solo-provider@example.com'),
    null::uuid,
    'facility_id is null on provider-only submissions'
);

-- ---------------------------------------------------------------------------
-- submit_quote: rejects both-null with missing_provider_or_facility.
-- ---------------------------------------------------------------------------

select is(
    (select (submit_quote(
        'neither@example.com',
        null,
        array['64628'], 5000.00, 2025, true,
        '10.20.30.41'::inet,
        null
    )->>'error')::text),
    'missing_provider_or_facility',
    'submit_quote rejects neither facility nor provider'
);

-- ---------------------------------------------------------------------------
-- submit_quote: unknown provider_id is rejected.
-- ---------------------------------------------------------------------------

select is(
    (select (submit_quote(
        'ghost-provider@example.com',
        null,
        array['64628'], 5000.00, 2025, true,
        '10.20.30.42'::inet,
        '99999999-9999-9999-9999-999999999999'::uuid
    )->>'error')::text),
    'unknown_provider',
    'submit_quote rejects a provider_id that does not exist'
);

-- ---------------------------------------------------------------------------
-- submit_quote: both-sides submission (facility + provider) succeeds.
-- ---------------------------------------------------------------------------

select is(
    (select (submit_quote(
        'both-sides@example.com',
        '11111111-1111-1111-1111-111111111111'::uuid,
        array['64628'], 6200.00, 2025, true,
        '10.20.30.43'::inet,
        '22222222-2222-2222-2222-222222222222'::uuid
    )->>'ok')::boolean),
    true,
    'submit_quote accepts both facility and provider'
);

-- ---------------------------------------------------------------------------
-- confirm_submission materializes provider_id onto the rate row.
-- ---------------------------------------------------------------------------

do $$
declare
    v_result jsonb;
    v_token text;
    v_confirm jsonb;
begin
    -- Clean slate for this sub-test only.
    delete from rates;
    delete from submissions;

    v_result := submit_quote(
        'provider-confirm@example.com',
        null,
        array['64628'], 7100.00, 2025, true,
        '10.20.30.50'::inet,
        '22222222-2222-2222-2222-222222222222'::uuid
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
    (select provider_id from rates where rate_type = 'cash'),
    '22222222-2222-2222-2222-222222222222'::uuid,
    'confirm_submission materializes provider_id onto the cash rate'
);

select is(
    (select facility_id from rates where rate_type = 'cash'),
    null::uuid,
    'confirm_submission leaves facility_id null on provider-only rate'
);

-- ---------------------------------------------------------------------------
-- search_rates returns provider_* columns populated for provider-only rates.
-- ---------------------------------------------------------------------------

set local role anon;

select is(
    (select (search_rates()->'results'->0->>'provider_name')::text),
    'Jane Smith',
    'search_rates renders provider_name for provider-only rates'
);

select is(
    (select (search_rates()->'results'->0->>'provider_credential')::text),
    'MD',
    'search_rates renders provider_credential'
);

select is(
    (select (search_rates()->'results'->0->>'provider_specialty')::text),
    'Interventional Pain Medicine',
    'search_rates renders provider_specialty'
);

select is(
    (select jsonb_typeof(search_rates()->'results'->0->'facility_name')),
    'null',
    'facility_name is JSON null on provider-only rates'
);

-- state filter matches on provider.practice_state when the facility is absent.
select is(
    jsonb_array_length(search_rates(p_state => 'CA')->'results'),
    1,
    'state=CA matches provider-only rate via practice_state'
);

-- ---------------------------------------------------------------------------
-- No email leak — same assertion family as before, now with a provider row.
-- ---------------------------------------------------------------------------

select ok(
    not (search_rates()::text ~ 'provider-confirm@example\.com'),
    'search_rates response does not leak the submitter email'
);

select * from finish();

rollback;
