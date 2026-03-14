import { useState, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';

const DATASETS = [
  'da_lbmp_zone', 'rt_lbmp_zone', 'integrated_rt_lbmp_zone',
  'da_lbmp_gen', 'rt_lbmp_gen', 'integrated_rt_lbmp_gen',
  'reference_bus_lbmp', 'ext_rto_cts_price', 'damasp', 'rtasp',
];

export default function Prices() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);

  const { data: daData, loading: daLoading } = useDataset('da_lbmp_zone', resolution);
  const { data: rtData, loading: rtLoading } = useDataset('rt_lbmp_zone', resolution);

  const loading = daLoading || rtLoading;

  const { kpis, daChart, spreadChart } = useMemo(() => {
    const daRecords = daData?.data || [];
    const rtRecords = rtData?.data || [];

    const daLmps = daRecords.map((r: any) => Number(r.LMP)).filter(Boolean);
    const rtLmps = rtRecords.map((r: any) => Number(r.LMP)).filter(Boolean);

    const avgDa = daLmps.length ? daLmps.reduce((a: number, b: number) => a + b, 0) / daLmps.length : null;
    const avgRt = rtLmps.length ? rtLmps.reduce((a: number, b: number) => a + b, 0) / rtLmps.length : null;
    const maxDa = daLmps.length ? Math.max(...daLmps) : null;
    const maxRt = rtLmps.length ? Math.max(...rtLmps) : null;

    const zones = [...new Set(daRecords.map((r: any) => String(r.Zone)))].slice(0, 8);
    const pivoted: Record<string, any> = {};
    for (const r of daRecords) {
      const key = `${r.Date}_${r.HE}`;
      if (!pivoted[key]) pivoted[key] = { Date: r.Date, HE: r.HE };
      if (zones.includes(String(r.Zone))) pivoted[key][String(r.Zone)] = Number(r.LMP);
    }
    const daChart = { data: Object.values(pivoted), xKey: 'Date', yKeys: zones };

    const spreadByZone: Record<string, { total: number; count: number; max: number }> = {};
    for (const r of rtRecords) {
      const matchKey = `${r.Date}_${r.HE}_${r.Zone}`;
      const daMatch = daRecords.find((d: any) => `${d.Date}_${d.HE}_${d.Zone}` === matchKey);
      if (daMatch) {
        const spread = Math.abs(Number(r.LMP) - Number(daMatch.LMP));
        const zone = String(r.Zone);
        if (!spreadByZone[zone]) spreadByZone[zone] = { total: 0, count: 0, max: 0 };
        spreadByZone[zone].total += spread;
        spreadByZone[zone].count++;
        spreadByZone[zone].max = Math.max(spreadByZone[zone].max, spread);
      }
    }
    const spreadChart = Object.entries(spreadByZone)
      .map(([zone, s]) => ({ Zone: zone, 'Avg Spread': Number((s.total / s.count).toFixed(2)), 'Max Spread': Number(s.max.toFixed(2)) }))
      .sort((a, b) => b['Avg Spread'] - a['Avg Spread'])
      .slice(0, 12);

    return { kpis: { avgDa, avgRt, maxDa, maxRt }, daChart, spreadChart };
  }, [daData, rtData]);

  const topVolZone = useMemo(() => {
    if (!spreadChart.length) return null;
    return spreadChart[0];
  }, [spreadChart]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Price Intelligence</h1>
        <p className="page-subtitle">
          Day-Ahead and Real-Time LBMPs, DA-RT spreads, ancillary services, and CTS prices
        </p>
      </div>

      <ResolutionSelector value={resolution} onChange={setResolution} />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi-card">
          <div className="kpi-label">Avg DA LMP</div>
          <div className="kpi-value">
            {kpis.avgDa ? <>${kpis.avgDa.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg RT LMP</div>
          <div className="kpi-value">
            {kpis.avgRt ? <>${kpis.avgRt.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Max DA LMP</div>
          <div className="kpi-value">
            {kpis.maxDa ? <>${kpis.maxDa.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card accent">
          <div className="kpi-label">Top Spread Zone</div>
          <div className="kpi-value">{topVolZone ? topVolZone.Zone : '—'}</div>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading price data...</div>}

      {!loading && daChart.data.length > 1 && (
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">DA Zonal LBMPs</div>
            <span className="badge badge-primary">{resolution}</span>
          </div>
          <LineChart data={daChart.data} xKey={daChart.xKey} yKeys={daChart.yKeys} height={300} />
        </div>
      )}

      {!loading && spreadChart.length > 0 && (
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">DA-RT Spread by Zone</div>
          </div>
          <LineChart data={spreadChart} xKey="Zone" yKeys={['Avg Spread', 'Max Spread']} height={240} />
        </div>
      )}

      {!loading && topVolZone && (
        <div className="insight-card">
          <div className="insight-title">Price Summary</div>
          <div className="insight-body">
            Average DA LMP across zones is <strong>${kpis.avgDa?.toFixed(2)}/MWh</strong>, with RT averaging <strong>${kpis.avgRt?.toFixed(2)}/MWh</strong>.
            <strong> {topVolZone.Zone}</strong> shows the highest DA-RT spread at <strong>${topVolZone['Avg Spread'].toFixed(2)}/MWh avg</strong> (max ${topVolZone['Max Spread'].toFixed(2)}).
            {kpis.maxDa && kpis.maxDa > 100 && <> Peak DA prices reached <strong>${kpis.maxDa.toFixed(2)}/MWh</strong>.</>}
          </div>
        </div>
      )}

      <div className="section-container">
        <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
          <span className="chevron">{showRaw ? '▾' : '▸'}</span>
          All Price Datasets ({DATASETS.length})
        </div>
        {showRaw && (
          <div style={{ marginTop: 8 }}>
            {DATASETS.map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution={resolution} defaultExpanded={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
