import type { SupabaseClient } from '@supabase/supabase-js';
import AdmZip from 'adm-zip';
import { downloadCached } from '../cache.ts';
import {
  ADDENDUM_AA_FILENAME_PATTERN,
  ASC_FEE_SCHEDULE_RELEASE,
  ASC_FEE_SCHEDULE_ZIP_URL,
} from '../config.ts';
import { parseAddendumAa } from './parse.ts';
import { replaceMedicareNationalRates } from './upsert.ts';

export type MedicareRatesEtlResult = {
  downloadedPath: string;
  addendumFilename: string;
  parsed: number;
  inserted: number;
  deleted: number;
  release: string;
};

export async function runMedicareRatesEtl(
  db: SupabaseClient,
  options: { refresh?: boolean } = {},
): Promise<MedicareRatesEtlResult> {
  const zipFilename = `asc_fee_schedule_${ASC_FEE_SCHEDULE_RELEASE.replace(/\s+/g, '_').toLowerCase()}.zip`;
  const downloadedPath = await downloadCached(ASC_FEE_SCHEDULE_ZIP_URL, zipFilename, options);

  const zip = new AdmZip(downloadedPath);
  const entries = zip.getEntries();
  const addendum = entries.find(
    (e) =>
      !e.isDirectory &&
      ADDENDUM_AA_FILENAME_PATTERN.test(e.entryName) &&
      e.entryName.toLowerCase().endsWith('.csv'),
  );
  if (!addendum) {
    throw new Error(
      `Addendum AA CSV not found in ZIP. Entries: ${entries.map((e) => e.entryName).join(', ')}`,
    );
  }

  const csv = addendum.getData().toString('utf-8');
  const rows = parseAddendumAa(csv, {
    sourceUrl: ASC_FEE_SCHEDULE_ZIP_URL,
    fetchedAt: new Date().toISOString(),
  });

  const stats = await replaceMedicareNationalRates(db, rows);

  return {
    downloadedPath,
    addendumFilename: addendum.entryName,
    parsed: rows.length,
    inserted: stats.inserted,
    deleted: stats.deleted,
    release: ASC_FEE_SCHEDULE_RELEASE,
  };
}
