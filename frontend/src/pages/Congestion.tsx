import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
  const [data, setData] = useState<ConstraintImpactData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPivot, setShowPivot] = useState(false);
  const [showZonal, setShowZonal] = useState(false);
  const [showGens, setShowGens] = useState(false);

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
    return Object.keys(pivot[0]).filter(k => k !== 'Date').sort((a, b) => Number(a) - Number(b));
  }, [pivot]);

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-title" style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        Constraint Impact Analysis
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        Isolate a specific constraint print and analyze its zonal and generator-level market impact.
        Select a monitored element and contingency to identify clean prints.
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
                  <span className="badge badge-primary">{cleanPrints.length} isolated prints</span>
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
        {dateRange === 'custom' && availableDates.length > 0 && (
          <div className="pcc-date-inputs">
            <input type="date" className="pcc-date" value={startDate} min={availableDates[0]} max={availableDates[availableDates.length - 1]} onChange={e => onStartDateChange(e.target.value)} />
            <span className="pcc-date-sep">to</span>
            <input type="date" className="pcc-date" value={endDate} min={availableDates[0]} max={availableDates[availableDates.length - 1]} onChange={e => onEndDateChange(e.target.value)} />
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
  const aiRequestedRef = useState(() => ({ current: false }))[0];

  const { data: daConstraints, loading, error } = useDataset('dam_limiting_constraints', 'raw');

  const rows: CongestionRow[] = useMemo(
    () => (daConstraints?.data || []) as CongestionRow[],
    [daConstraints]
  );

  const { nameCol, costCol } = useMemo(() => detectColumns(rows), [rows]);
  const allConstraintNames = useMemo(() => {
    const stats = computeConstraintStats(rows, nameCol, costCol);
    return stats.map(s => s.name);
  }, [rows, nameCol, costCol]);

  const availableDates = useMemo(() => getAvailableDates(rows), [rows]);

  useEffect(() => {
    if (allConstraintNames.length > 0 && selectedConstraints.length === 0) {
      setSelectedConstraints(allConstraintNames.slice(0, 8));
    }
  }, [allConstraintNames]);

  useEffect(() => {
    if (availableDates.length > 0 && !startDate && !endDate) {
      setStartDate(availableDates[0]);
      setEndDate(availableDates[availableDates.length - 1]);
    }
  }, [availableDates]);

  const kpis: CongestionKPIs = useMemo(
    () => computeCongestionKPIs(rows),
    [rows]
  );

  const fallbackSummary = useMemo(() => deterministicCongestionSummary(kpis), [kpis]);

  useEffect(() => {
    if (aiRequestedRef.current) return;
    if (loading || !rows.length) return;
    aiRequestedRef.current = true;
    setAiLoading(true);
    const ctx = buildCongestionSummaryContext(kpis, 'Latest available data');
    fetchAICongestionSummary(ctx).then(s => {
      if (s) setAiSummary(s);
    }).finally(() => setAiLoading(false));
  }, [loading, rows.length, kpis]);

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

  const hasNegative = useMemo(() => {
    for (const row of chartData) {
      for (const key of Object.keys(row)) {
        if (key === 'Date') continue;
        if (Number(row[key]) < 0) return true;
      }
    }
    return false;
  }, [chartData]);

  const effectiveChartType: ChartType = chartType === 'area' && hasNegative ? 'line' : chartType;
  const stackWarning = chartType === 'area' && hasNegative;

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

      <div className="price-summary-box">
        <div className="price-summary-header">
          <span className="price-summary-icon">&#9889;</span>
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
            {kpis.peakPositive && <div className="kpi-sub">{kpis.peakPositive.constraint.length > 25 ? kpis.peakPositive.constraint.slice(0, 23) + '…' : kpis.peakPositive.constraint} · HE{kpis.peakPositive.he} · {kpis.peakPositive.date}</div>}
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
            {kpis.peakNegative && <div className="kpi-sub">{kpis.peakNegative.constraint.length > 25 ? kpis.peakNegative.constraint.slice(0, 23) + '…' : kpis.peakNegative.constraint} · HE{kpis.peakNegative.he} · {kpis.peakNegative.date}</div>}
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
            onDateRangeChange={setDateRange}
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
                {resolution === 'hourly' ? 'Hourly' : resolution === 'on_peak' ? 'On-Peak' : resolution === 'off_peak' ? 'Off-Peak' : 'Daily'}
                {' · '}{activeForChart.length}/{allConstraintNames.length} constraints
                {' · '}{dateRange === 'today' ? 'Latest Day' : dateRange === 'all' ? 'All Dates' : `${startDate} — ${endDate}`}
              </span>
            </div>

            {stackWarning && (
              <div style={{
                padding: '8px 14px', background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
                border: '1px solid var(--warning)', borderRadius: 8, marginBottom: 8, fontSize: 12,
                color: 'var(--text-muted)'
              }}>
                Stacked area disabled — data contains negative costs. Showing line chart instead.
              </div>
            )}

            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Constraint Costs Over Time</div>
                <span className="badge badge-primary">{chartData.length} points</span>
              </div>
              <PriceChart
                data={chartData}
                xKey="Date"
                yKeys={activeForChart}
                chartType={effectiveChartType}
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
