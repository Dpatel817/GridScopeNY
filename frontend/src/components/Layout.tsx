import { Outlet, NavLink } from 'react-router-dom'

const MARKET_NAV = [
  { path: '/prices', label: 'Prices', icon: '💲' },
  { path: '/demand', label: 'Demand', icon: '📊' },
  { path: '/generation', label: 'Generation', icon: '⚡' },
  { path: '/interfaces', label: 'Interface Flows', icon: '🔌' },
  { path: '/congestion', label: 'Congestion', icon: '🚧' },
  { path: '/generator-map', label: 'Generator Map', icon: '📍' },
]

const TOOL_NAV = [
  { path: '/opportunities', label: 'Opportunity Explorer', icon: '🎯', hero: true },
  { path: '/ai-explainer', label: 'AI Analyst', icon: '🤖' },
]

export default function Layout() {
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

          <div className="sidebar-section">Tools</div>
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
          <span className="status-dot" />
          Live data from NYISO MIS
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
