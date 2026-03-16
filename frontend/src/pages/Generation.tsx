import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import ChartControls from '../components/ChartControls';
import BarChart from '../components/BarChart';
import StackedBarChart from '../components/StackedBarChart';
import type { ChartType, Resolution, DateRange } from '../data/priceTransforms';
import type { GenRow, FuelBreakdown } from '../data/generationTransforms';

const GeneratorMap = lazy(() => import('./GeneratorMap'));

function GeneratorMapSection() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="section-container" style={{ marginTop: 24 }}>
      <div
        className="collapsible-header"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        Generator Price Map
      </div>
      {expanded && (
        <Suspense fallback={<div className="loading"><div className="spinner" /> Loading map...</div>}>
          <GeneratorMap embedded />
        </Suspense>
      )}
    </div>
  );
}
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
  status: string;
  date: string;
  data: Record<string, any>[];
  columns: string[];
  row_count: number;
  message?: string;
}

interface OicRangeResponse {
  status: string;
  start_date: string;
  end_date: string;
  total_commitments: number;
  active_zones: number;
  top_zone: string | null;
  by_zone: Record<string, number>;
  by_zone_type: Record<string, Record<string, number>>;
  all_types: string[];
  mw_by_zone: Record<string, number>;
  has_mw: boolean;
  data: Record<string, any>[];
  columns: string[];
  row_count: number;
  message?: string;
}

type OicChartView = 'byZone' | 'byType' | 'byMW';

function OICCommitmentSection() {
  const today = new Date().toISOString().slice(0, 10);
  const [tableDate, setTableDate] = useState(today);
  const [tableData, setTableData] = useState<OicResponse | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
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
    } catch {
      setTableData(null);
    } finally {
      setTableLoading(false);
    }
  }, [tableDate]);

  const fetchRange = useCallback(async () => {
    setRangeLoading(true);
    try {
      const res = await fetch(`/api/oic-range?start_date=${startDate}&end_date=${endDate}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRangeData(await res.json());
    } catch {
      setRangeData(null);
    } finally {
      setRangeLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { fetchTable(); }, [fetchTable]);
  useEffect(() => { fetchRange(); }, [fetchRange]);

  const zoneBarData = useMemo(() => {
    if (!rangeData || rangeData.status !== 'ok') return [];
    return Object.entries(rangeData.by_zone)
      .map(([zone, count]) => ({ zone, count }))
      .sort((a, b) => b.count - a.count);
  }, [rangeData]);

  const stackedData = useMemo(() => {
    if (!rangeData || rangeData.status !== 'ok' || !rangeData.all_types.length) return { data: [] as Record<string, unknown>[], keys: [] as string[] };
    const types = rangeData.all_types;
    const data = Object.entries(rangeData.by_zone_type).map(([zone, typeCounts]) => {
      const row: Record<string, unknown> = { zone };
      for (const t of types) {
        row[t] = typeCounts[t] || 0;
      }
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
    return Object.entries(rangeData.mw_by_zone)
      .map(([zone, mw]) => ({ zone, mw }))
      .sort((a, b) => b.mw - a.mw);
  }, [rangeData]);

  return (
    <div className="section-container" style={{ marginTop: 24 }}>
      <div className="chart-card-header" style={{ padding: '16px 0 8px' }}>
        <div>
          <div className="chart-card-title" style={{ fontSize: 16, fontWeight: 700 }}>
            Operating In Commitment (OIC) Analytics
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>
            Generator commitment data — units called on for reliability or economic purposes
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Date Range:</label>
        <input type="date" className="pcc-date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
        <input type="date" className="pcc-date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <button className="pcc-btn active" onClick={fetchRange}>Analyze</button>
        {rangeLoading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading...</span>}
      </div>

      {rangeLoading && <div className="loading"><div className="spinner" /> Loading OIC range data...</div>}

      {!rangeLoading && !rangeData && (
        <div className="insight-card" style={{ borderLeftColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Connection Error</div>
          <div className="insight-body">Failed to connect to the OIC range API. Please try again.</div>
        </div>
      )}

      {!rangeLoading && rangeData && rangeData.status === 'error' && (
        <div className="insight-card" style={{ borderLeftColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Error</div>
          <div className="insight-body">{rangeData.message || 'Failed to load OIC range data.'}</div>
        </div>
      )}

      {!rangeLoading && rangeData && rangeData.status === 'no_data' && (
        <div className="insight-card">
          <div className="insight-body">No OIC data available for {startDate} — {endDate}.</div>
        </div>
      )}

      {!rangeLoading && rangeData && rangeData.status === 'ok' && (
        <>
          <div className="kpi-grid price-kpi-grid" style={{ marginBottom: 16 }}>
            <div className="kpi-card">
              <div className="kpi-label">Total Commitments</div>
              <div className="kpi-value">{rangeData.total_commitments.toLocaleString()}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Active Zones</div>
              <div className="kpi-value">{rangeData.active_zones}</div>
            </div>
            <div className="kpi-card accent">
              <div className="kpi-label">Top Zone</div>
              <div className="kpi-value" style={{ fontSize: '1rem' }}>{rangeData.top_zone || '—'}</div>
            </div>
            {rangeData.has_mw && mwBarData.length > 0 && (
              <div className="kpi-card">
                <div className="kpi-label">Total MW Committed</div>
                <div className="kpi-value">
                  {Math.round(mwBarData.reduce((s, d) => s + d.mw, 0)).toLocaleString()}
                  <span className="kpi-unit">MW</span>
                </div>
              </div>
            )}
          </div>

          <div className="price-view-tabs" style={{ marginBottom: 12 }}>
            <button className={`pcc-btn${chartView === 'byZone' ? ' active' : ''}`} onClick={() => setChartView('byZone')}>
              Commitments by Zone
            </button>
            <button className={`pcc-btn${chartView === 'byType' ? ' active' : ''}`} onClick={() => setChartView('byType')}>
              By Type per Zone
            </button>
            <button className={`pcc-btn${chartView === 'byMW' ? ' active' : ''}`} onClick={() => setChartView('byMW')}>
              MW by Zone
            </button>
          </div>

          {chartView === 'byZone' && (
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Commitment Count by Zone</div>
                <span className="badge badge-primary">{zoneBarData.length} zones</span>
              </div>
              <BarChart
                data={zoneBarData}
                xKey="zone"
                yKey="count"
                height={Math.max(300, zoneBarData.length * 36)}
                layout="horizontal"
                showLabels
                labelPrefix=""
                color="#2563eb"
              />
            </div>
          )}

          {chartView === 'byType' && (
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Commitment Type by Zone</div>
                <span className="badge badge-primary">{stackedData.keys.length} types</span>
              </div>
              {stackedData.data.length > 0 ? (
                <StackedBarChart
                  data={stackedData.data}
                  xKey="zone"
                  yKeys={stackedData.keys}
                  height={Math.max(320, stackedData.data.length * 30)}
                />
              ) : (
                <div className="empty-state" style={{ padding: 24 }}>No commitment type data available</div>
              )}
            </div>
          )}

          {chartView === 'byMW' && (
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Total MW by Zone</div>
                <span className="badge badge-primary">{mwBarData.length} zones</span>
              </div>
              {rangeData.has_mw && mwBarData.length > 0 ? (
                <BarChart
                  data={mwBarData}
                  xKey="zone"
                  yKey="mw"
                  height={Math.max(300, mwBarData.length * 36)}
                  layout="horizontal"
                  showLabels
                  labelPrefix=""
                  color="#10b981"
                />
              ) : (
                <>
                  <div style={{ padding: '8px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
                    MW data not available — showing commitment counts by zone instead
                  </div>
                  <BarChart
                    data={zoneBarData}
                    xKey="zone"
                    yKey="count"
                    height={Math.max(300, zoneBarData.length * 36)}
                    layout="horizontal"
                    showLabels
                    labelPrefix=""
                    color="#10b981"
                  />
                </>
              )}
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Single Date Table:</label>
          <input type="date" className="pcc-date" value={tableDate} onChange={e => setTableDate(e.target.value)} />
          <button className="pcc-btn active" onClick={fetchTable}>Refresh</button>
          {!tableLoading && tableData && tableData.status === 'ok' && (
            <span className="badge badge-primary">{tableData.row_count} commitments</span>
          )}
        </div>
        {tableLoading && <div className="loading"><div className="spinner" /> Loading OIC data...</div>}
        {!tableLoading && tableData && tableData.status === 'error' && (
          <div className="insight-card" style={{ borderLeftColor: 'var(--danger)' }}>
            <div className="insight-title" style={{ color: 'var(--danger)' }}>OIC Fetch Error</div>
            <div className="insight-body">{tableData.message || 'Failed to load OIC data.'}</div>
          </div>
        )}
        {!tableLoading && tableData && tableData.status === 'no_data' && (
          <div className="insight-card">
            <div className="insight-body">No OIC data available for {tableDate}.</div>
          </div>
        )}
        {!tableLoading && tableData && tableData.status === 'ok' && tableData.data.length > 0 && (
          <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              className="chart-card-header"
              style={{ padding: '12px 20px', cursor: 'pointer' }}
              onClick={() => setTableExpanded(!tableExpanded)}
            >
              <div className="chart-card-title">
                <span className="chevron">{tableExpanded ? '▾' : '▸'}</span>{' '}
                OIC Data — {tableData.date}
              </div>
            </div>
            {tableExpanded && (
              <div style={{ overflowX: 'auto' }}>
                <table className="rank-table" style={{ borderSpacing: 0, fontSize: 12 }}>
                  <thead>
                    <tr>
                      {tableData.columns.map(col => (
                        <th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.data.map((row, i) => (
                      <tr key={i}>
                        {tableData.columns.map(col => (
                          <td key={col} style={{ whiteSpace: 'nowrap' }}>{row[col] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {!tableLoading && tableData && tableData.status === 'ok' && tableData.data.length === 0 && (
          <div className="insight-card">
            <div className="insight-body">No OIC commitments found for {tableDate}.</div>
          </div>
        )}
      </div>
    </div>
  );
}

type ViewMode = 'fuel' | 'stacked' | 'total';
const LIVE_REFRESH_MS = 30 * 1000;

export default function Generation() {
  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedFuels, setSelectedFuels] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('fuel');
  const [showRaw, setShowRaw] = useState(false);

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
      const end = availableDates[availableDates.length - 1];
      const startIdx = Math.max(0, availableDates.length - 7);
      const start = availableDates[startIdx];
      setStartDate(start);
      setEndDate(end);
    }
  };

  useEffect(() => {
    if (allFuels.length > 0 && selectedFuels.length === 0) {
      setSelectedFuels([...allFuels]);
    }
  }, [allFuels]);

  const latestDate = useMemo(() => {
    const dates = getAvailableDates(rows);
    return dates.length ? dates[dates.length - 1] : null;
  }, [rows]);

  const latestRows = useMemo(() => {
    if (!latestDate) return rows;
    return rows.filter((r: any) => r.Date === latestDate);
  }, [rows, latestDate]);

  const breakdown: FuelBreakdown[] = useMemo(
    () => computeFuelBreakdown(latestRows, fuelCol, genCol),
    [latestRows, fuelCol, genCol]
  );

  const kpis: GenerationKPIs = useMemo(
    () => computeGenerationKPIs(latestRows, breakdown, rows),
    [latestRows, breakdown, rows]
  );

  const fallbackSummary = useMemo(
    () => deterministicGenerationSummary(kpis, breakdown),
    [kpis, breakdown]
  );

  useEffect(() => {
    if (aiRequestedRef.current) return;
    if (loading || !rows.length) return;
    aiRequestedRef.current = true;
    setAiLoading(true);
    const ctx = buildGenerationSummaryContext(kpis, breakdown, 'Latest available data');
    fetchAIGenerationSummary(ctx).then(s => {
      if (s) setAiSummary(s);
    }).finally(() => setAiLoading(false));
  }, [loading, rows.length, kpis, breakdown]);

  const filtered = useMemo(
    () => filterByDateRange(rows, dateRange, startDate, endDate),
    [rows, dateRange, startDate, endDate]
  );

  const fuelChartData = useMemo(
    () => pivotByFuel(filtered, selectedFuels, fuelCol, genCol, resolution),
    [filtered, selectedFuels, fuelCol, genCol, resolution]
  );

  const totalChartData = useMemo(() => {
    return fuelChartData.map(row => {
      let total = 0;
      for (const key of Object.keys(row)) {
        if (key === 'Date') continue;
        const v = Number(row[key]);
        if (!isNaN(v)) total += v;
      }
      return { Date: row.Date, Total: Math.round(total) };
    });
  }, [fuelChartData]);

  const displaySummary = aiSummary || fallbackSummary;
  const fmtLoad = (v: number) => Math.round(v).toLocaleString();

  return (
    <div className="page">
      <div className="page-header">
        <h1>Generation Mix</h1>
        <p className="page-subtitle">
          Real-time fuel mix, committed capacity, BTM solar, and generation maintenance
        </p>
      </div>

      <div className="price-summary-box">
        <div className="price-summary-header">
          <span className="price-summary-icon"></span>
          <span className="price-summary-title">Generation Summary</span>
          {aiLoading && <span className="price-summary-badge loading">Generating AI summary...</span>}
          {!aiLoading && aiSummary && <span className="price-summary-badge ai">AI Enhanced</span>}
          {!aiLoading && !aiSummary && <span className="price-summary-badge">Deterministic</span>}
        </div>
        <div className="price-summary-body">{displaySummary}</div>
      </div>

      {error && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load generation data: {error}</div>
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> Loading generation data...</div>}

      {!loading && (
        <div className="kpi-grid price-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Avg Total Gen</div>
            <div className="kpi-value">
              {kpis.onPeakAvgTotal != null ? <>{fmtLoad(kpis.onPeakAvgTotal)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak Total Gen</div>
            <div className="kpi-value">
              {kpis.peakTotal ? <>{fmtLoad(kpis.peakTotal.value)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.peakTotal && <div className="kpi-sub">{kpis.peakTotal.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Low Total Gen</div>
            <div className="kpi-value">
              {kpis.lowTotal ? <>{fmtLoad(kpis.lowTotal.value)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.lowTotal && <div className="kpi-sub">{kpis.lowTotal.timestamp}</div>}
          </div>
          <div className="kpi-card accent">
            <div className="kpi-label">Top Fuel Source</div>
            <div className="kpi-value" style={{ fontSize: '1.1rem' }}>{kpis.topFuel || '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Top Fuel Share</div>
            <div className="kpi-value">
              {kpis.topFuelShare != null ? <>{kpis.topFuelShare.toFixed(1)}<span className="kpi-unit">%</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Second Fuel</div>
            <div className="kpi-value" style={{ fontSize: '1.1rem' }}>{kpis.secondFuel || '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Renewable Share</div>
            <div className="kpi-value">
              {kpis.renewableShare != null ? <>{kpis.renewableShare.toFixed(1)}<span className="kpi-unit">%</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Fuel Types Active</div>
            <div className="kpi-value">{kpis.fuelTypesActive || '—'}</div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="price-chart-layout">
          <ChartControls
            seriesLabel="Fuel Types"
            series={allFuels}
            selectedSeries={selectedFuels}
            onSeriesChange={setSelectedFuels}
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
          <div className="price-chart-main">
            <div className="price-view-tabs">
              <button
                className={`pcc-btn${viewMode === 'fuel' ? ' active' : ''}`}
                onClick={() => setViewMode('fuel')}
              >
                By Fuel Type
              </button>
              <button
                className={`pcc-btn${viewMode === 'stacked' ? ' active' : ''}`}
                onClick={() => setViewMode('stacked')}
              >
                Fuel Mix Stack
              </button>
              <button
                className={`pcc-btn${viewMode === 'total' ? ' active' : ''}`}
                onClick={() => setViewMode('total')}
              >
                Total Generation
              </button>
              <span className="price-view-info">
                {resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'}
                {' · '}{selectedFuels.length}/{allFuels.length} fuels
                {' · '}{dateRange === 'today' ? 'Latest Day' : dateRange === 'all' ? 'All Dates' : `${startDate} — ${endDate}`}
              </span>
            </div>

            {viewMode === 'fuel' && (
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">Generation by Fuel Type</div>
                  <span className="badge badge-primary">{fuelChartData.length} points</span>
                </div>
                <PriceChart
                  data={fuelChartData}
                  xKey="Date"
                  yKeys={selectedFuels}
                  chartType={chartType}
                  height={380}
                  valuePrefix=""
                  valueSuffix=" MW"
                />
              </div>
            )}

            {viewMode === 'stacked' && (
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">Fuel Mix Stacked View</div>
                  <span className="badge badge-primary">{fuelChartData.length} points</span>
                </div>
                <PriceChart
                  data={fuelChartData}
                  xKey="Date"
                  yKeys={selectedFuels}
                  chartType="area"
                  height={380}
                  valuePrefix=""
                  valueSuffix=" MW"
                />
              </div>
            )}

            {viewMode === 'total' && (
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">Total Generation (All Selected Fuels)</div>
                  <span className="badge badge-primary">{totalChartData.length} points</span>
                </div>
                <PriceChart
                  data={totalChartData}
                  xKey="Date"
                  yKeys={['Total']}
                  chartType={chartType}
                  height={380}
                  valuePrefix=""
                  valueSuffix=" MW"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && breakdown.length > 0 && (
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <div className="chart-card-title">Fuel Mix Breakdown ({breakdown.length} types)</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rank-table" style={{ borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th>Fuel Type</th>
                  <th>Avg Generation</th>
                  <th>Peak Generation</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map(f => (
                  <tr key={f.name}>
                    <td style={{ fontWeight: 600 }}>{f.name}</td>
                    <td>{Math.round(f.avg).toLocaleString()} MW</td>
                    <td style={{ fontWeight: 600 }}>{Math.round(f.max).toLocaleString()} MW</td>
                    <td>{f.share.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OICCommitmentSection />

      <GeneratorMapSection />

      <div className="section-container">
        <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
          <span className="chevron">{showRaw ? '▾' : '▸'}</span>
          All Generation Datasets ({DATASETS.length})
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
