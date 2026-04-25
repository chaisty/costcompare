import { useEffect, useId, useRef, useState } from 'react';
import { type Facility, searchFacilities } from '../lib/facilities';

type Props = {
  selected: Facility | null;
  onSelect: (facility: Facility | null) => void;
};

// Note: this is a mouse-first typeahead. The options are rendered as buttons,
// which are natively focusable and keyboard-activatable via Tab + Enter/Space.
// We skip the ARIA combobox/listbox/option pattern for MVP; a proper keyboard
// arrow-navigation combobox is a worthwhile follow-up if we add more complex
// form flows.
export function FacilityPicker({ selected, onSelect }: Props) {
  const inputId = useId();
  const [query, setQuery] = useState(selected?.name ?? '');
  const [results, setResults] = useState<Facility[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (selected && query !== selected.name) onSelect(null);
  }, [query, selected, onSelect]);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const rows = await searchFacilities(query);
        setResults(rows);
        setError(null);
      } catch {
        setError('Could not load facilities. Try again in a moment.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  function onPick(f: Facility) {
    onSelect(f);
    setQuery(f.name);
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
          // Delay close so a click on a list item registers before blur.
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
            results.map((f) => (
              <li key={f.id} className="facility-picker__option">
                <button
                  type="button"
                  className="facility-picker__option-button"
                  aria-pressed={selected?.id === f.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(f)}
                >
                  <span className="facility-picker__name">{f.name}</span>
                  {f.city || f.state ? (
                    <span className="facility-picker__meta">
                      {[f.city, f.state].filter(Boolean).join(', ')}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
