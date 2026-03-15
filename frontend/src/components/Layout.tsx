import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useDataRefresh } from '../hooks/useDataRefresh'
import MarketAnalystWidget from './MarketAnalystWidget'

const MARKET_NAV = [
  { path: '/prices', label: 'Prices' },
  { path: '/demand', label: 'Demand' },
  { path: '/generation', label: 'Generation' },
  { path: '/interfaces', label: 'Interface Flows' },
  { path: '/congestion', label: 'Congestion' },
  { path: '/interconnection-queue', label: 'Interconnection Queue' },
]

const TOOL_NAV = [
  { path: '/opportunities', label: 'Opportunity Explorer', hero: true },
]

function formatTime(date: Date | null) {
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Layout() {
  const { refreshing, lastRefresh, error, fullRefresh, autoRefreshEnabled, toggleAutoRefresh } = useDataRefresh();
  const location = useLocation();

  const currentPage = (() => {
    const p = location.pathname;
    if (p === '/') return 'overview';
    if (p.startsWith('/prices')) return 'prices';
    if (p.startsWith('/demand')) return 'demand';
    if (p.startsWith('/generation')) return 'generation';
    if (p.startsWith('/interfaces')) return 'interfaces';
    if (p.startsWith('/congestion')) return 'congestion';
    if (p.startsWith('/opportunities')) return 'opportunities';
    if (p.startsWith('/interconnection')) return 'interconnection';
    return 'overview';
  })();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-name">
            <span className="brand-icon">GS</span>
            GridScopeNY
          </div>
          <div className="sidebar-brand-sub">NYISO Market Intelligence</div>
        </div>
        <nav className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            Overview
          </NavLink>

          <div className="sidebar-section">Market Data</div>
          {MARKET_NAV.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}

          <div className="sidebar-section">Intelligence</div>
          {TOOL_NAV.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}${item.hero ? ' hero' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="refresh-controls">
            <button
              className={`refresh-btn${refreshing ? ' refreshing' : ''}`}
              onClick={() => fullRefresh()}
              disabled={refreshing}
              title={refreshing ? 'Refreshing data...' : 'Fetch latest data from NYISO'}
            >
              <span className={`refresh-icon${refreshing ? ' spin' : ''}`}>↻</span>
              {refreshing ? 'Refreshing...' : 'Refresh Data'}
            </button>
            <div className="refresh-meta">
              <label className="auto-refresh-toggle" title="Auto-refresh every 5 minutes">
                <input
                  type="checkbox"
                  checked={autoRefreshEnabled}
                  onChange={toggleAutoRefresh}
                />
                <span>Auto</span>
              </label>
              {lastRefresh && (
                <span className="last-refresh">Updated {formatTime(lastRefresh)}</span>
              )}
              {error && (
                <span className="refresh-error" title={error}>!</span>
              )}
            </div>
          </div>
          <div className="sidebar-status">
            <span className="status-dot" />
            Live data from NYISO MIS
          </div>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
      <MarketAnalystWidget currentPage={currentPage} />
    </div>
  )
}
