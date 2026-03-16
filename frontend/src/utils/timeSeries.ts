export function buildTimestamp(date: string, he: number | string, isDuplicate?: boolean): number {
  const heNum = Number(he);
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) {
    const d = new Date(date);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  const year = +parts[1];
  const month = parseInt(parts[2]) - 1;
  const day = +parts[3];

  let ts: number;
  if (heNum >= 24) {
    ts = new Date(year, month, day + 1, 0).getTime();
  } else {
    ts = new Date(year, month, day, heNum).getTime();
  }
  if (isDuplicate) ts += 1;
  return ts;
}

export function sortTimeSeries<T extends { _ts?: number }>(data: T[]): T[] {
  return [...data].sort((a, b) => (a._ts ?? 0) - (b._ts ?? 0));
}

export function formatDisplayLabel(date: string, he: number | string, isDup?: boolean): string {
  const heNum = Number(he);
  return `${date} HE${heNum}${isDup ? 'b' : ''}`;
}
