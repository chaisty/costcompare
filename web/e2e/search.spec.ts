import { expect, test } from '@playwright/test';

const SEARCH_RPC = '**/rest/v1/rpc/search_rates*';

test.describe('search page (smoke)', () => {
  // The header layout always renders a "Submit a price" link, so locators by
  // role+name need to be scoped to <main> when the test cares about an
  // in-page (empty-state, content) link rather than the nav link.

  test('renders the heading and a populated rate row from the mocked API', async ({ page }) => {
    await page.route(SEARCH_RPC, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: [
            {
              rate_type: 'medicare',
              price: 9891.33,
              rate_year: 2026,
              procedure_codes: ['64628'],
              facility_id: null,
              facility_name: null,
              facility_state: null,
              facility_external_id: null,
              provider_id: null,
              provider_name: null,
              provider_credential: null,
              provider_specialty: null,
              provider_state: null,
              locality: 'NATIONAL-UNADJUSTED',
              payer: null,
              plan_variant: null,
              source_url: 'https://www.cms.gov/test',
              source_fetched_at: '2026-04-25T00:00:00Z',
              confidence_note: null,
            },
          ],
          limit: 50,
          has_more: false,
          next_cursor: null,
        }),
      }),
    );

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/cash-pay prices/i);
    const main = page.getByRole('main');
    await expect(main.getByText('$9,891.33')).toBeVisible();
    await expect(main.getByText(/medicare/i).first()).toBeVisible();
  });

  test('renders the empty state when the API returns no rows', async ({ page }) => {
    await page.route(SEARCH_RPC, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: [],
          limit: 50,
          has_more: false,
          next_cursor: null,
        }),
      }),
    );

    await page.goto('/');
    const main = page.getByRole('main');
    await expect(main.getByText(/no rates yet/i)).toBeVisible();
    await expect(main.getByRole('link', { name: /submit a price/i })).toBeVisible();
  });

  test('shows a Load more button when has_more is true and appends a page', async ({ page }) => {
    let call = 0;
    await page.route(SEARCH_RPC, (route) => {
      call += 1;
      if (call === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            results: [makeRow({ price: 100 })],
            limit: 1,
            has_more: true,
            next_cursor: 'fake-cursor-1',
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          results: [makeRow({ price: 200 })],
          limit: 1,
          has_more: false,
          next_cursor: null,
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('$100.00')).toBeVisible();
    await page.getByRole('button', { name: /load more/i }).click();
    await expect(page.getByText('$200.00')).toBeVisible();
    await expect(page.getByText('$100.00')).toBeVisible();
    await expect(page.getByRole('button', { name: /load more/i })).toHaveCount(0);
  });
});

function makeRow(over: { price: number }) {
  return {
    rate_type: 'cash',
    price: over.price,
    rate_year: 2025,
    procedure_codes: ['64628'],
    facility_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    facility_name: 'Smoke Test Center',
    facility_state: 'CA',
    facility_external_id: null,
    provider_id: null,
    provider_name: null,
    provider_credential: null,
    provider_specialty: null,
    provider_state: null,
    locality: null,
    payer: null,
    plan_variant: null,
    source_url: null,
    source_fetched_at: null,
    confidence_note: null,
  };
}
