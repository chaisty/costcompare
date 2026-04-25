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
  | 'unknown_provider'
  | 'missing_provider_or_facility'
  | 'rate_limited_email'
  | 'rate_limited_ip'
  | 'internal_error';

export type SubmitFacilityNpi = {
  npi: string;
  name: string;
  city: string | null;
  state: string | null;
  taxonomy_label: string | null;
};

export type SubmitProviderNpi = {
  npi: string;
  first_name: string;
  last_name: string;
  credential: string | null;
  practice_city: string | null;
  practice_state: string | null;
  taxonomy_code: string | null;
  taxonomy_label: string | null;
};

export type SubmitRequest = {
  email: string;
  facility?: SubmitFacilityNpi;
  provider?: SubmitProviderNpi;
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

// ---------------------------------------------------------------------------
// resend-confirmation Edge Function. Always returns a vague success message;
// the response shape does NOT distinguish "we resent" from "no pending
// submission for that email" — that's the privacy posture.
// ---------------------------------------------------------------------------

export type ResendErrorCode =
  | 'invalid_email'
  | 'invalid_body'
  | 'resend_limit_exceeded'
  | 'internal_error';

export type ResendResult =
  | { ok: true; message: string }
  | { ok: false; error: ResendErrorCode | 'unknown' };

export async function resendConfirmation(email: string): Promise<ResendResult> {
  const { data, error } = await supabase.functions.invoke('resend-confirmation', {
    body: { email },
  });
  if (error) {
    const response = (error as { context?: { response?: Response } }).context?.response;
    if (response) {
      const parsed = (await response.json().catch(() => null)) as {
        ok: false;
        error?: string;
      } | null;
      if (parsed && parsed.ok === false && parsed.error) {
        return { ok: false, error: parsed.error as ResendErrorCode };
      }
    }
    return { ok: false, error: 'unknown' };
  }
  if (data && typeof data === 'object' && 'ok' in data) {
    const d = data as { ok: boolean; message?: string; error?: string };
    if (d.ok) return { ok: true, message: d.message ?? '' };
    return { ok: false, error: (d.error ?? 'unknown') as ResendErrorCode };
  }
  return { ok: false, error: 'unknown' };
}

export type ConfirmErrorCode = 'invalid_token' | 'already_confirmed' | 'rejected' | 'token_expired';

export type ConfirmResult = { ok: true } | { ok: false; error: ConfirmErrorCode };

// ---------------------------------------------------------------------------
// search_rates RPC. Called from the public SearchPage. Returned shape mirrors
// the jsonb allowlist in the migration — keep this in sync if the migration
// changes. (No `id` by design; no `source_submission_id`; no `email`.)
// ---------------------------------------------------------------------------

export type RateType = 'cash' | 'medicare' | 'negotiated';

export type SearchedRate = {
  rate_type: RateType;
  price: number | string;
  rate_year: number;
  procedure_codes: string[];
  facility_id: string | null;
  facility_name: string | null;
  facility_state: string | null;
  facility_external_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_credential: string | null;
  provider_specialty: string | null;
  provider_state: string | null;
  locality: string | null;
  payer: string | null;
  plan_variant: string | null;
  source_url: string | null;
  source_fetched_at: string | null;
  confidence_note: string | null;
};

export type SearchRatesOptions = {
  procedure_code?: string;
  state?: string;
  rate_type?: RateType;
  year_from?: number;
  year_to?: number;
  limit?: number;
  offset?: number;
};

export type SearchRatesResult = {
  ok: true;
  results: SearchedRate[];
  limit: number;
  offset: number;
  has_more: boolean;
};

export type SearchRatesError = { ok: false; error: string };

export async function searchRates(
  opts: SearchRatesOptions = {},
): Promise<SearchRatesResult | SearchRatesError> {
  const params: Record<string, unknown> = {};
  if (opts.procedure_code) params.p_procedure_code = opts.procedure_code;
  if (opts.state) params.p_state = opts.state;
  if (opts.rate_type) params.p_rate_type = opts.rate_type;
  if (opts.year_from !== undefined) params.p_year_from = opts.year_from;
  if (opts.year_to !== undefined) params.p_year_to = opts.year_to;
  if (opts.limit !== undefined) params.p_limit = opts.limit;
  if (opts.offset !== undefined) params.p_offset = opts.offset;

  const { data, error } = await supabase.rpc('search_rates', params);
  if (error) throw error;
  if (!data || typeof data !== 'object' || !('ok' in data)) {
    throw new Error('Unexpected search_rates payload');
  }
  const d = data as {
    ok: boolean;
    results?: SearchedRate[];
    limit?: number;
    offset?: number;
    has_more?: boolean;
    error?: string;
  };
  if (d.ok) {
    return {
      ok: true,
      results: d.results ?? [],
      limit: d.limit ?? 50,
      offset: d.offset ?? 0,
      has_more: Boolean(d.has_more),
    };
  }
  return { ok: false, error: d.error ?? 'unknown' };
}

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
