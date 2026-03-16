export type ChartType = 'line' | 'line-markers' | 'area' | 'bar';
export type Resolution = 'hourly' | 'on_peak' | 'off_peak' | 'daily';
export type DateRange = 'today' | 'all' | 'custom';

export const ON_PEAK_START = 7;
export const ON_PEAK_END = 22;

export interface DemandRow {
  Date: string;
  HE: number;
  [zone: string]: string | number;
}

export interface PivotedRow {
  Date: string;
  [key: string]: string | number;
}

const META_COLS = new Set([
  'Date', 'Time Stamp', 'HE', 'MONTH', 'YEAR', 'Month', 'Year',
  'Vintage Date', 'Forecast Date', 'source_date', 'SOURCE_DATE',
  'source_file', 'Time Zone',
]);

export function isOnPeak(he: number): boolean {
  return he >= ON_PEAK_START && he <= ON_PEAK_END;
}

export function extractZones(rows: DemandRow[]): string[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter(k => !META_COLS.has(k)).sort();
}

export function getAvailableDates(rows: DemandRow[]): string[] {
  return [...new Set(rows.map(r => r.Date).filter(Boolean))].sort();
}

export function filterByDateRange(
  rows: DemandRow[],
  range: DateRange,
  startDate?: string,
  endDate?: string
): DemandRow[] {
  if (range === 'all') return rows;
  if (range === 'today') {
    const dates = getAvailableDates(rows);
    const latest = dates[dates.length - 1];
    if (!latest) return rows;
    return rows.filter(r => r.Date === latest);
  }
  if (range === 'custom' && startDate && endDate) {
    return rows.filter(r => r.Date >= startDate && r.Date <= endDate);
  }
  return rows;
}

export function pivotZonalDemand(
  rows: DemandRow[],
  zones: string[],
  resolution: Resolution
): PivotedRow[] {
  const hasHE = rows.some(r => r.HE != null && Number(r.HE) > 0);
  const filtered = rows.filter(r => {
    if (!hasHE) return true;
    if (resolution === 'on_peak') return isOnPeak(Number(r.HE));
    if (resolution === 'off_peak') return !isOnPeak(Number(r.HE));
    return true;
  });

  if (resolution === 'hourly' && hasHE) {
    return filtered.map(r => {
      const row: PivotedRow = { Date: `${r.Date} HE${r.HE}` };
      for (const z of zones) {
        const v = Number(r[z]);
        if (!isNaN(v)) row[z] = Math.round(v);
      }
      return row;
    }).sort((a, b) => (a.Date < b.Date ? -1 : 1));
  }

  const accum: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const r of filtered) {
    const key = r.Date;
    if (!accum[key]) accum[key] = {};
    for (const z of zones) {
      const v = Number(r[z]);
      if (isNaN(v)) continue;
      if (!accum[key][z]) accum[key][z] = { sum: 0, count: 0 };
      accum[key][z].sum += v;
      accum[key][z].count++;
    }
  }

  return Object.entries(accum)
    .map(([date, zData]) => {
      const row: PivotedRow = { Date: date };
      for (const [z, { sum, count }] of Object.entries(zData)) {
        row[z] = count > 0 ? Math.round(sum / count) : 0;
      }
      return row;
    })
    .sort((a, b) => (a.Date < b.Date ? -1 : 1));
}

export interface AlignedRow {
  Date: string;
  HE: number;
  Forecast: number;
  Actual: number;
  Error: number;
}

export function alignForecastActual(
  forecastRows: DemandRow[],
  actualRows: DemandRow[]
): AlignedRow[] {
  const hasHE = forecastRows.some(r => r.HE != null) && actualRows.some(r => r.HE != null);
  const zoneMap: Record<string, number> = {};
  for (const r of actualRows) {
    const v = Number(r.Load || 0);
    if (v > 0) {
      const zone = String(r.Zone || r.PTID || '');
      const zoneKey = hasHE ? `${r.Date}_${r.HE}_${zone}` : `${r.Date}_${zone}`;
      zoneMap[zoneKey] = v;
    }
  }

  const actualMap: Record<string, number> = {};
  for (const [zk, v] of Object.entries(zoneMap)) {
    const parts = zk.split('_');
    const intervalKey = hasHE ? `${parts[0]}_${parts[1]}` : parts[0];
    actualMap[intervalKey] = (actualMap[intervalKey] || 0) + v;
  }

  const aligned: AlignedRow[] = [];
  for (const f of forecastRows) {
    const fVal = Number(f.NYISO || 0);
    if (!fVal) continue;
    const key = hasHE ? `${f.Date}_${f.HE}` : f.Date;
    const aVal = actualMap[key];
    if (aVal) {
      aligned.push({
        Date: f.Date,
        HE: hasHE ? Number(f.HE) : 0,
        Forecast: fVal,
        Actual: aVal,
        Error: fVal - aVal,
      });
    }
  }
  return aligned;
}

export function pivotForecastActual(
  aligned: AlignedRow[],
  resolution: Resolution
): PivotedRow[] {
  const hasHE = aligned.some(r => r.HE != null && r.HE > 0);
  const filtered = aligned.filter(r => {
    if (!hasHE) return true;
    if (resolution === 'on_peak') return isOnPeak(r.HE);
    if (resolution === 'off_peak') return !isOnPeak(r.HE);
    return true;
  });

  if (resolution === 'hourly' && hasHE) {
    return filtered.map(r => ({
      Date: `${r.Date} HE${r.HE}`,
      Forecast: Math.round(r.Forecast),
      Actual: Math.round(r.Actual),
    }));
  }

  const accum: Record<string, { fSum: number; aSum: number; count: number }> = {};
  for (const r of filtered) {
    if (!accum[r.Date]) accum[r.Date] = { fSum: 0, aSum: 0, count: 0 };
    accum[r.Date].fSum += r.Forecast;
    accum[r.Date].aSum += r.Actual;
    accum[r.Date].count++;
  }

  return Object.entries(accum)
    .map(([date, { fSum, aSum, count }]) => ({
      Date: date,
      Forecast: Math.round(fSum / count),
      Actual: Math.round(aSum / count),
    }))
    .sort((a, b) => (a.Date < b.Date ? -1 : 1));
}

export function pivotForecastError(
  aligned: AlignedRow[],
  resolution: Resolution
): PivotedRow[] {
  const hasHE = aligned.some(r => r.HE != null && r.HE > 0);
  const filtered = aligned.filter(r => {
    if (!hasHE) return true;
    if (resolution === 'on_peak') return isOnPeak(r.HE);
    if (resolution === 'off_peak') return !isOnPeak(r.HE);
    return true;
  });

  if (resolution === 'hourly' && hasHE) {
    return filtered.map(r => ({
      Date: `${r.Date} HE${r.HE}`,
      Error: Math.round(r.Error),
    }));
  }

  const accum: Record<string, { sum: number; count: number }> = {};
  for (const r of filtered) {
    if (!accum[r.Date]) accum[r.Date] = { sum: 0, count: 0 };
    accum[r.Date].sum += r.Error;
    accum[r.Date].count++;
  }

  return Object.entries(accum)
    .map(([date, { sum, count }]) => ({
      Date: date,
      Error: Math.round(sum / count),
    }))
    .sort((a, b) => (a.Date < b.Date ? -1 : 1));
}
