import { useState, useMemo, useEffect, useCallback } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import Widget from '../components/Widget';
import WidgetGrid from '../components/WidgetGrid';
import type { FlowRow, ClassFilter, InterfaceInfo, InterfaceStat, ChartType, Resolution, DateRange } from '../data/interfaceTransforms';
import {
  detectFlowColumns, extractInterfaces, getAvailableDates,
  filterByDateRange, filterByClass, pivotFlows,
  computeInterfaceStats,
} from '../data/interfaceTransforms';
import { computeFlowKPIs } from '../data/interfaceMetrics';
import type { FlowKPIs } from '../data/interfaceMetrics';
import {
  buildFlowSummaryContext, deterministicFlowSummary, fetchAIFlowSummary,
} from '../data/interfaceSummary';

const DATASETS = [
  'external_limits_flows', 'atc_ttc', 'ttcf',
  'par_flows', 'erie_circulation_da', 'erie_circulation_rt',
];
const LIVE_REFRESH_MS = 30 * 1000;

interface TtcfResponse {
  status: string;
  date: string;
  derates: Record<string, any>[];
  total_entries?: number;
  derate_count?: number;
  paths?: string[];
  message?: string;
}

function TTCFDeratesSection() {
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [data, setData] = useState<TtcfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [pathFilter, setPathFilter] = useState('');

  const fetchTtcf = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ttcf-derates?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchTtcf(); }, [fetchTtcf]);

  const filteredDerates = useMemo(() => {
    if (!data?.derates) return [];
    if (!pathFilter) return data.derates;
    return data.derates.filter(d => d['Path Name'] === pathFilter);
  }, [data, pathFilter]);

  const displayCols = ['Path Name', 'Cause Of Derate', 'Date Out', 'Time Out', 'Date In', 'Time In',
    'Import TTC Impact', 'Revised Import TTC', 'Base Import TTC',
    'Export TTC Impact', 'Revised Export TTC', 'Base Export TTC'];

  return (
    <div style={{ marginTop: 24 }}>
      <div className="section-title" style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
        TTCF Derates
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
        Transfer capability reductions from NYISO's TTCF postings — shows active derates impacting import/export TTC on each interface path.
      </p>
      <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          type="date"
          className="gen-map-select"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        {data && data.paths && data.paths.length > 0 && (
          <select className="gen-map-select" value={pathFilter} onChange={e => setPathFilter(e.target.value)}>
            <option value="">All Paths</option>
            {data.paths.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <button className="pill active" onClick={fetchTtcf} style={{ cursor: 'pointer' }}>
          Refresh
        </button>
      </div>
      {loading && <div className="loading"><div className="spinner" /> Loading TTCF derate data...</div>}
      {!loading && data && data.status === 'error' && (
        <div className="insight-card" style={{ borderLeftColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>TTCF Fetch Error</div>
          <div className="insight-body">{data.message || 'Failed to load TTCF data.'}</div>
        </div>
      )}
      {!loading && data && data.status === 'no_data' && (
        <div className="insight-card">
          <div className="insight-body">{data.message || 'No TTCF data available for this date.'}</div>
        </div>
      )}
      {!loading && data && data.status === 'ok' && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
            <div className="kpi-card accent">
              <div className="kpi-label">Active Derates</div>
              <div className="kpi-value">{filteredDerates.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total TTCF Entries</div>
              <div className="kpi-value">{data.total_entries || 0}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Paths With Derates</div>
              <div className="kpi-value">
                {data.derates ? new Set(data.derates.map(d => d['Path Name'])).size : 0}
              </div>
            </div>
          </div>

          {filteredDerates.length > 0 && (
            <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                className="chart-card-header"
                style={{ padding: '14px 20px', cursor: 'pointer' }}
                onClick={() => setExpanded(!expanded)}
              >
                <div className="chart-card-title">
                  <span className="chevron">{expanded ? '▾' : '▸'}</span>{' '}
                  TTCF Derate Details
                </div>
                <span className="badge badge-primary">
                  {filteredDerates.length} derates{pathFilter ? ` · ${pathFilter}` : ''}
                </span>
              </div>
              {expanded && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="rank-table" style={{ borderSpacing: 0, fontSize: 12 }}>
                    <thead>
                      <tr>
                        {displayCols.map(col => (
                          <th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDerates.map((row, i) => (
                        <tr key={i}>
                          {displayCols.map(col => {
                            const val = row[col];
                            const isImpact = col.includes('Impact');
                            const numVal = typeof val === 'number' ? val : parseFloat(val);
                            return (
                              <td
                                key={col}
                                style={{
                                  whiteSpace: 'nowrap',
                                  fontWeight: isImpact && !isNaN(numVal) && Math.abs(numVal) > 0 ? 700 : 400,
                                  color: isImpact && !isNaN(numVal) && numVal < 0 ? 'var(--danger)' : isImpact && !isNaN(numVal) && numVal > 0 ? 'var(--accent)' : 'var(--text)',
                                }}
                              >
                                {isImpact && !isNaN(numVal) ? `${numVal >= 0 ? '+' : ''}${numVal.toFixed(0)} MW` : (val ?? '—')}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {filteredDerates.length === 0 && (
            <div className="insight-card">
              <div className="insight-body">
                No active derates found{pathFilter ? ` for ${pathFilter}` : ''} on {data.date}.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
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

interface FlowControlsProps {
  classFilter: ClassFilter;
  onClassFilterChange: (c: ClassFilter) => void;
  internalCount: number;
  externalCount: number;
  interfaces: string[];
  selectedInterfaces: string[];
  onInterfacesChange: (s: string[]) => void;
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

function FlowChartControls({
  classFilter, onClassFilterChange, internalCount, externalCount,
  interfaces, selectedInterfaces, onInterfacesChange,
  resolution, onResolutionChange,
  dateRange, onDateRangeChange,
  startDate, endDate, onStartDateChange, onEndDateChange, availableDates,
  chartType, onChartTypeChange,
}: FlowControlsProps) {
  const allSelected = selectedInterfaces.length === interfaces.length;
  return (
    <div className="pcc-panel">
      <div className="pcc-title">Chart Controls</div>

      <div className="pcc-section">
        <div className="pcc-label">Class</div>
        <div className="pcc-btn-group">
          {([['all', `All (${internalCount + externalCount})`], ['Internal', `Internal (${internalCount})`], ['External', `External (${externalCount})`]] as [ClassFilter, string][]).map(([val, lbl]) => (
            <button key={val} className={`pcc-btn${classFilter === val ? ' active' : ''}`} onClick={() => onClassFilterChange(val)}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Interfaces</div>
        <div className="pcc-zone-actions">
          <button
            className={`pcc-mini-btn${allSelected ? ' active' : ''}`}
            onClick={() => onInterfacesChange(allSelected ? [] : [...interfaces])}
          >
            {allSelected ? 'Clear' : 'All'}
          </button>
        </div>
        <div className="pcc-zone-grid">
          {interfaces.map(s => (
            <label key={s} className="pcc-zone-item">
              <input
                type="checkbox"
                checked={selectedInterfaces.includes(s)}
                onChange={() => {
                  onInterfacesChange(
                    selectedInterfaces.includes(s)
                      ? selectedInterfaces.filter(x => x !== s)
                      : [...selectedInterfaces, s]
                  );
                }}
              />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Resolution</div>
        <div className="pcc-btn-group">
          {RESOLUTIONS.map(r => (
            <button key={r.key} className={`pcc-btn${resolution === r.key ? ' active' : ''}`} onClick={() => onResolutionChange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Date Range</div>
        <div className="pcc-btn-group">
          {DATE_RANGES.map(d => (
            <button key={d.key} className={`pcc-btn${dateRange === d.key ? ' active' : ''}`} onClick={() => onDateRangeChange(d.key)}>
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
            <button key={t.key} className={`pcc-btn${chartType === t.key ? ' active' : ''}`} onClick={() => onChartTypeChange(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function InterfaceFlows() {
  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedInterfaces, setSelectedInterfaces] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [showRaw, setShowRaw] = useState(false);
  const [highlightedInterface, setHighlightedInterface] = useState<string | null>(null);

  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiRequestedRef = useState(() => ({ current: false }))[0];

  const { data: flowData, loading, error } = useDataset('external_limits_flows', 'hourly', undefined, undefined, 50000, 0, 0, { refreshMs: LIVE_REFRESH_MS, loadAllPages: true });

  const rows: FlowRow[] = useMemo(
    () => (flowData?.data || []) as FlowRow[],
    [flowData]
  );

  const { nameCol, flowCol } = useMemo(() => detectFlowColumns(rows), [rows]);

  const allInterfaces: InterfaceInfo[] = useMemo(
    () => extractInterfaces(rows, nameCol),
    [rows, nameCol]
  );

  const availableDates = useMemo(() => getAvailableDates(rows), [rows]);

  const handleDateRangeChange = (range: DateRange) => {
    setDateRange(range);
    if (range === 'custom' && (!startDate || !endDate) && availableDates.length > 0) {
      const end = availableDates[availableDates.length - 1];
      const startIdx = Math.max(0, availableDates.length - 7);
      const start = availableDates[startIdx];
      setStartDate(start);
      setEndDate(end);
    }
  };

  const internalCount = useMemo(
    () => allInterfaces.filter(i => i.meta.classification === 'Internal').length,
    [allInterfaces]
  );
  const externalCount = useMemo(
    () => allInterfaces.filter(i => i.meta.classification === 'External').length,
    [allInterfaces]
  );

  const visibleInterfaces = useMemo(() => {
    if (classFilter === 'all') return allInterfaces;
    return allInterfaces.filter(i => i.meta.classification === classFilter);
  }, [allInterfaces, classFilter]);

  const visibleDisplayNames = useMemo(
    () => visibleInterfaces.map(i => i.display),
    [visibleInterfaces]
  );

  useEffect(() => {
    if (visibleDisplayNames.length > 0 && selectedInterfaces.length === 0) {
      setSelectedInterfaces(visibleDisplayNames.slice(0, 8));
    }
  }, [visibleDisplayNames]);

  useEffect(() => {
    setSelectedInterfaces(visibleDisplayNames.slice(0, 8));
  }, [classFilter]);

  const latestDate = useMemo(() => {
    const dates = getAvailableDates(rows);
    return dates.length ? dates[dates.length - 1] : null;
  }, [rows]);

  const kpis: FlowKPIs = useMemo(() => {
    if (!latestDate) return computeFlowKPIs(rows, rows);
    const latest = rows.filter(r => r.Date === latestDate);
    return computeFlowKPIs(latest, rows);
  }, [rows, latestDate]);

  const fallbackSummary = useMemo(() => deterministicFlowSummary(kpis), [kpis]);

  useEffect(() => {
    if (aiRequestedRef.current) return;
    if (loading || !rows.length) return;
    aiRequestedRef.current = true;
    setAiLoading(true);
    const ctx = buildFlowSummaryContext(kpis, 'Latest available data');
    fetchAIFlowSummary(ctx).then(s => {
      if (s) setAiSummary(s);
    }).finally(() => setAiLoading(false));
  }, [loading, rows.length, kpis]);

  const dateFiltered = useMemo(
    () => filterByDateRange(rows, dateRange, startDate, endDate),
    [rows, dateRange, startDate, endDate]
  );

  const classFiltered = useMemo(
    () => filterByClass(dateFiltered, classFilter, nameCol),
    [dateFiltered, classFilter, nameCol]
  );

  const chartData = useMemo(
    () => pivotFlows(classFiltered, selectedInterfaces, nameCol, flowCol, resolution),
    [classFiltered, selectedInterfaces, nameCol, flowCol, resolution]
  );

  const interfaceStats: InterfaceStat[] = useMemo(
    () => computeInterfaceStats(dateFiltered, nameCol, flowCol, classFilter),
    [dateFiltered, nameCol, flowCol, classFilter]
  );

  const activeForChart = selectedInterfaces.filter(i => visibleDisplayNames.includes(i));

  const hasNegative = useMemo(() => {
    for (const row of chartData) {
      for (const key of Object.keys(row)) {
        if (key === 'Date') continue;
        if (Number(row[key]) < 0) return true;
      }
    }
    return false;
  }, [chartData]);

  const effectiveChartType: ChartType = (chartType === 'area' || chartType === 'bar') && hasNegative
    ? 'line' : chartType;

  const stackWarning = (chartType === 'area' || chartType === 'bar') && hasNegative;

  const displaySummary = aiSummary || fallbackSummary;

  const fmtFlow = (v: number) => Math.round(v).toLocaleString();

  const handleRowClick = (display: string) => {
    if (highlightedInterface === display) {
      setHighlightedInterface(null);
      return;
    }
    setHighlightedInterface(display);
    if (!selectedInterfaces.includes(display)) {
      setSelectedInterfaces([...selectedInterfaces, display]);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Interface Flows</h1>
        <p className="page-subtitle">
          Transmission interface utilization, import/export pressure, and transfer limits
        </p>
      </div>

      <div className="price-summary-box">
        <div className="price-summary-header">
          <span className="price-summary-icon"></span>
          <span className="price-summary-title">Flow Summary</span>
          {aiLoading && <span className="price-summary-badge loading">Generating AI summary...</span>}
          {!aiLoading && aiSummary && <span className="price-summary-badge ai">AI Enhanced</span>}
          {!aiLoading && !aiSummary && <span className="price-summary-badge">Deterministic</span>}
        </div>
        <div className="price-summary-body">{displaySummary}</div>
      </div>

      {error && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load flow data: {error}</div>
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> Loading flow data...</div>}

      {!loading && (
        <div className="kpi-grid price-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Avg Internal</div>
            <div className="kpi-value">
              {kpis.onPeakAvgInternal != null ? <>{fmtFlow(kpis.onPeakAvgInternal)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Avg External</div>
            <div className="kpi-value">
              {kpis.onPeakAvgExternal != null ? <>{fmtFlow(kpis.onPeakAvgExternal)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak Positive Flow</div>
            <div className="kpi-value">
              {kpis.peakPositive ? <>{fmtFlow(kpis.peakPositive.value)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.peakPositive && <div className="kpi-sub">{kpis.peakPositive.iface} · {kpis.peakPositive.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak Negative Flow</div>
            <div className="kpi-value">
              {kpis.peakNegative ? (
                <span style={{ color: kpis.peakNegative.value < -500 ? 'var(--danger)' : 'var(--text)' }}>
                  {fmtFlow(kpis.peakNegative.value)}<span className="kpi-unit">MW</span>
                </span>
              ) : '—'}
            </div>
            {kpis.peakNegative && <div className="kpi-sub">{kpis.peakNegative.iface} · {kpis.peakNegative.timestamp}</div>}
          </div>
          <div className="kpi-card accent">
            <div className="kpi-label">Most Active Interface</div>
            <div className="kpi-value" style={{ fontSize: '1rem' }}>{kpis.mostActive || '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Top Internal Interface</div>
            <div className="kpi-value" style={{ fontSize: '1rem' }}>{kpis.topInternal || '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Top External Interface</div>
            <div className="kpi-value" style={{ fontSize: '1rem' }}>{kpis.topExternal || '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Active Interfaces</div>
            <div className="kpi-value">{kpis.activeCount || '—'}</div>
            <div className="kpi-sub">{internalCount} internal · {externalCount} external</div>
          </div>
        </div>
      )}

      {!loading && (
        <WidgetGrid>
          <Widget
            size="full"
            title="Interface Flows Over Time"
            subtitle={`${resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'} · ${activeForChart.length}/${visibleDisplayNames.length} interfaces${classFilter !== 'all' ? ` · ${classFilter}` : ''} · ${dateRange === 'today' ? 'Latest Day' : dateRange === 'all' ? 'All Dates' : `${startDate} — ${endDate}`}`}
            badge={`${chartData.length} points`}
            controls={
              <FlowChartControls
                classFilter={classFilter}
                onClassFilterChange={setClassFilter}
                internalCount={internalCount}
                externalCount={externalCount}
                interfaces={visibleDisplayNames}
                selectedInterfaces={selectedInterfaces}
                onInterfacesChange={setSelectedInterfaces}
                resolution={resolution}
                onResolutionChange={setResolution}
                dateRange={dateRange}
                onDateRangeChange={handleDateRangeChange}
                startDate={startDate}
                endDate={endDate}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                availableDates={availableDates}
                chartType={chartType}
                onChartTypeChange={setChartType}
              />
            }
          >
            {stackWarning && (
              <div style={{ padding: '8px 14px', background: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                Stacked charts disabled — data contains negative flows. Showing line chart instead.
              </div>
            )}
            <PriceChart
              data={chartData}
              xKey="Date"
              yKeys={activeForChart}
              chartType={effectiveChartType}
              height={420}
              valuePrefix=""
              valueSuffix=" MW"
            />
          </Widget>

          {interfaceStats.length > 0 && (
            <Widget size="full" title={`Interface Summary`} subtitle={`${interfaceStats.length} interfaces${classFilter !== 'all' ? ` · ${classFilter} only` : ''}`} noPad>
              <div style={{ overflowX: 'auto' }}>
                <table className="rank-table" style={{ borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th>Interface</th>
                      <th>Class</th>
                      <th>Region / Path</th>
                      <th>Direction</th>
                      <th>Avg Flow (MW)</th>
                      <th>Max Flow (MW)</th>
                      <th>Min Flow (MW)</th>
                      <th>Observations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interfaceStats.map(s => (
                      <tr key={s.raw} onClick={() => handleRowClick(s.display)} style={{ cursor: 'pointer', background: highlightedInterface === s.display ? 'var(--primary-light)' : undefined }}>
                        <td style={{ fontWeight: 600 }}>{s.display}</td>
                        <td><span className={`intf-class-tag ${s.meta.classification === 'Internal' ? 'intf-internal' : 'intf-external'}`}>{s.meta.classification}</span></td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.meta.region}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.meta.direction}</td>
                        <td>{s.avg.toFixed(1)}</td>
                        <td style={{ fontWeight: 600, color: s.max > 2000 ? 'var(--danger)' : 'var(--text)' }}>{s.max.toFixed(0)}</td>
                        <td>{s.min.toFixed(0)}</td>
                        <td>{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Widget>
          )}
        </WidgetGrid>
      )}

      <TTCFDeratesSection />

      <div className="section-container">
        <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
          <span className="chevron">{showRaw ? '▾' : '▸'}</span>
          All Flow Datasets ({DATASETS.length})
        </div>
        {showRaw && (
          <div style={{ marginTop: 8 }}>
            {DATASETS.map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution="raw" defaultExpanded={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
