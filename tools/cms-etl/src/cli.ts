import 'dotenv/config';
import { runFacilitiesEtl } from './facilities/etl.ts';
import { runMedicareRatesEtl } from './medicare-rates/etl.ts';
import { createServiceRoleClient } from './supabase.ts';

type Command = 'all' | 'facilities' | 'rates';

async function main() {
  const raw = process.argv[2] ?? 'all';
  if (!isCommand(raw)) {
    console.error(`Unknown command: ${raw}. Use 'all', 'facilities', or 'rates'.`);
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
}

function isCommand(v: string): v is Command {
  return v === 'all' || v === 'facilities' || v === 'rates';
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
