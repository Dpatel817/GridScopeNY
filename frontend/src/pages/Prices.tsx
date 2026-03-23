import { useState, useMemo, useEffect } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import PriceChartControls from '../components/PriceChartControls';
import ScarcitySignalSection from '../components/ScarcitySignalSection';
import Widget from '../components/Widget';
import DraggableGrid from '../components/DraggableGrid';
import type { GridItem } from '../components/DraggableGrid';
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

const DEFAULT_LAYOUT: GridItem[] = [
  { i: 'chart',    x: 0, y: 0,  w: 12, h: 8, minH: 6 },
  { i: 'scarcity', x: 0, y: 8,  w: 12, h: 8, minH: 6 },
  { i: 'raw',      x: 0, y: 16, w: 12, h: 3, minH: 3 },
];

export default function Prices() {
  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('da');
  const [lmpField, setLmpField] = useState<LmpField>('LMP');

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

      {/* Fixed KPI Section */}
      <div className="kpi-section">
        <div className="kpi-section-header">
          <div className="kpi-section-title">Market Price Summary</div>
          <span className="kpi-section-badge">
            {aiLoading ? 'Generating...' : aiSummary ? 'AI Enhanced' : 'Deterministic'}
          </span>
        </div>
        <div className="kpi-summary-text">{displaySummary}</div>
        
        <div className="kpi-section-header" style={{ marginTop: 24 }}>
          <div className="kpi-section-title">Key Price Metrics</div>
          {commonKpiDate && <div className="kpi-section-subtitle">Latest day: {commonKpiDate}</div>}
        </div>
        {loading ? (
          <div className="loading"><div className="spinner" /> Loading price data...</div>
        ) : (
          <div className="kpi-grid-fixed">
            <div className="kpi-card-fixed">
              <div className="kpi-label">On-Peak Avg DA</div>
              <div className="kpi-value">
                {kpis.onPeakAvgDA != null ? <>${kpis.onPeakAvgDA.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
              </div>
            </div>
            <div className="kpi-card-fixed">
              <div className="kpi-label">On-Peak Avg RT</div>
              <div className="kpi-value">
                {kpis.onPeakAvgRT != null ? <>${kpis.onPeakAvgRT.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
              </div>
            </div>
            <div className="kpi-card-fixed">
              <div className="kpi-label">Peak DA LMP</div>
              <div className="kpi-value">
                {kpis.peakDA ? <>${kpis.peakDA.value.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
              </div>
              {kpis.peakDA && <div className="kpi-sub">{kpis.peakDA.timestamp} · {kpis.peakDA.zone}</div>}
            </div>
            <div className="kpi-card-fixed">
              <div className="kpi-label">Peak RT LMP</div>
              <div className="kpi-value">
                {kpis.peakRT ? <>${kpis.peakRT.value.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
              </div>
              {kpis.peakRT && <div className="kpi-sub">{kpis.peakRT.timestamp} · {kpis.peakRT.zone}</div>}
            </div>
            <div className="kpi-card-fixed">
              <div className="kpi-label">Low DA LMP</div>
              <div className="kpi-value">
                {kpis.lowDA ? <>${kpis.lowDA.value.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
              </div>
              {kpis.lowDA && <div className="kpi-sub">{kpis.lowDA.timestamp} · {kpis.lowDA.zone}</div>}
            </div>
            <div className="kpi-card-fixed">
              <div className="kpi-label">Low RT LMP</div>
              <div className="kpi-value">
                {kpis.lowRT ? <>${kpis.lowRT.value.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
              </div>
              {kpis.lowRT && <div className="kpi-sub">{kpis.lowRT.timestamp} · {kpis.lowRT.zone}</div>}
            </div>
            <div className="kpi-card-fixed accent">
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
      </div>

      {/* Draggable Widgets */}
      <DraggableGrid id="prices" defaultLayout={DEFAULT_LAYOUT} rowHeight={60}>

        <div key="chart">
          <Widget draggable
            title={
              viewMode === 'da'
                ? `Day-Ahead Zonal ${lmpField === 'LMP' ? 'LBMPs' : lmpField === 'MLC' ? 'Marginal Losses' : 'Marginal Congestion'}`
                : viewMode === 'rt'
                ? `Real-Time Zonal ${lmpField === 'LMP' ? 'LBMPs' : lmpField === 'MLC' ? 'Marginal Losses' : 'Marginal Congestion'}`
                : `DA-RT ${lmpField === 'LMP' ? 'LMP' : lmpField === 'MLC' ? 'Losses (MLC)' : 'Congestion (MCC)'} Spread`
            }
            subtitle={`${resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'} · ${selectedZones.length}/${allZones.length} zones`}
            badge={`${viewMode === 'da' ? daChartData.length : viewMode === 'rt' ? rtChartData.length : dartChartData.length} pts`}
            actions={
              <div className="widget-tabs">
                {(['da', 'rt', 'dart'] as ViewMode[]).map(m => (
                  <button key={m} className={`widget-tab${viewMode === m ? ' active' : ''}`} onClick={() => setViewMode(m)}>
                    {m === 'da' ? 'DA LMPs' : m === 'rt' ? 'RT LMPs' : 'DART'}
                  </button>
                ))}
                <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
                {(['LMP', 'MLC', 'MCC'] as LmpField[]).map(f => (
                  <button key={f} className={`widget-tab${lmpField === f ? ' active' : ''}`} onClick={() => setLmpField(f)}>
                    {f === 'LMP' ? 'LMP' : f === 'MLC' ? 'Losses' : 'Congestion'}
                  </button>
                ))}
              </div>
            }
            controls={
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
            }
          >
            {loading ? (
              <div className="loading"><div className="spinner" /> Loading...</div>
            ) : (
              <PriceChart
                data={viewMode === 'da' ? daChartData : viewMode === 'rt' ? rtChartData : dartChartData}
                xKey="Date"
                yKeys={selectedZones}
                chartType={chartType}
                height={420}
              />
            )}
          </Widget>
        </div>

        <div key="scarcity">
          <ScarcitySignalSection />
        </div>

        <div key="raw">
          <Widget title={`All Price Datasets (${RAW_DATASETS.length})`} draggable defaultCollapsed noPad>
            {RAW_DATASETS.map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution="hourly" defaultExpanded={i === 0} />
            ))}
          </Widget>
        </div>

      </DraggableGrid>
    </div>
  );
}
