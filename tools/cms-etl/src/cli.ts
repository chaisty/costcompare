import 'dotenv/config';
import { runFacilitiesEtl } from './facilities/etl.ts';
import { runMedicareRatesEtl } from './medicare-rates/etl.ts';
import { runNppesOrgsEtl } from './nppes-orgs/etl.ts';
import { createServiceRoleClient } from './supabase.ts';

type Command = 'all' | 'facilities' | 'rates' | 'nppes';

async function main() {
  const raw = process.argv[2] ?? 'all';
  if (!isCommand(raw)) {
    console.error(`Unknown command: ${raw}. Use 'all', 'facilities', 'rates', or 'nppes'.`);
    process.exit(1);
  }
  const refresh = process.argv.includes('--refresh');

  const db = createServiceRoleClient();

  if (raw === 'all' || raw === 'facilities') {
    console.log('\n=== Facilities ETL ===');
    const result = await runFacilitiesEtl(db, { refresh });
    console.log(`release:    ${result.release}`);
    console.log(`source:     ${result.downloadedPath}`);
    console.log(`parsed:     ${result.parsed} ASC rows`);
    console.log(`upserted:   ${result.upserted} (${result.batches} batches)`);
  }

  if (raw === 'all' || raw === 'rates') {
    console.log('\n=== Medicare Rates ETL ===');
    const result = await runMedicareRatesEtl(db, { refresh });
    console.log(`release:    ${result.release}`);
    console.log(`source:     ${result.downloadedPath}`);
    console.log(`addendum:   ${result.addendumFilename}`);
    console.log(`parsed:     ${result.parsed} rate rows`);
    console.log(`deleted:    ${result.deleted} prior rows in scope`);
    console.log(`inserted:   ${result.inserted}`);
  }

  // The 'nppes' job is opt-in (not part of 'all') because it requires the
  // multi-GB NPPES monthly CSV to be already extracted on disk and pointed
  // at via NPPES_CSV_PATH. See README.md for the manual download steps.
  if (raw === 'nppes') {
    const csvPath = process.env.NPPES_CSV_PATH;
    if (!csvPath) {
      console.error('NPPES_CSV_PATH is required. See README.md for the manual download steps.');
      process.exit(1);
    }
    console.log('\n=== NPPES Type-2 organizations backfill ===');
    const result = await runNppesOrgsEtl(db, { csvPath });
    console.log(`csv:                       ${result.csvPath}`);
    console.log(`rows scanned:              ${result.rowsScanned}`);
    console.log(`rows matched:              ${result.rowsMatched}`);
    console.log(`already known by NPI:      ${result.upsert.alreadyKnownByNpi}`);
    console.log(`crosswalk-updated:         ${result.upsert.crosswalkUpdated}`);
    console.log(`inserted:                  ${result.upsert.inserted}`);
    console.log(`ambiguous (skipped):       ${result.upsert.ambiguousNameStateMatch}`);
    console.log(
      `batches:                   ${result.upsert.insertBatches} insert + ${result.upsert.updateBatches} update`,
    );
  }
}

function isCommand(v: string): v is Command {
  return v === 'all' || v === 'facilities' || v === 'rates' || v === 'nppes';
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
