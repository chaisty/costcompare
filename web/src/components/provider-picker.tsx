import { useEffect, useId, useRef, useState } from 'react';
import { type CtssProvider, searchCtssProviders } from '../lib/ctss';

type Props = {
  selected: CtssProvider | null;
  onSelect: (provider: CtssProvider | null) => void;
};

// CTSS-backed individual-provider picker. Same shape as FacilityPicker but
// targets the NLM individuals endpoint. Search format is "Last name" (CTSS
// indexes both first and last, but most patients remember the last name).
export function ProviderPicker({ selected, onSelect }: Props) {
  const inputId = useId();
  const initialName = selected ? `${selected.last_name}, ${selected.first_name}` : '';
  const [query, setQuery] = useState(initialName);
  const [results, setResults] = useState<CtssProvider[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (selected && query !== `${selected.last_name}, ${selected.first_name}`) onSelect(null);
  }, [query, selected, onSelect]);

  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const rows = await searchCtssProviders(query, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setResults(rows);
          setError(null);
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError('Could not search providers. Try again in a moment.');
          setResults([]);
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [query]);

  function onPick(p: CtssProvider) {
    onSelect(p);
    setQuery(`${p.last_name}, ${p.first_name}`);
    setOpen(false);
  }

  return (
    <div className="facility-picker">
      <input
        id={inputId}
        name="provider"
        type="text"
        autoComplete="off"
        placeholder="Search by physician name (last name)…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
      />
      {open && query.trim().length >= 2 ? (
        <ul className="facility-picker__listbox">
          {loading ? (
            <li className="facility-picker__status" aria-live="polite">
              Searching…
            </li>
          ) : error ? (
            <li className="facility-picker__status" role="alert">
              {error}
            </li>
          ) : results.length === 0 ? (
            <li className="facility-picker__status">No matches.</li>
          ) : (
            results.map((p) => (
              <li key={p.npi} className="facility-picker__option">
                <button
                  type="button"
                  className="facility-picker__option-button"
                  aria-pressed={selected?.npi === p.npi}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(p)}
                >
                  <span className="facility-picker__name">
                    {p.last_name}, {p.first_name}
                  </span>
                  <span className="facility-picker__meta">
                    {[p.practice_city, p.practice_state, p.taxonomy].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
