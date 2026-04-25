-- Tests for the search_rates RPC (issue #4 + keyset pagination follow-up).
-- Run via: npx supabase test db
-- These are kept in a separate file from schema_rls.test.sql so the tests for
-- each issue stay independent and cheap to reason about.

begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- Fixtures. Use deterministic UUIDs so assertions can reference rows by id.
-- Two facilities in different states; a medicare rate; a confirmed cash rate
-- materialized through a real submission+confirm round-trip so the
-- source_submission_id FK is populated.
-- ---------------------------------------------------------------------------

insert into facilities (id, external_id, name, facility_type, state)
values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'SEARCH-001',
     'Alpha Surgical Center', 'asc', 'CA'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'SEARCH-002',
     'Beta Surgical Center', 'asc', 'NY');

-- National Medicare rate. No facility_id, locality + source fields required
-- by the rates_non_cash_has_provenance check.
insert into rates (id, rate_type, facility_id, procedure_codes, price,
                   rate_year, locality, source_url, source_fetched_at)
values
    ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'medicare', null,
     array['64628'], 9891.33, 2026, 'NATIONAL-UNADJUSTED',
     'https://www.cms.gov/test', now());

-- Materialize a cash rate via the real confirmation path — this is also a
-- cross-check that the issue-#3 flow still works after this migration. Use a
-- temp table rather than a psql meta-command so this runs under any client.
create temp table _seed_submission as
select submit_quote(
    'searcher@example.com',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    array['64628'],
    8500.00,
    2025,
    true,
    '203.0.113.99'::inet
) as payload;

select confirm_submission((select payload->>'token' from _seed_submission));

-- ---------------------------------------------------------------------------
-- Privilege: anon can EXECUTE the function. This runs before `set local role
-- anon` below because has_function_privilege() queries the catalog and needs
-- postgres-level access — the assertion checks anon's grants, it doesn't run
-- as anon.
-- ---------------------------------------------------------------------------

select ok(
    has_function_privilege(
        'anon',
        'public.search_rates(text, text, rate_type, int, int, int, text)',
        'EXECUTE'
    ),
    'anon has EXECUTE on search_rates'
);

-- ---------------------------------------------------------------------------
-- Shape: top-level ok/results.
-- ---------------------------------------------------------------------------

set local role anon;

select is(
    (search_rates()->>'ok')::boolean,
    true,
    'search_rates() defaults return ok:true'
);

select is(
    jsonb_typeof(search_rates()->'results'),
    'array',
    'search_rates() returns results as an array'
);

select ok(
    jsonb_array_length(search_rates()->'results') >= 2,
    'search_rates() default returns at least the seeded medicare + cash rate'
);

-- ---------------------------------------------------------------------------
-- Default procedure_code = 64628.
-- ---------------------------------------------------------------------------

select is(
    (search_rates()->'results')::jsonb,
    (search_rates(p_procedure_code => '64628')->'results')::jsonb,
    'default p_procedure_code is 64628'
);

-- ---------------------------------------------------------------------------
-- No-email-leak: the returned payload must never contain the word "email" as
-- a key nor an email-shaped string. This is the load-bearing invariant from
-- CLAUDE.md; keep the regex simple and conservative.
-- ---------------------------------------------------------------------------

select ok(
    not (search_rates()::text ~* '"email"'),
    'search_rates response has no "email" key'
);

select ok(
    not (search_rates()::text ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'),
    'search_rates response has no email-shaped string'
);

select ok(
    not (search_rates()::text ~* 'searcher@example.com'),
    'search_rates response does not leak the seeded submitter email'
);

-- ---------------------------------------------------------------------------
-- No submitter-derivable UUIDs: source_submission_id should not appear in
-- the response (it would let an attacker who guesses a submission_id verify
-- which rates came from which submission).
-- ---------------------------------------------------------------------------

select ok(
    not (search_rates()::text ~* '"source_submission_id"'),
    'search_rates response omits source_submission_id'
);

-- ---------------------------------------------------------------------------
-- search_token must NOT leak in result rows. It's an internal pagination
-- handle that round-trips opaquely via next_cursor; bare exposure would
-- defeat the point of having a separate token from rates.id.
-- ---------------------------------------------------------------------------

select ok(
    not (search_rates()->'results')::text ~* '"search_token"',
    'search_rates result rows do not expose search_token'
);

-- ---------------------------------------------------------------------------
-- Column allowlist: result rows must expose exactly these keys and no others.
-- Stronger than the regex-based no-email-leak tests above — if a future schema
-- change adds a column (even a non-email one like `notes`) and someone wires
-- it into the SELECT, this test fails loudly. This is the assertion the
-- acceptance criterion "automated test greps every response shape" was
-- reaching for.
-- ---------------------------------------------------------------------------

select is(
    (select array_agg(k order by k)
     from jsonb_object_keys((search_rates()->'results')->0) as k),
    array[
        'confidence_note', 'facility_external_id', 'facility_id', 'facility_name', 'facility_state',
        'locality', 'payer', 'plan_variant', 'price', 'procedure_codes',
        'provider_credential', 'provider_id', 'provider_name', 'provider_specialty',
        'provider_state', 'rate_type', 'rate_year', 'source_fetched_at', 'source_url'
    ]::text[],
    'result rows expose exactly the expected column allowlist (no id, no source_submission_id, no email, no search_token)'
);

-- ---------------------------------------------------------------------------
-- State filter.
-- ---------------------------------------------------------------------------

select is(
    jsonb_array_length(search_rates(p_state => 'CA')->'results'),
    1,
    'state=CA returns only CA rows (the one cash rate)'
);

select is(
    (search_rates(p_state => 'CA')->'results'->0->>'facility_state')::text,
    'CA',
    'state=CA filter actually filtered on CA'
);

-- Lowercase + trimmed state still works.
select is(
    jsonb_array_length(search_rates(p_state => '  ca  ')->'results'),
    1,
    'state normalization (trim + upper) works'
);

-- Invalid state shape.
select is(
    (search_rates(p_state => 'CAL')->>'error')::text,
    'invalid_state',
    'state=CAL (3 chars) rejected'
);

-- ---------------------------------------------------------------------------
-- Rate type filter.
-- ---------------------------------------------------------------------------

select is(
    jsonb_array_length(search_rates(p_rate_type => 'medicare'::rate_type)->'results'),
    1,
    'rate_type=medicare filter returns only the medicare row'
);

select is(
    (search_rates(p_rate_type => 'medicare'::rate_type)->'results'->0->>'rate_type')::text,
    'medicare',
    'rate_type=medicare filter actually filtered on medicare'
);

-- Default p_rate_type=null returns rows of BOTH types.
select is(
    (select count(distinct r->>'rate_type')::int
     from jsonb_array_elements(search_rates()->'results') r),
    2,
    'default p_rate_type (null) returns both cash and medicare rows'
);

-- ---------------------------------------------------------------------------
-- Year range validation.
-- ---------------------------------------------------------------------------

select is(
    (search_rates(p_year_from => 2100, p_year_to => 2000)->>'error')::text,
    'invalid_year_range',
    'year_from > year_to rejected'
);

select is(
    (search_rates(p_year_from => 1999)->>'error')::text,
    'invalid_year_range',
    'year_from < 2000 rejected'
);

-- ---------------------------------------------------------------------------
-- Pagination: limit clamped, has_more flag, next_cursor handshake.
-- ---------------------------------------------------------------------------

select is(
    (search_rates(p_limit => 999)->>'limit')::int,
    200,
    'limit > 200 is clamped to 200'
);

select is(
    (search_rates(p_limit => 0)->>'limit')::int,
    1,
    'limit < 1 is clamped to 1'
);

-- With limit=1, only one row returned.
select is(
    jsonb_array_length(search_rates(p_limit => 1)->'results'),
    1,
    'limit=1 returns exactly one row'
);

-- has_more flag: true when more rows exist past the current page.
select is(
    (search_rates(p_limit => 1)->>'has_more')::boolean,
    true,
    'has_more=true when results exceed the requested limit'
);

-- has_more=false on default 50-limit query (only 2 rows total in fixtures).
select is(
    (search_rates()->>'has_more')::boolean,
    false,
    'has_more=false when the page covers all matches'
);

-- next_cursor present (non-null) when has_more is true.
select isnt(
    search_rates(p_limit => 1)->'next_cursor',
    'null'::jsonb,
    'next_cursor is non-null when has_more is true'
);

-- next_cursor null when has_more is false.
select is(
    search_rates()->'next_cursor',
    'null'::jsonb,
    'next_cursor is null when has_more is false'
);

-- ---------------------------------------------------------------------------
-- Cursor round-trip: page 1 + page 2 covers all rows once each. Tightest
-- guarantee that the cursor is the right shape for the WHERE clause.
-- ---------------------------------------------------------------------------

select is(
    (
        select array_agg(price order by price)::numeric[]
        from (
            select (r->>'price')::numeric as price
            from jsonb_array_elements(search_rates(p_limit => 1)->'results') r
            union all
            select (r->>'price')::numeric as price
            from jsonb_array_elements(
                search_rates(
                    p_limit => 1,
                    p_after_cursor => search_rates(p_limit => 1)->>'next_cursor'
                )->'results'
            ) r
        ) p
    ),
    array[8500.00, 9891.33]::numeric[],
    'cursor round-trip: page1 + page2 yields both fixture rows in price order'
);

-- A cursor pointing past every row returns no results and has_more=false.
-- Defends the "stale cursor that survives a page-2 walk-off" case.
select is(
    jsonb_array_length(
        search_rates(
            p_after_cursor => encode(
                convert_to(
                    jsonb_build_object('p', '99999999.99', 't', 'zzzzzzzzzzzz')::text,
                    'utf8'
                ),
                'base64'
            )
        )->'results'
    ),
    0,
    'cursor past all rows returns empty results'
);

-- ---------------------------------------------------------------------------
-- Cursor validation: malformed cursors are rejected with a stable error code.
-- ---------------------------------------------------------------------------

select is(
    (search_rates(p_after_cursor => 'not-base64!@#')->>'error')::text,
    'invalid_cursor',
    'malformed-base64 cursor rejected'
);

select is(
    (search_rates(p_after_cursor => 'aGVsbG8=')->>'error')::text,
    'invalid_cursor',
    'cursor whose decoded payload is not JSON rejected (base64 of "hello")'
);

select is(
    (search_rates(p_after_cursor => encode(convert_to('{"p":"abc","t":"x"}', 'utf8'), 'base64'))->>'error')::text,
    'invalid_cursor',
    'cursor with non-numeric "p" rejected'
);

select is(
    (search_rates(p_after_cursor => encode(convert_to('{"p":"100"}', 'utf8'), 'base64'))->>'error')::text,
    'invalid_cursor',
    'cursor missing "t" field rejected'
);

select is(
    (search_rates(p_after_cursor => repeat('A', 250))->>'error')::text,
    'invalid_cursor',
    'overlong cursor (>200 chars) rejected without attempting to decode'
);

-- Empty-string cursor is treated as no-cursor (defaults).
select is(
    jsonb_array_length(search_rates(p_after_cursor => '')->'results'),
    jsonb_array_length(search_rates()->'results'),
    'empty-string cursor treated as no-cursor'
);

-- ---------------------------------------------------------------------------
-- Invalid procedure code rejected.
-- ---------------------------------------------------------------------------

select is(
    (search_rates(p_procedure_code => '')->>'error')::text,
    'invalid_procedure_code',
    'empty procedure_code rejected'
);

select is(
    (search_rates(p_procedure_code => 'waytoolongcode')->>'error')::text,
    'invalid_procedure_code',
    'overlong procedure_code rejected'
);

-- ---------------------------------------------------------------------------
-- Unknown procedure returns empty results, not an error.
-- ---------------------------------------------------------------------------

select is(
    jsonb_array_length(search_rates(p_procedure_code => '99999')->'results'),
    0,
    'unknown procedure_code returns empty results (not error)'
);

select * from finish();

rollback;
