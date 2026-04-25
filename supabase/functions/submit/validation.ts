// Structural (type-level) validation of the incoming JSON body. Semantic
// validation (email format, price/year ranges, facility/provider existence)
// is owned by the submit_quote RPC — do not duplicate it here.

export type SubmissionInput = {
  email: string;
  facility_id: string | null;
  provider_id: string | null;
  procedure_codes: string[];
  quoted_price: number;
  quote_year: number;
  had_procedure: boolean;
};

export type ParseResult =
  | { ok: true; data: SubmissionInput }
  | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSubmissionRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.email !== 'string' || b.email.length === 0 || b.email.length > 254) {
    return { ok: false, error: 'invalid_email' };
  }

  // facility_id is now optional (either a valid UUID string or null/absent).
  // Malformed UUIDs and unknown-but-valid UUIDs collapse to `unknown_facility`
  // at the edge; from the submitter's perspective both mean "pick a facility
  // from the list, it didn't match anything on the server."
  let facility_id: string | null = null;
  if (b.facility_id !== undefined && b.facility_id !== null) {
    if (typeof b.facility_id !== 'string' || !UUID_PATTERN.test(b.facility_id)) {
      return { ok: false, error: 'unknown_facility' };
    }
    facility_id = b.facility_id;
  }

  // provider_id is also optional. Same malformed-UUID → `unknown_provider`
  // collapse as for facility.
  let provider_id: string | null = null;
  if (b.provider_id !== undefined && b.provider_id !== null) {
    if (typeof b.provider_id !== 'string' || !UUID_PATTERN.test(b.provider_id)) {
      return { ok: false, error: 'unknown_provider' };
    }
    provider_id = b.provider_id;
  }

  // At-least-one is a structural check so the RPC never has to reject a
  // payload that's missing both. RPC enforces it as a second line of defense.
  if (facility_id === null && provider_id === null) {
    return { ok: false, error: 'missing_provider_or_facility' };
  }

  if (
    !Array.isArray(b.procedure_codes) ||
    b.procedure_codes.length === 0 ||
    !b.procedure_codes.every((c) => typeof c === 'string' && c.length > 0)
  ) {
    return { ok: false, error: 'invalid_procedure_codes' };
  }
  // Bounds match the DB column (numeric(10,2) ≤ 99999999.99) so an oversized
  // price is rejected here with `invalid_price` instead of bubbling up as a
  // numeric-overflow -> internal_error at RPC time.
  if (
    typeof b.quoted_price !== 'number' ||
    !Number.isFinite(b.quoted_price) ||
    b.quoted_price < 0.01 ||
    b.quoted_price > 99_999_999.99
  ) {
    return { ok: false, error: 'invalid_price' };
  }
  // Intentionally looser than the RPC's `<= current UTC year` — the RPC owns
  // the tight upper bound (it has access to `now()`). Edge bounds catch
  // nonsense values (year 0, year 9999).
  if (
    typeof b.quote_year !== 'number' ||
    !Number.isInteger(b.quote_year) ||
    b.quote_year < 2000 ||
    b.quote_year > 2100
  ) {
    return { ok: false, error: 'invalid_year' };
  }
  if (typeof b.had_procedure !== 'boolean') {
    return { ok: false, error: 'missing_had_procedure' };
  }

  return {
    ok: true,
    data: {
      email: b.email,
      facility_id,
      provider_id,
      procedure_codes: b.procedure_codes as string[],
      quoted_price: b.quoted_price,
      quote_year: b.quote_year,
      had_procedure: b.had_procedure,
    },
  };
}
