import { useEffect, useMemo, useState } from 'react';
import { type RateType, type SearchRatesOptions, type SearchedRate, searchRates } from '../lib/api';

// UTC-pinned date formatter so the rendered "fetched <date>" string doesn't
// shift across timezones — source_fetched_at is recorded in UTC and a viewer
// in (say) UTC-12 would otherwise see the date a day earlier.
const utcDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

// Year dropdown: current year + 5 prior. The RPC accepts any year in
// [2000, 2100], but most cash-pay submissions are recent, so a short list
// keeps the UI usable without a date picker.
const CURRENT_YEAR = new Date().getUTCFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

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

type LoadedState = {
  rows: SearchedRate[];
  nextCursor: string | null;
  hasMore: boolean;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; state: LoadedState }
  | { kind: 'loading-more'; state: LoadedState }
  | { kind: 'error'; message: string };

function buildOptions(
  state: string,
  rateType: '' | RateType,
  year: string,
  afterCursor?: string,
): SearchRatesOptions {
  const opts: SearchRatesOptions = {};
  if (state) opts.state = state;
  if (rateType) opts.rate_type = rateType;
  if (year) {
    const y = Number(year);
    opts.year_from = y;
    opts.year_to = y;
  }
  if (afterCursor) opts.after_cursor = afterCursor;
  return opts;
}

export function SearchPage() {
  const [state, setState] = useState<string>('');
  const [rateType, setRateType] = useState<'' | RateType>('');
  const [year, setYear] = useState<string>('');
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    (async () => {
      try {
        const result = await searchRates(buildOptions(state, rateType, year));
        if (cancelled) return;
        if (result.ok) {
          setStatus({
            kind: 'loaded',
            state: {
              rows: result.results,
              nextCursor: result.next_cursor,
              hasMore: result.has_more,
            },
          });
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
  }, [state, rateType, year]);

  async function loadMore() {
    if (status.kind !== 'loaded' || !status.state.nextCursor) return;
    const current = status.state;
    setStatus({ kind: 'loading-more', state: current });
    try {
      const result = await searchRates(
        buildOptions(state, rateType, year, current.nextCursor ?? undefined),
      );
      if (result.ok) {
        setStatus({
          kind: 'loaded',
          state: {
            rows: [...current.rows, ...result.results],
            nextCursor: result.next_cursor,
            hasMore: result.has_more,
          },
        });
      } else {
        setStatus({ kind: 'error', message: errorCopy(result.error) });
      }
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach CostCompare. Try again shortly.' });
    }
  }

  return (
    <section>
      <h1>Cash-pay prices for CPT 64628 (Intracept)</h1>
      <p className="muted">
        Compare user-submitted cash-pay prices alongside Medicare rates. Each row shows its source
        and year. Cash-pay prices are not verified by the listed provider or facility.
      </p>

      <div className="filters">
        <div className="filters__group">
          <label htmlFor="state-filter">State</label>
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

        <div className="filters__group">
          <label htmlFor="rate-type-filter">Source</label>
          <select
            id="rate-type-filter"
            name="rate_type"
            value={rateType}
            onChange={(e) => setRateType(e.target.value as '' | RateType)}
          >
            <option value="">All sources</option>
            <option value="cash">User-submitted</option>
            <option value="medicare">Medicare</option>
            <option value="negotiated">Negotiated</option>
          </select>
        </div>

        <div className="filters__group">
          <label htmlFor="year-filter">Year</label>
          <select
            id="year-filter"
            name="year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="">All years</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <span className="filter-hint muted">
          State matches the facility's state or the provider's practice state.
        </span>
      </div>

      <ResultsPanel status={status} onLoadMore={loadMore} />
    </section>
  );
}

function ResultsPanel({
  status,
  onLoadMore,
}: {
  status: Status;
  onLoadMore: () => void;
}) {
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

  const loaded = status.state;
  if (loaded.rows.length === 0) {
    return (
      <p className="muted">
        No rates yet for this filter. Be the first — <a href="/submit">submit a price</a>.
      </p>
    );
  }

  const isLoadingMore = status.kind === 'loading-more';

  return (
    <>
      <ul className="rate-list" aria-label="Search results">
        {loaded.rows.map((rate, i) => (
          <RateRow key={rateKey(rate, i)} rate={rate} />
        ))}
      </ul>
      {loaded.hasMore ? (
        <p className="rate-list__more">
          <button type="button" className="button" onClick={onLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? 'Loading…' : 'Load more'}
          </button>
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
          {rate.facility_external_id ? (
            <span
              className="badge badge--certified"
              title="This facility appears in the CMS Provider of Services file. Active enrollment status may vary."
            >
              Medicare-listed
            </span>
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
                fetched {utcDateFormatter.format(new Date(rate.source_fetched_at))}
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
