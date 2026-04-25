// POST /functions/v1/resend-confirmation
//
// Re-sends the confirmation email for the most recent pending submission
// that matches the supplied email. Closes the email-failure-after-RPC-success
// gap from issue #3 (when Resend's send fails after submit_quote saves the
// submission, the rate-limit slot is consumed but no email arrives — the user
// is stuck without this endpoint).
//
// Privacy posture: vague success regardless of whether a matching submission
// exists. A caller cannot distinguish "no pending submission for this email"
// from "we resent the link." Same trust model as confirm_submission (anon,
// token-gated downstream).
//
// Response contract:
//   200 { ok: true, message: 'If an unconfirmed submission exists for that email, we sent it again.' }
//   400 { ok: false, error: 'invalid_email' | 'invalid_body' | 'resend_limit_exceeded' }
//   405 { ok: false, error: 'method_not_allowed' }
//   500 { ok: false, error: 'internal_error' }
//
// NEVER include email, submission_id, or token in any response body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildConfirmationUrl,
  type EmailSender,
  selectEmailSender,
} from '../submit/email.ts';

type RpcResult =
  | { ok: true; sent: true; token: string; submission_id: string }
  | { ok: true; sent: false }
  | { ok: false; error: string };

function isRpcResult(x: unknown): x is RpcResult {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.ok !== 'boolean') return false;
  if (o.ok) {
    if (o.sent === false) return true;
    if (o.sent === true) {
      return typeof o.token === 'string' && typeof o.submission_id === 'string';
    }
    return false;
  }
  return typeof o.error === 'string';
}

const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? '';
const VAGUE_SUCCESS_MESSAGE =
  'If an unconfirmed submission exists for that email, we sent the confirmation link again.';

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (APP_BASE_URL && origin && origin === APP_BASE_URL) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  });
}

function parseEmail(body: unknown): string | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'invalid_body' };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.email !== 'string' || b.email.length === 0 || b.email.length > 254) {
    return { error: 'invalid_email' };
  }
  return b.email;
}

let _sender: EmailSender | null = null;
function getSender(): EmailSender {
  if (!_sender) {
    _sender = selectEmailSender({
      resendApiKey: Deno.env.get('RESEND_API_KEY'),
      resendFrom: Deno.env.get('RESEND_FROM_EMAIL'),
      emailMode: Deno.env.get('EMAIL_MODE'),
    });
  }
  return _sender;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' }, origin);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_body' }, origin);
  }

  const parsed = parseEmail(rawBody);
  if (typeof parsed !== 'string') {
    return json(400, { ok: false, error: parsed.error }, origin);
  }
  const email = parsed;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[resend] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY unset');
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }
  if (!APP_BASE_URL) {
    console.error('[resend] APP_BASE_URL unset');
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }

  let sender: EmailSender;
  try {
    sender = getSender();
  } catch (err) {
    console.error(
      '[resend] email sender init failed:',
      err instanceof Error ? err.message : String(err),
    );
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('resend_confirmation_token', { p_email: email });
  if (error) {
    console.error('[resend] RPC error:', error.message);
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }
  if (!isRpcResult(data)) {
    console.error('[resend] unexpected RPC payload');
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }
  if (!data.ok) {
    // resend_limit_exceeded is the only client-actionable RPC failure;
    // invalid_email is caught at the edge above. Pass through verbatim.
    return json(400, { ok: false, error: data.error }, origin);
  }

  // data.ok === true. If sent === true, dispatch the email; if sent === false,
  // we still return the same vague success message — a caller cannot tell the
  // two branches apart.
  if (data.sent) {
    const confirmUrl = buildConfirmationUrl(APP_BASE_URL, data.token);
    try {
      await sender.sendConfirmation({ to: email, confirmUrl });
    } catch (err) {
      console.error(
        '[resend] email send failed:',
        err instanceof Error ? err.message : String(err),
      );
      // Same fail-soft policy as submit/. Token has been rotated; the next
      // resend attempt will mint a fresh one.
    }
  }

  return json(200, { ok: true, message: VAGUE_SUCCESS_MESSAGE }, origin);
});
