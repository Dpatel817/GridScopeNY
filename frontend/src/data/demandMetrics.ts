import type { AlignedRow } from './demandTransforms';
import type { DemandRow } from './demandTransforms';
import { isOnPeak } from './demandTransforms';

export interface DemandKPIs {
  onPeakAvgForecast: number | null;
  onPeakAvgActual: number | null;
  peakForecast: { value: number; he: number; date: string } | null;
  peakActual: { value: number; he: number; date: string } | null;
  lowForecast: { value: number; he: number; date: string } | null;
  lowActual: { value: number; he: number; date: string } | null;
  avgForecastError: number | null;
  peakForecastError: { value: number; he: number; date: string } | null;
  largestUnderForecast: { value: number; he: number; date: string } | null;
  largestOverForecast: { value: number; he: number; date: string } | null;
}

export function computeDemandKPIs(
  forecastRows: DemandRow[],
  aligned: AlignedRow[]
): DemandKPIs {
  const onPeakForecasts: number[] = [];
  const onPeakActuals: number[] = [];

  for (const r of aligned) {
    if (isOnPeak(r.HE)) {
      if (!isNaN(r.Forecast) && r.Forecast > 0) onPeakForecasts.push(r.Forecast);
      if (!isNaN(r.Actual) && r.Actual > 0) onPeakActuals.push(r.Actual);
    }
  }

  const onPeakAvgForecast = avg(onPeakForecasts);
  const onPeakAvgActual = avg(onPeakActuals);

  const peakForecast = findExtremeForecast(forecastRows, 'max');
  const peakActual = findExtremeAligned(aligned, 'Actual', 'max');
  const lowForecast = findExtremeForecast(forecastRows, 'min');
  const lowActual = findExtremeAligned(aligned, 'Actual', 'min');

  let errorSum = 0;
  let errorCount = 0;
  for (const r of aligned) {
    errorSum += r.Error;
    errorCount++;
  }
  const avgForecastError = errorCount > 0 ? errorSum / errorCount : null;

  const peakForecastError = findExtremeError(aligned, 'absMax');
  const largestUnderForecast = findExtremeError(aligned, 'minNeg');
  const largestOverForecast = findExtremeError(aligned, 'maxPos');

  return {
    onPeakAvgForecast,
    onPeakAvgActual,
    peakForecast,
    peakActual,
    lowForecast,
    lowActual,
    avgForecastError,
    peakForecastError,
    largestUnderForecast,
    largestOverForecast,
  };
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function findExtremeForecast(
  rows: DemandRow[],
  mode: 'max' | 'min'
): { value: number; he: number; date: string } | null {
  let best: DemandRow | null = null;
  let bestVal = mode === 'max' ? -Infinity : Infinity;

  for (const r of rows) {
    const v = Number(r.NYISO || 0);
    if (!v || isNaN(v)) continue;
    if (mode === 'max' ? v > bestVal : v < bestVal) {
      bestVal = v;
      best = r;
    }
  }

  if (!best) return null;
  return { value: bestVal, he: Number(best.HE), date: best.Date };
}

function findExtremeAligned(
  rows: AlignedRow[],
  field: 'Forecast' | 'Actual',
  mode: 'max' | 'min'
): { value: number; he: number; date: string } | null {
  let best: AlignedRow | null = null;
  let bestVal = mode === 'max' ? -Infinity : Infinity;

  for (const r of rows) {
    const v = r[field];
    if (isNaN(v)) continue;
    if (mode === 'max' ? v > bestVal : v < bestVal) {
      bestVal = v;
      best = r;
    }
  }

  if (!best) return null;
  return { value: bestVal, he: best.HE, date: best.Date };
}

function findExtremeError(
  rows: AlignedRow[],
  mode: 'absMax' | 'maxPos' | 'minNeg'
): { value: number; he: number; date: string } | null {
  let best: AlignedRow | null = null;
  let bestVal = mode === 'absMax' ? 0 : mode === 'maxPos' ? 0 : 0;

  for (const r of rows) {
    const err = r.Error;
    if (isNaN(err)) continue;

    if (mode === 'absMax') {
      if (Math.abs(err) > Math.abs(bestVal)) {
        bestVal = err;
        best = r;
      }
    } else if (mode === 'maxPos') {
      if (err > bestVal) {
        bestVal = err;
        best = r;
      }
    } else {
      if (err < bestVal) {
        bestVal = err;
        best = r;
      }
    }
  }

  if (!best) return null;
  return { value: bestVal, he: best.HE, date: best.Date };
}
