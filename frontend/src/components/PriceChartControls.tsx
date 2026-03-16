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
  { key: 'on_peak', label: 'On-Peak Avg' },
  { key: 'off_peak', label: 'Off-Peak Avg' },
  { key: 'daily', label: 'Daily Avg' },
];

const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: 'line-markers', label: 'Line + Markers' },
  { key: 'line', label: 'Line' },
  { key: 'area', label: 'Stacked Area' },
  { key: 'bar', label: 'Stacked Bar' },
];

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Latest Day' },
  { key: 'custom', label: 'Custom Range' },
  { key: 'all', label: 'All Dates' },
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
    <div className="pcc-panel">
      <div className="pcc-title">Chart Controls</div>

      <div className="pcc-section">
        <div className="pcc-label">Zones</div>
        <div className="pcc-zone-actions">
          <button
            className={`pcc-mini-btn${allSelected ? ' active' : ''}`}
            onClick={() => onZonesChange(allSelected ? [] : [...zones])}
          >
            {allSelected ? 'Clear' : 'All'}
          </button>
        </div>
        <div className="pcc-zone-grid">
          {zones.map(z => (
            <label key={z} className="pcc-zone-item">
              <input
                type="checkbox"
                checked={selectedZones.includes(z)}
                onChange={() => {
                  onZonesChange(
                    selectedZones.includes(z)
                      ? selectedZones.filter(x => x !== z)
                      : [...selectedZones, z]
                  );
                }}
              />
              <span>{z}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Resolution</div>
        <div className="pcc-btn-group">
          {RESOLUTIONS.map(r => (
            <button
              key={r.key}
              className={`pcc-btn${resolution === r.key ? ' active' : ''}`}
              onClick={() => onResolutionChange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Date Range</div>
        <div className="pcc-btn-group">
          {DATE_RANGES.map(d => (
            <button
              key={d.key}
              className={`pcc-btn${dateRange === d.key ? ' active' : ''}`}
              onClick={() => onDateRangeChange(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
        {dateRange === 'custom' && (
          <div className="pcc-date-inputs">
            <input
              type="date"
              className="pcc-date"
              value={startDate}
              min={availableDates.length > 0 ? availableDates[0] : undefined}
              max={availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined}
              onChange={e => onStartDateChange(e.target.value)}
            />
            <span className="pcc-date-sep">to</span>
            <input
              type="date"
              className="pcc-date"
              value={endDate}
              min={availableDates.length > 0 ? availableDates[0] : undefined}
              max={availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined}
              onChange={e => onEndDateChange(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Chart Type</div>
        <div className="pcc-btn-group">
          {CHART_TYPES.map(t => (
            <button
              key={t.key}
              className={`pcc-btn${chartType === t.key ? ' active' : ''}`}
              onClick={() => onChartTypeChange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
