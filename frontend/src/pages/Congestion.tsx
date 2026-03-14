import { useState, useMemo, useEffect } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';
import SeriesSelector from '../components/SeriesSelector';

const DATASETS = [
  'dam_limiting_constraints', 'rt_limiting_constraints',
  'sc_line_outages', 'rt_line_outages', 'out_sched', 'outage_schedule',
];

export default function Congestion() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);
  const [selectedConstraints, setSelectedConstraints] = useState<string[]>([]);

  const { data: daConstraints, loading, error } = useDataset('dam_limiting_constraints', resolution);

  const { allConstraintNames, kpis, topConstraints, chartData } = useMemo(() => {
    const records = daConstraints?.data || [];
    if (!records.length) return { allConstraintNames: [], kpis: {} as any, topConstraints: [], chartData: [] };

    const costCol = records[0]?.['Constraint Cost'] !== undefined ? 'Constraint Cost' : 'ShadowPrice';
    const nameCol = records[0]?.['Limiting Facility'] !== undefined ? 'Limiting Facility' : 'Constraint';

    const costs = records.map((r: any) => Number(r[costCol] || 0)).filter((v: number) => v !== 0);
    const totalCost = costs.reduce((a: number, b: number) => a + Math.abs(b), 0);
    const maxCost = costs.length ? Math.max(...costs.map(Math.abs)) : 0;
    const avgCost = costs.length ? totalCost / costs.length : 0;

    const byConstraint: Record<string, { total: number; count: number; max: number; name: string }> = {};
    for (const r of records) {
      const name = String(r[nameCol] || 'Unknown');
      const cost = Math.abs(Number(r[costCol] || 0));
      if (!byConstraint[name]) byConstraint[name] = { total: 0, count: 0, max: 0, name };
      byConstraint[name].total += cost;
      byConstraint[name].count++;
      byConstraint[name].max = Math.max(byConstraint[name].max, cost);
    }

    const allSorted = Object.values(byConstraint)
      .sort((a, b) => b.total - a.total);

    const topConstraints = allSorted
      .map((c, i) => ({ rank: i + 1, ...c, avg: c.total / c.count }));

    const allConstraintNames = allSorted.map(c => c.name);
    const active = selectedConstraints.length > 0 ? selectedConstraints : allConstraintNames.slice(0, 8);

    const pivoted: Record<string, any> = {};
    for (const r of records) {
      const name = String(r[nameCol] || '');
      if (!active.includes(name)) continue;
      const dateKey = r.Date || r['Time Stamp'] || '';
      const key = `${dateKey}_${r.HE || ''}`;
      if (!pivoted[key]) pivoted[key] = { Date: dateKey, HE: r.HE };
      pivoted[key][name] = Number(r[costCol] || 0);
    }
    const chartData = Object.values(pivoted).sort((a: any, b: any) => a.Date < b.Date ? -1 : 1);

    if (typeof console !== 'undefined') {
      console.log(`[Congestion] Constraints available: ${allConstraintNames.length}, displayed: ${active.length}, records: ${records.length}`);
    }

    return {
      allConstraintNames,
      kpis: { totalCost, maxCost, avgCost, bindingCount: allConstraintNames.length },
      topConstraints,
      chartData: chartData.length > 1 ? chartData : [],
    };
  }, [daConstraints, selectedConstraints]);

  useEffect(() => {
    if (allConstraintNames.length > 0 && selectedConstraints.length === 0) {
      setSelectedConstraints(allConstraintNames.slice(0, 8));
    }
  }, [allConstraintNames]);

  const activeForChart = selectedConstraints.length > 0 ? selectedConstraints.filter(c => allConstraintNames.includes(c)) : allConstraintNames.slice(0, 8);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Congestion Analysis</h1>
        <p className="page-subtitle">
          Binding constraints, shadow prices, and outage schedules driving transmission congestion
        </p>
      </div>

      <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <ResolutionSelector value={resolution} onChange={setResolution} />
        {allConstraintNames.length > 0 && (
          <SeriesSelector
            label="Constraints"
            allSeries={allConstraintNames}
            selected={selectedConstraints}
            onChange={setSelectedConstraints}
          />
        )}
      </div>

      {error && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load congestion data: {error}</div>
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> Loading congestion data...</div>}

      {!loading && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi-card">
              <div className="kpi-label">Total Constraint Cost</div>
              <div className="kpi-value">
                {kpis.totalCost ? <>${kpis.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</> : '—'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Max Single Cost</div>
              <div className="kpi-value">
                {kpis.maxCost ? <>${kpis.maxCost.toFixed(2)}</> : '—'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Avg Constraint Cost</div>
              <div className="kpi-value">
                {kpis.avgCost ? <>${kpis.avgCost.toFixed(2)}</> : '—'}
              </div>
            </div>
            <div className="kpi-card accent">
              <div className="kpi-label">Binding Constraints</div>
              <div className="kpi-value">{kpis.bindingCount || '—'}</div>
            </div>
          </div>

          {chartData.length > 0 && (
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Constraint Costs Over Time</div>
                <span className="badge badge-primary">{resolution} · {activeForChart.length} of {allConstraintNames.length} constraints</span>
              </div>
              <LineChart
                data={chartData}
                xKey="Date"
                yKeys={activeForChart}
                height={320}
              />
            </div>
          )}

          {topConstraints.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div className="chart-card-title">All Binding Constraints ({topConstraints.length})</div>
              </div>
              <table className="rank-table" style={{ borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Constraint</th>
                    <th>Total Cost</th>
                    <th>Avg Cost</th>
                    <th>Max Cost</th>
                    <th>Bindings</th>
                  </tr>
                </thead>
                <tbody>
                  {topConstraints.map(c => (
                    <tr key={c.name}>
                      <td><span className="rank-num">{c.rank}</span></td>
                      <td style={{ fontWeight: 600, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>${c.total.toFixed(2)}</td>
                      <td>${c.avg.toFixed(2)}</td>
                      <td>${c.max.toFixed(2)}</td>
                      <td>{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {topConstraints.length > 0 && (
            <div className="insight-card">
              <div className="insight-title">Congestion Summary</div>
              <div className="insight-body">
                <strong>{kpis.bindingCount} constraints</strong> were binding during this period.
                The most expensive constraint was <strong>{topConstraints[0].name}</strong> with total cost of <strong>${topConstraints[0].total.toFixed(2)}</strong>.
                {topConstraints[0].max > 100 && <> Peak costs reached <strong>${topConstraints[0].max.toFixed(2)}</strong>, indicating significant transmission pressure.</>}
              </div>
            </div>
          )}

          <div className="section-container">
            <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
              <span className="chevron">{showRaw ? '▾' : '▸'}</span>
              All Congestion Datasets ({DATASETS.length})
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
