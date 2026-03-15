import { useState, useMemo, useEffect, useCallback } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';
import SeriesSelector from '../components/SeriesSelector';

const DATASETS = [
  'dam_limiting_constraints', 'rt_limiting_constraints',
  'sc_line_outages', 'rt_line_outages', 'out_sched', 'outage_schedule',
];

interface ConstraintImpactData {
  market: string;
  date: string;
  he: number | null;
  facility: string | null;
  contingency: string | null;
  constraint_summary: {
    facility: string;
    contingency: string;
    date: string;
    he: number | null;
    total_cost: number;
    avg_cost: number;
    max_cost: number;
    min_cost: number;
    binding_count: number;
    unique_hours: number;
    unique_dates: number;
  } | null;
  zonal_impact: Array<{
    Zone: string;
    LMP: number;
    MLC: number;
    MCC: number;
    delta_vs_system: number;
    interpretation: string;
  }>;
  generator_impact: Array<{
    Generator: string;
    PTID: number;
    Zone: string;
    LMP: number;
    MLC: number;
    MCC: number;
  }>;
  available_dates: string[];
  available_hes: number[];
  facilities: string[];
  contingencies: string[];
  status: string;
}

function ConstraintImpactAnalysis() {
  const [market, setMarket] = useState<'DA' | 'RT'>('DA');
  const [date, setDate] = useState('');
  const [he, setHe] = useState<number | ''>('');
  const [facility, setFacility] = useState('');
  const [contingency, setContingency] = useState('');
  const [data, setData] = useState<ConstraintImpactData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchImpact = useCallback(async (resetDate?: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ market });
      const d = resetDate ? '' : date;
      if (d) params.set('date', d);
      if (he !== '') params.set('he', String(he));
      if (facility) params.set('facility', facility);
      if (contingency) params.set('contingency', contingency);
      const res = await fetch(`/api/constraint-impact?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      if (json.date && !d) setDate(json.date);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market, date, he, facility, contingency]);

  useEffect(() => { fetchImpact(); }, []);

  function handleMarketChange(m: 'DA' | 'RT') {
    if (m === market) return;
    setDate('');
    setHe('');
    setFacility('');
    setContingency('');
    setData(null);
    setMarket(m);
  }

  function handleDateChange(d: string) {
    setDate(d);
    setFacility('');
    setContingency('');
  }

  function handleHeChange(h: number | '') {
    setHe(h);
    setFacility('');
    setContingency('');
  }

  function handleFacilityChange(f: string) {
    setFacility(f);
    setContingency('');
  }

  useEffect(() => { fetchImpact(true); }, [market]);
  useEffect(() => {
    if (date) fetchImpact();
  }, [date, he, facility, contingency]);

  const summary = data?.constraint_summary;
  const zonal = data?.zonal_impact || [];
  const gens = data?.generator_impact || [];

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-title" style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        Constraint Impact Analysis
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        Isolate a specific constraint event and analyze its zonal and generator-level market impact
      </p>

      <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="pill-group">
          <span className="pill-label">MARKET:</span>
          {(['DA', 'RT'] as const).map(m => (
            <button key={m} className={`pill${market === m ? ' active' : ''}`} onClick={() => handleMarketChange(m)}>
              {m === 'DA' ? 'Day Ahead' : 'Real Time'}
            </button>
          ))}
        </div>
        {data && data.available_dates.length > 0 && (
          <select className="gen-map-select" value={date} onChange={e => handleDateChange(e.target.value)}>
            {data.available_dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {data && data.available_hes.length > 0 && (
          <select className="gen-map-select" value={he} onChange={e => handleHeChange(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">All Hours</option>
            {data.available_hes.map(h => <option key={h} value={h}>HE {h}</option>)}
          </select>
        )}
        {data && data.facilities.length > 0 && (
          <select
            className="gen-map-select"
            value={facility}
            onChange={e => handleFacilityChange(e.target.value)}
            style={{ maxWidth: 260 }}
          >
            <option value="">All Facilities</option>
            {data.facilities.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {data && data.contingencies.length > 0 && (
          <select
            className="gen-map-select"
            value={contingency}
            onChange={e => setContingency(e.target.value)}
            style={{ maxWidth: 260 }}
          >
            <option value="">All Contingencies</option>
            {data.contingencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {loading && <div className="loading"><div className="spinner" /> Analyzing constraint impact...</div>}

      {!loading && summary && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
            <div className="kpi-card accent">
              <div className="kpi-label">Total Constraint Cost</div>
              <div className="kpi-value">${summary.total_cost.toLocaleString()}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Avg Cost</div>
              <div className="kpi-value">${summary.avg_cost.toFixed(2)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Max Cost</div>
              <div className="kpi-value" style={{ color: summary.max_cost > 100 ? 'var(--danger)' : 'var(--text)' }}>
                ${summary.max_cost.toFixed(2)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Bindings</div>
              <div className="kpi-value">{summary.binding_count}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Hours Active</div>
              <div className="kpi-value">{summary.unique_hours}</div>
            </div>
          </div>

          {summary.facility !== 'All' && (
            <div className="insight-card" style={{ marginBottom: 16 }}>
              <div className="insight-title">Selected Constraint</div>
              <div className="insight-body">
                <strong>Facility:</strong> {summary.facility}
                {summary.contingency !== 'All' && <> | <strong>Contingency:</strong> {summary.contingency}</>}
                {' '}| <strong>Date:</strong> {summary.date}
                {summary.he !== null ? ` HE ${summary.he}` : ` (${summary.unique_hours} hours)`}
                {' '}| <strong>Cost range:</strong> ${summary.min_cost.toFixed(2)} – ${summary.max_cost.toFixed(2)}
              </div>
            </div>
          )}

          {zonal.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="chart-card-header" style={{ padding: '14px 20px' }}>
                  <div className="chart-card-title">Zonal Congestion Impact</div>
                  <span className="badge badge-primary">{zonal.length} zones · ranked by |MCC|</span>
                </div>
                <table className="rank-table" style={{ borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>Zone</th>
                      <th>LMP</th>
                      <th>MCC</th>
                      <th>MLC</th>
                      <th>vs System Avg</th>
                      <th>Interpretation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zonal.map((z, i) => (
                      <tr key={z.Zone}>
                        <td><span className="rank-num">{i + 1}</span></td>
                        <td style={{ fontWeight: 600 }}>{z.Zone}</td>
                        <td>${z.LMP.toFixed(2)}</td>
                        <td style={{
                          fontWeight: 700,
                          color: Math.abs(z.MCC) > 2 ? (z.MCC > 0 ? 'var(--danger)' : 'var(--accent)') : 'var(--text)'
                        }}>
                          ${z.MCC.toFixed(2)}
                        </td>
                        <td>${z.MLC.toFixed(2)}</td>
                        <td style={{ color: z.delta_vs_system > 0 ? 'var(--danger)' : 'var(--accent)' }}>
                          {z.delta_vs_system > 0 ? '+' : ''}{z.delta_vs_system.toFixed(2)}
                        </td>
                        <td>
                          <span className={`cia-tag ${z.interpretation.startsWith('Bullish') ? 'cia-bullish' : z.interpretation.startsWith('Bearish') ? 'cia-bearish' : 'cia-neutral'}`}>
                            {z.interpretation.startsWith('Bullish') ? 'Bullish' : z.interpretation.startsWith('Bearish') ? 'Bearish' : 'Neutral'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {zonal.length > 0 && (
            <div className="insight-card" style={{ marginBottom: 16 }}>
              <div className="insight-title">Zonal Impact Interpretation</div>
              <div className="insight-body">
                {(() => {
                  const bearish = zonal.filter(z => z.MCC > 2);
                  const bullish = zonal.filter(z => z.MCC < -2);
                  const neutral = zonal.filter(z => Math.abs(z.MCC) <= 2);
                  return (
                    <>
                      {bearish.length > 0 && (
                        <><strong>{bearish.map(z => z.Zone).join(', ')}</strong> {bearish.length === 1 ? 'is' : 'are'} paying congestion costs (positive MCC), making prices higher than they would be without this constraint. </>
                      )}
                      {bullish.length > 0 && (
                        <><strong>{bullish.map(z => z.Zone).join(', ')}</strong> {bullish.length === 1 ? 'is' : 'are'} receiving congestion credits (negative MCC), benefiting from this constraint pattern. </>
                      )}
                      {neutral.length > 0 && (
                        <><strong>{neutral.length}</strong> zone{neutral.length > 1 ? 's' : ''} {neutral.length === 1 ? 'shows' : 'show'} minimal congestion impact (|MCC| &lt; $2).</>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {gens.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="chart-card-header" style={{ padding: '14px 20px' }}>
                  <div className="chart-card-title">Generator-Level Impact (Top 25)</div>
                  <span className="badge badge-primary">ranked by |MCC|</span>
                </div>
                <table className="rank-table" style={{ borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>Generator</th>
                      <th>PTID</th>
                      <th>Zone</th>
                      <th>LMP</th>
                      <th>MCC</th>
                      <th>MLC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gens.map((g, i) => (
                      <tr key={`${g.PTID}-${i}`}>
                        <td><span className="rank-num">{i + 1}</span></td>
                        <td style={{ fontWeight: 600, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.Generator}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{g.PTID}</td>
                        <td>{g.Zone || '—'}</td>
                        <td>${g.LMP?.toFixed(2) ?? '—'}</td>
                        <td style={{
                          fontWeight: 700,
                          color: Math.abs(g.MCC || 0) > 5 ? (g.MCC > 0 ? 'var(--danger)' : 'var(--accent)') : 'var(--text)'
                        }}>
                          ${g.MCC?.toFixed(2) ?? '—'}
                        </td>
                        <td>${g.MLC?.toFixed(2) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && data?.status === 'no_data' && (
        <div className="insight-card">
          <div className="insight-title">No Data</div>
          <div className="insight-body">
            No constraint bindings found for the selected filters.
            {data.available_dates.length > 0 && <> Available dates: {data.available_dates[0]} to {data.available_dates[data.available_dates.length - 1]}.</>}
          </div>
        </div>
      )}
    </div>
  );
}


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
            <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
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

          <ConstraintImpactAnalysis />

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
