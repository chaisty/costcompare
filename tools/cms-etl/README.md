# CMS ETL

Local pre-processing for CMS data. Downloads public files, extracts the bits we need, and upserts them into Supabase via the service role. Intended to run on a developer laptop (or a scheduled runner), not in the browser.

## What it loads

| Dataset | Target table | Rate type | Granularity |
|---|---|---|---|
| ASC facility list (POS iQIES, quarterly) | `facilities` | — | one row per ASC |
| ASC Fee Schedule Addendum AA (quarterly) | `rates` | `medicare` | national unadjusted, one row per CPT |

Locality adjustment via ASC wage index is **not** in scope for MVP — the national unadjusted rate is stored with `locality = 'NATIONAL-UNADJUSTED'` and a note that per-locality refinement is a phase-2 follow-up.

## Running

```
npm install
cp .env.example .env     # edit if Supabase is on non-default ports
npm run etl              # both facilities + rates
npm run etl:facilities
npm run etl:rates
```

Cached downloads land in `cache/` (gitignored); re-runs reuse cached files unless `--refresh` is passed.

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
