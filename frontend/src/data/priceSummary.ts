import type { PriceKPIs } from './priceMetrics';

export interface PriceSummaryContext {
  onPeakAvgDA: string;
  onPeakAvgRT: string;
  peakDA: string;
  peakRT: string;
  lowDA: string;
  lowRT: string;
  topDartZone: string;
  topDartAvg: string;
  topDartMax: string;
  dateRange: string;
}

export function buildSummaryContext(kpis: PriceKPIs, dateRange: string): PriceSummaryContext {
  return {
    onPeakAvgDA: kpis.onPeakAvgDA?.toFixed(2) ?? 'N/A',
    onPeakAvgRT: kpis.onPeakAvgRT?.toFixed(2) ?? 'N/A',
    peakDA: kpis.peakDA
      ? `$${kpis.peakDA.value.toFixed(2)} at HE${kpis.peakDA.he} (${kpis.peakDA.zone}, ${kpis.peakDA.date})`
      : 'N/A',
    peakRT: kpis.peakRT
      ? `$${kpis.peakRT.value.toFixed(2)} at HE${kpis.peakRT.he} (${kpis.peakRT.zone}, ${kpis.peakRT.date})`
      : 'N/A',
    lowDA: kpis.lowDA
      ? `$${kpis.lowDA.value.toFixed(2)} at HE${kpis.lowDA.he} (${kpis.lowDA.zone}, ${kpis.lowDA.date})`
      : 'N/A',
    lowRT: kpis.lowRT
      ? `$${kpis.lowRT.value.toFixed(2)} at HE${kpis.lowRT.he} (${kpis.lowRT.zone}, ${kpis.lowRT.date})`
      : 'N/A',
    topDartZone: kpis.topDartZone?.zone ?? 'N/A',
    topDartAvg: kpis.topDartZone?.avgSpread.toFixed(2) ?? 'N/A',
    topDartMax: kpis.topDartZone?.maxSpread.toFixed(2) ?? 'N/A',
    dateRange,
  };
}

export function deterministicSummary(kpis: PriceKPIs): string {
  const parts: string[] = [];

  if (kpis.onPeakAvgDA != null && kpis.onPeakAvgRT != null) {
    const spread = kpis.onPeakAvgDA - kpis.onPeakAvgRT;
    const dir = spread > 0 ? 'above' : 'below';
    parts.push(
      `On-peak Day-Ahead LMPs averaged $${kpis.onPeakAvgDA.toFixed(2)}/MWh, ` +
      `${Math.abs(spread) < 0.5 ? 'roughly in line with' : `$${Math.abs(spread).toFixed(2)} ${dir}`} ` +
      `Real-Time at $${kpis.onPeakAvgRT.toFixed(2)}/MWh.`
    );
  }

  if (kpis.peakDA) {
    parts.push(
      `Peak DA price reached $${kpis.peakDA.value.toFixed(2)}/MWh at HE${kpis.peakDA.he} in ${kpis.peakDA.zone}.`
    );
  }

  if (kpis.topDartZone) {
    parts.push(
      `${kpis.topDartZone.zone} led DA-RT spreads with $${kpis.topDartZone.avgSpread.toFixed(2)}/MWh avg ` +
      `(max $${kpis.topDartZone.maxSpread.toFixed(2)}).`
    );
  }

  if (kpis.peakDA && kpis.lowDA) {
    const range = kpis.peakDA.value - kpis.lowDA.value;
    if (range > 50) {
      parts.push(`Intraday DA range of $${range.toFixed(2)}/MWh suggests elevated volatility.`);
    } else if (range > 20) {
      parts.push(`Moderate intraday DA range of $${range.toFixed(2)}/MWh.`);
    }
  }

  return parts.join(' ') || 'Insufficient data for price summary.';
}

export async function fetchAISummary(context: PriceSummaryContext): Promise<string> {
  try {
    const res = await fetch('/api/ai-price-summary', {
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
