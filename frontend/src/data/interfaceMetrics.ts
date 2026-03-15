import type { FlowRow } from './interfaceTransforms';
import { isOnPeak, detectFlowColumns } from './interfaceTransforms';
import { getInterfaceMeta, getDisplayName } from './interfaceMetadata';

export interface FlowKPIs {
  onPeakAvgInternal: number | null;
  onPeakAvgExternal: number | null;
  peakPositive: { value: number; iface: string; he: number; date: string } | null;
  peakNegative: { value: number; iface: string; he: number; date: string } | null;
  mostActive: string | null;
  topInternal: string | null;
  topExternal: string | null;
  activeCount: number;
}

export function computeFlowKPIs(rows: FlowRow[]): FlowKPIs {
  const { nameCol, flowCol } = detectFlowColumns(rows);

  const intervalInternal: Record<string, number> = {};
  const intervalExternal: Record<string, number> = {};

  let peakPos: FlowKPIs['peakPositive'] = null;
  let peakNeg: FlowKPIs['peakNegative'] = null;

  const byIface: Record<string, { absSum: number; count: number; classification: string }> = {};
  const activeSet = new Set<string>();

  for (const r of rows) {
    const raw = String(r[nameCol] || '');
    if (!raw) continue;
    const flow = Number(r[flowCol] || 0);
    if (isNaN(flow)) continue;
    const he = Number(r.HE || 0);
    const meta = getInterfaceMeta(raw);
    const display = getDisplayName(raw);

    activeSet.add(raw);

    if (isOnPeak(he)) {
      const intervalKey = `${r.Date}_${r.HE}`;
      if (meta.classification === 'Internal') {
        intervalInternal[intervalKey] = (intervalInternal[intervalKey] || 0) + flow;
      } else {
        intervalExternal[intervalKey] = (intervalExternal[intervalKey] || 0) + flow;
      }
    }

    if (peakPos === null || flow > peakPos.value) {
      peakPos = { value: flow, iface: display, he, date: r.Date };
    }
    if (peakNeg === null || flow < peakNeg.value) {
      peakNeg = { value: flow, iface: display, he, date: r.Date };
    }

    if (!byIface[raw]) byIface[raw] = { absSum: 0, count: 0, classification: meta.classification };
    byIface[raw].absSum += Math.abs(flow);
    byIface[raw].count++;
  }

  const intTotals = Object.values(intervalInternal);
  const extTotals = Object.values(intervalExternal);

  const onPeakAvgInternal = intTotals.length
    ? intTotals.reduce((a, b) => a + b, 0) / intTotals.length
    : null;
  const onPeakAvgExternal = extTotals.length
    ? extTotals.reduce((a, b) => a + b, 0) / extTotals.length
    : null;

  const ranked = Object.entries(byIface)
    .map(([raw, s]) => ({
      raw,
      display: getDisplayName(raw),
      avgAbs: s.count > 0 ? s.absSum / s.count : 0,
      classification: s.classification,
    }))
    .sort((a, b) => b.avgAbs - a.avgAbs);

  const mostActive = ranked.length > 0 ? ranked[0].display : null;
  const topInternal = ranked.find(r => r.classification === 'Internal')?.display ?? null;
  const topExternal = ranked.find(r => r.classification === 'External')?.display ?? null;

  return {
    onPeakAvgInternal,
    onPeakAvgExternal,
    peakPositive: peakPos,
    peakNegative: peakNeg,
    mostActive,
    topInternal,
    topExternal,
    activeCount: activeSet.size,
  };
}
