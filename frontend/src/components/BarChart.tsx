import {
  BarChart as ReBarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList
} from 'recharts'

interface Props {
  data: Record<string, unknown>[]
  xKey: string
  yKey: string
  height?: number
  highlightIndex?: number
  layout?: 'horizontal' | 'vertical'
  showLabels?: boolean
  color?: string
  labelPrefix?: string
}

export default function BarChart({
  data, xKey, yKey, height = 300, highlightIndex = 0,
  layout = 'vertical', showLabels = false, color, labelPrefix = '$'
}: Props) {
  if (!data.length) return <div className="empty-state" style={{ padding: 24 }}>No chart data</div>

  const fmtValue = (v: number) => `${labelPrefix}${v.toFixed(v >= 100 ? 0 : 2)}`;

  if (layout === 'horizontal') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ReBarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 80, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey={xKey} tick={{ fontSize: 12, fontWeight: 500 }} width={75} />
          <Tooltip
            formatter={(v: unknown) => typeof v === 'number' ? fmtValue(v) : String(v)}
            contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}
          />
          <Bar dataKey={yKey} radius={[0, 6, 6, 0]} maxBarSize={28}>
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={i === highlightIndex ? (color || '#10b981') : '#e2e8f0'}
                stroke={i === highlightIndex ? (color || '#059669') : 'transparent'}
                strokeWidth={1}
              />
            ))}
            {showLabels && <LabelList dataKey={yKey} position="right" formatter={(v: number) => fmtValue(v)} style={{ fontSize: 11, fontWeight: 600, fill: 'var(--text-secondary)' }} />}
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: unknown) => typeof v === 'number' ? fmtValue(v) : String(v)}
          contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}
        />
        <Bar dataKey={yKey} radius={[6, 6, 0, 0]} maxBarSize={36}>
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={i === highlightIndex ? (color || '#10b981') : (i < 3 ? '#34d399' : '#e2e8f0')}
            />
          ))}
          {showLabels && <LabelList dataKey={yKey} position="top" formatter={(v: number) => fmtValue(v)} style={{ fontSize: 11, fontWeight: 600, fill: 'var(--text-secondary)' }} />}
        </Bar>
      </ReBarChart>
    </ResponsiveContainer>
  )
}
