import type { ChartType, Resolution, DateRange } from '../data/priceTransforms';

interface Props {
  zones: string[];
  selectedZones: string[];
  onZonesChange: (zones: string[]) => void;
  resolution: Resolution;
  onResolutionChange: (r: Resolution) => void;
  dateRange: DateRange;
  onDateRangeChange: (r: DateRange) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  availableDates: string[];
  chartType: ChartType;
  onChartTypeChange: (t: ChartType) => void;
}

const RESOLUTIONS: { key: Resolution; label: string }[] = [
  { key: 'hourly', label: 'Hourly' },
  { key: 'on_peak', label: 'On-Peak' },
  { key: 'off_peak', label: 'Off-Peak' },
  { key: 'daily', label: 'Daily' },
];

const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: 'line', label: 'Line' },
  { key: 'line-markers', label: 'Markers' },
  { key: 'area', label: 'Area' },
  { key: 'bar', label: 'Bar' },
];

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'custom', label: 'Custom' },
  { key: 'all', label: 'All' },
];

export default function PriceChartControls({
  zones, selectedZones, onZonesChange,
  resolution, onResolutionChange,
  dateRange, onDateRangeChange,
  startDate, endDate, onStartDateChange, onEndDateChange,
  availableDates,
  chartType, onChartTypeChange,
}: Props) {
  const allSelected = selectedZones.length === zones.length;

  return (
    <div className="ctrl-toolbar">
      {/* Zone checkboxes */}
      <div className="ctrl-group">
        <span className="ctrl-label">Zones</span>
        <button
          className={`ctrl-pill${allSelected ? ' active' : ''}`}
          onClick={() => onZonesChange(allSelected ? [] : [...zones])}
        >
          {allSelected ? 'Clear' : 'All'}
        </button>
        {zones.map(z => (
          <label key={z} className="ctrl-check">
            <input
              type="checkbox"
              checked={selectedZones.includes(z)}
              onChange={() => onZonesChange(
                selectedZones.includes(z)
                  ? selectedZones.filter(x => x !== z)
                  : [...selectedZones, z]
              )}
            />
            <span>{z}</span>
          </label>
        ))}
      </div>

      <div className="ctrl-divider" />

      {/* Resolution */}
      <div className="ctrl-group">
        <span className="ctrl-label">Resolution</span>
        {RESOLUTIONS.map(r => (
          <button
            key={r.key}
            className={`ctrl-pill${resolution === r.key ? ' active' : ''}`}
            onClick={() => onResolutionChange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="ctrl-divider" />

      {/* Date range */}
      <div className="ctrl-group">
        <span className="ctrl-label">Range</span>
        {DATE_RANGES.map(d => (
          <button
            key={d.key}
            className={`ctrl-pill${dateRange === d.key ? ' active' : ''}`}
            onClick={() => onDateRangeChange(d.key)}
          >
            {d.label}
          </button>
        ))}
        {dateRange === 'custom' && (
          <>
            <input type="date" className="ctrl-date"
              value={startDate}
              min={availableDates[0]} max={availableDates[availableDates.length - 1]}
              onChange={e => onStartDateChange(e.target.value)}
            />
            <span className="ctrl-sep">–</span>
            <input type="date" className="ctrl-date"
              value={endDate}
              min={availableDates[0]} max={availableDates[availableDates.length - 1]}
              onChange={e => onEndDateChange(e.target.value)}
            />
          </>
        )}
      </div>

      <div className="ctrl-divider" />

      {/* Chart type */}
      <div className="ctrl-group">
        <span className="ctrl-label">Type</span>
        {CHART_TYPES.map(t => (
          <button
            key={t.key}
            className={`ctrl-pill${chartType === t.key ? ' active' : ''}`}
            onClick={() => onChartTypeChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
