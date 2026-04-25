import type { SupabaseClient } from '@supabase/supabase-js';
import { type NppesOrgRow, parseNppesOrgsStream } from './parse.ts';
import { type UpsertStats, upsertNppesOrgs } from './upsert.ts';

export type NppesOrgsEtlResult = {
  csvPath: string;
  rowsScanned: number;
  rowsMatched: number;
  upsert: UpsertStats;
};

export async function runNppesOrgsEtl(
  db: SupabaseClient,
  options: { csvPath: string },
): Promise<NppesOrgsEtlResult> {
  // Stream-parse the (potentially multi-GB) NPPES full file, accumulating
  // only the rows that pass the taxonomy + entity-type + active filter.
  // Filtered output is small enough to keep in memory (~17K rows for the
  // five taxonomies we accept).
  const matched: NppesOrgRow[] = [];
  const parseStats = await parseNppesOrgsStream(options.csvPath, (row) => {
    matched.push(row);
  });

  const upsertStats = await upsertNppesOrgs(db, matched);

  return {
    csvPath: options.csvPath,
    rowsScanned: parseStats.rowsScanned,
    rowsMatched: parseStats.rowsMatched,
    upsert: upsertStats,
  };
}
