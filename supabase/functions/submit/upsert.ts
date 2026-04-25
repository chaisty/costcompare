// Upsert-by-NPI helpers. The Edge Function calls these with a service-role
// Supabase client to resolve a CTSS-sourced provider/facility selection
// into the UUID that submit_quote expects.
//
// Trust boundary: the frontend sends NPI + display fields it got back from
// CTSS (which is an NLM-hosted public NPI lookup). We don't re-validate
// against CTSS server-side here — too slow on the hot path. Instead we use
// the frontend's display only on FIRST insert for a given NPI. Subsequent
// submissions for the same NPI keep the existing display, so a malicious
// caller can't poison an existing cache row by spamming submissions with
// fake names.

// deno-lint-ignore no-explicit-any -- supabase-js Database type isn't generated
// for this Deno function; the rpc/from() return types are unknown until we
// codegen. Treat as `any` at the seams and narrow at use.
type SupabaseLike = any;

import type { FacilityNpiInput, ProviderNpiInput } from './validation.ts';

export async function upsertFacilityFromNpi(
  supabase: SupabaseLike,
  input: FacilityNpiInput,
): Promise<string> {
  // 1) Existing row by NPI?
  const { data: byNpi, error: npiErr } = await supabase
    .from('facilities')
    .select('id')
    .eq('npi', input.npi)
    .maybeSingle();
  if (npiErr) throw npiErr;
  if (byNpi) return byNpi.id as string;

  // 2) Cross-validate against POS-sourced ASCs that don't yet have an NPI.
  //    Match on name + state. If found, fill in the NPI on that row rather
  //    than insert a duplicate. Preserves the "Medicare-certified" signal we
  //    inherited from the POS ETL.
  if (input.state) {
    const { data: byNameState, error: nsErr } = await supabase
      .from('facilities')
      .select('id')
      .ilike('name', input.name)
      .eq('state', input.state)
      .is('npi', null)
      .limit(1)
      .maybeSingle();
    if (nsErr) throw nsErr;
    if (byNameState) {
      const { error: upErr } = await supabase
        .from('facilities')
        .update({ npi: input.npi })
        .eq('id', byNameState.id);
      if (upErr) throw upErr;
      return byNameState.id as string;
    }
  }

  // 3) Insert a fresh row. CTSS doesn't reliably tell us the facility_type
  //    enum value (asc/hospital/clinic/etc.) — fall back to 'other' for now;
  //    a follow-up can map taxonomy codes when we wire the picker up.
  const { data: inserted, error: insErr } = await supabase
    .from('facilities')
    .insert({
      npi: input.npi,
      name: input.name,
      facility_type: 'other',
      city: input.city,
      state: input.state,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  return inserted.id as string;
}

export async function upsertProviderFromNpi(
  supabase: SupabaseLike,
  input: ProviderNpiInput,
): Promise<string> {
  const { data: byNpi, error: npiErr } = await supabase
    .from('providers')
    .select('id')
    .eq('npi', input.npi)
    .maybeSingle();
  if (npiErr) throw npiErr;
  if (byNpi) return byNpi.id as string;

  const { data: inserted, error: insErr } = await supabase
    .from('providers')
    .insert({
      npi: input.npi,
      first_name: input.first_name,
      last_name: input.last_name,
      credential: input.credential,
      primary_taxonomy_code: input.taxonomy_code,
      primary_taxonomy_label: input.taxonomy_label,
      practice_city: input.practice_city,
      practice_state: input.practice_state,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  return inserted.id as string;
}
