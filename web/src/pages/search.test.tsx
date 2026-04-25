import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  searchRates: vi.fn(),
}));

import { searchRates } from '../lib/api';
import { SearchPage } from './search';

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>,
  );
}

const medicareRow = {
  rate_type: 'medicare' as const,
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
  source_fetched_at: '2026-04-25T00:06:40.793187+00:00',
  confidence_note: null,
};

const cashRow = {
  rate_type: 'cash' as const,
  price: 8500.0,
  rate_year: 2025,
  procedure_codes: ['64628'],
  facility_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  facility_name: 'Alpha Surgical Center',
  facility_state: 'CA',
  facility_external_id: '12-3456',
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

const cashProviderRow = {
  rate_type: 'cash' as const,
  price: 7500.0,
  rate_year: 2025,
  procedure_codes: ['64628'],
  facility_id: null,
  facility_name: null,
  facility_state: null,
  facility_external_id: null,
  provider_id: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
  provider_name: 'Jane Smith',
  provider_credential: 'MD',
  provider_specialty: 'Pain Medicine',
  provider_state: 'CA',
  locality: null,
  payer: null,
  plan_variant: null,
  source_url: null,
  source_fetched_at: null,
  confidence_note: null,
};

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while the API resolves', async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.mocked(searchRates).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r as typeof resolve;
        }),
    );
    renderPage();
    expect(screen.getByText(/loading rates/i)).toBeInTheDocument();
    resolve({ ok: true, results: [], limit: 50, offset: 0, has_more: false });
    await waitFor(() => expect(screen.queryByText(/loading rates/i)).not.toBeInTheDocument());
  });

  it('renders an empty state with a submit link when no rows match', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    expect(await screen.findByText(/no rates yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /submit a price/i })).toHaveAttribute(
      'href',
      '/submit',
    );
  });

  it('renders an error state when the API fails', async () => {
    vi.mocked(searchRates).mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/could not reach costcompare/i)).toBeInTheDocument();
  });

  it('renders a medicare row with provenance, year, and source badge', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [medicareRow],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    const list = await screen.findByRole('list', { name: /search results/i });
    const item = within(list).getByRole('listitem');
    expect(within(item).getByText(/^\$9,891\.33$/)).toBeInTheDocument();
    expect(within(item).getByText(/medicare/i)).toBeInTheDocument();
    expect(within(item).getByText('2026')).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: /source/i })).toHaveAttribute(
      'href',
      'https://www.cms.gov/test',
    );
  });

  it('renders a cash row with a "Report this submission" stub', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [cashRow],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    const list = await screen.findByRole('list', { name: /search results/i });
    const item = within(list).getByRole('listitem');
    expect(within(item).getByText(/^\$8,500\.00$/)).toBeInTheDocument();
    expect(within(item).getByText(/alpha surgical center/i)).toBeInTheDocument();
    expect(within(item).getByText(/^\(CA\)$/)).toBeInTheDocument();
    expect(within(item).getByText(/user-submitted/i)).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: /report this submission/i })).toBeInTheDocument();
  });

  it('renders the Medicare-listed badge when facility_external_id is set', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [cashRow],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    const list = await screen.findByRole('list', { name: /search results/i });
    expect(within(list).getByText(/medicare-listed/i)).toBeInTheDocument();
  });

  it('does not render the Medicare-listed badge when facility_external_id is null', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [cashProviderRow],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    await screen.findByRole('list', { name: /search results/i });
    expect(screen.queryByText(/medicare-listed/i)).not.toBeInTheDocument();
  });

  it('renders provider name + specialty for a provider-only cash row', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [cashProviderRow],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    const list = await screen.findByRole('list', { name: /search results/i });
    expect(within(list).getByText(/jane smith/i)).toBeInTheDocument();
    expect(within(list).getByText(/MD/)).toBeInTheDocument();
    expect(within(list).getByText(/pain medicine/i)).toBeInTheDocument();
  });

  it('never renders email addresses or source_submission_id in the DOM', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [medicareRow, cashRow],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    const { container } = renderPage();
    await screen.findByRole('list', { name: /search results/i });
    const html = container.innerHTML;
    // No email-shaped strings (except the mailto report link, which is a
    // CostCompare contact address, not a submitter). Assert there is no "@"
    // attached to the submitter's email domain specifically.
    expect(html).not.toMatch(/[A-Za-z0-9._%+-]+@example\.(com|org)/);
    expect(html.toLowerCase()).not.toContain('source_submission_id');
  });

  it('calls searchRates with the selected state filter', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    await waitFor(() => expect(searchRates).toHaveBeenCalled());
    vi.mocked(searchRates).mockClear();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/^state$/i), 'CA');
    await waitFor(() => expect(searchRates).toHaveBeenCalledWith({ state: 'CA' }));
  });

  it('calls searchRates with the selected rate_type when "Source" filter changes', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    await waitFor(() => expect(searchRates).toHaveBeenCalled());
    vi.mocked(searchRates).mockClear();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/^source$/i), 'medicare');
    await waitFor(() => expect(searchRates).toHaveBeenCalledWith({ rate_type: 'medicare' }));
  });

  it('passes year_from and year_to as the same year when "Year" filter is set', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    await waitFor(() => expect(searchRates).toHaveBeenCalled());
    vi.mocked(searchRates).mockClear();

    const user = userEvent.setup();
    const yearSelect = screen.getByLabelText(/^year$/i);
    const firstYear = Number((yearSelect as HTMLSelectElement).options[1]?.value ?? '0');
    await user.selectOptions(yearSelect, String(firstYear));
    await waitFor(() =>
      expect(searchRates).toHaveBeenCalledWith({ year_from: firstYear, year_to: firstYear }),
    );
  });

  it('combines all three filters into a single searchRates call', async () => {
    vi.mocked(searchRates).mockResolvedValue({
      ok: true,
      results: [],
      limit: 50,
      offset: 0,
      has_more: false,
    });
    renderPage();
    await waitFor(() => expect(searchRates).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/^state$/i), 'CA');
    await user.selectOptions(screen.getByLabelText(/^source$/i), 'cash');
    const yearSelect = screen.getByLabelText(/^year$/i);
    const firstYear = Number((yearSelect as HTMLSelectElement).options[1]?.value ?? '0');
    await user.selectOptions(yearSelect, String(firstYear));

    await waitFor(() =>
      expect(searchRates).toHaveBeenLastCalledWith({
        state: 'CA',
        rate_type: 'cash',
        year_from: firstYear,
        year_to: firstYear,
      }),
    );
  });
});
