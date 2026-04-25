import { describe, expect, it } from 'vitest';
import type { NppesOrgRow } from './parse.ts';
import { type ExistingFacility, planNppesUpsert } from './upsert.ts';

function candidate(over: Partial<NppesOrgRow>): NppesOrgRow {
  return {
    npi: '1111111111',
    name: 'Alpha Surgery Center',
    facility_type: 'asc',
    address_line1: null,
    city: null,
    state: 'CA',
    zip: null,
    ...over,
  };
}

function existing(over: Partial<ExistingFacility>): ExistingFacility {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Alpha Surgery Center',
    state: 'CA',
    npi: null,
    ...over,
  };
}

describe('planNppesUpsert', () => {
  it('skips candidates whose NPI is already in facilities', () => {
    const plan = planNppesUpsert([existing({ npi: '1111111111' })], [candidate({})]);
    expect(plan.alreadyKnownByNpi).toBe(1);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('crosswalk-updates a name+state-matched POS row that has no NPI', () => {
    const plan = planNppesUpsert(
      [existing({ id: 'pos-row-1', name: 'Alpha Surgery Center', state: 'CA', npi: null })],
      [candidate({ npi: '1111111111' })],
    );
    expect(plan.toUpdate).toEqual([{ id: 'pos-row-1', npi: '1111111111' }]);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.alreadyKnownByNpi).toBe(0);
    expect(plan.ambiguousNameStateMatch).toBe(0);
  });

  it('records ambiguous match when name+state matches a row with a different NPI', () => {
    const plan = planNppesUpsert(
      [existing({ name: 'Alpha Surgery Center', state: 'CA', npi: '9999999999' })],
      [candidate({ npi: '1111111111' })],
    );
    expect(plan.ambiguousNameStateMatch).toBe(1);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('inserts when no name+state match exists and NPI is new', () => {
    const plan = planNppesUpsert([], [candidate({ npi: '1111111111' })]);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0]?.npi).toBe('1111111111');
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('case-insensitive name match on the crosswalk', () => {
    const plan = planNppesUpsert(
      [existing({ name: 'ALPHA SURGERY CENTER', state: 'CA', npi: null })],
      [candidate({ name: 'Alpha Surgery Center' })],
    );
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toInsert).toHaveLength(0);
  });

  it('different states with same name are NOT considered a match', () => {
    const plan = planNppesUpsert(
      [existing({ name: 'Alpha Surgery Center', state: 'NY', npi: null })],
      [candidate({ state: 'CA' })],
    );
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('candidate without state still inserts (degenerate but allowed)', () => {
    const plan = planNppesUpsert([], [candidate({ state: null })]);
    expect(plan.toInsert).toHaveLength(1);
  });

  it('two candidates that name-match the same existing row only update once', () => {
    const plan = planNppesUpsert(
      [existing({ id: 'shared', name: 'Alpha Surgery Center', state: 'CA', npi: null })],
      [
        candidate({ npi: '1111111111' }),
        // A second NPPES row with the SAME name+state but a different NPI is
        // ambiguous — same name, two NPIs in NPPES, can't pick which one is
        // "the" match for our existing row.
        candidate({ npi: '2222222222' }),
      ],
    );
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]?.npi).toBe('1111111111');
    // The second candidate sees the now-claimed npi mismatch and falls through
    // to the ambiguous bucket because the existing row's npi was just reserved.
    expect(plan.ambiguousNameStateMatch).toBe(1);
  });

  it('reserves inserted NPI so a duplicate candidate in the same run is skipped', () => {
    const plan = planNppesUpsert(
      [],
      [
        candidate({ npi: '1111111111', name: 'Foo' }),
        candidate({ npi: '1111111111', name: 'Foo' }),
      ],
    );
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.alreadyKnownByNpi).toBe(1);
  });
});
