// CMS download URLs and ETL constants. Bump the dated URLs when CMS publishes
// a new quarterly release; the upserts are idempotent and will update in place.
// See README.md for the landing pages to discover new URLs.

export const POS_CSV_URL =
  'https://data.cms.gov/sites/default/files/2026-04/90983850-6dfe-4886-9dfa-1a3890a655b3/POS_File_iQIES_Q1_2026.csv';

export const POS_RELEASE_QUARTER = '2026-Q1';

export const ASC_FEE_SCHEDULE_ZIP_URL =
  'https://www.cms.gov/files/zip/april-2026-asc-approved-hcpcs-code-payment-rates.zip';

export const ASC_FEE_SCHEDULE_RELEASE = 'April 2026';

export const ASC_FEE_SCHEDULE_YEAR = 2026;

// Filename inside the ZIP containing the national ASC payment rates per HCPCS.
// CMS keeps renaming this; scan for a CSV containing "Addendum AA" case-insensitively.
export const ADDENDUM_AA_FILENAME_PATTERN = /addendum\s*aa/i;

// CPT codes the rates ETL cares about. Keep in sync with the `procedures` seed.
export const TARGET_PROCEDURE_CODES = ['64628'] as const;

// POS provider type code identifying an Ambulatory Surgical Center.
// Verified against Q1 2026 iQIES POS data: every row whose `fac_name` matches
// "surgical|surgery center" carries `prvdr_type_id = '11'`; no exceptions.
// We additionally require a date-shaped `asc_bgn_srvc_dt` as a cross-check —
// non-ASCs in this file carry "Not Applicable"/"Not Available" placeholders
// in that column instead of a real date.
export const ASC_PROVIDER_TYPE_CODE = '11';

// Matches ISO-ish date strings (YYYY-MM-DD) used in the POS file for real
// dates. The POS file also ships placeholder strings ("Not Applicable",
// "Not Available") where no date applies — anything that does NOT match
// this pattern is treated as "no date," which covers both placeholders
// and the occasional empty string.
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Upsert batch size. Supabase REST has practical limits; 500 is comfortable.
export const UPSERT_BATCH_SIZE = 500;

// Marker for the ASC Fee Schedule national rate. Phase-2 locality work will
// introduce per-CBSA rates with different locality strings; keeping this as a
// constant rather than an empty string makes the intent obvious in queries.
export const NATIONAL_UNADJUSTED_LOCALITY = 'NATIONAL-UNADJUSTED';

// NPPES Type-2 backfill: taxonomy codes we accept and how each maps to our
// facility_type enum. Filter is intentionally narrow — these are the
// organization types likely to perform CPT 64628 (Intracept) or other
// procedure-relevant cash-pay work. Add codes as more procedures come online.
//
// Codes are NUCC Healthcare Provider Taxonomy v22.x; they ARE stable across
// NPPES releases. Source: https://taxonomy.nucc.org
export const NPPES_TAXONOMY_TO_FACILITY_TYPE: Record<string, 'asc' | 'hospital' | 'clinic'> = {
  '261QA1903X': 'asc', // Ambulatory Surgical Center
  '261QP3300X': 'clinic', // Pain Medicine Clinic
  '261QM1300X': 'clinic', // Multi-Specialty Clinic
  '281P00000X': 'hospital', // Surgical Specialty Hospital
  '282N00000X': 'hospital', // General Acute Care Hospital
};

// Priority order when a row carries multiple matching taxonomies. Earlier =
// higher priority. Mirrors the order-sensitivity in the submit Edge Function's
// mapTaxonomyToFacilityType: hospital wins over asc wins over clinic.
export const NPPES_TAXONOMY_PRIORITY: ('hospital' | 'asc' | 'clinic')[] = [
  'hospital',
  'asc',
  'clinic',
];
