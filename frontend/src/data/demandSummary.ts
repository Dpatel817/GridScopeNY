import type { DemandKPIs } from './demandMetrics';

export interface DemandSummaryContext {
  onPeakAvgForecast: string;
  onPeakAvgActual: string;
  peakForecast: string;
  peakActual: string;
  lowForecast: string;
  lowActual: string;
  avgForecastError: string;
  peakForecastError: string;
  largestUnderForecast: string;
  largestOverForecast: string;
  dateRange: string;
}

export function buildDemandSummaryContext(kpis: DemandKPIs, dateRange: string): DemandSummaryContext {
  const fmtLoad = (v: { value: number; he: number; date: string; timestamp: string } | null) =>
    v ? `${Math.round(v.value).toLocaleString()} MW at ${v.timestamp}` : 'N/A';

  return {
    onPeakAvgForecast: kpis.onPeakAvgForecast != null ? `${Math.round(kpis.onPeakAvgForecast).toLocaleString()} MW` : 'N/A',
    onPeakAvgActual: kpis.onPeakAvgActual != null ? `${Math.round(kpis.onPeakAvgActual).toLocaleString()} MW` : 'N/A',
    peakForecast: fmtLoad(kpis.peakForecast),
    peakActual: fmtLoad(kpis.peakActual),
    lowForecast: fmtLoad(kpis.lowForecast),
    lowActual: fmtLoad(kpis.lowActual),
    avgForecastError: kpis.avgForecastError != null ? `${Math.round(kpis.avgForecastError).toLocaleString()} MW` : 'N/A',
    peakForecastError: fmtLoad(kpis.peakForecastError),
    largestUnderForecast: fmtLoad(kpis.largestUnderForecast),
    largestOverForecast: fmtLoad(kpis.largestOverForecast),
    dateRange,
  };
}

export function deterministicDemandSummary(kpis: DemandKPIs): string {
  const parts: string[] = [];

  if (kpis.onPeakAvgForecast != null && kpis.onPeakAvgActual != null) {
    const diff = kpis.onPeakAvgForecast - kpis.onPeakAvgActual;
    const dir = diff > 0 ? 'over-forecast' : 'under-forecast';
    parts.push(
      `On-peak average forecast load was ${Math.round(kpis.onPeakAvgForecast).toLocaleString()} MW ` +
      `vs actual ${Math.round(kpis.onPeakAvgActual).toLocaleString()} MW ` +
      `(${Math.abs(diff) < 50 ? 'roughly in line' : `${Math.abs(Math.round(diff)).toLocaleString()} MW ${dir}`}).`
    );
  }

  if (kpis.peakForecast) {
    parts.push(
      `Peak forecast reached ${Math.round(kpis.peakForecast.value).toLocaleString()} MW at ${kpis.peakForecast.timestamp}.`
    );
  }

  if (kpis.peakActual) {
    parts.push(
      `Actual peak hit ${Math.round(kpis.peakActual.value).toLocaleString()} MW at ${kpis.peakActual.timestamp}.`
    );
  }

  if (kpis.avgForecastError != null) {
    const absErr = Math.abs(Math.round(kpis.avgForecastError));
    const dir = kpis.avgForecastError > 0 ? 'over-forecast' : 'under-forecast';
    parts.push(`Average forecast error was ${absErr.toLocaleString()} MW (${dir} bias).`);
  }

  if (kpis.peakForecastError) {
    parts.push(
      `Largest absolute error was ${Math.abs(Math.round(kpis.peakForecastError.value)).toLocaleString()} MW at ${kpis.peakForecastError.timestamp}.`
    );
  }

  return parts.join(' ') || 'Insufficient data for demand summary.';
}

export async function fetchAIDemandSummary(context: DemandSummaryContext): Promise<string> {
  try {
    const res = await fetch('/api/ai-demand-summary', {
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
