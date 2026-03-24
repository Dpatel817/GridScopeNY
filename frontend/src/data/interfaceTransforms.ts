/* eslint-disable @typescript-eslint/no-unused-vars */
import { getInterfaceMeta, getDisplayName } from './interfaceMetadata';
import type { InterfaceMeta } from './interfaceMetadata';
import { makeUniqueHourlyKey } from '../utils/dateFormat';
import { buildTimestamp } from '../utils/timeSeries';

export type ChartType = 'line' | 'line-markers' | 'area' | 'bar';
export type Resolution = 'hourly' | 'on_peak' | 'off_peak' | 'daily';
export type DateRange = 'today' | 'all' | 'custom';
export type ClassFilter = 'all' | 'Internal' | 'External';

export const ON_PEAK_START = 8;
export const ON_PEAK_END = 22;

export interface FlowRow {
  Date: string;
  HE: number | string;
  [key: string]: string | number;
}

export interface InterfaceInfo {
  raw: string;
  display: string;
  meta: InterfaceMeta;
}

export interface PivotedRow {
  Date: string;
  [key: string]: string | number;
}

export function isOnPeak(he: number): boolean {
  return he >= ON_PEAK_START && he <= ON_PEAK_END;
}

export function detectFlowColumns(rows: FlowRow[]): { nameCol: string; flowCol: string } {
  if (!rows.length) return { nameCol: 'Interface', flowCol: 'Flow' };
  const r = rows[0];
  const nameCol = r.Interface !== undefined ? 'Interface' : 'Interface Name';
  const flowCol = r.Flow !== undefined ? 'Flow' : 'Flow (MW)';
  return { nameCol, flowCol };
}

export function extractInterfaces(rows: FlowRow[], nameCol: string): InterfaceInfo[] {
  const seen = new Set<string>();
  const result: InterfaceInfo[] = [];
  for (const r of rows) {
    const raw = String(r[nameCol] || '');
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const meta = getInterfaceMeta(raw);
    result.push({ raw, display: meta.display, meta });
  }
  return result.sort((a, b) => a.display.localeCompare(b.display));
}

export function getAvailableDates(rows: FlowRow[]): string[] {
  return [...new Set(rows.map(r => r.Date).filter(Boolean))].sort();
}

export function filterByDateRange(
  rows: FlowRow[],
  range: DateRange,
  startDate?: string,
  endDate?: string
): FlowRow[] {
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

export function filterByClass(
  rows: FlowRow[],
  classFilter: ClassFilter,
  nameCol: string
): FlowRow[] {
  if (classFilter === 'all') return rows;
  return rows.filter(r => {
    const meta = getInterfaceMeta(String(r[nameCol] || ''));
    return meta.classification === classFilter;
  });
}

export function filterByInterfaces(
  rows: FlowRow[],
  selected: string[],
  nameCol: string
): FlowRow[] {
  if (!selected.length) return rows;
  const displaySet = new Set(selected);
  return rows.filter(r => {
    const display = getDisplayName(String(r[nameCol] || ''));
    return displaySet.has(display);
  });
}

export function pivotFlows(
  rows: FlowRow[],
  interfaces: string[],
  nameCol: string,
  flowCol: string,
  resolution: Resolution
): PivotedRow[] {
  const displaySet = new Set(interfaces);

  const filtered = rows.filter(r => {
    const display = getDisplayName(String(r[nameCol] || ''));
    if (!displaySet.has(display)) return false;
    const he = Number(r.HE);
    if (resolution === 'on_peak') return isOnPeak(he);
    if (resolution === 'off_peak') return !isOnPeak(he);
    return true;
  });

  if (resolution === 'hourly') {
    const map: Record<string, PivotedRow & { _sortTs: number }> = {};
    const seen = new Set<string>();
    for (const r of filtered) {
      const display = getDisplayName(String(r[nameCol] || ''));
      const he = Number(r.HE ?? 0);
      const { key, label } = r.HE != null
        ? makeUniqueHourlyKey(r.Date, r.HE, seen, display)
        : { key: r.Date, label: r.Date };
      if (!map[key]) {
        const isDup = key.endsWith('b');
        const ts = r.HE != null ? buildTimestamp(r.Date, he, isDup) : new Date(r.Date).getTime();
        map[key] = { Date: label, _ts: ts, _sortTs: ts };
      }
      map[key][display] = Number(r[flowCol] || 0);
    }
    return Object.values(map)
      .sort((a, b) => a._sortTs - b._sortTs)
      .map(({ _sortTs, ...rest }) => rest as PivotedRow);
  }

  const accum: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const r of filtered) {
    const display = getDisplayName(String(r[nameCol] || ''));
    const key = r.Date;
    if (!accum[key]) accum[key] = {};
    if (!accum[key][display]) accum[key][display] = { sum: 0, count: 0 };
    const v = Number(r[flowCol] || 0);
    if (!isNaN(v)) {
      accum[key][display].sum += v;
      accum[key][display].count++;
    }
  }

  return Object.entries(accum)
    .map(([date, iData]) => {
      const row: PivotedRow = { Date: date };
      for (const [iface, { sum, count }] of Object.entries(iData)) {
        row[iface] = count > 0 ? Math.round(sum / count) : 0;
      }
      return row;
    })
    .sort((a, b) => (a.Date < b.Date ? -1 : 1));
}

export interface InterfaceStat {
  raw: string;
  display: string;
  meta: InterfaceMeta;
  total: number;
  count: number;
  max: number;
  min: number;
  avg: number;
  absActivity: number;
}

export function computeInterfaceStats(
  rows: FlowRow[],
  nameCol: string,
  flowCol: string,
  classFilter: ClassFilter = 'all'
): InterfaceStat[] {
  const byInterface: Record<string, { raw: string; total: number; count: number; max: number; min: number; absSum: number }> = {};
  for (const r of rows) {
    const raw = String(r[nameCol] || 'Unknown');
    const flow = Number(r[flowCol] || 0);
    if (isNaN(flow)) continue;
    if (!byInterface[raw]) byInterface[raw] = { raw, total: 0, count: 0, max: -Infinity, min: Infinity, absSum: 0 };
    byInterface[raw].total += flow;
    byInterface[raw].count++;
    byInterface[raw].max = Math.max(byInterface[raw].max, flow);
    byInterface[raw].min = Math.min(byInterface[raw].min, flow);
    byInterface[raw].absSum += Math.abs(flow);
  }

  let stats: InterfaceStat[] = Object.values(byInterface)
    .map(s => {
      const meta = getInterfaceMeta(s.raw);
      return {
        raw: s.raw,
        display: meta.display,
        meta,
        total: s.total,
        count: s.count,
        max: s.max,
        min: s.min,
        avg: s.count > 0 ? s.total / s.count : 0,
        absActivity: s.count > 0 ? s.absSum / s.count : 0,
      };
    })
    .sort((a, b) => b.absActivity - a.absActivity);

  if (classFilter !== 'all') {
    stats = stats.filter(s => s.meta.classification === classFilter);
  }

  return stats;
}
