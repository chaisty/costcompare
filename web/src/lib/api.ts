import { supabase } from './supabase';

export type SubmitErrorCode =
  | 'invalid_body'
  | 'invalid_email'
  | 'invalid_price'
  | 'invalid_year'
  | 'invalid_procedure_codes'
  | 'missing_had_procedure'
  | 'missing_ip'
  | 'unknown_facility'
  | 'rate_limited_email'
  | 'rate_limited_ip'
  | 'internal_error';

export type SubmitRequest = {
  email: string;
  facility_id: string;
  procedure_codes: string[];
  quoted_price: number;
  quote_year: number;
  had_procedure: boolean;
};

export type SubmitResult =
  | { ok: true; message: string }
  | { ok: false; error: SubmitErrorCode | 'unknown' };

export async function submitQuote(input: SubmitRequest): Promise<SubmitResult> {
  const { data, error } = await supabase.functions.invoke('submit', { body: input });
  if (error) {
    // supabase-js wraps non-2xx responses in an error. The Edge Function
    // always returns JSON with { ok, error }, so parse the underlying body
    // when we can; fall through to 'unknown' for network/transport failures.
    const response = (error as { context?: { response?: Response } }).context?.response;
    if (response) {
      const parsed = (await response.json().catch(() => null)) as {
        ok: false;
        error?: string;
      } | null;
      if (parsed && parsed.ok === false && parsed.error) {
        return { ok: false, error: parsed.error as SubmitErrorCode };
      }
    }
    return { ok: false, error: 'unknown' };
  }
  if (data && typeof data === 'object' && 'ok' in data) {
    const d = data as { ok: boolean; message?: string; error?: string };
    if (d.ok) {
      return { ok: true, message: d.message ?? '' };
    }
    return { ok: false, error: (d.error ?? 'unknown') as SubmitErrorCode };
  }
  return { ok: false, error: 'unknown' };
}

export type ConfirmErrorCode = 'invalid_token' | 'already_confirmed' | 'rejected' | 'token_expired';

export type ConfirmResult = { ok: true } | { ok: false; error: ConfirmErrorCode };

export async function confirmSubmission(token: string): Promise<ConfirmResult> {
  const { data, error } = await supabase.rpc('confirm_submission', { p_token: token });
  if (error) {
    // The RPC never raises for the expected error vocabulary (it returns
    // { ok: false, error: '...' } inside the jsonb payload). If supabase-js
    // surfaces a PostgREST error here, treat it as a generic failure so the
    // UI can fall through to the network-error state rather than crashing.
    throw error;
  }
  if (data && typeof data === 'object' && 'ok' in data) {
    const d = data as { ok: boolean; error?: string };
    if (d.ok) return { ok: true };
    return { ok: false, error: (d.error ?? 'invalid_token') as ConfirmErrorCode };
  }
  throw new Error('Unexpected confirm_submission payload');
}
