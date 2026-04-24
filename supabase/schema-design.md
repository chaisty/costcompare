# Schema Design — Initial Draft

Proposed schema for issue #1. Review before migrations are written.

## Design principle: privacy by defense-in-depth

The submitter's email (PII) and the public price data live in **separate tables**. The anon role has **zero** read grant on the table that holds email. Any RLS bug on the public table therefore cannot leak emails — because emails aren't in the public table.

- `submissions` — private. Email, confirmation token, IP, lifecycle status. Anon has **no** SELECT / UPDATE grant; only a gated INSERT via an RPC.
- `rates` — public. The materialized public record. A cash-pay rate only appears here after the submitter clicks the Resend confirmation link. Anon has SELECT only.

Moderation / takedown removes (or hides) the `rates` row, leaving the audit trail in `submissions`.

## Enums

| Enum | Values |
|---|---|
| `rate_type` | `'cash'`, `'medicare'`, `'negotiated'` |
| `submission_status` | `'pending'`, `'confirmed'`, `'rejected'` |
| `facility_type` | `'asc'`, `'hospital'`, `'medical_center'`, `'clinic'`, `'other'` |

## Tables

### `procedures`

Reference table. One row per procedure concept (e.g., "Intracept"). Bundled CPT codes live in an array so expansion to new procedures is seeding, not schema change.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `primary_code` | `text` not null | e.g. `'64628'` — the headline code shown in UI filters |
| `procedure_codes` | `text[]` not null | all bundled codes; `primary_code` must be `ANY(procedure_codes)` (check constraint) |
| `name` | `text` not null | e.g. `'Intracept'` |
| `description` | `text` | |
| `created_at` | `timestamptz` not null | `default now()` |

Unique index on `primary_code`.

### `facilities`

ASCs + hospital outpatient + other sites of care. Seeded from CMS ETL; user submissions reference existing rows (typeahead picker).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `external_id` | `text` | CMS CCN or equivalent, for idempotent upsert |
| `name` | `text` not null | |
| `facility_type` | `facility_type` not null | |
| `address_line1` | `text` | |
| `address_line2` | `text` | |
| `city` | `text` | |
| `state` | `text` | 2-char, check constraint |
| `zip` | `text` | |
| `network` | `text` | healthcare network / parent org, when known |
| `created_at` | `timestamptz` not null | `default now()` |
| `updated_at` | `timestamptz` not null | `default now()` |

Unique on `external_id` (nullable uniques OK in Postgres — multiple rows with null `external_id` allowed if a user submits a facility not in the CMS list).

### `submissions` — PRIVATE

Anon has **no** SELECT. Only accessible via service role or the confirmation RPC.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `email` | `text` not null | PII |
| `facility_id` | `uuid` FK → `facilities.id` | |
| `procedure_codes` | `text[]` not null | snapshot at submit time |
| `quoted_price` | `numeric(10,2)` not null | check `> 0` |
| `quote_year` | `int` not null | check between 2000 and current year |
| `had_procedure` | `boolean` not null | |
| `submission_status` | `submission_status` not null | default `'pending'` |
| `token_hash` | `text` not null | SHA-256 of the one-time token |
| `token_expires_at` | `timestamptz` not null | default `now() + interval '48 hours'` |
| `confirmed_at` | `timestamptz` | set by the confirmation RPC |
| `submitter_ip_hash` | `text` not null | SHA-256 of `pepper \|\| today's date \|\| ip`; see §IP hashing below |
| `rate_id` | `uuid` FK → `rates.id` | set when confirmation materializes the public row |
| `created_at` | `timestamptz` not null | `default now()` |

Indexes on `(email, created_at desc)` and `(submitter_ip_hash, created_at desc)` for rate-limit lookups.

### `rates` — PUBLIC

Unified Medicare / negotiated / confirmed cash-pay.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `rate_type` | `rate_type` not null | |
| `facility_id` | `uuid` FK → `facilities.id` | nullable — Medicare can be locality-level without a specific facility |
| `procedure_codes` | `text[]` not null | |
| `price` | `numeric(10,2)` not null | check `> 0` |
| `rate_year` | `int` not null | |
| `locality` | `text` | CMS ASC locality code for Medicare |
| `payer` | `text` | for negotiated (e.g., 'Anthem BCBS') |
| `plan_variant` | `text` | for negotiated (e.g., 'PPO', 'HDHP') |
| `source_url` | `text` | |
| `source_fetched_at` | `timestamptz` | for Medicare / T-in-C; null for cash |
| `confidence_note` | `text` | e.g., 'best-effort parsed from T-in-C' |
| `source_submission_id` | `uuid` FK → `submissions.id` | non-null for `rate_type = 'cash'`, else null |
| `created_at` | `timestamptz` not null | `default now()` |

Indexes on `(procedure_codes)` GIN, `(rate_type)`, `(facility_id)`.

Check constraint: `(rate_type = 'cash') = (source_submission_id IS NOT NULL)`.

## Relationships

```
procedures         (reference data)

facilities  ────<  rates   >────  submissions
                  (public)        (private)
                                      │
                                      └─ rates.source_submission_id
                                         submissions.rate_id
                                         (materialized on confirm)
```

## RLS model

All tables: **enable RLS**, default-deny. Policies below.

| Table | anon | authenticated | service_role |
|---|---|---|---|
| `procedures` | SELECT | SELECT | ALL |
| `facilities` | SELECT | SELECT | ALL |
| `rates` | SELECT | SELECT | ALL |
| `submissions` | — | — | ALL |

Anon has no direct INSERT / UPDATE / DELETE on any table. All write paths go through security-definer RPCs.

## Write paths (RPC functions)

### `submit_quote(email, facility_id, procedure_codes, quoted_price, quote_year, had_procedure) → { ok, message }`

- Rate-limit by email and by submitter IP (rejected with fixed error code on violation)
- Generate 128-bit random token, hash it, store hash
- INSERT into `submissions` with `status = 'pending'`, `token_expires_at = now() + '48h'`
- Call Resend via `net.http_post` (pg_net extension) **OR** emit an event that an Edge Function picks up — TBD, see Open Questions
- Return `{ ok: true, message: 'Check your email' }` on success; fixed error codes otherwise
- **Never** expose email or token in logs

### `confirm_submission(token) → { ok, message }`

- Hash input token, look up matching `submissions.token_hash`
- If not found / expired / already confirmed: return fixed error code
- Set `submission_status = 'confirmed'`, `confirmed_at = now()`
- INSERT into `rates` with `rate_type = 'cash'` and `source_submission_id = this.id`
- Update `submissions.rate_id` to the new rates row
- Return `{ ok: true }`

### `reject_submission(submission_id)` (service role / admin only)

- Set `submission_status = 'rejected'`
- DELETE from `rates` where `source_submission_id = this.id`
- Used for moderation / reports in phase-2

## Seed data (migration 0003)

- `procedures` row: `primary_code = '64628'`, `procedure_codes = ARRAY['64628']`, `name = 'Intracept'`, `description = 'Basivertebral nerve ablation for chronic low back pain'`.
  - 64629 (additional vertebral bodies) is not tracked — the add-on cost is small relative to the primary procedure, so it would not meaningfully affect price comparisons.

## Tests (anon-role, issue #1 acceptance)

Run as the `anon` role:
1. `SELECT * FROM submissions` — must fail (no grant)
2. `SELECT email FROM submissions` — must fail
3. `SELECT * FROM rates WHERE rate_type = 'cash'` — must succeed and return only confirmed cash rates
4. `INSERT INTO submissions (...)` — must fail
5. `UPDATE rates SET price = 0` — must fail
6. `DELETE FROM rates WHERE id = ...` — must fail
7. Call `submit_quote(...)` — must succeed and trigger email
8. Call `confirm_submission(bad_token)` — must return error, never raise

## IP hashing

Submitter IP is stored as a salted SHA-256 hash — never raw. Two goals:

1. Same-day rate limiting works (same IP on the same day → same hash → counted).
2. Long-term IP tracking is not possible (next day, the same IP produces a different hash).

**Construction:** `SHA-256(pepper || to_char(current_date) || ip_text)`

- `pepper` is a per-environment secret, stored outside the DB (Supabase vault / env var). Loaded into the RPC via `current_setting('app.ip_pepper')`. Never committed to the repo.
- `current_date` rotates the hash daily without requiring any scheduled job.
- Without the pepper, brute-forcing the IPv4 space is cheap; with it, attacker needs the pepper **and** the date to correlate.

Rate-limit query uses the same construction with today's date, so it only matches submissions from the current day — which is exactly the window we care about (per-24h rate limit). Older rows become uncorrelatable but remain in the audit trail.

Simpler alternative considered and rejected: fixed pepper without date rotation. It works but retains long-term IP correlation in the DB; the daily rotation is cheap to implement and materially better for submitter privacy.

## Resolved decisions (from draft review)

| # | Decision | Notes |
|---|---|---|
| 1 | Email send path: **Supabase Edge Function**, not inline `pg_net` | Keeps Postgres focused on data. `submit_quote` RPC inserts the row and returns the plaintext token; the Edge Function calls the RPC and sends via Resend. Issue #3's scope. Local dev uses Inbucket (bundled with `supabase start`). |
| 2 | Submitter IP: **salted hash**, date-rotating with environment pepper | See §IP hashing. |
| 3 | `had_procedure = false`: **show in search with a badge** | Search UI surfaces a small "quoted only" indicator. |
| 4 | Facility picker: **CMS-seeded only** at MVP | "My facility isn't listed" is phase-2. |
| 5 | Moderation at MVP: **service-role CLI only**, no admin UI | `reject_submission` exists as a function but has no public route. |
| 6 | Bundled procedure codes for Intracept: **`['64628']` only** | 64629 (additional vertebrae) is a low-value add-on cost; not meaningful for price comparison. |
