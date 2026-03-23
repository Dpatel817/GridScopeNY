/**
 * KPIWidget — a full-width widget that renders a responsive KPI strip.
 * Wraps the existing kpi-card pattern in a proper widget shell.
 */
import Widget from './Widget';
import type { WidgetSize } from './Widget';

interface KPIItem {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
}

interface KPIWidgetProps {
  title: string;
  subtitle?: string;
  kpis: KPIItem[];
  size?: WidgetSize;
  loading?: boolean;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function KPIWidget({ title, subtitle, kpis, size = 'full', loading, badge, actions }: KPIWidgetProps) {
  return (
    <Widget title={title} subtitle={subtitle} size={size} badge={badge} actions={actions}>
      {loading ? (
        <div className="loading"><div className="spinner" /> Loading...</div>
      ) : (
        <div className="kpi-grid price-kpi-grid">
          {kpis.map((k, i) => (
            <div key={i} className={`kpi-card${k.accent ? ' accent' : ''}`}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
              {k.sub && <div className="kpi-sub">{k.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}
