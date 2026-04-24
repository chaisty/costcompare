import Papa from 'papaparse';
import { ASC_PROVIDER_TYPE_CODE, ISO_DATE_PATTERN } from '../config.ts';

// Columns we consume from the POS iQIES CSV. The full file has ~170+ columns;
// we only read what we need. Names are the exact lowercase-snake header spellings
// from the Q1 2026 iQIES POS release.
type PosRow = {
  prvdr_num?: string;
  fac_name?: string;
  prvdr_type_id?: string;
  st_adr?: string;
  city_name?: string;
  state_cd?: string;
  zip_cd?: string;
  asc_bgn_srvc_dt?: string;
  trmntn_exprtn_dt?: string;
};

export type FacilityRow = {
  external_id: string;
  name: string;
  facility_type: 'asc';
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

// Parse the POS CSV string and return only rows that look like active ASCs.
// Defense-in-depth filter: require BOTH the ASC provider type code AND a
// non-null `asc_bgn_srvc_dt` — each check alone has edge cases where CMS has
// miscoded rows, but the intersection is reliable.
export function parsePosCsv(csv: string): FacilityRow[] {
  const result = Papa.parse<PosRow>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  // Row-level warnings ("TooFewFields" / "TooManyFields") are common when CMS
  // ships a CSV with a stray malformed line: tolerate those so a single bad
  // row doesn't drop 6,000 good ASCs. Fatal errors (undetectable delimiter,
  // missing quote scope) indicate the whole file is unparseable — abort then.
  const fatalErrors = result.errors.filter(
    (e) => e.code !== 'TooFewFields' && e.code !== 'TooManyFields',
  );
  if (fatalErrors.length > 0) {
    throw new Error(
      `POS CSV fatal parse errors (${fatalErrors.length} total). First few: ${JSON.stringify(fatalErrors.slice(0, 3))}`,
    );
  }
  if (result.errors.length > 0) {
    console.warn(
      `POS CSV: tolerated ${result.errors.length} row-level field-count warning(s) (TooFewFields/TooManyFields). Parsing continues; malformed rows skipped.`,
    );
  }

  const facilities: FacilityRow[] = [];
  for (const row of result.data) {
    if (!isActiveAsc(row)) continue;
    const mapped = mapPosRow(row);
    if (mapped) facilities.push(mapped);
  }
  return facilities;
}

function isActiveAsc(row: PosRow): boolean {
  if (row.prvdr_type_id?.trim() !== ASC_PROVIDER_TYPE_CODE) return false;
  // asc_bgn_srvc_dt is populated for every row, but non-ASCs carry placeholder
  // strings ("Not Applicable"/"Not Available"). Only a date-shaped value means
  // the row is a real ASC with a start-of-service date.
  if (!ISO_DATE_PATTERN.test(row.asc_bgn_srvc_dt ?? '')) return false;
  // Active providers carry a placeholder in trmntn_exprtn_dt; a real ISO date
  // means this ASC has been terminated. Exclude those.
  if (ISO_DATE_PATTERN.test(row.trmntn_exprtn_dt ?? '')) return false;
  return true;
}

function mapPosRow(row: PosRow): FacilityRow | null {
  const external_id = row.prvdr_num?.trim();
  const name = row.fac_name?.trim();
  if (!external_id || !name) return null;

  // DB constraint: state must match /^[A-Z]{2}$/. Drop unexpected values
  // rather than failing the whole batch.
  const state = normalizeState(row.state_cd);

  return {
    external_id,
    name,
    facility_type: 'asc',
    address_line1: row.st_adr?.trim() || null,
    city: row.city_name?.trim() || null,
    state,
    zip: row.zip_cd?.trim() || null,
  };
}

function normalizeState(raw: string | undefined): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}
