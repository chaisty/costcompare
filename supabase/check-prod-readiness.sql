-- Prod readiness check. Run in the Supabase dashboard SQL editor BEFORE
-- go-live and whenever you suspect prod config has drifted.
--
-- Every row in the output should be 'ok'. Any 'fail' is a blocker.

with checks as (

    -- app.ip_pepper must be set to a real secret, not the dev fallback or empty.
    select
        'ip_pepper_is_not_dev_fallback' as check_name,
        case
            when current_setting('app.ip_pepper', true) is null then 'fail: app.ip_pepper is unset'
            when current_setting('app.ip_pepper', true) = '' then 'fail: app.ip_pepper is empty'
            when current_setting('app.ip_pepper', true) = 'dev-pepper-do-not-use-in-prod'
                then 'fail: app.ip_pepper is still the dev fallback; set a real secret via `alter database postgres set app.ip_pepper = ''<secret>'';`'
            when length(current_setting('app.ip_pepper', true)) < 32
                then 'fail: app.ip_pepper is shorter than 32 chars; use `openssl rand -hex 32` or similar'
            else 'ok'
        end as status

    union all

    -- RLS must be enabled on every table.
    select
        'rls_enabled_on_all_tables',
        case
            when exists (
                select 1 from pg_tables
                where schemaname = 'public'
                  and tablename in ('procedures', 'facilities', 'rates', 'submissions')
                  and rowsecurity = false
            )
            then 'fail: at least one public table has RLS disabled'
            else 'ok'
        end

    union all

    -- Private helpers must not be executable by anon.
    select
        'anon_cannot_execute_ip_pepper',
        case
            when has_function_privilege('anon', 'public._ip_pepper()', 'EXECUTE')
            then 'fail: anon has EXECUTE on _ip_pepper; this leaks the pepper over PostgREST'
            else 'ok'
        end

    union all

    select
        'anon_cannot_execute_hash_submitter_ip',
        case
            when has_function_privilege('anon', 'public._hash_submitter_ip(inet)', 'EXECUTE')
            then 'fail: anon has EXECUTE on _hash_submitter_ip'
            else 'ok'
        end

    union all

    -- anon MUST NOT have submit_quote or reject_submission; MUST have confirm_submission and search_rates.
    select
        'anon_cannot_execute_submit_quote',
        case
            when has_function_privilege(
                'anon',
                'public.submit_quote(text, uuid, text[], numeric, int, boolean, inet)',
                'EXECUTE'
            )
            then 'fail: anon has EXECUTE on submit_quote; submissions must go through the Edge Function (service role)'
            else 'ok'
        end

    union all

    select
        'anon_cannot_execute_reject_submission',
        case
            when has_function_privilege('anon', 'public.reject_submission(uuid)', 'EXECUTE')
            then 'fail: anon has EXECUTE on reject_submission'
            else 'ok'
        end

    union all

    select
        'anon_has_confirm_submission',
        case
            when not has_function_privilege('anon', 'public.confirm_submission(text)', 'EXECUTE')
            then 'fail: anon lacks EXECUTE on confirm_submission; the /confirm landing page cannot work'
            else 'ok'
        end

    union all

    select
        'anon_has_search_rates',
        case
            when not has_function_privilege(
                'anon',
                'public.search_rates(text, text, rate_type, int, int, int, int)',
                'EXECUTE'
            )
            then 'fail: anon lacks EXECUTE on search_rates; the / page cannot render results'
            else 'ok'
        end

    union all

    -- Intracept seed row must be present.
    select
        'intracept_seeded',
        case
            when not exists (select 1 from procedures where primary_code = '64628')
            then 'fail: procedures seed (CPT 64628) is missing'
            else 'ok'
        end

    union all

    -- No email column leaked onto rates.
    select
        'rates_has_no_email_column',
        case
            when exists (
                select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'rates' and column_name = 'email'
            )
            then 'fail: rates has an email column; this is the no-email-leak invariant breaking'
            else 'ok'
        end

)

select check_name, status
from checks
order by
    case when status = 'ok' then 1 else 0 end,  -- failures first
    check_name;
