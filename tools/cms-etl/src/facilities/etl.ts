import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadCached } from '../cache.ts';
import { POS_CSV_URL, POS_RELEASE_QUARTER } from '../config.ts';
import { parsePosCsv } from './parse.ts';
import { upsertFacilities } from './upsert.ts';

export type FacilitiesEtlResult = {
  downloadedPath: string;
  parsed: number;
  upserted: number;
  batches: number;
  release: string;
};

export async function runFacilitiesEtl(
  db: SupabaseClient,
  options: { refresh?: boolean } = {},
): Promise<FacilitiesEtlResult> {
  const downloadedPath = await downloadCached(
    POS_CSV_URL,
    `pos_${POS_RELEASE_QUARTER}.csv`,
    options,
  );
  const csv = await readFile(downloadedPath, 'utf-8');
  const facilities = parsePosCsv(csv);
  const stats = await upsertFacilities(db, facilities);
  return {
    downloadedPath,
    parsed: facilities.length,
    upserted: stats.rowsAttempted,
    batches: stats.batches,
    release: POS_RELEASE_QUARTER,
  };
}
