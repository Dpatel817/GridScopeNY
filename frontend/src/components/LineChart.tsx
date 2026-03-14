import {
  LineChart as ReLineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

const COLORS = ['#0d6efd','#198754','#dc3545','#fd7e14','#6f42c1','#20c997','#0dcaf0','#ffc107']

interface Props {
  data: Record<string, unknown>[]
  xKey: string
  yKeys: string[]
  title?: string
  height?: number
}

function fmtX(v: unknown): string {
  if (!v) return ''
  const s = String(v)
  if (s.includes('T')) {
    try {
      const d = new Date(s)
      return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`
    } catch { return s }
  }
  return s.length > 12 ? s.slice(0, 12) : s
}

export default function LineChart({ data, xKey, yKeys, title, height = 300 }: Props) {
  if (!data.length) return <div className="empty-state" style={{ padding: 24 }}>No chart data</div>
  return (
    <div>
      {title && <div className="card-title">{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <ReLineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} tickFormatter={fmtX} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toFixed(2) : v} labelFormatter={fmtX} />
          {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {yKeys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={1.5} />
          ))}
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  )
}
