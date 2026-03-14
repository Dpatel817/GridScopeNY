import { useState, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import LineChart from '../components/LineChart';
import BarChart from '../components/BarChart';
import EmptyState from '../components/EmptyState';

type Duration = '1h' | '2h' | '4h';
type RankMetric = 'revenue' | 'avgSpread' | 'maxSpread';

export default function OpportunityExplorer() {
  const [duration, setDuration] = useState<Duration>('2h');
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [rankMetric, setRankMetric] = useState<RankMetric>('revenue');
  const [showAllRanks, setShowAllRanks] = useState(false);
  const [showRawTable, setShowRawTable] = useState(false);

  const { data: daData, loading: daLoading, error: daError } = useDataset('da_lbmp_zone', 'hourly');
  const { data: rtData, loading: rtLoading, error: rtError } = useDataset('rt_lbmp_zone', 'hourly');
  const { data: congestionData } = useDataset('rt_binding_constraints', 'raw');

  const loading = daLoading || rtLoading;
  const dataError = daError || rtError;
  const durationHours = duration === '1h' ? 1 : duration === '2h' ? 2 : 4;
  const durationLabel = duration === '1h' ? '1-Hour' : duration === '2h' ? '2-Hour' : '4-Hour';

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
      const positiveSpreads = spreads.filter(s => s > 5).length;
      return { zone, avgSpread, maxSpread, revenue, events: topN.length, volatility, positiveSpreads };
    });

    results.sort((a, b) => b[rankMetric] - a[rankMetric]);
    return { opportunities: results, hourlyByZone };
  }, [daData, rtData, durationHours, rankMetric]);

  const bestZone = opportunities[0];
  const mostVolatile = useMemo(() => {
    if (!opportunities.length) return null;
    return [...opportunities].sort((a, b) => b.volatility - a.volatility)[0];
  }, [opportunities]);
  const active = selectedZone || bestZone?.zone || '';
  const activeOpp = opportunities.find(o => o.zone === active);
  const activeRank = opportunities.findIndex(o => o.zone === active) + 1;

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

  const spreadOverTimeData = useMemo(() => {
    const hourly = hourlyByZone[active];
    if (!hourly?.length) return [];
    const dailyMap: Record<string, number[]> = {};
    for (const h of hourly) {
      if (!dailyMap[h.Date]) dailyMap[h.Date] = [];
      dailyMap[h.Date].push(h.spread);
    }
    return Object.entries(dailyMap).map(([date, spreads]) => ({
      Date: date,
      'Avg Spread': Number((spreads.reduce((s, v) => s + v, 0) / spreads.length).toFixed(2)),
      'Max Spread': Number(Math.max(...spreads).toFixed(2)),
    })).sort((a, b) => a.Date < b.Date ? -1 : 1);
  }, [hourlyByZone, active]);

  const metricLabels: Record<RankMetric, string> = { revenue: 'Est. Revenue', avgSpread: 'Avg Spread', maxSpread: 'Max Spread' };
  const maxMetricVal = opportunities[0]?.[rankMetric] || 1;

  const barChartLabel = metricLabels[rankMetric];
  const barData = useMemo(() => {
    return opportunities.slice(0, 11).map(o => ({
      Zone: o.zone,
      [barChartLabel]: Number(o[rankMetric].toFixed(2)),
    })).reverse();
  }, [opportunities, rankMetric, barChartLabel]);

  const topConstraints = useMemo(() => {
    if (!congestionData?.data?.length) return [];
    const costByName: Record<string, { count: number; totalCost: number }> = {};
    for (const r of congestionData.data) {
      const name = String(r['Constraint Name'] || r['Name'] || r['constraint_name'] || '');
      if (!name) continue;
      const cost = Math.abs(Number(r['Marginal Cost'] || r['Shadow Price'] || r['marginal_cost'] || 0));
      if (!costByName[name]) costByName[name] = { count: 0, totalCost: 0 };
      costByName[name].count++;
      costByName[name].totalCost += cost;
    }
    return Object.entries(costByName)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 4);
  }, [congestionData]);

  const getSignalType = (opp: typeof bestZone) => {
    if (!opp) return 'moderate';
    if (opp.volatility > opp.avgSpread * 2) return 'event-driven';
    if (opp.positiveSpreads > opp.events * 0.7) return 'recurring';
    return 'moderate';
  };

  const signalType = getSignalType(activeOpp || bestZone);
  const signalLabels: Record<string, string> = {
    'event-driven': 'Event-Driven',
    'recurring': 'Recurring Pattern',
    'moderate': 'Moderate Signal'
  };

  return (
    <div className="page">
      <div className="opp-hero-header">
        <div className="opp-title-block">
          <h1>
            Flex Opportunity Explorer
            <span className="opp-lens-badge">&#9889; Battery Lens</span>
          </h1>
          <p className="page-subtitle" style={{ marginTop: 8, maxWidth: 620 }}>
            Identify where battery-style arbitrage opportunity appears across NYISO zones and understand the market conditions behind it.
          </p>
        </div>
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          Analyzing DA-RT price spreads across all NYISO zones...
        </div>
      )}

      {!loading && dataError && (
        <div className="insight-card" style={{ background: 'var(--danger-light)', borderColor: 'var(--danger)' }}>
          <div className="insight-title" style={{ color: 'var(--danger)' }}>Data Error</div>
          <div className="insight-body">Failed to load price data: {dataError}. Check that the backend is running and data has been fetched via ETL.</div>
        </div>
      )}

      {!loading && !dataError && !opportunities.length && (
        <EmptyState message="No price data available. Run ETL to fetch DA and RT LBMP data from NYISO." />
      )}

      {!loading && opportunities.length > 0 && (
        <>
          <div className="opp-controls">
            <div className="opp-control-group">
              <div className="opp-control-label">Asset Duration</div>
              <div className="opp-duration-pills">
                {(['1h', '2h', '4h'] as const).map(d => (
                  <button
                    key={d}
                    className={`opp-duration-pill${duration === d ? ' active' : ''}`}
                    onClick={() => setDuration(d)}
                  >
                    {d === '1h' ? '1-Hour' : d === '2h' ? '2-Hour' : '4-Hour'}
                  </button>
                ))}
              </div>
            </div>
            <div className="opp-control-group">
              <div className="opp-control-label">Rank By</div>
              <div className="opp-duration-pills">
                {([['revenue', 'Revenue'], ['avgSpread', 'Avg Spread'], ['maxSpread', 'Max Spread']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    className={`opp-duration-pill${rankMetric === val ? ' active' : ''}`}
                    onClick={() => setRankMetric(val as RankMetric)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="opp-kpi-strip">
            <div className="opp-kpi hero-kpi">
              <div className="opp-kpi-label">Top Zone</div>
              <div className="opp-kpi-value">{bestZone.zone}</div>
              <div className="opp-kpi-sub">Ranked by {metricLabels[rankMetric].toLowerCase()}</div>
            </div>
            <div className="opp-kpi">
              <div className="opp-kpi-label">{durationLabel} Revenue</div>
              <div className="opp-kpi-value">${bestZone.revenue.toFixed(0)}<span className="unit">/MW</span></div>
              <div className="opp-kpi-sub">Best zone estimate</div>
            </div>
            <div className="opp-kpi">
              <div className="opp-kpi-label">Avg DA-RT Spread</div>
              <div className="opp-kpi-value">${bestZone.avgSpread.toFixed(2)}<span className="unit">/MWh</span></div>
              <div className="opp-kpi-sub">Top spreads average</div>
            </div>
            <div className="opp-kpi">
              <div className="opp-kpi-label">Peak Spread</div>
              <div className="opp-kpi-value">${bestZone.maxSpread.toFixed(0)}<span className="unit">/MWh</span></div>
              <div className="opp-kpi-sub">Maximum observed</div>
            </div>
            <div className="opp-kpi">
              <div className="opp-kpi-label">Most Volatile</div>
              <div className="opp-kpi-value">{mostVolatile?.zone || '—'}</div>
              <div className="opp-kpi-sub">Std dev {mostVolatile?.volatility.toFixed(1) || '—'}</div>
            </div>
          </div>

          <div className="opp-insight-panel">
            <div className="insight-badge">&#9889; Opportunity Summary</div>
            <div className="insight-headline">
              {bestZone.zone} leads all zones with ${bestZone.revenue.toFixed(2)}/MW estimated {durationLabel.toLowerCase()} battery revenue
            </div>
            <div className="insight-detail">
              This zone captured <strong>{bestZone.events} spread events</strong> with an average top spread
              of <strong>${bestZone.avgSpread.toFixed(2)}/MWh</strong>.
              {bestZone.maxSpread > 100 && <> A peak spread of <strong>${bestZone.maxSpread.toFixed(0)}/MWh</strong> was observed, indicating significant price volatility events. </>}
              The signal appears <strong>{signalLabels[getSignalType(bestZone)].toLowerCase()}</strong>,
              {getSignalType(bestZone) === 'recurring'
                ? ' suggesting consistent spread patterns that may persist.'
                : getSignalType(bestZone) === 'event-driven'
                  ? ' suggesting episodic price dislocations—potentially tied to congestion or outage events.'
                  : ' with moderate spread consistency across the analysis window.'}
              {mostVolatile && mostVolatile.zone !== bestZone.zone && <> The most volatile zone is <strong>{mostVolatile.zone}</strong> (std dev {mostVolatile.volatility.toFixed(1)}), which may present higher-risk/higher-reward opportunities.</>}
            </div>
          </div>

          <div className="opp-main-grid">
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Zone Rankings — {barChartLabel}</div>
                <span className="chart-badge">{durationLabel} Battery</span>
              </div>
              <BarChart
                data={barData}
                xKey="Zone"
                yKey={barChartLabel}
                height={Math.max(300, barData.length * 32)}
                highlightIndex={barData.length - 1}
                layout="horizontal"
                showLabels
                labelPrefix="$"
              />
            </div>

            <div className="opp-zone-detail">
              <div className="opp-zone-detail-header">
                <span className="zone-name-lg">{active}</span>
                <span className="zone-rank-badge">#{activeRank} of {opportunities.length}</span>
              </div>
              <div className="opp-zone-stats">
                <div className="opp-zone-stat">
                  <div className="stat-label">Avg DA-RT Spread</div>
                  <div className="stat-value">${activeOpp?.avgSpread.toFixed(2) || '—'}/MWh</div>
                </div>
                <div className="opp-zone-stat">
                  <div className="stat-label">Max Spread</div>
                  <div className="stat-value">${activeOpp?.maxSpread.toFixed(0) || '—'}/MWh</div>
                </div>
                <div className="opp-zone-stat">
                  <div className="stat-label">{durationLabel} Revenue</div>
                  <div className="stat-value accent">${activeOpp?.revenue.toFixed(2) || '—'}/MW</div>
                </div>
                <div className="opp-zone-stat">
                  <div className="stat-label">Spread Events</div>
                  <div className="stat-value">{activeOpp?.events || '—'}</div>
                </div>
                <div className="opp-zone-stat">
                  <div className="stat-label">Volatility (σ)</div>
                  <div className="stat-value">{activeOpp?.volatility.toFixed(1) || '—'}</div>
                </div>
                <div className="opp-zone-stat">
                  <div className="stat-label">Signal Type</div>
                  <div className="stat-value">{signalLabels[signalType]}</div>
                </div>
              </div>
              {activeOpp && (
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--text)' }}>{active}</strong> ranks #{activeRank} across all zones.
                  {signalType === 'recurring'
                    ? ' Consistent spread patterns suggest this zone may offer reliable arbitrage opportunities for battery storage assets.'
                    : signalType === 'event-driven'
                      ? ' Elevated volatility suggests episodic opportunities—potentially tied to congestion, outages, or localized scarcity.'
                      : ' Moderate spread behavior indicates steady, lower-variance opportunity in this zone.'}
                </div>
              )}
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 24 }}>
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">DA vs RT Price — {active}</div>
                <span className="chart-badge">Hourly</span>
              </div>
              {chartData.length > 0 ? (
                <LineChart data={chartData} xKey="Date" yKeys={['DA LMP', 'RT LMP']} height={280} />
              ) : (
                <div className="empty-state" style={{ padding: 60 }}>Select a zone to view price detail</div>
              )}
            </div>
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Spread Over Time — {active}</div>
                <span className="chart-badge">Daily</span>
              </div>
              {spreadOverTimeData.length > 0 ? (
                <LineChart data={spreadOverTimeData} xKey="Date" yKeys={['Avg Spread', 'Max Spread']} height={280} />
              ) : (
                <div className="empty-state" style={{ padding: 60 }}>Select a zone to view spread trend</div>
              )}
            </div>
          </div>

          {(topConstraints.length > 0 || mostVolatile) && (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 4 }}>
                  Market Drivers
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Key factors that may contribute to spread opportunity across zones
                </div>
              </div>
              <div className="opp-driver-grid">
                {topConstraints.slice(0, 2).map((c, i) => (
                  <div className="opp-driver-card" key={i}>
                    <div className="driver-icon">&#128293;</div>
                    <div className="driver-label">Active Constraint</div>
                    <div className="driver-value">{c.name.length > 28 ? c.name.slice(0, 28) + '…' : c.name}</div>
                    <div className="driver-sub">{c.count} bindings · ${c.totalCost.toFixed(0)} total cost</div>
                  </div>
                ))}
                <div className="opp-driver-card">
                  <div className="driver-icon">&#9889;</div>
                  <div className="driver-label">Highest Volatility Zone</div>
                  <div className="driver-value">{mostVolatile?.zone || '—'}</div>
                  <div className="driver-sub">σ = {mostVolatile?.volatility.toFixed(1) || '—'} · {mostVolatile?.positiveSpreads || 0} spread events</div>
                </div>
                <div className="opp-driver-card">
                  <div className="driver-icon">&#128200;</div>
                  <div className="driver-label">Zones Analyzed</div>
                  <div className="driver-value">{opportunities.length}</div>
                  <div className="driver-sub">{opportunities.filter(o => o.avgSpread > 5).length} zones with avg spread &gt; $5</div>
                </div>
              </div>
            </>
          )}

          <div className="opp-ranking-section">
            <div className="opp-ranking-header">
              <h3>Detailed Zone Rankings — {durationLabel} Battery</h3>
              <button className="opp-ranking-toggle" onClick={() => setShowAllRanks(!showAllRanks)} aria-expanded={showAllRanks}>
                {showAllRanks ? 'Show Top 5' : `Show All ${opportunities.length}`}
              </button>
            </div>
            <div style={{ padding: '8px 24px 4px', borderBottom: '1px solid var(--border-light)' }}>
              <div className="opp-rank-row" style={{ cursor: 'default', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', padding: '4px 0' }}>
                <div>#</div>
                <div>Zone</div>
                <div>Avg Spread</div>
                <div>Max Spread</div>
                <div>Est. Revenue</div>
                <div>Vol (σ)</div>
              </div>
            </div>
            {(showAllRanks ? opportunities : opportunities.slice(0, 5)).map((o, i) => (
              <div
                key={o.zone}
                className={`opp-rank-row${o.zone === active ? ' selected' : ''}`}
                onClick={() => setSelectedZone(o.zone)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedZone(o.zone); } }}
                role="button"
                tabIndex={0}
                aria-label={`Select zone ${o.zone}, rank ${i + 1}`}
                data-rank={i + 1}
              >
                <div><span className={`rank-badge${i < 3 ? ` rank-${i + 1}` : ''}`}>{i + 1}</span></div>
                <div>
                  <div className="rank-zone">{o.zone}</div>
                  <div className="opp-mini-bar">
                    <div className="bar-fill" style={{ width: `${(o[rankMetric] / maxMetricVal) * 100}%` }} />
                  </div>
                </div>
                <div className="rank-metric">${o.avgSpread.toFixed(2)}/MWh</div>
                <div className="rank-metric">${o.maxSpread.toFixed(0)}/MWh</div>
                <div className="rank-revenue">${o.revenue.toFixed(2)}/MW</div>
                <div className="rank-metric">{o.volatility.toFixed(1)}</div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <button
              className="collapsible-header"
              onClick={() => setShowRawTable(!showRawTable)}
              aria-expanded={showRawTable}
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}
            >
              <span>Raw Data Table — All Zones ({opportunities.length})</span>
              <span style={{ fontSize: 18 }}>{showRawTable ? '−' : '+'}</span>
            </button>
            {showRawTable && (
              <div style={{ marginTop: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'auto' }}>
                <table className="rank-table" style={{ borderSpacing: 0, width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 50 }}>#</th>
                      <th>Zone</th>
                      <th>Avg Spread ($/MWh)</th>
                      <th>Max Spread ($/MWh)</th>
                      <th>Est. Revenue ($/MW)</th>
                      <th>Events</th>
                      <th>Volatility</th>
                      <th>Positive Spreads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map((o, i) => (
                      <tr key={o.zone} style={{ cursor: 'pointer', background: o.zone === active ? 'var(--primary-light)' : undefined }} onClick={() => setSelectedZone(o.zone)}>
                        <td><span className="rank-num">{i + 1}</span></td>
                        <td style={{ fontWeight: 700 }}>{o.zone}</td>
                        <td>${o.avgSpread.toFixed(2)}</td>
                        <td>${o.maxSpread.toFixed(2)}</td>
                        <td style={{ fontWeight: 700, color: 'var(--accent)' }}>${o.revenue.toFixed(2)}</td>
                        <td>{o.events}</td>
                        <td>{o.volatility.toFixed(1)}</td>
                        <td>{o.positiveSpreads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
