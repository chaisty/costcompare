-- Resend confirmation flow.
--
-- Closes the email-failure-after-RPC-success gap from issue #3's diary: when
-- Resend's send fails after submit_quote saved the submission, the rate-limit
-- slot is consumed but no email arrives. The user is stuck. This RPC lets the
-- Edge Function regenerate the token + re-send the email.
--
-- Privacy: anonymous resend cannot leak whether an email has a pending
-- submission, so the RPC's "no match" branch returns ok=true, sent=false,
-- and the Edge Function always returns the same 200 message regardless.

alter table submissions
    add column resend_count int not null default 0;

create function resend_confirmation_token(p_email text) returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
    as $$
declare
    v_submission submissions%rowtype;
    v_new_token text;
    v_new_token_hash text;
    v_new_expires_at timestamptz;
    c_max_resends constant int := 3;
begin
    if p_email is null
       or length(p_email) > 254
       or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        return jsonb_build_object('ok', false, 'error', 'invalid_email');
    end if;

    -- Most recent pending non-expired submission for this email. FOR UPDATE
    -- so a concurrent confirm doesn't race the token rotation here.
    select * into v_submission
    from submissions
    where email = lower(p_email)
      and submission_status = 'pending'
      and token_expires_at > now()
    order by created_at desc
    limit 1
    for update;

    if not found then
        -- Vague success: same response shape as a hit, so a caller can't
        -- distinguish "no submission for this email" from "we resent it."
        return jsonb_build_object('ok', true, 'sent', false);
    end if;

    if v_submission.resend_count >= c_max_resends then
        return jsonb_build_object('ok', false, 'error', 'resend_limit_exceeded');
    end if;

    v_new_token := encode(gen_random_bytes(32), 'hex');
    v_new_token_hash := encode(digest(v_new_token, 'sha256'), 'hex');
    v_new_expires_at := now() + interval '48 hours';

    update submissions
    set token_hash = v_new_token_hash,
        token_expires_at = v_new_expires_at,
        resend_count = resend_count + 1
    where id = v_submission.id;

    return jsonb_build_object(
        'ok', true,
        'sent', true,
        'token', v_new_token,
        'submission_id', v_submission.id
    );
end;
$$;

revoke all on function resend_confirmation_token(text) from public, anon, authenticated;
grant execute on function resend_confirmation_token(text) to service_role;
