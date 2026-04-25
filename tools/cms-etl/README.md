# CMS ETL

Local pre-processing for CMS data. Downloads public files, extracts the bits we need, and upserts them into Supabase via the service role. Intended to run on a developer laptop (or a scheduled runner), not in the browser.

## What it loads

| Dataset | Target table | Rate type | Granularity |
|---|---|---|---|
| ASC facility list (POS iQIES, quarterly) | `facilities` | — | one row per ASC |
| ASC Fee Schedule Addendum AA (quarterly) | `rates` | `medicare` | national unadjusted, one row per CPT |
| NPPES Type-2 organizations (monthly, opt-in) | `facilities` | — | filtered to taxonomies relevant to MVP procedures |

Locality adjustment via ASC wage index is **not** in scope for MVP — the national unadjusted rate is stored with `locality = 'NATIONAL-UNADJUSTED'` and a note that per-locality refinement is a phase-2 follow-up.

## Running

```
npm install
cp .env.example .env     # edit if Supabase is on non-default ports
npm run etl              # both facilities + rates
npm run etl:facilities
npm run etl:rates
npm run etl:nppes        # opt-in; requires manual download (see below)
```

Cached downloads land in `cache/` (gitignored); re-runs reuse cached files unless `--refresh` is passed.

## NPPES Type-2 backfill (opt-in)

The `nppes` job pre-warms the `facilities` table with NPI-bearing organizations (ASCs, pain medicine clinics, surgical hospitals, acute care hospitals) so facility autocomplete and search work even before any user has submitted a price. Filter is taxonomy-coded; see `src/config.ts` for the allowlist.

**Why opt-in:** the NPPES monthly file is multi-GB and CMS distributes it as a ZIP from a landing page that requires manual download (no stable per-month URL). The job expects a pre-extracted CSV.

**Steps:**

1. Download the latest NPPES monthly full file from <https://download.cms.gov/nppes/NPI_Files.html> (look for "NPPES Data Dissemination", click the most recent month). The ZIP is ~1-2GB.
2. Extract `npidata_pfile_YYYYMMDD-YYYYMMDD.csv` (the much-larger CSV inside; ~7-8GB uncompressed). Note: the `_FileHeader.csv` in the same ZIP is metadata, not the data.
3. Set the env var and run:
   ```
   NPPES_CSV_PATH=/path/to/npidata_pfile_<date>.csv npm run etl:nppes
   ```

The job streams the CSV row-by-row, so it doesn't load the whole file into memory; expect ~10-15 minutes wall-clock for the parse, then a few seconds for the upsert.

**Crosswalk semantics:** for each candidate, the upsert checks against existing `facilities` rows:
- NPI already in `facilities` → skip (no-op).
- Same lower(name) + state matches an existing row with no NPI → set the NPI on that row (preserves POS-sourced rows' `external_id` / Medicare-listed badge).
- Same lower(name) + state matches a row that already has a different NPI → record as ambiguous and skip (don't merge silently).
- No match → insert.

## Source URLs

- **POS iQIES:** `https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/provider-of-services-file-...` — the landing page. Direct download URL contains a per-quarter UUID path and must be updated each quarter. See `src/config.ts`.
- **ASC Fee Schedule:** `https://www.cms.gov/medicare/payment/prospective-payment-systems/ambulatory-surgical-center-asc/asc-payment-rates-addenda` — landing page. Direct ZIP URL changes quarterly. See `src/config.ts`.

When CMS publishes a new quarter, bump the URL constants in `config.ts` and re-run — the upserts are idempotent and will update in place.

## Testing

```
npm test              # unit tests against fixtures
npm run typecheck     # tsc --noEmit
npm run lint          # biome check
```

Unit tests use inline CSV fixtures in the `*.test.ts` files themselves — no network, no separate fixture files. Integration runs the real upsert against a local Supabase (`npx supabase start` from repo root).
