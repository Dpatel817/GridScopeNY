import { useState, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';

export default function Demand() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);

  const { data: forecastData, loading: fLoading } = useDataset('isolf', resolution);
  const { data: actualData, loading: aLoading } = useDataset('pal', resolution);

  const loading = fLoading || aLoading;

  const { kpis, forecastChart, errorChart } = useMemo(() => {
    const fRecords = forecastData?.data || [];
    const aRecords = actualData?.data || [];

    const fVals = fRecords.map((r: any) => Number(r.NYISO || 0)).filter(Boolean);
    const aVals = aRecords.map((r: any) => {
      const nyiso = Number(r.NYISO || r['Time Zone'] === 'NYISO' ? r.Load || 0 : 0);
      return nyiso;
    }).filter(Boolean);

    const forecastPeak = fVals.length ? Math.max(...fVals) : null;
    const actualPeak = aVals.length ? Math.max(...aVals) : null;
    const delta = forecastPeak && actualPeak ? actualPeak - forecastPeak : null;
    const avgError = forecastPeak && actualPeak && fVals.length
      ? fVals.reduce((s: number, v: number, i: number) => {
          const a = aVals[i] || 0;
          return s + Math.abs(v - a);
        }, 0) / Math.min(fVals.length, aVals.length)
      : null;

    const forecastChart = fRecords.length > 0
      ? (() => {
          const xKey = fRecords[0]?.Date ? 'Date' : 'Time Stamp';
          const zones = Object.keys(fRecords[0] || {}).filter(k => !['Date', 'Time Stamp', 'HE', 'MONTH', 'YEAR', 'Month', 'Year', 'Vintage Date', 'Forecast Date', 'source_date', 'SOURCE_DATE'].includes(k));
          return { data: fRecords, xKey, yKeys: zones.slice(0, 6) };
        })()
      : null;

    const errorChart = fRecords.length > 0 && aRecords.length > 0
      ? (() => {
          const combined: any[] = [];
          for (let i = 0; i < Math.min(fRecords.length, 200); i++) {
            const f = fRecords[i];
            const fVal = Number(f.NYISO || 0);
            if (!fVal) continue;
            const matchA = aRecords.find((a: any) => a.Date === f.Date && a.HE === f.HE);
            const aVal = matchA ? Number(matchA.NYISO || matchA.Load || 0) : 0;
            if (aVal) {
              combined.push({
                Date: f.Date,
                HE: f.HE,
                'Forecast': fVal,
                'Actual': aVal,
                'Error': fVal - aVal,
              });
            }
          }
          return combined;
        })()
      : null;

    return {
      kpis: { forecastPeak, actualPeak, delta, avgError },
      forecastChart,
      errorChart,
    };
  }, [forecastData, actualData]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Demand Intelligence</h1>
        <p className="page-subtitle">
          Forecast vs actual load analysis — identify demand surprises and potential market stress
        </p>
      </div>

      <ResolutionSelector value={resolution} onChange={setResolution} />

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

      {!loading && forecastChart && (
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">System Load Forecast by Zone</div>
            <span className="badge badge-primary">{resolution}</span>
          </div>
          <LineChart data={forecastChart.data} xKey={forecastChart.xKey} yKeys={forecastChart.yKeys} height={300} />
        </div>
      )}

      {!loading && errorChart && errorChart.length > 0 && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="chart-card">
            <div className="chart-card-header">
              <div className="chart-card-title">Forecast vs Actual (NYISO Total)</div>
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

      {!loading && kpis.forecastPeak && (
        <div className="insight-card">
          <div className="insight-title">Demand Summary</div>
          <div className="insight-body">
            Peak system forecast was <strong>{kpis.forecastPeak?.toLocaleString()} MW</strong>.
            {kpis.actualPeak && <> Actual peak came in at <strong>{kpis.actualPeak.toLocaleString()} MW</strong>.</>}
            {kpis.delta !== null && Math.abs(kpis.delta) > 200 && (
              <> The <strong>{Math.abs(kpis.delta).toLocaleString()} MW {kpis.delta > 0 ? 'over-forecast' : 'under-forecast'}</strong> may have contributed to price deviations.</>
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
