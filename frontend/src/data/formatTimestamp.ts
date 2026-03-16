export function formatTimestamp(date: string, he: number): string {
  const d = date.replace(/-/g, '/');
  const parts = d.split('/');
  let year: number, month: number, day: number;
  if (parts[0].length === 4) {
    year = Number(parts[0]);
    month = Number(parts[1]);
    day = Number(parts[2]);
  } else {
    month = Number(parts[0]);
    day = Number(parts[1]);
    const rawYear = Number(parts[2]);
    year = rawYear < 100 ? 2000 + rawYear : rawYear;
  }

  if (he >= 24) {
    const dt = new Date(year, month - 1, day + 1);
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const yy = String(dt.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy} 00:00`;
  }

  const safeHe = Math.max(0, Math.floor(he));
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const yy = String(year).slice(-2);
  const hh = String(safeHe).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${hh}:00`;
}
