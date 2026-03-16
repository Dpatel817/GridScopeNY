import { makeUniqueHourlyKey } from '../utils/dateFormat';

export type ChartType = 'line' | 'line-markers' | 'area' | 'bar';
export type Resolution = 'hourly' | 'on_peak' | 'off_peak' | 'daily';
export type DateRange = 'today' | 'all' | 'custom';

export const ON_PEAK_START = 8;
export const ON_PEAK_END = 22;

export interface GenRow {
  Date: string;
  HE: number;
  'Time Stamp'?: string;
  [key: string]: unknown;
}

export interface PivotedRow {
  Date: string;
  [key: string]: string | number;
}

export function isOnPeak(he: number): boolean {
  return he >= ON_PEAK_START && he <= ON_PEAK_END;
}

export function detectColumns(rows: GenRow[]): { genCol: string; fuelCol: string } {
  if (!rows.length) return { genCol: 'Gen MW', fuelCol: 'Fuel Category' };
  const r = rows[0];
  const genCol = r['Generation MW'] !== undefined ? 'Generation MW' : 'Gen MW';
  const fuelCol = r['Fuel Type'] !== undefined ? 'Fuel Type' : 'Fuel Category';
  return { genCol, fuelCol };
}

export function extractFuels(rows: GenRow[], fuelCol: string): string[] {
  const fuels = new Set<string>();
  for (const r of rows) {
    const f = String(r[fuelCol] || '');
    if (f) fuels.add(f);
  }
  return [...fuels].sort();
}

export function getAvailableDates(rows: GenRow[]): string[] {
  return [...new Set(rows.map(r => r.Date).filter(Boolean))].sort();
}

export function filterByDateRange(
  rows: GenRow[],
  range: DateRange,
  startDate?: string,
  endDate?: string
): GenRow[] {
  if (range === 'all') return rows;
  if (range === 'today') {
    const dates = getAvailableDates(rows);
    const latest = dates[dates.length - 1];
    if (!latest) return rows;
    return rows.filter(r => r.Date === latest);
  }
  if (range === 'custom') {
    if (startDate && endDate) {
      return rows.filter(r => r.Date >= startDate && r.Date <= endDate);
    }
    const dates = getAvailableDates(rows);
    if (dates.length > 0) {
      const end = dates[dates.length - 1];
      const startIdx = Math.max(0, dates.length - 7);
      const start = dates[startIdx];
      return rows.filter(r => r.Date >= start && r.Date <= end);
    }
  }
  return rows;
}

export function pivotByFuel(
  rows: GenRow[],
  fuels: string[],
  fuelCol: string,
  genCol: string,
  resolution: Resolution
): PivotedRow[] {
  const fuelSet = new Set(fuels);

  const filtered = rows.filter(r => {
    if (!fuelSet.has(String(r[fuelCol] || ''))) return false;
    if (resolution === 'on_peak') return isOnPeak(Number(r.HE));
    if (resolution === 'off_peak') return !isOnPeak(Number(r.HE));
    return true;
  });

  if (resolution === 'hourly') {
    const map: Record<string, PivotedRow> = {};
    const seen = new Set<string>();
    for (const r of filtered) {
      const fuel = String(r[fuelCol]);
      const { key, label } = r.HE != null
        ? makeUniqueHourlyKey(r.Date, r.HE, seen, fuel)
        : { key: r.Date, label: r.Date };
      if (!map[key]) map[key] = { Date: label };
      map[key][fuel] = Number(r[genCol] || 0);
    }
    return Object.values(map).sort((a, b) => (a.Date < b.Date ? -1 : 1));
  }

  const snap: Record<string, number> = {};
  for (const r of filtered) {
    const fuel = String(r[fuelCol]);
    const snapKey = `${r.Date}_${r.HE}_${fuel}`;
    snap[snapKey] = Number(r[genCol] || 0);
  }

  const accum: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const [snapKey, v] of Object.entries(snap)) {
    const parts = snapKey.split('_');
    const date = parts[0];
    const fuel = parts.slice(2).join('_');
    if (!accum[date]) accum[date] = {};
    if (!accum[date][fuel]) accum[date][fuel] = { sum: 0, count: 0 };
    if (!isNaN(v)) {
      accum[date][fuel].sum += v;
      accum[date][fuel].count++;
    }
  }

  return Object.entries(accum)
    .map(([date, fData]) => {
      const row: PivotedRow = { Date: date };
      for (const [fuel, { sum, count }] of Object.entries(fData)) {
        row[fuel] = count > 0 ? Math.round(sum / count) : 0;
      }
      return row;
    })
    .sort((a, b) => (a.Date < b.Date ? -1 : 1));
}

export interface FuelBreakdown {
  name: string;
  total: number;
  count: number;
  max: number;
  avg: number;
  share: number;
}

export function computeFuelBreakdown(
  rows: GenRow[],
  fuelCol: string,
  genCol: string
): FuelBreakdown[] {
  const snap: Record<string, number> = {};
  for (const r of rows) {
    const fuel = String(r[fuelCol] || 'Unknown');
    const gen = Number(r[genCol] || 0);
    const key = `${r.Date}_${r.HE}_${fuel}`;
    snap[key] = gen;
  }

  const byFuel: Record<string, { total: number; count: number; max: number }> = {};
  for (const [key, gen] of Object.entries(snap)) {
    const fuel = key.split('_').slice(2).join('_');
    if (!byFuel[fuel]) byFuel[fuel] = { total: 0, count: 0, max: 0 };
    byFuel[fuel].total += gen;
    byFuel[fuel].count++;
    byFuel[fuel].max = Math.max(byFuel[fuel].max, gen);
  }

  const grandTotal = Object.values(byFuel).reduce((s, f) => s + f.total, 0);

  return Object.entries(byFuel)
    .map(([name, f]) => ({
      name,
      total: f.total,
      count: f.count,
      max: f.max,
      avg: f.count > 0 ? f.total / f.count : 0,
      share: grandTotal > 0 ? (f.total / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
