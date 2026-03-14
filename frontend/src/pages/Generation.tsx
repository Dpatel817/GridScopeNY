import { useState, useMemo, useEffect } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';
import SeriesSelector from '../components/SeriesSelector';

const DATASETS = [
  'rtfuelmix', 'gen_maint_report', 'op_in_commit',
  'dam_imer', 'rt_imer', 'btm_da_forecast', 'btm_estimated_actual',
];

export default function Generation() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);
  const [selectedFuels, setSelectedFuels] = useState<string[]>([]);

  const { data: fuelData, loading, error } = useDataset('rtfuelmix', resolution);

  const { allFuels, kpis, chartData, fuelBreakdown } = useMemo(() => {
    const records = fuelData?.data || [];
    if (!records.length) return { allFuels: [], kpis: {} as any, chartData: [], fuelBreakdown: [] };

    const genCol = records[0]?.['Generation MW'] !== undefined ? 'Generation MW' : 'Gen MW';
    const fuelCol = records[0]?.['Fuel Type'] !== undefined ? 'Fuel Type' : 'Fuel Category';

    const genVals = records.map((r: any) => Number(r[genCol] || 0)).filter((v: number) => v > 0);
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

    const allFuels = fuelBreakdown.map(f => f.name);

    const activeFuels = selectedFuels.length > 0 ? selectedFuels : allFuels;
    const pivoted: Record<string, any> = {};
    for (const r of records) {
      const fuel = String(r[fuelCol] || '');
      if (!activeFuels.includes(fuel)) continue;
      const dateKey = r.Date || r['Time Stamp'] || '';
      const key = `${dateKey}_${r.HE || ''}`;
      if (!pivoted[key]) pivoted[key] = { Date: dateKey };
      pivoted[key][fuel] = Number(r[genCol] || 0);
    }
    const chartData = Object.values(pivoted).sort((a: any, b: any) => a.Date < b.Date ? -1 : 1);

    const topFuel = fuelBreakdown[0];

    if (typeof console !== 'undefined') {
      console.log(`[Generation] Fuel types available: ${allFuels.length}, displayed: ${activeFuels.length}, records: ${records.length}`);
    }

    return {
      allFuels,
      kpis: {
        totalGen: totalGen / (fuelBreakdown[0]?.count || 1),
        maxGen,
        fuelCount: fuelBreakdown.length,
        topFuel: topFuel?.name,
        topFuelShare: topFuel?.share,
      },
      chartData: chartData.length > 1 ? chartData : [],
      fuelBreakdown,
    };
  }, [fuelData, selectedFuels]);

  useEffect(() => {
    if (allFuels.length > 0 && selectedFuels.length === 0) {
      setSelectedFuels([...allFuels]);
    }
  }, [allFuels]);

  const activeFuels = selectedFuels.length > 0 ? selectedFuels.filter(f => allFuels.includes(f)) : allFuels;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Generation Mix</h1>
        <p className="page-subtitle">
          Real-time fuel mix, committed capacity, BTM solar, and generation maintenance
        </p>
      </div>

      <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <ResolutionSelector value={resolution} onChange={setResolution} />
        {allFuels.length > 0 && (
          <SeriesSelector
            label="Fuel Types"
            allSeries={allFuels}
            selected={selectedFuels}
            onChange={setSelectedFuels}
          />
        )}
      </div>

      {error && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load generation data: {error}</div>
        </div>
      )}

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
                <span className="badge badge-primary">{resolution} · {activeFuels.length} of {allFuels.length} fuels</span>
              </div>
              <LineChart
                data={chartData}
                xKey="Date"
                yKeys={activeFuels}
                height={320}
              />
            </div>
          )}

          {fuelBreakdown.length > 0 && (
            <>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div className="chart-card-title">Fuel Mix Breakdown ({fuelBreakdown.length} types)</div>
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
