import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';
import SeriesSelector from '../components/SeriesSelector';

const DATASETS = [
  'dam_limiting_constraints', 'rt_limiting_constraints',
  'sc_line_outages', 'rt_line_outages', 'out_sched', 'outage_schedule',
];

interface CleanPrint { date: string; he: number; }
interface MixedPrint { date: string; he: number; active_constraints: number; }

interface ConstraintImpactData {
  market: string;
  date: string;
  he: number | null;
  facility: string | null;
  contingency: string | null;
  clean_only: boolean;
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
    is_clean_print: boolean;
    clean_print_count: number;
    mixed_print_count: number;
  } | null;
  zonal_impact: Array<{
    Zone: string; LMP: number; MLC: number; MCC: number;
    delta_vs_system: number; interpretation: string;
  }>;
  generator_impact: Array<{
    Generator: string; PTID: number; Zone: string;
    LMP: number; MLC: number; MCC: number;
  }>;
  clean_prints: CleanPrint[];
  mixed_prints: MixedPrint[];
  congestion_pivot: Array<Record<string, any>>;
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
  const [cleanOnly, setCleanOnly] = useState(false);
  const [data, setData] = useState<ConstraintImpactData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPivot, setShowPivot] = useState(false);

  const fetchIdRef = useRef(0);

  const fetchImpact = useCallback(async (overrides?: { resetDate?: boolean }) => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ market });
      const d = overrides?.resetDate ? '' : date;
      if (d) params.set('date', d);
      if (he !== '') params.set('he', String(he));
      if (facility) params.set('facility', facility);
      if (contingency) params.set('contingency', contingency);
      if (cleanOnly) params.set('clean_only', 'true');
      const res = await fetch(`/api/constraint-impact?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (id !== fetchIdRef.current) return;
      setData(json);
      if (json.date && !d) setDate(json.date);
    } catch {
      if (id === fetchIdRef.current) setData(null);
    } finally {
      if (id === fetchIdRef.current) setLoading(false);
    }
  }, [market, date, he, facility, contingency, cleanOnly]);

  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized) { setInitialized(true); fetchImpact(); }
  }, [initialized]);

  function handleMarketChange(m: 'DA' | 'RT') {
    if (m === market) return;
    setDate(''); setHe(''); setFacility(''); setContingency('');
    setCleanOnly(false); setData(null); setMarket(m);
  }
  function handleDateChange(d: string) { setDate(d); setHe(''); setFacility(''); setContingency(''); setCleanOnly(false); }
  function handleFacilityChange(f: string) { setFacility(f); setContingency(''); setCleanOnly(false); setHe(''); }

  useEffect(() => { if (initialized) fetchImpact({ resetDate: true }); }, [market]);
  useEffect(() => { if (initialized && date) fetchImpact(); }, [date, he, facility, contingency, cleanOnly]);

  const summary = data?.constraint_summary;
  const zonal = data?.zonal_impact || [];
  const gens = data?.generator_impact || [];
  const cleanPrints = data?.clean_prints || [];
  const mixedPrints = data?.mixed_prints || [];
  const pivot = data?.congestion_pivot || [];
  const hasConstraintSelected = facility !== '' && contingency !== '';
  const hasCleanPrintData = cleanPrints.length > 0 || mixedPrints.length > 0;

  const pivotHours = useMemo(() => {
    if (!pivot.length) return [];
    const keys = Object.keys(pivot[0]).filter(k => k !== 'Date').sort((a, b) => Number(a) - Number(b));
    return keys;
  }, [pivot]);

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-title" style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        Constraint Impact Analysis
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        Isolate a specific constraint print and analyze its zonal and generator-level market impact.
        Select a monitored element and contingency to identify clean prints — hours where this is the only material binding constraint.
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
        {data && data.facilities.length > 0 && (
          <select className="gen-map-select" value={facility} onChange={e => handleFacilityChange(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Select Monitored Element</option>
            {data.facilities.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {data && data.contingencies.length > 0 && (
          <select className="gen-map-select" value={contingency} onChange={e => setContingency(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Select Contingency</option>
            {data.contingencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {data && data.available_hes.length > 0 && (
          <select className="gen-map-select" value={he} onChange={e => setHe(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">All Hours</option>
            {data.available_hes.map(h => (
              <option key={h} value={h}>
                HE {h}{hasConstraintSelected && cleanPrints.some(p => p.he === h) ? ' ★' : ''}
              </option>
            ))}
          </select>
        )}
        {hasConstraintSelected && hasCleanPrintData && (
          <label className="cia-toggle-label">
            <input type="checkbox" checked={cleanOnly} onChange={e => setCleanOnly(e.target.checked)} />
            <span>Clean prints only</span>
            <span className="cia-tag cia-clean" style={{ marginLeft: 4 }}>{cleanPrints.length}</span>
          </label>
        )}
      </div>

      {loading && <div className="loading"><div className="spinner" /> Analyzing constraint impact...</div>}

      {!loading && summary && (
        <>
          {hasConstraintSelected && (
            <div className="insight-card" style={{ marginBottom: 16, borderLeftColor: summary.is_clean_print ? 'var(--accent)' : 'var(--primary)' }}>
              <div className="insight-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Selected Print
                {summary.is_clean_print && <span className="cia-tag cia-clean">Clean Print</span>}
                {summary.he !== null && !summary.is_clean_print && hasCleanPrintData && <span className="cia-tag cia-mixed">Mixed Print</span>}
              </div>
              <div className="insight-body">
                <strong>Monitored Element:</strong> {summary.facility}
                {summary.contingency !== 'All' && <> | <strong>Contingency:</strong> {summary.contingency}</>}
                {' '}| <strong>Market:</strong> {market === 'DA' ? 'Day Ahead' : 'Real Time'}
                {' '}| <strong>Date:</strong> {summary.date}
                {summary.he !== null ? <> | <strong>HE:</strong> {summary.he}</> : <> | <strong>Hours:</strong> {summary.unique_hours}</>}
                {' '}| <strong>Cost range:</strong> ${summary.min_cost.toFixed(2)} – ${summary.max_cost.toFixed(2)}
                {hasCleanPrintData && (
                  <> | <strong>Print analysis:</strong> {summary.clean_print_count} clean / {summary.mixed_print_count} mixed of {summary.clean_print_count + summary.mixed_print_count} total prints</>
                )}
              </div>
            </div>
          )}

          <div className="kpi-grid" style={{ gridTemplateColumns: hasConstraintSelected ? 'repeat(6, 1fr)' : 'repeat(5, 1fr)', marginBottom: 16 }}>
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
            {hasConstraintSelected && (
              <div className="kpi-card">
                <div className="kpi-label">Clean Prints</div>
                <div className="kpi-value" style={{ color: summary.clean_print_count > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {summary.clean_print_count} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {summary.clean_print_count + summary.mixed_print_count}</span>
                </div>
              </div>
            )}
          </div>

          {hasConstraintSelected && cleanPrints.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="chart-card-header" style={{ padding: '14px 20px' }}>
                  <div className="chart-card-title">Clean Print Hours</div>
                  <span className="badge badge-primary">{cleanPrints.length} isolated prints — only this constraint binding</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 20px 16px' }}>
                  {cleanPrints.map(p => (
                    <button
                      key={`${p.date}-${p.he}`}
                      className={`cia-print-btn${he === p.he ? ' active' : ''}`}
                      onClick={() => setHe(p.he)}
                    >
                      HE {p.he}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {pivot.length > 0 && hasConstraintSelected && (
            <div style={{ marginBottom: 16 }}>
              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="chart-card-header" style={{ padding: '14px 20px', cursor: 'pointer' }} onClick={() => setShowPivot(!showPivot)}>
                  <div className="chart-card-title">
                    <span className="chevron">{showPivot ? '▾' : '▸'}</span>{' '}
                    Congestion Pivot — Hourly Cost Pattern
                  </div>
                  <span className="badge badge-primary">{pivot.length} dates × {pivotHours.length} hours</span>
                </div>
                {showPivot && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="rank-table" style={{ borderSpacing: 0, fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>Date</th>
                          {pivotHours.map(h => (
                            <th key={h} style={{ minWidth: 50, textAlign: 'center' }}>
                              {h}{cleanPrints.some(p => String(p.he) === h) ? ' ★' : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pivot.map((row: any) => (
                          <tr key={row.Date}>
                            <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1 }}>{row.Date}</td>
                            {pivotHours.map(h => {
                              const val = Number(row[h] || 0);
                              const isClean = cleanPrints.some(p => p.date === row.Date && String(p.he) === h);
                              return (
                                <td
                                  key={h}
                                  style={{
                                    textAlign: 'center',
                                    fontWeight: val !== 0 ? 600 : 400,
                                    color: val === 0 ? 'var(--text-muted)' : val > 50 ? 'var(--danger)' : 'var(--text)',
                                    background: isClean ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                                    cursor: 'pointer',
                                  }}
                                  onClick={() => { if (val !== 0) setHe(Number(h)); }}
                                >
                                  {val === 0 ? '·' : val.toFixed(1)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {zonal.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="chart-card-header" style={{ padding: '14px 20px' }}>
                  <div className="chart-card-title">Zonal Congestion Impact</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {summary?.is_clean_print && <span className="cia-tag cia-clean">Isolated print — high attribution</span>}
                    <span className="badge badge-primary">{zonal.length} zones · ranked by |MCC|</span>
                  </div>
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
                        <td style={{ fontWeight: 700, color: Math.abs(z.MCC) > 2 ? (z.MCC > 0 ? 'var(--danger)' : 'var(--accent)') : 'var(--text)' }}>
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
                {summary?.is_clean_print && (
                  <><strong>High-confidence analysis:</strong> This is a clean print — only this constraint was materially binding at this hour, so MCC values are directly attributable. </>
                )}
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
                        <td style={{ fontWeight: 700, color: Math.abs(g.MCC || 0) > 5 ? (g.MCC > 0 ? 'var(--danger)' : 'var(--accent)') : 'var(--text)' }}>
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

      {!loading && !summary && data?.status !== 'no_data' && !data && null}

      {!loading && data?.status === 'no_data' && (
        <div className="insight-card">
          <div className="insight-title">No Data</div>
          <div className="insight-body">
            No constraint bindings found for the selected filters.
            {cleanOnly && <> Try disabling the "Clean prints only" filter. </>}
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
