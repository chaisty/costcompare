import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  submitQuote: vi.fn(),
}));

vi.mock('../lib/facilities', () => ({
  searchFacilities: vi.fn(),
}));

import { submitQuote } from '../lib/api';
import { searchFacilities } from '../lib/facilities';
import { SubmitPage } from './submit';

function renderPage() {
  return render(
    <MemoryRouter>
      <SubmitPage />
    </MemoryRouter>,
  );
}

const fakeFacility = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test ASC',
  city: 'Testville',
  state: 'CA',
};

async function fillForm() {
  renderPage();
  const user = userEvent.setup();
  vi.mocked(searchFacilities).mockResolvedValue([fakeFacility]);

  await user.type(screen.getByPlaceholderText(/search by facility/i), 'Test');
  await waitFor(() => expect(screen.getByText('Test ASC')).toBeInTheDocument());
  await user.click(screen.getByText('Test ASC'));

  await user.type(screen.getByLabelText(/quoted price/i), '8500');
  await user.clear(screen.getByLabelText(/year of quote/i));
  await user.type(screen.getByLabelText(/year of quote/i), '2025');
  await user.click(screen.getByLabelText(/^yes$/i));
  await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
  return user;
}

describe('SubmitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders every required field and the pre-submit disclaimer', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/submit a cash-pay price/i);
    expect(screen.getByPlaceholderText(/search by facility/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/quoted price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/year of quote/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^yes$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByText(/not medical or financial advice/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeEnabled();
  });

  it('shows validation errors when submitting an empty form', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText(/pick a facility/i)).toBeInTheDocument();
    expect(screen.getByText(/price between \$0\.01/i)).toBeInTheDocument();
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(submitQuote).not.toHaveBeenCalled();
  });

  it('submits a valid form and switches to the "check your email" state', async () => {
    vi.mocked(submitQuote).mockResolvedValue({
      ok: true,
      message: 'Check your email to confirm your submission.',
    });

    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: /^submit$/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/check your email/i),
    );
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
    expect(submitQuote).toHaveBeenCalledTimes(1);
  });

  it('disables the submit button while in flight (prevents double-submit)', async () => {
    // Resolve the mock on a deferred promise so we can observe the in-flight state.
    let resolveCall: (v: { ok: true; message: string }) => void = () => {};
    vi.mocked(submitQuote).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        }),
    );

    const user = await fillForm();
    const submitButton = screen.getByRole('button', { name: /^submit$/i });
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent(/submitting/i);

    // Try to click again — should not re-invoke.
    await user.click(submitButton);
    expect(submitQuote).toHaveBeenCalledTimes(1);

    resolveCall({ ok: true, message: 'ok' });
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/check your email/i),
    );
  });

  it('surfaces a readable error when the API returns rate_limited_email', async () => {
    vi.mocked(submitQuote).mockResolvedValue({ ok: false, error: 'rate_limited_email' });
    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText(/submitted too many times/i)).toBeInTheDocument();
    // Form stays visible; user can retry after fixing.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/submit a cash-pay price/i);
  });
});
