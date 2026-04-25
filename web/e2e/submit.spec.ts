import { expect, test } from '@playwright/test';

test.describe('submit page (smoke)', () => {
  test('renders the form fields and the disclaimer', async ({ page }) => {
    await page.goto('/submit');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/submit a cash-pay price/i);
    await expect(page.getByPlaceholder(/search by physician/i)).toBeVisible();
    await expect(page.getByPlaceholder(/search by facility/i)).toBeVisible();
    await expect(page.getByLabel(/quoted price/i)).toBeVisible();
    await expect(page.getByLabel(/year of quote/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByText(/not medical or financial advice/i)).toBeVisible();
  });

  test('shows the pick-at-least-one error when neither picker is set', async ({ page }) => {
    await page.goto('/submit');
    await page.getByLabel(/quoted price/i).fill('8500');
    await page.getByLabel(/year of quote/i).fill('2025');
    await page.getByLabel(/^yes$/i).check();
    await page.getByLabel(/email/i).fill('alice@example.com');
    await page.getByRole('button', { name: /^submit$/i }).click();
    await expect(page.getByText(/pick at least one: provider or facility/i)).toBeVisible();
  });
});
