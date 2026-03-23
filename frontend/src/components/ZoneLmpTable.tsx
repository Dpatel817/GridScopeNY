import { useMemo } from 'react';
import { NYISO_ZONES } from '../data/zones';

interface PriceRow {
  Date: string;
  HE: number;
  Zone: string;
  LMP: number;
  MLC: number;
  MCC: number;
}

interface LoadRow {
  Date: string;
  HE?: number;
  [zone: string]: string | number | undefined;
}

// Zone name -> load column mapping (isolf uses these column names)
const ZONE_LOAD_COL: Record<string, string> = {
  'WEST': 'WEST',
  'GENESE': 'GENESE',
  'CENTRL': 'CENTRL',
  'NORTH': 'NORTH',
  'MHK VL': 'MHK VL',
  'CAPITL': 'CAPITL',
  'HUD VL': 'HUD VL',
  'MILLWD': 'MILLWD',
  'DUNWOD': 'DUNWOD',
  'N.Y.C.': 'N.Y.C.',
  'LONGIL': 'LONGIL',
};

interface ZoneRow {
  zone: string;
  code: string;
  daLmp: number | null;
  daMlc: number | null;
  daMcc: number | null;
  rtLmp: number | null;
  rtMlc: number | null;
  rtMcc: number | null;
  dartLmp: number | null;
  dartMlc: number | null;
  dartMcc: number | null;
  daLoad: number | null;
  rtLoad: number | null;
}

function avgByZone(rows: PriceRow[], field: 'LMP' | 'MLC' | 'MCC'): Record<string, number> {
  const acc: Record<string, { sum: number; count: number }> = {};
  for (const r of rows) {
    const z = String(r.Zone);
    if (!(z in NYISO_ZONES)) continue;
    const v = Number(r[field]);
    if (isNaN(v)) continue;
    if (!acc[z]) acc[z] = { sum: 0, count: 0 };
    acc[z].sum += v;
    acc[z].count++;
  }
  return Object.fromEntries(
    Object.entries(acc).map(([z, { sum, count }]) => [z, sum / count])
  );
}

function latestDayRows(rows: PriceRow[]): PriceRow[] {
  if (!rows.length) return [];
  const dates = [...new Set(rows.map(r => r.Date))].sort();
  const latest = dates[dates.length - 1];
  return rows.filter(r => r.Date === latest);
}

function latestDayLoadRows(rows: LoadRow[]): LoadRow[] {
  if (!rows.length) return [];
  const dates = [...new Set(rows.map(r => r.Date).filter(Boolean))].sort();
  const latest = dates[dates.length - 1];
  return rows.filter(r => r.Date === latest);
}

function avgLoadByZone(rows: LoadRow[]): Record<string, number> {
  const acc: Record<string, { sum: number; count: number }> = {};
  for (const r of rows) {
    for (const [zone, col] of Object.entries(ZONE_LOAD_COL)) {
      const v = Number(r[col]);
      if (isNaN(v) || v <= 0) continue;
      if (!acc[zone]) acc[zone] = { sum: 0, count: 0 };
      acc[zone].sum += v;
      acc[zone].count++;
    }
  }
  return Object.fromEntries(
    Object.entries(acc).map(([z, { sum, count }]) => [z, sum / count])
  );
}

function fmt(v: number | null, decimals = 2, prefix = ''): string {
  if (v === null || v === undefined) return '—';
  return `${prefix}${v.toFixed(decimals)}`;
}

function fmtLoad(v: number | null): string {
  if (v === null) return '—';
  return Math.round(v).toLocaleString();
}

function dartColor(v: number | null): string {
  if (v === null) return '';
  if (v > 1) return 'var(--success)';
  if (v < -1) return 'var(--danger)';
  return 'var(--text-muted)';
}

interface Props {
  daRows: PriceRow[];
  rtRows: PriceRow[];
  daLoadRows: LoadRow[];
  rtLoadRows: LoadRow[];
}

export default function ZoneLmpTable({ daRows, rtRows, daLoadRows, rtLoadRows }: Props) {
  const rows: ZoneRow[] = useMemo(() => {
    const daLatest = latestDayRows(daRows);
    const rtLatest = latestDayRows(rtRows);
    const daLoadLatest = latestDayLoadRows(daLoadRows);
    const rtLoadLatest = latestDayLoadRows(rtLoadRows);

    const daLmp = avgByZone(daLatest, 'LMP');
    const daMlc = avgByZone(daLatest, 'MLC');
    const daMcc = avgByZone(daLatest, 'MCC');
    const rtLmp = avgByZone(rtLatest, 'LMP');
    const rtMlc = avgByZone(rtLatest, 'MLC');
    const rtMcc = avgByZone(rtLatest, 'MCC');
    const daLoad = avgLoadByZone(daLoadLatest);
    const rtLoad = avgLoadByZone(rtLoadLatest);

    return Object.entries(NYISO_ZONES).map(([zone, code]) => ({
      zone,
      code,
      daLmp: daLmp[zone] ?? null,
      daMlc: daMlc[zone] ?? null,
      daMcc: daMcc[zone] ?? null,
      rtLmp: rtLmp[zone] ?? null,
      rtMlc: rtMlc[zone] ?? null,
      rtMcc: rtMcc[zone] ?? null,
      dartLmp: daLmp[zone] != null && rtLmp[zone] != null ? daLmp[zone] - rtLmp[zone] : null,
      dartMlc: daMlc[zone] != null && rtMlc[zone] != null ? daMlc[zone] - rtMlc[zone] : null,
      dartMcc: daMcc[zone] != null && rtMcc[zone] != null ? daMcc[zone] - rtMcc[zone] : null,
      daLoad: daLoad[zone] ?? null,
      rtLoad: rtLoad[zone] ?? null,
    }));
  }, [daRows, rtRows, daLoadRows, rtLoadRows]);

  const hasData = rows.some(r => r.daLmp !== null || r.rtLmp !== null);

  if (!hasData) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>
        No price data available
      </div>
    );
  }

  return (
    <div className="data-table-wrapper" style={{ overflowX: 'auto' }}>
      <table style={{ fontSize: 12, minWidth: 900 }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ borderRight: '1px solid var(--border)' }}>Zone</th>
            <th colSpan={3} style={{ textAlign: 'center', borderRight: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary))' }}>Day-Ahead ($/MWh)</th>
            <th colSpan={3} style={{ textAlign: 'center', borderRight: '1px solid var(--border)', background: 'color-mix(in srgb, var(--success) 8%, var(--bg-secondary))' }}>Real-Time ($/MWh)</th>
            <th colSpan={3} style={{ textAlign: 'center', borderRight: '1px solid var(--border)', background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-secondary))' }}>DA–RT Spread ($/MWh)</th>
            <th colSpan={2} style={{ textAlign: 'center', background: 'var(--bg-secondary)' }}>Load (MW)</th>
          </tr>
          <tr>
            <th style={{ background: 'color-mix(in srgb, var(--accent-primary) 5%, var(--bg-secondary))' }}>LMP</th>
            <th style={{ background: 'color-mix(in srgb, var(--accent-primary) 5%, var(--bg-secondary))' }}>MLC</th>
            <th style={{ background: 'color-mix(in srgb, var(--accent-primary) 5%, var(--bg-secondary))', borderRight: '1px solid var(--border)' }}>MCC</th>
            <th style={{ background: 'color-mix(in srgb, var(--success) 5%, var(--bg-secondary))' }}>LMP</th>
            <th style={{ background: 'color-mix(in srgb, var(--success) 5%, var(--bg-secondary))' }}>MLC</th>
            <th style={{ background: 'color-mix(in srgb, var(--success) 5%, var(--bg-secondary))', borderRight: '1px solid var(--border)' }}>MCC</th>
            <th style={{ background: 'color-mix(in srgb, var(--warning) 5%, var(--bg-secondary))' }}>LMP</th>
            <th style={{ background: 'color-mix(in srgb, var(--warning) 5%, var(--bg-secondary))' }}>MLC</th>
            <th style={{ background: 'color-mix(in srgb, var(--warning) 5%, var(--bg-secondary))', borderRight: '1px solid var(--border)' }}>MCC</th>
            <th style={{ background: 'var(--bg-secondary)' }}>DA</th>
            <th style={{ background: 'var(--bg-secondary)' }}>RT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.zone}>
              <td style={{ fontWeight: 700, borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 10, marginRight: 4 }}>Z{r.code}</span>
                {r.zone}
              </td>
              <td style={{ background: 'color-mix(in srgb, var(--accent-primary) 4%, var(--bg-card))' }}>{fmt(r.daLmp)}</td>
              <td style={{ background: 'color-mix(in srgb, var(--accent-primary) 4%, var(--bg-card))' }}>{fmt(r.daMlc)}</td>
              <td style={{ background: 'color-mix(in srgb, var(--accent-primary) 4%, var(--bg-card))', borderRight: '1px solid var(--border)' }}>{fmt(r.daMcc)}</td>
              <td style={{ background: 'color-mix(in srgb, var(--success) 4%, var(--bg-card))' }}>{fmt(r.rtLmp)}</td>
              <td style={{ background: 'color-mix(in srgb, var(--success) 4%, var(--bg-card))' }}>{fmt(r.rtMlc)}</td>
              <td style={{ background: 'color-mix(in srgb, var(--success) 4%, var(--bg-card))', borderRight: '1px solid var(--border)' }}>{fmt(r.rtMcc)}</td>
              <td style={{ color: dartColor(r.dartLmp), fontWeight: 600, background: 'color-mix(in srgb, var(--warning) 4%, var(--bg-card))' }}>{fmt(r.dartLmp)}</td>
              <td style={{ color: dartColor(r.dartMlc), fontWeight: 600, background: 'color-mix(in srgb, var(--warning) 4%, var(--bg-card))' }}>{fmt(r.dartMlc)}</td>
              <td style={{ color: dartColor(r.dartMcc), fontWeight: 600, background: 'color-mix(in srgb, var(--warning) 4%, var(--bg-card))', borderRight: '1px solid var(--border)' }}>{fmt(r.dartMcc)}</td>
              <td>{fmtLoad(r.daLoad)}</td>
              <td>{fmtLoad(r.rtLoad)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
