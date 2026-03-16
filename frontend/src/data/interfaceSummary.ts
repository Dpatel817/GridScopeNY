import type { FlowKPIs } from './interfaceMetrics';

export interface FlowSummaryContext {
  onPeakAvgInternal: string;
  onPeakAvgExternal: string;
  peakPositive: string;
  peakNegative: string;
  mostActive: string;
  topInternal: string;
  topExternal: string;
  activeCount: string;
  dateRange: string;
}

export function buildFlowSummaryContext(kpis: FlowKPIs, dateRange: string): FlowSummaryContext {
  const fmtFlow = (v: { value: number; iface: string; he: number; date: string; timestamp: string } | null) =>
    v ? `${Math.round(v.value).toLocaleString()} MW on ${v.iface} at ${v.timestamp}` : 'N/A';

  return {
    onPeakAvgInternal: kpis.onPeakAvgInternal != null ? `${Math.round(kpis.onPeakAvgInternal).toLocaleString()} MW` : 'N/A',
    onPeakAvgExternal: kpis.onPeakAvgExternal != null ? `${Math.round(kpis.onPeakAvgExternal).toLocaleString()} MW` : 'N/A',
    peakPositive: fmtFlow(kpis.peakPositive),
    peakNegative: fmtFlow(kpis.peakNegative),
    mostActive: kpis.mostActive ?? 'N/A',
    topInternal: kpis.topInternal ?? 'N/A',
    topExternal: kpis.topExternal ?? 'N/A',
    activeCount: String(kpis.activeCount),
    dateRange,
  };
}

export function deterministicFlowSummary(kpis: FlowKPIs): string {
  const parts: string[] = [];

  if (kpis.mostActive) {
    parts.push(`${kpis.mostActive} is the most active interface by average absolute flow.`);
  }

  if (kpis.topInternal) {
    parts.push(`The strongest internal path is ${kpis.topInternal}.`);
  }

  if (kpis.topExternal) {
    parts.push(`The strongest external path is ${kpis.topExternal}.`);
  }

  if (kpis.peakPositive) {
    parts.push(
      `Peak positive flow reached ${Math.round(kpis.peakPositive.value).toLocaleString()} MW on ${kpis.peakPositive.iface} at ${kpis.peakPositive.timestamp}.`
    );
  }

  if (kpis.peakNegative) {
    parts.push(
      `Peak negative flow was ${Math.round(kpis.peakNegative.value).toLocaleString()} MW on ${kpis.peakNegative.iface} at ${kpis.peakNegative.timestamp}.`
    );
  }

  if (kpis.onPeakAvgInternal != null && kpis.onPeakAvgExternal != null) {
    const intDir = kpis.onPeakAvgInternal >= 0 ? 'positive' : 'negative';
    const extDir = kpis.onPeakAvgExternal >= 0 ? 'import' : 'export';
    parts.push(
      `On-peak average internal flow was ${Math.round(kpis.onPeakAvgInternal).toLocaleString()} MW (${intDir}), ` +
      `while external averaged ${Math.round(kpis.onPeakAvgExternal).toLocaleString()} MW (net ${extDir}).`
    );
  }

  if (kpis.activeCount > 0) {
    parts.push(`${kpis.activeCount} interfaces were active in the analysis window.`);
  }

  return parts.join(' ') || 'Insufficient data for flow summary.';
}

export async function fetchAIFlowSummary(context: FlowSummaryContext): Promise<string> {
  try {
    const res = await fetch('/api/ai-flow-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.summary || '';
  } catch {
    return '';
  }
}
