import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mapNppesRow, parseNppesOrgsStream } from './parse.ts';

// Minimal NPPES headers — the parser reads only what it needs but Papa wants
// every column the row has. We declare the full subset of headers we touch
// plus one filler so a malformed-row test can include a plausible "extra".
const HEADERS = [
  'NPI',
  'Entity Type Code',
  'NPI Deactivation Date',
  'Provider Organization Name (Legal Business Name)',
  'Provider First Line Business Practice Location Address',
  'Provider Business Practice Location Address City Name',
  'Provider Business Practice Location Address State Name',
  'Provider Business Practice Location Address Postal Code',
  'Provider Business Practice Location Address Country Code (If outside U.S.)',
  'Healthcare Provider Taxonomy Code_1',
  'Healthcare Provider Taxonomy Code_2',
];

function row(values: Record<string, string>): string {
  return HEADERS.map((h) => csvEscape(values[h] ?? '')).join(',');
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function makeCsv(rows: Record<string, string>[]): string {
  return [HEADERS.map(csvEscape).join(','), ...rows.map(row)].join('\n');
}

const tempPaths: string[] = [];

function writeTempCsv(csv: string): string {
  const p = join(tmpdir(), `nppes-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(p, csv);
  tempPaths.push(p);
  return p;
}

afterEach(() => {
  // No file teardown — OS temp dir cleanup will handle it; tests stay simple.
  tempPaths.length = 0;
});

const ASC = '261QA1903X';
const PAIN_CLINIC = '261QP3300X';
const SURGICAL_HOSPITAL = '281P00000X';
const ACUTE_CARE = '282N00000X';

describe('mapNppesRow (unit)', () => {
  it('keeps a Type-2 ASC with a matching primary taxonomy', () => {
    const result = mapNppesRow({
      npi: '1234567890',
      'entity type code': '2',
      'npi deactivation date': '',
      'provider organization name (legal business name)': 'Alpha Surgery Center',
      'provider first line business practice location address': '123 Main St',
      'provider business practice location address city name': 'San Francisco',
      'provider business practice location address state name': 'CA',
      'provider business practice location address postal code': '94101',
      'provider business practice location address country code (if outside u.s.)': '',
      'healthcare provider taxonomy code_1': ASC,
    });
    expect(result).toEqual({
      npi: '1234567890',
      name: 'Alpha Surgery Center',
      facility_type: 'asc',
      address_line1: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      zip: '94101',
    });
  });

  it('returns null for Type-1 (individual provider) rows', () => {
    const result = mapNppesRow({
      npi: '1234567890',
      'entity type code': '1',
      'provider organization name (legal business name)': '',
      'healthcare provider taxonomy code_1': ASC,
    });
    expect(result).toBeNull();
  });

  it('returns null for deactivated providers', () => {
    const result = mapNppesRow({
      npi: '1234567890',
      'entity type code': '2',
      'npi deactivation date': '02/14/2024',
      'provider organization name (legal business name)': 'Closed ASC',
      'provider business practice location address state name': 'CA',
      'healthcare provider taxonomy code_1': ASC,
    });
    expect(result).toBeNull();
  });

  it('returns null for non-US providers', () => {
    const result = mapNppesRow({
      npi: '1234567890',
      'entity type code': '2',
      'provider organization name (legal business name)': 'Border Surgery Centre',
      'provider business practice location address state name': 'BC',
      'provider business practice location address country code (if outside u.s.)': 'CA',
      'healthcare provider taxonomy code_1': ASC,
    });
    expect(result).toBeNull();
  });

  it('returns null when no taxonomy in any of 15 slots is in our allowlist', () => {
    const result = mapNppesRow({
      npi: '1234567890',
      'entity type code': '2',
      'provider organization name (legal business name)': 'XYZ Dental Group',
      'healthcare provider taxonomy code_1': '122300000X', // Dentist
      'healthcare provider taxonomy code_2': '193400000X', // Single-specialty group
    });
    expect(result).toBeNull();
  });

  it('prefers hospital over asc when both taxonomies are present', () => {
    const result = mapNppesRow({
      npi: '1234567890',
      'entity type code': '2',
      'provider organization name (legal business name)': 'Mixed Surgical Hospital',
      'provider business practice location address state name': 'CA',
      'healthcare provider taxonomy code_1': ASC,
      'healthcare provider taxonomy code_2': SURGICAL_HOSPITAL,
    });
    expect(result?.facility_type).toBe('hospital');
  });

  it('classifies pain medicine clinic as clinic', () => {
    const result = mapNppesRow({
      npi: '9999999990',
      'entity type code': '2',
      'provider organization name (legal business name)': 'Acme Pain Center',
      'provider business practice location address state name': 'NY',
      'healthcare provider taxonomy code_1': PAIN_CLINIC,
    });
    expect(result?.facility_type).toBe('clinic');
  });

  it('classifies acute care hospital as hospital', () => {
    const result = mapNppesRow({
      npi: '5555555555',
      'entity type code': '2',
      'provider organization name (legal business name)': 'Memorial General Hospital',
      'provider business practice location address state name': 'TX',
      'healthcare provider taxonomy code_1': ACUTE_CARE,
    });
    expect(result?.facility_type).toBe('hospital');
  });

  it('rejects malformed NPI (not 10 digits)', () => {
    const result = mapNppesRow({
      npi: '12345',
      'entity type code': '2',
      'provider organization name (legal business name)': 'Short NPI ASC',
      'healthcare provider taxonomy code_1': ASC,
    });
    expect(result).toBeNull();
  });

  it('rejects rows missing the organization name', () => {
    const result = mapNppesRow({
      npi: '1234567890',
      'entity type code': '2',
      'provider organization name (legal business name)': '   ',
      'healthcare provider taxonomy code_1': ASC,
    });
    expect(result).toBeNull();
  });

  it('drops malformed state codes rather than failing', () => {
    const result = mapNppesRow({
      npi: '1234567890',
      'entity type code': '2',
      'provider organization name (legal business name)': 'Foo ASC',
      'provider business practice location address state name': 'XYZ',
      'healthcare provider taxonomy code_1': ASC,
    });
    expect(result?.state).toBeNull();
  });
});

describe('parseNppesOrgsStream (integration with Papa over a file)', () => {
  it('streams a small file and yields only matching rows', async () => {
    const csv = makeCsv([
      {
        NPI: '1111111111',
        'Entity Type Code': '2',
        'Provider Organization Name (Legal Business Name)': 'Alpha Surgery Center',
        'Provider Business Practice Location Address State Name': 'CA',
        'Healthcare Provider Taxonomy Code_1': ASC,
      },
      {
        NPI: '2222222222',
        'Entity Type Code': '1', // Type-1 individual — skip
        'Provider Organization Name (Legal Business Name)': '',
        'Healthcare Provider Taxonomy Code_1': ASC,
      },
      {
        NPI: '3333333333',
        'Entity Type Code': '2',
        'NPI Deactivation Date': '01/01/2024', // deactivated — skip
        'Provider Organization Name (Legal Business Name)': 'Closed Center',
        'Healthcare Provider Taxonomy Code_1': ASC,
      },
      {
        NPI: '4444444444',
        'Entity Type Code': '2',
        'Provider Organization Name (Legal Business Name)': 'Beta Pain Clinic',
        'Provider Business Practice Location Address State Name': 'NY',
        'Healthcare Provider Taxonomy Code_1': PAIN_CLINIC,
      },
      {
        NPI: '5555555555',
        'Entity Type Code': '2',
        'Provider Organization Name (Legal Business Name)': 'XYZ Dental',
        'Healthcare Provider Taxonomy Code_1': '122300000X', // not in allowlist — skip
      },
    ]);
    const path = writeTempCsv(csv);
    const matches: string[] = [];
    const stats = await parseNppesOrgsStream(path, (r) => {
      matches.push(`${r.npi}:${r.name}:${r.facility_type}`);
    });
    expect(stats.rowsScanned).toBe(5);
    expect(stats.rowsMatched).toBe(2);
    expect(matches).toEqual([
      '1111111111:Alpha Surgery Center:asc',
      '4444444444:Beta Pain Clinic:clinic',
    ]);
  });
});
