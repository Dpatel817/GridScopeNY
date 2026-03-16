import { useState, useMemo, useEffect } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import PriceChartControls from '../components/PriceChartControls';
import ScarcitySignalSection from '../components/ScarcitySignalSection';
import { filterNyisoZones } from '../data/zones';
import type { PriceRow, Resolution, DateRange, ChartType, LmpField } from '../data/priceTransforms';
import {
  filterByDateRange, filterNyisoOnly, pivotByZone,
  computeDartSpread, getAvailableDates, isOnPeak,
} from '../data/priceTransforms';
import type { PriceKPIs } from '../data/priceMetrics';
import { computePriceKPIs } from '../data/priceMetrics';
import { buildSummaryContext, deterministicSummary, fetchAISummary } from '../data/priceSummary';

const RAW_DATASETS = [
  'da_lbmp_zone', 'rt_lbmp_zone', 'integrated_rt_lbmp_zone',
  'da_lbmp_gen', 'rt_lbmp_gen', 'integrated_rt_lbmp_gen',
  'reference_bus_lbmp', 'ext_rto_cts_price', 'damasp', 'rtasp',
];

const LIVE_REFRESH_MS = 30 * 1000;

type ViewMode = 'da' | 'rt' | 'dart';

export default function Prices() {
  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('da');
  const [lmpField, setLmpField] = useState<LmpField>('LMP');
  const [showRaw, setShowRaw] = useState(false);

  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiRequestedRef = useState(() => ({ current: false }))[0];

  const { data: daData, loading: daLoading } = useDataset('da_lbmp_zone', 'hourly', undefined, undefined, 50000, 0, 0, { refreshMs: LIVE_REFRESH_MS, loadAllPages: true });
  const { data: rtData, loading: rtLoading } = useDataset('rt_lbmp_zone', 'hourly', undefined, undefined, 50000, 0, 0, { refreshMs: LIVE_REFRESH_MS, loadAllPages: true });

  const loading = daLoading || rtLoading;

  const daRows: PriceRow[] = useMemo(() => (daData?.data || []) as PriceRow[], [daData]);
  const rtRows: PriceRow[] = useMemo(() => (rtData?.data || []) as PriceRow[], [rtData]);

  const allZones = useMemo(() => {
    const raw = [...new Set(daRows.map(r => String(r.Zone)))].sort();
    return filterNyisoZones(raw);
  }, [daRows]);

  const availableDates = useMemo(() => getAvailableDates(filterNyisoOnly(daRows)), [daRows]);

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
    if (allZones.length > 0 && selectedZones.length === 0) {
      setSelectedZones([...allZones]);
    }
  }, [allZones]);

  const latestDate = useMemo(() => {
    const dates = getAvailableDates(filterNyisoOnly(daRows));
    return dates.length ? dates[dates.length - 1] : null;
  }, [daRows]);

  const latestRTDate = useMemo(() => {
    const filtered = filterNyisoOnly(rtRows);
    const dates = getAvailableDates(filtered);
    for (let i = dates.length - 1; i >= 0; i--) {
      if (filtered.some(r => r.Date === dates[i] && isOnPeak(r.HE))) return dates[i];
    }
    return dates.length ? dates[dates.length - 1] : null;
  }, [rtRows]);

  const commonKpiDate = useMemo(() => {
    if (!latestRTDate || !latestDate) return latestDate ?? latestRTDate;
    const daFiltered = filterNyisoOnly(daRows);
    const rtFiltered = filterNyisoOnly(rtRows);
    const daDates = new Set(getAvailableDates(daFiltered));
    const rtDates = getAvailableDates(rtFiltered);
    for (let i = rtDates.length - 1; i >= 0; i--) {
      if (daDates.has(rtDates[i]) && rtFiltered.some(r => r.Date === rtDates[i] && isOnPeak(r.HE))) {
        return rtDates[i];
      }
    }
    if (daDates.has(latestRTDate)) return latestRTDate;
    return latestDate;
  }, [daRows, rtRows, latestDate, latestRTDate]);

  const kpis: PriceKPIs = useMemo(() => {
    const kpiDate = commonKpiDate;
    const daLatest = kpiDate ? daRows.filter(r => r.Date === kpiDate) : daRows;
    const rtLatest = kpiDate ? rtRows.filter(r => r.Date === kpiDate) : rtRows;
    return computePriceKPIs(daLatest, rtLatest);
  }, [daRows, rtRows, commonKpiDate]);

  const fallbackSummary = useMemo(() => deterministicSummary(kpis), [kpis]);

  useEffect(() => {
    if (!kpis.onPeakAvgDA || aiRequestedRef.current) return;
    aiRequestedRef.current = true;
    setAiLoading(true);
    const ctx = buildSummaryContext(kpis, 'Latest day');
    fetchAISummary(ctx).then(result => {
      setAiSummary(result);
      setAiLoading(false);
    });
  }, [kpis.onPeakAvgDA]);

  const daFiltered = useMemo(
    () => filterByDateRange(filterNyisoOnly(daRows), dateRange, startDate, endDate),
    [daRows, dateRange, startDate, endDate]
  );
  const rtFiltered = useMemo(
    () => {
      if (dateRange === 'today' && commonKpiDate) {
        return filterNyisoOnly(rtRows).filter(r => r.Date === commonKpiDate);
      }
      return filterByDateRange(filterNyisoOnly(rtRows), dateRange, startDate, endDate);
    },
    [rtRows, dateRange, startDate, endDate, commonKpiDate]
  );

  const daChartData = useMemo(
    () => pivotByZone(daFiltered, selectedZones, resolution, lmpField),
    [daFiltered, selectedZones, resolution, lmpField]
  );

  const rtChartData = useMemo(
    () => pivotByZone(rtFiltered, selectedZones, resolution, lmpField),
    [rtFiltered, selectedZones, resolution, lmpField]
  );

  const dartChartData = useMemo(
    () => {
      if (dateRange === 'today' && commonKpiDate) {
        const daForDart = filterNyisoOnly(daRows).filter(r => r.Date === commonKpiDate);
        const rtForDart = filterNyisoOnly(rtRows).filter(r => r.Date === commonKpiDate);
        return computeDartSpread(daForDart, rtForDart, selectedZones, resolution, 'all', undefined, undefined, lmpField);
      }
      return computeDartSpread(daFiltered, rtFiltered, selectedZones, resolution, 'all', undefined, undefined, lmpField);
    },
    [daFiltered, rtFiltered, daRows, rtRows, selectedZones, resolution, dateRange, commonKpiDate, lmpField]
  );

  const displaySummary = aiSummary || fallbackSummary;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Price Intelligence</h1>
        <p className="page-subtitle">
          Day-Ahead and Real-Time LBMPs, DA-RT spreads, and ancillary services
        </p>
      </div>

      <div className="price-summary-box">
        <div className="price-summary-header">
          <span className="price-summary-icon"></span>
          <span className="price-summary-title">Market Price Summary</span>
          {aiLoading && <span className="price-summary-badge loading">Generating AI summary...</span>}
          {!aiLoading && aiSummary && <span className="price-summary-badge ai">AI Enhanced</span>}
          {!aiLoading && !aiSummary && <span className="price-summary-badge">Deterministic</span>}
        </div>
        <div className="price-summary-body">{displaySummary}</div>
      </div>

      {!loading && (
        <div className="kpi-grid price-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Avg DA</div>
            <div className="kpi-value">
              {kpis.onPeakAvgDA != null ? <>${kpis.onPeakAvgDA.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Avg RT</div>
            <div className="kpi-value">
              {kpis.onPeakAvgRT != null ? <>${kpis.onPeakAvgRT.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak DA LMP</div>
            <div className="kpi-value">
              {kpis.peakDA ? <>${kpis.peakDA.value.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
            </div>
            {kpis.peakDA && <div className="kpi-sub">{kpis.peakDA.timestamp} · {kpis.peakDA.zone}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak RT LMP</div>
            <div className="kpi-value">
              {kpis.peakRT ? <>${kpis.peakRT.value.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
            </div>
            {kpis.peakRT && <div className="kpi-sub">{kpis.peakRT.timestamp} · {kpis.peakRT.zone}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Low DA LMP</div>
            <div className="kpi-value">
              {kpis.lowDA ? <>${kpis.lowDA.value.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
            </div>
            {kpis.lowDA && <div className="kpi-sub">{kpis.lowDA.timestamp} · {kpis.lowDA.zone}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Low RT LMP</div>
            <div className="kpi-value">
              {kpis.lowRT ? <>${kpis.lowRT.value.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
            </div>
            {kpis.lowRT && <div className="kpi-sub">{kpis.lowRT.timestamp} · {kpis.lowRT.zone}</div>}
          </div>
          <div className="kpi-card accent">
            <div className="kpi-label">Top DART Zone</div>
            <div className="kpi-value">{kpis.topDartZone?.zone ?? '—'}</div>
            {kpis.topDartZone && (
              <div className="kpi-sub">
                ${kpis.topDartZone.avgSpread.toFixed(2)} avg · ${kpis.topDartZone.maxSpread.toFixed(2)} max
              </div>
            )}
          </div>
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> Loading price data...</div>}

      {!loading && (
        <div className="price-chart-layout">
          <PriceChartControls
            zones={allZones}
            selectedZones={selectedZones}
            onZonesChange={setSelectedZones}
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
                className={`pcc-btn${viewMode === 'da' ? ' active' : ''}`}
                onClick={() => setViewMode('da')}
              >
                Day-Ahead LMPs
              </button>
              <button
                className={`pcc-btn${viewMode === 'rt' ? ' active' : ''}`}
                onClick={() => setViewMode('rt')}
              >
                Real-Time LMPs
              </button>
              <button
                className={`pcc-btn${viewMode === 'dart' ? ' active' : ''}`}
                onClick={() => setViewMode('dart')}
              >
                DART Spread
              </button>
              <span className="price-view-info">
                {resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'}
                {' · '}{selectedZones.length}/{allZones.length} zones
                {' · '}{dateRange === 'today' ? 'Latest Day' : dateRange === 'all' ? 'All Dates' : `${startDate} — ${endDate}`}
              </span>
            </div>

            {(viewMode === 'da' || viewMode === 'rt' || viewMode === 'dart') && (
              <div className="lmp-component-selector">
                {(['LMP', 'MLC', 'MCC'] as LmpField[]).map(f => (
                  <button
                    key={f}
                    className={`pcc-btn${lmpField === f ? ' active' : ''}`}
                    onClick={() => setLmpField(f)}
                  >
                    {f === 'LMP' ? 'Total LMP' : f === 'MLC' ? 'Losses (MLC)' : 'Congestion (MCC)'}
                  </button>
                ))}
              </div>
            )}

            {viewMode === 'da' && (
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">
                    Day-Ahead Zonal {lmpField === 'LMP' ? 'LBMPs' : lmpField === 'MLC' ? 'Marginal Losses' : 'Marginal Congestion'}
                  </div>
                  <span className="badge badge-primary">{daChartData.length} points</span>
                </div>
                <PriceChart
                  data={daChartData}
                  xKey="Date"
                  yKeys={selectedZones}
                  chartType={chartType}
                  height={380}
                />
              </div>
            )}

            {viewMode === 'rt' && (
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">
                    Real-Time Zonal {lmpField === 'LMP' ? 'LBMPs' : lmpField === 'MLC' ? 'Marginal Losses' : 'Marginal Congestion'}
                  </div>
                  <span className="badge badge-primary">{rtChartData.length} points</span>
                </div>
                <PriceChart
                  data={rtChartData}
                  xKey="Date"
                  yKeys={selectedZones}
                  chartType={chartType}
                  height={380}
                />
              </div>
            )}

            {viewMode === 'dart' && (
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">DA-RT {lmpField === 'LMP' ? 'LMP' : lmpField === 'MLC' ? 'Losses (MLC)' : 'Congestion (MCC)'} Spread (DA minus RT)</div>
                  <span className="badge badge-primary">{dartChartData.length} points</span>
                </div>
                <PriceChart
                  data={dartChartData}
                  xKey="Date"
                  yKeys={selectedZones}
                  chartType={chartType}
                  height={380}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <ScarcitySignalSection />

      <div className="section-container">
        <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
          <span className="chevron">{showRaw ? '▾' : '▸'}</span>
          All Price Datasets ({RAW_DATASETS.length})
        </div>
        {showRaw && (
          <div style={{ marginTop: 8 }}>
            {RAW_DATASETS.map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution="hourly" defaultExpanded={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
