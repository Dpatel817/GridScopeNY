import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useInventory, useDataset } from '../hooks/useDataset';
import EmptyState from '../components/EmptyState';
import DatasetSection from '../components/DatasetSection';

const NAV_CARDS = [
  { path: '/prices', title: 'Prices', desc: 'DA/RT LBMP spreads, ancillary services, CTS', category: 'market' },
  { path: '/demand', title: 'Demand Intelligence', desc: 'Load forecasts, actuals, forecast errors', category: 'market' },
  { path: '/generation', title: 'Generation', desc: 'Fuel mix, commitments, BTM solar, generator map', category: 'market' },
  { path: '/interfaces', title: 'Interface Flows', desc: 'Transmission pressure, ATC/TTC, derates', category: 'market' },
  { path: '/congestion', title: 'Congestion', desc: 'Binding constraints, outage schedules', category: 'market' },
  { path: '/opportunities', title: 'Opportunity Explorer', desc: 'Zone rankings, trader takeaways, AI explanation', category: 'hero' },
];

const USEFUL_LINKS = [
  { label: 'Modo Energy NYISO Research', url: 'https://modoenergy.com/research?regions=nyiso' },
  { label: 'NYISO Real-Time Dashboard', url: 'https://www.nyiso.com/real-time-dashboard' },
  { label: 'Potomac Economics Reports', url: 'https://www.potomaceconomics.com/markets-monitored/new-york-iso/' },
  { label: 'ISO-NE Dashboard', url: 'https://www.iso-ne.com/isoexpress/' },
  { label: 'PJM Data Viewer', url: 'https://dataviewer.pjm.com/dataviewer/pages/public/load.jsf' },
  { label: 'Iroqouis-Z2 Gas Notices', url: 'https://ioly.iroquois.com/infopost/#critical' },
  { label: 'Tetco-M3 Gas Notices', url: 'https://infopost.enbridge.com/infopost/TEHome.asp?Pipe=TE' },
  { label: 'Transco-Z6 Gas Notices', url: 'https://www.1line.williams.com/Transco/info-postings/notices/critical-notices.html' },
  { label: 'TGP-Z5 Gas Notices', url: 'https://pipeline2.kindermorgan.com/Notices/Notices.aspx?type=C&code=TGP'},
  { label: 'IESO Market Data', url: 'https://www.ieso.ca/' },
];

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

interface DailyEventsData {
  date: string;
  available_dates: string[];
  rt_events: { timestamp: string; message: string }[];
  oper_messages: { insert_time: string; message: string }[];
  rt_events_raw: string;
  oper_messages_raw: string;
}

function LiveSystemContext() {
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [data, setData] = useState<DailyEventsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRawRt, setShowRawRt] = useState(false);
  const [showRawOper, setShowRawOper] = useState(false);

  const fetchEvents = useCallback((date: string) => {
    setLoading(true);
    fetch(`/api/daily-events?date=${date}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchEvents(selectedDate); }, [selectedDate, fetchEvents]);

  const availableDates = data?.available_dates || [];

  const navigateDate = (dir: number) => {
    const idx = availableDates.indexOf(selectedDate);
    if (dir === -1) {
      const next = idx >= 0 && idx < availableDates.length - 1 ? availableDates[idx + 1] : null;
      if (next) setSelectedDate(next);
    } else {
      const next = idx > 0 ? availableDates[idx - 1] : null;
      if (next) setSelectedDate(next);
    }
  };

  const isToday = selectedDate === todayStr();
  const canGoBack = availableDates.indexOf(selectedDate) < availableDates.length - 1;
  const canGoForward = availableDates.indexOf(selectedDate) > 0;

  const formatDate = (d: string) => {
    const date = new Date(d + 'T12:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="section-container">
      <div className="daily-events-header">
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0 }}>
          <span className="live-dot" />
          Live System Context
        </div>
        <div className="date-nav">
          <button className="date-nav-btn" onClick={() => navigateDate(-1)} disabled={!canGoBack}>&larr;</button>
          <select
            className="date-select"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          >
            {availableDates.map(d => (
              <option key={d} value={d}>{formatDate(d)}{d === todayStr() ? ' (Today)' : ''}</option>
            ))}
          </select>
          <button className="date-nav-btn" onClick={() => navigateDate(1)} disabled={!canGoForward}>&rarr;</button>
          {!isToday && (
            <button className="date-today-btn" onClick={() => setSelectedDate(todayStr())}>Today</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="live-feed-empty">Loading events...</div>
      ) : (
        <div className="live-context-grid">
          <div className="live-feed-card">
            <div className="live-feed-card-header">
              <div className="live-feed-title">Real-Time Events</div>
              {data?.rt_events_raw && (
                <button className="raw-toggle-btn" onClick={() => setShowRawRt(!showRawRt)}>
                  {showRawRt ? 'Parsed' : 'Raw'}
                </button>
              )}
            </div>
            {showRawRt && data?.rt_events_raw ? (
              <pre className="raw-file-text">{data.rt_events_raw}</pre>
            ) : !data?.rt_events?.length ? (
              <div className="live-feed-empty">No events for {formatDate(selectedDate)}</div>
            ) : (
              <div className="live-feed-list full">
                {data.rt_events.map((r, i) => (
                  <div className="live-feed-item" key={i}>
                    <div className="live-feed-ts">{r.timestamp.replace(/^\d{2}\/\d{2}\/\d{4}\s*/, '').slice(0, 8) || r.timestamp}</div>
                    <div className="live-feed-msg">{r.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="live-feed-card">
            <div className="live-feed-card-header">
              <div className="live-feed-title">Operational Announcements</div>
              {data?.oper_messages_raw && (
                <button className="raw-toggle-btn" onClick={() => setShowRawOper(!showRawOper)}>
                  {showRawOper ? 'Parsed' : 'Raw'}
                </button>
              )}
            </div>
            {showRawOper && data?.oper_messages_raw ? (
              <pre className="raw-file-text">{data.oper_messages_raw}</pre>
            ) : !data?.oper_messages?.length ? (
              <div className="live-feed-empty">No announcements for {formatDate(selectedDate)}</div>
            ) : (
              <div className="live-feed-list full">
                {data.oper_messages.map((r, i) => (
                  <div className="live-feed-item oper" key={i}>
                    <div className="live-feed-ts">{r.insert_time}</div>
                    <div className="live-feed-msg">{r.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { inventory, loading } = useInventory();
  const [refOpen, setRefOpen] = useState(false);

  const { data: priceData } = useDataset('da_lbmp_zone', 'daily', undefined, undefined, 10000, 30);
  const { data: demandData } = useDataset('isolf', 'daily', undefined, undefined, 10000, 30);

  const totalDatasets = inventory
    ? Object.values(inventory).reduce((sum: number, page: any) => sum + Object.keys(page).length, 0) : 0;
  const availableDatasets = inventory
    ? Object.values(inventory).reduce((sum: number, page: any) =>
        sum + Object.values(page).filter((d: any) => d.status === 'available').length, 0) : 0;

  const latestPrice = priceData?.data?.length
    ? (() => {
        const nycRows = priceData.data.filter((r: any) => r.Zone === 'N.Y.C.');
        if (!nycRows.length) return null;
        const last = nycRows[nycRows.length - 1];
        return { zone: 'N.Y.C.', lmp: Number(last.LMP).toFixed(2) };
      })()
    : null;

  const peakLoad = demandData?.data?.length
    ? (() => {
        const vals = demandData.data.map((r: any) => Number(r.NYISO || r['N.Y.C.'] || 0)).filter(Boolean);
        return vals.length ? Math.max(...vals).toLocaleString(undefined, { maximumFractionDigits: 0 }) : null;
      })()
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Market Overview</h1>
        <p className="page-subtitle">
          NYISO electricity market intelligence — prices, demand, generation, flows, and arbitrage opportunities
        </p>
      </div>

      {availableDatasets === 0 && !loading && <EmptyState />}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kpi-card">
          <div className="kpi-label">Latest DA LMP (NYC)</div>
          <div className="kpi-value">
            {latestPrice ? <>{latestPrice.lmp}<span className="kpi-unit">$/MWh</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Peak System Load</div>
          <div className="kpi-value">
            {peakLoad ? <>{peakLoad}<span className="kpi-unit">MW</span></> : '—'}
          </div>
        </div>
        <div className="kpi-card accent">
          <div className="kpi-label">Datasets Available</div>
          <div className="kpi-value">{availableDatasets}<span className="kpi-unit">/ {totalDatasets}</span></div>
        </div>
      </div>

      <LiveSystemContext />

      <div className="section-container">
        <div className="section-title">Navigate</div>
        <div className="home-grid">
          {NAV_CARDS.map(c => (
            <Link key={c.path} to={c.path} className={`home-card${c.category === 'hero' ? ' hero-card' : ''}`}>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="section-container">
        <div className="section-title">Resources</div>
        <div className="links-grid">
          {USEFUL_LINKS.map(l => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="link-card">
              <div className="link-label">{l.label}</div>
              <div className="link-url">{l.url}</div>
            </a>
          ))}
        </div>
      </div>

      <div className="section-container">
        <div
          className="collapsible-header"
          onClick={() => setRefOpen(!refOpen)}
          style={{ marginBottom: refOpen ? 0 : 12 }}
        >
          <span className="chevron">{refOpen ? '▾' : '▸'}</span>
          Reference Data & System Tables
        </div>
        {refOpen && (
          <div style={{ marginTop: 8 }}>
            <DatasetSection datasetKey="generator_names" resolution="raw" />
            <DatasetSection datasetKey="load_names" resolution="raw" />
            <DatasetSection datasetKey="active_transmission_nodes" resolution="raw" />

            {inventory && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="card-title">Data Inventory</div>
                {Object.entries(inventory).map(([page, datasets]: [string, any]) => (
                  <div key={page} style={{ marginBottom: 16 }}>
                    <h3 style={{ textTransform: 'capitalize', marginBottom: 8 }}>{page}</h3>
                    <div className="inventory-grid">
                      {Object.entries(datasets).map(([key, info]: [string, any]) => (
                        <div key={key} className="inv-item">
                          <div className="inv-name">{info.label || key}</div>
                          <div className="inv-rows">
                            <span className={`badge badge-${info.status === 'available' ? 'success' : 'warning'}`}>
                              {info.status}
                            </span>
                            {info.rows > 0 && ` ${info.rows.toLocaleString()} rows`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
