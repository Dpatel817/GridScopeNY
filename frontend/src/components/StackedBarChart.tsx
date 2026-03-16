import { useMemo } from 'react'
import {
  BarChart as ReBarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { makeTickFormatter, getTickInterval, tooltipLabelFormatter } from '../utils/dateFormat'

const COLORS = [
  '#2563eb','#10b981','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#14b8a6',
  '#6366f1','#84cc16','#f97316','#a855f7','#0ea5e9','#e11d48','#22c55e','#eab308'
]

interface Props {
  data: Record<string, unknown>[]
  xKey: string
  yKeys: string[]
  height?: number
  labelPrefix?: string
}

export default function StackedBarChart({ data, xKey, yKeys, height = 320, labelPrefix = '' }: Props) {
  const fmtTick = useMemo(() => makeTickFormatter(data, xKey), [data, xKey])
  const interval = useMemo(() => getTickInterval(data, xKey), [data, xKey])
  const fmtTooltipLabel = useMemo(() => tooltipLabelFormatter(data, xKey), [data, xKey])

  if (!data.length || !yKeys.length) return <div className="empty-state" style={{ padding: 24 }}>No chart data</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={fmtTick} tick={{ fontSize: 11 }} interval={interval} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number | string) => typeof v === 'number' ? `${labelPrefix}${v.toFixed(2)}` : v}
          labelFormatter={fmtTooltipLabel}
          contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}
        />
        {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {yKeys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="stack"
            fill={COLORS[i % COLORS.length]}
            maxBarSize={40}
          />
        ))}
      </ReBarChart>
    </ResponsiveContainer>
  )
}
