import type { CongestionRow } from './congestionTransforms';
import { isOnPeak, detectColumns } from './congestionTransforms';
import { formatTimestamp } from './formatTimestamp';

export interface CongestionKPIs {
  onPeakTotalCost: number | null;
  onPeakAvgCost: number | null;
  peakPositive: { value: number; constraint: string; he: number; date: string; timestamp: string } | null;
  peakNegative: { value: number; constraint: string; he: number; date: string; timestamp: string } | null;
  highestCostConstraint: string | null;
  avgCostTopConstraint: number | null;
  bindingCount: number;
  top3Share: number | null;
}

export function computeCongestionKPIs(rows: CongestionRow[], allRows?: CongestionRow[]): CongestionKPIs {
  const { nameCol, costCol } = detectColumns(rows);

  let onPeakTotalCost = 0;
  let onPeakCount = 0;
  let peakPos: CongestionKPIs['peakPositive'] = null;
  let peakNeg: CongestionKPIs['peakNegative'] = null;

  const byConstraint: Record<string, { totalAbs: number; count: number }> = {};
  let grandTotalAbs = 0;

  const hasHE = rows.some(r => r.HE != null);
  for (const r of rows) {
    const name = String(r[nameCol] || '');
    if (!name) continue;
    const cost = Number(r[costCol] || 0);
    if (isNaN(cost)) continue;
    const he = Number(r.HE || 0);
    const absCost = Math.abs(cost);

    if (!hasHE || isOnPeak(he)) {
      onPeakTotalCost += absCost;
      onPeakCount++;
    }

    if (cost > 0 && (peakPos === null || cost > peakPos.value)) {
      peakPos = { value: cost, constraint: name, he, date: r.Date, timestamp: formatTimestamp(r.Date, he) };
    }
    if (cost < 0 && (peakNeg === null || cost < peakNeg.value)) {
      peakNeg = { value: cost, constraint: name, he, date: r.Date, timestamp: formatTimestamp(r.Date, he) };
    }

    if (!byConstraint[name]) byConstraint[name] = { totalAbs: 0, count: 0 };
    byConstraint[name].totalAbs += absCost;
    byConstraint[name].count++;
    grandTotalAbs += absCost;
  }

  const ranked = Object.entries(byConstraint)
    .map(([name, s]) => ({ name, totalAbs: s.totalAbs, count: s.count }))
    .sort((a, b) => b.totalAbs - a.totalAbs);

  const highestCostConstraint = ranked.length > 0 ? ranked[0].name : null;
  const avgCostTopConstraint = ranked.length > 0 && ranked[0].count > 0
    ? ranked[0].totalAbs / ranked[0].count
    : null;

  const bindingCount = ranked.length;

  const top3Abs = ranked.slice(0, 3).reduce((s, c) => s + c.totalAbs, 0);
  const top3Share = grandTotalAbs > 0 ? (top3Abs / grandTotalAbs) * 100 : null;

  if (onPeakCount === 0 && hasHE && allRows && allRows.length > 0) {
    const dates = [...new Set(allRows.map(r => r.Date))].sort();
    for (let d = dates.length - 1; d >= 0; d--) {
      const dayRows = allRows.filter(r => r.Date === dates[d]);
      if (dayRows.some(r => isOnPeak(Number(r.HE || 0)))) {
        for (const r of dayRows) {
          const he = Number(r.HE || 0);
          if (!isOnPeak(he)) continue;
          const cost = Number(r[costCol] || 0);
          if (isNaN(cost)) continue;
          onPeakTotalCost += Math.abs(cost);
          onPeakCount++;
        }
        break;
      }
    }
  }

  return {
    onPeakTotalCost: onPeakCount > 0 ? onPeakTotalCost : null,
    onPeakAvgCost: onPeakCount > 0 ? onPeakTotalCost / onPeakCount : null,
    peakPositive: peakPos,
    peakNegative: peakNeg,
    highestCostConstraint,
    avgCostTopConstraint,
    bindingCount,
    top3Share,
  };
}
