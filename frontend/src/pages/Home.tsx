import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInventory, useDataset } from '../hooks/useDataset';
import EmptyState from '../components/EmptyState';
import DatasetSection from '../components/DatasetSection';

const NAV_CARDS = [
  { path: '/prices', icon: '💲', title: 'Prices', desc: 'DA/RT LBMP spreads, ancillary services, CTS', category: 'market' },
  { path: '/demand', icon: '📊', title: 'Demand Intelligence', desc: 'Load forecasts, actuals, forecast errors', category: 'market' },
  { path: '/generation', icon: '⚡', title: 'Generation', desc: 'Fuel mix, commitments, BTM solar, maintenance', category: 'market' },
  { path: '/interfaces', icon: '🔌', title: 'Interface Flows', desc: 'Transmission pressure, ATC/TTC, derates', category: 'market' },
  { path: '/congestion', icon: '🚧', title: 'Congestion', desc: 'Binding constraints, outage schedules', category: 'market' },
  { path: '/opportunities', icon: '🎯', title: 'Opportunity Explorer', desc: 'Battery arbitrage rankings by zone & duration', category: 'hero' },
  { path: '/ai-explainer', icon: '🤖', title: 'AI Analyst', desc: 'Ask questions about market behavior', category: 'tool' },
];

const USEFUL_LINKS = [
  { label: 'NYISO Real-Time Dashboard', url: 'https://www.nyiso.com/real-time-dashboard' },
  { label: 'Modo Energy NYISO Research', url: 'https://modoenergy.com/research?regions=nyiso' },
  { label: 'Potomac Economics Reports', url: 'https://www.potomaceconomics.com/markets-monitored/new-york-iso/' },
  { label: 'ISO-NE Dashboard', url: 'https://www.iso-ne.com/isoexpress/' },
  { label: 'PJM Data Viewer', url: 'https://dataviewer.pjm.com/dataviewer/pages/public/load.jsf' },
];

export default function Home() {
  const { inventory, loading } = useInventory();
  const [refOpen, setRefOpen] = useState(false);

  const { data: priceData } = useDataset('da_lbmp_zone', 'hourly');
  const { data: demandData } = useDataset('isolf', 'hourly');

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

      <div className="section-container">
        <div className="section-title">Recommended Workflow</div>
        <div className="workflow-steps">
          <div className="workflow-step">
            <div className="step-num">1</div>
            <div className="step-text"><strong>Check the market</strong> — review prices, demand, and generation for current conditions</div>
          </div>
          <div className="workflow-step">
            <div className="step-num">2</div>
            <div className="step-text"><strong>Understand drivers</strong> — examine congestion, interface flows, and outages</div>
          </div>
          <div className="workflow-step">
            <div className="step-num">3</div>
            <div className="step-text"><strong>Find opportunities</strong> — use the Opportunity Explorer to rank zones by arbitrage potential</div>
          </div>
        </div>
      </div>

      <div className="section-container">
        <div className="section-title">Navigate</div>
        <div className="home-grid">
          {NAV_CARDS.map(c => (
            <Link key={c.path} to={c.path} className={`home-card${c.category === 'hero' ? ' hero-card' : ''}`}>
              <div className="card-icon">{c.icon}</div>
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
            <DatasetSection datasetKey="rt_events" resolution="raw" defaultExpanded={true} />
            <DatasetSection datasetKey="oper_messages" resolution="raw" />
            <DatasetSection datasetKey="generator_names" resolution="raw" />
            <DatasetSection datasetKey="load_names" resolution="raw" />
            <DatasetSection datasetKey="active_transmission_nodes" resolution="raw" />
            <DatasetSection datasetKey="zonal_uplift" resolution="raw" />
            <DatasetSection datasetKey="resource_uplift" resolution="raw" />

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
