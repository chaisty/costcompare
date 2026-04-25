import { useEffect, useId, useRef, useState } from 'react';
import { type CtssOrganization, searchCtssOrganizations } from '../lib/ctss';

type Props = {
  selected: CtssOrganization | null;
  onSelect: (facility: CtssOrganization | null) => void;
};

// CTSS-backed organization picker. Replaces the previous local-facilities
// query because patients search by name, and CTSS returns the NPI-keyed
// authoritative roster from NPPES. The Edge Function upserts the selected
// facility into our local cache by NPI on submit.
export function FacilityPicker({ selected, onSelect }: Props) {
  const inputId = useId();
  const [query, setQuery] = useState(selected?.name ?? '');
  const [results, setResults] = useState<CtssOrganization[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (selected && query !== selected.name) onSelect(null);
  }, [query, selected, onSelect]);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
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
        const rows = await searchCtssOrganizations(query, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setResults(rows);
          setError(null);
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError('Could not search facilities. Try again in a moment.');
          setResults([]);
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      // Abort any in-flight CTSS fetch so a stale response can't update state
      // after the component unmounts or the query changes.
      abortRef.current?.abort();
    };
  }, [query]);

  function onPick(o: CtssOrganization) {
    onSelect(o);
    setQuery(o.name);
    setOpen(false);
  }

  return (
    <div className="facility-picker">
      <input
        id={inputId}
        name="facility"
        type="text"
        autoComplete="off"
        placeholder="Search by facility name…"
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
            results.map((o) => (
              <li key={o.npi} className="facility-picker__option">
                <button
                  type="button"
                  className="facility-picker__option-button"
                  aria-pressed={selected?.npi === o.npi}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(o)}
                >
                  <span className="facility-picker__name">{o.name}</span>
                  <span className="facility-picker__meta">
                    {[o.city, o.state, o.taxonomy].filter(Boolean).join(' · ')}
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
