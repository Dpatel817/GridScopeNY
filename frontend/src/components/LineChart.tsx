import {
  LineChart as ReLineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

const COLORS = [
  '#2563eb','#10b981','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#14b8a6',
  '#6366f1','#84cc16','#f97316','#a855f7','#0ea5e9','#e11d48','#22c55e','#eab308'
]

interface Props {
  data: Record<string, unknown>[]
  xKey: string
  yKeys: string[]
  title?: string
  height?: number
}

function fmtX(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const s = String(v)
  if (s === 'undefined' || s === 'null' || s === 'NaN') return ''
  if (s.includes('T')) {
    try {
      const d = new Date(s)
      if (isNaN(d.getTime())) return s.length > 14 ? s.slice(0, 14) : s
      return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch { return s }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const parts = s.split('-')
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`
  }
  return s.length > 16 ? s.slice(0, 16) : s
}

export default function LineChart({ data, xKey, yKeys, title, height = 300 }: Props) {
  if (!data.length) return <div className="empty-state" style={{ padding: 24 }}>No chart data</div>
  return (
    <div>
      {title && <div className="card-title">{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <ReLineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} tickFormatter={fmtX} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v: number | string) => typeof v === 'number' ? v.toFixed(2) : v}
            labelFormatter={fmtX}
          />
          {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {yKeys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={1.5} />
          ))}
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  )
}
