type DateInput = unknown;

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

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

function formatFull(d: Date): string {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${pad2(d.getFullYear() % 100)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDateOnly(d: Date): string {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${pad2(d.getFullYear() % 100)}`;
}

function formatMonthYear(d: Date): string {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getFullYear() % 100)}`;
}

export function getDateRangeSpanDays(data: Record<string, unknown>[], xKey: string): number {
  if (data.length < 2) return 0;
  const first = String(data[0]?.[xKey] ?? '');
  const last = String(data[data.length - 1]?.[xKey] ?? '');
  const d1 = parseToDate(first);
  const d2 = parseToDate(last);
  if (!d1 || !d2) return 0;
  return Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
}

export function makeTickFormatter(data: Record<string, unknown>[], xKey: string): (v: DateInput) => string {
  const spanDays = getDateRangeSpanDays(data, xKey);

  return (v: DateInput): string => {
    if (v === null || v === undefined || v === '') return '';
    const s = String(v);
    if (s === 'undefined' || s === 'null' || s === 'NaN') return '';

    const d = parseToDate(s);
    if (!d) return s.length > 16 ? s.slice(0, 16) : s;

    if (spanDays <= 3) {
      return formatFull(d);
    }
    if (spanDays <= 180) {
      return formatDateOnly(d);
    }
    return formatMonthYear(d);
  };
}

export function tooltipLabelFormatter(v: DateInput): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (s === 'undefined' || s === 'null' || s === 'NaN') return '';

  const d = parseToDate(s);
  if (!d) return s.length > 16 ? s.slice(0, 16) : s;

  return formatFull(d);
}
