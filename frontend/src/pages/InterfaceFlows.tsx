import { useState, useMemo, useEffect, useCallback } from 'react';
import { useDataset } from '../hooks/useDataset';
import ResolutionSelector from '../components/ResolutionSelector';
import LineChart from '../components/LineChart';
import DatasetSection from '../components/DatasetSection';
import SeriesSelector from '../components/SeriesSelector';
import { getInterfaceMeta, getDisplayName } from '../data/interfaceMetadata';
import type { InterfaceMeta } from '../data/interfaceMetadata';

const DATASETS = [
  'external_limits_flows', 'atc_ttc', 'ttcf',
  'par_flows', 'erie_circulation_da', 'erie_circulation_rt',
];

type ClassFilter = 'all' | 'Internal' | 'External';

interface InterfaceStat {
  raw: string;
  display: string;
  meta: InterfaceMeta;
  total: number;
  count: number;
  max: number;
  min: number;
  avg: number;
  utilization: number;
}

interface TtcfResponse {
  status: string;
  date: string;
  derates: Record<string, any>[];
  total_entries?: number;
  derate_count?: number;
  paths?: string[];
  message?: string;
}

function TTCFDeratesSection() {
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [data, setData] = useState<TtcfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [pathFilter, setPathFilter] = useState('');

  const fetchTtcf = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ttcf-derates?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchTtcf(); }, [fetchTtcf]);

  const filteredDerates = useMemo(() => {
    if (!data?.derates) return [];
    if (!pathFilter) return data.derates;
    return data.derates.filter(d => d['Path Name'] === pathFilter);
  }, [data, pathFilter]);

  const displayCols = ['Path Name', 'Cause Of Derate', 'Date Out', 'Time Out', 'Date In', 'Time In',
    'Import TTC Impact', 'Revised Import TTC', 'Base Import TTC',
    'Export TTC Impact', 'Revised Export TTC', 'Base Export TTC'];

  return (
    <div style={{ marginTop: 24 }}>
      <div className="section-title" style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
        TTCF Derates
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
        Transfer capability reductions from NYISO's TTCF postings — shows active derates impacting import/export TTC on each interface path.
      </p>
      <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          type="date"
          className="gen-map-select"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        {data && data.paths && data.paths.length > 0 && (
          <select className="gen-map-select" value={pathFilter} onChange={e => setPathFilter(e.target.value)}>
            <option value="">All Paths</option>
            {data.paths.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <button className="pill active" onClick={fetchTtcf} style={{ cursor: 'pointer' }}>
          Refresh
        </button>
      </div>
      {loading && <div className="loading"><div className="spinner" /> Loading TTCF derate data...</div>}
      {!loading && data && data.status === 'error' && (
        <div className="insight-card" style={{ borderLeftColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>TTCF Fetch Error</div>
          <div className="insight-body">{data.message || 'Failed to load TTCF data.'}</div>
        </div>
      )}
      {!loading && data && data.status === 'no_data' && (
        <div className="insight-card">
          <div className="insight-body">{data.message || 'No TTCF data available for this date.'}</div>
        </div>
      )}
      {!loading && data && data.status === 'ok' && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
            <div className="kpi-card accent">
              <div className="kpi-label">Active Derates</div>
              <div className="kpi-value">{filteredDerates.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total TTCF Entries</div>
              <div className="kpi-value">{data.total_entries || 0}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Paths With Derates</div>
              <div className="kpi-value">
                {data.derates ? new Set(data.derates.map(d => d['Path Name'])).size : 0}
              </div>
            </div>
          </div>

          {filteredDerates.length > 0 && (
            <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                className="chart-card-header"
                style={{ padding: '14px 20px', cursor: 'pointer' }}
                onClick={() => setExpanded(!expanded)}
              >
                <div className="chart-card-title">
                  <span className="chevron">{expanded ? '▾' : '▸'}</span>{' '}
                  TTCF Derate Details
                </div>
                <span className="badge badge-primary">
                  {filteredDerates.length} derates{pathFilter ? ` · ${pathFilter}` : ''}
                </span>
              </div>
              {expanded && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="rank-table" style={{ borderSpacing: 0, fontSize: 12 }}>
                    <thead>
                      <tr>
                        {displayCols.map(col => (
                          <th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDerates.map((row, i) => (
                        <tr key={i}>
                          {displayCols.map(col => {
                            const val = row[col];
                            const isImpact = col.includes('Impact');
                            const numVal = typeof val === 'number' ? val : parseFloat(val);
                            return (
                              <td
                                key={col}
                                style={{
                                  whiteSpace: 'nowrap',
                                  fontWeight: isImpact && !isNaN(numVal) && Math.abs(numVal) > 0 ? 700 : 400,
                                  color: isImpact && !isNaN(numVal) && numVal < 0 ? 'var(--danger)' : isImpact && !isNaN(numVal) && numVal > 0 ? 'var(--accent)' : 'var(--text)',
                                }}
                              >
                                {isImpact && !isNaN(numVal) ? `${numVal >= 0 ? '+' : ''}${numVal.toFixed(0)} MW` : (val ?? '—')}
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
          )}

          {filteredDerates.length === 0 && (
            <div className="insight-card">
              <div className="insight-body">
                No active derates found{pathFilter ? ` for ${pathFilter}` : ''} on {data.date}.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function InterfaceFlows() {
  const [resolution, setResolution] = useState('hourly');
  const [showRaw, setShowRaw] = useState(false);
  const [selectedInterfaces, setSelectedInterfaces] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');

  const { data: flowData, loading, error } = useDataset('external_limits_flows', resolution);

  const { allDisplayNames, kpis, chartData, interfaceStats, internalCount, externalCount } = useMemo(() => {
    const records = flowData?.data || [];
    if (!records.length) return {
      allDisplayNames: [] as string[], kpis: {} as any, chartData: [] as any[],
      interfaceStats: [] as InterfaceStat[], internalCount: 0, externalCount: 0,
    };

    const flowCol = records[0]?.Flow !== undefined ? 'Flow' : 'Flow (MW)';
    const nameCol = records[0]?.Interface !== undefined ? 'Interface' : 'Interface Name';

    const flows = records.map((r: any) => Number(r[flowCol] || 0)).filter((v: number) => !isNaN(v));
    const avgFlow = flows.length ? flows.reduce((a: number, b: number) => a + b, 0) / flows.length : null;
    const maxFlow = flows.length ? Math.max(...flows) : null;
    const minFlow = flows.length ? Math.min(...flows) : null;

    const byInterface: Record<string, { total: number; count: number; max: number; min: number; raw: string }> = {};
    for (const r of records) {
      const raw = String(r[nameCol] || 'Unknown');
      const flow = Number(r[flowCol] || 0);
      if (!byInterface[raw]) byInterface[raw] = { total: 0, count: 0, max: -Infinity, min: Infinity, raw };
      byInterface[raw].total += flow;
      byInterface[raw].count++;
      byInterface[raw].max = Math.max(byInterface[raw].max, flow);
      byInterface[raw].min = Math.min(byInterface[raw].min, flow);
    }

    const rawToDisplay: Record<string,string> = {};
    const displayToRaw: Record<string,string> = {};
    for (const raw of Object.keys(byInterface)) {
      const dn = getDisplayName(raw);
      rawToDisplay[raw] = dn;
      displayToRaw[dn] = raw;
    }

    let stats: InterfaceStat[] = Object.values(byInterface)
      .map(s => {
        const meta = getInterfaceMeta(s.raw);
        return {
          raw: s.raw,
          display: meta.display,
          meta,
          total: s.total,
          count: s.count,
          max: s.max,
          min: s.min,
          avg: s.total / s.count,
          utilization: Math.abs(s.max),
        };
      })
      .sort((a, b) => b.utilization - a.utilization);

    const internalCount = stats.filter(s => s.meta.classification === 'Internal').length;
    const externalCount = stats.filter(s => s.meta.classification === 'External').length;

    if (classFilter !== 'all') {
      stats = stats.filter(s => s.meta.classification === classFilter);
    }

    const allDN = stats.map(s => s.display);
    const active = selectedInterfaces.length > 0
      ? selectedInterfaces.filter((d: string) => allDN.includes(d))
      : allDN.slice(0, 8);

    const activeRawNames = active.map((d: string) => displayToRaw[d]).filter(Boolean);

    const pivoted: Record<string, any> = {};
    for (const r of records) {
      const raw = String(r[nameCol] || '');
      if (!activeRawNames.includes(raw)) continue;
      const display = rawToDisplay[raw];
      const dateKey = r.Date || r['Time Stamp'] || '';
      const key = `${dateKey}_${r.HE || ''}`;
      if (!pivoted[key]) pivoted[key] = { Date: dateKey };
      pivoted[key][display] = Number(r[flowCol] || 0);
    }
    const chartData = Object.values(pivoted).sort((a: any, b: any) => a.Date < b.Date ? -1 : 1);

    return {
      allDisplayNames: allDN,
      kpis: { avgFlow, maxFlow, minFlow, interfaceCount: stats.length, mostStressed: stats[0]?.display },
      chartData: chartData.length > 1 ? chartData : [],
      interfaceStats: stats,
      internalCount,
      externalCount,
    };
  }, [flowData, selectedInterfaces, classFilter]);

  useEffect(() => {
    setSelectedInterfaces([]);
  }, [classFilter]);

  useEffect(() => {
    if (allDisplayNames.length > 0 && selectedInterfaces.length === 0) {
      setSelectedInterfaces(allDisplayNames.slice(0, 8));
    }
  }, [allDisplayNames]);

  const activeForChart = selectedInterfaces.length > 0
    ? selectedInterfaces.filter(i => allDisplayNames.includes(i))
    : allDisplayNames.slice(0, 8);

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

        <div className="pill-group">
          <span className="pill-label">CLASS:</span>
          {([['all', 'All'], ['Internal', 'Internal'], ['External', 'External']] as const).map(([val, lbl]) => (
            <button key={val} className={`pill${classFilter === val ? ' active' : ''}`} onClick={() => setClassFilter(val as ClassFilter)}>
              {lbl}
              <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 11 }}>
                {val === 'all' ? `${internalCount + externalCount}` : val === 'Internal' ? `${internalCount}` : `${externalCount}`}
              </span>
            </button>
          ))}
        </div>

        {allDisplayNames.length > 0 && (
          <SeriesSelector
            label="Interfaces"
            allSeries={allDisplayNames}
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
                <span className="badge badge-primary">
                  {resolution} · {activeForChart.length} of {allDisplayNames.length} interfaces
                  {classFilter !== 'all' && ` · ${classFilter}`}
                </span>
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
              <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div className="chart-card-title">
                    Interface Summary ({interfaceStats.length} interfaces{classFilter !== 'all' ? ` · ${classFilter} only` : ''})
                  </div>
                </div>
                <table className="rank-table" style={{ borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th>Interface</th>
                      <th>Class</th>
                      <th>Region / Path</th>
                      <th>Direction</th>
                      <th>Avg Flow (MW)</th>
                      <th>Max Flow (MW)</th>
                      <th>Min Flow (MW)</th>
                      <th>Observations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interfaceStats.map(s => (
                      <tr key={s.raw}>
                        <td style={{ fontWeight: 600 }}>{s.display}</td>
                        <td>
                          <span className={`intf-class-tag ${s.meta.classification === 'Internal' ? 'intf-internal' : 'intf-external'}`}>
                            {s.meta.classification}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.meta.region}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.meta.direction}</td>
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
                  {(() => {
                    const topInternal = interfaceStats.find(s => s.meta.classification === 'Internal');
                    const topExternal = interfaceStats.find(s => s.meta.classification === 'External');
                    return (
                      <>
                        {topInternal && (
                          <>
                            <strong>{topInternal.display}</strong> is the most active internal transfer path with flows ranging from
                            <strong> {topInternal.min.toFixed(0)} MW</strong> to <strong>{topInternal.max.toFixed(0)} MW</strong>.
                            {topInternal.max > 2000 && <> High utilization suggests potential transfer constraint pressure. </>}
                          </>
                        )}
                        {topExternal && (
                          <>
                            {' '}The most active external path is <strong>{topExternal.display}</strong> ({topExternal.meta.region}),
                            with average flow of <strong>{topExternal.avg.toFixed(0)} MW</strong>.
                          </>
                        )}
                        {' '}A total of <strong>{internalCount} internal</strong> and <strong>{externalCount} external</strong> interfaces are tracked.
                      </>
                    );
                  })()}
                </div>
              </div>
            </>
          )}

          <TTCFDeratesSection />

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
