import { assertEquals } from 'jsr:@std/assert@1';
import { mapTaxonomyToFacilityType } from './upsert.ts';

Deno.test('mapTaxonomyToFacilityType: ASC variants', () => {
  assertEquals(mapTaxonomyToFacilityType('Ambulatory Surgical'), 'asc');
  assertEquals(mapTaxonomyToFacilityType('Ambulatory Surgical Center'), 'asc');
  assertEquals(mapTaxonomyToFacilityType('Surgical Center / Outpatient'), 'asc');
});

Deno.test('mapTaxonomyToFacilityType: hospital variants', () => {
  assertEquals(mapTaxonomyToFacilityType('General Acute Care Hospital'), 'hospital');
  assertEquals(mapTaxonomyToFacilityType('Critical Access Hospital'), 'hospital');
  assertEquals(mapTaxonomyToFacilityType("Children's Hospital"), 'hospital');
  assertEquals(mapTaxonomyToFacilityType('Psychiatric Hospital'), 'hospital');
});

Deno.test('mapTaxonomyToFacilityType: medical center wins over generic clinic', () => {
  assertEquals(mapTaxonomyToFacilityType('Academic Medical Center'), 'medical_center');
});

Deno.test('mapTaxonomyToFacilityType: clinic / group practice', () => {
  assertEquals(mapTaxonomyToFacilityType('Clinic or Group Practice'), 'clinic');
  assertEquals(mapTaxonomyToFacilityType('Multi-Specialty Group Practice'), 'clinic');
  assertEquals(mapTaxonomyToFacilityType('Federally Qualified Health Center'), 'clinic');
});

Deno.test('mapTaxonomyToFacilityType: surgical hospital prefers hospital, not asc', () => {
  // "Surgical Hospital" contains "hospital" and we check that first.
  assertEquals(mapTaxonomyToFacilityType('Surgical Hospital'), 'hospital');
});

Deno.test('mapTaxonomyToFacilityType: unknown taxonomy falls through to other', () => {
  assertEquals(mapTaxonomyToFacilityType('Pharmacy'), 'other');
  assertEquals(mapTaxonomyToFacilityType('Laboratory'), 'other');
});

Deno.test('mapTaxonomyToFacilityType: null/empty defaults to other', () => {
  assertEquals(mapTaxonomyToFacilityType(null), 'other');
  assertEquals(mapTaxonomyToFacilityType(''), 'other');
});

Deno.test('mapTaxonomyToFacilityType: case-insensitive', () => {
  assertEquals(mapTaxonomyToFacilityType('AMBULATORY SURGICAL'), 'asc');
  assertEquals(mapTaxonomyToFacilityType('hospital'), 'hospital');
});
