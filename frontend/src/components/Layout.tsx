import { Outlet, NavLink } from 'react-router-dom'
import { useDataRefresh } from '../hooks/useDataRefresh'

const MARKET_NAV = [
  { path: '/prices', label: 'Prices', icon: '💲' },
  { path: '/demand', label: 'Demand', icon: '📊' },
  { path: '/generation', label: 'Generation', icon: '⚡' },
  { path: '/interfaces', label: 'Interface Flows', icon: '🔌' },
  { path: '/congestion', label: 'Congestion', icon: '🚧' },
  { path: '/generator-map', label: 'Generator Map', icon: '📍' },
]

const TOOL_NAV = [
  { path: '/opportunities', label: 'Opportunity & Insight Explorer', icon: '🎯', hero: true },
  { path: '/ai-explainer', label: 'AI Market Analyst', icon: '🤖' },
]

function formatTime(date: Date | null) {
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Layout() {
  const { refreshing, lastRefresh, error, fullRefresh, autoRefreshEnabled, toggleAutoRefresh } = useDataRefresh();

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
            <span className="nav-icon">🏠</span>
            Overview
          </NavLink>

          <div className="sidebar-section">Market Data</div>
          {MARKET_NAV.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          <div className="sidebar-section">Intelligence</div>
          {TOOL_NAV.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}${'hero' in item && item.hero ? ' hero' : ''}`
              }
            >
              <span className="nav-icon">{item.icon}</span>
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
    </div>
  )
}
