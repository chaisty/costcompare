import type { SupabaseClient } from '@supabase/supabase-js';
import { UPSERT_BATCH_SIZE } from '../config.ts';
import type { FacilityRow } from './parse.ts';

export type UpsertStats = {
  batches: number;
  rowsAttempted: number;
};

// Upsert facility rows by external_id (unique index on `facilities.external_id`
// where not null). The `updated_at` trigger on the facilities table handles
// the modified timestamp automatically.
export async function upsertFacilities(
  db: SupabaseClient,
  rows: FacilityRow[],
): Promise<UpsertStats> {
  let batches = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await db
      .from('facilities')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: false });
    if (error) {
      throw new Error(
        `facilities upsert failed at batch ${batches} (rows ${i}..${i + batch.length}): ${error.message}`,
      );
    }
    batches += 1;
  }
  return { batches, rowsAttempted: rows.length };
}
