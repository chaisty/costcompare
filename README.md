# CostCompare

A web app where patients submit and search cash-pay quoted rates for medical procedures.

MVP is scoped to a single procedure — CPT **64628** (Intracept) — with supplementary publicly available Medicare and insurer-negotiated rates where obtainable. The data model is built for expansion to additional procedures; only the UI is single-procedure.

## Status

Phase 0 — project docs and scaffolding. See [`CLAUDE.md`](./CLAUDE.md) for architecture, conventions, and the workflow loop.

## Stack

- Vite + React + TypeScript (Biome, Vitest)
- Supabase (Postgres + RLS) — free tier
- Resend — transactional email for submission confirmations
- Cloudflare Pages — static hosting

## Data sources

- **Cash-pay:** user submissions, email-confirmed, rate-limited.
- **Medicare:** CMS ASC fee schedules.
- **Negotiated:** Transparency-in-Coverage machine-readable files, pre-processed locally before upload.

## Disclaimers

This site surfaces **user-submitted quotes** and **automatically-parsed insurance data** for informational purposes. Individual quotes may be inaccurate, stale, or fabricated — treat them as a starting point, not a guarantee. Insurance-negotiated rates are parsed from publicly posted payer files with automated procedures and are not 100% verified. Nothing on this site is medical, legal, or financial advice.
