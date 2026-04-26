import { defineConfig, devices } from '@playwright/test';

// Smoke tests run against `vite dev --mode test --port 5180` so they don't
// collide with a developer's local dev server (commonly 5173/5174). Mode
// 'test' loads `.env.test` which carries valid-shape stub Supabase
// credentials; every outbound API call is mocked via page.route() in the
// specs themselves.
//
// --strictPort makes vite fail fast if 5180 is taken instead of silently
// falling through to 5181 — a fall-through would leave Playwright's
// healthcheck pointing at the wrong URL.

// 51234 is in the user-ephemeral range (49152+) and verified free at the
// time of this commit; --strictPort makes vite fail fast if the user's
// concurrent dev envs collide on it. If you see "Port 51234 already in use"
// at startup, scan with `netstat -ano | grep ":<port> "` for a free port
// in this range and bump the constant rather than letting vite fall through
// to a different port (which would leave Playwright's healthcheck stranded).
const PORT = 51234;

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  // CI uses two reporters: 'github' annotates failures inline on the PR
  // diff; 'html' writes playwright-report/ which the workflow uploads as
  // an artifact for debugging failed runs.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Pin host to 127.0.0.1 explicitly — on Windows, "localhost" resolves to
  // ::1 (IPv6) by default but Playwright's HTTP healthcheck targets IPv4 by
  // default, which can leave the spawned dev server unreachable from the
  // healthcheck even though it's listening.
  webServer: {
    command: `npm run dev -- --mode test --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
