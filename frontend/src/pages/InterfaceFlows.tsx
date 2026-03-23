import { useState, useMemo, useEffect, useCallback } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import Widget from '../components/Widget';
import DraggableGrid from '../components/DraggableGrid';
import type { GridItem } from '../components/DraggableGrid';
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
  status: string; date: string; derates: Record<string, any>[];
  total_entries?: number; derate_count?: number; paths?: string[]; message?: string;
}

function TTCFDeratesContent() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
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
    } catch { setData(null); } finally { setLoading(false); }
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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="pcc-section" style={{ margin: 0 }}>
          <div className="pcc-label">Date</div>
          <input type="date" className="pcc-date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        {data?.paths && data.paths.length > 0 && (
          <div className="pcc-section" style={{ margin: 0 }}>
            <div className="pcc-label">Path Filter</div>
            <select className="gen-map-select" value={pathFilter} onChange={e => setPathFilter(e.target.value)}>
              <option value="">All Paths</option>
              {data.paths.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
        <div style={{ paddingTop: 18 }}>
          <button className="pcc-btn active" onClick={fetchTtcf}>Refresh</button>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading TTCF derate data...</div>}
      {!loading && data?.status === 'ok' && (
        <>
          <div className="kpi-grid-fixed" style={{ marginBottom: 16 }}>
            <div className="kpi-card-fixed accent"><div className="kpi-label">Active Derates</div><div className="kpi-value">{filteredDerates.length}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Total TTCF Entries</div><div className="kpi-value">{data.total_entries || 0}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Paths With Derates</div><div className="kpi-value">{data.derates ? new Set(data.derates.map(d => d['Path Name'])).size : 0}</div></div>
          </div>
          {filteredDerates.length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', cursor: 'pointer', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => setExpanded(!expanded)}>
                <div style={{ fontSize: 13, fontWeight: 700 }}><span className="chevron">{expanded ? '▾' : '▸'}</span>{' '}TTCF Derate Details</div>
                <span className="badge badge-primary">{filteredDerates.length} derates{pathFilter ? ` · ${pathFilter}` : ''}</span>
              </div>
              {expanded && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="rank-table" style={{ borderSpacing: 0, fontSize: 12 }}>
                    <thead><tr>{displayCols.map(col => <th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</th>)}</tr></thead>
                    <tbody>
                      {filteredDerates.map((row, i) => (
                        <tr key={i}>
                          {displayCols.map(col => {
                            const val = row[col];
                            const isImpact = col.includes('Impact');
                            const numVal = typeof val === 'number' ? val : parseFloat(val);
                            return (
                              <td key={col} style={{ whiteSpace: 'nowrap', fontWeight: isImpact && !isNaN(numVal) && Math.abs(numVal) > 0 ? 700 : 400, color: isImpact && !isNaN(numVal) && numVal < 0 ? 'var(--danger)' : isImpact && !isNaN(numVal) && numVal > 0 ? 'var(--accent)' : 'var(--text)' }}>
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
            <div className="insight-card"><div className="insight-body">No active derates found{pathFilter ? ` for ${pathFilter}` : ''} on {data.date}.</div></div>
          )}
        </>
      )}
      {!loading && data?.status === 'no_data' && (
        <div className="insight-card"><div className="insight-body">{data.message || 'No TTCF data available for this date.'}</div></div>
      )}
    </div>
  );
}

const RESOLUTIONS: { key: Resolution; label: string }[] = [
  { key: 'hourly', label: 'Hourly' }, { key: 'on_peak', label: 'On-Peak Avg' },
  { key: 'off_peak', label: 'Off-Peak Avg' }, { key: 'daily', label: 'Daily Avg' },
];
const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: 'line-markers', label: 'Line + Markers' }, { key: 'line', label: 'Line' },
  { key: 'area', label: 'Stacked Area' }, { key: 'bar', label: 'Stacked Bar' },
];
const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Latest Day' }, { key: 'custom', label: 'Custom Range' }, { key: 'all', label: 'All Dates' },
];

interface FlowControlsProps {
  classFilter: ClassFilter; onClassFilterChange: (c: ClassFilter) => void;
  internalCount: number; externalCount: number;
  interfaces: string[]; selectedInterfaces: string[]; onInterfacesChange: (s: string[]) => void;
  resolution: Resolution; onResolutionChange: (r: Resolution) => void;
  dateRange: DateRange; onDateRangeChange: (r: DateRange) => void;
  startDate: string; endDate: string; onStartDateChange: (d: string) => void; onEndDateChange: (d: string) => void;
  availableDates: string[]; chartType: ChartType; onChartTypeChange: (t: ChartType) => void;
}

function FlowChartControls({ classFilter, onClassFilterChange, internalCount, externalCount, interfaces, selectedInterfaces, onInterfacesChange, resolution, onResolutionChange, dateRange, onDateRangeChange, startDate, endDate, onStartDateChange, onEndDateChange, availableDates, chartType, onChartTypeChange }: FlowControlsProps) {
  const allSelected = selectedInterfaces.length === interfaces.length;
  return (
    <div className="pcc-panel">
      <div className="pcc-title">Chart Controls</div>
      <div className="pcc-section">
        <div className="pcc-label">Class</div>
        <div className="pcc-btn-group">
          {([['all', `All (${internalCount + externalCount})`], ['Internal', `Int (${internalCount})`], ['External', `Ext (${externalCount})`]] as [ClassFilter, string][]).map(([val, lbl]) => (
            <button key={val} className={`pcc-btn${classFilter === val ? ' active' : ''}`} onClick={() => onClassFilterChange(val)}>{lbl}</button>
          ))}
        </div>
      </div>
      <div className="pcc-section">
        <div className="pcc-label">Interfaces</div>
        <div className="pcc-zone-actions">
          <button className={`pcc-mini-btn${allSelected ? ' active' : ''}`} onClick={() => onInterfacesChange(allSelected ? [] : [...interfaces])}>{allSelected ? 'Clear' : 'All'}</button>
        </div>
        <div className="pcc-zone-grid">
          {interfaces.map(s => (
            <label key={s} className="pcc-zone-item">
              <input type="checkbox" checked={selectedInterfaces.includes(s)} onChange={() => onInterfacesChange(selectedInterfaces.includes(s) ? selectedInterfaces.filter(x => x !== s) : [...selectedInterfaces, s])} />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="pcc-section">
        <div className="pcc-label">Resolution</div>
        <div className="pcc-btn-group">{RESOLUTIONS.map(r => <button key={r.key} className={`pcc-btn${resolution === r.key ? ' active' : ''}`} onClick={() => onResolutionChange(r.key)}>{r.label}</button>)}</div>
      </div>
      <div className="pcc-section">
        <div className="pcc-label">Date Range</div>
        <div className="pcc-btn-group">{DATE_RANGES.map(d => <button key={d.key} className={`pcc-btn${dateRange === d.key ? ' active' : ''}`} onClick={() => onDateRangeChange(d.key)}>{d.label}</button>)}</div>
        {dateRange === 'custom' && (
          <div className="pcc-date-inputs">
            <input type="date" className="pcc-date" value={startDate} min={availableDates[0]} max={availableDates[availableDates.length - 1]} onChange={e => onStartDateChange(e.target.value)} />
            <span className="pcc-date-sep">to</span>
            <input type="date" className="pcc-date" value={endDate} min={availableDates[0]} max={availableDates[availableDates.length - 1]} onChange={e => onEndDateChange(e.target.value)} />
          </div>
        )}
      </div>
      <div className="pcc-section">
        <div className="pcc-label">Chart Type</div>
        <div className="pcc-btn-group">{CHART_TYPES.map(t => <button key={t.key} className={`pcc-btn${chartType === t.key ? ' active' : ''}`} onClick={() => onChartTypeChange(t.key)}>{t.label}</button>)}</div>
      </div>
    </div>
  );
}

const DEFAULT_LAYOUT: GridItem[] = [
  { i: 'chart', x: 0, y: 0,  w: 12, h: 8, minH: 6 },
  { i: 'stats', x: 0, y: 8,  w: 12, h: 6, minH: 4 },
  { i: 'ttcf',  x: 0, y: 14, w: 12, h: 7, minH: 5 },
  { i: 'raw',   x: 0, y: 21, w: 12, h: 3, minH: 3 },
];

export default function InterfaceFlows() {
  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedInterfaces, setSelectedInterfaces] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [highlightedInterface, setHighlightedInterface] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiRequestedRef = useState(() => ({ current: false }))[0];

  const { data: flowData, loading, error } = useDataset('external_limits_flows', 'hourly', undefined, undefined, 50000, 0, 0, { refreshMs: LIVE_REFRESH_MS, loadAllPages: true });
  const rows: FlowRow[] = useMemo(() => (flowData?.data || []) as FlowRow[], [flowData]);
  const { nameCol, flowCol } = useMemo(() => detectFlowColumns(rows), [rows]);
  const allInterfaces: InterfaceInfo[] = useMemo(() => extractInterfaces(rows, nameCol), [rows, nameCol]);
  const availableDates = useMemo(() => getAvailableDates(rows), [rows]);

  const handleDateRangeChange = (range: DateRange) => {
    setDateRange(range);
    if (range === 'custom' && (!startDate || !endDate) && availableDates.length > 0) {
      setStartDate(availableDates[Math.max(0, availableDates.length - 7)]);
      setEndDate(availableDates[availableDates.length - 1]);
    }
  };

  const internalCount = useMemo(() => allInterfaces.filter(i => i.meta.classification === 'Internal').length, [allInterfaces]);
  const externalCount = useMemo(() => allInterfaces.filter(i => i.meta.classification === 'External').length, [allInterfaces]);
  const visibleInterfaces = useMemo(() => classFilter === 'all' ? allInterfaces : allInterfaces.filter(i => i.meta.classification === classFilter), [allInterfaces, classFilter]);
  const visibleDisplayNames = useMemo(() => visibleInterfaces.map(i => i.display), [visibleInterfaces]);

  useEffect(() => {
    if (visibleDisplayNames.length > 0 && selectedInterfaces.length === 0) setSelectedInterfaces(visibleDisplayNames.slice(0, 8));
  }, [visibleDisplayNames]);
  useEffect(() => { setSelectedInterfaces(visibleDisplayNames.slice(0, 8)); }, [classFilter]);

  const latestDate = useMemo(() => { const d = getAvailableDates(rows); return d.length ? d[d.length - 1] : null; }, [rows]);
  const kpis: FlowKPIs = useMemo(() => {
    if (!latestDate) return computeFlowKPIs(rows, rows);
    return computeFlowKPIs(rows.filter(r => r.Date === latestDate), rows);
  }, [rows, latestDate]);

  useEffect(() => {
    if (aiRequestedRef.current || loading || !rows.length) return;
    aiRequestedRef.current = true;
    setAiLoading(true);
    fetchAIFlowSummary(buildFlowSummaryContext(kpis, 'Latest available data'))
      .then(s => { if (s) setAiSummary(s); }).finally(() => setAiLoading(false));
  }, [loading, rows.length, kpis]);

  const dateFiltered = useMemo(() => filterByDateRange(rows, dateRange, startDate, endDate), [rows, dateRange, startDate, endDate]);
  const classFiltered = useMemo(() => filterByClass(dateFiltered, classFilter, nameCol), [dateFiltered, classFilter, nameCol]);
  const chartData = useMemo(() => pivotFlows(classFiltered, selectedInterfaces, nameCol, flowCol, resolution), [classFiltered, selectedInterfaces, nameCol, flowCol, resolution]);
  const interfaceStats: InterfaceStat[] = useMemo(() => computeInterfaceStats(dateFiltered, nameCol, flowCol, classFilter), [dateFiltered, nameCol, flowCol, classFilter]);
  const activeForChart = selectedInterfaces.filter(i => visibleDisplayNames.includes(i));

  const hasNegative = useMemo(() => {
    for (const row of chartData) for (const key of Object.keys(row)) { if (key !== 'Date' && Number(row[key]) < 0) return true; }
    return false;
  }, [chartData]);
  const effectiveChartType: ChartType = (chartType === 'area' || chartType === 'bar') && hasNegative ? 'line' : chartType;
  const stackWarning = (chartType === 'area' || chartType === 'bar') && hasNegative;

  const fmtFlow = (v: number) => Math.round(v).toLocaleString();

  const handleRowClick = (display: string) => {
    if (highlightedInterface === display) { setHighlightedInterface(null); return; }
    setHighlightedInterface(display);
    if (!selectedInterfaces.includes(display)) setSelectedInterfaces([...selectedInterfaces, display]);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Interface Flows</h1>
        <p className="page-subtitle">Transmission interface utilization, import/export pressure, and transfer limits</p>
      </div>

      {/* Fixed KPI Section */}
      <div className="kpi-section">
        <div className="kpi-section-header">
          <div className="kpi-section-title">Flow Summary</div>
          <span className="kpi-section-badge">{aiLoading ? 'Generating...' : aiSummary ? 'AI Enhanced' : 'Deterministic'}</span>
        </div>
        {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>Failed to load flow data: {error}</div>}
        <div className="kpi-summary-text">{aiSummary || deterministicFlowSummary(kpis)}</div>
        <div className="kpi-section-header" style={{ marginTop: 24 }}>
          <div className="kpi-section-title">Key Flow Metrics</div>
          {latestDate && <div className="kpi-section-subtitle">Latest day: {latestDate}</div>}
        </div>
        {loading ? (
          <div className="loading"><div className="spinner" /> Loading flow data...</div>
        ) : (
          <div className="kpi-grid-fixed">
            <div className="kpi-card-fixed"><div className="kpi-label">On-Peak Avg Internal</div><div className="kpi-value">{kpis.onPeakAvgInternal != null ? <>{fmtFlow(kpis.onPeakAvgInternal)}<span className="kpi-unit">MW</span></> : '—'}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">On-Peak Avg External</div><div className="kpi-value">{kpis.onPeakAvgExternal != null ? <>{fmtFlow(kpis.onPeakAvgExternal)}<span className="kpi-unit">MW</span></> : '—'}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Peak Positive Flow</div><div className="kpi-value">{kpis.peakPositive ? <>{fmtFlow(kpis.peakPositive.value)}<span className="kpi-unit">MW</span></> : '—'}</div>{kpis.peakPositive && <div className="kpi-sub">{kpis.peakPositive.iface} · {kpis.peakPositive.timestamp}</div>}</div>
            <div className="kpi-card-fixed"><div className="kpi-label">Peak Negative Flow</div><div className="kpi-value">{kpis.peakNegative ? <>{fmtFlow(kpis.peakNegative.value)}<span className="kpi-unit">MW</span></> : '—'}</div>{kpis.peakNegative && <div className="kpi-sub">{kpis.peakNegative.iface} · {kpis.peakNegative.timestamp}</div>}</div>
            <div className="kpi-card-fixed accent"><div className="kpi-label">Most Active Interface</div><div className="kpi-value" style={{ fontSize: '1rem' }}>{kpis.mostActive || '—'}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Active Interfaces</div><div className="kpi-value">{kpis.activeCount || '—'}</div><div className="kpi-sub">{internalCount} internal · {externalCount} external</div></div>
          </div>
        )}
      </div>

      {/* Draggable Widgets */}
      <DraggableGrid id="interface-flows" defaultLayout={DEFAULT_LAYOUT} rowHeight={60}>

        <div key="chart">
          <Widget draggable
            title="Interface Flows Over Time"
            subtitle={`${resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'} · ${activeForChart.length}/${visibleDisplayNames.length} interfaces`}
            badge={`${chartData.length} pts`}
            controls={
              <FlowChartControls
                classFilter={classFilter} onClassFilterChange={setClassFilter}
                internalCount={internalCount} externalCount={externalCount}
                interfaces={visibleDisplayNames} selectedInterfaces={selectedInterfaces} onInterfacesChange={setSelectedInterfaces}
                resolution={resolution} onResolutionChange={setResolution}
                dateRange={dateRange} onDateRangeChange={handleDateRangeChange}
                startDate={startDate} endDate={endDate} onStartDateChange={setStartDate} onEndDateChange={setEndDate}
                availableDates={availableDates} chartType={chartType} onChartTypeChange={setChartType}
              />
            }
          >
            {loading ? (
              <div className="loading"><div className="spinner" /> Loading...</div>
            ) : (
              <>
                {stackWarning && (
                  <div style={{ padding: '8px 14px', background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                    Stacked charts disabled — data contains negative flows. Showing line chart instead.
                  </div>
                )}
                <PriceChart data={chartData} xKey="Date" yKeys={activeForChart} chartType={effectiveChartType} height={380} valuePrefix="" valueSuffix=" MW" />
              </>
            )}
          </Widget>
        </div>

        <div key="stats">
          <Widget draggable title={`Interface Summary`} subtitle={`${interfaceStats.length} interfaces${classFilter !== 'all' ? ` · ${classFilter} only` : ''}`} noPad>
            {interfaceStats.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="rank-table" style={{ borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th>Interface</th><th>Class</th><th>Region / Path</th><th>Direction</th>
                      <th>Avg Flow (MW)</th><th>Max Flow (MW)</th><th>Min Flow (MW)</th><th>Observations</th>
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
            ) : (
              <div className="loading"><div className="spinner" /> Loading interface stats...</div>
            )}
          </Widget>
        </div>

        <div key="ttcf">
          <Widget draggable title="TTCF Derates" subtitle="Transfer capability reductions from NYISO's TTCF postings">
            <TTCFDeratesContent />
          </Widget>
        </div>

        <div key="raw">
          <Widget draggable title={`All Flow Datasets (${DATASETS.length})`} defaultCollapsed noPad>
            {DATASETS.map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution="raw" defaultExpanded={i === 0} />
            ))}
          </Widget>
        </div>

      </DraggableGrid>
    </div>
  );
}
