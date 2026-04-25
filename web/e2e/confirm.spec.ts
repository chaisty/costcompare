import { expect, test } from '@playwright/test';

const CONFIRM_RPC = '**/rest/v1/rpc/confirm_submission*';

test.describe('confirm page (smoke)', () => {
  test('shows the missing-token state when no token query param is supplied', async ({ page }) => {
    await page.goto('/confirm');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /missing confirmation token/i,
    );
    // Scope to <main> — the header layout has its own nav links that share
    // the role+name pattern.
    await expect(
      page.getByRole('main').getByRole('link', { name: /submission form/i }),
    ).toBeVisible();
  });

  test('shows the success state when the API returns ok', async ({ page }) => {
    await page.route(CONFIRM_RPC, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    );

    await page.goto('/confirm?token=fake-but-routed-to-success');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/submission confirmed/i);
    await expect(page.getByRole('link', { name: /submit another price/i })).toBeVisible();
  });

  test('shows the invalid-token state when the API returns invalid_token', async ({ page }) => {
    await page.route(CONFIRM_RPC, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'invalid_token' }),
      }),
    );

    await page.goto('/confirm?token=clearly-bogus');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /confirmation link is invalid/i,
    );
  });
});
