interface Props {
  value: string;
  onChange: (v: string) => void;
  showDaily?: boolean;
}

const OPTIONS = [
  { key: 'raw', label: 'Raw' },
  { key: 'hourly', label: 'Hourly' },
  { key: 'on_peak', label: 'On-Peak Avg' },
  { key: 'off_peak', label: 'Off-Peak Avg' },
  { key: 'daily', label: 'Daily' },
];

export default function ResolutionSelector({ value, onChange, showDaily = true }: Props) {
  const items = showDaily ? OPTIONS : OPTIONS.filter(o => o.key !== 'daily');
  return (
    <div className="resolution-bar">
      <label>Resolution:</label>
      {items.map(o => (
        <button
          key={o.key}
          className={`resolution-btn ${value === o.key ? 'active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
