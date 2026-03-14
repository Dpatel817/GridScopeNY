import { useState, useRef, useEffect } from 'react';

interface Props {
  label: string;
  allSeries: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  presets?: { label: string; fn: (all: string[]) => string[] }[];
}

export default function SeriesSelector({ label, allSeries, selected, onChange, presets }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (s: string) => {
    onChange(selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s]);
  };

  return (
    <div className="series-selector" ref={ref}>
      <button
        className="series-selector-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        type="button"
      >
        <span className="series-selector-label">{label}</span>
        <span className="series-selector-count">{selected.length} / {allSeries.length}</span>
        <span className="series-selector-arrow">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="series-selector-dropdown">
          <div className="series-selector-actions">
            <button type="button" onClick={() => onChange([...allSeries])}>Select All</button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
            {presets?.map((p, i) => (
              <button key={i} type="button" onClick={() => onChange(p.fn(allSeries))}>{p.label}</button>
            ))}
          </div>
          <div className="series-selector-list">
            {allSeries.map(s => (
              <label key={s} className="series-selector-item">
                <input
                  type="checkbox"
                  checked={selected.includes(s)}
                  onChange={() => toggle(s)}
                />
                <span>{s}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
