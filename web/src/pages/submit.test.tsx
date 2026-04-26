import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  submitQuote: vi.fn(),
  resendConfirmation: vi.fn(),
}));

vi.mock('../lib/ctss', () => ({
  searchCtssOrganizations: vi.fn(),
  searchCtssProviders: vi.fn(),
}));

import { resendConfirmation, submitQuote } from '../lib/api';
import { searchCtssOrganizations, searchCtssProviders } from '../lib/ctss';
import { SubmitPage } from './submit';

function renderPage() {
  return render(
    <MemoryRouter>
      <SubmitPage />
    </MemoryRouter>,
  );
}

const fakeFacility = {
  npi: '1111111111',
  name: 'Alpha Surgery Center',
  city: 'San Francisco',
  state: 'CA',
  taxonomy: 'Ambulatory Surgical',
};

const fakeProvider = {
  npi: '2222222222',
  first_name: 'Jane',
  last_name: 'Smith',
  practice_city: 'San Francisco',
  practice_state: 'CA',
  taxonomy: 'Pain Medicine',
};

async function fillForm({ withProvider = true, withFacility = true } = {}) {
  renderPage();
  const user = userEvent.setup();
  vi.mocked(searchCtssOrganizations).mockResolvedValue([fakeFacility]);
  vi.mocked(searchCtssProviders).mockResolvedValue([fakeProvider]);

  if (withProvider) {
    await user.type(screen.getByPlaceholderText(/search by physician/i), 'Smith');
    await waitFor(() => expect(screen.getByText(/SMITH, JANE|Smith, Jane/)).toBeInTheDocument());
    await user.click(screen.getByText(/SMITH, JANE|Smith, Jane/));
  }
  if (withFacility) {
    await user.type(screen.getByPlaceholderText(/search by facility/i), 'Alpha');
    await waitFor(() => expect(screen.getByText('Alpha Surgery Center')).toBeInTheDocument());
    await user.click(screen.getByText('Alpha Surgery Center'));
  }

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

  it('renders both pickers, the at-least-one hint, and the pre-submit disclaimer', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/submit a cash-pay price/i);
    expect(screen.getByPlaceholderText(/search by physician/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search by facility/i)).toBeInTheDocument();
    expect(screen.getByText(/pick at least one/i)).toBeInTheDocument();
    expect(screen.getByText(/not medical or financial advice/i)).toBeInTheDocument();
  });

  it('shows pick-at-least-one error when neither provider nor facility chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/quoted price/i), '8500');
    await user.clear(screen.getByLabelText(/year of quote/i));
    await user.type(screen.getByLabelText(/year of quote/i), '2025');
    await user.click(screen.getByLabelText(/^yes$/i));
    await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText(/pick at least one: provider or facility/i)).toBeInTheDocument();
    expect(submitQuote).not.toHaveBeenCalled();
  });

  it('submits provider-only and switches to "check your email" view', async () => {
    vi.mocked(submitQuote).mockResolvedValue({ ok: true, message: 'ok' });
    const user = await fillForm({ withProvider: true, withFacility: false });
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/check your email/i),
    );
    expect(submitQuote).toHaveBeenCalledTimes(1);
    const call = vi.mocked(submitQuote).mock.calls[0]?.[0];
    expect(call?.provider?.npi).toBe('2222222222');
    expect(call?.facility).toBeUndefined();
  });

  it('submits both provider and facility together', async () => {
    vi.mocked(submitQuote).mockResolvedValue({ ok: true, message: 'ok' });
    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/check your email/i),
    );
    const call = vi.mocked(submitQuote).mock.calls[0]?.[0];
    expect(call?.provider?.npi).toBe('2222222222');
    expect(call?.facility?.npi).toBe('1111111111');
  });

  it('disables the submit button while in flight', async () => {
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/submit a cash-pay price/i);
  });

  it('shows a Resend the link button on the check-your-email view and switches to "Sent" on success', async () => {
    vi.mocked(submitQuote).mockResolvedValue({ ok: true, message: 'ok' });
    vi.mocked(resendConfirmation).mockResolvedValue({ ok: true, message: 'vague-ok' });
    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/check your email/i),
    );

    const resendButton = screen.getByRole('button', { name: /resend the link/i });
    expect(resendButton).toBeEnabled();
    await user.click(resendButton);
    expect(resendConfirmation).toHaveBeenCalledWith('alice@example.com');
    await waitFor(() => expect(screen.getByText(/sent\. check your inbox/i)).toBeInTheDocument());
  });

  it('surfaces resend_limit_exceeded as a readable error', async () => {
    vi.mocked(submitQuote).mockResolvedValue({ ok: true, message: 'ok' });
    vi.mocked(resendConfirmation).mockResolvedValue({
      ok: false,
      error: 'resend_limit_exceeded',
    });
    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/check your email/i),
    );
    await user.click(screen.getByRole('button', { name: /resend the link/i }));
    expect(
      await screen.findByText(/resent the confirmation link too many times/i),
    ).toBeInTheDocument();
    // Resend button still visible (user can submit fresh) — error doesn't hide it.
    expect(screen.getByRole('button', { name: /resend the link/i })).toBeEnabled();
  });

  it('forwards the State filter to both CTSS calls', async () => {
    vi.mocked(searchCtssOrganizations).mockResolvedValue([]);
    vi.mocked(searchCtssProviders).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText(/state \(optional/i), 'CA');
    // Provider picker first (above facility in the form).
    await user.type(screen.getByPlaceholderText(/search by physician/i), 'Smith');
    await waitFor(() =>
      expect(searchCtssProviders).toHaveBeenCalledWith(
        'Smith',
        expect.objectContaining({ state: 'CA' }),
      ),
    );

    await user.type(screen.getByPlaceholderText(/search by facility/i), 'Alpha');
    await waitFor(() =>
      expect(searchCtssOrganizations).toHaveBeenCalledWith(
        'Alpha',
        expect.objectContaining({ state: 'CA' }),
      ),
    );
  });
});
