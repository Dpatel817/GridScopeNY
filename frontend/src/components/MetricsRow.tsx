interface Metric { label: string; value: string | number }

interface Props { metrics: Metric[] }

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return isNaN(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return String(v)
}

export function buildMetrics(data: Record<string, unknown>[], col: string): Metric[] {
  if (!data.length || !col) return []
  const vals = data.map(r => r[col]).filter(v => v !== null && v !== undefined && !isNaN(Number(v))).map(Number)
  if (!vals.length) return []
  const sum = vals.reduce((a, b) => a + b, 0)
  return [
    { label: `Avg ${col}`, value: (sum / vals.length).toFixed(2) },
    { label: `Max ${col}`, value: Math.max(...vals).toFixed(2) },
    { label: `Min ${col}`, value: Math.min(...vals).toFixed(2) },
    { label: 'Rows', value: data.length.toLocaleString() },
  ]
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
