# Production deploy runbook

Captures the manual provisioning steps to bring CostCompare online. Run top-to-bottom once; re-run individual sections on routine re-deploys.

**Stack:** Supabase (backend), Cloudflare Pages (frontend), Resend (transactional email). All free-tier compatible.

**Prerequisites**

- Accounts: Supabase, Cloudflare, Resend, GitHub (already set up — `chaisty/costcompare`).
- Supabase CLI v1.x installed locally (`npx supabase --version`).
- A domain or subdomain (Cloudflare Pages also offers a free `pages.dev` subdomain if you skip this).

---

## 1. Supabase prod project

One-time setup.

1. Create the project via the Supabase dashboard. Name `costcompare`, strongest available region for your audience (US-East-1 if unsure).
2. Save the project ref (the 20-char string in the dashboard URL) and the database password.
3. Link the local repo:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```
4. Apply migrations to prod:
   ```bash
   npx supabase db push
   ```
   This runs every `supabase/migrations/*.sql` file in order against prod. Verify with the dashboard's SQL editor: `\dt` should list `procedures`, `facilities`, `rates`, `submissions`.

5. **Set `app.ip_pepper` to a real secret.** This is the salt for the IP-hash rate-limit. If left at the dev fallback, IP rate-limiting is defeated.
   ```sql
   -- In the Supabase dashboard SQL editor, replace with a 32+ char random value:
   alter database postgres set app.ip_pepper = '<random-32-char-secret>';
   ```
   Generate a value with `openssl rand -hex 32` or similar. Never commit it.

6. **Run the prod readiness check.** From the dashboard SQL editor, run the contents of `supabase/check-prod-readiness.sql`. Every row should return `ok`. If any fail, fix before proceeding.

7. Seed reference data (procedures): the Intracept row lands via migration `20260424125851_seed.sql` — no action needed. CMS facility + Medicare rate seed is run separately in §3.

---

## 2. Resend setup

One-time setup.

1. Create a Resend account.
2. Add and verify a sender domain (e.g., `costcompare.example`). Skip this and use `onboarding@resend.dev` if you only need a smoke test.
3. Create an API key with "sending access." Save it — you'll set it as a Supabase secret below.
4. Decide the `from` address. Confirmation emails will come from this. Prod choice: `confirm@<your-domain>`.

---

## 3. CMS ETL: seed facilities + Medicare rate

Run from the local machine (not in CI) since it downloads ~180MB of CMS CSVs.

```bash
cd tools/cms-etl
cp .env.example .env
# Edit .env — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to PROD values.
# Service role key is under Project Settings → API → "Secret" key.

npm install
npm run run -- --all
```

Expected: `~6,200 facilities` upserted, `1 Medicare rate` inserted. The script is idempotent on facilities (ON CONFLICT external_id) and replaces the Medicare rate on each run. Re-run quarterly as CMS releases new data.

---

## 4. Edge Function deploy

One-time + on code changes to `supabase/functions/submit/`.

```bash
# Set the prod secrets (one time):
npx supabase secrets set \
  RESEND_API_KEY=<resend-api-key> \
  RESEND_FROM_EMAIL=confirm@<your-domain> \
  APP_BASE_URL=https://<your-pages-domain>

# Deploy the function:
npx supabase functions deploy submit
```

**Do NOT set `EMAIL_MODE=dev-console` in prod.** That is the dev-only stub. If `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are missing, the function will refuse to send — better than silently logging tokens to stdout.

Verify with the dashboard → Edge Functions → `submit` → Logs. A POST should return 200; errors should show only the fixed error codes from the code.

---

## 5. Cloudflare Pages

One-time setup.

1. Create a new Pages project → "Connect to Git" → select `chaisty/costcompare`.
2. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm install --prefix web && npm run build --prefix web`
   - **Build output directory:** `web/dist`
   - **Root directory:** leave blank (build cmd chdirs via `--prefix`).
   - **Node version:** 20 or 22 (set via `NODE_VERSION` env or a `.nvmrc`).
3. Environment variables (under Project → Settings → Environment variables):
   - `VITE_SUPABASE_URL` — your prod Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — the *publishable* (anon) key, NOT the secret/service-role key
   Both are public — baked into the client bundle — so use the anon key only.
4. Save + deploy. Pages will build on every push to `main`.

---

## 6. DNS (optional)

Map a custom domain under Pages → Custom domains. Follow the CNAME instructions the dashboard gives you. Update `APP_BASE_URL` in Supabase secrets (§4) and `Access-Control-Allow-Origin` downstream if the final prod URL differs from what you set during initial provisioning.

---

## 7. Smoke test

Run after every full redeploy.

1. Visit `https://<your-pages-domain>/` — expect the search page with at least the CMS Medicare row visible.
2. Click **Submit a price** → fill the form with:
   - Facility: anything from the typeahead (first few chars should match)
   - Price: a realistic dollar amount
   - Year: current year
   - Had procedure: yes
   - Email: an inbox you can check
3. Submit → expect "Check your email" screen. No submission ID or token should be visible in the response.
4. Receive the confirmation email within ~60 seconds. Click the link.
5. Expect "Submission confirmed" at `/confirm?token=…`.
6. Go back to `/` → your submission should appear in the results list.

If any step fails, check:
- Supabase dashboard → Edge Functions → `submit` → Logs
- Cloudflare Pages → Deployments → latest build log
- Resend dashboard → Logs → look for delivery failures

---

## 8. Routine redeploys

- **Frontend-only change**: push to `main`; Pages rebuilds automatically.
- **Edge Function change**: push + `npx supabase functions deploy submit`.
- **Migration**: push + `npx supabase db push` (reviews the diff before applying).
- **CMS data refresh (quarterly)**: re-run §3 with current-quarter CMS URLs in `tools/cms-etl/src/config.ts`.

---

## 9. Rollback

- **Frontend**: Cloudflare Pages → Deployments → promote an earlier deployment to production.
- **Edge Function**: `npx supabase functions deploy submit` with the previous commit checked out. There's no one-click revert in Supabase.
- **Migration**: no automatic rollback. Hand-write a reverse migration and `db push` it. Test in a throwaway Supabase project first — dropping a live table kills data.

If a rollback is needed under time pressure, the frontend rollback is instant and risk-free. A bad Edge Function or migration is rarer but harder; bias toward a fix-forward commit over a schema-level revert.
