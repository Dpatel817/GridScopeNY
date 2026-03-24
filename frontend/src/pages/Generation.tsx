/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import ChartControls from '../components/ChartControls';
import BarChart from '../components/BarChart';
import StackedBarChart from '../components/StackedBarChart';
import Widget from '../components/Widget';
import DraggableGrid from '../components/DraggableGrid';
import type { GridItem } from '../components/DraggableGrid';
import type { ChartType, Resolution, DateRange } from '../data/priceTransforms';
import type { GenRow, FuelBreakdown } from '../data/generationTransforms';
import {
  detectColumns, extractFuels, getAvailableDates,
  filterByDateRange, pivotByFuel, computeFuelBreakdown,
} from '../data/generationTransforms';
import { computeGenerationKPIs } from '../data/generationMetrics';
import type { GenerationKPIs } from '../data/generationMetrics';
import {
  buildGenerationSummaryContext, deterministicGenerationSummary,
  fetchAIGenerationSummary,
} from '../data/generationSummary';

const DATASETS = [
  'rtfuelmix', 'gen_maint_report', 'op_in_commit',
  'dam_imer', 'rt_imer', 'btm_da_forecast', 'btm_estimated_actual',
];

interface OicResponse {
  status: string; date: string; data: Record<string, any>[];
  columns: string[]; row_count: number; message?: string;
}
interface OicRangeResponse {
  status: string; start_date: string; end_date: string;
  total_commitments: number; active_zones: number; top_zone: string | null;
  by_zone: Record<string, number>; by_zone_type: Record<string, Record<string, number>>;
  all_types: string[]; mw_by_zone: Record<string, number>; has_mw: boolean;
  data: Record<string, any>[]; columns: string[]; row_count: number; message?: string;
}
type OicChartView = 'byZone' | 'byType' | 'byMW';

function OICCommitmentContent() {
  const today = new Date().toISOString().slice(0, 10);
  const [tableDate, setTableDate] = useState(today);
  const [tableData, setTableData] = useState<OicResponse | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(today);
  const [rangeData, setRangeData] = useState<OicRangeResponse | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [chartView, setChartView] = useState<OicChartView>('byZone');

  const fetchTable = useCallback(async () => {
    setTableLoading(true);
    try {
      const res = await fetch(`/api/oic?date=${tableDate}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTableData(await res.json());
    } catch { setTableData(null); } finally { setTableLoading(false); }
  }, [tableDate]);

  const fetchRange = useCallback(async () => {
    setRangeLoading(true);
    try {
      const res = await fetch(`/api/oic-range?start_date=${startDate}&end_date=${endDate}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRangeData(await res.json());
    } catch { setRangeData(null); } finally { setRangeLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { fetchTable(); }, [fetchTable]);
  useEffect(() => { fetchRange(); }, [fetchRange]);

  const zoneBarData = useMemo(() => {
    if (!rangeData || rangeData.status !== 'ok') return [];
    return Object.entries(rangeData.by_zone).map(([zone, count]) => ({ zone, count })).sort((a, b) => b.count - a.count);
  }, [rangeData]);

  const stackedData = useMemo(() => {
    if (!rangeData || rangeData.status !== 'ok' || !rangeData.all_types.length) return { data: [] as Record<string, unknown>[], keys: [] as string[] };
    const types = rangeData.all_types;
    const data = Object.entries(rangeData.by_zone_type).map(([zone, typeCounts]) => {
      const row: Record<string, unknown> = { zone };
      for (const t of types) row[t] = typeCounts[t] || 0;
      return row;
    });
    data.sort((a, b) => {
      const sumA = types.reduce((s, t) => s + ((a[t] as number) || 0), 0);
      const sumB = types.reduce((s, t) => s + ((b[t] as number) || 0), 0);
      return sumB - sumA;
    });
    return { data, keys: types };
  }, [rangeData]);

  const mwBarData = useMemo(() => {
    if (!rangeData || rangeData.status !== 'ok' || !rangeData.has_mw) return [];
    return Object.entries(rangeData.mw_by_zone).map(([zone, mw]) => ({ zone, mw })).sort((a, b) => b.mw - a.mw);
  }, [rangeData]);

  return (
    <div>
      <div className="pcc-section" style={{ padding: '0 0 12px' }}>
        <div className="pcc-label">Date Range</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input type="date" className="pcc-date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
          <input type="date" className="pcc-date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <button className="pcc-btn active" onClick={fetchRange}>Analyze</button>
        </div>
      </div>

      {rangeLoading && <div className="loading"><div className="spinner" /> Loading OIC data...</div>}

      {!rangeLoading && rangeData && rangeData.status === 'ok' && (
        <>
          <div className="kpi-grid-fixed" style={{ marginBottom: 12 }}>
            <div className="kpi-card-fixed"><div className="kpi-label">Total Commitments</div><div className="kpi-value">{rangeData.total_commitments.toLocaleString()}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Active Zones</div><div className="kpi-value">{rangeData.active_zones}</div></div>
            <div className="kpi-card-fixed accent"><div className="kpi-label">Top Zone</div><div className="kpi-value" style={{ fontSize: '1rem' }}>{rangeData.top_zone || '—'}</div></div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['byZone', 'byType', 'byMW'] as OicChartView[]).map(v => (
              <button key={v} className={`pcc-btn${chartView === v ? ' active' : ''}`} onClick={() => setChartView(v)}>
                {v === 'byZone' ? 'By Zone' : v === 'byType' ? 'By Type' : 'MW by Zone'}
              </button>
            ))}
          </div>
          {chartView === 'byZone' && <BarChart data={zoneBarData} xKey="zone" yKey="count" height={Math.max(240, zoneBarData.length * 30)} layout="horizontal" showLabels labelPrefix="" color="#2563eb" />}
          {chartView === 'byType' && stackedData.data.length > 0 && <StackedBarChart data={stackedData.data} xKey="zone" yKeys={stackedData.keys} height={Math.max(260, stackedData.data.length * 26)} />}
          {chartView === 'byMW' && <BarChart data={rangeData.has_mw && mwBarData.length > 0 ? mwBarData : zoneBarData} xKey="zone" yKey={rangeData.has_mw && mwBarData.length > 0 ? 'mw' : 'count'} height={Math.max(240, zoneBarData.length * 30)} layout="horizontal" showLabels labelPrefix="" color="#10b981" />}
        </>
      )}

      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Single Date:</label>
          <input type="date" className="pcc-date" value={tableDate} onChange={e => setTableDate(e.target.value)} />
          <button className="pcc-btn active" onClick={fetchTable}>Refresh</button>
          {!tableLoading && tableData?.status === 'ok' && <span className="badge badge-primary">{tableData.row_count} commitments</span>}
        </div>
        {tableLoading && <div className="loading"><div className="spinner" /> Loading...</div>}
        {!tableLoading && tableData?.status === 'ok' && tableData.data.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', cursor: 'pointer', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => setTableExpanded(!tableExpanded)}>
              <div style={{ fontSize: 13, fontWeight: 700 }}><span className="chevron">{tableExpanded ? '▾' : '▸'}</span>{' '}OIC Data — {tableData.date}</div>
            </div>
            {tableExpanded && (
              <div style={{ overflowX: 'auto' }}>
                <table className="rank-table" style={{ borderSpacing: 0, fontSize: 12 }}>
                  <thead><tr>{tableData.columns.map(col => <th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</th>)}</tr></thead>
                  <tbody>{tableData.data.map((row, i) => <tr key={i}>{tableData.columns.map(col => <td key={col} style={{ whiteSpace: 'nowrap' }}>{row[col] ?? '—'}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type ViewMode = 'fuel' | 'stacked' | 'total';
const LIVE_REFRESH_MS = 30 * 1000;

const DEFAULT_LAYOUT: GridItem[] = [
  { i: 'chart', x: 0, y: 0,  w: 12, h: 8, minH: 6 },
  { i: 'oic',   x: 0, y: 8,  w: 12, h: 9, minH: 6 },
  { i: 'raw',   x: 0, y: 17, w: 12, h: 3, minH: 3 },
];

export default function Generation() {
  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedFuels, setSelectedFuels] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('fuel');
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiRequestedRef = useState(() => ({ current: false }))[0];

  const { data: fuelData, loading, error } = useDataset('rtfuelmix', 'hourly', undefined, undefined, 50000, 0, 0, { refreshMs: LIVE_REFRESH_MS, loadAllPages: true });
  const rows: GenRow[] = useMemo(() => (fuelData?.data || []) as GenRow[], [fuelData]);
  const { genCol, fuelCol } = useMemo(() => detectColumns(rows), [rows]);
  const allFuels = useMemo(() => extractFuels(rows, fuelCol), [rows, fuelCol]);
  const availableDates = useMemo(() => getAvailableDates(rows), [rows]);

  const handleDateRangeChange = (range: DateRange) => {
    setDateRange(range);
    if (range === 'custom' && (!startDate || !endDate) && availableDates.length > 0) {
      setStartDate(availableDates[Math.max(0, availableDates.length - 7)]);
      setEndDate(availableDates[availableDates.length - 1]);
    }
  };

  useEffect(() => {
    if (allFuels.length > 0 && selectedFuels.length === 0) setSelectedFuels([...allFuels]);
  }, [allFuels]);

  const latestDate = useMemo(() => { const d = getAvailableDates(rows); return d.length ? d[d.length - 1] : null; }, [rows]);
  const latestRows = useMemo(() => latestDate ? rows.filter((r: any) => r.Date === latestDate) : rows, [rows, latestDate]);
  const breakdown: FuelBreakdown[] = useMemo(() => computeFuelBreakdown(latestRows, fuelCol, genCol), [latestRows, fuelCol, genCol]);
  const kpis: GenerationKPIs = useMemo(() => computeGenerationKPIs(latestRows, breakdown, rows), [latestRows, breakdown, rows]);
  const fallbackSummary = useMemo(() => deterministicGenerationSummary(kpis, breakdown), [kpis, breakdown]);

  useEffect(() => {
    if (aiRequestedRef.current || loading || !rows.length) return;
    aiRequestedRef.current = true;
    setAiLoading(true);
    fetchAIGenerationSummary(buildGenerationSummaryContext(kpis, breakdown, 'Latest available data'))
      .then(s => { if (s) setAiSummary(s); }).finally(() => setAiLoading(false));
  }, [loading, rows.length, kpis, breakdown]);

  const filtered = useMemo(() => filterByDateRange(rows, dateRange, startDate, endDate), [rows, dateRange, startDate, endDate]);
  const fuelChartData = useMemo(() => pivotByFuel(filtered, selectedFuels, fuelCol, genCol, resolution), [filtered, selectedFuels, fuelCol, genCol, resolution]);
  const totalChartData = useMemo(() => fuelChartData.map(row => {
    let total = 0;
    for (const key of Object.keys(row)) { if (key !== 'Date') { const v = Number(row[key]); if (!isNaN(v)) total += v; } }
    return { Date: row.Date, Total: Math.round(total) };
  }), [fuelChartData]);

  const fmtLoad = (v: number) => Math.round(v).toLocaleString();

  return (
    <div className="page">
      <div className="page-header">
        <h1>Generation Mix</h1>
        <p className="page-subtitle">Real-time fuel mix, committed capacity, BTM solar, and generation maintenance</p>
      </div>

      <div className="kpi-section">
        <div className="kpi-section-header">
          <div className="kpi-section-title">Generation Summary</div>
          <span className="kpi-section-badge">{aiLoading ? 'Generating...' : aiSummary ? 'AI Enhanced' : 'Deterministic'}</span>
        </div>
        {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>Failed to load generation data: {error}</div>}
        <div className="kpi-summary-text">{aiSummary || fallbackSummary}</div>
        <div className="kpi-section-header" style={{ marginTop: 24 }}>
          <div className="kpi-section-title">Key Generation Metrics</div>
          {latestDate && <div className="kpi-section-subtitle">Latest day: {latestDate}</div>}
        </div>
        {loading ? (
          <div className="loading"><div className="spinner" /> Loading generation data...</div>
        ) : (
          <div className="kpi-grid-fixed">
            <div className="kpi-card-fixed"><div className="kpi-label">On-Peak Avg Total Gen</div><div className="kpi-value">{kpis.onPeakAvgTotal != null ? <>{fmtLoad(kpis.onPeakAvgTotal)}<span className="kpi-unit">MW</span></> : '—'}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Peak Total Gen</div><div className="kpi-value">{kpis.peakTotal ? <>{fmtLoad(kpis.peakTotal.value)}<span className="kpi-unit">MW</span></> : '—'}</div>{kpis.peakTotal && <div className="kpi-sub">{kpis.peakTotal.timestamp}</div>}</div>
            <div className="kpi-card-fixed"><div className="kpi-label">Low Total Gen</div><div className="kpi-value">{kpis.lowTotal ? <>{fmtLoad(kpis.lowTotal.value)}<span className="kpi-unit">MW</span></> : '—'}</div>{kpis.lowTotal && <div className="kpi-sub">{kpis.lowTotal.timestamp}</div>}</div>
            <div className="kpi-card-fixed accent"><div className="kpi-label">Top Fuel Source</div><div className="kpi-value" style={{ fontSize: '1.1rem' }}>{kpis.topFuel || '—'}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Top Fuel Share</div><div className="kpi-value">{kpis.topFuelShare != null ? <>{kpis.topFuelShare.toFixed(1)}<span className="kpi-unit">%</span></> : '—'}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Renewable Share</div><div className="kpi-value">{kpis.renewableShare != null ? <>{kpis.renewableShare.toFixed(1)}<span className="kpi-unit">%</span></> : '—'}</div></div>
            <div className="kpi-card-fixed"><div className="kpi-label">Fuel Types Active</div><div className="kpi-value">{kpis.fuelTypesActive || '—'}</div></div>
          </div>
        )}
      </div>

      <DraggableGrid id="generation" defaultLayout={DEFAULT_LAYOUT} rowHeight={60}>

        <div key="chart">
          <Widget draggable
            title={viewMode === 'fuel' ? 'Generation by Fuel Type' : viewMode === 'stacked' ? 'Fuel Mix Stacked View' : 'Total Generation'}
            subtitle={`${resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'} · ${selectedFuels.length}/${allFuels.length} fuels`}
            badge={`${viewMode === 'total' ? totalChartData.length : fuelChartData.length} pts`}
            actions={
              <div className="widget-tabs">
                {(['fuel', 'stacked', 'total'] as ViewMode[]).map(m => (
                  <button key={m} className={`widget-tab${viewMode === m ? ' active' : ''}`} onClick={() => setViewMode(m)}>
                    {m === 'fuel' ? 'By Fuel' : m === 'stacked' ? 'Stacked' : 'Total'}
                  </button>
                ))}
              </div>
            }
            controls={
              <ChartControls
                seriesLabel="Fuel Types" series={allFuels} selectedSeries={selectedFuels} onSeriesChange={setSelectedFuels}
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
              <PriceChart
                data={viewMode === 'total' ? totalChartData : fuelChartData}
                xKey="Date"
                yKeys={viewMode === 'total' ? ['Total'] : selectedFuels}
                chartType={viewMode === 'stacked' ? 'area' : chartType}
                valuePrefix="" valueSuffix=" MW"
              />
            )}
          </Widget>
        </div>

        <div key="oic">
          <Widget draggable title="Operating In Commitment (OIC) Analytics" subtitle="Generator commitment data">
            <OICCommitmentContent />
          </Widget>
        </div>

        <div key="raw">
          <Widget draggable title={`All Generation Datasets (${DATASETS.length})`} noPad>
            {DATASETS.map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution="raw" defaultExpanded={i === 0} />
            ))}
          </Widget>
        </div>

      </DraggableGrid>
    </div>
  );
}
