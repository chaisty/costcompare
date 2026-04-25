import { createReadStream } from 'node:fs';
import Papa from 'papaparse';
import { NPPES_TAXONOMY_PRIORITY, NPPES_TAXONOMY_TO_FACILITY_TYPE } from '../config.ts';

export type FacilityType = 'asc' | 'hospital' | 'medical_center' | 'clinic' | 'other';

export type NppesOrgRow = {
  npi: string;
  name: string;
  facility_type: FacilityType;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

// Headers we read from the NPPES full CSV. The full file has ~330 columns;
// we only read what we need. Keep these as the EXACT header strings published
// by NPPES — Papa header transform lowercases for us, so write the lowercase
// form here.
const HEADER_NPI = 'npi';
const HEADER_ENTITY_TYPE = 'entity type code';
const HEADER_DEACTIVATION = 'npi deactivation date';
const HEADER_ORG_NAME = 'provider organization name (legal business name)';
const HEADER_ADDR1 = 'provider first line business practice location address';
const HEADER_CITY = 'provider business practice location address city name';
const HEADER_STATE = 'provider business practice location address state name';
const HEADER_POSTAL = 'provider business practice location address postal code';
const HEADER_COUNTRY = 'provider business practice location address country code (if outside u.s.)';

function taxonomyHeader(n: number): string {
  return `healthcare provider taxonomy code_${n}`;
}

const TAXONOMY_HEADERS: string[] = Array.from({ length: 15 }, (_, i) => taxonomyHeader(i + 1));

export type ParseStats = {
  rowsScanned: number;
  rowsMatched: number;
};

export async function parseNppesOrgsStream(
  path: string,
  onRow: (row: NppesOrgRow) => void,
): Promise<ParseStats> {
  const stream = createReadStream(path, { encoding: 'utf-8' });
  let rowsScanned = 0;
  let rowsMatched = 0;

  await new Promise<void>((resolve, reject) => {
    Papa.parse<Record<string, string>>(stream, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/ /g, ' '),
      step: (result) => {
        rowsScanned += 1;
        const mapped = mapNppesRow(result.data);
        if (mapped) {
          rowsMatched += 1;
          onRow(mapped);
        }
      },
      complete: () => resolve(),
      error: (err) => reject(err),
    });
  });

  return { rowsScanned, rowsMatched };
}

// Classify and project a raw NPPES row. Returns null if the row is filtered
// out (wrong entity type, deactivated, no relevant taxonomy, missing required
// fields, or non-US).
export function mapNppesRow(row: Record<string, string>): NppesOrgRow | null {
  // Type-2 (organizations) only. Type-1 (individuals) are not facilities.
  if (row[HEADER_ENTITY_TYPE]?.trim() !== '2') return null;

  // Deactivated NPIs are kept in the file as historical record; skip them.
  // The deactivation column is empty for active providers, populated with a
  // date string for deactivated ones.
  if (row[HEADER_DEACTIVATION]?.trim()) return null;

  // US only. The country column is empty for US addresses (it's "if outside
  // U.S.") so non-empty here = non-US.
  if (row[HEADER_COUNTRY]?.trim()) return null;

  const facilityType = classifyTaxonomies(row);
  if (!facilityType) return null;

  const npi = row[HEADER_NPI]?.trim();
  const name = row[HEADER_ORG_NAME]?.trim();
  if (!npi || npi.length !== 10 || !/^\d{10}$/.test(npi)) return null;
  if (!name) return null;

  return {
    npi,
    name,
    facility_type: facilityType,
    address_line1: row[HEADER_ADDR1]?.trim() || null,
    city: row[HEADER_CITY]?.trim() || null,
    state: normalizeState(row[HEADER_STATE]),
    zip: row[HEADER_POSTAL]?.trim() || null,
  };
}

// Walk all 15 taxonomy slots; return the highest-priority facility_type the
// row's taxonomies map to. Priority order is hospital > asc > clinic so that
// e.g. a "Surgical Specialty Hospital" with an ASC subsidiary taxonomy is
// classified as 'hospital'. Mirrors the order-sensitivity in the submit
// Edge Function's mapTaxonomyToFacilityType.
function classifyTaxonomies(row: Record<string, string>): FacilityType | null {
  let best: FacilityType | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const header of TAXONOMY_HEADERS) {
    const code = row[header]?.trim().toUpperCase();
    if (!code) continue;
    const mapped = NPPES_TAXONOMY_TO_FACILITY_TYPE[code];
    if (!mapped) continue;
    const rank = NPPES_TAXONOMY_PRIORITY.indexOf(mapped);
    if (rank < bestRank) {
      best = mapped;
      bestRank = rank;
    }
  }
  return best;
}

function normalizeState(raw: string | undefined): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}
