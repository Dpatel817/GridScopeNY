type DateInput = unknown;

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseToDate(s: string): Date | null {
  if (s.includes('T')) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const heMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+HE(\d+)(b?)$/);
  if (heMatch) {
    const he = parseInt(heMatch[4]);
    if (he === 24) {
      const d = new Date(+heMatch[1], parseInt(heMatch[2]) - 1, +heMatch[3]);
      d.setDate(d.getDate() + 1);
      return d;
    }
    return new Date(+heMatch[1], parseInt(heMatch[2]) - 1, +heMatch[3], he);
  }

  const dateMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    return new Date(+dateMatch[1], parseInt(dateMatch[2]) - 1, +dateMatch[3]);
  }

  return null;
}

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) return new Date(v);
  const s = String(v);
  if (s === 'undefined' || s === 'null' || s === 'NaN') return null;
  return parseToDate(s);
}

function fmtHour(d: Date): string {
  const h = d.getHours();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12} ${suffix}`;
}

function fmtMMMYearTick(d: Date): string {
  const yr = String(d.getFullYear()).slice(2);
  return `${MONTH_ABBR[d.getMonth()]} '${yr}`;
}

function fmtYear(d: Date): string {
  return String(d.getFullYear());
}

export type DateTier = 'hourly' | 'daily' | 'monthly' | 'yearly';

export function getDateRangeSpanDays(data: Record<string, unknown>[], xKey: string): number {
  if (data.length < 2) return 0;

  const firstVal = data[0]?.[xKey];
  const lastVal = data[data.length - 1]?.[xKey];

  if (typeof firstVal === 'number' && typeof lastVal === 'number') {
    return Math.abs(lastVal - firstVal) / (1000 * 60 * 60 * 24);
  }

  const d1 = parseToDate(String(firstVal ?? ''));
  const d2 = parseToDate(String(lastVal ?? ''));
  if (!d1 || !d2) return 0;
  return Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
}

function getTier(spanDays: number): DateTier {
  if (spanDays <= 2) return 'hourly';
  if (spanDays <= 45) return 'daily';
  if (spanDays <= 548) return 'monthly';
  return 'yearly';
}

function fmtMMMdYear(d: Date): string {
  const yr = String(d.getFullYear()).slice(2);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()} '${yr}`;
}

const TICK_FN: Record<DateTier, (d: Date) => string> = {
  hourly: fmtHour,
  daily: fmtMMMdYear,
  monthly: fmtMMMYearTick,
  yearly: fmtYear,
};

export function makeTickFormatter(data: Record<string, unknown>[], xKey: string): (v: DateInput) => string {
  const spanDays = getDateRangeSpanDays(data, xKey);
  const tier = getTier(spanDays);
  const fmt = TICK_FN[tier];

  return (v: DateInput): string => {
    const d = toDate(v);
    if (!d) {
      if (v === null || v === undefined || v === '') return '';
      const s = String(v);
      return s.length > 16 ? s.slice(0, 16) : s;
    }
    return fmt(d);
  };
}

export function getTickInterval(data: Record<string, unknown>[], xKey: string): number | 'preserveStartEnd' {
  const len = data.length;
  if (len <= 12) return 'preserveStartEnd';

  const spanDays = getDateRangeSpanDays(data, xKey);
  const tier = getTier(spanDays);

  let maxTicks: number;
  switch (tier) {
    case 'hourly': maxTicks = 12; break;
    case 'daily':  maxTicks = 20; break;
    case 'monthly': maxTicks = 18; break;
    case 'yearly': maxTicks = 12; break;
  }

  if (len <= maxTicks) return 'preserveStartEnd';
  return Math.max(1, Math.floor(len / maxTicks));
}

function fmtTimeStr(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const minStr = m < 10 ? '0' + m : String(m);
  return `${h12}:${minStr} ${suffix}`;
}

function fmtFullTooltip(d: Date, hasTime: boolean): string {
  const datePart = `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (hasTime) {
    return `${datePart} ${fmtTimeStr(d)}`;
  }
  return datePart;
}

export function getExpectedHourCount(dateStr: string): 23 | 24 | 25 {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 24;

  const tz = 'America/New_York';
  try {
    const startOfDay = new Date(`${dateStr}T00:00:00`);
    const nextDate = new Date(startOfDay);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

    const startOffset = getTimezoneOffsetMinutes(dateStr, tz);
    const endOffset = getTimezoneOffsetMinutes(nextDateStr, tz);
    const diffMinutes = endOffset - startOffset;

    if (diffMinutes < 0) return 23;
    if (diffMinutes > 0) return 25;
    return 24;
  } catch {
    return 24;
  }
}

function getTimezoneOffsetMinutes(dateStr: string, tz: string): number {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  const utcStr = dt.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = dt.toLocaleString('en-US', { timeZone: tz });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  return (utcDate.getTime() - tzDate.getTime()) / 60000;
}

export function isDSTTransitionDay(dateStr: string): boolean {
  return getExpectedHourCount(dateStr) !== 24;
}

export function makeUniqueHourlyKey(date: string, he: number | string, seen: Set<string>, seriesName?: string): { key: string; label: string } {
  const heNum = Number(he);
  const baseKey = `${date}_${heNum}`;
  const trackKey = seriesName ? `${baseKey}_${seriesName}` : baseKey;
  const isDup = seen.has(trackKey);
  seen.add(trackKey);
  if (isDup) {
    return { key: `${baseKey}b`, label: `${date} HE${heNum}b` };
  }
  return { key: baseKey, label: `${date} HE${heNum}` };
}

function fmtHourlyTooltipFromTs(d: Date, displayLabel?: string): string {
  if (displayLabel) {
    const heMatch = displayLabel.match(/^(\d{4}-\d{2}-\d{2})\s+HE(\d+)(b?)$/);
    if (heMatch) {
      const dateStr = heMatch[1];
      const he = heMatch[2];
      const isDup = heMatch[3] === 'b';
      const dstHours = getExpectedHourCount(dateStr);
      let label = `HE ${he}`;
      if (isDup) label += ' (DST)';
      else if (dstHours !== 24) label += dstHours === 23 ? ' (Spring Fwd)' : ' (Fall Back)';
      label = `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} — ${label}`;
      return label;
    }
  }
  return fmtFullTooltip(d, true);
}

export function tooltipLabelFormatter(spanDaysOrData: number | Record<string, unknown>[], xKey?: string): (v: DateInput) => string {
  let spanDays: number;
  let dataRef: Record<string, unknown>[] | null = null;
  if (typeof spanDaysOrData === 'number') {
    spanDays = spanDaysOrData;
  } else {
    dataRef = spanDaysOrData;
    spanDays = getDateRangeSpanDays(spanDaysOrData, xKey ?? '');
  }
  const tier = getTier(spanDays);

  const tsLookup: Map<number, string> | null = (() => {
    if (xKey !== '_ts' || !dataRef) return null;
    const map = new Map<number, string>();
    for (const row of dataRef) {
      const ts = row._ts;
      const dateLabel = row.Date;
      if (typeof ts === 'number' && typeof dateLabel === 'string') {
        map.set(ts, dateLabel);
      }
    }
    return map.size > 0 ? map : null;
  })();

  return (v: DateInput): string => {
    if (v === null || v === undefined || v === '') return '';

    if (typeof v === 'number' && isFinite(v)) {
      const d = new Date(v);
      if (tier === 'hourly' && tsLookup) {
        const displayLabel = tsLookup.get(v);
        return fmtHourlyTooltipFromTs(d, displayLabel);
      }
      return fmtFullTooltip(d, true);
    }

    const s = String(v);
    if (s === 'undefined' || s === 'null' || s === 'NaN') return '';

    const heMatch = s.match(/^(\d{4}-\d{2}-\d{2})\s+HE(\d+)(b?)$/);
    if (heMatch) {
      const dateStr = heMatch[1];
      const he = heMatch[2];
      const isDup = heMatch[3] === 'b';
      const dstHours = getExpectedHourCount(dateStr);
      let label = `HE ${he}`;
      if (isDup) label += ' (DST)';
      else if (dstHours !== 24) label += dstHours === 23 ? ' (Spring Fwd)' : ' (Fall Back)';
      const d = parseToDate(s);
      if (d) label = `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} — ${label}`;
      return label;
    }

    const d = parseToDate(s);
    if (!d) return s.length > 16 ? s.slice(0, 16) : s;

    const hasTime = s.includes('T');
    return fmtFullTooltip(d, hasTime);
  };
}
