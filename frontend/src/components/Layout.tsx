import { Outlet, NavLink, useLocation } from 'react-router-dom'
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

export default function Layout() {
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
          <div className="sidebar-status">
            <span className="status-dot" />
            NYISO Market Data
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
