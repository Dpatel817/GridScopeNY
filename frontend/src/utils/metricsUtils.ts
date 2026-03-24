export interface Metric { label: string; value: string | number }

export function buildMetrics(data: Record<string, unknown>[], col: string): Metric[] {
  if (!data.length || !col) return [];
  const vals = data.map(r => r[col]).filter(v => v !== null && v !== undefined && !isNaN(Number(v))).map(Number);
  if (!vals.length) return [];
  const sum = vals.reduce((a, b) => a + b, 0);
  return [
    { label: `Avg ${col}`, value: (sum / vals.length).toFixed(2) },
    { label: `Max ${col}`, value: Math.max(...vals).toFixed(2) },
    { label: `Min ${col}`, value: Math.min(...vals).toFixed(2) },
    { label: 'Rows', value: data.length.toLocaleString() },
  ];
}
