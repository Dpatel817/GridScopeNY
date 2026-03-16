import { useState, useMemo, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { useDataset } from '../hooks/useDataset';
import type { Resolution, DateRange } from '../data/priceTransforms';
import type { AspProduct, CompareMode, LmpRow, AspRow } from '../data/priceResponseTransforms';
import {
  ASP_PRODUCTS, getAvailableZones, getAvailableDates,
  buildAlignedData, pivotForChart,
  computeScarcityMetrics, buildScarcitySignalSummary,
} from '../data/priceResponseTransforms';
import { makeTickFormatter, getTickInterval, tooltipLabelFormatter } from '../utils/dateFormat';

const RESOLUTIONS: { key: Resolution; label: string }[] = [
  { key: 'hourly', label: 'Hourly' },
  { key: 'on_peak', label: 'On-Peak Avg' },
  { key: 'off_peak', label: 'Off-Peak Avg' },
  { key: 'daily', label: 'Daily Avg' },
];

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Latest Day' },
  { key: 'custom', label: 'Custom Range' },
  { key: 'all', label: 'All Dates' },
];

const COMPARE_MODES: { key: CompareMode; label: string }[] = [
  { key: 'absolute', label: 'Absolute' },
  { key: 'spread', label: 'Spread' },
  { key: 'normalized', label: 'Normalized' },
];

const LMP_COLORS = { da: '#2563eb', rt: '#ef4444' };
const ASP_COLORS = { da: '#8b5cf6', rt: '#f59e0b' };

function makeDualTooltip(fmtLabel: (v: unknown) => string) {
  return function DualTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
      <div className="price-tooltip">
        <div className="price-tooltip-label">{fmtLabel(label)}</div>
        {payload.map((entry: any, i: number) => {
          const val = typeof entry.value === 'number'
            ? (Number.isInteger(entry.value) ? entry.value.toLocaleString() : entry.value.toFixed(2))
            : entry.value;
          return (
            <div key={i} className="price-tooltip-row">
              <span className="price-tooltip-dot" style={{ background: entry.color }} />
              <span className="price-tooltip-name">{entry.name}</span>
              <span className="price-tooltip-val">${val}</span>
            </div>
          );
        })}
      </div>
    );
  };
}

export default function ScarcitySignalSection() {
  const { data: daLmpData } = useDataset('da_lbmp_zone', 'daily', undefined, undefined, 20000, 730);
  const { data: rtLmpData } = useDataset('rt_lbmp_zone', 'daily', undefined, undefined, 20000, 730);
  const { data: damaspData, loading: damaspLoading } = useDataset('damasp', 'daily', undefined, undefined, 20000, 730);
  const { data: rtaspData, loading: rtaspLoading } = useDataset('rtasp', 'daily', undefined, undefined, 20000, 730);

  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedZone, setSelectedZone] = useState('');
  const [aspProduct, setAspProduct] = useState<AspProduct>('10 Min Spin');
  const [compareMode, setCompareMode] = useState<CompareMode>('absolute');

  const daLmpRows = useMemo(() => (daLmpData?.data || []) as LmpRow[], [daLmpData]);
  const rtLmpRows = useMemo(() => (rtLmpData?.data || []) as LmpRow[], [rtLmpData]);
  const daAspRows = useMemo(() => (damaspData?.data || []) as AspRow[], [damaspData]);
  const rtAspRows = useMemo(() => (rtaspData?.data || []) as AspRow[], [rtaspData]);

  const allZones = useMemo(() => getAvailableZones(daLmpRows), [daLmpRows]);
  const availableDates = useMemo(() => getAvailableDates(daLmpRows), [daLmpRows]);

  useEffect(() => {
    if (allZones.length && !selectedZone) {
      setSelectedZone(allZones.includes('N.Y.C.') ? 'N.Y.C.' : allZones[0]);
    }
  }, [allZones]);

  useEffect(() => {
    if (availableDates.length && !startDate) {
      setStartDate(availableDates[0]);
      setEndDate(availableDates[availableDates.length - 1]);
    }
  }, [availableDates]);

  const aligned = useMemo(() =>
    buildAlignedData(daLmpRows, rtLmpRows, daAspRows, rtAspRows, selectedZone, aspProduct, dateRange, startDate, endDate),
    [daLmpRows, rtLmpRows, daAspRows, rtAspRows, selectedZone, aspProduct, dateRange, startDate, endDate]
  );

  const { lmpData, aspData } = useMemo(() =>
    pivotForChart(aligned, resolution, compareMode),
    [aligned, resolution, compareMode]
  );

  const metrics = useMemo(() =>
    computeScarcityMetrics(aligned, aspProduct, selectedZone),
    [aligned, aspProduct, selectedZone]
  );

  const summary = useMemo(() => buildScarcitySignalSummary(metrics), [metrics]);

  const lmpKeys = useMemo(() => {
    if (!lmpData.length) return [];
    return Object.keys(lmpData[0]).filter(k => k !== 'Date' && k !== '_ts');
  }, [lmpData]);

  const aspKeys = useMemo(() => {
    if (!aspData.length) return [];
    return Object.keys(aspData[0]).filter(k => k !== 'Date' && k !== '_ts');
  }, [aspData]);

  const loading = damaspLoading || rtaspLoading;
  const lmpUseTs = lmpData.length > 0 && '_ts' in (lmpData[0] || {});
  const lmpXKey = lmpUseTs ? '_ts' : 'Date';
  const lmpInterval = useMemo(() => getTickInterval(lmpData, lmpXKey), [lmpData, lmpXKey]);
  const lmpFmtTick = useMemo(() => makeTickFormatter(lmpData, lmpXKey), [lmpData, lmpXKey]);
  const lmpFmtTooltipLabel = useMemo(() => tooltipLabelFormatter(lmpData, lmpXKey), [lmpData, lmpXKey]);
  const LmpTooltip = useMemo(() => makeDualTooltip(lmpFmtTooltipLabel), [lmpFmtTooltipLabel]);
  const aspUseTs = aspData.length > 0 && '_ts' in (aspData[0] || {});
  const aspXKey = aspUseTs ? '_ts' : 'Date';
  const aspInterval = useMemo(() => getTickInterval(aspData, aspXKey), [aspData, aspXKey]);
  const aspFmtTick = useMemo(() => makeTickFormatter(aspData, aspXKey), [aspData, aspXKey]);
  const aspFmtTooltipLabel = useMemo(() => tooltipLabelFormatter(aspData, aspXKey), [aspData, aspXKey]);
  const AspTooltip = useMemo(() => makeDualTooltip(aspFmtTooltipLabel), [aspFmtTooltipLabel]);

  const lmpColors = compareMode === 'spread' ? ['#2563eb'] : [LMP_COLORS.da, LMP_COLORS.rt];
  const aspColorsArr = compareMode === 'spread' ? ['#8b5cf6'] : [ASP_COLORS.da, ASP_COLORS.rt];

  return (
    <div className="scarcity-section">
      <div className="scarcity-header">
        <div>
          <h2 className="scarcity-title">Energy vs Ancillary Price Signals</h2>
          <p className="scarcity-subtitle">
            Compare energy and ancillary price behavior to identify scarcity conditions and demand response incentive periods
          </p>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading ancillary service data...</div>}

      {!loading && (
        <div className="scarcity-layout">
          <div className="pcc-panel scarcity-controls">
            <div className="pcc-title">Signal Controls</div>

            <div className="pcc-section">
              <div className="pcc-label">Zone</div>
              <select
                className="pcc-date"
                value={selectedZone}
                onChange={e => setSelectedZone(e.target.value)}
              >
                {allZones.map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>

            <div className="pcc-section">
              <div className="pcc-label">Ancillary Product</div>
              <div className="pcc-btn-group" style={{ flexDirection: 'column' }}>
                {ASP_PRODUCTS.map(p => (
                  <button
                    key={p.key}
                    className={`pcc-btn${aspProduct === p.key ? ' active' : ''}`}
                    onClick={() => setAspProduct(p.key)}
                    style={{ fontSize: 11 }}
                  >
                    {p.label}
                  </button>
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
                    onClick={() => setResolution(r.key)}
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
                    onClick={() => {
                      const range = d.key;
                      setDateRange(range);
                      if (range === 'custom' && (!startDate || !endDate) && availableDates.length > 0) {
                        const end = availableDates[availableDates.length - 1];
                        const si = Math.max(0, availableDates.length - 7);
                        setStartDate(availableDates[si]);
                        setEndDate(end);
                      }
                    }}
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
                    onChange={e => setStartDate(e.target.value)}
                  />
                  <span className="pcc-date-sep">to</span>
                  <input
                    type="date"
                    className="pcc-date"
                    value={endDate}
                    min={availableDates.length > 0 ? availableDates[0] : undefined}
                    max={availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined}
                    onChange={e => setEndDate(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="pcc-section">
              <div className="pcc-label">Compare Mode</div>
              <div className="pcc-btn-group">
                {COMPARE_MODES.map(m => (
                  <button
                    key={m.key}
                    className={`pcc-btn${compareMode === m.key ? ' active' : ''}`}
                    onClick={() => setCompareMode(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scarcity-charts">
            <div className="scarcity-info-bar">
              <span>{selectedZone}</span>
              <span>{ASP_PRODUCTS.find(p => p.key === aspProduct)?.label}</span>
              <span>{resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'}</span>
              <span>{dateRange === 'today' ? 'Latest Day' : dateRange === 'all' ? 'All Dates' : `${startDate} — ${endDate}`}</span>
            </div>

            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">
                  {compareMode === 'spread' ? 'DA-RT LMP Spread' : 'Energy Prices (LMP)'}
                </div>
                <span className="badge badge-primary">{lmpData.length} points</span>
              </div>
              {lmpData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={lmpData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey={lmpXKey} tickFormatter={lmpFmtTick} tick={{ fontSize: 11 }} {...(lmpUseTs ? { type: 'number' as const, domain: ['dataMin', 'dataMax'], scale: 'time' as const } : { interval: lmpInterval })} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<LmpTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {lmpKeys.map((k, i) => (
                      <Line key={k} type="monotone" dataKey={k} stroke={lmpColors[i % lmpColors.length]}
                        dot={false} activeDot={{ r: 3 }} strokeWidth={1.5} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="iq-empty">No energy price data for selected filters</div>
              )}
            </div>

            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">
                  {compareMode === 'spread' ? 'DA-RT Ancillary Spread' : `Ancillary Service Prices (${aspProduct})`}
                </div>
                <span className="badge badge-primary">{aspData.length} points</span>
              </div>
              {aspData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={aspData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey={aspXKey} tickFormatter={aspFmtTick} tick={{ fontSize: 11 }} {...(aspUseTs ? { type: 'number' as const, domain: ['dataMin', 'dataMax'], scale: 'time' as const } : { interval: aspInterval })} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<AspTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {aspKeys.map((k, i) => (
                      <Line key={k} type="monotone" dataKey={k} stroke={aspColorsArr[i % aspColorsArr.length]}
                        dot={false} activeDot={{ r: 3 }} strokeWidth={1.5} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="iq-empty">No ancillary price data for selected filters</div>
              )}
            </div>

            <div className="scarcity-kpis">
              <div className="kpi-card">
                <div className="kpi-label">Peak DA {aspProduct}</div>
                <div className="kpi-value">
                  {metrics.peakDaAsp != null ? <>${metrics.peakDaAsp.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Peak RT {aspProduct}</div>
                <div className="kpi-value">
                  {metrics.peakRtAsp != null ? <>${metrics.peakRtAsp.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">RT {'>'} DA Intervals</div>
                <div className="kpi-value">
                  {metrics.rtExceedsDaAspPct != null ? <>{metrics.rtExceedsDaAspPct.toFixed(0)}<span className="kpi-unit">%</span></> : '—'}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Spike Alignment</div>
                <div className="kpi-value">
                  {metrics.spikeAlignedPct != null ? <>{metrics.spikeAlignedPct.toFixed(0)}<span className="kpi-unit">%</span></> : '—'}
                </div>
              </div>
              <div className="kpi-card accent">
                <div className="kpi-label">Scarcity Intervals</div>
                <div className="kpi-value">
                  {metrics.scarcityIntervals}<span className="kpi-unit"> / {metrics.totalIntervals}</span>
                </div>
              </div>
            </div>

            <div className="scarcity-summary">
              <div className="price-summary-header">
                <span className="price-summary-title">Scarcity Signal Analysis</span>
              </div>
              <div className="price-summary-body">{summary}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
