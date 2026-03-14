import { Link } from 'react-router-dom';
import { useInventory } from '../hooks/useDataset';
import EmptyState from '../components/EmptyState';
import DatasetSection from '../components/DatasetSection';

const NAV_CARDS = [
  { path: '/prices', icon: '💲', title: 'Prices', desc: 'DA/RT LBMP by zone & generator' },
  { path: '/demand', icon: '📈', title: 'Demand', desc: 'ISO load forecasts & weather' },
  { path: '/generation', icon: '⚡', title: 'Generation', desc: 'Fuel mix, outages & commitments' },
  { path: '/interfaces', icon: '🔌', title: 'Interface Flows', desc: 'External flows, ATC/TTC & PAR' },
  { path: '/congestion', icon: '🚧', title: 'Congestion', desc: 'Limiting constraints & outages' },
  { path: '/opportunities', icon: '🔎', title: 'Opportunity Explorer', desc: 'Rank market opportunities' },
  { path: '/ai-explainer', icon: '🤖', title: 'AI Explainer', desc: 'Ask about NYISO market behavior' },
];

const USEFUL_LINKS = [
  { label: 'NYISO Real-Time Dashboard', url: 'https://www.nyiso.com/real-time-dashboard' },
  { label: 'Modo Energy NYISO Research', url: 'https://modoenergy.com/research?regions=nyiso' },
  { label: 'ISO-NE Dashboard', url: 'https://www.iso-ne.com/isoexpress/' },
  { label: 'PJM Data Viewer', url: 'https://dataviewer.pjm.com/dataviewer/pages/public/load.jsf' },
  { label: 'Potomac Economics Reports', url: 'https://www.potomaceconomics.com/markets-monitored/new-york-iso/' },
  { label: 'Iroquois Z2 Critical Notices', url: 'https://ioly.iroquois.com/infopost/#critical' },
  { label: 'TETCO M3 Critical Notices', url: 'https://infopost.enbridge.com/infopost/TEHome.asp?Pipe=TE' },
  { label: 'Transco Z6 Critical Notices', url: 'https://www.1line.williams.com/Transco/info-postings/notices/critical-notices.html' },
  { label: 'TGP Z5 Critical Notices', url: 'https://pipeline2.kindermorgan.com/Notices/Notices.aspx?type=C&code=TGP' },
];

export default function Home() {
  const { inventory, loading } = useInventory();

  const totalDatasets = inventory
    ? Object.values(inventory).reduce((sum: number, page: any) => sum + Object.keys(page).length, 0)
    : 0;
  const availableDatasets = inventory
    ? Object.values(inventory).reduce((sum: number, page: any) =>
        sum + Object.values(page).filter((d: any) => d.status === 'available').length, 0)
    : 0;
  const totalRows = inventory
    ? Object.values(inventory).reduce((sum: number, page: any) =>
        sum + Object.values(page).reduce((s: number, d: any) => s + (d.rows || 0), 0), 0)
    : 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>GridScope NY</h1>
        <p>NYISO market dashboard — prices, demand, generation, flows, congestion & AI analysis</p>
      </div>

      <div className="metrics-row">
        <div className="metric-card">
          <div className="metric-label">Datasets Available</div>
          <div className="metric-value">{availableDatasets}<span style={{ fontSize: '0.7em', color: 'var(--text-muted)' }}>/{totalDatasets}</span></div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Rows Loaded</div>
          <div className="metric-value">{totalRows.toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Data Source</div>
          <div className="metric-value">NYISO MIS</div>
        </div>
      </div>

      {availableDatasets === 0 && !loading && <EmptyState />}

      <h2>Navigate</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>Select a section to explore NYISO market data</p>
      <div className="home-grid">
        {NAV_CARDS.map(c => (
          <Link key={c.path} to={c.path} className="home-card">
            <div className="card-icon">{c.icon}</div>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
          </Link>
        ))}
      </div>

      <h2 style={{ marginTop: 28 }}>Reference Data</h2>
      <DatasetSection datasetKey="rt_events" resolution="raw" defaultExpanded={true} />
      <DatasetSection datasetKey="oper_messages" resolution="raw" />
      <DatasetSection datasetKey="generator_names" resolution="raw" />
      <DatasetSection datasetKey="load_names" resolution="raw" />
      <DatasetSection datasetKey="active_transmission_nodes" resolution="raw" />
      <DatasetSection datasetKey="zonal_uplift" resolution="raw" />
      <DatasetSection datasetKey="resource_uplift" resolution="raw" />

      <h2 style={{ marginTop: 28 }}>Useful Links</h2>
      <div className="links-grid">
        {USEFUL_LINKS.map(l => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="link-card">
            <div className="link-label">{l.label}</div>
            <div className="link-url">{l.url}</div>
          </a>
        ))}
      </div>

      {inventory && (
        <>
          <h2 style={{ marginTop: 28 }}>Data Inventory</h2>
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
        </>
      )}
    </div>
  );
}
