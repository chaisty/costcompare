import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Stub downstream modules so App's render chain doesn't touch supabase env
// or trigger real network calls during the smoke test.
vi.mock('./lib/supabase', () => ({ supabase: {} }));
vi.mock('./lib/api', () => ({
  submitQuote: vi.fn(),
  confirmSubmission: vi.fn(),
  searchRates: vi
    .fn()
    .mockResolvedValue({ ok: true, results: [], limit: 50, offset: 0, has_more: false }),
}));
vi.mock('./lib/ctss', () => ({
  searchCtssOrganizations: vi.fn().mockResolvedValue([]),
  searchCtssProviders: vi.fn().mockResolvedValue([]),
}));

import { App } from './app';

describe('App shell', () => {
  it('renders the brand in the header', () => {
    render(<App />);
    expect(screen.getAllByText(/CostCompare/i).length).toBeGreaterThan(0);
  });

  it('renders the disclaimer block with "not medical advice" language', () => {
    render(<App />);
    expect(screen.getByText(/not medical, legal, or financial advice/i)).toBeInTheDocument();
  });

  it('discloses that cash-pay prices are patient-submitted', () => {
    render(<App />);
    expect(screen.getByText(/submitted by individual patients/i)).toBeInTheDocument();
  });
});
