import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  buildConfirmationUrl,
  buildEmailHtml,
  buildEmailText,
  ConsoleSender,
  ResendSender,
  selectEmailSender,
} from './email.ts';

Deno.test('buildConfirmationUrl: joins base and token', () => {
  const url = buildConfirmationUrl('http://localhost:5173', 'abc123');
  assertEquals(url, 'http://localhost:5173/confirm?token=abc123');
});

Deno.test('buildConfirmationUrl: strips trailing slashes', () => {
  const url = buildConfirmationUrl('http://localhost:5173//', 'abc123');
  assertEquals(url, 'http://localhost:5173/confirm?token=abc123');
});

Deno.test('buildConfirmationUrl: url-encodes token', () => {
  const url = buildConfirmationUrl('http://x', 'a+b/c=d');
  assertEquals(url, 'http://x/confirm?token=a%2Bb%2Fc%3Dd');
});

Deno.test('buildEmailHtml: contains the confirm link in href', () => {
  const html = buildEmailHtml('http://x/confirm?token=abc');
  assertStringIncludes(html, 'href="http://x/confirm?token=abc"');
});

Deno.test('buildEmailText: contains the confirm link', () => {
  const text = buildEmailText('http://x/confirm?token=abc');
  assertStringIncludes(text, 'http://x/confirm?token=abc');
});

Deno.test('selectEmailSender: ResendSender when both Resend env vars set', () => {
  const s = selectEmailSender({
    resendApiKey: 'k',
    resendFrom: 'from@test',
    emailMode: undefined,
  });
  assertEquals(s instanceof ResendSender, true);
});

Deno.test('selectEmailSender: ConsoleSender when EMAIL_MODE=dev-console', () => {
  const s = selectEmailSender({
    resendApiKey: undefined,
    resendFrom: undefined,
    emailMode: 'dev-console',
  });
  assertEquals(s instanceof ConsoleSender, true);
});

Deno.test('selectEmailSender: prefers ResendSender even if EMAIL_MODE=dev-console', () => {
  const s = selectEmailSender({
    resendApiKey: 'k',
    resendFrom: 'from@test',
    emailMode: 'dev-console',
  });
  assertEquals(s instanceof ResendSender, true);
});

Deno.test('selectEmailSender: throws when misconfigured', () => {
  let threw = false;
  try {
    selectEmailSender({ resendApiKey: undefined, resendFrom: undefined, emailMode: undefined });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('selectEmailSender: throws when only api key is set', () => {
  let threw = false;
  try {
    selectEmailSender({ resendApiKey: 'k', resendFrom: undefined, emailMode: undefined });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('ResendSender: POSTs to Resend with expected shape', async () => {
  const original = globalThis.fetch;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedInit = init;
    return Promise.resolve(new Response('{"id":"res_test"}', { status: 200 }));
    // deno-lint-ignore no-explicit-any
  }) as any;
  try {
    const sender = new ResendSender('test-key', 'from@costcompare.test');
    await sender.sendConfirmation({
      to: 'alice@example.com',
      confirmUrl: 'http://localhost:5173/confirm?token=abc',
    });
    assertEquals(capturedUrl, 'https://api.resend.com/emails');
    assertEquals(capturedInit?.method, 'POST');
    const headers = capturedInit?.headers as Record<string, string>;
    assertEquals(headers['Authorization'], 'Bearer test-key');
    assertEquals(headers['Content-Type'], 'application/json');
    const body = JSON.parse(capturedInit?.body as string);
    assertEquals(body.from, 'from@costcompare.test');
    assertEquals(body.to, 'alice@example.com');
    assertEquals(body.subject, 'Confirm your CostCompare submission');
    assertStringIncludes(body.html, 'http://localhost:5173/confirm?token=abc');
    assertStringIncludes(body.text, 'http://localhost:5173/confirm?token=abc');
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test('ResendSender: throws on non-2xx response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response('quota exceeded', { status: 429 }),
    // deno-lint-ignore no-explicit-any
    )) as any;
  try {
    const sender = new ResendSender('key', 'from@x');
    await assertRejects(
      () => sender.sendConfirmation({ to: 'a@x', confirmUrl: 'http://x/c?token=t' }),
      Error,
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test('ConsoleSender: resolves without throwing', async () => {
  const sender = new ConsoleSender();
  await sender.sendConfirmation({ to: 'a@x', confirmUrl: 'http://x/c?token=t' });
});
