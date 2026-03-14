import { useState, useMemo, useEffect } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';
import SeriesSelector from '../components/SeriesSelector';

const DATASETS = [
  'external_limits_flows', 'atc_ttc', 'ttcf',
  'par_flows', 'erie_circulation_da', 'erie_circulation_rt',
];

export default function InterfaceFlows() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);
  const [selectedInterfaces, setSelectedInterfaces] = useState<string[]>([]);

  const { data: flowData, loading, error } = useDataset('external_limits_flows', resolution);

  const { allInterfaces, kpis, chartData, interfaceStats } = useMemo(() => {
    const records = flowData?.data || [];
    if (!records.length) return { allInterfaces: [], kpis: {} as any, chartData: [], interfaceStats: [] };

    const flowCol = records[0]?.Flow !== undefined ? 'Flow' : 'Flow (MW)';
    const nameCol = records[0]?.Interface !== undefined ? 'Interface' : 'Interface Name';

    const flows = records.map((r: any) => Number(r[flowCol] || 0)).filter((v: number) => !isNaN(v));
    const avgFlow = flows.length ? flows.reduce((a: number, b: number) => a + b, 0) / flows.length : null;
    const maxFlow = flows.length ? Math.max(...flows) : null;
    const minFlow = flows.length ? Math.min(...flows) : null;

    const byInterface: Record<string, { total: number; count: number; max: number; min: number; name: string }> = {};
    for (const r of records) {
      const name = String(r[nameCol] || 'Unknown');
      const flow = Number(r[flowCol] || 0);
      if (!byInterface[name]) byInterface[name] = { total: 0, count: 0, max: -Infinity, min: Infinity, name };
      byInterface[name].total += flow;
      byInterface[name].count++;
      byInterface[name].max = Math.max(byInterface[name].max, flow);
      byInterface[name].min = Math.min(byInterface[name].min, flow);
    }

    const interfaceStats = Object.values(byInterface)
      .map(s => ({ ...s, avg: s.total / s.count, utilization: Math.abs(s.max) }))
      .sort((a, b) => b.utilization - a.utilization);

    const allInterfaces = interfaceStats.map(s => s.name);
    const active = selectedInterfaces.length > 0 ? selectedInterfaces : allInterfaces.slice(0, 8);

    const pivoted: Record<string, any> = {};
    for (const r of records) {
      const name = String(r[nameCol] || '');
      if (!active.includes(name)) continue;
      const dateKey = r.Date || r['Time Stamp'] || '';
      const key = `${dateKey}_${r.HE || ''}`;
      if (!pivoted[key]) pivoted[key] = { Date: dateKey };
      pivoted[key][name] = Number(r[flowCol] || 0);
    }
    const chartData = Object.values(pivoted).sort((a: any, b: any) => a.Date < b.Date ? -1 : 1);

    if (typeof console !== 'undefined') {
      console.log(`[InterfaceFlows] Interfaces available: ${allInterfaces.length}, displayed: ${active.length}, records: ${records.length}`);
    }

    return {
      allInterfaces,
      kpis: { avgFlow, maxFlow, minFlow, interfaceCount: interfaceStats.length, mostStressed: interfaceStats[0]?.name },
      chartData: chartData.length > 1 ? chartData : [],
      interfaceStats,
    };
  }, [flowData, selectedInterfaces]);

  useEffect(() => {
    if (allInterfaces.length > 0 && selectedInterfaces.length === 0) {
      setSelectedInterfaces(allInterfaces.slice(0, 8));
    }
  }, [allInterfaces]);

  const activeForChart = selectedInterfaces.length > 0 ? selectedInterfaces.filter(i => allInterfaces.includes(i)) : allInterfaces.slice(0, 8);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Interface Flows</h1>
        <p className="page-subtitle">
          Transmission interface utilization, import/export pressure, and transfer limits
        </p>
      </div>

      <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <ResolutionSelector value={resolution} onChange={setResolution} />
        {allInterfaces.length > 0 && (
          <SeriesSelector
            label="Interfaces"
            allSeries={allInterfaces}
            selected={selectedInterfaces}
            onChange={setSelectedInterfaces}
          />
        )}
      </div>

      {error && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load flow data: {error}</div>
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> Loading flow data...</div>}

      {!loading && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi-card accent">
              <div className="kpi-label">Most Active Interface</div>
              <div className="kpi-value" style={{ fontSize: '1.1rem' }}>{kpis.mostStressed || '—'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Max Flow</div>
              <div className="kpi-value">
                {kpis.maxFlow != null ? <>{kpis.maxFlow.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span className="kpi-unit">MW</span></> : '—'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Min Flow</div>
              <div className="kpi-value">
                {kpis.minFlow != null ? <>{kpis.minFlow.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span className="kpi-unit">MW</span></> : '—'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Active Interfaces</div>
              <div className="kpi-value">{kpis.interfaceCount || '—'}</div>
            </div>
          </div>

          {chartData.length > 0 && (
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Interface Flows Over Time</div>
                <span className="badge badge-primary">{resolution} · {activeForChart.length} of {allInterfaces.length} interfaces</span>
              </div>
              <LineChart
                data={chartData}
                xKey="Date"
                yKeys={activeForChart}
                height={320}
              />
            </div>
          )}

          {interfaceStats.length > 0 && (
            <>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div className="chart-card-title">Interface Summary ({interfaceStats.length} interfaces)</div>
                </div>
                <table className="rank-table" style={{ borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th>Interface</th>
                      <th>Avg Flow (MW)</th>
                      <th>Max Flow (MW)</th>
                      <th>Min Flow (MW)</th>
                      <th>Observations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interfaceStats.map(s => (
                      <tr key={s.name}>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td>{s.avg.toFixed(1)}</td>
                        <td style={{ fontWeight: 600, color: s.max > 2000 ? 'var(--danger)' : 'var(--text)' }}>{s.max.toFixed(0)}</td>
                        <td>{s.min.toFixed(0)}</td>
                        <td>{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="insight-card">
                <div className="insight-title">Flow Summary</div>
                <div className="insight-body">
                  <strong>{interfaceStats[0].name}</strong> is the most active interface with flows ranging from
                  <strong> {interfaceStats[0].min.toFixed(0)} MW</strong> to <strong>{interfaceStats[0].max.toFixed(0)} MW</strong>.
                  {interfaceStats[0].max > 2000 && <> High utilization suggests potential transfer constraint pressure.</>}
                  {' '}A total of <strong>{kpis.interfaceCount} interfaces</strong> are tracked.
                </div>
              </div>
            </>
          )}

          <div className="section-container">
            <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
              <span className="chevron">{showRaw ? '▾' : '▸'}</span>
              All Flow Datasets ({DATASETS.length})
            </div>
            {showRaw && (
              <div style={{ marginTop: 8 }}>
                {DATASETS.map((key, i) => (
                  <DatasetSection key={key} datasetKey={key} resolution={resolution} defaultExpanded={i === 0} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
