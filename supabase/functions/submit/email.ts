// Email sender abstraction. ResendSender POSTs to the Resend HTTP API;
// ConsoleSender is a dev-only stub that writes the confirm URL to stdout.
// selectEmailSender(env) picks one based on env vars and is the only entry
// point the handler should use.

const SUBJECT = 'Confirm your CostCompare submission';

export type ConfirmationEmailInput = { to: string; confirmUrl: string };

export interface EmailSender {
  sendConfirmation(input: ConfirmationEmailInput): Promise<void>;
}

export function buildConfirmationUrl(appBaseUrl: string, token: string): string {
  const trimmed = appBaseUrl.replace(/\/+$/, '');
  return `${trimmed}/confirm?token=${encodeURIComponent(token)}`;
}

export function buildEmailHtml(confirmUrl: string): string {
  // The href is the ONLY place the plaintext token should appear. Do not echo
  // the token in the subject, preheader, or server logs.
  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #222;">
  <h1 style="font-size: 18px; margin: 0 0 16px;">Confirm your submission</h1>
  <p>Thanks for submitting a quoted price to CostCompare.</p>
  <p>Click the button below to confirm your submission. The link expires in 48 hours.</p>
  <p style="margin: 24px 0;">
    <a href="${confirmUrl}" style="display:inline-block;padding:10px 20px;background:#0366d6;color:#fff;text-decoration:none;border-radius:4px;">Confirm submission</a>
  </p>
  <p style="color:#666;font-size:12px;">If you didn't submit this, ignore this email — no record will be created.</p>
</body>
</html>`;
}

export function buildEmailText(confirmUrl: string): string {
  return `Thanks for submitting a quoted price to CostCompare.

Confirm your submission: ${confirmUrl}

This link expires in 48 hours. If you didn't submit this, ignore this email — no record will be created.`;
}

export class ConsoleSender implements EmailSender {
  sendConfirmation({ to, confirmUrl }: ConfirmationEmailInput): Promise<void> {
    // Dev-only. Logs the confirm URL (which contains the plaintext token) to
    // stdout so local tests can fish it out. Never use in prod.
    console.log(`[email:ConsoleSender] to=${to} confirmUrl=${confirmUrl}`);
    return Promise.resolve();
  }
}

export class ResendSender implements EmailSender {
  readonly #apiKey: string;
  readonly #from: string;

  constructor(apiKey: string, from: string) {
    this.#apiKey = apiKey;
    this.#from = from;
  }

  async sendConfirmation({ to, confirmUrl }: ConfirmationEmailInput): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.#from,
        to,
        subject: SUBJECT,
        html: buildEmailHtml(confirmUrl),
        text: buildEmailText(confirmUrl),
      }),
    });
    if (!res.ok) {
      // Consume the body to close the connection. The status + a short prefix
      // of the response are logged server-side; they never reach the client.
      const detail = await res.text().catch(() => '<no body>');
      throw new Error(`Resend API ${res.status}: ${detail.slice(0, 200)}`);
    }
  }
}

export type EmailSenderEnv = {
  resendApiKey: string | undefined;
  resendFrom: string | undefined;
  emailMode: string | undefined;
};

export function selectEmailSender(env: EmailSenderEnv): EmailSender {
  if (env.resendApiKey && env.resendFrom) {
    return new ResendSender(env.resendApiKey, env.resendFrom);
  }
  // ConsoleSender requires an explicit opt-in so an unset RESEND_API_KEY in
  // prod fails loudly instead of quietly logging tokens to stdout.
  if (env.emailMode === 'dev-console') {
    console.warn('[email] using ConsoleSender — EMAIL_MODE=dev-console. Do not use in prod.');
    return new ConsoleSender();
  }
  throw new Error(
    'email sender misconfigured: set RESEND_API_KEY + RESEND_FROM_EMAIL (prod), ' +
      'or EMAIL_MODE=dev-console (local dev)',
  );
}
