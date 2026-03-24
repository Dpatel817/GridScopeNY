import { useState, useEffect } from 'react'
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

type Theme = 'dark' | 'light'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('gs-theme')
    if (stored === 'dark' || stored === 'light') return stored
  } catch { /* ignore */ }
  return 'dark'
}

export default function Layout() {
  const location = useLocation()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })

  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  // Apply theme to <html> element so CSS vars cascade everywhere
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('gs-theme', theme) } catch { /* ignore */ }
  }, [theme])

  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed)) } catch { /* ignore */ }
  }, [sidebarCollapsed])

  const currentPage = (() => {
    const p = location.pathname
    if (p === '/') return 'overview'
    if (p.startsWith('/prices')) return 'prices'
    if (p.startsWith('/demand')) return 'demand'
    if (p.startsWith('/generation')) return 'generation'
    if (p.startsWith('/interfaces')) return 'interfaces'
    if (p.startsWith('/congestion')) return 'congestion'
    if (p.startsWith('/opportunities')) return 'opportunities'
    if (p.startsWith('/interconnection')) return 'interconnection'
    return 'overview'
  })()

  return (
    <div className={`layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-name">
            <span className="brand-icon">GS</span>
            GridScopeNY
          </div>
          <div className="sidebar-brand-sub">NYISO Market Intelligence</div>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(true)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
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

        {/* Theme toggle */}
        <div className="theme-toggle" role="group" aria-label="Color theme">
          <button
            className={`theme-toggle-btn${theme === 'dark' ? ' active' : ''}`}
            onClick={() => setTheme('dark')}
            aria-pressed={theme === 'dark'}
            title="Dark theme"
          >
            <span className="theme-toggle-icon">🌙</span>
            Dark
          </button>
          <button
            className={`theme-toggle-btn${theme === 'light' ? ' active' : ''}`}
            onClick={() => setTheme('light')}
            aria-pressed={theme === 'light'}
            title="Light theme"
          >
            <span className="theme-toggle-icon">☀️</span>
            Light
          </button>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className="status-dot" />
            NYISO Market Data
          </div>
        </div>
      </aside>

      {sidebarCollapsed && (
        <button
          className="sidebar-toggle sidebar-toggle-floating"
          onClick={() => setSidebarCollapsed(false)}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      )}

      <main className="main-content">
        <Outlet />
      </main>
      <MarketAnalystWidget currentPage={currentPage} />
    </div>
  )
}
