export type WidgetSize = 'full' | 'half' | 'third' | 'two-thirds';

interface WidgetProps {
  title: string;
  subtitle?: string;
  size?: WidgetSize;
  badge?: React.ReactNode;
  controls?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  noPad?: boolean;
  className?: string;
  /** When true, shows a drag handle in the header (used inside DraggableGrid) */
  draggable?: boolean;
}

export default function Widget({
  title,
  subtitle,
  size = 'full',
  badge,
  controls,
  actions,
  children,
  noPad = false,
  className = '',
  draggable = false,
}: WidgetProps) {
  return (
    <div className={`widget widget-${size} ${className}`} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="widget-header">
        {draggable && (
          <span className="widget-drag-handle" title="Drag to reorder">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="3" cy="2" r="1.2" /><circle cx="9" cy="2" r="1.2" />
              <circle cx="3" cy="6" r="1.2" /><circle cx="9" cy="6" r="1.2" />
              <circle cx="3" cy="10" r="1.2" /><circle cx="9" cy="10" r="1.2" />
            </svg>
          </span>
        )}
        <div className="widget-header-left" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div className="widget-title">{title}</div>
            {subtitle && <div className="widget-subtitle">{subtitle}</div>}
          </div>
        </div>
        <div className="widget-header-right" onClick={e => e.stopPropagation()}>
          {actions}
          {badge && <span className="widget-badge">{badge}</span>}
        </div>
      </div>

      <div className={noPad ? 'widget-body-nopad' : 'widget-body'} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {controls && (
          <div className="widget-controls-sidebar">
            {controls}
          </div>
        )}
        <div className={controls ? 'widget-content-with-controls' : undefined} style={{ height: '100%' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
