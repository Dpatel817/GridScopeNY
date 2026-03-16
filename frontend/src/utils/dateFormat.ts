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

function fmtHour(d: Date): string {
  const h = d.getHours();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12} ${suffix}`;
}

function fmtMMMd(d: Date): string {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

function fmtMMM(d: Date): string {
  return MONTH_ABBR[d.getMonth()];
}

function fmtYear(d: Date): string {
  return String(d.getFullYear());
}

export type DateTier = 'hourly' | 'daily' | 'monthly' | 'yearly';

export function getDateRangeSpanDays(data: Record<string, unknown>[], xKey: string): number {
  if (data.length < 2) return 0;
  const first = String(data[0]?.[xKey] ?? '');
  const last = String(data[data.length - 1]?.[xKey] ?? '');
  const d1 = parseToDate(first);
  const d2 = parseToDate(last);
  if (!d1 || !d2) return 0;
  return Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
}

function getTier(spanDays: number): DateTier {
  if (spanDays <= 2) return 'hourly';
  if (spanDays <= 45) return 'daily';
  if (spanDays <= 548) return 'monthly';
  return 'yearly';
}

const TICK_FN: Record<DateTier, (d: Date) => string> = {
  hourly: fmtHour,
  daily: fmtMMMd,
  monthly: fmtMMM,
  yearly: fmtYear,
};

export function makeTickFormatter(data: Record<string, unknown>[], xKey: string): (v: DateInput) => string {
  const spanDays = getDateRangeSpanDays(data, xKey);
  const tier = getTier(spanDays);
  const fmt = TICK_FN[tier];

  return (v: DateInput): string => {
    if (v === null || v === undefined || v === '') return '';
    const s = String(v);
    if (s === 'undefined' || s === 'null' || s === 'NaN') return '';

    const d = parseToDate(s);
    if (!d) return s.length > 16 ? s.slice(0, 16) : s;

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
    case 'daily':  maxTicks = 15; break;
    case 'monthly': maxTicks = 12; break;
    case 'yearly': maxTicks = 10; break;
  }

  if (len <= maxTicks) return 'preserveStartEnd';
  return Math.max(1, Math.floor(len / maxTicks));
}

function fmtHourTooltip(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const minStr = m < 10 ? '0' + m : String(m);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${h12}:${minStr} ${suffix}`;
}

function fmtDayTooltip(d: Date): string {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtMonthTooltip(d: Date): string {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
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

export function tooltipLabelFormatter(spanDaysOrData: number | Record<string, unknown>[], xKey?: string): (v: DateInput) => string {
  let spanDays: number;
  if (typeof spanDaysOrData === 'number') {
    spanDays = spanDaysOrData;
  } else {
    spanDays = getDateRangeSpanDays(spanDaysOrData, xKey ?? '');
  }
  const tier = getTier(spanDays);

  const tooltipFn: Record<DateTier, (d: Date) => string> = {
    hourly: fmtHourTooltip,
    daily: fmtDayTooltip,
    monthly: fmtMonthTooltip,
    yearly: fmtMonthTooltip,
  };

  const fmt = tooltipFn[tier];

  return (v: DateInput): string => {
    if (v === null || v === undefined || v === '') return '';
    const s = String(v);
    if (s === 'undefined' || s === 'null' || s === 'NaN') return '';

    const heMatch = s.match(/^(\d{4}-\d{2}-\d{2})\s+HE(\d+)(b?)$/);
    if (heMatch && tier === 'hourly') {
      const dateStr = heMatch[1];
      const he = heMatch[2];
      const isDup = heMatch[3] === 'b';
      const dstHours = getExpectedHourCount(dateStr);
      let label = `HE ${he}`;
      if (isDup) label += ' (DST)';
      else if (dstHours !== 24) label += dstHours === 23 ? ' (Spring Fwd)' : ' (Fall Back)';
      const d = parseToDate(s);
      if (d) label = `${fmtMMMd(d)}, ${label}`;
      return label;
    }

    const d = parseToDate(s);
    if (!d) return s.length > 16 ? s.slice(0, 16) : s;

    return fmt(d);
  };
}
