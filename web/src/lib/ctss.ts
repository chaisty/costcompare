// NLM Clinical Table Search Service (CTSS) — autocomplete-friendly NPI lookup.
// https://clinicaltables.nlm.nih.gov/apidoc/npi_idv/v3/doc.html
// https://clinicaltables.nlm.nih.gov/apidoc/npi_org/v3/doc.html
//
// CTSS responds with a tuple-of-arrays format:
//   [ totalCount, [npi1, npi2, ...], extra, [[col1, col2, ...], ...], highlight ]
// We pin the `df` parameter so the inner row layout is stable and parse-able.

export type CtssOrganization = {
  npi: string;
  name: string;
  city: string | null;
  state: string | null;
  taxonomy: string | null;
};

export type CtssProvider = {
  npi: string;
  first_name: string;
  last_name: string;
  practice_city: string | null;
  practice_state: string | null;
  taxonomy: string | null;
};

const ORG_URL = 'https://clinicaltables.nlm.nih.gov/api/npi_org/v3/search';
const IDV_URL = 'https://clinicaltables.nlm.nih.gov/api/npi_idv/v3/search';

const ORG_FIELDS = [
  'NPI',
  'name.full',
  'addr_practice.city',
  'addr_practice.state',
  'provider_type',
];
const IDV_FIELDS = [
  'NPI',
  'name.last',
  'name.first',
  'addr_practice.city',
  'addr_practice.state',
  'provider_type',
];

type CtssRaw = [number, string[], unknown, (string | null)[][], unknown?];

function nullable(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const s = v.trim();
  return s.length === 0 ? null : s;
}

async function fetchCtss(
  url: string,
  query: string,
  fields: string[],
  signal?: AbortSignal,
): Promise<CtssRaw> {
  const params = new URLSearchParams({
    terms: query,
    df: fields.join(','),
    maxList: '10',
  });
  const res = await fetch(`${url}?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`CTSS ${res.status}`);
  }
  const json = (await res.json()) as CtssRaw;
  if (!Array.isArray(json) || json.length < 4) {
    throw new Error('CTSS unexpected payload');
  }
  return json;
}

export async function searchCtssOrganizations(
  query: string,
  signal?: AbortSignal,
): Promise<CtssOrganization[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const raw = await fetchCtss(ORG_URL, trimmed, ORG_FIELDS, signal);
  const rows = raw[3] ?? [];
  return rows.map((row) => ({
    npi: row[0] ?? '',
    name: row[1] ?? '',
    city: nullable(row[2]),
    state: nullable(row[3]),
    taxonomy: nullable(row[4]),
  }));
}

export async function searchCtssProviders(
  query: string,
  signal?: AbortSignal,
): Promise<CtssProvider[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const raw = await fetchCtss(IDV_URL, trimmed, IDV_FIELDS, signal);
  const rows = raw[3] ?? [];
  return rows.map((row) => ({
    npi: row[0] ?? '',
    last_name: row[1] ?? '',
    first_name: row[2] ?? '',
    practice_city: nullable(row[3]),
    practice_state: nullable(row[4]),
    taxonomy: nullable(row[5]),
  }));
}
