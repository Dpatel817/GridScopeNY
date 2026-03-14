import { Outlet, NavLink } from 'react-router-dom'

const NAV = [
  { path: '/', label: 'Home', icon: '🏠', end: true },
  { path: '/prices', label: 'Prices', icon: '💲' },
  { path: '/demand', label: 'Demand', icon: '📈' },
  { path: '/generation', label: 'Generation', icon: '⚡' },
  { path: '/interfaces', label: 'Interface Flows', icon: '🔌' },
  { path: '/congestion', label: 'Congestion', icon: '🚧' },
  { path: '/opportunities', label: 'Opportunity Explorer', icon: '🔎' },
  { path: '/ai-explainer', label: 'AI Explainer', icon: '🤖' },
]

export default function Layout() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>GridScopeNY</h2>
          <p>NYISO market intelligence</p>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">Source: NYISO MIS</div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
