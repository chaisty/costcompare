import Papa from 'papaparse';
import {
  ASC_FEE_SCHEDULE_YEAR,
  NATIONAL_UNADJUSTED_LOCALITY,
  TARGET_PROCEDURE_CODES,
} from '../config.ts';

// The Addendum AA CSV has:
//   - 4 header rows (title, AMA copyright, blank, header) before the data
//   - An empty column between "HCPCS Code" and "Short Descriptor"
//   - Column names with erratic whitespace (double spaces, trailing spaces)
// We normalize headers via `transformHeader` and skip the first 4 lines
// before handing the rest to papaparse.

export type MedicareRateRow = {
  rate_type: 'medicare';
  procedure_codes: string[];
  price: number;
  rate_year: number;
  locality: string;
  source_url: string;
  source_fetched_at: string;
};

type AddendumRow = {
  hcpcs_code?: string;
  short_descriptor?: string;
  subject_to_multiple_procedure_discounting?: string;
  payment_indicator?: string;
  payment_weight?: string;
  payment_rate?: string;
};

export type ParseOptions = {
  sourceUrl: string;
  fetchedAt: string;
};

export function parseAddendumAa(csv: string, options: ParseOptions): MedicareRateRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 5) {
    throw new Error(`Addendum AA CSV is unexpectedly short (${lines.length} lines)`);
  }
  // Drop the 4 preamble rows; row 5 (index 4) is the column header.
  const dataCsv = lines.slice(4).join('\n');

  const result = Papa.parse<AddendumRow>(dataCsv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h, i) => normalizeHeader(h, i),
  });

  if (result.errors.length > 0) {
    const firstThree = result.errors.slice(0, 3);
    throw new Error(
      `Addendum AA parse errors (${result.errors.length} total). First few: ${JSON.stringify(firstThree)}`,
    );
  }

  const targets = new Set<string>(TARGET_PROCEDURE_CODES);
  const rows: MedicareRateRow[] = [];
  for (const row of result.data) {
    const code = row.hcpcs_code?.trim();
    if (!code || !targets.has(code)) continue;

    const price = parsePriceString(row.payment_rate);
    if (price === null) {
      // Packaged indicators (N1, Z2, etc.) have blank rates — CMS does not
      // separately pay for them. Skip rather than store zero.
      continue;
    }

    rows.push({
      rate_type: 'medicare',
      procedure_codes: [code],
      price,
      rate_year: ASC_FEE_SCHEDULE_YEAR,
      locality: NATIONAL_UNADJUSTED_LOCALITY,
      source_url: options.sourceUrl,
      source_fetched_at: options.fetchedAt,
    });
  }

  return rows;
}

function normalizeHeader(raw: string, index: number): string {
  // Collapse internal whitespace, trim, strip leading release prefixes
  // like "April 2026 " so the mapping is release-agnostic, lower-snake_case.
  // Empty columns (CMS ships one between HCPCS Code and Short Descriptor)
  // get a positional name so they don't collide on "" and trip papaparse
  // into renaming real columns as duplicates.
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return `_col${index}`;
  const withoutReleasePrefix = compact.replace(/^[A-Za-z]+\s+\d{4}\s+/, '');
  return withoutReleasePrefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parsePriceString(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Round to 2 decimals to match numeric(10, 2) in the DB.
  return Math.round(n * 100) / 100;
}
