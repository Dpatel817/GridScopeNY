import type { CongestionKPIs } from './congestionMetrics';

export interface CongestionSummaryContext {
  onPeakTotalCost: string;
  onPeakAvgCost: string;
  peakPositive: string;
  peakNegative: string;
  highestCostConstraint: string;
  avgCostTopConstraint: string;
  bindingCount: string;
  top3Share: string;
  dateRange: string;
}

export function buildCongestionSummaryContext(kpis: CongestionKPIs, dateRange: string): CongestionSummaryContext {
  const fmtCost = (v: { value: number; constraint: string; he: number; date: string } | null) =>
    v ? `$${v.value.toFixed(2)} on ${v.constraint} at HE${v.he} (${v.date})` : 'N/A';

  return {
    onPeakTotalCost: kpis.onPeakTotalCost != null ? `$${Math.round(kpis.onPeakTotalCost).toLocaleString()}` : 'N/A',
    onPeakAvgCost: kpis.onPeakAvgCost != null ? `$${kpis.onPeakAvgCost.toFixed(2)}` : 'N/A',
    peakPositive: fmtCost(kpis.peakPositive),
    peakNegative: fmtCost(kpis.peakNegative),
    highestCostConstraint: kpis.highestCostConstraint ?? 'N/A',
    avgCostTopConstraint: kpis.avgCostTopConstraint != null ? `$${kpis.avgCostTopConstraint.toFixed(2)}` : 'N/A',
    bindingCount: String(kpis.bindingCount),
    top3Share: kpis.top3Share != null ? `${kpis.top3Share.toFixed(1)}%` : 'N/A',
    dateRange,
  };
}

export function deterministicCongestionSummary(kpis: CongestionKPIs): string {
  const parts: string[] = [];

  if (kpis.bindingCount > 0) {
    parts.push(`${kpis.bindingCount} constraints were binding during this period.`);
  }

  if (kpis.highestCostConstraint && kpis.avgCostTopConstraint != null) {
    parts.push(
      `The highest-cost constraint was ${kpis.highestCostConstraint} with an average cost of $${kpis.avgCostTopConstraint.toFixed(2)}.`
    );
  }

  if (kpis.top3Share != null) {
    const concentrated = kpis.top3Share > 60;
    parts.push(
      `The top 3 constraints accounted for ${kpis.top3Share.toFixed(1)}% of total cost${concentrated ? ', indicating concentrated congestion pressure' : ''}.`
    );
  }

  if (kpis.peakPositive) {
    parts.push(
      `Peak positive cost reached $${kpis.peakPositive.value.toFixed(2)} on ${kpis.peakPositive.constraint} at HE${kpis.peakPositive.he}.`
    );
  }

  if (kpis.onPeakTotalCost != null) {
    parts.push(
      `On-peak total constraint cost was $${Math.round(kpis.onPeakTotalCost).toLocaleString()}.`
    );
  }

  return parts.join(' ') || 'Insufficient data for congestion summary.';
}

export async function fetchAICongestionSummary(context: CongestionSummaryContext): Promise<string> {
  try {
    const res = await fetch('/api/ai-congestion-summary', {
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
