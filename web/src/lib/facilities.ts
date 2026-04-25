import { supabase } from './supabase';

export type Facility = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
};

export async function searchFacilities(query: string, limit = 10): Promise<Facility[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  // PostgREST's ilike accepts SQL wildcards. Escape % and _ in user input so a
  // pasted name with those chars doesn't get interpreted as a wildcard.
  const escaped = trimmed.replace(/([%_])/g, '\\$1');
  const pattern = `%${escaped}%`;

  const { data, error } = await supabase
    .from('facilities')
    .select('id, name, city, state')
    .ilike('name', pattern)
    .order('name')
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Facility[];
}
