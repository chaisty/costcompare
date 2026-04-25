// Structural (type-level) validation of the incoming JSON body. Semantic
// validation (email format, price/year ranges, facility/provider existence)
// is owned by the submit_quote RPC — do not duplicate it here.
//
// Two input shapes are accepted for facility/provider:
//   - UUID shape:  { facility_id: '<uuid>' }  (pre-#13 callers, backward compat)
//   - NPI shape:   { facility: { npi, name, ... } } and / or
//                  { provider: { npi, first_name, last_name, ... } }
// The handler resolves either shape to a UUID before calling submit_quote.

export type FacilityNpiInput = {
  npi: string;
  name: string;
  city: string | null;
  state: string | null;
  taxonomy_label: string | null;
};

export type ProviderNpiInput = {
  npi: string;
  first_name: string;
  last_name: string;
  credential: string | null;
  practice_city: string | null;
  practice_state: string | null;
  taxonomy_code: string | null;
  taxonomy_label: string | null;
};

export type SubmissionInput = {
  email: string;
  facility_id: string | null;
  provider_id: string | null;
  facility: FacilityNpiInput | null;
  provider: ProviderNpiInput | null;
  procedure_codes: string[];
  quoted_price: number;
  quote_year: number;
  had_procedure: boolean;
};

export type ParseResult =
  | { ok: true; data: SubmissionInput }
  | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NPI_PATTERN = /^\d{10}$/;
const STATE_PATTERN = /^[A-Z]{2}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown, max: number): string | null | 'invalid' {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return 'invalid';
  const s = v.trim();
  if (s.length === 0) return null;
  if (s.length > max) return 'invalid';
  return s;
}

function parseFacility(v: unknown): FacilityNpiInput | 'invalid' {
  if (!isObject(v)) return 'invalid';
  if (typeof v.npi !== 'string' || !NPI_PATTERN.test(v.npi)) return 'invalid';
  if (typeof v.name !== 'string' || v.name.trim().length === 0 || v.name.length > 200) {
    return 'invalid';
  }
  const city = optionalString(v.city, 120);
  if (city === 'invalid') return 'invalid';
  const stateRaw = optionalString(v.state, 2);
  if (stateRaw === 'invalid') return 'invalid';
  const state = stateRaw === null ? null : stateRaw.toUpperCase();
  if (state !== null && !STATE_PATTERN.test(state)) return 'invalid';
  const taxonomy_label = optionalString(v.taxonomy_label, 200);
  if (taxonomy_label === 'invalid') return 'invalid';
  return { npi: v.npi, name: v.name.trim(), city, state, taxonomy_label };
}

function parseProvider(v: unknown): ProviderNpiInput | 'invalid' {
  if (!isObject(v)) return 'invalid';
  if (typeof v.npi !== 'string' || !NPI_PATTERN.test(v.npi)) return 'invalid';
  if (typeof v.first_name !== 'string' || v.first_name.trim().length === 0) return 'invalid';
  if (typeof v.last_name !== 'string' || v.last_name.trim().length === 0) return 'invalid';
  const credential = optionalString(v.credential, 60);
  if (credential === 'invalid') return 'invalid';
  const practice_city = optionalString(v.practice_city, 120);
  if (practice_city === 'invalid') return 'invalid';
  const practice_stateRaw = optionalString(v.practice_state, 2);
  if (practice_stateRaw === 'invalid') return 'invalid';
  const practice_state = practice_stateRaw === null ? null : practice_stateRaw.toUpperCase();
  if (practice_state !== null && !STATE_PATTERN.test(practice_state)) return 'invalid';
  const taxonomy_code = optionalString(v.taxonomy_code, 32);
  if (taxonomy_code === 'invalid') return 'invalid';
  const taxonomy_label = optionalString(v.taxonomy_label, 200);
  if (taxonomy_label === 'invalid') return 'invalid';
  return {
    npi: v.npi,
    first_name: v.first_name.trim(),
    last_name: v.last_name.trim(),
    credential,
    practice_city,
    practice_state,
    taxonomy_code,
    taxonomy_label,
  };
}

export function parseSubmissionRequest(body: unknown): ParseResult {
  if (!isObject(body)) return { ok: false, error: 'invalid_body' };
  const b = body;

  if (typeof b.email !== 'string' || b.email.length === 0 || b.email.length > 254) {
    return { ok: false, error: 'invalid_email' };
  }

  // Facility: either UUID (legacy) or NPI object (new), but not both shapes
  // for the same axis. (A UUID-form facility + an NPI-form provider, or vice
  // versa, is allowed — the cross-axis combination is what `at-least-one`
  // permits.)
  let facility_id: string | null = null;
  let facility: FacilityNpiInput | null = null;
  if (b.facility_id !== undefined && b.facility_id !== null) {
    if (typeof b.facility_id !== 'string' || !UUID_PATTERN.test(b.facility_id)) {
      return { ok: false, error: 'unknown_facility' };
    }
    facility_id = b.facility_id;
  }
  if (b.facility !== undefined && b.facility !== null) {
    if (facility_id !== null) return { ok: false, error: 'invalid_body' };
    const f = parseFacility(b.facility);
    if (f === 'invalid') return { ok: false, error: 'unknown_facility' };
    facility = f;
  }

  let provider_id: string | null = null;
  let provider: ProviderNpiInput | null = null;
  if (b.provider_id !== undefined && b.provider_id !== null) {
    if (typeof b.provider_id !== 'string' || !UUID_PATTERN.test(b.provider_id)) {
      return { ok: false, error: 'unknown_provider' };
    }
    provider_id = b.provider_id;
  }
  if (b.provider !== undefined && b.provider !== null) {
    if (provider_id !== null) return { ok: false, error: 'invalid_body' };
    const p = parseProvider(b.provider);
    if (p === 'invalid') return { ok: false, error: 'unknown_provider' };
    provider = p;
  }

  if (
    facility_id === null &&
    facility === null &&
    provider_id === null &&
    provider === null
  ) {
    return { ok: false, error: 'missing_provider_or_facility' };
  }

  if (
    !Array.isArray(b.procedure_codes) ||
    b.procedure_codes.length === 0 ||
    !b.procedure_codes.every((c) => typeof c === 'string' && c.length > 0)
  ) {
    return { ok: false, error: 'invalid_procedure_codes' };
  }
  if (
    typeof b.quoted_price !== 'number' ||
    !Number.isFinite(b.quoted_price) ||
    b.quoted_price < 0.01 ||
    b.quoted_price > 99_999_999.99
  ) {
    return { ok: false, error: 'invalid_price' };
  }
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
      facility,
      provider_id,
      provider,
      procedure_codes: b.procedure_codes as string[],
      quoted_price: b.quoted_price,
      quote_year: b.quote_year,
      had_procedure: b.had_procedure,
    },
  };
}
