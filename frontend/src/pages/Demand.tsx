import { useState, useMemo, useEffect } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import ChartControls from '../components/ChartControls';
import Widget from '../components/Widget';
import WidgetGrid from '../components/WidgetGrid';
import type { ChartType, Resolution, DateRange } from '../data/priceTransforms';
import type { DemandRow, AlignedRow } from '../data/demandTransforms';
import {
  extractZones, getAvailableDates, filterByDateRange,
  pivotZonalDemand, alignForecastActual,
  pivotForecastActual, pivotForecastError, isOnPeak,
} from '../data/demandTransforms';
import { computeDemandKPIs } from '../data/demandMetrics';
import type { DemandKPIs } from '../data/demandMetrics';
import {
  buildDemandSummaryContext, deterministicDemandSummary, fetchAIDemandSummary,
} from '../data/demandSummary';

const RAW_DATASETS = ['isolf', 'pal', 'pal_integrated', 'lfweather'];
const LIVE_REFRESH_MS = 30 * 1000;

type ViewMode = 'zonal' | 'fva' | 'error';

export default function Demand() {
  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('zonal');
  const [showRaw, setShowRaw] = useState(false);

  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiRequestedRef = useState(() => ({ current: false }))[0];

  const { data: forecastData, loading: fLoading, error: fError } = useDataset('isolf', 'hourly', undefined, undefined, 20000, 0, 0, { refreshMs: LIVE_REFRESH_MS, loadAllPages: true });
  const { data: actualData, loading: aLoading, error: aError } = useDataset('pal', 'hourly', undefined, undefined, 50000, 0, 0, { refreshMs: LIVE_REFRESH_MS, loadAllPages: true });

  const loading = fLoading || aLoading;

  const forecastRows: DemandRow[] = useMemo(
    () => (forecastData?.data || []) as DemandRow[],
    [forecastData]
  );
  const actualRows: DemandRow[] = useMemo(
    () => (actualData?.data || []) as DemandRow[],
    [actualData]
  );

  const allZones = useMemo(() => extractZones(forecastRows), [forecastRows]);
  const availableDates = useMemo(() => getAvailableDates(forecastRows), [forecastRows]);

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
    if (dateRange === 'custom' && (!startDate || !endDate) && availableDates.length > 0) {
      const end = availableDates[availableDates.length - 1];
      const startIdx = Math.max(0, availableDates.length - 7);
      setStartDate(availableDates[startIdx]);
      setEndDate(end);
    }
  }, [dateRange, availableDates]);

  useEffect(() => {
    if (allZones.length > 0 && selectedZones.length === 0) {
      setSelectedZones([...allZones]);
    }
  }, [allZones]);

  const aligned: AlignedRow[] = useMemo(
    () => alignForecastActual(forecastRows, actualRows),
    [forecastRows, actualRows]
  );

  const latestDate = useMemo(() => {
    const actualDates = getAvailableDates(actualRows);
    for (let i = actualDates.length - 1; i >= 0; i--) {
      if (actualRows.some(r => r.Date === actualDates[i] && isOnPeak(Number(r.HE)))) return actualDates[i];
    }
    if (actualDates.length) return actualDates[actualDates.length - 1];
    const dates = getAvailableDates(forecastRows);
    return dates.length ? dates[dates.length - 1] : null;
  }, [forecastRows, actualRows]);

  const kpis: DemandKPIs = useMemo(() => {
    if (!latestDate) return computeDemandKPIs(forecastRows, aligned, forecastRows, aligned);
    const fLatest = forecastRows.filter(r => r.Date === latestDate);
    const aLatest = aligned.filter(r => r.Date === latestDate);
    return computeDemandKPIs(fLatest, aLatest, forecastRows, aligned);
  }, [forecastRows, aligned, latestDate]);

  const fallbackSummary = useMemo(() => deterministicDemandSummary(kpis), [kpis]);

  useEffect(() => {
    if (aiRequestedRef.current) return;
    if (loading || !forecastRows.length) return;
    aiRequestedRef.current = true;
    setAiLoading(true);
    const ctx = buildDemandSummaryContext(kpis, 'Latest available data');
    fetchAIDemandSummary(ctx).then(s => {
      if (s) setAiSummary(s);
    }).finally(() => setAiLoading(false));
  }, [loading, forecastRows.length, kpis]);

  const forecastFiltered = useMemo(
    () => filterByDateRange(forecastRows, dateRange, startDate, endDate),
    [forecastRows, dateRange, startDate, endDate]
  );

  const alignedFiltered = useMemo(() => {
    if (dateRange === 'all') return aligned;
    if (dateRange === 'today') {
      const dates = getAvailableDates(forecastRows);
      const latest = dates[dates.length - 1];
      if (!latest) return aligned;
      return aligned.filter(r => r.Date === latest);
    }
    if (dateRange === 'custom') {
      if (startDate && endDate) {
        return aligned.filter(r => r.Date >= startDate && r.Date <= endDate);
      }
      const dates = [...new Set(aligned.map(r => r.Date))].sort();
      if (dates.length > 0) {
        const end = dates[dates.length - 1];
        const startIdx = Math.max(0, dates.length - 7);
        const start = dates[startIdx];
        return aligned.filter(r => r.Date >= start && r.Date <= end);
      }
    }
    return aligned;
  }, [aligned, dateRange, startDate, endDate, forecastRows]);

  const zonalChartData = useMemo(
    () => pivotZonalDemand(forecastFiltered, selectedZones, resolution),
    [forecastFiltered, selectedZones, resolution]
  );

  const fvaChartData = useMemo(
    () => pivotForecastActual(alignedFiltered, resolution),
    [alignedFiltered, resolution]
  );

  const errorChartData = useMemo(
    () => pivotForecastError(alignedFiltered, resolution),
    [alignedFiltered, resolution]
  );

  const displaySummary = aiSummary || fallbackSummary;

  const fmtLoad = (v: number) => Math.round(v).toLocaleString();

  return (
    <div className="page">
      <div className="page-header">
        <h1>Demand Intelligence</h1>
        <p className="page-subtitle">
          Forecast vs actual load analysis — identify demand surprises and potential market stress
        </p>
      </div>

      <div className="price-summary-box">
        <div className="price-summary-header">
          <span className="price-summary-icon"></span>
          <span className="price-summary-title">Demand Summary</span>
          {aiLoading && <span className="price-summary-badge loading">Generating AI summary...</span>}
          {!aiLoading && aiSummary && <span className="price-summary-badge ai">AI Enhanced</span>}
          {!aiLoading && !aiSummary && <span className="price-summary-badge">Deterministic</span>}
        </div>
        <div className="price-summary-body">{displaySummary}</div>
      </div>

      {(fError || aError) && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load demand data: {fError || aError}</div>
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> Loading demand data...</div>}

      {!loading && (
        <div className="kpi-grid price-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Avg Forecast</div>
            <div className="kpi-value">
              {kpis.onPeakAvgForecast != null ? <>{fmtLoad(kpis.onPeakAvgForecast)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Avg Actual</div>
            <div className="kpi-value">
              {kpis.onPeakAvgActual != null ? <>{fmtLoad(kpis.onPeakAvgActual)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak Forecast</div>
            <div className="kpi-value">
              {kpis.peakForecast ? <>{fmtLoad(kpis.peakForecast.value)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.peakForecast && <div className="kpi-sub">{kpis.peakForecast.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak Actual</div>
            <div className="kpi-value">
              {kpis.peakActual ? <>{fmtLoad(kpis.peakActual.value)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.peakActual && <div className="kpi-sub">{kpis.peakActual.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Low Forecast</div>
            <div className="kpi-value">
              {kpis.lowForecast ? <>{fmtLoad(kpis.lowForecast.value)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.lowForecast && <div className="kpi-sub">{kpis.lowForecast.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Low Actual</div>
            <div className="kpi-value">
              {kpis.lowActual ? <>{fmtLoad(kpis.lowActual.value)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.lowActual && <div className="kpi-sub">{kpis.lowActual.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Avg Forecast Error</div>
            <div className="kpi-value">
              {kpis.avgForecastError != null ? (
                <span style={{ color: Math.abs(kpis.avgForecastError) > 500 ? 'var(--danger)' : 'var(--text)' }}>
                  {kpis.avgForecastError > 0 ? '+' : ''}{fmtLoad(kpis.avgForecastError)}<span className="kpi-unit">MW</span>
                </span>
              ) : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak Abs Error</div>
            <div className="kpi-value">
              {kpis.peakForecastError ? <>{fmtLoad(Math.abs(kpis.peakForecastError.value))}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.peakForecastError && <div className="kpi-sub">{kpis.peakForecastError.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Largest Under-Forecast</div>
            <div className="kpi-value">
              {kpis.largestUnderForecast ? <>{fmtLoad(Math.abs(kpis.largestUnderForecast.value))}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.largestUnderForecast && <div className="kpi-sub">{kpis.largestUnderForecast.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Largest Over-Forecast</div>
            <div className="kpi-value">
              {kpis.largestOverForecast ? <>{fmtLoad(kpis.largestOverForecast.value)}<span className="kpi-unit">MW</span></> : '—'}
            </div>
            {kpis.largestOverForecast && <div className="kpi-sub">{kpis.largestOverForecast.timestamp}</div>}
          </div>
        </div>
      )}

      {!loading && (
        <WidgetGrid>
          <Widget
            size="full"
            title={
              viewMode === 'zonal' ? 'System Load Forecast by Zone'
              : viewMode === 'fva' ? 'Forecast vs Actual (NYISO Total)'
              : 'Forecast Error (Forecast minus Actual)'
            }
            subtitle={`${resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'} · ${selectedZones.length}/${allZones.length} zones · ${dateRange === 'today' ? 'Latest Day' : dateRange === 'all' ? 'All Dates' : `${startDate} — ${endDate}`}`}
            badge={`${viewMode === 'zonal' ? zonalChartData.length : viewMode === 'fva' ? fvaChartData.length : errorChartData.length} points`}
            actions={
              <div className="widget-tabs">
                {(['zonal', 'fva', 'error'] as ViewMode[]).map(m => (
                  <button key={m} className={`widget-tab${viewMode === m ? ' active' : ''}`} onClick={() => setViewMode(m)}>
                    {m === 'zonal' ? 'Zonal Forecast' : m === 'fva' ? 'Forecast vs Actual' : 'Forecast Error'}
                  </button>
                ))}
              </div>
            }
            controls={
              <ChartControls
                seriesLabel="Zones"
                series={allZones}
                selectedSeries={selectedZones}
                onSeriesChange={setSelectedZones}
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
            <PriceChart
              data={viewMode === 'zonal' ? zonalChartData : viewMode === 'fva' ? fvaChartData : errorChartData}
              xKey="Date"
              yKeys={viewMode === 'zonal' ? selectedZones : viewMode === 'fva' ? ['Forecast', 'Actual'] : ['Error']}
              chartType={chartType}
              height={420}
              valuePrefix=""
              valueSuffix=" MW"
            />
          </Widget>
        </WidgetGrid>
      )}

      <div className="section-container">
        <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
          <span className="chevron">{showRaw ? '▾' : '▸'}</span>
          Detailed Data ({RAW_DATASETS.length})
        </div>
        {showRaw && (
          <div style={{ marginTop: 8 }}>
            {RAW_DATASETS.map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution="raw" defaultExpanded={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
