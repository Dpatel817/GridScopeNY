import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import ChartControls from '../components/ChartControls';
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

function OICCommitmentSection() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<OicResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const fetchOic = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/oic?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchOic(); }, [fetchOic]);

  return (
    <div className="section-container" style={{ marginTop: 24 }}>
      <div className="chart-card-header" style={{ padding: '16px 0 8px' }}>
        <div>
          <div className="chart-card-title" style={{ fontSize: 16, fontWeight: 700 }}>
            Operating In Commitment (OIC)
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>
            Generator commitment data — units called on for reliability or economic purposes
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <input
          type="date"
          className="pcc-date"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <button className="pcc-btn active" onClick={fetchOic}>Refresh</button>
        {!loading && data && data.status === 'ok' && (
          <span className="badge badge-primary">{data.row_count} commitments</span>
        )}
      </div>
      {loading && <div className="loading"><div className="spinner" /> Loading OIC data...</div>}
      {!loading && data && data.status === 'error' && (
        <div className="insight-card" style={{ borderLeftColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>OIC Fetch Error</div>
          <div className="insight-body">{data.message || 'Failed to load OIC data.'}</div>
        </div>
      )}
      {!loading && data && data.status === 'no_data' && (
        <div className="insight-card">
          <div className="insight-body">No OIC data available for {date}.</div>
        </div>
      )}
      {!loading && data && data.status === 'ok' && data.data.length > 0 && (
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            className="chart-card-header"
            style={{ padding: '12px 20px', cursor: 'pointer' }}
            onClick={() => setExpanded(!expanded)}
          >
            <div className="chart-card-title">
              <span className="chevron">{expanded ? '▾' : '▸'}</span>{' '}
              OIC Data — {data.date}
            </div>
          </div>
          {expanded && (
            <div style={{ overflowX: 'auto' }}>
              <table className="rank-table" style={{ borderSpacing: 0, fontSize: 12 }}>
                <thead>
                  <tr>
                    {data.columns.map(col => (
                      <th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, i) => (
                    <tr key={i}>
                      {data.columns.map(col => (
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
      {!loading && data && data.status === 'ok' && data.data.length === 0 && (
        <div className="insight-card">
          <div className="insight-body">No OIC commitments found for {date}.</div>
        </div>
      )}
    </div>
  );
}

type ViewMode = 'fuel' | 'stacked' | 'total';

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

  const { data: fuelData, loading, error } = useDataset('rtfuelmix', 'hourly', undefined, undefined, 50000, 90);

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
    () => computeGenerationKPIs(latestRows, breakdown),
    [latestRows, breakdown]
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
