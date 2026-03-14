import { Link } from 'react-router-dom'
import { useInventory } from '../hooks/useDataset'

const PAGES = [
  { path: '/prices', icon: '💲', label: 'Prices', desc: 'DA/RT LBMP by zone & generator' },
  { path: '/demand', icon: '📈', label: 'Demand', desc: 'ISO load forecasts & weather' },
  { path: '/generation', icon: '⚡', label: 'Generation', desc: 'Fuel mix, outages & commitments' },
  { path: '/interfaces', icon: '🔌', label: 'Interface Flows', desc: 'External flows, ATC/TTC & PAR' },
  { path: '/congestion', icon: '🚧', label: 'Congestion', desc: 'Limiting constraints & outages' },
  { path: '/opportunities', icon: '🔎', label: 'Opportunity Explorer', desc: 'Rank market opportunities' },
  { path: '/ai-explainer', icon: '🤖', label: 'AI Explainer', desc: 'Ask about NYISO market behavior' },
]

export default function Home() {
  const { inventory, loading } = useInventory()

  const totalRows = inventory
    ? Object.values(inventory).flatMap(cat => Object.values(cat)).reduce((sum, ds) => sum + (ds.rows || 0), 0)
    : 0

  const availableDatasets = inventory
    ? Object.values(inventory).flatMap(cat => Object.values(cat)).filter(ds => ds.status === 'available').length
    : 0

  const totalDatasets = inventory
    ? Object.values(inventory).flatMap(cat => Object.values(cat)).length
    : 0

  return (
    <div className="page">
      <div className="page-header">
        <h1>GridScope NY</h1>
        <p>NYISO market dashboard — prices, demand, generation, flows, congestion & AI analysis</p>
      </div>

      {!loading && (
        <div className="metrics-row" style={{ marginBottom: 24 }}>
          <div className="metric-card">
            <div className="metric-label">Datasets Available</div>
            <div className="metric-value">{availableDatasets}<span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/{totalDatasets}</span></div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Rows Loaded</div>
            <div className="metric-value">{totalRows.toLocaleString()}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Data Source</div>
            <div className="metric-value" style={{ fontSize: '1rem' }}>NYISO MIS</div>
          </div>
        </div>
      )}

      {!loading && totalRows === 0 && (
        <div className="alert alert-warning">
          No processed data found. Use the <strong>Fetch & Process Data</strong> button on any page to run the ETL pipeline.
        </div>
      )}

      <h2 style={{ marginBottom: 4 }}>Navigate</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>Select a section to explore NYISO market data</p>
      <div className="home-grid">
        {PAGES.map(p => (
          <Link key={p.path} to={p.path} className="home-card">
            <div className="card-icon">{p.icon}</div>
            <h3>{p.label}</h3>
            <p>{p.desc}</p>
          </Link>
        ))}
      </div>

      {inventory && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-title">Data Inventory</div>
          {Object.entries(inventory).map(([cat, datasets]) => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize', marginBottom: 8, color: 'var(--text-muted)' }}>{cat}</div>
              <div className="inventory-grid">
                {Object.entries(datasets).map(([name, info]) => (
                  <div key={name} className="inv-item">
                    <div className="inv-name">{name}</div>
                    <div className="inv-rows">
                      <span style={{ color: info.status === 'available' ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                        {info.status === 'available' ? '●' : '○'}
                      </span>{' '}
                      {info.rows?.toLocaleString() ?? 0} rows
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
