import type { PriceRow } from './priceTransforms';
import { isOnPeak, filterNyisoOnly } from './priceTransforms';
import { formatTimestamp } from './formatTimestamp';

export interface PriceKPIs {
  onPeakAvgDA: number | null;
  onPeakAvgRT: number | null;
  peakDA: { value: number; he: number; zone: string; date: string; timestamp: string } | null;
  peakRT: { value: number; he: number; zone: string; date: string; timestamp: string } | null;
  lowDA: { value: number; he: number; zone: string; date: string; timestamp: string } | null;
  lowRT: { value: number; he: number; zone: string; date: string; timestamp: string } | null;
  topDartZone: { zone: string; avgSpread: number; maxSpread: number } | null;
}

export function computePriceKPIs(daRows: PriceRow[], rtRows: PriceRow[]): PriceKPIs {
  const daFiltered = filterNyisoOnly(daRows);
  const rtFiltered = filterNyisoOnly(rtRows);

  const hasHE = daFiltered.some(r => r.HE != null);
  const onPeakDA = hasHE ? daFiltered.filter(r => isOnPeak(r.HE)) : daFiltered;
  const onPeakRT = hasHE ? rtFiltered.filter(r => isOnPeak(r.HE)) : rtFiltered;

  const onPeakAvgDA = avg(onPeakDA.map(r => Number(r.LMP)));
  const onPeakAvgRT = avg(onPeakRT.map(r => Number(r.LMP)));

  const peakDA = findExtreme(daFiltered, 'max');
  const peakRT = findExtreme(rtFiltered, 'max');
  const lowDA = findExtreme(daFiltered, 'min');
  const lowRT = findExtreme(rtFiltered, 'min');

  const topDartZone = computeTopDartZone(daFiltered, rtFiltered);

  return { onPeakAvgDA, onPeakAvgRT, peakDA, peakRT, lowDA, lowRT, topDartZone };
}

function avg(values: number[]): number | null {
  const valid = values.filter(v => !isNaN(v) && v !== null && v !== undefined);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function findExtreme(
  rows: PriceRow[],
  mode: 'max' | 'min'
): { value: number; he: number; zone: string; date: string; timestamp: string } | null {
  let best: PriceRow | null = null;
  let bestVal = mode === 'max' ? -Infinity : Infinity;

  for (const r of rows) {
    const lmp = Number(r.LMP);
    if (isNaN(lmp)) continue;
    if (mode === 'max' ? lmp > bestVal : lmp < bestVal) {
      bestVal = lmp;
      best = r;
    }
  }

  if (!best) return null;
  return {
    value: Number(best.LMP),
    he: best.HE,
    zone: String(best.Zone),
    date: best.Date,
    timestamp: formatTimestamp(best.Date, best.HE),
  };
}

function computeTopDartZone(
  daRows: PriceRow[],
  rtRows: PriceRow[]
): { zone: string; avgSpread: number; maxSpread: number } | null {
  const rtMap: Record<string, number> = {};
  for (const r of rtRows) {
    const k = r.HE != null ? `${r.Date}_${r.HE}_${r.Zone}` : `${r.Date}_${r.Zone}`;
    rtMap[k] = Number(r.LMP);
  }

  const spreadByZone: Record<string, { total: number; count: number; max: number }> = {};
  for (const r of daRows) {
    const zone = String(r.Zone);
    const key = r.HE != null ? `${r.Date}_${r.HE}_${zone}` : `${r.Date}_${zone}`;
    const rtLmp = rtMap[key];
    if (rtLmp !== undefined) {
      const spread = Math.abs(Number(r.LMP) - rtLmp);
      if (!spreadByZone[zone]) spreadByZone[zone] = { total: 0, count: 0, max: 0 };
      spreadByZone[zone].total += spread;
      spreadByZone[zone].count++;
      spreadByZone[zone].max = Math.max(spreadByZone[zone].max, spread);
    }
  }

  const entries = Object.entries(spreadByZone);
  if (entries.length === 0) return null;

  let topZone = '';
  let topAvg = 0;
  let topMax = 0;
  for (const [zone, s] of entries) {
    const a = s.total / s.count;
    if (a > topAvg) {
      topAvg = a;
      topMax = s.max;
      topZone = zone;
    }
  }

  return { zone: topZone, avgSpread: topAvg, maxSpread: topMax };
}
