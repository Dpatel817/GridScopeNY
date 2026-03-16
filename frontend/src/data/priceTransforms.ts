import { isNyisoZone } from './zones';

export interface PriceRow {
  'Time Stamp': string;
  Date: string;
  HE: number;
  Zone: string;
  LMP: number;
  MLC: number;
  MCC: number;
  [key: string]: unknown;
}

export type ChartType = 'line' | 'line-markers' | 'area' | 'bar';
export type Resolution = 'hourly' | 'on_peak' | 'off_peak' | 'daily';
export type DateRange = 'today' | 'all' | 'custom';

export const ON_PEAK_START = 7;
export const ON_PEAK_END = 22;

export function isOnPeak(he: number): boolean {
  return he >= ON_PEAK_START && he <= ON_PEAK_END;
}

export function filterByZones(rows: PriceRow[], zones: string[]): PriceRow[] {
  const zoneSet = new Set(zones);
  return rows.filter(r => zoneSet.has(String(r.Zone)));
}

export function filterByDateRange(
  rows: PriceRow[],
  range: DateRange,
  startDate?: string,
  endDate?: string
): PriceRow[] {
  if (range === 'all') return rows;
  if (range === 'today') {
    const dates = [...new Set(rows.map(r => r.Date))].sort();
    const latest = dates[dates.length - 1];
    if (!latest) return rows;
    return rows.filter(r => r.Date === latest);
  }
  if (range === 'custom') {
    if (startDate && endDate) {
      return rows.filter(r => r.Date >= startDate && r.Date <= endDate);
    }
    const dates = [...new Set(rows.map(r => r.Date))].sort();
    if (dates.length > 0) {
      const end = dates[dates.length - 1];
      const startIdx = Math.max(0, dates.length - 7);
      const start = dates[startIdx];
      return rows.filter(r => r.Date >= start && r.Date <= end);
    }
  }
  return rows;
}

export function filterNyisoOnly(rows: PriceRow[]): PriceRow[] {
  return rows.filter(r => isNyisoZone(String(r.Zone)));
}

export interface PivotedRow {
  Date: string;
  [zone: string]: string | number;
}

export type LmpField = 'LMP' | 'MLC' | 'MCC';

export function pivotByZone(
  rows: PriceRow[],
  zones: string[],
  resolution: Resolution,
  field: LmpField = 'LMP'
): PivotedRow[] {
  const filtered = filterByZones(filterNyisoOnly(rows), zones);
  const hasHE = filtered.some(r => r.HE != null);

  if (resolution === 'hourly' && hasHE) {
    return pivotHourly(filtered, zones, field);
  }
  if (hasHE && resolution === 'on_peak') {
    return pivotAggregated(filtered.filter(r => isOnPeak(r.HE)), zones, 'date', field);
  }
  if (hasHE && resolution === 'off_peak') {
    return pivotAggregated(filtered.filter(r => !isOnPeak(r.HE)), zones, 'date', field);
  }
  return pivotAggregated(filtered, zones, 'date', field);
}

function pivotHourly(rows: PriceRow[], zones: string[], field: LmpField = 'LMP'): PivotedRow[] {
  const map: Record<string, PivotedRow> = {};
  for (const r of rows) {
    const zone = String(r.Zone);
    if (!zones.includes(zone)) continue;
    const key = `${r.Date}_${r.HE ?? ''}`;
    const label = r.HE != null ? `${r.Date} HE${r.HE}` : r.Date;
    if (!map[key]) map[key] = { Date: label };
    map[key][zone] = Number(r[field]);
  }
  return Object.values(map).sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
}

function pivotAggregated(
  rows: PriceRow[],
  zones: string[],
  _groupBy: 'date' = 'date',
  field: LmpField = 'LMP'
): PivotedRow[] {
  const accum: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const r of rows) {
    const zone = String(r.Zone);
    if (!zones.includes(zone)) continue;
    const key = r.Date;
    if (!accum[key]) accum[key] = {};
    if (!accum[key][zone]) accum[key][zone] = { sum: 0, count: 0 };
    const val = Number(r[field]);
    if (!isNaN(val)) {
      accum[key][zone].sum += val;
      accum[key][zone].count++;
    }
  }
  return Object.entries(accum)
    .map(([date, zoneData]) => {
      const row: PivotedRow = { Date: date };
      for (const [zone, { sum, count }] of Object.entries(zoneData)) {
        row[zone] = count > 0 ? Number((sum / count).toFixed(2)) : 0;
      }
      return row;
    })
    .sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
}

export function computeDartSpread(
  daRows: PriceRow[],
  rtRows: PriceRow[],
  zones: string[],
  resolution: Resolution,
  dateRange: DateRange,
  startDate?: string,
  endDate?: string,
  field: LmpField = 'LMP'
): PivotedRow[] {
  const daFiltered = filterByDateRange(filterByZones(filterNyisoOnly(daRows), zones), dateRange, startDate, endDate);
  const rtFiltered = filterByDateRange(filterByZones(filterNyisoOnly(rtRows), zones), dateRange, startDate, endDate);

  const hasHE = daFiltered.some(r => r.HE != null);
  const rtMap: Record<string, number> = {};
  for (const r of rtFiltered) {
    const k = hasHE ? `${r.Date}_${r.HE}_${r.Zone}` : `${r.Date}_${r.Zone}`;
    rtMap[k] = Number(r[field]);
  }

  interface DartRow { Date: string; HE: number; Zone: string; DART: number }
  const dartRows: DartRow[] = [];
  for (const r of daFiltered) {
    const key = hasHE ? `${r.Date}_${r.HE}_${String(r.Zone)}` : `${r.Date}_${String(r.Zone)}`;
    const rtVal = rtMap[key];
    if (rtVal !== undefined) {
      dartRows.push({
        Date: r.Date,
        HE: r.HE ?? 0,
        Zone: String(r.Zone),
        DART: Number(r[field]) - rtVal,
      });
    }
  }

  if (resolution === 'hourly' && hasHE) {
    const map: Record<string, PivotedRow> = {};
    for (const r of dartRows) {
      const key = `${r.Date}_${r.HE}`;
      const label = `${r.Date} HE${r.HE}`;
      if (!map[key]) map[key] = { Date: label };
      map[key][r.Zone] = Number(r.DART.toFixed(2));
    }
    return Object.values(map).sort((a, b) => (a.Date < b.Date ? -1 : 1));
  }

  let filtered = dartRows;
  if (hasHE) {
    if (resolution === 'on_peak') filtered = dartRows.filter(r => isOnPeak(r.HE));
    if (resolution === 'off_peak') filtered = dartRows.filter(r => !isOnPeak(r.HE));
  }

  const accum: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const r of filtered) {
    if (!accum[r.Date]) accum[r.Date] = {};
    if (!accum[r.Date][r.Zone]) accum[r.Date][r.Zone] = { sum: 0, count: 0 };
    accum[r.Date][r.Zone].sum += r.DART;
    accum[r.Date][r.Zone].count++;
  }

  return Object.entries(accum)
    .map(([date, zoneData]) => {
      const row: PivotedRow = { Date: date };
      for (const [zone, { sum, count }] of Object.entries(zoneData)) {
        row[zone] = count > 0 ? Number((sum / count).toFixed(2)) : 0;
      }
      return row;
    })
    .sort((a, b) => (a.Date < b.Date ? -1 : 1));
}

export function getAvailableDates(rows: PriceRow[]): string[] {
  return [...new Set(rows.map(r => r.Date))].sort();
}
