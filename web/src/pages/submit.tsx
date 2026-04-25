import { useState } from 'react';
import { FacilityPicker } from '../components/facility-picker';
import { ProviderPicker } from '../components/provider-picker';
import {
  type ResendErrorCode,
  type SubmitErrorCode,
  resendConfirmation,
  submitQuote,
} from '../lib/api';
import type { CtssOrganization, CtssProvider } from '../lib/ctss';

type FormErrors = Partial<Record<'price' | 'year' | 'email' | 'pickone' | 'form', string>>;

const CURRENT_YEAR = new Date().getUTCFullYear();

function errorMessage(code: SubmitErrorCode | 'unknown' | 'network'): string {
  switch (code) {
    case 'invalid_email':
      return 'That email address looks invalid. Double-check it and try again.';
    case 'invalid_price':
      return 'Enter a price between $0.01 and $99,999,999.99.';
    case 'invalid_year':
      return `Enter a year between 2000 and ${CURRENT_YEAR}.`;
    case 'invalid_procedure_codes':
      return 'The procedure list is invalid. Please reload and try again.';
    case 'missing_had_procedure':
      return 'Tell us whether you had the procedure yet.';
    case 'unknown_facility':
      return 'Pick a facility from the suggestions list.';
    case 'unknown_provider':
      return 'Pick a provider from the suggestions list.';
    case 'missing_provider_or_facility':
      return 'Pick at least one of: provider or facility.';
    case 'rate_limited_email':
      return 'You have submitted too many times with this email today. Try again tomorrow.';
    case 'rate_limited_ip':
      return 'Too many submissions from your network today. Try again tomorrow.';
    case 'missing_ip':
    case 'invalid_body':
    case 'internal_error':
    case 'unknown':
      return 'Something went wrong on our side. Please try again in a few minutes.';
    case 'network':
      return 'Could not reach CostCompare. Check your connection and try again.';
  }
}

function resendErrorMessage(code: ResendErrorCode | 'unknown' | 'network'): string {
  switch (code) {
    case 'invalid_email':
      return 'That email address looks invalid.';
    case 'resend_limit_exceeded':
      return 'You have resent the confirmation link too many times. Please submit again to start fresh.';
    case 'invalid_body':
    case 'internal_error':
    case 'unknown':
      return 'Something went wrong on our side. Please try again in a few minutes.';
    case 'network':
      return 'Could not reach CostCompare. Check your connection and try again.';
  }
}

export function SubmitPage() {
  const [facility, setFacility] = useState<CtssOrganization | null>(null);
  const [provider, setProvider] = useState<CtssProvider | null>(null);
  const [price, setPrice] = useState('');
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [hadProcedure, setHadProcedure] = useState<'yes' | 'no' | null>(null);
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'pending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!facility && !provider) next.pickone = 'Pick at least one: provider or facility.';

    const priceNum = Number(price);
    if (!price || Number.isNaN(priceNum) || priceNum < 0.01 || priceNum > 99_999_999.99) {
      next.price = 'Enter a price between $0.01 and $99,999,999.99.';
    }

    const yearNum = Number(year);
    if (!year || !Number.isInteger(yearNum) || yearNum < 2000 || yearNum > CURRENT_YEAR) {
      next.year = `Enter a year between 2000 and ${CURRENT_YEAR}.`;
    }

    if (!email || !email.includes('@') || email.length > 254) {
      next.email = 'Enter a valid email address.';
    }
    return next;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (hadProcedure === null) return;

    setSubmitting(true);
    try {
      const result = await submitQuote({
        email: email.trim(),
        ...(facility
          ? {
              facility: {
                npi: facility.npi,
                name: facility.name,
                city: facility.city,
                state: facility.state,
                taxonomy_label: facility.taxonomy,
              },
            }
          : {}),
        ...(provider
          ? {
              provider: {
                npi: provider.npi,
                first_name: provider.first_name,
                last_name: provider.last_name,
                credential: null,
                practice_city: provider.practice_city,
                practice_state: provider.practice_state,
                taxonomy_code: null,
                taxonomy_label: provider.taxonomy,
              },
            }
          : {}),
        procedure_codes: ['64628'],
        quoted_price: Number(price),
        quote_year: Number(year),
        had_procedure: hadProcedure === 'yes',
      });
      if (result.ok) {
        setSubmitted(true);
      } else {
        setErrors({ form: errorMessage(result.error) });
      }
    } catch {
      setErrors({ form: errorMessage('network') });
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (resendState === 'pending' || resendState === 'sent') return;
    setResendState('pending');
    setResendError(null);
    try {
      const result = await resendConfirmation(email.trim());
      if (result.ok) {
        setResendState('sent');
      } else {
        setResendState('error');
        setResendError(resendErrorMessage(result.error));
      }
    } catch {
      setResendState('error');
      setResendError(resendErrorMessage('network'));
    }
  }

  if (submitted) {
    return (
      <section className="card" aria-live="polite">
        <h1>Check your email</h1>
        <p>
          We've sent a confirmation link to <strong>{email}</strong>. Click it within 48 hours to
          publish your submission.
        </p>
        <p className="muted">
          If you don't see it, check your spam folder. The link expires automatically; if that
          happens, you can submit again.
        </p>
        {resendState === 'sent' ? (
          <p className="muted" aria-live="polite">
            Sent. Check your inbox and spam folder.
          </p>
        ) : (
          <p className="muted">
            Didn't get it?{' '}
            <button
              type="button"
              className="button-link"
              onClick={onResend}
              disabled={resendState === 'pending'}
            >
              {resendState === 'pending' ? 'Resending…' : 'Resend the link'}
            </button>
          </p>
        )}
        {resendState === 'error' && resendError ? (
          <p className="form__error" role="alert">
            {resendError}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card">
      <h1>Submit a cash-pay price</h1>
      <p>
        Share a price you were quoted for <strong>Intracept (CPT 64628)</strong>, a basivertebral
        nerve ablation procedure. Your submission helps other patients compare.
      </p>

      <form className="form" onSubmit={onSubmit} noValidate>
        <p className="field__hint">
          Pick at least one: the <strong>provider</strong> who quoted you, the{' '}
          <strong>facility</strong> where the quote was given, or both. Most patients remember their
          doctor's name; the facility (surgery center, hospital, clinic) is optional if you don't.
        </p>

        <div className="field">
          <label htmlFor="provider">Provider (physician)</label>
          <ProviderPicker selected={provider} onSelect={setProvider} />
        </div>

        <div className="field">
          <label htmlFor="facility">Facility (surgery center, hospital, clinic)</label>
          <FacilityPicker selected={facility} onSelect={setFacility} />
        </div>

        {errors.pickone ? (
          <p className="field__error" role="alert">
            {errors.pickone}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="price">Quoted price (USD)</label>
          <input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-invalid={errors.price ? 'true' : 'false'}
            required
          />
          {errors.price ? (
            <p className="field__error" role="alert">
              {errors.price}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="year">Year of quote</label>
          <input
            id="year"
            name="year"
            type="number"
            min="2000"
            max={CURRENT_YEAR}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-invalid={errors.year ? 'true' : 'false'}
            required
          />
          {errors.year ? (
            <p className="field__error" role="alert">
              {errors.year}
            </p>
          ) : null}
        </div>

        <fieldset className="field">
          <legend>Did you have the procedure?</legend>
          <label className="radio">
            <input
              type="radio"
              name="had_procedure"
              value="yes"
              checked={hadProcedure === 'yes'}
              onChange={() => setHadProcedure('yes')}
              required
            />
            Yes
          </label>
          <label className="radio">
            <input
              type="radio"
              name="had_procedure"
              value="no"
              checked={hadProcedure === 'no'}
              onChange={() => setHadProcedure('no')}
            />
            No, I just got a quote
          </label>
        </fieldset>

        <div className="field">
          <label htmlFor="email">Email (for one-off confirmation)</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? 'true' : 'false'}
            required
          />
          <p className="field__hint">
            We send a single link to verify this submission. Your email is never shown publicly or
            shared.
          </p>
          {errors.email ? (
            <p className="field__error" role="alert">
              {errors.email}
            </p>
          ) : null}
        </div>

        <p className="submit-disclaimer">
          By submitting, you confirm this price was quoted to you for the named provider and/or
          facility. CostCompare is not medical or financial advice.
        </p>

        {errors.form ? (
          <p className="form__error" role="alert">
            {errors.form}
          </p>
        ) : null}

        <button className="button button--primary" type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </form>
    </section>
  );
}
