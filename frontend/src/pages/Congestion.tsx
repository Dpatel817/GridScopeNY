import { useState, useMemo, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
import { useDataset } from '../hooks/useDataset';
import DatasetSection from '../components/DatasetSection';
import PriceChart from '../components/PriceChart';
import type { CongestionRow, ConstraintStat, ChartType, Resolution, DateRange } from '../data/congestionTransforms';
import {
  detectColumns, getAvailableDates,
  filterByDateRange, pivotCongestion, computeConstraintStats,
} from '../data/congestionTransforms';
import { computeCongestionKPIs } from '../data/congestionMetrics';
import type { CongestionKPIs } from '../data/congestionMetrics';
import {
  buildCongestionSummaryContext, deterministicCongestionSummary,
  fetchAICongestionSummary,
} from '../data/congestionSummary';

const DATASETS = [
  'dam_limiting_constraints', 'rt_limiting_constraints',
  'sc_line_outages', 'rt_line_outages', 'out_sched', 'outage_schedule',
];

type MarketType = 'DA' | 'RT';

const MARKETS: { key: MarketType; label: string }[] = [
  { key: 'DA', label: 'DAM' },
  { key: 'RT', label: 'RTM' },
];

const RESOLUTIONS: { key: Resolution; label: string }[] = [
  { key: 'hourly', label: 'Hourly' },
  { key: 'on_peak', label: 'On-Peak Avg' },
  { key: 'off_peak', label: 'Off-Peak Avg' },
  { key: 'daily', label: 'Daily Avg' },
];

const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: 'line-markers', label: 'Line + Markers' },
  { key: 'line', label: 'Line' },
  { key: 'area', label: 'Stacked Area' },
  { key: 'bar', label: 'Stacked Bar' },
];

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Latest Day' },
  { key: 'custom', label: 'Custom Range' },
  { key: 'all', label: 'All Dates' },
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
  const [searchTerm, setSearchTerm] = useState('');
  const [data, setData] = useState<ConstraintImpactData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPivot, setShowPivot] = useState(false);
  const [showZonal, setShowZonal] = useState(false);
  const [showGens, setShowGens] = useState(false);
  const [showFacilityDropdown, setShowFacilityDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const fetchIdRef = useRef(0);

  const fetchImpact = useCallback(async (params: {
    market: string; facility?: string; contingency?: string;
    date?: string; he?: number | ''; cleanOnly?: boolean; search?: string;
  }) => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ market: params.market });
      if (params.facility) qs.set('facility', params.facility);
      if (params.contingency) qs.set('contingency', params.contingency);
      if (params.date) qs.set('date', params.date);
      if (params.he !== undefined && params.he !== '') qs.set('he', String(params.he));
      if (params.cleanOnly) qs.set('clean_only', 'true');
      if (params.search) qs.set('search', params.search);
      const res = await fetch(`/api/constraint-impact?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (id !== fetchIdRef.current) return;
      setData(json);
      if (json.date && !params.date) setDate(json.date);
    } catch {
      if (id === fetchIdRef.current) setData(null);
    } finally {
      if (id === fetchIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImpact({ market });
  }, [market]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowFacilityDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleMarketChange(m: 'DA' | 'RT') {
    if (m === market) return;
    setMarket(m);
    setFacility(''); setContingency(''); setDate(''); setHe('');
    setCleanOnly(false); setData(null); setSearchTerm('');
  }

  function handleFacilitySelect(f: string) {
    setFacility(f);
    setContingency(''); setDate(''); setHe(''); setCleanOnly(false);
    setShowFacilityDropdown(false);
    setSearchTerm(f);
    fetchImpact({ market, facility: f });
  }

  function handleContingencySelect(c: string) {
    setContingency(c);
    setDate(''); setHe(''); setCleanOnly(false);
    fetchImpact({ market, facility, contingency: c });
  }

  function handleDateChange(d: string) {
    setDate(d); setHe(''); setCleanOnly(false);
    fetchImpact({ market, facility, contingency, date: d });
  }

  function handleHeChange(h: number | '') {
    setHe(h); setCleanOnly(false);
    fetchImpact({ market, facility, contingency, date, he: h });
  }

  function handleCleanOnlyChange(v: boolean) {
    setCleanOnly(v);
    fetchImpact({ market, facility, contingency, date, he, cleanOnly: v });
  }

  function handleSearchChange(val: string) {
    setSearchTerm(val);
    setShowFacilityDropdown(true);
    if (facility) {
      setFacility(''); setContingency(''); setDate(''); setHe(''); setCleanOnly(false);
    }
    fetchImpact({ market, search: val });
  }

  function clearSelections() {
    setFacility(''); setContingency(''); setDate(''); setHe('');
    setCleanOnly(false); setSearchTerm('');
    fetchImpact({ market });
  }

  const filteredFacilities = data?.facilities || [];
  const contingencies = data?.contingencies || [];
  const availableDates = data?.available_dates || [];
  const availableHes = data?.available_hes || [];

  const summary = data?.constraint_summary;
  const zonal = data?.zonal_impact || [];
  const gens = data?.generator_impact || [];
  const cleanPrints = data?.clean_prints || [];
  const mixedPrints = data?.mixed_prints || [];
  const pivot = data?.congestion_pivot || [];
  const hasCleanPrintData = cleanPrints.length > 0 || mixedPrints.length > 0;
  const hasFullSelection = facility !== '' && contingency !== '' && date !== '';

  const stepNumber = !facility ? 1 : !contingency ? 2 : !date ? 3 : 4;

  const pivotHours = useMemo(() => {
    if (!pivot.length) return [];
    return Object.keys(pivot[0]).filter(k => k !== 'Date' && k !== '_ts').sort((a, b) => Number(a) - Number(b));
  }, [pivot]);

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-title" style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        Constraint Impact Analysis
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        Drill down into a specific constraint to analyze its zonal and generator-level market impact.
      </p>

      <div className="chart-card" style={{ padding: '20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>

          <div style={{ flex: '0 0 auto' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Step 1 · Market
            </div>
            <div className="pill-group" style={{ margin: 0 }}>
              {(['DA', 'RT'] as const).map(m => (
                <button key={m} className={`pill${market === m ? ' active' : ''}`} onClick={() => handleMarketChange(m)}>
                  {m === 'DA' ? 'Day Ahead' : 'Real Time'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: '1 1 260px', minWidth: 200 }} ref={searchRef}>
            <div style={{ fontSize: 11, fontWeight: 700, color: stepNumber >= 1 ? 'var(--text-muted)' : 'var(--border)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Step 2 · Search Constraint
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="pcc-date"
                placeholder="Type to search constraints..."
                value={searchTerm}
                onChange={e => handleSearchChange(e.target.value)}
                onFocus={() => setShowFacilityDropdown(true)}
                style={{ width: '100%', fontSize: 13, padding: '8px 12px' }}
              />
              {facility && (
                <button
                  onClick={clearSelections}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)', padding: '2px 4px' }}
                >
                  ✕
                </button>
              )}
              {showFacilityDropdown && !facility && filteredFacilities.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 240,
                  overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100,
                }}>
                  {filteredFacilities.slice(0, 50).map(f => (
                    <div
                      key={f}
                      onClick={() => handleFacilitySelect(f)}
                      style={{
                        padding: '8px 14px', cursor: 'pointer', fontSize: 12,
                        borderBottom: '1px solid var(--border)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {f}
                    </div>
                  ))}
                  {filteredFacilities.length > 50 && (
                    <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                      {filteredFacilities.length - 50} more — refine search
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {facility && (
            <div style={{ flex: '0 0 auto', minWidth: 200 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Step 3 · Contingency
              </div>
              {contingencies.length > 0 ? (
                <select className="gen-map-select" value={contingency} onChange={e => handleContingencySelect(e.target.value)} style={{ maxWidth: 280, fontSize: 13 }}>
                  <option value="">Select contingency...</option>
                  {contingencies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading...</span>
              )}
            </div>
          )}

          {facility && contingency && (
            <div style={{ flex: '0 0 auto', display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Step 4 · Timestamp
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {availableDates.length > 0 ? (
                    <select className="gen-map-select" value={date} onChange={e => handleDateChange(e.target.value)} style={{ fontSize: 13 }}>
                      {availableDates.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No dates</span>
                  )}
                  {date && availableHes.length > 0 && (
                    <select className="gen-map-select" value={he} onChange={e => handleHeChange(e.target.value === '' ? '' : Number(e.target.value))} style={{ fontSize: 13 }}>
                      <option value="">All Hours</option>
                      {availableHes.map(h => (
                        <option key={h} value={h}>
                          HE {h}{cleanPrints.some(p => p.he === h) ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {facility && contingency && date && hasCleanPrintData && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <label className="cia-toggle-label" style={{ margin: 0 }}>
              <input type="checkbox" checked={cleanOnly} onChange={e => handleCleanOnlyChange(e.target.checked)} />
              <span>Clean prints only</span>
              <span className="cia-tag cia-clean" style={{ marginLeft: 4 }}>{cleanPrints.length}</span>
            </label>
          </div>
        )}

        {!facility && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            Search and select a constraint above to begin analysis. {filteredFacilities.length > 0 && <>{filteredFacilities.length} constraints available.</>}
          </div>
        )}
        {facility && !contingency && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            Select a contingency for <strong>{facility}</strong> to continue. {contingencies.length} contingencies available.
          </div>
        )}
      </div>

      {loading && <div className="loading"><div className="spinner" /> Analyzing constraint impact...</div>}

      {!loading && hasFullSelection && summary && (
        <>
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

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: 16 }}>
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
            <div className="kpi-card">
              <div className="kpi-label">Clean Prints</div>
              <div className="kpi-value" style={{ color: summary.clean_print_count > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                {summary.clean_print_count} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {summary.clean_print_count + summary.mixed_print_count}</span>
              </div>
            </div>
          </div>

          {cleanPrints.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="chart-card-header" style={{ padding: '14px 20px' }}>
                  <div className="chart-card-title">Clean Print Hours</div>
                  <span className="badge badge-primary">{cleanPrints.length} isolated prints</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 20px 16px' }}>
                  {cleanPrints.map(p => (
                    <button
                      key={`${p.date}-${p.he}`}
                      className={`cia-print-btn${he === p.he ? ' active' : ''}`}
                      onClick={() => handleHeChange(p.he)}
                    >
                      HE {p.he}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {pivot.length > 0 && (
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
                                  onClick={() => { if (val !== 0) handleHeChange(Number(h)); }}
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
                <div
                  className="chart-card-header"
                  style={{ padding: '14px 20px', cursor: 'pointer' }}
                  onClick={() => setShowZonal(!showZonal)}
                >
                  <div className="chart-card-title">
                    <span className="chevron">{showZonal ? '▾' : '▸'}</span>{' '}
                    Zonal Impact Analysis
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {summary?.is_clean_print && <span className="cia-tag cia-clean">Isolated print</span>}
                    <span className="badge badge-primary">{zonal.length} zones · ranked by |MCC|</span>
                  </div>
                </div>
                {showZonal && (
                  <>
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
                    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {summary?.is_clean_print && (
                        <><strong>High-confidence analysis:</strong> This is a clean print — only this constraint was materially binding, so MCC values are directly attributable. </>
                      )}
                      {(() => {
                        const bearish = zonal.filter(z => z.MCC > 2);
                        const bullish = zonal.filter(z => z.MCC < -2);
                        const neutral = zonal.filter(z => Math.abs(z.MCC) <= 2);
                        return (
                          <>
                            {bearish.length > 0 && (
                              <><strong>{bearish.map(z => z.Zone).join(', ')}</strong> paying congestion costs (positive MCC). </>
                            )}
                            {bullish.length > 0 && (
                              <><strong>{bullish.map(z => z.Zone).join(', ')}</strong> receiving congestion credits (negative MCC). </>
                            )}
                            {neutral.length > 0 && (
                              <><strong>{neutral.length}</strong> zone{neutral.length > 1 ? 's' : ''} with minimal impact (|MCC| &lt; $2).</>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {gens.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  className="chart-card-header"
                  style={{ padding: '14px 20px', cursor: 'pointer' }}
                  onClick={() => setShowGens(!showGens)}
                >
                  <div className="chart-card-title">
                    <span className="chevron">{showGens ? '▾' : '▸'}</span>{' '}
                    Generator-Level Impact Analysis
                  </div>
                  <span className="badge badge-primary">{gens.length} generators · ranked by |MCC|</span>
                </div>
                {showGens && (
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
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && data?.status === 'no_data' && hasFullSelection && (
        <div className="insight-card">
          <div className="insight-title">No Data</div>
          <div className="insight-body">
            No constraint bindings found for the selected filters.
            {cleanOnly && <> Try disabling the "Clean prints only" filter. </>}
          </div>
        </div>
      )}
    </div>
  );
}

interface OutageRow {
  PTID?: number;
  'Outage ID'?: string;
  'Equipment Name'?: string;
  'Equipment Type'?: string;
  'Date Out'?: string;
  'Time Out'?: string;
  'Date In'?: string;
  'Time In'?: string;
  'Called In'?: string;
  Status?: string;
  'Status Date'?: string;
  Message?: string;
  [key: string]: any;
}

function parseOutageDate(val: string | undefined): Date | null {
  if (!val) return null;
  const parts = val.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function fmtDate(val: string | undefined): string {
  if (!val) return '—';
  const d = parseOutageDate(val);
  if (!d) return val;
  return d.toISOString().slice(0, 10);
}

function OutageScheduleSection() {
  const { data: outageData, loading } = useDataset('outage_schedule', 'daily', undefined, undefined, 20000, 730);
  const [expanded, setExpanded] = useState(true);
  const [dateOutBefore, setDateOutBefore] = useState('');
  const [dateInAfter, setDateInAfter] = useState('');
  const [equipFilter, setEquipFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const allRows: OutageRow[] = useMemo(
    () => (outageData?.data || []) as OutageRow[],
    [outageData]
  );

  useEffect(() => {
    if (!dateInAfter) {
      const today = new Date().toISOString().slice(0, 10);
      setDateInAfter(today);
    }
  }, []);

  const statuses = useMemo(() => {
    const s = new Set<string>();
    for (const r of allRows) {
      if (r.Status) s.add(r.Status);
    }
    return [...s].sort();
  }, [allRows]);

  const filtered = useMemo(() => {
    let result = allRows;

    if (dateOutBefore) {
      const cutoff = new Date(dateOutBefore);
      result = result.filter(r => {
        const d = parseOutageDate(r['Date Out']);
        return d ? d <= cutoff : false;
      });
    }

    if (dateInAfter) {
      const cutoff = new Date(dateInAfter);
      result = result.filter(r => {
        const d = parseOutageDate(r['Date In']);
        return d ? d >= cutoff : false;
      });
    }

    if (equipFilter) {
      const q = equipFilter.toLowerCase();
      result = result.filter(r =>
        (r['Equipment Name'] || '').toLowerCase().includes(q) ||
        (r['Equipment Type'] || '').toLowerCase().includes(q)
      );
    }

    if (statusFilter) {
      result = result.filter(r => r.Status === statusFilter);
    }

    return result;
  }, [allRows, dateOutBefore, dateInAfter, equipFilter, statusFilter]);

  useEffect(() => { setPage(0); }, [filtered.length]);

  const paged = useMemo(() =>
    filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <div className="section-container" style={{ marginTop: 24 }}>
      <div className="collapsible-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        Outage Schedule
        <span className="badge badge-primary" style={{ marginLeft: 8 }}>{filtered.length} outages</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {loading && (
            <div className="loading"><div className="spinner" /> Loading outage data...</div>
          )}

          {!loading && allRows.length === 0 && (
            <div className="insight-card">
              <div className="insight-body">No outage schedule data available.</div>
            </div>
          )}

          {!loading && allRows.length > 0 && (
            <>
              <div className="filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
                <div className="filter-group">
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Date Out Before
                  </label>
                  <input
                    type="date"
                    className="pcc-date"
                    value={dateOutBefore}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setDateOutBefore(e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Date In After
                  </label>
                  <input
                    type="date"
                    className="pcc-date"
                    value={dateInAfter}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setDateInAfter(e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Equipment
                  </label>
                  <input
                    type="text"
                    className="pcc-date"
                    placeholder="Search equipment..."
                    value={equipFilter}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEquipFilter(e.target.value)}
                    style={{ minWidth: 180 }}
                  />
                </div>
                <div className="filter-group">
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Status
                  </label>
                  <select
                    className="pcc-date"
                    value={statusFilter}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)}
                  >
                    <option value="">All Statuses</option>
                    {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {(dateOutBefore || dateInAfter || equipFilter || statusFilter) && (
                  <button
                    className="pcc-btn"
                    onClick={() => { setDateOutBefore(''); setDateInAfter(''); setEquipFilter(''); setStatusFilter(''); }}
                    style={{ fontSize: 12, padding: '6px 12px' }}
                  >
                    Clear Filters
                  </button>
                )}
              </div>

              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="rank-table" style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Equipment Name</th>
                        <th>Type</th>
                        <th>Date Out</th>
                        <th>Date In</th>
                        <th>Status</th>
                        <th>Called In</th>
                        <th>Outage ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((r, i) => (
                        <tr key={r['Outage ID'] || i}>
                          <td style={{ fontWeight: 600, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r['Equipment Name'] || '—'}
                          </td>
                          <td>{r['Equipment Type'] || '—'}</td>
                          <td>{fmtDate(r['Date Out'])}</td>
                          <td>{fmtDate(r['Date In'])}</td>
                          <td>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              background: (r.Status || '').includes('FORCED') ? 'var(--danger-bg, #fef2f2)' : 'var(--bg-secondary)',
                              color: (r.Status || '').includes('FORCED') ? 'var(--danger, #ef4444)' : 'var(--text-secondary)',
                            }}>
                              {r.Status || '—'}
                            </span>
                          </td>
                          <td>{r['Called In'] || '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r['Outage ID'] || '—'}</td>
                        </tr>
                      ))}
                      {paged.length === 0 && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No outages match filters</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="pcc-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                      <button className="pcc-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CongestionChartControls({
  constraints, selectedConstraints, onConstraintsChange,
  resolution, onResolutionChange,
  dateRange, onDateRangeChange,
  startDate, endDate, onStartDateChange, onEndDateChange, availableDates,
  chartType, onChartTypeChange,
}: {
  constraints: string[];
  selectedConstraints: string[];
  onConstraintsChange: (s: string[]) => void;
  resolution: Resolution;
  onResolutionChange: (r: Resolution) => void;
  dateRange: DateRange;
  onDateRangeChange: (r: DateRange) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  availableDates: string[];
  chartType: ChartType;
  onChartTypeChange: (t: ChartType) => void;
}) {
  const allSelected = selectedConstraints.length === constraints.length;
  return (
    <div className="pcc-panel">
      <div className="pcc-title">Chart Controls</div>

      <div className="pcc-section">
        <div className="pcc-label">Constraints</div>
        <div className="pcc-zone-actions">
          <button
            className={`pcc-mini-btn${allSelected ? ' active' : ''}`}
            onClick={() => onConstraintsChange(allSelected ? [] : [...constraints])}
          >
            {allSelected ? 'Clear' : 'All'}
          </button>
        </div>
        <div className="pcc-zone-grid">
          {constraints.map(s => (
            <label key={s} className="pcc-zone-item">
              <input
                type="checkbox"
                checked={selectedConstraints.includes(s)}
                onChange={() => {
                  onConstraintsChange(
                    selectedConstraints.includes(s)
                      ? selectedConstraints.filter(x => x !== s)
                      : [...selectedConstraints, s]
                  );
                }}
              />
              <span style={{ fontSize: 11 }}>{s.length > 30 ? s.slice(0, 28) + '…' : s}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Resolution</div>
        <div className="pcc-btn-group">
          {RESOLUTIONS.map(r => (
            <button key={r.key} className={`pcc-btn${resolution === r.key ? ' active' : ''}`} onClick={() => onResolutionChange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Date Range</div>
        <div className="pcc-btn-group">
          {DATE_RANGES.map(d => (
            <button key={d.key} className={`pcc-btn${dateRange === d.key ? ' active' : ''}`} onClick={() => onDateRangeChange(d.key)}>
              {d.label}
            </button>
          ))}
        </div>
        {dateRange === 'custom' && (
          <div className="pcc-date-inputs">
            <input
              type="date"
              className="pcc-date"
              value={startDate}
              min={availableDates.length > 0 ? availableDates[0] : undefined}
              max={availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined}
              onChange={e => onStartDateChange(e.target.value)}
            />
            <span className="pcc-date-sep">to</span>
            <input
              type="date"
              className="pcc-date"
              value={endDate}
              min={availableDates.length > 0 ? availableDates[0] : undefined}
              max={availableDates.length > 0 ? availableDates[availableDates.length - 1] : undefined}
              onChange={e => onEndDateChange(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="pcc-section">
        <div className="pcc-label">Chart Type</div>
        <div className="pcc-btn-group">
          {CHART_TYPES.map(t => (
            <button key={t.key} className={`pcc-btn${chartType === t.key ? ' active' : ''}`} onClick={() => onChartTypeChange(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Congestion() {
  const [marketType, setMarketType] = useState<MarketType>('DA');
  const [resolution, setResolution] = useState<Resolution>('hourly');
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedConstraints, setSelectedConstraints] = useState<string[]>([]);
  const [showBindingTable, setShowBindingTable] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiRequestedRef = useRef(false);

  const datasetKey = marketType === 'DA' ? 'dam_limiting_constraints' : 'rt_limiting_constraints';
  const { data: constraintData, loading, error } = useDataset(datasetKey, 'hourly', undefined, undefined, 50000, 90);

  const rows: CongestionRow[] = useMemo(
    () => (constraintData?.data || []) as CongestionRow[],
    [constraintData]
  );

  const handleMarketChange = useCallback((m: MarketType) => {
    if (m === marketType) return;
    setMarketType(m);
    setAiSummary('');
    aiRequestedRef.current = false;
  }, [marketType]);

  const { nameCol, costCol } = useMemo(() => detectColumns(rows), [rows]);
  const allConstraintNames = useMemo(() => {
    const stats = computeConstraintStats(rows, nameCol, costCol);
    return stats.map(s => s.name);
  }, [rows, nameCol, costCol]);

  const availableDates = useMemo(() => getAvailableDates(rows), [rows]);

  const handleDateRangeChange = (range: DateRange) => {
    setDateRange(range);
    if (range === 'custom' && (!startDate || !endDate) && availableDates.length > 0) {
      const end = availableDates[availableDates.length - 1];
      const startIdx = Math.max(0, availableDates.length - 7);
      const start = availableDates[startIdx];
      setStartDate(start);
      setEndDate(end);
    }
  };

  const initializedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading || allConstraintNames.length === 0) return;
    const currentKey = `${marketType}_${allConstraintNames.join(',')}`;
    if (initializedForRef.current === currentKey) return;
    initializedForRef.current = currentKey;
    setSelectedConstraints(allConstraintNames.slice(0, 8));
  }, [allConstraintNames, marketType, loading]);

  const latestDate = useMemo(() => {
    const dates = getAvailableDates(rows);
    return dates.length ? dates[dates.length - 1] : null;
  }, [rows]);

  const kpis: CongestionKPIs = useMemo(() => {
    if (!latestDate) return computeCongestionKPIs(rows, rows);
    const latest = rows.filter((r: any) => r.Date === latestDate);
    return computeCongestionKPIs(latest, rows);
  }, [rows, latestDate]);

  const fallbackSummary = useMemo(() => deterministicCongestionSummary(kpis), [kpis]);

  useEffect(() => {
    if (aiRequestedRef.current) return;
    if (loading || !rows.length) return;
    aiRequestedRef.current = true;
    setAiLoading(true);
    const marketLabel = marketType === 'DA' ? 'Day-Ahead Market (DAM)' : 'Real-Time Market (RTM)';
    const ctx = buildCongestionSummaryContext(kpis, `${marketLabel} · Latest available data`);
    fetchAICongestionSummary(ctx).then(s => {
      if (s) setAiSummary(s);
    }).finally(() => setAiLoading(false));
  }, [loading, rows.length, kpis, marketType]);

  const dateFiltered = useMemo(
    () => filterByDateRange(rows, dateRange, startDate, endDate),
    [rows, dateRange, startDate, endDate]
  );

  const chartData = useMemo(
    () => pivotCongestion(dateFiltered, selectedConstraints, nameCol, costCol, resolution),
    [dateFiltered, selectedConstraints, nameCol, costCol, resolution]
  );

  const constraintStats: ConstraintStat[] = useMemo(
    () => computeConstraintStats(dateFiltered, nameCol, costCol),
    [dateFiltered, nameCol, costCol]
  );

  const activeForChart = selectedConstraints.filter(c => allConstraintNames.includes(c));

  const displaySummary = aiSummary || fallbackSummary;

  const fmtCost = (v: number) => '$' + Math.round(Math.abs(v)).toLocaleString();

  return (
    <div className="page">
      <div className="page-header">
        <h1>Congestion Analysis</h1>
        <p className="page-subtitle">
          Binding constraints, shadow prices, and outage schedules driving transmission congestion
        </p>
      </div>

      <div className="resolution-bar" style={{ marginBottom: 12 }}>
        <label>Market:</label>
        {MARKETS.map(m => (
          <button
            key={m.key}
            className={`resolution-btn ${marketType === m.key ? 'active' : ''}`}
            onClick={() => handleMarketChange(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="price-summary-box">
        <div className="price-summary-header">
          <span className="price-summary-icon"></span>
          <span className="price-summary-title">Congestion Summary</span>
          {aiLoading && <span className="price-summary-badge loading">Generating AI summary...</span>}
          {!aiLoading && aiSummary && <span className="price-summary-badge ai">AI Enhanced</span>}
          {!aiLoading && !aiSummary && <span className="price-summary-badge">Deterministic</span>}
        </div>
        <div className="price-summary-body">{displaySummary}</div>
      </div>

      {error && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load congestion data: {error}</div>
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> Loading congestion data...</div>}

      {!loading && (
        <div className="kpi-grid price-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Total Cost</div>
            <div className="kpi-value">
              {kpis.onPeakTotalCost != null ? <>{fmtCost(kpis.onPeakTotalCost)}</> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">On-Peak Avg Cost</div>
            <div className="kpi-value">
              {kpis.onPeakAvgCost != null ? <>${kpis.onPeakAvgCost.toFixed(2)}</> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak Positive Cost</div>
            <div className="kpi-value">
              {kpis.peakPositive ? <>${kpis.peakPositive.value.toFixed(2)}</> : '—'}
            </div>
            {kpis.peakPositive && <div className="kpi-sub">{kpis.peakPositive.constraint.length > 25 ? kpis.peakPositive.constraint.slice(0, 23) + '…' : kpis.peakPositive.constraint} · {kpis.peakPositive.timestamp}</div>}
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Peak Negative Cost</div>
            <div className="kpi-value">
              {kpis.peakNegative ? (
                <span style={{ color: kpis.peakNegative.value < -50 ? 'var(--danger)' : 'var(--text)' }}>
                  ${kpis.peakNegative.value.toFixed(2)}
                </span>
              ) : '—'}
            </div>
            {kpis.peakNegative && <div className="kpi-sub">{kpis.peakNegative.constraint.length > 25 ? kpis.peakNegative.constraint.slice(0, 23) + '…' : kpis.peakNegative.constraint} · {kpis.peakNegative.timestamp}</div>}
          </div>
          <div className="kpi-card accent">
            <div className="kpi-label">Highest-Cost Constraint</div>
            <div className="kpi-value" style={{ fontSize: '0.85rem' }}>
              {kpis.highestCostConstraint
                ? (kpis.highestCostConstraint.length > 25
                  ? kpis.highestCostConstraint.slice(0, 23) + '…'
                  : kpis.highestCostConstraint)
                : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Avg Cost of Top</div>
            <div className="kpi-value">
              {kpis.avgCostTopConstraint != null ? <>${kpis.avgCostTopConstraint.toFixed(2)}</> : '—'}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Binding Constraints</div>
            <div className="kpi-value">{kpis.bindingCount || '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Top 3 Concentration</div>
            <div className="kpi-value">
              {kpis.top3Share != null ? <>{kpis.top3Share.toFixed(1)}<span className="kpi-unit">%</span></> : '—'}
            </div>
            {kpis.top3Share != null && <div className="kpi-sub">of total cost</div>}
          </div>
        </div>
      )}

      {!loading && (
        <div className="price-chart-layout">
          <CongestionChartControls
            constraints={allConstraintNames}
            selectedConstraints={selectedConstraints}
            onConstraintsChange={setSelectedConstraints}
            resolution={resolution}
            onResolutionChange={setResolution}
            dateRange={dateRange}
            onDateRangeChange={handleDateRangeChange}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            availableDates={availableDates}
            chartType={chartType}
            onChartTypeChange={setChartType}
          />

          <div className="price-chart-main">
            <div className="price-view-tabs">
              <span className="price-view-info">
                {marketType === 'DA' ? 'DAM' : 'RTM'}
                {' · '}{resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'}
                {' · '}{activeForChart.length}/{allConstraintNames.length} constraints
                {' · '}{dateRange === 'today' ? 'Latest Day' : dateRange === 'all' ? 'All Dates' : `${startDate} — ${endDate}`}
              </span>
            </div>

            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Constraint Costs Over Time</div>
                <span className="badge badge-primary">{chartData.length} points</span>
              </div>
              <PriceChart
                data={chartData}
                xKey="Date"
                yKeys={activeForChart}
                chartType={chartType}
                height={380}
                valuePrefix="$"
                valueSuffix=""
              />
            </div>
          </div>
        </div>
      )}

      {!loading && constraintStats.length > 0 && (
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            className="chart-card-header"
            style={{ padding: '14px 20px', cursor: 'pointer' }}
            onClick={() => setShowBindingTable(!showBindingTable)}
          >
            <div className="chart-card-title">
              <span className="chevron">{showBindingTable ? '▾' : '▸'}</span>{' '}
              Binding Constraints ({constraintStats.length})
            </div>
            <span className="badge badge-primary">ranked by total cost</span>
          </div>
          {showBindingTable && (
            <div style={{ overflowX: 'auto' }}>
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
                  {constraintStats.map(c => (
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
        </div>
      )}

      <ConstraintImpactAnalysis />

      <OutageScheduleSection />

      <div className="section-container">
        <div className="collapsible-header" onClick={() => setShowRaw(!showRaw)}>
          <span className="chevron">{showRaw ? '▾' : '▸'}</span>
          All Congestion Datasets ({DATASETS.length})
        </div>
        {showRaw && (
          <div style={{ marginTop: 8 }}>
            {DATASETS.map((key, i) => (
              <DatasetSection key={key} datasetKey={key} resolution="raw" defaultExpanded={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
