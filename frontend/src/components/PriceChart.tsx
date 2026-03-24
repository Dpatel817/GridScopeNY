import { useMemo } from 'react';
import {
  LineChart as ReLineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
  BarChart as ReBarChart, Bar,
} from 'recharts';
import type { ChartType } from '../data/priceTransforms';
import { makeTickFormatter, getTickInterval, tooltipLabelFormatter } from '../utils/dateFormat';

const COLORS = [
  '#2563eb','#10b981','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#14b8a6',
  '#6366f1','#84cc16','#f97316','#a855f7','#0ea5e9','#e11d48','#22c55e','#eab308'
];

interface Props {
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: string[];
  chartType: ChartType;
  height?: number | string;
  valuePrefix?: string;
  valueSuffix?: string;
}

function ChartTooltip({
  active, payload, label,
  prefix, suffix, fmtLabel,
}: {
  active?: boolean;
  payload?: { value: unknown; color: string; name: string }[];
  label?: unknown;
  prefix: string;
  suffix: string;
  fmtLabel: (v: unknown) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="price-tooltip">
      <div className="price-tooltip-label">{fmtLabel(label)}</div>
      {payload.filter(entry => entry.value != null).map((entry, i) => {
        const val = typeof entry.value === 'number'
          ? (Number.isInteger(entry.value) ? entry.value.toLocaleString() : entry.value.toFixed(2))
          : entry.value;
        return (
          <div key={i} className="price-tooltip-row">
            <span className="price-tooltip-dot" style={{ background: entry.color }} />
            <span className="price-tooltip-name">{entry.name}</span>
            <span className="price-tooltip-val">{prefix}{String(val)}{suffix}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function PriceChart({
  data, xKey, yKeys, chartType,
  height = '100%', valuePrefix = '$', valueSuffix = '',
}: Props) {
  const useTs = xKey === 'Date' && data.length > 0 && '_ts' in (data[0] || {});
  const effectiveXKey = useTs ? '_ts' : xKey;
  const fmtTick = useMemo(() => makeTickFormatter(data, effectiveXKey), [data, effectiveXKey]);
  const interval = useMemo(() => getTickInterval(data, effectiveXKey), [data, effectiveXKey]);
  const fmtTooltipLabel = useMemo(() => tooltipLabelFormatter(data, effectiveXKey), [data, effectiveXKey]);

  if (!data.length || !yKeys.length) return <div className="iq-empty">No chart data available</div>;

  const showDots = chartType === 'line-markers';

  const tooltipEl = (
    <ChartTooltip prefix={valuePrefix} suffix={valueSuffix} fmtLabel={fmtTooltipLabel} />
  );

  const xAxisProps = useTs
    ? {
        dataKey: '_ts' as const,
        tickFormatter: fmtTick,
        tick: { fontSize: 11 },
        type: 'number' as const,
        domain: ['dataMin', 'dataMax'] as [string, string],
        scale: 'time' as const,
      }
    : { dataKey: xKey, tickFormatter: fmtTick, tick: { fontSize: 11 }, interval };

  // Resolve height: if '100%', use a flex-fill wrapper div so ResponsiveContainer
  // gets a concrete pixel height from the flex layout chain.
  const resolvedHeight = (height === '100%' ? '100%' : height) as number | `${number}%`;
  const wrapStyle: React.CSSProperties = height === '100%'
    ? { flex: 1, minHeight: 0, width: '100%', overflow: 'hidden' }
    : { width: '100%', height };

  if (chartType === 'area') {
    return (
      <div style={wrapStyle}>
        <ResponsiveContainer width="100%" height={resolvedHeight}>
          <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis {...xAxisProps} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={tooltipEl} />
            {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {yKeys.map((k, i) => (
              <Area key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]} fillOpacity={0.15} stackId="stack" strokeWidth={1.5} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === 'bar') {
    return (
      <div style={wrapStyle}>
        <ResponsiveContainer width="100%" height={resolvedHeight}>
          <ReBarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={tooltipEl} />
            {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {yKeys.map((k, i) => (
              <Bar key={k} dataKey={k} stackId="stack" fill={COLORS[i % COLORS.length]} maxBarSize={40} />
            ))}
          </ReBarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <ResponsiveContainer width="100%" height={resolvedHeight}>
        <ReLineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis {...xAxisProps} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip content={tooltipEl} />
          {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {yKeys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]}
              dot={showDots ? { r: 2 } : false}
              activeDot={showDots ? { r: 4 } : { r: 3 }}
              strokeWidth={1.5} connectNulls={true} />
          ))}
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  );
}
