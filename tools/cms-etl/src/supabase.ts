import { type SupabaseClient, createClient } from '@supabase/supabase-js';

// Service-role client. Bypasses RLS — never ship this key to a browser bundle.
// The Edge Function deployment pattern exposes this via a server-only env var;
// locally it comes from .env.

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env ' +
        'and fill in the values from `npx supabase status`.',
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
