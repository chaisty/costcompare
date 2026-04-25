import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  confirmSubmission: vi.fn(),
}));

import { confirmSubmission } from '../lib/api';
import { ConfirmPage } from './confirm';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmPage />
    </MemoryRouter>,
  );
}

describe('ConfirmPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the missing-token state when ?token is absent', () => {
    renderAt('/confirm');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /missing confirmation token/i,
    );
    expect(confirmSubmission).not.toHaveBeenCalled();
  });

  it('shows a loading state while the RPC is in flight, then success', async () => {
    vi.mocked(confirmSubmission).mockResolvedValue({ ok: true });
    renderAt('/confirm?token=abc123');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/confirming/i);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/submission confirmed/i),
    );
    expect(screen.getByRole('link', { name: /submit another price/i })).toBeInTheDocument();
  });

  it.each([
    ['invalid_token', /this confirmation link is invalid/i],
    ['already_confirmed', /already confirmed/i],
    ['rejected', /was rejected/i],
    ['token_expired', /has expired/i],
  ] as const)('renders a distinct message for %s', async (code, match) => {
    vi.mocked(confirmSubmission).mockResolvedValue({ ok: false, error: code });
    renderAt('/confirm?token=abc123');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(match));
  });

  it('falls back to the network-error state when the RPC throws', async () => {
    vi.mocked(confirmSubmission).mockRejectedValue(new Error('boom'));
    renderAt('/confirm?token=abc123');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/could not reach/i),
    );
  });
});
