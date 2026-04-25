import { useEffect, useMemo, useState } from 'react';
import { type SearchRatesResult, type SearchedRate, searchRates } from '../lib/api';

const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
];

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; result: SearchRatesResult }
  | { kind: 'error'; message: string };

export function SearchPage() {
  const [state, setState] = useState<string>('');
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    (async () => {
      try {
        const result = await searchRates({ state: state || undefined });
        if (cancelled) return;
        if (result.ok) {
          setStatus({ kind: 'loaded', result });
        } else {
          setStatus({ kind: 'error', message: errorCopy(result.error) });
        }
      } catch {
        if (cancelled) return;
        setStatus({ kind: 'error', message: 'Could not reach CostCompare. Try again shortly.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  return (
    <section>
      <h1>Cash-pay prices for CPT 64628 (Intracept)</h1>
      <p className="muted">
        Compare user-submitted cash-pay prices alongside Medicare rates. Each row shows its source
        and year. Cash-pay prices are not verified by the listed facility.
      </p>

      <div className="filters">
        <label htmlFor="state-filter">Filter by state</label>
        <select
          id="state-filter"
          name="state"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">All states</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <ResultsPanel status={status} />
    </section>
  );
}

function ResultsPanel({ status }: { status: Status }) {
  if (status.kind === 'loading') {
    return (
      <p className="muted" aria-live="polite">
        Loading rates…
      </p>
    );
  }
  if (status.kind === 'error') {
    return (
      <p className="form__error" role="alert">
        {status.message}
      </p>
    );
  }
  if (status.kind === 'idle') return null;

  const rows = status.result.results;
  if (rows.length === 0) {
    return (
      <p className="muted">
        No rates yet for this filter. Be the first — <a href="/submit">submit a price</a>.
      </p>
    );
  }

  return (
    <>
      <ul className="rate-list" aria-label="Search results">
        {rows.map((rate, i) => (
          <RateRow key={rateKey(rate, i)} rate={rate} />
        ))}
      </ul>
      {status.result.has_more ? (
        <p className="muted">
          More results available. Narrow your filter to see fewer rows, or pagination is coming in a
          future update.
        </p>
      ) : null}
    </>
  );
}

function RateRow({ rate }: { rate: SearchedRate }) {
  const badge = sourceBadge(rate);
  const price = useMemo(
    () =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
        Number(rate.price),
      ),
    [rate.price],
  );

  return (
    <li className="rate-row">
      <div className="rate-row__price">{price}</div>
      <div className="rate-row__meta">
        {rate.provider_name ? (
          <div className="rate-row__provider">
            {rate.provider_name}
            {rate.provider_credential ? (
              <span className="rate-row__credential">, {rate.provider_credential}</span>
            ) : null}
            {rate.provider_specialty ? (
              <span className="rate-row__specialty"> · {rate.provider_specialty}</span>
            ) : null}
          </div>
        ) : null}
        <div className="rate-row__facility">
          {rate.facility_name ?? (rate.provider_name ? null : 'National (no specific facility)')}
          {rate.facility_name && rate.facility_state ? (
            <span className="rate-row__state">({rate.facility_state})</span>
          ) : null}
          {!rate.facility_name && rate.provider_state ? (
            <span className="rate-row__state">{rate.provider_state}</span>
          ) : null}
        </div>
        <div className="rate-row__provenance">
          <span className={`badge badge--${rate.rate_type}`}>{badge.label}</span>
          <span className="muted">
            {badge.suffix} · <time>{rate.rate_year}</time>
          </span>
        </div>
        {rate.source_url ? (
          <div className="rate-row__source">
            <a href={rate.source_url} rel="noreferrer" target="_blank">
              Source
            </a>
            {rate.source_fetched_at ? (
              <span className="muted">
                {' '}
                fetched {new Date(rate.source_fetched_at).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        ) : null}
        {rate.rate_type === 'negotiated' ? (
          <p className="rate-row__caveat">
            <em>Best-effort parsed</em> from payer Transparency-in-Coverage files. May differ from
            the rate you are actually charged.
          </p>
        ) : null}
        {rate.confidence_note ? <p className="muted">{rate.confidence_note}</p> : null}
        {rate.rate_type === 'cash' ? (
          <p className="rate-row__report">
            {/* "Report this submission" stub per issue #7 acceptance — functionality in phase-2. */}
            <a
              href="mailto:ckhaisty@gmail.com?subject=Report%20CostCompare%20submission"
              className="muted"
            >
              Report this submission
            </a>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function sourceBadge(rate: SearchedRate): { label: string; suffix: string } {
  switch (rate.rate_type) {
    case 'cash':
      return { label: 'User-submitted', suffix: 'patient cash-pay quote' };
    case 'medicare':
      return {
        label: 'Medicare',
        suffix: `CMS ${rate.locality ?? 'national'}`,
      };
    case 'negotiated':
      return { label: 'Negotiated', suffix: rate.payer ?? 'payer rate' };
  }
}

function rateKey(rate: SearchedRate, index: number): string {
  // search_rates intentionally does NOT return a rate id (defense-in-depth).
  // Compose a stable-enough key from the columns we do have, plus the index
  // to break ties between otherwise-identical rows.
  return `${rate.rate_type}:${rate.facility_id ?? 'none'}:${rate.rate_year}:${rate.price}:${index}`;
}

function errorCopy(code: string): string {
  switch (code) {
    case 'invalid_state':
      return 'Invalid state selection.';
    case 'invalid_year_range':
      return 'Invalid year range.';
    case 'invalid_procedure_code':
      return 'Invalid procedure code.';
    case 'offset_too_large':
      return 'Too many pages requested. Try narrowing the filter.';
    default:
      return 'Something went wrong on our side. Try again shortly.';
  }
}
