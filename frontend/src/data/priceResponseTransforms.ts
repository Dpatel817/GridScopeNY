import { isNyisoZone } from './zones';
import type { Resolution, DateRange } from './priceTransforms';
import { isOnPeak } from './priceTransforms';
import { makeUniqueHourlyKey } from '../utils/dateFormat';

export interface AspRow {
  'Time Stamp': string;
  Date: string;
  HE: number;
  Zone: string;
  '10 Min Spin': number;
  '10 Min Non-Sync': number;
  '30 Min OR': number;
  'Reg Cap': number;
  [key: string]: unknown;
}

export interface LmpRow {
  Date: string;
  HE: number;
  Zone: string;
  LMP: number;
  [key: string]: unknown;
}

export type AspProduct = '10 Min Spin' | '10 Min Non-Sync' | '30 Min OR' | 'Reg Cap';
export type CompareMode = 'absolute' | 'normalized' | 'spread';

export const ASP_PRODUCTS: { key: AspProduct; label: string }[] = [
  { key: '10 Min Spin', label: '10 Min Spinning Reserve' },
  { key: '10 Min Non-Sync', label: '10 Min Non-Sync Reserve' },
  { key: '30 Min OR', label: '30 Min Operating Reserve' },
  { key: 'Reg Cap', label: 'Regulation Capacity' },
];

export interface AlignedRow {
  Date: string;
  HE: number;
  label: string;
  daLmp: number | null;
  rtLmp: number | null;
  daAsp: number | null;
  rtAsp: number | null;
  daRtLmpSpread: number | null;
  daRtAspSpread: number | null;
}

export function getAvailableZones(rows: LmpRow[]): string[] {
  return [...new Set(rows.map(r => String(r.Zone)).filter(isNyisoZone))].sort();
}

export function getAvailableDates(rows: LmpRow[]): string[] {
  return [...new Set(rows.map(r => r.Date))].sort();
}

export function getAvailableAspZones(rows: AspRow[]): string[] {
  return [...new Set(rows.map(r => String(r.Zone)))].sort();
}

export function filterByDateRange<T extends { Date: string }>(
  rows: T[],
  range: DateRange,
  startDate?: string,
  endDate?: string
): T[] {
  if (range === 'all') return rows;
  if (range === 'today') {
    const dates = [...new Set(rows.map(r => r.Date))].sort();
    const latest = dates[dates.length - 1];
    if (!latest) return rows;
    return rows.filter(r => r.Date === latest);
  }
  if (range === 'custom' && startDate && endDate) {
    return rows.filter(r => r.Date >= startDate && r.Date <= endDate);
  }
  return rows;
}

export function buildAlignedData(
  daLmpRows: LmpRow[],
  rtLmpRows: LmpRow[],
  daAspRows: AspRow[],
  rtAspRows: AspRow[],
  zone: string,
  aspProduct: AspProduct,
  dateRange: DateRange,
  startDate?: string,
  endDate?: string
): AlignedRow[] {
  const daLmp = filterByDateRange(daLmpRows.filter(r => String(r.Zone) === zone), dateRange, startDate, endDate);
  const rtLmp = filterByDateRange(rtLmpRows.filter(r => String(r.Zone) === zone), dateRange, startDate, endDate);

  const aspZones = getAvailableAspZones(daAspRows);
  const aspZone = aspZones.includes(zone) ? zone : (aspZones.includes('NYCA') ? 'NYCA' : aspZones[0] || '');

  const daAsp = filterByDateRange(daAspRows.filter(r => String(r.Zone) === aspZone), dateRange, startDate, endDate);
  const rtAsp = filterByDateRange(rtAspRows.filter(r => String(r.Zone) === aspZone), dateRange, startDate, endDate);

  function buildMapWithDuplicates<T>(items: T[], keyFn: (r: T) => string, valueFn: (r: T) => number): Record<string, number> {
    const map: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const r of items) {
      const baseKey = keyFn(r);
      counts[baseKey] = (counts[baseKey] || 0) + 1;
      const key = counts[baseKey] > 1 ? `${baseKey}_dup${counts[baseKey]}` : baseKey;
      map[key] = valueFn(r);
    }
    return map;
  }

  const daLmpMap = buildMapWithDuplicates(daLmp, r => `${r.Date}_${r.HE}`, r => Number(r.LMP));
  const rtLmpMap = buildMapWithDuplicates(rtLmp, r => `${r.Date}_${r.HE}`, r => Number(r.LMP));
  const daAspMap = buildMapWithDuplicates(daAsp, r => `${r.Date}_${r.HE}`, r => Number(r[aspProduct] || 0));
  const rtAspMap = buildMapWithDuplicates(rtAsp, r => `${r.Date}_${r.HE}`, r => Number(r[aspProduct] || 0));

  const allKeys = new Set([
    ...Object.keys(daLmpMap),
    ...Object.keys(rtLmpMap),
    ...Object.keys(daAspMap),
    ...Object.keys(rtAspMap),
  ]);

  const sortedKeys = [...allKeys].sort();
  const seen = new Set<string>();
  const rows: AlignedRow[] = [];
  for (const key of sortedKeys) {
    const parts = key.split('_');
    const date = parts[0];
    const he = Number(parts[1]);
    const da = daLmpMap[key] ?? null;
    const rt = rtLmpMap[key] ?? null;
    const daA = daAspMap[key] ?? null;
    const rtA = rtAspMap[key] ?? null;
    const { label } = makeUniqueHourlyKey(date, he, seen);
    rows.push({
      Date: date,
      HE: he,
      label,
      daLmp: da,
      rtLmp: rt,
      daAsp: daA,
      rtAsp: rtA,
      daRtLmpSpread: da != null && rt != null ? da - rt : null,
      daRtAspSpread: daA != null && rtA != null ? daA - rtA : null,
    });
  }

  return rows.sort((a, b) => a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : a.HE - b.HE);
}

export interface PivotedSeriesRow {
  Date: string;
  [key: string]: string | number | null;
}

export function pivotForChart(
  aligned: AlignedRow[],
  resolution: Resolution,
  mode: CompareMode
): { lmpData: PivotedSeriesRow[]; aspData: PivotedSeriesRow[] } {
  let filtered = aligned;
  if (resolution === 'on_peak') filtered = aligned.filter(r => isOnPeak(r.HE));
  if (resolution === 'off_peak') filtered = aligned.filter(r => !isOnPeak(r.HE));

  if (resolution === 'hourly') {
    const lmpData: PivotedSeriesRow[] = [];
    const aspData: PivotedSeriesRow[] = [];
    for (const r of filtered) {
      if (mode === 'spread') {
        lmpData.push({ Date: r.label, 'DA-RT LMP Spread': r.daRtLmpSpread });
        aspData.push({ Date: r.label, 'DA-RT ASP Spread': r.daRtAspSpread });
      } else if (mode === 'normalized' && r.daLmp && r.rtLmp) {
        const baseLmp = r.daLmp || 1;
        const baseAsp = r.daAsp || 1;
        lmpData.push({ Date: r.label, 'DA LMP (indexed)': 100, 'RT LMP (indexed)': (r.rtLmp / baseLmp) * 100 });
        aspData.push({ Date: r.label, 'DA ASP (indexed)': 100, 'RT ASP (indexed)': r.rtAsp != null && baseAsp ? (r.rtAsp / baseAsp) * 100 : null });
      } else {
        lmpData.push({ Date: r.label, 'DA LMP': r.daLmp, 'RT LMP': r.rtLmp });
        aspData.push({ Date: r.label, 'DA ASP': r.daAsp, 'RT ASP': r.rtAsp });
      }
    }
    return { lmpData, aspData };
  }

  const groups: Record<string, AlignedRow[]> = {};
  for (const r of filtered) {
    if (!groups[r.Date]) groups[r.Date] = [];
    groups[r.Date].push(r);
  }

  const lmpData: PivotedSeriesRow[] = [];
  const aspData: PivotedSeriesRow[] = [];
  for (const [date, rows] of Object.entries(groups).sort(([a], [b]) => a < b ? -1 : 1)) {
    const avg = (vals: (number | null)[]) => {
      const valid = vals.filter((v): v is number => v != null);
      return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    const avgDaLmp = avg(rows.map(r => r.daLmp));
    const avgRtLmp = avg(rows.map(r => r.rtLmp));
    const avgDaAsp = avg(rows.map(r => r.daAsp));
    const avgRtAsp = avg(rows.map(r => r.rtAsp));

    if (mode === 'spread') {
      lmpData.push({ Date: date, 'DA-RT LMP Spread': avgDaLmp != null && avgRtLmp != null ? Number((avgDaLmp - avgRtLmp).toFixed(2)) : null });
      aspData.push({ Date: date, 'DA-RT ASP Spread': avgDaAsp != null && avgRtAsp != null ? Number((avgDaAsp - avgRtAsp).toFixed(2)) : null });
    } else {
      lmpData.push({ Date: date, 'DA LMP': avgDaLmp != null ? Number(avgDaLmp.toFixed(2)) : null, 'RT LMP': avgRtLmp != null ? Number(avgRtLmp.toFixed(2)) : null });
      aspData.push({ Date: date, 'DA ASP': avgDaAsp != null ? Number(avgDaAsp.toFixed(2)) : null, 'RT ASP': avgRtAsp != null ? Number(avgRtAsp.toFixed(2)) : null });
    }
  }

  return { lmpData, aspData };
}

export interface ScarcityMetrics {
  peakDaAsp: number | null;
  peakRtAsp: number | null;
  peakDaLmp: number | null;
  peakRtLmp: number | null;
  avgDaAsp: number | null;
  avgRtAsp: number | null;
  rtExceedsDaAspPct: number | null;
  spikeAlignedPct: number | null;
  scarcityIntervals: number;
  totalIntervals: number;
  aspProduct: string;
  zone: string;
}

export function computeScarcityMetrics(
  aligned: AlignedRow[],
  aspProduct: string,
  zone: string
): ScarcityMetrics {
  const valid = aligned.filter(r => r.daAsp != null || r.rtAsp != null);
  if (!valid.length) return {
    peakDaAsp: null, peakRtAsp: null, peakDaLmp: null, peakRtLmp: null,
    avgDaAsp: null, avgRtAsp: null, rtExceedsDaAspPct: null,
    spikeAlignedPct: null, scarcityIntervals: 0, totalIntervals: 0,
    aspProduct, zone,
  };

  const daAsps = valid.map(r => r.daAsp).filter((v): v is number => v != null);
  const rtAsps = valid.map(r => r.rtAsp).filter((v): v is number => v != null);
  const daLmps = valid.map(r => r.daLmp).filter((v): v is number => v != null);
  const rtLmps = valid.map(r => r.rtLmp).filter((v): v is number => v != null);

  const avgDaAsp = daAsps.length ? daAsps.reduce((a, b) => a + b, 0) / daAsps.length : null;
  const avgRtAsp = rtAsps.length ? rtAsps.reduce((a, b) => a + b, 0) / rtAsps.length : null;

  const rtExceedsCount = valid.filter(r =>
    r.rtAsp != null && r.daAsp != null && r.rtAsp > r.daAsp
  ).length;
  const pairCount = valid.filter(r => r.rtAsp != null && r.daAsp != null).length;

  const avgRtLmp = rtLmps.length ? rtLmps.reduce((a, b) => a + b, 0) / rtLmps.length : 0;
  const avgRtAspVal = avgRtAsp || 0;

  const scarcityThresholdLmp = avgRtLmp * 1.5;
  const scarcityThresholdAsp = avgRtAspVal > 0 ? avgRtAspVal * 2 : 10;

  const scarcityIntervals = valid.filter(r =>
    (r.rtLmp != null && r.rtLmp > scarcityThresholdLmp) &&
    (r.rtAsp != null && r.rtAsp > scarcityThresholdAsp)
  ).length;

  const spikeRows = valid.filter(r =>
    r.rtLmp != null && r.rtAsp != null
  );
  const lmpP90 = percentile(spikeRows.map(r => r.rtLmp!), 0.9);
  const aspP90 = percentile(spikeRows.map(r => r.rtAsp!), 0.9);
  const lmpSpikes = new Set(spikeRows.filter(r => r.rtLmp! >= lmpP90).map(r => `${r.Date}_${r.HE}`));
  const aspSpikes = new Set(spikeRows.filter(r => r.rtAsp! >= aspP90).map(r => `${r.Date}_${r.HE}`));
  const alignedSpikes = [...lmpSpikes].filter(k => aspSpikes.has(k)).length;
  const totalSpikes = new Set([...lmpSpikes, ...aspSpikes]).size;

  return {
    peakDaAsp: daAsps.length ? Math.max(...daAsps) : null,
    peakRtAsp: rtAsps.length ? Math.max(...rtAsps) : null,
    peakDaLmp: daLmps.length ? Math.max(...daLmps) : null,
    peakRtLmp: rtLmps.length ? Math.max(...rtLmps) : null,
    avgDaAsp,
    avgRtAsp,
    rtExceedsDaAspPct: pairCount > 0 ? (rtExceedsCount / pairCount) * 100 : null,
    spikeAlignedPct: totalSpikes > 0 ? (alignedSpikes / totalSpikes) * 100 : null,
    scarcityIntervals,
    totalIntervals: valid.length,
    aspProduct,
    zone,
  };
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function buildScarcitySignalSummary(metrics: ScarcityMetrics): string {
  const parts: string[] = [];

  if (metrics.peakRtAsp != null && metrics.peakDaAsp != null) {
    parts.push(
      `Peak ${metrics.aspProduct}: DA $${metrics.peakDaAsp.toFixed(2)}/MWh, RT $${metrics.peakRtAsp.toFixed(2)}/MWh.`
    );
  }

  if (metrics.rtExceedsDaAspPct != null) {
    if (metrics.rtExceedsDaAspPct > 60) {
      parts.push(`RT ancillary prices exceeded DA in ${metrics.rtExceedsDaAspPct.toFixed(0)}% of intervals — suggests tighter real-time conditions than day-ahead anticipated.`);
    } else if (metrics.rtExceedsDaAspPct > 40) {
      parts.push(`RT and DA ancillary prices are roughly balanced (RT exceeded DA in ${metrics.rtExceedsDaAspPct.toFixed(0)}% of intervals).`);
    } else {
      parts.push(`DA ancillary prices were generally higher than RT (RT exceeded DA in only ${metrics.rtExceedsDaAspPct.toFixed(0)}% of intervals).`);
    }
  }

  if (metrics.spikeAlignedPct != null) {
    if (metrics.spikeAlignedPct > 50) {
      parts.push(`LMP and ancillary price spikes were well-aligned (${metrics.spikeAlignedPct.toFixed(0)}% co-occurrence) — consistent with system-wide scarcity events.`);
    } else if (metrics.spikeAlignedPct > 20) {
      parts.push(`LMP and ancillary spikes showed moderate alignment (${metrics.spikeAlignedPct.toFixed(0)}% co-occurrence).`);
    } else {
      parts.push(`LMP and ancillary price spikes were mostly independent — ancillary tightness may not be driven by energy scarcity.`);
    }
  }

  if (metrics.scarcityIntervals > 0) {
    parts.push(`${metrics.scarcityIntervals} of ${metrics.totalIntervals} intervals showed elevated RT conditions in both energy and ancillary markets for ${metrics.zone}.`);
  } else {
    parts.push(`No intervals with simultaneous elevated RT LMP and ancillary prices detected for ${metrics.zone}.`);
  }

  return parts.join(' ');
}
