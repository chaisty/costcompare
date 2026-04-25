import type { SupabaseClient } from '@supabase/supabase-js';
import { UPSERT_BATCH_SIZE } from '../config.ts';
import type { NppesOrgRow } from './parse.ts';

export type UpsertStats = {
  candidates: number;
  alreadyKnownByNpi: number;
  ambiguousNameStateMatch: number;
  inserted: number;
  crosswalkUpdated: number;
  insertBatches: number;
  updateBatches: number;
};

export type ExistingFacility = {
  id: string;
  name: string | null;
  state: string | null;
  npi: string | null;
};

export type UpsertPlan = {
  toInsert: NppesOrgRow[];
  toUpdate: { id: string; npi: string }[];
  alreadyKnownByNpi: number;
  ambiguousNameStateMatch: number;
};

// Decide insert vs crosswalk-update vs skip for each candidate. Pure so the
// decision can be unit-tested without a Supabase mock.
//
// Crosswalk rule: if an existing row has the same lower(name) + state and no
// NPI, it's almost certainly the same physical facility (POS-sourced or seeded
// from elsewhere) and we just need to attach the NPI. If a row already has an
// NPI on the same name+state, we have an ambiguity — count it but don't write,
// to avoid silently merging two distinct facilities.
export function planNppesUpsert(
  existing: ExistingFacility[],
  candidates: NppesOrgRow[],
): UpsertPlan {
  const byNpi = new Set<string>();
  const byNameState = new Map<string, ExistingFacility>();
  for (const row of existing) {
    if (row.npi) byNpi.add(row.npi);
    if (row.name && row.state) {
      byNameState.set(`${row.name.toLowerCase()}::${row.state}`, row);
    }
  }

  const toInsert: NppesOrgRow[] = [];
  const toUpdate: { id: string; npi: string }[] = [];
  let alreadyKnownByNpi = 0;
  let ambiguousNameStateMatch = 0;

  for (const c of candidates) {
    if (byNpi.has(c.npi)) {
      alreadyKnownByNpi += 1;
      continue;
    }
    if (!c.state) {
      // No state to crosswalk on; safest to insert (there are very few of these).
      toInsert.push(c);
      byNpi.add(c.npi);
      continue;
    }
    const key = `${c.name.toLowerCase()}::${c.state}`;
    const match = byNameState.get(key);
    if (!match) {
      toInsert.push(c);
      byNpi.add(c.npi);
      continue;
    }
    if (match.npi) {
      // An existing facility already has an NPI under this name+state but it
      // doesn't match the candidate's NPI. Could be a real distinct facility
      // sharing a name (chains like "Surgery Center of XYZ"), or a stale row.
      // Don't merge — record and move on.
      ambiguousNameStateMatch += 1;
      continue;
    }
    toUpdate.push({ id: match.id, npi: c.npi });
    // Reserve the npi so a duplicate candidate within the same run doesn't
    // try to insert it again. Also mark the existing row as having an NPI
    // (in our local map) so a second candidate name-matching the same row
    // falls into the ambiguous bucket instead of double-writing the update.
    byNpi.add(c.npi);
    match.npi = c.npi;
  }

  return { toInsert, toUpdate, alreadyKnownByNpi, ambiguousNameStateMatch };
}

export async function upsertNppesOrgs(
  db: SupabaseClient,
  candidates: NppesOrgRow[],
): Promise<UpsertStats> {
  const existing = await loadExistingFacilities(db);
  const plan = planNppesUpsert(existing, candidates);

  const stats: UpsertStats = {
    candidates: candidates.length,
    alreadyKnownByNpi: plan.alreadyKnownByNpi,
    ambiguousNameStateMatch: plan.ambiguousNameStateMatch,
    inserted: 0,
    crosswalkUpdated: 0,
    insertBatches: 0,
    updateBatches: 0,
  };
  const toInsert = plan.toInsert;
  const toUpdate = plan.toUpdate;

  for (let i = 0; i < toInsert.length; i += UPSERT_BATCH_SIZE) {
    const batch = toInsert.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await db.from('facilities').insert(batch);
    if (error) {
      throw new Error(
        `nppes insert failed at batch ${stats.insertBatches} (rows ${i}..${i + batch.length}): ${error.message}`,
      );
    }
    stats.inserted += batch.length;
    stats.insertBatches += 1;
  }

  for (let i = 0; i < toUpdate.length; i += UPSERT_BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + UPSERT_BATCH_SIZE);
    // Upsert with onConflict='id' is INSERT ON CONFLICT (id) DO UPDATE — every
    // row in the batch already has an existing id, so this is effectively a
    // batched UPDATE that only sets the npi column.
    const { error } = await db
      .from('facilities')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });
    if (error) {
      throw new Error(
        `nppes crosswalk update failed at batch ${stats.updateBatches} (rows ${i}..${i + batch.length}): ${error.message}`,
      );
    }
    stats.crosswalkUpdated += batch.length;
    stats.updateBatches += 1;
  }

  return stats;
}

async function loadExistingFacilities(db: SupabaseClient): Promise<ExistingFacility[]> {
  // Page through 1000 at a time; PostgREST default cap is 1000 per request.
  const PAGE = 1000;
  const out: ExistingFacility[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('facilities')
      .select('id, name, state, npi')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`facilities load failed at offset ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as ExistingFacility[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
