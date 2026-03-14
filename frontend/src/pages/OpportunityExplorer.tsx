import { useState, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import LineChart from '../components/LineChart';
import EmptyState from '../components/EmptyState';

export default function OpportunityExplorer() {
  const [duration, setDuration] = useState<'1h' | '2h' | '4h'>('2h');
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const { data: daData, loading: daLoading } = useDataset('da_lbmp_zone', 'hourly');
  const { data: rtData, loading: rtLoading } = useDataset('rt_lbmp_zone', 'hourly');

  const loading = daLoading || rtLoading;
  const durationHours = duration === '1h' ? 1 : duration === '2h' ? 2 : 4;

  const { opportunities, hourlyByZone } = useMemo(() => {
    if (!daData?.data?.length || !rtData?.data?.length) return { opportunities: [], hourlyByZone: {} as Record<string, any[]> };

    const daByKey: Record<string, number> = {};
    for (const r of daData.data) {
      daByKey[`${r.Date}_${r.HE}_${r.Zone}`] = Number(r.LMP) || 0;
    }

    const zoneData: Record<string, { spreads: number[]; hourly: { Date: string; HE: number; spread: number; daLmp: number; rtLmp: number }[]; zone: string }> = {};
    for (const r of rtData.data) {
      const key = `${r.Date}_${r.HE}_${r.Zone}`;
      const rtLmp = Number(r.LMP) || 0;
      const daLmp = daByKey[key] || 0;
      const spread = Math.abs(rtLmp - daLmp);
      const zone = String(r.Zone);
      if (!zoneData[zone]) zoneData[zone] = { spreads: [], hourly: [], zone };
      zoneData[zone].spreads.push(spread);
      zoneData[zone].hourly.push({ Date: String(r.Date), HE: Number(r.HE), spread, daLmp, rtLmp });
    }

    const hourlyByZone: Record<string, any[]> = {};
    const results = Object.values(zoneData).map(({ zone, spreads, hourly }) => {
      hourlyByZone[zone] = hourly;
      spreads.sort((a, b) => b - a);
      const topN = spreads.slice(0, durationHours * 24);
      const avgSpread = topN.reduce((s, v) => s + v, 0) / (topN.length || 1);
      const maxSpread = spreads[0] || 0;
      const revenue = avgSpread * durationHours;
      const volatility = spreads.length > 1
        ? Math.sqrt(spreads.reduce((s, v) => s + (v - avgSpread) ** 2, 0) / spreads.length)
        : 0;
      return {
        zone,
        avgSpread,
        maxSpread,
        revenue,
        events: topN.length,
        volatility,
      };
    });

    results.sort((a, b) => b.revenue - a.revenue);
    return { opportunities: results, hourlyByZone };
  }, [daData, rtData, durationHours]);

  const bestZone = opportunities[0];
  const active = selectedZone || bestZone?.zone || '';
  const activeOpp = opportunities.find(o => o.zone === active);

  const chartData = useMemo(() => {
    const hourly = hourlyByZone[active];
    if (!hourly?.length) return [];
    const byTime: Record<string, any> = {};
    for (const h of hourly) {
      const key = `${h.Date}_${h.HE}`;
      if (!byTime[key]) byTime[key] = { Date: h.Date, HE: h.HE };
      byTime[key]['DA LMP'] = h.daLmp;
      byTime[key]['RT LMP'] = h.rtLmp;
      byTime[key]['Spread'] = h.spread;
    }
    return Object.values(byTime).sort((a: any, b: any) => a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : a.HE - b.HE);
  }, [hourlyByZone, active]);

  const opportunityBarData = useMemo(() => {
    return opportunities.slice(0, 15).map(o => ({
      Zone: o.zone,
      'Revenue ($/MW)': Number(o.revenue.toFixed(2)),
    }));
  }, [opportunities]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Opportunity Explorer</h1>
        <p className="page-subtitle">
          Identify the highest-value zones for battery-style DA-RT arbitrage across NYISO
        </p>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Analyzing price spreads across all zones...</div>}
      {!loading && !opportunities.length && <EmptyState message="No price data available to compute opportunities." />}

      {!loading && opportunities.length > 0 && (
        <>
          <div className="filter-bar">
            <div className="filter-group">
              <label>Asset Duration</label>
              <div className="pill-group">
                {(['1h', '2h', '4h'] as const).map(d => (
                  <button
                    key={d}
                    className={`pill${duration === d ? ' active' : ''}`}
                    onClick={() => setDuration(d)}
                  >
                    {d === '1h' ? '1-Hour' : d === '2h' ? '2-Hour' : '4-Hour'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="kpi-card accent">
              <div className="kpi-label">Best Zone</div>
              <div className="kpi-value">{bestZone.zone}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Best {duration} Revenue</div>
              <div className="kpi-value">
                ${bestZone.revenue.toFixed(0)}<span className="kpi-unit">/MW</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Avg Spread</div>
              <div className="kpi-value">
                ${bestZone.avgSpread.toFixed(2)}<span className="kpi-unit">/MWh</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Max Spread Seen</div>
              <div className="kpi-value">
                ${bestZone.maxSpread.toFixed(0)}<span className="kpi-unit">/MWh</span>
              </div>
            </div>
          </div>

          <div className="insight-card">
            <div className="insight-title">Opportunity Summary</div>
            <div className="insight-body">
              <strong>{bestZone.zone}</strong> leads all zones with an estimated <strong>${bestZone.revenue.toFixed(2)}/MW</strong> {duration} battery revenue,
              driven by an average top spread of <strong>${bestZone.avgSpread.toFixed(2)}/MWh</strong>.
              {bestZone.maxSpread > 100 && <> The maximum observed spread was <strong>${bestZone.maxSpread.toFixed(0)}/MWh</strong>, indicating significant price volatility events.</>}
              {' '}Across the dataset, <strong>{bestZone.events} spread events</strong> were captured for this zone.
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 24 }}>
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Zone Revenue Rankings ({duration})</div>
              </div>
              <LineChart data={opportunityBarData} xKey="Zone" yKeys={['Revenue ($/MW)']} height={260} />
            </div>

            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">DA vs RT — {active}</div>
              </div>
              {chartData.length > 0 ? (
                <LineChart data={chartData} xKey="Date" yKeys={['DA LMP', 'RT LMP']} height={260} />
              ) : (
                <div className="empty-state" style={{ padding: 40 }}>Select a zone to view price detail</div>
              )}
            </div>
          </div>

          <div className="section-container">
            <div className="section-title">Zone Rankings</div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="rank-table" style={{ borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Zone</th>
                    <th>Avg Spread</th>
                    <th>Max Spread</th>
                    <th>Est. Revenue</th>
                    <th>Events</th>
                    <th>Volatility</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((o, i) => (
                    <tr
                      key={o.zone}
                      onClick={() => setSelectedZone(o.zone)}
                      style={{ cursor: 'pointer', background: o.zone === active ? 'var(--primary-light)' : undefined }}
                    >
                      <td><span className="rank-num">{i + 1}</span></td>
                      <td style={{ fontWeight: 700 }}>{o.zone}</td>
                      <td>${o.avgSpread.toFixed(2)}/MWh</td>
                      <td>${o.maxSpread.toFixed(2)}/MWh</td>
                      <td style={{ fontWeight: 700, color: 'var(--accent)' }}>${o.revenue.toFixed(2)}/MW</td>
                      <td>{o.events}</td>
                      <td>{o.volatility.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {activeOpp && (
            <div className="insight-card" style={{ background: 'linear-gradient(135deg, var(--accent-light), var(--primary-light))' }}>
              <div className="insight-title">Zone Detail — {active}</div>
              <div className="insight-body">
                <strong>{active}</strong> ranks #{opportunities.findIndex(o => o.zone === active) + 1} across all zones.
                A {duration} battery here would earn an estimated <strong>${activeOpp.revenue.toFixed(2)}/MW</strong> based on
                the top {activeOpp.events} spread events. The average spread is <strong>${activeOpp.avgSpread.toFixed(2)}/MWh</strong> with
                volatility of {activeOpp.volatility.toFixed(1)}.
                {activeOpp.maxSpread > 200 && <> High spread events (up to ${activeOpp.maxSpread.toFixed(0)}/MWh) suggest potential congestion or scarcity-driven price spikes in this zone.</>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
