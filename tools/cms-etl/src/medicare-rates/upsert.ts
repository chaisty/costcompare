import type { SupabaseClient } from '@supabase/supabase-js';
import { ASC_FEE_SCHEDULE_YEAR, NATIONAL_UNADJUSTED_LOCALITY } from '../config.ts';
import type { MedicareRateRow } from './parse.ts';

// Replace every row in the (medicare, rate_year, NATIONAL-UNADJUSTED) scope
// with the new set. Two-step delete-then-insert; there is a brief window
// during which the row set is missing. For a read-mostly public API where
// this script runs quarterly, the race is acceptable. Phase-2 work that
// introduces per-locality rows should move this to a server-side RPC that
// wraps both statements in a single transaction.

export type MedicareUpsertStats = {
  deleted: number;
  inserted: number;
};

export async function replaceMedicareNationalRates(
  db: SupabaseClient,
  rows: MedicareRateRow[],
): Promise<MedicareUpsertStats> {
  // Refuse to wipe existing data when the parser produces nothing. A format
  // change upstream that makes us parse zero rows must not silently empty the
  // Medicare scope — force a loud failure so the operator investigates.
  if (rows.length === 0) {
    throw new Error(
      'replaceMedicareNationalRates: parser returned 0 rows. Refusing to wipe the ' +
        '(medicare, rate_year, locality) scope. Check upstream file format and parser.',
    );
  }

  const { error: delErr, count: deleted } = await db
    .from('rates')
    .delete({ count: 'exact' })
    .eq('rate_type', 'medicare')
    .eq('rate_year', ASC_FEE_SCHEDULE_YEAR)
    .eq('locality', NATIONAL_UNADJUSTED_LOCALITY);
  if (delErr) {
    throw new Error(`medicare rates delete failed: ${delErr.message}`);
  }

  const { error: insErr, count: inserted } = await db
    .from('rates')
    .insert(rows, { count: 'exact' });
  if (insErr) {
    throw new Error(`medicare rates insert failed: ${insErr.message}`);
  }

  return { deleted: deleted ?? 0, inserted: inserted ?? rows.length };
}
