import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Stub the supabase module so App's import chain doesn't throw on missing env.
vi.mock('./lib/supabase', () => ({ supabase: {} }));

import { App } from './app';

describe('App placeholder', () => {
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
