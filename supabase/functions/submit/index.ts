// POST /functions/v1/submit
//
// Accepts an anonymous submission, calls the submit_quote RPC with a
// service-role client, and dispatches a Resend confirmation email. The
// plaintext token is returned once by the RPC, embedded in the confirm URL
// sent by email, and never echoed in the HTTP response.
//
// Response contract:
//   200 { ok: true, message: 'Check your email ...' }
//   400 { ok: false, error: '<fixed_code>' }     — validation or RPC error
//   405 { ok: false, error: 'method_not_allowed' }
//   500 { ok: false, error: 'internal_error' }    — unexpected server issue
//
// NEVER include email, submission_id, or the token in any response body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseSubmissionRequest } from './validation.ts';
import { buildConfirmationUrl, type EmailSender, selectEmailSender } from './email.ts';
import { upsertFacilityFromNpi, upsertProviderFromNpi } from './upsert.ts';

type RpcResult =
  | { ok: true; submission_id: string; token: string }
  | { ok: false; error: string };

function isRpcResult(x: unknown): x is RpcResult {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.ok !== 'boolean') return false;
  if (o.ok) {
    return typeof o.submission_id === 'string' && typeof o.token === 'string';
  }
  return typeof o.error === 'string';
}

const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? '';

function corsHeaders(origin: string | null): Record<string, string> {
  // Allow only the configured APP_BASE_URL. Origins that don't match receive
  // no Access-Control-Allow-Origin header; the browser blocks the response.
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

function firstForwardedIp(req: Request): string | null {
  // On hosted Supabase, the platform proxy sets/overwrites X-Forwarded-For
  // so the first hop is the true client IP. When running outside that
  // environment (e.g. self-hosted or `supabase functions serve` exposed
  // directly), a client can spoof XFF and bypass the per-IP rate limit.
  // The per-email limit in the RPC still applies. If we ever self-host, we
  // must front this with a trusted proxy that strips and sets XFF.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip')?.trim();
  return real && real.length > 0 ? real : null;
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

  const parsed = parseSubmissionRequest(rawBody);
  if (!parsed.ok) {
    return json(400, { ok: false, error: parsed.error }, origin);
  }

  const ip = firstForwardedIp(req);
  if (!ip) {
    return json(400, { ok: false, error: 'missing_ip' }, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[submit] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY unset');
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }
  if (!APP_BASE_URL) {
    console.error('[submit] APP_BASE_URL unset');
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }

  let sender: EmailSender;
  try {
    sender = getSender();
  } catch (err) {
    console.error(
      '[submit] email sender init failed:',
      err instanceof Error ? err.message : String(err),
    );
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // If the caller supplied an NPI-shape facility/provider, upsert into our
  // local cache tables and resolve to UUID. Errors here are unexpected (the
  // input is already validated); surface as internal_error.
  let resolvedFacilityId = parsed.data.facility_id;
  let resolvedProviderId = parsed.data.provider_id;
  try {
    if (parsed.data.facility) {
      resolvedFacilityId = await upsertFacilityFromNpi(supabase, parsed.data.facility);
    }
    if (parsed.data.provider) {
      resolvedProviderId = await upsertProviderFromNpi(supabase, parsed.data.provider);
    }
  } catch (err) {
    console.error(
      '[submit] NPI upsert failed:',
      err instanceof Error ? err.message : String(err),
    );
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }

  const { data, error } = await supabase.rpc('submit_quote', {
    p_email: parsed.data.email,
    p_facility_id: resolvedFacilityId,
    p_provider_id: resolvedProviderId,
    p_procedure_codes: parsed.data.procedure_codes,
    p_quoted_price: parsed.data.quoted_price,
    p_quote_year: parsed.data.quote_year,
    p_had_procedure: parsed.data.had_procedure,
    p_submitter_ip: ip,
  });

  if (error) {
    // The PG error message can reveal schema/RPC details — log server-side,
    // return a generic code to the client.
    console.error('[submit] submit_quote RPC error:', error.message);
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }

  if (!isRpcResult(data)) {
    // Shouldn't happen — the RPC always returns a jsonb with an 'ok' field.
    // Guard against a silent future RPC change turning every submission into
    // a half-success that serializes as {"ok":false} with no error code.
    console.error('[submit] unexpected RPC result shape');
    return json(500, { ok: false, error: 'internal_error' }, origin);
  }
  if (!data.ok) {
    return json(400, { ok: false, error: data.error }, origin);
  }

  const confirmUrl = buildConfirmationUrl(APP_BASE_URL, data.token);
  try {
    await sender.sendConfirmation({ to: parsed.data.email, confirmUrl });
  } catch (err) {
    // The submission is already saved with a valid (unused) token. Rolling it
    // back would need a reject_submission round-trip; the email/IP rate limit
    // has already been consumed so the user can't immediately retry. For MVP
    // we log the failure and still return success — the token ages out if
    // never used, and a future resend-confirmation endpoint can recover.
    console.error(
      '[submit] email send failed:',
      err instanceof Error ? err.message : String(err),
    );
  }

  return json(200, { ok: true, message: 'Check your email to confirm your submission.' }, origin);
});
