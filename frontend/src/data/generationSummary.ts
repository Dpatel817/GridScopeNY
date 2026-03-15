import type { GenerationKPIs } from './generationMetrics';
import type { FuelBreakdown } from './generationTransforms';

export interface GenerationSummaryContext {
  onPeakAvgTotal: string;
  peakTotal: string;
  lowTotal: string;
  topFuel: string;
  topFuelShare: string;
  secondFuel: string;
  secondFuelShare: string;
  renewableShare: string;
  fuelTypesActive: string;
  dateRange: string;
}

export function buildGenerationSummaryContext(
  kpis: GenerationKPIs,
  breakdown: FuelBreakdown[],
  dateRange: string
): GenerationSummaryContext {
  const fmtLoad = (v: { value: number; he: number; date: string } | null) =>
    v ? `${Math.round(v.value).toLocaleString()} MW at HE${v.he} (${v.date})` : 'N/A';

  return {
    onPeakAvgTotal: kpis.onPeakAvgTotal != null ? `${Math.round(kpis.onPeakAvgTotal).toLocaleString()} MW` : 'N/A',
    peakTotal: fmtLoad(kpis.peakTotal),
    lowTotal: fmtLoad(kpis.lowTotal),
    topFuel: kpis.topFuel ?? 'N/A',
    topFuelShare: kpis.topFuelShare != null ? `${kpis.topFuelShare.toFixed(1)}%` : 'N/A',
    secondFuel: kpis.secondFuel ?? 'N/A',
    secondFuelShare: breakdown.length > 1 ? `${breakdown[1].share.toFixed(1)}%` : 'N/A',
    renewableShare: kpis.renewableShare != null ? `${kpis.renewableShare.toFixed(1)}%` : 'N/A',
    fuelTypesActive: String(kpis.fuelTypesActive),
    dateRange,
  };
}

export function deterministicGenerationSummary(
  kpis: GenerationKPIs,
  breakdown: FuelBreakdown[]
): string {
  const parts: string[] = [];

  if (kpis.topFuel && kpis.topFuelShare != null) {
    parts.push(
      `${kpis.topFuel} dominates the generation mix at ${kpis.topFuelShare.toFixed(1)}% of total output.`
    );
  }

  if (kpis.secondFuel && breakdown.length > 1) {
    parts.push(`${kpis.secondFuel} follows at ${breakdown[1].share.toFixed(1)}%.`);
  }

  if (kpis.peakTotal) {
    parts.push(
      `Peak total generation reached ${Math.round(kpis.peakTotal.value).toLocaleString()} MW at HE${kpis.peakTotal.he}.`
    );
  }

  if (kpis.onPeakAvgTotal != null) {
    parts.push(
      `On-peak average total generation was ${Math.round(kpis.onPeakAvgTotal).toLocaleString()} MW.`
    );
  }

  if (kpis.renewableShare != null) {
    parts.push(`Renewable sources contributed ${kpis.renewableShare.toFixed(1)}% of the total mix.`);
  }

  return parts.join(' ') || 'Insufficient data for generation summary.';
}

export async function fetchAIGenerationSummary(context: GenerationSummaryContext): Promise<string> {
  try {
    const res = await fetch('/api/ai-generation-summary', {
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
