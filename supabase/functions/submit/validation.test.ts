import { assertEquals } from 'jsr:@std/assert@1';
import { parseSubmissionRequest } from './validation.ts';

const validBody = {
  email: 'a@example.com',
  facility_id: '11111111-1111-4111-8111-111111111111',
  procedure_codes: ['64628'],
  quoted_price: 8500,
  quote_year: 2025,
  had_procedure: true,
};

Deno.test('parseSubmissionRequest: accepts well-formed body', () => {
  const r = parseSubmissionRequest(validBody);
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.data.email, 'a@example.com');
    assertEquals(r.data.procedure_codes, ['64628']);
    assertEquals(r.data.quoted_price, 8500);
  }
});

Deno.test('parseSubmissionRequest: rejects non-object body', () => {
  const r = parseSubmissionRequest('hi');
  assertEquals(r, { ok: false, error: 'invalid_body' });
});

Deno.test('parseSubmissionRequest: rejects array body', () => {
  const r = parseSubmissionRequest([]);
  assertEquals(r, { ok: false, error: 'invalid_body' });
});

Deno.test('parseSubmissionRequest: rejects null body', () => {
  const r = parseSubmissionRequest(null);
  assertEquals(r, { ok: false, error: 'invalid_body' });
});

Deno.test('parseSubmissionRequest: rejects missing email', () => {
  const { email: _omit, ...rest } = validBody;
  const r = parseSubmissionRequest(rest);
  assertEquals(r, { ok: false, error: 'invalid_email' });
});

Deno.test('parseSubmissionRequest: rejects empty email', () => {
  const r = parseSubmissionRequest({ ...validBody, email: '' });
  assertEquals(r, { ok: false, error: 'invalid_email' });
});

Deno.test('parseSubmissionRequest: rejects non-string email', () => {
  const r = parseSubmissionRequest({ ...validBody, email: 42 });
  assertEquals(r, { ok: false, error: 'invalid_email' });
});

Deno.test('parseSubmissionRequest: rejects overlong email', () => {
  const r = parseSubmissionRequest({ ...validBody, email: `${'a'.repeat(250)}@x.co` });
  assertEquals(r, { ok: false, error: 'invalid_email' });
});

Deno.test('parseSubmissionRequest: rejects malformed facility_id', () => {
  const r = parseSubmissionRequest({ ...validBody, facility_id: 'not-a-uuid' });
  assertEquals(r, { ok: false, error: 'unknown_facility' });
});

Deno.test('parseSubmissionRequest: rejects non-string facility_id', () => {
  const r = parseSubmissionRequest({ ...validBody, facility_id: 42 });
  assertEquals(r, { ok: false, error: 'unknown_facility' });
});

Deno.test('parseSubmissionRequest: rejects empty procedure_codes array', () => {
  const r = parseSubmissionRequest({ ...validBody, procedure_codes: [] });
  assertEquals(r, { ok: false, error: 'invalid_procedure_codes' });
});

Deno.test('parseSubmissionRequest: rejects non-string in procedure_codes', () => {
  const r = parseSubmissionRequest({ ...validBody, procedure_codes: [64628] });
  assertEquals(r, { ok: false, error: 'invalid_procedure_codes' });
});

Deno.test('parseSubmissionRequest: rejects empty string in procedure_codes', () => {
  const r = parseSubmissionRequest({ ...validBody, procedure_codes: ['64628', ''] });
  assertEquals(r, { ok: false, error: 'invalid_procedure_codes' });
});

Deno.test('parseSubmissionRequest: rejects non-number price', () => {
  const r = parseSubmissionRequest({ ...validBody, quoted_price: '8500' });
  assertEquals(r, { ok: false, error: 'invalid_price' });
});

Deno.test('parseSubmissionRequest: rejects NaN price', () => {
  const r = parseSubmissionRequest({ ...validBody, quoted_price: Number.NaN });
  assertEquals(r, { ok: false, error: 'invalid_price' });
});

Deno.test('parseSubmissionRequest: rejects Infinity price', () => {
  const r = parseSubmissionRequest({ ...validBody, quoted_price: Number.POSITIVE_INFINITY });
  assertEquals(r, { ok: false, error: 'invalid_price' });
});

Deno.test('parseSubmissionRequest: rejects zero price', () => {
  const r = parseSubmissionRequest({ ...validBody, quoted_price: 0 });
  assertEquals(r, { ok: false, error: 'invalid_price' });
});

Deno.test('parseSubmissionRequest: rejects negative price', () => {
  const r = parseSubmissionRequest({ ...validBody, quoted_price: -1 });
  assertEquals(r, { ok: false, error: 'invalid_price' });
});

Deno.test('parseSubmissionRequest: rejects price above DB column cap', () => {
  const r = parseSubmissionRequest({ ...validBody, quoted_price: 100_000_000 });
  assertEquals(r, { ok: false, error: 'invalid_price' });
});

Deno.test('parseSubmissionRequest: accepts price at DB column cap', () => {
  const r = parseSubmissionRequest({ ...validBody, quoted_price: 99_999_999.99 });
  assertEquals(r.ok, true);
});

Deno.test('parseSubmissionRequest: rejects fractional year', () => {
  const r = parseSubmissionRequest({ ...validBody, quote_year: 2025.5 });
  assertEquals(r, { ok: false, error: 'invalid_year' });
});

Deno.test('parseSubmissionRequest: rejects non-number year', () => {
  const r = parseSubmissionRequest({ ...validBody, quote_year: '2025' });
  assertEquals(r, { ok: false, error: 'invalid_year' });
});

Deno.test('parseSubmissionRequest: rejects year below 2000', () => {
  const r = parseSubmissionRequest({ ...validBody, quote_year: 1999 });
  assertEquals(r, { ok: false, error: 'invalid_year' });
});

Deno.test('parseSubmissionRequest: rejects year above 2100', () => {
  const r = parseSubmissionRequest({ ...validBody, quote_year: 2101 });
  assertEquals(r, { ok: false, error: 'invalid_year' });
});

Deno.test('parseSubmissionRequest: rejects non-boolean had_procedure', () => {
  const r = parseSubmissionRequest({ ...validBody, had_procedure: 'yes' });
  assertEquals(r, { ok: false, error: 'missing_had_procedure' });
});

Deno.test('parseSubmissionRequest: rejects missing had_procedure', () => {
  const { had_procedure: _omit, ...rest } = validBody;
  const r = parseSubmissionRequest(rest);
  assertEquals(r, { ok: false, error: 'missing_had_procedure' });
});

Deno.test('parseSubmissionRequest: accepts had_procedure=false', () => {
  const r = parseSubmissionRequest({ ...validBody, had_procedure: false });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.data.had_procedure, false);
});
