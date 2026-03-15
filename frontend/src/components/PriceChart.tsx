import {
  LineChart as ReLineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
  BarChart as ReBarChart, Bar,
} from 'recharts';
import type { ChartType } from '../data/priceTransforms';

const COLORS = [
  '#2563eb','#10b981','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#14b8a6',
  '#6366f1','#84cc16','#f97316','#a855f7','#0ea5e9','#e11d48','#22c55e','#eab308'
];

interface Props {
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: string[];
  chartType: ChartType;
  height?: number;
  valuePrefix?: string;
  valueSuffix?: string;
}

function fmtX(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (s.includes('T')) {
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s.length > 14 ? s.slice(0, 14) : s;
      return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return s; }
  }
  if (/^\d{4}-\d{2}-\d{2} HE\d+$/.test(s)) {
    const parts = s.split(' ');
    const dp = parts[0].split('-');
    return `${parseInt(dp[1])}/${parseInt(dp[2])} ${parts[1]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const parts = s.split('-');
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  }
  return s.length > 16 ? s.slice(0, 16) : s;
}

function makeTooltip(prefix: string, suffix: string) {
  return function CustomTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
      <div className="price-tooltip">
        <div className="price-tooltip-label">{fmtX(label)}</div>
        {payload.map((entry: any, i: number) => {
          const val = typeof entry.value === 'number'
            ? (Number.isInteger(entry.value) ? entry.value.toLocaleString() : entry.value.toFixed(2))
            : entry.value;
          return (
            <div key={i} className="price-tooltip-row">
              <span className="price-tooltip-dot" style={{ background: entry.color }} />
              <span className="price-tooltip-name">{entry.name}</span>
              <span className="price-tooltip-val">
                {prefix}{val}{suffix}
              </span>
            </div>
          );
        })}
      </div>
    );
  };
}

export default function PriceChart({ data, xKey, yKeys, chartType, height = 340, valuePrefix = '$', valueSuffix = '' }: Props) {
  if (!data.length || !yKeys.length) return <div className="iq-empty">No chart data available</div>;

  const showDots = chartType === 'line-markers';
  const interval = data.length > 100 ? Math.floor(data.length / 40) : data.length > 50 ? 2 : 'preserveStartEnd';

  if (chartType === 'area') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} tickFormatter={fmtX} tick={{ fontSize: 11 }} interval={interval} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {yKeys.map((k, i) => (
            <Area key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]}
              fill={COLORS[i % COLORS.length]} fillOpacity={0.15} stackId="stack" strokeWidth={1.5} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ReBarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={fmtX} tick={{ fontSize: 11 }} interval={interval} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />
          {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {yKeys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="stack" fill={COLORS[i % COLORS.length]} maxBarSize={40} />
          ))}
        </ReBarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReLineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey={xKey} tickFormatter={fmtX} tick={{ fontSize: 11 }} interval={interval} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip content={<CustomTooltip />} />
        {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {yKeys.map((k, i) => (
          <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]}
            dot={showDots ? { r: 2 } : false}
            activeDot={showDots ? { r: 4 } : { r: 3 }}
            strokeWidth={1.5} />
        ))}
      </ReLineChart>
    </ResponsiveContainer>
  );
}
