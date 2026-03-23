import { useState, useRef, useEffect } from 'react';

export type WidgetSize = 'full' | 'half' | 'third' | 'two-thirds';

interface WidgetProps {
  title: string;
  subtitle?: string;
  size?: WidgetSize;
  defaultCollapsed?: boolean;
  badge?: React.ReactNode;
  controls?: React.ReactNode;  // rendered in a slide-down panel
  actions?: React.ReactNode;   // rendered inline in header (tabs, pills, etc.)
  children: React.ReactNode;
  noPad?: boolean;
  className?: string;
}

export default function Widget({
  title,
  subtitle,
  size = 'full',
  defaultCollapsed = false,
  badge,
  controls,
  actions,
  children,
  noPad = false,
  className = '',
}: WidgetProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  // Close controls panel on outside click
  useEffect(() => {
    if (!controlsOpen) return;
    const handler = (e: MouseEvent) => {
      if (controlsRef.current && !controlsRef.current.contains(e.target as Node)) {
        setControlsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [controlsOpen]);

  return (
    <div className={`widget widget-${size} ${className}`}>
      <div className="widget-header" onClick={() => setCollapsed(c => !c)}>
        <div className="widget-header-left">
          <span className={`widget-chevron${collapsed ? ' collapsed' : ''}`}>▾</span>
          <div>
            <div className="widget-title">{title}</div>
            {subtitle && <div className="widget-subtitle">{subtitle}</div>}
          </div>
        </div>
        <div className="widget-header-right" onClick={e => e.stopPropagation()}>
          {actions}
          {badge && <span className="widget-badge">{badge}</span>}
          {controls && (
            <button
              className={`widget-controls-btn${controlsOpen ? ' active' : ''}`}
              onClick={() => setControlsOpen(o => !o)}
              title="Chart controls"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
                <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
                <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
                <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none" />
              </svg>
              Controls
            </button>
          )}
        </div>
      </div>

      {!collapsed && controls && controlsOpen && (
        <div className="widget-controls-panel" ref={controlsRef}>
          {controls}
        </div>
      )}

      {!collapsed && (
        <div className={noPad ? 'widget-body-nopad' : 'widget-body'}>
          {children}
        </div>
      )}
    </div>
  );
}
