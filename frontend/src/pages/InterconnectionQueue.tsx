import { useState, useCallback } from 'react';
import { useDataset } from '../hooks/useDataset';

interface SummaryData {
  [key: string]: string | number;
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
  previous_values: string;
  current_values: string;
  detected_at: string;
}

type SheetFilter = 'all' | 'active' | 'cluster' | 'in_service' | 'withdrawn';

const SHEET_LABELS: Record<string, string> = {
  active: 'Active Queue',
  cluster: 'Cluster Projects',
  affected_system: 'Affected System',
  in_service: 'In Service',
  withdrawn: 'Withdrawn',
  cluster_withdrawn: 'Cluster Withdrawn',
  affected_system_withdrawn: 'Affected System Withdrawn',
};

const DISPLAY_COLS = [
  { key: 'queue_pos', label: 'Queue #', width: 80 },
  { key: 'project_name', label: 'Project Name', width: 200 },
  { key: 'developer', label: 'Developer', width: 180 },
  { key: 'fuel_type', label: 'Fuel/Tech', width: 80 },
  { key: 'sp_mw', label: 'SP MW', width: 70, numeric: true },
  { key: 'wp_mw', label: 'WP MW', width: 70, numeric: true },
  { key: 'zone', label: 'Zone', width: 50 },
  { key: 'county', label: 'County', width: 100 },
  { key: 'state', label: 'State', width: 50 },
  { key: 'status', label: 'Status', width: 60 },
  { key: 'date_of_ir', label: 'IR Date', width: 90 },
  { key: 'proposed_cod', label: 'COD', width: 90 },
];

function parseSummary(data: any[]): SummaryData {
  const map: SummaryData = {};
  for (const row of data) {
    map[row.metric] = row.value;
  }
  return map;
}

function parseJsonSafe(s: string): Record<string, number> {
  try { return JSON.parse(s); } catch { return {}; }
}

export default function InterconnectionQueue() {
  const { data: summaryData } = useDataset('iq_summary', 'raw');
  const { data: changesData } = useDataset('iq_changes', 'raw');
  const { data: allData } = useDataset('interconnection_queue', 'raw');

  const [sheetFilter, setSheetFilter] = useState<SheetFilter>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState('');

  const summary = summaryData?.data?.length ? parseSummary(summaryData.data) : null;
  const changes: ChangeRow[] = (changesData?.data as ChangeRow[]) || [];
  const allRows: any[] = allData?.data || [];

  const filteredRows = allRows.filter((r: any) => {
    if (sheetFilter === 'all') { /* no sheet filter */ }
    else if (sheetFilter === 'active') { if (r.source_sheet !== 'active') return false; }
    else if (sheetFilter === 'cluster') { if (r.source_sheet !== 'cluster') return false; }
    else if (sheetFilter === 'in_service') { if (r.source_sheet !== 'in_service') return false; }
    else if (sheetFilter === 'withdrawn') { if (!String(r.source_sheet || '').includes('withdrawn')) return false; }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const searchable = [r.queue_pos, r.project_name, r.developer, r.fuel_type, r.zone, r.county]
        .map(v => String(v || '').toLowerCase()).join(' ');
      if (!searchable.includes(term)) return false;
    }
    return true;
  });

  const handleScrape = useCallback(async () => {
    setScraping(true);
    setScrapeMsg('');
    try {
      const res = await fetch('/api/iq/scrape', { method: 'POST' });
      const data = await res.json();
      setScrapeMsg(data.status === 'ok' ? 'Scrape complete — refresh to see changes' : `Scrape error: ${data.status}`);
    } catch {
      setScrapeMsg('Scrape failed');
    }
    setScraping(false);
  }, []);

  const fuelBreakdown = summary ? parseJsonSafe(String(summary.fuel_breakdown || '{}')) : {};
  const zoneBreakdown = summary ? parseJsonSafe(String(summary.zone_breakdown || '{}')) : {};
  const newCount = Number(summary?.new_since_last || 0);
  const removedCount = Number(summary?.removed_since_last || 0);
  const updatedCount = Number(summary?.updated_since_last || 0);
  const hasChanges = newCount > 0 || removedCount > 0 || updatedCount > 0;

  const sheetTabs: { key: SheetFilter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: Number(summary?.total_active || 0) },
    { key: 'cluster', label: 'Cluster', count: Number(summary?.total_cluster || 0) },
    { key: 'in_service', label: 'In Service', count: Number(summary?.total_in_service || 0) },
    { key: 'withdrawn', label: 'Withdrawn', count: Number(summary?.total_withdrawn || 0) },
    { key: 'all', label: 'All', count: Number(summary?.total_projects || allRows.length) },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Interconnection Queue</h1>
        <p className="page-subtitle">
          NYISO generation and storage interconnection queue — active projects, cluster studies, in-service, and withdrawn
        </p>
      </div>

      <div className="iq-toolbar">
        <button
          className={`btn btn-primary iq-scrape-btn${scraping ? ' refreshing' : ''}`}
          onClick={handleScrape}
          disabled={scraping}
        >
          <span className={`refresh-icon${scraping ? ' spin' : ''}`}>↻</span>
          {scraping ? 'Scraping...' : 'Scrape Queue'}
        </button>
        {scrapeMsg && <span className="iq-scrape-msg">{scrapeMsg}</span>}
        {summary?.scrape_timestamp && (
          <span className="iq-timestamp">Last scrape: {String(summary.scrape_timestamp)}</span>
        )}
      </div>

      {summary && (
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div className="kpi-card">
            <div className="kpi-label">Active Projects</div>
            <div className="kpi-value">{summary.total_active}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Cluster Projects</div>
            <div className="kpi-value">{summary.total_cluster}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">In Service</div>
            <div className="kpi-value">{summary.total_in_service}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Total SP Capacity</div>
            <div className="kpi-value">
              {Number(summary.total_sp_mw).toLocaleString()}<span className="kpi-unit">MW</span>
            </div>
          </div>
          {hasChanges && (
            <div className="kpi-card accent">
              <div className="kpi-label">Changes Detected</div>
              <div className="kpi-value">
                {newCount + removedCount + updatedCount}
              </div>
            </div>
          )}
        </div>
      )}

      {hasChanges && changes.length > 0 && (
        <div className="section-container">
          <div className="section-title">Recent Changes</div>
          <div className="iq-changes-list">
            {changes.slice(0, 20).map((c, i) => (
              <div className={`iq-change-item iq-change-${c.change_type}`} key={i}>
                <span className={`iq-change-badge ${c.change_type}`}>{c.change_type}</span>
                <span className="iq-change-pos">{c.queue_pos}</span>
                <span className="iq-change-name">{c.project_name}</span>
                <span className="iq-change-detail">
                  {c.developer}{c.fuel_type ? ` | ${c.fuel_type}` : ''}
                  {c.sp_mw ? ` | ${c.sp_mw} MW` : ''}
                </span>
                {c.change_type === 'updated' && c.changed_fields && (
                  <span className="iq-change-fields">
                    Changed: {JSON.parse(c.changed_fields).join(', ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(Object.keys(fuelBreakdown).length > 0 || Object.keys(zoneBreakdown).length > 0) && (
        <div className="iq-breakdown-row">
          {Object.keys(fuelBreakdown).length > 0 && (
            <div className="iq-breakdown-card">
              <div className="iq-breakdown-title">Active + Cluster by Fuel Type</div>
              <div className="iq-breakdown-list">
                {Object.entries(fuelBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([fuel, count]) => (
                    <div className="iq-breakdown-item" key={fuel}>
                      <span className="iq-breakdown-label">{fuel}</span>
                      <span className="iq-breakdown-value">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
          {Object.keys(zoneBreakdown).length > 0 && (
            <div className="iq-breakdown-card">
              <div className="iq-breakdown-title">Active + Cluster by Zone</div>
              <div className="iq-breakdown-list">
                {Object.entries(zoneBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([zone, count]) => (
                    <div className="iq-breakdown-item" key={zone}>
                      <span className="iq-breakdown-label">{zone}</span>
                      <span className="iq-breakdown-value">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="section-container">
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
          <input
            type="text"
            className="iq-search"
            placeholder="Search projects..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="iq-table-wrap">
          <table className="iq-table">
            <thead>
              <tr>
                {DISPLAY_COLS.map(col => (
                  <th key={col.key} style={{ minWidth: col.width }}>{col.label}</th>
                ))}
                {sheetFilter === 'all' && <th style={{ minWidth: 100 }}>Sheet</th>}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={DISPLAY_COLS.length + (sheetFilter === 'all' ? 1 : 0)} className="iq-empty">
                  {allRows.length === 0 ? 'No data — click "Scrape Queue" to fetch' : 'No matching projects'}
                </td></tr>
              ) : (
                filteredRows.slice(0, 500).map((row: any, i: number) => (
                  <tr key={i}>
                    {DISPLAY_COLS.map(col => (
                      <td key={col.key} className={col.numeric ? 'numeric' : ''}>
                        {col.numeric && row[col.key] != null
                          ? Number(row[col.key]).toLocaleString(undefined, { maximumFractionDigits: 1 })
                          : row[col.key] ?? ''}
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
      </div>
    </div>
  );
}
