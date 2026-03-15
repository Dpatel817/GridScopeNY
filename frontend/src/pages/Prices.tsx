import { useState, useMemo, useEffect } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';
import SeriesSelector from '../components/SeriesSelector';
import { isNyisoZone, filterNyisoZones } from '../data/zones';

const DATASETS = [
  'da_lbmp_zone', 'rt_lbmp_zone', 'integrated_rt_lbmp_zone',
  'da_lbmp_gen', 'rt_lbmp_gen', 'integrated_rt_lbmp_gen',
  'reference_bus_lbmp', 'ext_rto_cts_price', 'damasp', 'rtasp',
];

export default function Prices() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);

  const { data: daData, loading: daLoading, error: daError } = useDataset('da_lbmp_zone', resolution);
  const { data: rtData, loading: rtLoading, error: rtError } = useDataset('rt_lbmp_zone', resolution);

  const loading = daLoading || rtLoading;

  const allZones = useMemo(() => {
    const daRecords = daData?.data || [];
    const raw = [...new Set(daRecords.map((r: any) => String(r.Zone)))].sort();
    return filterNyisoZones(raw);
  }, [daData]);

  useEffect(() => {
    if (allZones.length > 0 && selectedZones.length === 0) {
      setSelectedZones([...allZones]);
    }
  }, [allZones]);

  const { kpis, daChart, spreadChart } = useMemo(() => {
    const daRecords = daData?.data || [];
    const rtRecords = rtData?.data || [];

    const daFiltered = daRecords.filter((r: any) => isNyisoZone(String(r.Zone)));
    const rtFiltered = rtRecords.filter((r: any) => isNyisoZone(String(r.Zone)));
    const daLmps = daFiltered.map((r: any) => Number(r.LMP)).filter((v: number) => !isNaN(v) && v !== 0);
    const rtLmps = rtFiltered.map((r: any) => Number(r.LMP)).filter((v: number) => !isNaN(v) && v !== 0);

    const avgDa = daLmps.length ? daLmps.reduce((a: number, b: number) => a + b, 0) / daLmps.length : null;
    const avgRt = rtLmps.length ? rtLmps.reduce((a: number, b: number) => a + b, 0) / rtLmps.length : null;
    const maxDa = daLmps.length ? Math.max(...daLmps) : null;

    const pivoted: Record<string, any> = {};
    for (const r of daRecords) {
      const zone = String(r.Zone);
      if (!selectedZones.includes(zone)) continue;
      const dateKey = r.Date || r['Time Stamp'] || '';
      const key = `${dateKey}_${r.HE ?? ''}`;
      if (!pivoted[key]) pivoted[key] = { Date: dateKey };
      pivoted[key][zone] = Number(r.LMP);
    }
    const daChart = {
      data: Object.values(pivoted).sort((a: any, b: any) => a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0),
      xKey: 'Date',
      yKeys: selectedZones
    };

    const rtByKey: Record<string, number> = {};
    for (const r of rtRecords) {
      rtByKey[`${r.Date}_${r.HE}_${r.Zone}`] = Number(r.LMP);
    }

    const spreadByZone: Record<string, { total: number; count: number; max: number }> = {};
    for (const r of daRecords) {
      const zone = String(r.Zone);
      if (!isNyisoZone(zone)) continue;
      const matchKey = `${r.Date}_${r.HE}_${r.Zone}`;
      const rtLmp = rtByKey[matchKey];
      if (rtLmp !== undefined) {
        const spread = Math.abs(rtLmp - Number(r.LMP));
        if (!spreadByZone[zone]) spreadByZone[zone] = { total: 0, count: 0, max: 0 };
        spreadByZone[zone].total += spread;
        spreadByZone[zone].count++;
        spreadByZone[zone].max = Math.max(spreadByZone[zone].max, spread);
      }
    }
    const spreadChart = Object.entries(spreadByZone)
      .map(([zone, s]) => ({ Zone: zone, 'Avg Spread': Number((s.total / s.count).toFixed(2)), 'Max Spread': Number(s.max.toFixed(2)) }))
      .sort((a, b) => b['Avg Spread'] - a['Avg Spread']);

    if (typeof console !== 'undefined') {
      console.log(`[Prices] Zones available: ${allZones.length}, displayed: ${selectedZones.length}, DA rows: ${daRecords.length}, RT rows: ${rtRecords.length}, spread zones: ${spreadChart.length}`);
    }

    return { kpis: { avgDa, avgRt, maxDa }, daChart, spreadChart };
  }, [daData, rtData, selectedZones, allZones]);

  const topVolZone = spreadChart.length ? spreadChart[0] : null;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Price Intelligence</h1>
        <p className="page-subtitle">
          Day-Ahead and Real-Time LBMPs, DA-RT spreads, ancillary services, and CTS prices
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

      {(daError || rtError) && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load price data: {daError || rtError}</div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi-card">
          <div className="kpi-label">Avg DA LMP</div>
          <div className="kpi-value">
            {kpis.avgDa !== null ? <>${kpis.avgDa.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg RT LMP</div>
          <div className="kpi-value">
            {kpis.avgRt !== null ? <>${kpis.avgRt.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Max DA LMP</div>
          <div className="kpi-value">
            {kpis.maxDa !== null ? <>${kpis.maxDa.toFixed(2)}<span className="kpi-unit">/MWh</span></> : '—'}
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
            <span className="badge badge-primary">{resolution} · {selectedZones.length} of {allZones.length} zones</span>
          </div>
          <LineChart data={daChart.data} xKey={daChart.xKey} yKeys={daChart.yKeys} height={320} />
        </div>
      )}

      {!loading && spreadChart.length > 0 && (
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">DA-RT Spread by Zone</div>
            <span className="badge badge-primary">{spreadChart.length} zones</span>
          </div>
          <LineChart data={spreadChart} xKey="Zone" yKeys={['Avg Spread', 'Max Spread']} height={260} />
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
