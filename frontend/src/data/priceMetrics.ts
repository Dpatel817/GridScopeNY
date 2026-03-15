import type { PriceRow } from './priceTransforms';
import { isOnPeak, filterNyisoOnly } from './priceTransforms';

export interface PriceKPIs {
  onPeakAvgDA: number | null;
  onPeakAvgRT: number | null;
  peakDA: { value: number; he: number; zone: string; date: string } | null;
  peakRT: { value: number; he: number; zone: string; date: string } | null;
  lowDA: { value: number; he: number; zone: string; date: string } | null;
  lowRT: { value: number; he: number; zone: string; date: string } | null;
  topDartZone: { zone: string; avgSpread: number; maxSpread: number } | null;
}

export function computePriceKPIs(daRows: PriceRow[], rtRows: PriceRow[]): PriceKPIs {
  const daFiltered = filterNyisoOnly(daRows);
  const rtFiltered = filterNyisoOnly(rtRows);

  const onPeakDA = daFiltered.filter(r => isOnPeak(r.HE));
  const onPeakRT = rtFiltered.filter(r => isOnPeak(r.HE));

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
): { value: number; he: number; zone: string; date: string } | null {
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
  };
}

function computeTopDartZone(
  daRows: PriceRow[],
  rtRows: PriceRow[]
): { zone: string; avgSpread: number; maxSpread: number } | null {
  const rtMap: Record<string, number> = {};
  for (const r of rtRows) {
    rtMap[`${r.Date}_${r.HE}_${r.Zone}`] = Number(r.LMP);
  }

  const spreadByZone: Record<string, { total: number; count: number; max: number }> = {};
  for (const r of daRows) {
    const zone = String(r.Zone);
    const key = `${r.Date}_${r.HE}_${zone}`;
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
