type DateInput = unknown;

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseToDate(s: string): Date | null {
  if (s.includes('T')) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const heMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+HE(\d+)$/);
  if (heMatch) {
    const hr = Math.max(0, parseInt(heMatch[4]) - 1);
    return new Date(+heMatch[1], parseInt(heMatch[2]) - 1, +heMatch[3], hr);
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

    const d = parseToDate(s);
    if (!d) return s.length > 16 ? s.slice(0, 16) : s;

    return fmt(d);
  };
}
