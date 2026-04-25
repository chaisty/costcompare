# CostCompare — Medical Procedure Cash-Pay Price Database

A web app where patients submit and search cash-pay quoted rates for medical procedures. MVP is scoped to a single procedure: CPT **64628** (Intracept). The data model carries bundled procedure codes from day one so expansion to other procedures is a UI change, not a schema change. User-submitted quotes are supplemented with publicly available Medicare rates and — via local pre-processing — payer-negotiated rates from Transparency-in-Coverage (T-in-C) files.

## Current status

**Phase 0** — project docs and scaffolding. Remote at `https://github.com/chaisty/costcompare`. No code yet.

## Read these first

| Document | What it covers |
|---|---|
| This file | Architecture, conventions, workflow, security rules |
| `diary/` | Per-session notes — decisions, surprises, context that doesn't survive in code |
| `docs/research/` | External analyses kept for product/data-model guidance (e.g. comparable products, submission-field recommendations) — informed input, not gospel |

No separate `CONVENTIONS.md`, no `planning/` or `decisions/` directories at this stage — the project is small enough that this file plus the diary capture the reasoning. Add them only if the project outgrows a single doc.

## Tech stack

- **Frontend:** Vite + React + TypeScript, Vitest, Biome (lint + format)
- **Backend / DB:** Supabase (Postgres + auto-generated REST + Row-Level Security) — free tier
- **Transactional email:** Resend (free tier) — for submission confirmation links
- **Hosting:** Cloudflare Pages — free tier
- **Local ETL:** Node + TS scripts under `tools/` for pre-processing CMS Medicare data and T-in-C MRF files before uploading derived rates to Supabase

We are **not** creating user accounts. Email is collected per submission for one-off confirmation-link validation, and never returned in any public API response.

## Project structure (target)

```
C:\AI\claude\costcompare\
├── README.md
├── CLAUDE.md                    (this file)
├── .gitignore
├── diary\                       (per-session notes; see §Diary)
├── web\                         (Vite + TS React app)
├── supabase\                    (migrations + RLS policies; Supabase CLI project)
└── tools\                       (local ETL for CMS Medicare + T-in-C pre-processing)
```

## Key invariants

- **Public submissions, private submitter.** A submission's price, facility, year, and had-procedure flag are public once confirmed. The submitter's email is PII and must never appear in any response served to the public API. Enforce at the DB layer via Row-Level Security, not in application code.
- **Confirmed-email gate.** A submission is not visible to the public until the submitter clicks the Resend confirmation link. Unconfirmed submissions are invisible in every public query. Tokens are one-time, expiring, and never reused.
- **Bundled procedure codes from day one.** Every submission and every derived rate carries `procedure_codes: text[]`, even though the MVP UI is 64628-only. Do not add a scalar `cpt_code` column "just for now."
- **Three rate classes, one shape.** Cash-pay (user-submitted), Medicare (ingested from CMS), negotiated (ingested from pre-processed T-in-C). Store in one `rates` table with a `rate_type` enum; do not fork into per-source tables. Source attribution and confidence live on the row.
- **Data provenance is user-facing.** Every rate the UI shows must display its source, year, and — for T-in-C — a "best-effort parsed" caveat. Never show a number without its provenance.
- **Server-authoritative writes.** Supabase client SDK is fine for reads. Writes that affect what the public sees (confirmations, moderation flags) go through server routes or Postgres functions, not direct client mutations.

## Coding baselines — TypeScript

- Strict mode. No `any` — use `unknown` and narrow.
- Function components only. Named exports, no default exports.
- Files: `kebab-case.ts` / `kebab-case.tsx`. Types: `PascalCase`. Variables/functions: `camelCase`. Constants: `UPPER_SNAKE_CASE`.
- Co-located tests: `foo.ts` + `foo.test.ts`. Vitest + Testing Library.
- `type` over `interface` unless extension is actually needed.
- `import type { Foo } from '...'` for type-only imports.
- **Biome** handles lint + format — no ESLint, no Prettier.

## Coding baselines — SQL / Postgres

- snake_case everywhere. UUID PKs.
- `timestamptz` always (never `timestamp`).
- Enum types for fixed small sets (`rate_type`, `submission_status`, etc.).
- Foreign keys always, `on delete cascade` or `set null` explicit.
- Migrations via Supabase CLI — one logical change per file.
- **RLS policies on every table.** Default-deny; write policies explicitly for `anon` and `authenticated`. Service role (used only from the ETL and server functions) bypasses.
- Money as `numeric(10,2)` — never `float` / `double precision`.

## Testing

- **Test-first.** Before writing code, enumerate 4 categories of cases: happy paths, edge cases, error conditions, boundary values. Write failing tests first.
- **Layers:** unit (pure functions — price parsing, T-in-C extraction), integration (service + local Supabase instance), E2E (full flow: submit → confirmation email stub → confirm → search). Don't duplicate logic coverage in E2E.
- **Verify trigger paths, not just handlers.** A correct handler attached to a dead code path is not a fix.
- **Deterministic time and randomness.** Inject clock and token generators.
- **RLS must have tests.** Write tests that connect as `anon` and assert that queries which *should* fail do fail. Unconfirmed submissions visible to `anon` is a security bug, not a UX bug.

## Security (non-negotiable)

- **Emails never appear in public responses.** Enforced by RLS plus a test that asserts no public endpoint response shape includes an `email` field.
- **Confirmation tokens are one-time, expiring, cryptographically random** — minimum 128 bits of entropy. Hashed at rest.
- **Every REST endpoint has an explicit auth posture** — public (anon), confirmation (token-gated), or server-only. No implicit defaults.
- **Bounds on every numeric request field** validated at the API boundary (price, year, pagination limits).
- **No raw SQL from user input.** Parameterized queries only. Any RPC or function that concatenates SQL needs review.
- **Rate limit submissions per IP and per email.** Even with confirm-link gating, fake submissions cost us email-sending budget.
- **Do not log emails or full submission content at INFO.** Use structured fields and mask at ingest.

## Workflow loop

Every non-trivial implementation task follows this loop.

**1. Test design.** Enumerate happy / edge / error / boundary cases. Write tests first; they should fail or not compile before the code exists.

**2. Build.** Implement until tests pass.

**3. Verify** — before self-review, to catch cheap issues when they're cheap:
- From `web\`: `npx biome check .`, `npx tsc --noEmit`, `npm test`
- If migrations changed: `supabase db reset`, then hit affected endpoints before claiming success
- For RLS changes: run the `anon`-role test suite specifically

**4. Self-review.** Read every changed file in full. Check against this document. Re-read acceptance criteria; for each, point to concrete code/test evidence. List every issue; fix all before proceeding. If you fixed anything, return to step 3.

**5. Subagent review.** Spawn a review subagent for non-trivial changes. Prompt:
```
Review the changes for <task>. Read CLAUDE.md.
Then run `git -C /c/AI/claude/costcompare diff <base>...HEAD`. Check:
1. Does every acceptance criterion have concrete code/test evidence?
2. Does the code follow CLAUDE.md? (naming, security, RLS, data provenance, no-email-leak rule)
3. Are submitter emails ever returned in public responses?
4. Any untested branches, hardcoded values, unverified assumptions?
List every issue. Do not fix anything — just report.
```
Trivial one-liners can skip this. Anything touching submissions, RLS, or email must not.

**6. Commit.** Conventional Commits, single-line messages. Verify only your files are staged: `git -C /c/AI/claude/costcompare diff --cached --name-only`. Push after approval.

## Issue hygiene

Backlog tracked as GitHub issues on `chaisty/costcompare`, labels + milestones only (no Projects board — overkill for a single-agent serial project).

- **Issues for chunky work:** anything that spans a session, has real design questions, or benefits from a written acceptance list. MVP has 8 such issues; `v1.1` holds the post-MVP backlog.
- **No issues for trivia:** one-file fixes, doc tweaks, dependency bumps — a good commit message is enough.
- **Labels:** `phase-1` (MVP), `phase-2` (backlog), plus area labels (`schema`, `backend`, `frontend`, `etl`, `security`, `ops`). Stacked, not exclusive.
- **Milestones:** `MVP` for the launchable slice, `v1.1` for the known post-MVP backlog.
- **Closes discipline:** when an issue-scoped piece of work lands, reference it in the commit (`feat: ... (Closes #N)`) so the issue closes on push.
- **`gh issue create` bodies go in `--body-file`, not `--body`.** Markdown headers inline in `--body` trigger approval prompts in this environment.

If we ever scale to parallel agents, add a Projects board and tighten the one-PR-per-issue discipline — don't preemptively.

## Shell conventions

- **Never** combine `cd` with `&&`, `||`, or `;`. Use `git -C <absolute-path> ...` instead.
- **Never** use command substitution `$(...)` or backticks. `$((arithmetic))` and `${parameter}` are fine.
- Commit messages pass via `-m "single line"`. No heredocs, no embedded newlines.

## Commit messages

Conventional Commits — single line, no embedded newlines:
- `feat:` new user-visible capability
- `fix:` bug fix
- `test:` tests only
- `refactor:` code change with no behavior change
- `docs:` docs only
- `chore:` tooling, config, meta

Push immediately after committing.

## Diary

The project diary lives in `diary/` with **per-session files**, one file per session, named `YYYY-MM-DD_HHMMSS_<session-id>.md`. No append-collision risk.

**Write at end of session**, or when the user says "we're done for now."

**Captures what doesn't survive in code:**
- Decisions and why (with alternatives considered and rejected)
- User-directed pivots
- Surprises and lessons
- Design tensions and tradeoffs
- Context the next agent needs

**Does not capture:** lists of files changed, commits made, or tests added. Git has those. If an entry could be reconstructed from `git log`, it has no value.

Entry format: see `diary/README.md`.

## Things to avoid

- **Never return submitter email** in a public API response. Enforced by RLS, asserted by tests.
- **Never show unconfirmed submissions** in public queries.
- **No scalar `cpt_code` column** — always `procedure_codes: text[]`.
- **No separate tables per rate type** — one `rates` table with a `rate_type` enum.
- **No what-comments.** Only why, and only when non-obvious.
- **No free-text error strings to clients** — fixed error codes.
- **No skipping RLS tests.** An RLS bug is a data-leak bug.
- **No gathering of patient-identifying info beyond submitter email** — price, facility, year, had-procedure flag only.

## Decisions already made

- **Supabase over Azure Static Web Apps + Cosmos** — Cosmos credits potentially depleted; Supabase free tier is generous and Postgres + RLS gives row-level email privacy as a DB rule rather than application code.
- **Cloudflare Pages over Vercel / Azure Static Web Apps** — simplest static deploy; least vendor-specific config.
- **Resend over Supabase Auth** — we're not creating accounts, just validating one-off submissions. Magic-link auth is the wrong abstraction.
- **Local pre-processing of T-in-C MRF files** — MRFs are multi-GB per payer; ingesting raw in Supabase kills the free tier. ETL locally, upload derived rates.
- **Single CPT code (64628) in UI, bundled codes in schema** — avoid "choose a procedure" UX until data exists for more than one, but don't lock out expansion.
- **Biome for JS tooling** (over ESLint + Prettier) — single tool, faster, simpler config. Consistent with LiarsPoker.
- **No worktrees, serial single-agent development** — small commits provide enough rollback granularity.
- **No ADRs** at this stage — project is small enough that this file plus the diary capture the reasoning.

## When this file needs updating

Update CLAUDE.md when: stack pieces change, a top-level directory is added or removed, a new invariant is agreed, or a baseline shifts. Keep it short — add docs under `docs/` only if depth is ever needed.
