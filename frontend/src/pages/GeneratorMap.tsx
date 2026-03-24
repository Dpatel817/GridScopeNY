/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface GeneratorPoint {
  PTID: number;
  GenName: string;
  Zone: string;
  Subzone: string;
  Latitude: number;
  Longitude: number;
  LMP: number | null;
  MLC: number | null;
  MCC: number | null;
}

interface MapData {
  market: string;
  date: string;
  he: number | null;
  he_averaged: boolean;
  points: GeneratorPoint[];
  audit: {
    total_generators_in_metadata: number;
    total_generators_in_lmp: number;
    mapped_with_coords: number;
    unmapped_no_coords: number;
    generators_missing_coords: number;
  };
  available_dates: string[];
  available_hes: number[];
  zones: string[];
  debug?: {
    lmp_rows_loaded: number;
    lmp_rows_after_date_filter: number;
    lmp_rows_after_he_filter: number;
    lmp_ptids_after_agg: number;
    merged_rows: number;
  };
}

const METRICS = ['LMP', 'MLC', 'MCC'] as const;
type Metric = typeof METRICS[number];

const NY_CENTER: [number, number] = [42.85, -75.5];
const NY_ZOOM = 7;

function getColor(value: number | null, min: number, max: number): string {
  if (value === null || value === undefined) return '#6b7280';
  const range = max - min || 1;
  const t = Math.max(0, Math.min(1, (value - min) / range));
  if (t < 0.25) {
    const s = t / 0.25;
    return `rgb(${Math.round(59 + s * (16 - 59))}, ${Math.round(130 + s * (185 - 130))}, ${Math.round(246 + s * (129 - 246))})`;
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return `rgb(${Math.round(16 + s * (234 - 16))}, ${Math.round(185 + s * (179 - 185))}, ${Math.round(129 + s * (8 - 129))})`;
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return `rgb(${Math.round(234 + s * (245 - 234))}, ${Math.round(179 + s * (158 - 179))}, ${Math.round(8 + s * (11 - 8))})`;
  }
  const s = (t - 0.75) / 0.25;
  return `rgb(${Math.round(245 + s * (239 - 245))}, ${Math.round(158 + s * (68 - 158))}, ${Math.round(11 + s * (68 - 11))})`;
}

function MapBounds({ points }: { points: GeneratorPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const lats = points.map(p => p.Latitude).filter(Boolean);
      const lngs = points.map(p => p.Longitude).filter(Boolean);
      if (lats.length > 0 && lngs.length > 0) {
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lats) - 0.2, Math.min(...lngs) - 0.2],
          [Math.max(...lats) + 0.2, Math.max(...lngs) + 0.2],
        ];
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }, [points, map]);
  return null;
}

export default function GeneratorMap({ embedded = false }: { embedded?: boolean }) {
  const [market, setMarket] = useState<'DA' | 'RT'>('DA');
  const [metric, setMetric] = useState<Metric>('LMP');
  const [date, setDate] = useState('');
  const [he, setHe] = useState<number | ''>('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevMarketRef = useRef(market);

  const fetchMapData = useCallback(async (fetchDate?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ market });
      const dateToUse = fetchDate ?? date;
      if (dateToUse) params.set('date', dateToUse);
      if (he !== '') params.set('he', String(he));
      const res = await fetch(`/api/generator-map?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MapData = await res.json();
      setMapData(data);
      if (data.date) setDate(data.date);

      console.log(`[GeneratorMap] ${market} | date=${data.date} | he=${he === '' ? 'avg' : he} | points=${data.points.length} | audit=`, data.audit, data.debug ? `| debug=${JSON.stringify(data.debug)}` : '');
    } catch (e: any) {
      setError(e.message || 'Failed to fetch generator map data');
      setMapData(null);
    } finally {
      setLoading(false);
    }
  }, [market, date, he]);

  useEffect(() => {
    if (prevMarketRef.current !== market) {
      prevMarketRef.current = market;
      setDate('');
      setHe('');
      fetchMapData('');
    } else {
      fetchMapData();
    }
  }, [market]);

  useEffect(() => {
    if (date || he !== '') {
      fetchMapData();
    }
  }, [date, he]);

  const filteredPoints = useMemo(() => {
    if (!mapData) return [];
    let pts = mapData.points;
    if (zoneFilter) pts = pts.filter(p => p.Zone === zoneFilter);
    return pts;
  }, [mapData, zoneFilter]);

  const { min, max, avg } = useMemo(() => {
    const vals = filteredPoints.map(p => p[metric]).filter((v): v is number => v !== null && v !== undefined);
    if (!vals.length) return { min: 0, max: 100, avg: 0 };
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  }, [filteredPoints, metric]);

  const metricLabel = metric === 'LMP' ? 'LMP ($/MWh)' : metric === 'MLC' ? 'Marginal Loss ($/MWh)' : 'Marginal Congestion ($/MWh)';

  function handleMarketChange(m: 'DA' | 'RT') {
    if (m !== market) setMarket(m);
  }

  const wrapperClass = embedded ? '' : 'page';

  return (
    <div className={wrapperClass || undefined} style={embedded ? { marginTop: 8 } : undefined}>
      {!embedded && (
        <div className="page-header">
          <h1>Generator Price Map</h1>
          <p className="page-subtitle">
            Geographic visualization of generator-level {market === 'DA' ? 'Day-Ahead' : 'Real-Time'} prices across New York
          </p>
        </div>
      )}
      {embedded && (
        <div className="chart-card-header" style={{ padding: '16px 0 8px' }}>
          <div>
            <div className="chart-card-title" style={{ fontSize: 16, fontWeight: 700 }}>
              Generator Price Map
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>
              Geographic visualization of generator-level {market === 'DA' ? 'Day-Ahead' : 'Real-Time'} prices across New York
            </p>
          </div>
        </div>
      )}

      <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="pill-group">
          <span className="pill-label">MARKET:</span>
          {(['DA', 'RT'] as const).map(m => (
            <button key={m} className={`pill${market === m ? ' active' : ''}`} onClick={() => handleMarketChange(m)}>
              {m === 'DA' ? 'Day Ahead' : 'Real Time'}
            </button>
          ))}
        </div>
        <div className="pill-group">
          <span className="pill-label">METRIC:</span>
          {METRICS.map(m => (
            <button key={m} className={`pill${metric === m ? ' active' : ''}`} onClick={() => setMetric(m)}>
              {m}
            </button>
          ))}
        </div>
        {mapData && mapData.available_dates.length > 0 && (
          <select
            className="gen-map-select"
            value={date}
            onChange={e => setDate(e.target.value)}
          >
            {mapData.available_dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        {mapData && mapData.available_hes.length > 0 && (
          <select
            className="gen-map-select"
            value={he}
            onChange={e => setHe(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">All Hours (Avg)</option>
            {mapData.available_hes.map(h => (
              <option key={h} value={h}>HE {h}</option>
            ))}
          </select>
        )}
        {mapData && mapData.zones.length > 0 && (
          <select
            className="gen-map-select"
            value={zoneFilter}
            onChange={e => setZoneFilter(e.target.value)}
          >
            <option value="">All Zones</option>
            {mapData.zones.map(z => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        )}
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
        <div className="kpi-card accent">
          <div className="kpi-label">Mapped Generators</div>
          <div className="kpi-value">{filteredPoints.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg {metric}</div>
          <div className="kpi-value">
            ${avg.toFixed(2)}<span className="kpi-unit">/MWh</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Min {metric}</div>
          <div className="kpi-value">
            ${min.toFixed(2)}<span className="kpi-unit">/MWh</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Max {metric}</div>
          <div className="kpi-value">
            <span style={{ color: max > 100 ? 'var(--danger)' : 'var(--text)' }}>
              ${max.toFixed(2)}<span className="kpi-unit">/MWh</span>
            </span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Unmapped</div>
          <div className="kpi-value" style={{ color: 'var(--text-muted)' }}>
            {mapData ? mapData.audit.unmapped_no_coords : '—'}
          </div>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading generator map...</div>}
      {error && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Error</div>
          <div className="insight-body">{error}</div>
        </div>
      )}

      {!loading && mapData && filteredPoints.length === 0 && !error && (
        <div className="insight-card" style={{ marginBottom: 16 }}>
          <div className="insight-title">No Generators Found</div>
          <div className="insight-body">
            No {market} generator data for {date || 'the selected date'}
            {he !== '' ? ` HE ${he}` : ''}.
            {mapData.available_dates.length > 0 && (
              <> Available dates: {mapData.available_dates[0]} to {mapData.available_dates[mapData.available_dates.length - 1]}.</>
            )}
          </div>
        </div>
      )}

      {!loading && filteredPoints.length > 0 && (
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="chart-card-header" style={{ padding: '12px 20px' }}>
            <div className="chart-card-title">{metricLabel} — {market === 'DA' ? 'Day-Ahead' : 'Real-Time'}</div>
            <span className="badge badge-primary">
              {date}{mapData?.he_averaged ? ' · Daily Avg' : he !== '' ? ` · HE ${he}` : ''} · {filteredPoints.length} generators
            </span>
          </div>
          <div style={{ height: 520 }}>
            <MapContainer
              center={NY_CENTER}
              zoom={NY_ZOOM}
              style={{ height: '100%', width: '100%', background: '#f8fafc' }}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://carto.com">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              <MapBounds points={filteredPoints} />
              {filteredPoints.map((p, i) => {
                const val = p[metric];
                const color = getColor(val, min, max);
                return (
                  <CircleMarker
                    key={`${p.PTID}-${i}`}
                    center={[p.Latitude, p.Longitude]}
                    radius={6}
                    pathOptions={{
                      fillColor: color,
                      color: '#334155',
                      weight: 1,
                      fillOpacity: 0.85,
                    }}
                  >
                    <Tooltip>
                      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, lineHeight: 1.6, minWidth: 180 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{p.GenName}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>PTID {p.PTID} · {p.Zone}</div>
                        <div style={{ borderTop: '1px solid #e2e8f0', margin: '4px 0', paddingTop: 4 }}>
                          <div><strong>LMP:</strong> ${p.LMP !== null ? p.LMP.toFixed(2) : '—'}/MWh</div>
                          <div><strong>MLC:</strong> ${p.MLC !== null ? p.MLC.toFixed(2) : '—'}/MWh</div>
                          <div><strong>MCC:</strong> ${p.MCC !== null ? p.MCC.toFixed(2) : '—'}/MWh</div>
                        </div>
                        <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                          {market === 'DA' ? 'Day-Ahead' : 'Real-Time'} · {date}{he !== '' ? ` HE${he}` : ' (Avg)'}
                        </div>
                        {p.Subzone && <div style={{ color: '#94a3b8', fontSize: 10 }}>{p.Subzone}</div>}
                      </div>
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
          <div className="gen-map-legend">
            <span className="gen-map-legend-label">${min.toFixed(0)}</span>
            <div className="gen-map-legend-bar" />
            <span className="gen-map-legend-label">${max.toFixed(0)}</span>
            <span className="gen-map-legend-label" style={{ marginLeft: 8, color: 'var(--text-muted)' }}>$/MWh</span>
          </div>
        </div>
      )}

      {mapData && (
        <div className="insight-card" style={{ marginTop: 16 }}>
          <div className="insight-title">Data Coverage Report</div>
          <div className="insight-body">
            <strong>{mapData.audit.total_generators_in_metadata}</strong> generators in metadata,{' '}
            <strong>{mapData.audit.total_generators_in_lmp}</strong> in {market} LMP data ({date || 'latest'}).{' '}
            <strong>{mapData.audit.mapped_with_coords}</strong> successfully mapped with coordinates
            ({mapData.audit.total_generators_in_lmp > 0
              ? ((mapData.audit.mapped_with_coords / mapData.audit.total_generators_in_lmp) * 100).toFixed(1)
              : 0}% coverage).{' '}
            <strong>{mapData.audit.generators_missing_coords}</strong> generators in metadata have no coordinates.{' '}
            {mapData.audit.unmapped_no_coords > 0 && (
              <><strong>{mapData.audit.unmapped_no_coords}</strong> LMP generators could not be placed on the map.</>
            )}
            {mapData.available_dates.length > 0 && (
              <> {market} date range: {mapData.available_dates[0]} to {mapData.available_dates[mapData.available_dates.length - 1]}.</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
