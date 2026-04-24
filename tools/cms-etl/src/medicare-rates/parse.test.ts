import { describe, expect, it } from 'vitest';
import { parseAddendumAa } from './parse.ts';

const OPTIONS = {
  sourceUrl: 'https://www.cms.gov/example.zip',
  fetchedAt: '2026-04-24T00:00:00.000Z',
};

// Mirror the real Addendum AA layout: 4 preamble rows + header + data.
// Header uses the release-prefixed, whitespace-inconsistent spellings CMS
// actually ships so the normalization logic is exercised.
const HEADER =
  'HCPCS Code,,Short Descriptor,Subject to Multiple Procedure Discounting,April 2026 Payment Indicator,April 2026  Payment Weight  ,April 2026 Payment Rate';

function addendumCsv(dataRows: string[]): string {
  // Mirror the real CMS layout: 4 preamble rows (title, AMA, two blanks),
  // HEADER on row 5 (index 4), data rows 6+.
  const preamble = ['Title: ASC Payment Rates', 'AMA copyright notice', '', '', HEADER];
  return [...preamble, ...dataRows].join('\n');
}

describe('parseAddendumAa', () => {
  it('parses the 64628 row at the real rate', () => {
    const csv = addendumCsv(['64628,,Trml dstrj ios bvn 1st 2 l/s,Y,J8,175.6211,"$9,891.33 "']);
    const rows = parseAddendumAa(csv, OPTIONS);
    expect(rows).toEqual([
      {
        rate_type: 'medicare',
        procedure_codes: ['64628'],
        price: 9891.33,
        rate_year: 2026,
        locality: 'NATIONAL-UNADJUSTED',
        source_url: OPTIONS.sourceUrl,
        source_fetched_at: OPTIONS.fetchedAt,
      },
    ]);
  });

  it('skips packaged procedures with blank payment rates (indicator N1/Z2 etc.)', () => {
    const csv = addendumCsv([
      // N1 = packaged service, CMS does not separately pay.
      '99999,,Packaged thing,N,N1,,',
    ]);
    expect(parseAddendumAa(csv, OPTIONS)).toEqual([]);
  });

  it('ignores non-target HCPCS codes', () => {
    const csv = addendumCsv([
      '27447,,Total knee replacement,N,J8,200,"$12,345.67 "',
      '64628,,Trml dstrj ios bvn 1st 2 l/s,Y,J8,175.6211,"$9,891.33 "',
    ]);
    const rows = parseAddendumAa(csv, OPTIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.procedure_codes).toEqual(['64628']);
  });

  it('strips dollar sign, comma, and trailing whitespace from the price', () => {
    const csv = addendumCsv(['64628,,Trml dstrj ios bvn 1st 2 l/s,Y,J8,175.6211,"  $12,000.50  "']);
    const rows = parseAddendumAa(csv, OPTIONS);
    expect(rows[0]?.price).toBe(12000.5);
  });

  it('rounds price to 2 decimals to match numeric(10,2)', () => {
    const csv = addendumCsv(['64628,,Trml dstrj ios bvn 1st 2 l/s,Y,J8,175.6211,"$1,234.567 "']);
    const rows = parseAddendumAa(csv, OPTIONS);
    expect(rows[0]?.price).toBe(1234.57);
  });

  it('throws if the file is too short to contain a header', () => {
    expect(() => parseAddendumAa('too\nshort', OPTIONS)).toThrow(/unexpectedly short/);
  });
});
