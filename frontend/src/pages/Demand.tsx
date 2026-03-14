import { useState, useMemo, useEffect } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';
import SeriesSelector from '../components/SeriesSelector';

const META_COLS = new Set(['Date', 'Time Stamp', 'HE', 'MONTH', 'YEAR', 'Month', 'Year',
  'Vintage Date', 'Forecast Date', 'source_date', 'SOURCE_DATE', 'source_file', 'Time Zone']);

export default function Demand() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);

  const { data: forecastData, loading: fLoading, error: fError } = useDataset('isolf', resolution);
  const { data: actualData, loading: aLoading, error: aError } = useDataset('pal', resolution);

  const loading = fLoading || aLoading;

  const allZones = useMemo(() => {
    const fRecords = forecastData?.data || [];
    if (!fRecords.length) return [];
    return Object.keys(fRecords[0]).filter(k => !META_COLS.has(k)).sort();
  }, [forecastData]);

  useEffect(() => {
    if (allZones.length > 0 && selectedZones.length === 0) {
      setSelectedZones([...allZones]);
    }
  }, [allZones]);

  const { kpis, forecastChart, errorChart } = useMemo(() => {
    const fRecords = forecastData?.data || [];
    const aRecords = actualData?.data || [];

    const fVals = fRecords.map((r: any) => Number(r.NYISO || 0)).filter((v: number) => v > 0);

    const aTotals: Record<string, number> = {};
    for (const r of aRecords) {
      const key = `${r.Date}_${r.HE}`;
      const v = Number(r.NYISO || r.Load || 0);
      if (v > 0) {
        aTotals[key] = (aTotals[key] || 0) + v;
      }
    }

    const aVals = Object.values(aTotals);
    const forecastPeak = fVals.length ? Math.max(...fVals) : null;
    const actualPeak = aVals.length ? Math.max(...aVals) : null;
    const delta = forecastPeak !== null && actualPeak !== null ? actualPeak - forecastPeak : null;

    let errorSum = 0;
    let errorCount = 0;
    const combined: any[] = [];
    for (const f of fRecords) {
      const fVal = Number(f.NYISO || 0);
      if (!fVal) continue;
      const aVal = aTotals[`${f.Date}_${f.HE}`];
      if (aVal) {
        combined.push({
          Date: f.Date || f['Time Stamp'],
          HE: f.HE,
          Forecast: fVal,
          Actual: aVal,
          Error: fVal - aVal,
        });
        errorSum += Math.abs(fVal - aVal);
        errorCount++;
      }
    }
    const avgError = errorCount > 0 ? errorSum / errorCount : null;

    const forecastChart = fRecords.length > 0
      ? { data: fRecords, xKey: fRecords[0]?.Date ? 'Date' : 'Time Stamp', yKeys: selectedZones }
      : null;

    if (typeof console !== 'undefined') {
      console.log(`[Demand] Zones available: ${allZones.length}, displayed: ${selectedZones.length}, forecast rows: ${fRecords.length}, actual rows: ${aRecords.length}, merged: ${combined.length}`);
    }

    return {
      kpis: { forecastPeak, actualPeak, delta, avgError },
      forecastChart,
      errorChart: combined.length > 0 ? combined : null,
    };
  }, [forecastData, actualData, selectedZones, allZones]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Demand Intelligence</h1>
        <p className="page-subtitle">
          Forecast vs actual load analysis — identify demand surprises and potential market stress
        </p>
      </div>

      <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <ResolutionSelector value={resolution} onChange={setResolution} />
        {allZones.length > 0 && (
          <SeriesSelector
            label="Zones"
            allSeries={allZones}
            selected={selectedZones}
            onChange={setSelectedZones}
          />
        )}
      </div>

      {(fError || aError) && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load demand data: {fError || aError}</div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi-card">
          <div className="kpi-label">Forecast Peak Load</div>
          <div className="kpi-value">
            {kpis.forecastPeak ? <>{kpis.forecastPeak.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span className="kpi-unit">MW</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Actual Peak Load</div>
          <div className="kpi-value">
            {kpis.actualPeak ? <>{kpis.actualPeak.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span className="kpi-unit">MW</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Peak Delta</div>
          <div className="kpi-value">
            {kpis.delta !== null ? (
              <span style={{ color: Math.abs(kpis.delta) > 500 ? 'var(--danger)' : 'var(--text)' }}>
                {kpis.delta > 0 ? '+' : ''}{kpis.delta.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="kpi-unit">MW</span>
              </span>
            ) : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg Forecast Error</div>
          <div className="kpi-value">
            {kpis.avgError !== null ? <>{kpis.avgError.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span className="kpi-unit">MW</span></> : '—'}
          </div>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading demand data...</div>}

      {!loading && forecastChart && selectedZones.length > 0 && (
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">System Load Forecast by Zone</div>
            <span className="badge badge-primary">{resolution} · {selectedZones.length} of {allZones.length} zones</span>
          </div>
          <LineChart data={forecastChart.data} xKey={forecastChart.xKey} yKeys={forecastChart.yKeys} height={300} />
        </div>
      )}

      {!loading && errorChart && errorChart.length > 0 && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="chart-card">
            <div className="chart-card-header">
              <div className="chart-card-title">Forecast vs Actual (NYISO Total)</div>
              <span className="badge badge-primary">{errorChart.length} matched intervals</span>
            </div>
            <LineChart data={errorChart} xKey="Date" yKeys={['Forecast', 'Actual']} height={260} />
          </div>
          <div className="chart-card">
            <div className="chart-card-header">
              <div className="chart-card-title">Forecast Error</div>
            </div>
            <LineChart data={errorChart} xKey="Date" yKeys={['Error']} height={260} />
          </div>
        </div>
      )}

      {!loading && !errorChart && actualData && !aError && (
        <div className="insight-card" style={{ background: 'var(--warning-light)' }}>
          <div className="insight-title" style={{ color: '#92400e' }}>Actual Load Data</div>
          <div className="insight-body">No actual load records could be matched with forecast data. This may mean the actual load dataset has a different time alignment or has not been fetched yet.</div>
        </div>
      )}

      {!loading && kpis.forecastPeak && (
        <div className="insight-card">
          <div className="insight-title">Demand Summary</div>
          <div className="insight-body">
            Peak system forecast was <strong>{kpis.forecastPeak?.toLocaleString()} MW</strong>.
            {kpis.actualPeak && <> Actual peak came in at <strong>{kpis.actualPeak.toLocaleString()} MW</strong>.</>}
            {kpis.delta !== null && Math.abs(kpis.delta) > 200 && (
              <> The <strong>{Math.abs(kpis.delta).toLocaleString()} MW {kpis.delta > 0 ? 'under-forecast' : 'over-forecast'}</strong> may have contributed to price deviations.</>
            )}
            {kpis.avgError && <> Average forecast error was <strong>{kpis.avgError.toLocaleString(undefined, { maximumFractionDigits: 0 })} MW</strong>.</>}
          </div>
        </div>
      )}

      <div className="section-container">
        <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
          <span className="chevron">{showRaw ? '▾' : '▸'}</span>
          Detailed Data
        </div>
        {showRaw && (
          <div style={{ marginTop: 8 }}>
            {['isolf', 'pal', 'pal_integrated', 'lfweather'].map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution={resolution} defaultExpanded={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
