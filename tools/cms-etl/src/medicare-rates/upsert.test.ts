import { describe, expect, it } from 'vitest';
import { replaceMedicareNationalRates } from './upsert.ts';

// replaceMedicareNationalRates must refuse to wipe the scope when the parser
// returned zero rows — a parser regression would otherwise silently empty the
// Medicare rate set on the next quarterly run. No DB client is needed because
// the guard fires before any supabase calls.

describe('replaceMedicareNationalRates', () => {
  it('throws on empty rows rather than wiping the scope', async () => {
    const unusedDb = null as unknown as Parameters<typeof replaceMedicareNationalRates>[0];
    await expect(replaceMedicareNationalRates(unusedDb, [])).rejects.toThrow(
      /parser returned 0 rows/,
    );
  });
});
