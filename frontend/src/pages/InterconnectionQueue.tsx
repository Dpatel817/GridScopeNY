/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import {
  BarChart as ReBarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import Widget from '../components/Widget';
import DraggableGrid from '../components/DraggableGrid';
import type { GridItem } from '../components/DraggableGrid';

interface QueueRow {
  queue_pos: string;
  project_name: string;
  developer: string;
  fuel_type: string;
  sp_mw: number;
  wp_mw: number;
  zone: string;
  county: string;
  state: string;
  status: string;
  source_sheet: string;
  date_of_ir: string;
  proposed_cod: string;
  point_of_interconnection: string;
  utility: string;
  [key: string]: unknown;
}

interface ChangeRow {
  change_type: string;
  queue_pos: string;
  project_name: string;
  developer: string;
  fuel_type: string;
  sp_mw: number;
  zone: string;
  source_sheet: string;
  changed_fields: string;
  detected_at: string;
}

interface SummaryData {
  [key: string]: string | number;
}

type SortKey = 'sp_mw' | 'developer' | 'zone' | 'queue_pos' | 'fuel_type' | 'project_name';
type SortDir = 'asc' | 'desc';

const FUEL_LABELS: Record<string, string> = {
  S: 'Solar', W: 'Wind', ES: 'Storage', NG: 'Gas', NUC: 'Nuclear',
  H: 'Hydro', FO: 'Fuel Oil', AC: 'AC Transmission', DC: 'DC Transmission',
  WND: 'Wind', SOL: 'Solar', STG: 'Storage', HYB: 'Hybrid',
};

const COLORS = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#6366f1', '#84cc16',
  '#f97316', '#a855f7',
];

function fuelLabel(code: string): string {
  if (!code) return 'Unknown';
  return FUEL_LABELS[code] || code;
}

function parseSummary(data: any[]): SummaryData {
  const map: SummaryData = {};
  for (const row of data) map[row.metric] = row.value;
  return map;
}

function parseJsonSafe(s: string): Record<string, number> {
  try { return JSON.parse(s); } catch { return {}; }
}



function QueueBarChart({ data, xKey, yKey, layout = 'vertical', height = 280 }: {
  data: Record<string, unknown>[]; xKey: string; yKey: string;
  layout?: 'vertical' | 'horizontal'; height?: number;
}) {
  if (!data.length) return <div className="iq-empty">No chart data</div>;

  const fmtValue = (v: number) => `${Math.round(v).toLocaleString()} MW`;

  if (layout === 'horizontal') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ReBarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 90, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
          <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11 }} width={85} />
          <Tooltip formatter={(v: unknown) => typeof v === 'number' ? fmtValue(v) : String(v)}
            contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} />
          <Bar dataKey={yKey} radius={[0, 4, 4, 0]} maxBarSize={24}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
            <LabelList dataKey={yKey} position="right"
              formatter={(v: number) => `${Math.round(v).toLocaleString()}`}
              style={{ fontSize: 10, fontWeight: 600, fill: 'var(--text-muted)' }} />
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
        <Tooltip formatter={(v: unknown) => typeof v === 'number' ? fmtValue(v) : String(v)}
          contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} />
        <Bar dataKey={yKey} radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
          <LabelList dataKey={yKey} position="top"
            formatter={(v: number) => `${Math.round(v).toLocaleString()}`}
            style={{ fontSize: 10, fontWeight: 600, fill: 'var(--text-muted)' }} />
        </Bar>
      </ReBarChart>
    </ResponsiveContainer>
  );
}

const DISPLAY_COLS = [
  { key: 'queue_pos', label: 'Queue #', width: 80 },
  { key: 'project_name', label: 'Project Name', width: 200 },
  { key: 'developer', label: 'Developer', width: 180 },
  { key: 'fuel_type', label: 'Fuel/Tech', width: 80 },
  { key: 'sp_mw', label: 'SP MW', width: 70, numeric: true },
  { key: 'wp_mw', label: 'WP MW', width: 70, numeric: true },
  { key: 'zone', label: 'Zone', width: 50 },
  { key: 'county', label: 'County', width: 100 },
  { key: 'status', label: 'Status', width: 60 },
  { key: 'date_of_ir', label: 'IR Date', width: 90 },
  { key: 'proposed_cod', label: 'COD', width: 90 },
];

const SHEET_LABELS: Record<string, string> = {
  active: 'Active Queue',
  cluster: 'Cluster Projects',
  affected_system: 'Affected System',
  in_service: 'In Service',
  withdrawn: 'Withdrawn',
  cluster_withdrawn: 'Cluster Withdrawn',
  affected_system_withdrawn: 'Affected System Withdrawn',
};

type SheetFilter = 'all' | 'active' | 'cluster' | 'in_service' | 'withdrawn';

const DEFAULT_LAYOUT: GridItem[] = [
  { i: 'summary',  x: 0, y: 0,  w: 12, h: 3, minH: 2 },
  { i: 'analytics', x: 0, y: 3, w: 12, h: 8, minH: 6 },
  { i: 'activity', x: 0, y: 11, w: 6,  h: 7, minH: 5 },
  { i: 'largest',  x: 6, y: 11, w: 6,  h: 7, minH: 5 },
  { i: 'table',    x: 0, y: 18, w: 12, h: 9, minH: 7 },
];

export default function InterconnectionQueue() {
  const { data: summaryData } = useDataset('iq_summary', 'raw');
  const { data: changesData } = useDataset('iq_changes', 'raw');
  const { data: allData } = useDataset('interconnection_queue', 'raw');

  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState('');
  const [sheetFilter, setSheetFilter] = useState<SheetFilter>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [fuelFilter, setFuelFilter] = useState('all');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('sp_mw');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const summary = summaryData?.data?.length ? parseSummary(summaryData.data) : null;
  const changes: ChangeRow[] = (changesData?.data as ChangeRow[]) || [];
  const allRows: QueueRow[] = (allData?.data || []) as QueueRow[];

  const activeRows = useMemo(() => allRows.filter(r => r.source_sheet === 'active'), [allRows]);
  const clusterRows = useMemo(() => allRows.filter(r => r.source_sheet === 'cluster'), [allRows]);
  const inServiceRows = useMemo(() => allRows.filter(r => r.source_sheet === 'in_service'), [allRows]);
  const withdrawnRows = useMemo(() => allRows.filter(r => String(r.source_sheet || '').includes('withdrawn')), [allRows]);
  const pipelineRows = useMemo(() => allRows.filter(r =>
    r.source_sheet === 'active' || r.source_sheet === 'cluster' || r.source_sheet === 'in_service'
  ), [allRows]);

  const sumMw = (rows: QueueRow[]) => rows.reduce((s, r) => s + (Number(r.sp_mw) || 0), 0);

  const kpis = useMemo(() => {
    const activeMw = sumMw(activeRows);
    const clusterMw = sumMw(clusterRows);
    const inServiceMw = sumMw(inServiceRows);
    const withdrawnMw = sumMw(withdrawnRows);

    const fuelMw: Record<string, number> = {};
    for (const r of [...activeRows, ...clusterRows]) {
      const fuel = fuelLabel(r.fuel_type);
      fuelMw[fuel] = (fuelMw[fuel] || 0) + (Number(r.sp_mw) || 0);
    }
    const storageMw = fuelMw['Storage'] || 0;
    const solarMw = fuelMw['Solar'] || 0;
    const windMw = fuelMw['Wind'] || 0;

    const allPipeline = [...activeRows, ...clusterRows];
    const largest = allPipeline.reduce((max, r) =>
      (Number(r.sp_mw) || 0) > (Number(max?.sp_mw) || 0) ? r : max, allPipeline[0]);
    const totalMw = activeMw + clusterMw;
    const avgSize = allPipeline.length > 0 ? totalMw / allPipeline.length : 0;

    return {
      activeMw, clusterMw, inServiceMw, withdrawnMw,
      storageMw, solarMw, windMw,
      largest, avgSize, totalMw,
      activeCount: activeRows.length, clusterCount: clusterRows.length,
      inServiceCount: inServiceRows.length, withdrawnCount: withdrawnRows.length,
    };
  }, [activeRows, clusterRows, inServiceRows, withdrawnRows]);

  const fuelChartData = useMemo(() => {
    const fuelMw: Record<string, number> = {};
    for (const r of [...activeRows, ...clusterRows]) {
      const fuel = fuelLabel(r.fuel_type);
      fuelMw[fuel] = (fuelMw[fuel] || 0) + (Number(r.sp_mw) || 0);
    }
    return Object.entries(fuelMw)
      .map(([fuel, mw]) => ({ Fuel: fuel, MW: Math.round(mw) }))
      .sort((a, b) => b.MW - a.MW)
      .slice(0, 10);
  }, [activeRows, clusterRows]);

  const zoneChartData = useMemo(() => {
    const zoneMw: Record<string, number> = {};
    for (const r of [...activeRows, ...clusterRows]) {
      const z = String(r.zone || 'Unknown');
      zoneMw[z] = (zoneMw[z] || 0) + (Number(r.sp_mw) || 0);
    }
    return Object.entries(zoneMw)
      .map(([zone, mw]) => ({ Zone: zone, MW: Math.round(mw) }))
      .sort((a, b) => a.Zone < b.Zone ? -1 : 1);
  }, [activeRows, clusterRows]);

  const largestProjects = useMemo(() => {
    return [...activeRows, ...clusterRows]
      .filter(r => Number(r.sp_mw) > 0)
      .sort((a, b) => (Number(b.sp_mw) || 0) - (Number(a.sp_mw) || 0))
      .slice(0, 15);
  }, [activeRows, clusterRows]);

  const intelligenceSummary = useMemo(() => {
    if (!allRows.length) return '';
    const parts: string[] = [];

    const totalPipelineMw = kpis.activeMw + kpis.clusterMw;
    parts.push(
      `The NYISO interconnection queue contains ${(kpis.activeCount + kpis.clusterCount).toLocaleString()} active and cluster projects totaling ${Math.round(totalPipelineMw).toLocaleString()} MW of proposed capacity.`
    );

    const topFuels = fuelChartData.slice(0, 3);
    if (topFuels.length) {
      parts.push(
        `Dominant technologies: ${topFuels.map(f => `${f.Fuel} (${f.MW.toLocaleString()} MW)`).join(', ')}.`
      );
    }

    const topZones = [...zoneChartData].sort((a, b) => b.MW - a.MW).slice(0, 3);
    if (topZones.length) {
      parts.push(
        `Zones with the most queued capacity: ${topZones.map(z => `Zone ${z.Zone} (${z.MW.toLocaleString()} MW)`).join(', ')}.`
      );
    }

    if (kpis.largest) {
      parts.push(
        `Largest project: ${kpis.largest.project_name || kpis.largest.queue_pos} at ${Math.round(Number(kpis.largest.sp_mw)).toLocaleString()} MW (${fuelLabel(kpis.largest.fuel_type)}, Zone ${kpis.largest.zone}).`
      );
    }

    if (kpis.inServiceMw > 0) {
      parts.push(
        `${kpis.inServiceCount.toLocaleString()} projects (${Math.round(kpis.inServiceMw).toLocaleString()} MW) have reached in-service status.`
      );
    }

    const newCount = Number(summary?.new_since_last || 0);
    if (newCount > 0) {
      parts.push(`${newCount} new project(s) added since the last scrape.`);
    }

    return parts.join(' ');
  }, [allRows, kpis, fuelChartData, zoneChartData, summary]);

  const allFuelTypes = useMemo(() => {
    const fuels = new Set<string>();
    for (const r of allRows) if (r.fuel_type) fuels.add(r.fuel_type);
    return [...fuels].sort();
  }, [allRows]);

  const allZones = useMemo(() => {
    const zones = new Set<string>();
    for (const r of allRows) if (r.zone) zones.add(r.zone);
    return [...zones].sort();
  }, [allRows]);

  const filteredRows = useMemo(() => {
    let rows = allRows;

    if (sheetFilter !== 'all') {
      if (sheetFilter === 'withdrawn') rows = rows.filter(r => String(r.source_sheet || '').includes('withdrawn'));
      else rows = rows.filter(r => r.source_sheet === sheetFilter);
    }

    if (fuelFilter !== 'all') rows = rows.filter(r => r.fuel_type === fuelFilter);
    if (zoneFilter !== 'all') rows = rows.filter(r => r.zone === zoneFilter);

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter(r => {
        const searchable = [r.queue_pos, r.project_name, r.developer, r.fuel_type, r.zone, r.county]
          .map(v => String(v || '').toLowerCase()).join(' ');
        return searchable.includes(term);
      });
    }

    rows = [...rows].sort((a, b) => {
      let aVal: any = a[sortKey];
      let bVal: any = b[sortKey];
      if (sortKey === 'sp_mw') { aVal = Number(aVal) || 0; bVal = Number(bVal) || 0; }
      else { aVal = String(aVal || '').toLowerCase(); bVal = String(bVal || '').toLowerCase(); }
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }, [allRows, sheetFilter, fuelFilter, zoneFilter, searchTerm, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'sp_mw' ? 'desc' : 'asc'); }
  };

  const handleScrape = useCallback(async () => {
    setScraping(true);
    setScrapeMsg('');
    try {
      const res = await fetch('/api/iq/scrape', { method: 'POST' });
      const data = await res.json();
      setScrapeMsg(data.status === 'ok' ? 'Scrape complete — refresh to see changes' : `Error: ${data.status}`);
    } catch {
      setScrapeMsg('Scrape failed');
    }
    setScraping(false);
  }, []);

  const newCount = Number(summary?.new_since_last || 0);
  const removedCount = Number(summary?.removed_since_last || 0);
  const newChanges = changes.filter(c => c.change_type === 'new');
  const newMwAdded = newChanges.reduce((s, c) => s + (Number(c.sp_mw) || 0), 0);

  const sheetTabs: { key: SheetFilter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: kpis.activeCount },
    { key: 'cluster', label: 'Cluster', count: kpis.clusterCount },
    { key: 'in_service', label: 'In Service', count: kpis.inServiceCount },
    { key: 'withdrawn', label: 'Withdrawn', count: kpis.withdrawnCount },
    { key: 'all', label: 'All', count: allRows.length },
  ];

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Interconnection Queue</h1>
          <p className="page-subtitle">
            NYISO generation and storage interconnection pipeline — capacity analytics, technology trends, and project tracking
          </p>
        </div>
        <div className="iq-header-actions">
          <button
            className={`btn btn-primary iq-scrape-btn${scraping ? ' refreshing' : ''}`}
            onClick={handleScrape}
            disabled={scraping}
          >
            <span className={`refresh-icon${scraping ? ' spin' : ''}`}>&#8635;</span>
            {scraping ? 'Scraping...' : 'Scrape Queue'}
          </button>
          {scrapeMsg && <span className="iq-scrape-msg">{scrapeMsg}</span>}
          {summary?.scrape_timestamp && (
            <span className="iq-timestamp">Last Updated: {String(summary.scrape_timestamp).slice(0, 16)}</span>
          )}
        </div>
      </div>

      {/* Fixed KPI Section */}
      <div className="kpi-section">
        <div className="kpi-section-header">
          <div className="kpi-section-title">Queue Intelligence</div>
          <span className="kpi-section-badge">Deterministic</span>
        </div>
        {intelligenceSummary ? (
          <div className="kpi-summary-text">{intelligenceSummary}</div>
        ) : (
          <div className="kpi-summary-text" style={{ color: 'var(--text-muted)' }}>No queue data available. Click "Scrape Queue" to fetch.</div>
        )}
        <div className="kpi-section-header" style={{ marginTop: 24 }}>
          <div className="kpi-section-title">Key Queue Metrics</div>
        </div>
        <div className="kpi-grid-fixed">
          <div className="kpi-card-fixed"><div className="kpi-label">Active Queue</div><div className="kpi-value">{Math.round(kpis.activeMw).toLocaleString()}<span className="kpi-unit">MW</span></div><div className="kpi-sub">{kpis.activeCount} projects</div></div>
          <div className="kpi-card-fixed"><div className="kpi-label">Cluster Study</div><div className="kpi-value">{Math.round(kpis.clusterMw).toLocaleString()}<span className="kpi-unit">MW</span></div><div className="kpi-sub">{kpis.clusterCount} projects</div></div>
          <div className="kpi-card-fixed"><div className="kpi-label">In Service</div><div className="kpi-value">{Math.round(kpis.inServiceMw).toLocaleString()}<span className="kpi-unit">MW</span></div><div className="kpi-sub">{kpis.inServiceCount} projects</div></div>
          <div className="kpi-card-fixed"><div className="kpi-label">Storage</div><div className="kpi-value">{Math.round(kpis.storageMw).toLocaleString()}<span className="kpi-unit">MW</span></div></div>
          <div className="kpi-card-fixed"><div className="kpi-label">Solar</div><div className="kpi-value">{Math.round(kpis.solarMw).toLocaleString()}<span className="kpi-unit">MW</span></div></div>
          <div className="kpi-card-fixed"><div className="kpi-label">Wind</div><div className="kpi-value">{Math.round(kpis.windMw).toLocaleString()}<span className="kpi-unit">MW</span></div></div>
          <div className="kpi-card-fixed accent"><div className="kpi-label">Avg Project Size</div><div className="kpi-value">{Math.round(kpis.avgSize).toLocaleString()}<span className="kpi-unit">MW</span></div></div>
          <div className="kpi-card-fixed"><div className="kpi-label">Largest Project</div><div className="kpi-value">{kpis.largest ? <>{Math.round(Number(kpis.largest.sp_mw)).toLocaleString()}<span className="kpi-unit">MW</span></> : '—'}</div>{kpis.largest && <div className="kpi-sub">{kpis.largest.project_name ? kpis.largest.project_name.slice(0, 23) : kpis.largest.queue_pos}</div>}</div>
        </div>
      </div>

      <DraggableGrid id="interconnection-queue" defaultLayout={DEFAULT_LAYOUT} rowHeight={60}>

        <div key="summary">
          <Widget draggable title="Queue Intelligence Summary" subtitle="Pipeline overview and technology breakdown">
            <div className="kpi-summary-text" style={{ padding: '12px 0' }}>{intelligenceSummary || 'No data yet.'}</div>
          </Widget>
        </div>

        <div key="analytics">
          <Widget draggable title="Queue Analytics" subtitle="Pipeline stages and capacity by fuel type and zone">
            <div className="iq-pipeline-bar">
              <div className="iq-pipeline-stage">
                <div className="iq-pipeline-label">Cluster</div>
                <div className="iq-pipeline-mw">{Math.round(kpis.clusterMw).toLocaleString()} MW</div>
                <div className="iq-pipeline-count">{kpis.clusterCount} projects</div>
              </div>
              <div className="iq-pipeline-arrow">&rarr;</div>
              <div className="iq-pipeline-stage active">
                <div className="iq-pipeline-label">Active</div>
                <div className="iq-pipeline-mw">{Math.round(kpis.activeMw).toLocaleString()} MW</div>
                <div className="iq-pipeline-count">{kpis.activeCount} projects</div>
              </div>
              <div className="iq-pipeline-arrow">&rarr;</div>
              <div className="iq-pipeline-stage done">
                <div className="iq-pipeline-label">In Service</div>
                <div className="iq-pipeline-mw">{Math.round(kpis.inServiceMw).toLocaleString()} MW</div>
                <div className="iq-pipeline-count">{kpis.inServiceCount} projects</div>
              </div>
            </div>
            <div className="iq-charts-row">
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">Queue Capacity by Fuel Type</div>
                  <span className="badge badge-primary">{fuelChartData.length} types</span>
                </div>
                <QueueBarChart data={fuelChartData} xKey="Fuel" yKey="MW" layout="horizontal" height={Math.max(200, fuelChartData.length * 30)} />
              </div>
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">Queue Capacity by Zone</div>
                  <span className="badge badge-primary">{zoneChartData.length} zones</span>
                </div>
                <QueueBarChart data={zoneChartData} xKey="Zone" yKey="MW" layout="vertical" height={260} />
              </div>
            </div>
          </Widget>
        </div>

        <div key="activity">
          <Widget draggable title="Recent Queue Activity" badge={newCount + removedCount > 0 ? `${newCount + removedCount} changes` : undefined} noPad>
            <div className="iq-activity-summary" style={{ padding: '12px 16px' }}>
              <div className="kpi-card" style={{ flex: 1 }}>
                <div className="kpi-label">New Projects</div>
                <div className="kpi-value">{newCount}</div>
              </div>
              <div className="kpi-card" style={{ flex: 1 }}>
                <div className="kpi-label">Projects Withdrawn</div>
                <div className="kpi-value">{removedCount}</div>
              </div>
              <div className="kpi-card" style={{ flex: 1 }}>
                <div className="kpi-label">MW Added</div>
                <div className="kpi-value">{Math.round(newMwAdded).toLocaleString()}<span className="kpi-unit">MW</span></div>
              </div>
            </div>
            {changes.length > 0 ? (
              <div className="iq-changes-list">
                {changes.slice(0, 20).map((c, i) => (
                  <div className={`iq-change-item iq-change-${c.change_type}`} key={i}>
                    <span className={`iq-change-badge ${c.change_type}`}>{c.change_type}</span>
                    <span className="iq-change-pos">{c.queue_pos}</span>
                    <span className="iq-change-name">{c.project_name}</span>
                    <span className="iq-change-detail">
                      {c.developer}{c.fuel_type ? ` | ${fuelLabel(c.fuel_type)}` : ''}
                      {c.sp_mw ? ` | ${Number(c.sp_mw).toLocaleString()} MW` : ''}
                      {c.zone ? ` | Zone ${c.zone}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="iq-empty" style={{ padding: '16px' }}>No recent changes detected.</div>
            )}
          </Widget>
        </div>

        <div key="largest">
          <Widget draggable title="Largest Projects" badge="Top 15" noPad>
            <div className="iq-table-wrap">
              <table className="iq-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 70 }}>Queue #</th>
                    <th style={{ minWidth: 180 }}>Project Name</th>
                    <th style={{ minWidth: 160 }}>Developer</th>
                    <th style={{ minWidth: 80 }}>Fuel Type</th>
                    <th style={{ minWidth: 70 }}>SP MW</th>
                    <th style={{ minWidth: 50 }}>Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {largestProjects.map((r, i) => (
                    <tr key={i} className={Number(r.sp_mw) > 300 ? 'iq-row-highlight' : ''}>
                      <td>{r.queue_pos}</td>
                      <td>{r.project_name}</td>
                      <td>{r.developer}</td>
                      <td>{fuelLabel(r.fuel_type)}</td>
                      <td className="numeric">{Math.round(Number(r.sp_mw)).toLocaleString()}</td>
                      <td>{r.zone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Widget>
        </div>

        <div key="table">
          <Widget draggable title="Full Queue Table" badge={`${allRows.length} projects`} noPad>
            <div className="iq-table-header">
              <div className="iq-tabs">
                {sheetTabs.map(t => (
                  <button
                    key={t.key}
                    className={`iq-tab${sheetFilter === t.key ? ' active' : ''}`}
                    onClick={() => setSheetFilter(t.key)}
                  >
                    {t.label}
                    <span className="iq-tab-count">{t.count}</span>
                  </button>
                ))}
              </div>
              <div className="iq-filter-row">
                <select className="iq-filter-select" value={fuelFilter} onChange={e => setFuelFilter(e.target.value)}>
                  <option value="all">All Fuels</option>
                  {allFuelTypes.map(f => <option key={f} value={f}>{fuelLabel(f)} ({f})</option>)}
                </select>
                <select className="iq-filter-select" value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}>
                  <option value="all">All Zones</option>
                  {allZones.map(z => <option key={z} value={z}>Zone {z}</option>)}
                </select>
                <input
                  type="text"
                  className="iq-search"
                  placeholder="Search projects, developers, counties..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="iq-table-wrap">
              <table className="iq-table">
                <thead>
                  <tr>
                    {DISPLAY_COLS.map(col => {
                      const isSortable = ['sp_mw', 'developer', 'zone', 'queue_pos', 'fuel_type', 'project_name'].includes(col.key);
                      return (
                        <th
                          key={col.key}
                          style={{ minWidth: col.width, cursor: isSortable ? 'pointer' : 'default' }}
                          onClick={() => isSortable && handleSort(col.key as SortKey)}
                        >
                          {col.label}
                          {sortKey === col.key && (
                            <span className="iq-sort-icon">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
                          )}
                        </th>
                      );
                    })}
                    {sheetFilter === 'all' && <th style={{ minWidth: 100 }}>Sheet</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={DISPLAY_COLS.length + (sheetFilter === 'all' ? 1 : 0)} className="iq-empty">
                      {allRows.length === 0 ? 'No data — click "Scrape Queue" to fetch' : 'No matching projects'}
                    </td></tr>
                  ) : (
                    filteredRows.slice(0, 500).map((row, i) => (
                      <tr key={i} className={Number(row.sp_mw) > 300 ? 'iq-row-highlight' : ''}>
                        {DISPLAY_COLS.map(col => (
                          <td key={col.key} className={col.numeric ? 'numeric' : ''}>
                            {col.key === 'fuel_type'
                              ? fuelLabel(String(row[col.key] || ''))
                              : col.numeric && row[col.key] != null
                                ? Number(row[col.key]).toLocaleString(undefined, { maximumFractionDigits: 1 })
                                : (row[col.key] as string) ?? ''}
                          </td>
                        ))}
                        {sheetFilter === 'all' && (
                          <td><span className="iq-sheet-badge">{SHEET_LABELS[row.source_sheet] || row.source_sheet}</span></td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filteredRows.length > 500 && (
              <div className="iq-truncation">Showing 500 of {filteredRows.length.toLocaleString()} projects</div>
            )}
          </Widget>
        </div>

      </DraggableGrid>
    </div>
  );
}
