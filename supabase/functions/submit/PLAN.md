# Issue #3 — Submission Endpoint + Resend Confirmation — plan

Scratch planning doc for post-compact work on issue #3. Delete once the Edge Function ships.

## Current state (verify before starting)

- Local Supabase running on the costcompare project: ports 544xx (54421 API, 54422 db, 54423 studio, 54424 inbucket). Verify: `npx supabase status --workdir /c/AI/claude/costcompare`.
- If not running: `npx supabase start --workdir /c/AI/claude/costcompare`. Docker Desktop needs to be up.
- Schema + RLS + RPCs already applied. Intracept (CPT 64628) seeded. 6,226 ASCs and 1 Medicare rate loaded.
- `submit_quote` RPC is ready — service-role only. Takes `(email, facility_id, procedure_codes, quoted_price, quote_year, had_procedure, submitter_ip: inet)`. Returns `jsonb`:
  - Success: `{ ok: true, submission_id: uuid, token: 'plaintext-64char-hex' }` — token is returned ONCE, only to the caller.
  - Errors (fixed codes): `invalid_email`, `invalid_price`, `invalid_year`, `invalid_procedure_codes`, `missing_had_procedure`, `missing_ip`, `unknown_facility`, `rate_limited_email`, `rate_limited_ip`.
  - Input validation, per-email/IP rate limits, and advisory-lock race protection already live in the RPC. Don't duplicate any of that in the Edge Function.
- `confirm_submission(p_token)` RPC is anon-callable. Errors: `invalid_token`, `already_confirmed`, `rejected`, `token_expired`. Not touched by this issue — the confirmation **landing page** is issue #6 (frontend).

## Scope of this issue

Build **one Edge Function** that accepts a submission POST, calls `submit_quote`, and emails the confirmation link via Resend. That's it. Confirmation UX is issue #6.

Path: `supabase/functions/submit/index.ts` (Deno, `supabase functions serve` to run locally, deploy to prod via `supabase functions deploy submit`).

## Request/response shape

**POST** `/functions/v1/submit`

Request body (JSON):
```
{
  "email": "alice@example.com",
  "facility_id": "uuid",
  "procedure_codes": ["64628"],
  "quoted_price": 8500.00,
  "quote_year": 2026,
  "had_procedure": true
}
```

Response:
```
{ "ok": true, "message": "Check your email to confirm your submission." }
```

or on error:
```
{ "ok": false, "error": "rate_limited_email" }
```

**Never** return the submission_id, token, or email in the response body. The client must NOT know anything that could be used to bypass the email gate.

## Architecture

```
Browser → POST /functions/v1/submit
          → Edge Function
              → Supabase client (service role key from env)
                → submit_quote RPC  [returns {ok, submission_id, token}]
              → Resend HTTP API (POST https://api.resend.com/emails)
                → email with link: {APP_BASE_URL}/confirm?token={plaintext}
              → returns {ok, message} to browser
```

Email template: small transactional HTML. Confirmation link embeds plaintext token in the query string.

## Environment variables

- `SUPABASE_URL` — auto-populated by Supabase runtime for Edge Functions
- `SUPABASE_SERVICE_ROLE_KEY` — auto-populated
- `RESEND_API_KEY` — set via `supabase secrets set` for prod; `.env` for local
- `RESEND_FROM_EMAIL` — verified sender address (for MVP dev we can use Resend's `onboarding@resend.dev`)
- `APP_BASE_URL` — e.g. `http://localhost:5173` (dev, Vite) or the Cloudflare Pages domain (prod)

## Dev email strategy

Resend works in prod. For local dev:

- **Option A (preferred):** stub Resend in the Edge Function when `DENO_ENV === 'development'` or when `RESEND_API_KEY` is unset — log the email to stdout instead of sending. Local dev tests can parse stdout or just call `submit_quote` directly with a service-role client (skipping the Edge Function) to grab the plaintext token.
- **Option B:** use a Resend test API key. Requires a real Resend account and risks accidentally sending email.
- **Option C:** SMTP to Mailpit (the Supabase local email catcher at 54424). Deno's SMTP support is middling; HTTP+stub is simpler.

Go with Option A. The seam is an `EmailSender` interface with `ResendSender` and `ConsoleSender` implementations; pick based on env.

## Testing approach

Unit tests (Deno test or Vitest in a separate test project — Edge Functions are Deno-native; probably easiest to run Deno tests directly):

- `sendConfirmationEmail` with stub Resender asserts the correct HTML + subject + recipient
- Request validation: missing field → 400 with fixed error code
- Service-role call is correctly authenticated (not easily unit-testable; better as integration)

Integration / E2E test:

- Start local Supabase + `supabase functions serve submit`
- POST a valid submission → expect 200 + `ok: true`
- Query `submissions` as service role → find the row with `status = 'pending'`
- Capture the plaintext token from the console output or from a test-only endpoint that exposes it (test-only code must not ship to prod)
- Call `confirm_submission(token)` via anon client → expect `{ ok: true }`
- Query `rates` as anon → new cash rate row is visible

Skip the "real Resend" test for MVP — stubbed is fine for CI.

## Security checks before merging

- [ ] Email never returned in any response body (including errors)
- [ ] Submission ID never returned to anon — the client only learns "check your email"
- [ ] Plaintext token never logged at INFO; never returned in the HTTP response
- [ ] `RESEND_API_KEY` never logged; never included in error messages that reach the client
- [ ] `IP` extraction: use `X-Forwarded-For` first hop (Supabase Edge runs behind a trusted proxy); fall back to remote address
- [ ] CORS: the web app at `APP_BASE_URL` is allowed; other origins are rejected (or we set a wildcard — decide before merge)
- [ ] No `any` in TS; narrow from `unknown`
- [ ] If the RPC returns `{ ok: false }`, don't send an email

## Subagent review prompt

Same structure as #1 and #2 reviews. Must check: no email/token in response; no submission_id leak; service-role key handling; CORS posture; error codes match the RPC's vocabulary; email template doesn't leak internal state.

## After this issue

- Issue #6 adds the `/confirm?token=...` frontend route that calls `confirm_submission` via the anon Supabase client.
- Issue #8 adds `app.ip_pepper` to prod and a sanity check that fails deploy if it's unset (carryover comment already filed).

## Environmental reminders (for post-compact self)

- User is frequently on mobile; approval prompts are flaky. Prefer dedicated tools (Edit/Read/Grep/Glob) over Bash when possible. For `gh`, use `--body-file`. Avoid `&&`-chained Bash commands.
- `.claude/settings.json` has a narrow committed allowlist; `settings.local.json` (user's) has broader patterns. Most `npm run <script>` and `npx supabase <subcommand>` calls should pass.
- Memory index at `C:\Users\chris\.claude\projects\C--AI-claude-costcompare\memory\MEMORY.md` has the full list of workarounds.
- Never commit real local-dev Supabase keys to `.env.example` — GitHub push protection will reject the push and require a history rewrite. Use a placeholder.
- At the end of the session, update the diary (per-session file in `diary/`). Run `/cost` to get session totals; user will usually paste the output if asked.
