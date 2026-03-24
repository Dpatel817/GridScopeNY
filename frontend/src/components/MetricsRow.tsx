import type { Metric } from '../utils/metricsUtils';

interface Props { metrics: Metric[] }

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return isNaN(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return String(v)
}

export default function MetricsRow({ metrics }: Props) {
  if (!metrics.length) return null
  return (
    <div className="metrics-row">
      {metrics.map(m => (
        <div key={m.label} className="metric-card">
          <div className="metric-label">{m.label}</div>
          <div className="metric-value">{fmt(m.value)}</div>
        </div>
      ))}
    </div>
  )
}
