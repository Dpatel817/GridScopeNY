export type ChartType = 'line' | 'line-markers' | 'area' | 'bar';
export type Resolution = 'hourly' | 'on_peak' | 'off_peak' | 'daily';
export type DateRange = 'today' | 'all' | 'custom';

export const ON_PEAK_START = 7;
export const ON_PEAK_END = 22;

export interface CongestionRow {
  Date: string;
  HE: number | string;
  [key: string]: string | number;
}

export interface PivotedRow {
  Date: string;
  [key: string]: string | number | null;
}

export function isOnPeak(he: number): boolean {
  return he >= ON_PEAK_START && he <= ON_PEAK_END;
}

export function detectColumns(rows: CongestionRow[]): { nameCol: string; costCol: string } {
  if (!rows.length) return { nameCol: 'Limiting Facility', costCol: 'Constraint Cost' };
  const r = rows[0];
  const nameCol = r['Limiting Facility'] !== undefined ? 'Limiting Facility' : 'Constraint';
  const costCol = r['Constraint Cost'] !== undefined ? 'Constraint Cost' : 'ShadowPrice';
  return { nameCol, costCol };
}

export function extractConstraints(rows: CongestionRow[], nameCol: string): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const name = String(r[nameCol] || '');
    if (name) seen.add(name);
  }
  return [...seen].sort();
}

export function getAvailableDates(rows: CongestionRow[]): string[] {
  return [...new Set(rows.map(r => r.Date).filter(Boolean))].sort();
}

export function filterByDateRange(
  rows: CongestionRow[],
  range: DateRange,
  startDate?: string,
  endDate?: string
): CongestionRow[] {
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

export interface ConstraintStat {
  name: string;
  total: number;
  count: number;
  max: number;
  avg: number;
  rank: number;
}

export function computeConstraintStats(
  rows: CongestionRow[],
  nameCol: string,
  costCol: string
): ConstraintStat[] {
  const byConstraint: Record<string, { total: number; count: number; max: number }> = {};
  for (const r of rows) {
    const name = String(r[nameCol] || 'Unknown');
    const cost = Math.abs(Number(r[costCol] || 0));
    if (!byConstraint[name]) byConstraint[name] = { total: 0, count: 0, max: 0 };
    byConstraint[name].total += cost;
    byConstraint[name].count++;
    byConstraint[name].max = Math.max(byConstraint[name].max, cost);
  }

  return Object.entries(byConstraint)
    .map(([name, s]) => ({
      name,
      total: s.total,
      count: s.count,
      max: s.max,
      avg: s.count > 0 ? s.total / s.count : 0,
      rank: 0,
    }))
    .sort((a, b) => b.total - a.total)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

export function pivotCongestion(
  rows: CongestionRow[],
  constraints: string[],
  nameCol: string,
  costCol: string,
  resolution: Resolution
): PivotedRow[] {
  const constraintSet = new Set(constraints);

  const filtered = rows.filter(r => {
    if (!constraintSet.has(String(r[nameCol] || ''))) return false;
    const he = Number(r.HE);
    if (resolution === 'on_peak') return isOnPeak(he);
    if (resolution === 'off_peak') return !isOnPeak(he);
    return true;
  });

  if (resolution === 'hourly') {
    const map: Record<string, PivotedRow & { _sortDate: string; _sortHE: number; _counts: Record<string, number> }> = {};
    for (const r of filtered) {
      const name = String(r[nameCol] || '');
      const he = Number(r.HE ?? 0);
      const key = `${r.Date}_${he}`;
      const label = r.HE != null ? `${r.Date} HE${r.HE}` : r.Date;
      if (!map[key]) map[key] = { Date: label, _sortDate: r.Date, _sortHE: he, _counts: {} };
      const v = Number(r[costCol] || 0);
      if (!map[key]._counts[name]) {
        map[key][name] = v;
        map[key]._counts[name] = 1;
      } else {
        map[key][name] = (Number(map[key][name]) || 0) + v;
        map[key]._counts[name]++;
      }
    }
    const sorted = Object.values(map)
      .sort((a, b) => a._sortDate < b._sortDate ? -1 : a._sortDate > b._sortDate ? 1 : a._sortHE - b._sortHE)
      .map(({ _sortDate: _d, _sortHE: _h, _counts: _c, ...rest }) => rest as PivotedRow);
    for (const row of sorted) {
      for (const c of constraints) {
        if (!(c in row)) row[c] = null;
      }
    }
    return sorted;
  }

  const accum: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const r of filtered) {
    const name = String(r[nameCol] || '');
    const key = r.Date;
    if (!accum[key]) accum[key] = {};
    if (!accum[key][name]) accum[key][name] = { sum: 0, count: 0 };
    const v = Number(r[costCol] || 0);
    if (!isNaN(v)) {
      accum[key][name].sum += v;
      accum[key][name].count++;
    }
  }

  const result = Object.entries(accum)
    .map(([date, cData]) => {
      const row: PivotedRow = { Date: date };
      for (const [name, { sum, count }] of Object.entries(cData)) {
        row[name] = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
      }
      return row;
    })
    .sort((a, b) => (a.Date < b.Date ? -1 : 1));
  for (const row of result) {
    for (const c of constraints) {
      if (!(c in row)) row[c] = null;
    }
  }
  return result;
}
