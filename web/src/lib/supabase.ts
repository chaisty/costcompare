import { type SupabaseClient, createClient } from '@supabase/supabase-js';

// Publishable key is safe to embed in the browser bundle — RLS enforces the
// read surface. Fail loudly at module load if the env is missing so a broken
// deploy surfaces on first request rather than looking like a silent network
// error later.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in.',
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
