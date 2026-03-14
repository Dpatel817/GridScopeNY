import { useState, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';

const DATASETS = [
  'rtfuelmix', 'gen_maint_report', 'op_in_commit',
  'dam_imer', 'rt_imer', 'btm_da_forecast', 'btm_estimated_actual',
];

export default function Generation() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);

  const { data: fuelData, loading } = useDataset('rtfuelmix', resolution);

  const { kpis, chartData, fuelBreakdown } = useMemo(() => {
    const records = fuelData?.data || [];
    if (!records.length) return { kpis: {}, chartData: [], fuelBreakdown: [] };

    const genCol = records[0]?.['Generation MW'] !== undefined ? 'Generation MW' : 'Gen MW';
    const fuelCol = records[0]?.['Fuel Type'] !== undefined ? 'Fuel Type' : 'Fuel Category';

    const genVals = records.map((r: any) => Number(r[genCol] || 0)).filter(Boolean);
    const totalGen = genVals.reduce((a: number, b: number) => a + b, 0);
    const maxGen = genVals.length ? Math.max(...genVals) : 0;

    const byFuel: Record<string, { total: number; count: number; max: number; name: string }> = {};
    for (const r of records) {
      const fuel = String(r[fuelCol] || 'Unknown');
      const gen = Number(r[genCol] || 0);
      if (!byFuel[fuel]) byFuel[fuel] = { total: 0, count: 0, max: 0, name: fuel };
      byFuel[fuel].total += gen;
      byFuel[fuel].count++;
      byFuel[fuel].max = Math.max(byFuel[fuel].max, gen);
    }

    const fuelBreakdown = Object.values(byFuel)
      .sort((a, b) => b.total - a.total)
      .map(f => ({ ...f, avg: f.total / f.count, share: totalGen > 0 ? (f.total / totalGen * 100) : 0 }));

    const topFuels = fuelBreakdown.slice(0, 7).map(f => f.name);
    const pivoted: Record<string, any> = {};
    for (const r of records) {
      const fuel = String(r[fuelCol] || '');
      if (!topFuels.includes(fuel)) continue;
      const dateKey = r.Date || r['Time Stamp'] || '';
      const key = `${dateKey}_${r.HE || ''}`;
      if (!pivoted[key]) pivoted[key] = { Date: dateKey };
      pivoted[key][fuel] = Number(r[genCol] || 0);
    }
    const chartData = Object.values(pivoted).sort((a: any, b: any) => a.Date < b.Date ? -1 : 1);

    const topFuel = fuelBreakdown[0];

    return {
      kpis: {
        totalGen: totalGen / fuelBreakdown[0]?.count || 0,
        maxGen,
        fuelCount: fuelBreakdown.length,
        topFuel: topFuel?.name,
        topFuelShare: topFuel?.share,
      },
      chartData: chartData.length > 1 ? chartData : [],
      fuelBreakdown,
    };
  }, [fuelData]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Generation Mix</h1>
        <p className="page-subtitle">
          Real-time fuel mix, committed capacity, BTM solar, and generation maintenance
        </p>
      </div>

      <ResolutionSelector value={resolution} onChange={setResolution} />

      {loading && <div className="loading"><div className="spinner" /> Loading generation data...</div>}

      {!loading && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi-card">
              <div className="kpi-label">Peak Generation</div>
              <div className="kpi-value">
                {kpis.maxGen ? <>{kpis.maxGen.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span className="kpi-unit">MW</span></> : '—'}
              </div>
            </div>
            <div className="kpi-card accent">
              <div className="kpi-label">Top Fuel Source</div>
              <div className="kpi-value" style={{ fontSize: '1.1rem' }}>{kpis.topFuel || '—'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Top Fuel Share</div>
              <div className="kpi-value">
                {kpis.topFuelShare ? <>{kpis.topFuelShare.toFixed(1)}<span className="kpi-unit">%</span></> : '—'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Fuel Types</div>
              <div className="kpi-value">{kpis.fuelCount || '—'}</div>
            </div>
          </div>

          {chartData.length > 0 && (
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Generation by Fuel Type</div>
                <span className="badge badge-primary">{resolution}</span>
              </div>
              <LineChart
                data={chartData}
                xKey="Date"
                yKeys={fuelBreakdown.slice(0, 7).map(f => f.name)}
                height={300}
              />
            </div>
          )}

          {fuelBreakdown.length > 0 && (
            <>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div className="chart-card-title">Fuel Mix Breakdown</div>
                </div>
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
                    {fuelBreakdown.map(f => (
                      <tr key={f.name}>
                        <td style={{ fontWeight: 600 }}>{f.name}</td>
                        <td>{f.avg.toFixed(0)} MW</td>
                        <td style={{ fontWeight: 600 }}>{f.max.toFixed(0)} MW</td>
                        <td>{f.share.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="insight-card">
                <div className="insight-title">Generation Summary</div>
                <div className="insight-body">
                  <strong>{fuelBreakdown[0].name}</strong> dominates the generation mix at <strong>{fuelBreakdown[0].share.toFixed(1)}%</strong> of total output,
                  averaging <strong>{fuelBreakdown[0].avg.toFixed(0)} MW</strong>.
                  {fuelBreakdown.length > 1 && <> <strong>{fuelBreakdown[1].name}</strong> follows at <strong>{fuelBreakdown[1].share.toFixed(1)}%</strong>.</>}
                  {' '}Peak generation across all fuels reached <strong>{kpis.maxGen?.toLocaleString()} MW</strong>.
                </div>
              </div>
            </>
          )}

          <div className="section-container">
            <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
              <span className="chevron">{showRaw ? '▾' : '▸'}</span>
              All Generation Datasets ({DATASETS.length})
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
