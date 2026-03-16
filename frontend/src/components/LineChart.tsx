import { useMemo } from 'react'
import {
  LineChart as ReLineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { makeTickFormatter, tooltipLabelFormatter } from '../utils/dateFormat'

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

export default function LineChart({ data, xKey, yKeys, title, height = 300 }: Props) {
  const fmtTick = useMemo(() => makeTickFormatter(data, xKey), [data, xKey])

  if (!data.length) return <div className="empty-state" style={{ padding: 24 }}>No chart data</div>
  return (
    <div>
      {title && <div className="card-title">{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <ReLineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} tickFormatter={fmtTick} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v: number | string) => typeof v === 'number' ? v.toFixed(2) : v}
            labelFormatter={tooltipLabelFormatter}
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
