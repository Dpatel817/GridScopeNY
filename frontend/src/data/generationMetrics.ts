import type { GenRow, FuelBreakdown } from './generationTransforms';
import { isOnPeak, detectColumns } from './generationTransforms';
import { formatTimestamp } from './formatTimestamp';

const RENEWABLE_FUELS = new Set([
  'Wind', 'Hydro', 'Other Renewables', 'Solar', 'Landfill Gas',
  'wind', 'hydro', 'solar', 'other renewables', 'landfill gas',
]);

export interface GenerationKPIs {
  onPeakAvgTotal: number | null;
  peakTotal: { value: number; he: number; date: string; timestamp: string } | null;
  lowTotal: { value: number; he: number; date: string; timestamp: string } | null;
  topFuel: string | null;
  topFuelShare: number | null;
  secondFuel: string | null;
  renewableShare: number | null;
  fuelTypesActive: number;
}

export function computeGenerationKPIs(
  rows: GenRow[],
  breakdown: FuelBreakdown[]
): GenerationKPIs {
  const { genCol, fuelCol } = detectColumns(rows);

  const hasHE = rows.some(r => r.HE != null);
  const fuelSnap: Record<string, number> = {};
  for (const r of rows) {
    const fuel = String(r[fuelCol] || '');
    const snapKey = hasHE ? `${r.Date}_${r.HE}_${fuel}` : `${r.Date}_0_${fuel}`;
    fuelSnap[snapKey] = Number(r[genCol] || 0);
  }

  const intervalTotals: Record<string, { total: number; he: number; date: string }> = {};
  for (const [sk, gen] of Object.entries(fuelSnap)) {
    const parts = sk.split('_');
    const key = `${parts[0]}_${parts[1]}`;
    if (!intervalTotals[key]) intervalTotals[key] = { total: 0, he: Number(parts[1]), date: parts[0] };
    intervalTotals[key].total += gen;
  }

  const intervals = Object.values(intervalTotals);

  const onPeakIntervals = hasHE ? intervals.filter(i => isOnPeak(i.he)) : intervals;
  const onPeakAvgTotal = onPeakIntervals.length > 0
    ? onPeakIntervals.reduce((s, i) => s + i.total, 0) / onPeakIntervals.length
    : null;

  let peakTotal: { value: number; he: number; date: string; timestamp: string } | null = null;
  let lowTotal: { value: number; he: number; date: string; timestamp: string } | null = null;
  for (const i of intervals) {
    if (!peakTotal || i.total > peakTotal.value) {
      peakTotal = { value: i.total, he: i.he, date: i.date, timestamp: formatTimestamp(i.date, i.he) };
    }
    if (!lowTotal || i.total < lowTotal.value) {
      lowTotal = { value: i.total, he: i.he, date: i.date, timestamp: formatTimestamp(i.date, i.he) };
    }
  }

  const topFuel = breakdown[0]?.name ?? null;
  const topFuelShare = breakdown[0]?.share ?? null;
  const secondFuel = breakdown.length > 1 ? breakdown[1].name : null;

  const renewableTotal = breakdown
    .filter(f => RENEWABLE_FUELS.has(f.name))
    .reduce((s, f) => s + f.total, 0);
  const grandTotal = breakdown.reduce((s, f) => s + f.total, 0);
  const renewableShare = grandTotal > 0 ? (renewableTotal / grandTotal) * 100 : null;

  const fuelTypesActive = breakdown.filter(f => f.avg > 0).length;

  return {
    onPeakAvgTotal,
    peakTotal,
    lowTotal,
    topFuel,
    topFuelShare,
    secondFuel,
    renewableShare,
    fuelTypesActive,
  };
}
