import { useState, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import LineChart from '../components/LineChart';
import BarChart from '../components/BarChart';
import EmptyState from '../components/EmptyState';
import { isNyisoZone } from '../data/zones';
import { buildTimestamp } from '../utils/timeSeries';

type Duration = '1h' | '2h' | '4h';
type RankMetric = 'revenue' | 'avgSpread' | 'maxSpread';
type Role = 'trader' | 'battery';

interface AIResponse {
  answer: string;
  trader_takeaways?: string[];
  battery_takeaways?: string[];
  key_signals?: string[];
  drivers?: string[];
  caveats?: string[];
  status: string;
}

const OPP_PROMPTS = [
  { label: 'Top Opportunity', prompt: 'Why is this zone the top opportunity today?' },
  { label: 'Structural vs Event', prompt: 'Does this opportunity look more structural or event-driven?' },
  { label: 'Trader Implications', prompt: 'What are the trader implications of this spread behavior?' },
  { label: 'Battery Strategy', prompt: 'What are the battery strategy implications here?' },
  { label: 'Operational Signals', prompt: 'What operational signals support this opportunity?' },
];

function CollapsibleSection({ title, badge, defaultOpen, children }: { title: string; badge?: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="opp-collapsible">
      <button className="opp-collapsible-trigger" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="opp-collapsible-title">{title}</span>
        {badge && <span className="opp-collapsible-badge">{badge}</span>}
        <span className="opp-collapsible-chevron">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="opp-collapsible-body">{children}</div>}
    </div>
  );
}

export default function OpportunityExplorer() {
  const [role, setRole] = useState<Role>('trader');
  const [duration, setDuration] = useState<Duration>('2h');
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [rankMetric, setRankMetric] = useState<RankMetric>('revenue');
  const [showAllRanks, setShowAllRanks] = useState(false);
  const [showRawTable, setShowRawTable] = useState(false);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [moreAnalysisTab, setMoreAnalysisTab] = useState<'charts' | 'ai' | 'data'>('charts');
  const [showMoreAnalysis, setShowMoreAnalysis] = useState(false);

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const { data: daData, loading: daLoading, error: daError } = useDataset('da_lbmp_zone', 'hourly', undefined, undefined, 250000, 730);
  const { data: rtData, loading: rtLoading, error: rtError } = useDataset('rt_lbmp_zone', 'hourly', undefined, undefined, 250000, 730);
  const { data: congestionData } = useDataset('dam_limiting_constraints', 'daily', undefined, undefined, 20000, 730);
  const { data: demandData } = useDataset('isolf', 'daily', undefined, undefined, 20000, 730);

  const loading = daLoading || rtLoading;
  const dataError = daError || rtError;
  const durationHours = duration === '1h' ? 1 : duration === '2h' ? 2 : 4;
  const durationLabel = duration === '1h' ? '1-Hour' : duration === '2h' ? '2-Hour' : '4-Hour';

  const availableDates = useMemo(() => {
    if (!rtData?.data?.length) return [];
    const s = new Set<string>();
    for (const r of rtData.data) s.add(String(r.Date));
    return [...s].sort();
  }, [rtData]);

  const dateRangeLabel = useMemo(() => {
    const s = startDate || availableDates[0] || '';
    const e = endDate || availableDates[availableDates.length - 1] || '';
    if (!s || !e) return '';
    return `${s} to ${e}`;
  }, [startDate, endDate, availableDates]);

  const { opportunities, hourlyByZone } = useMemo(() => {
    if (!daData?.data?.length || !rtData?.data?.length) return { opportunities: [], hourlyByZone: {} as Record<string, any[]> };

    const effStart = startDate || availableDates[0] || '';
    const effEnd = endDate || availableDates[availableDates.length - 1] || '';

    const hasHE = daData.data.some((r: any) => r.HE != null);
    const daByKey: Record<string, number> = {};
    for (const r of daData.data) {
      const d = String(r.Date);
      if (effStart && d < effStart) continue;
      if (effEnd && d > effEnd) continue;
      const k = hasHE ? `${r.Date}_${r.HE}_${r.Zone}` : `${r.Date}_${r.Zone}`;
      daByKey[k] = Number(r.LMP) || 0;
    }

    const zoneData: Record<string, { spreads: number[]; hourly: { Date: string; HE: number; spread: number; daLmp: number; rtLmp: number }[]; zone: string }> = {};
    for (const r of rtData.data) {
      const d = String(r.Date);
      if (effStart && d < effStart) continue;
      if (effEnd && d > effEnd) continue;
      const zone = String(r.Zone);
      if (!isNyisoZone(zone)) continue;
      const key = hasHE ? `${r.Date}_${r.HE}_${r.Zone}` : `${r.Date}_${r.Zone}`;
      const rtLmp = Number(r.LMP) || 0;
      const daLmp = daByKey[key] || 0;
      const spread = Math.abs(rtLmp - daLmp);
      if (!zoneData[zone]) zoneData[zone] = { spreads: [], hourly: [], zone };
      zoneData[zone].spreads.push(spread);
      zoneData[zone].hourly.push({ Date: String(r.Date), HE: Number(r.HE || 0), spread, daLmp, rtLmp });
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
      const rtPremiumCount = hourly.filter(h => h.rtLmp > h.daLmp).length;
      const rtPremiumPct = hourly.length > 0 ? rtPremiumCount / hourly.length : 0;
      return { zone, avgSpread, maxSpread, revenue, events: topN.length, volatility, positiveSpreads, rtPremiumPct };
    });

    results.sort((a, b) => b[rankMetric] - a[rankMetric]);
    return { opportunities: results, hourlyByZone };
  }, [daData, rtData, durationHours, rankMetric, startDate, endDate, availableDates]);

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
      if (!byTime[key]) byTime[key] = { Date: `${h.Date} HE${h.HE}`, _ts: buildTimestamp(h.Date, h.HE), HE: h.HE };
      byTime[key]['DA LMP'] = h.daLmp;
      byTime[key]['RT LMP'] = h.rtLmp;
      byTime[key]['Spread'] = h.spread;
    }
    return Object.values(byTime).sort((a: any, b: any) => a._ts - b._ts);
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
    const effStart = startDate || availableDates[0] || '';
    const effEnd = endDate || availableDates[availableDates.length - 1] || '';
    const costByName: Record<string, { count: number; totalCost: number }> = {};
    for (const r of congestionData.data) {
      const d = String(r.Date || '');
      if (effStart && d < effStart) continue;
      if (effEnd && d > effEnd) continue;
      const name = String(r['Limiting Facility'] || '');
      if (!name) continue;
      const cost = Math.abs(Number(r['Constraint Cost'] || 0));
      if (!costByName[name]) costByName[name] = { count: 0, totalCost: 0 };
      costByName[name].count++;
      costByName[name].totalCost += cost;
    }
    return Object.entries(costByName)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 4);
  }, [congestionData, startDate, endDate, availableDates]);

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

  const demandContext = useMemo(() => {
    if (!demandData?.data?.length) return null;
    const effStart = startDate || availableDates[0] || '';
    const effEnd = endDate || availableDates[availableDates.length - 1] || '';
    const filtered = demandData.data.filter((r: any) => {
      const d = String(r.Date || '');
      if (effStart && d < effStart) return false;
      if (effEnd && d > effEnd) return false;
      return true;
    });
    const vals = filtered.map((r: any) => Number(r.NYISO || 0)).filter(Boolean);
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const peak = Math.max(...vals);
    return { avg: Math.round(avg), peak: Math.round(peak) };
  }, [demandData, startDate, endDate, availableDates]);

  const traderInsights = useMemo(() => {
    if (!opportunities.length) return [];
    const insights: string[] = [];
    const top = opportunities[0];
    const runner = opportunities[1];

    if (top && runner) {
      const spreadGap = top.avgSpread - runner.avgSpread;
      if (spreadGap > 5) {
        insights.push(`${top.zone} shows clear spread dominance at $${top.avgSpread.toFixed(2)}/MWh, $${spreadGap.toFixed(2)} above ${runner.zone}. Concentrated dislocation suggests localized scarcity or congestion.`);
      } else {
        insights.push(`Top zones ${top.zone} and ${runner.zone} show similar spreads ($${top.avgSpread.toFixed(2)} vs $${runner.avgSpread.toFixed(2)}). Opportunity appears distributed rather than concentrated.`);
      }
    }

    const highDivergence = opportunities.filter(o => o.rtPremiumPct > 0.6 || o.rtPremiumPct < 0.4);
    if (highDivergence.length > 0) {
      const example = highDivergence[0];
      const direction = example.rtPremiumPct > 0.5 ? 'RT premium' : 'DA premium';
      insights.push(`${example.zone} shows persistent ${direction} (${(example.rtPremiumPct * 100).toFixed(0)}% of hours RT > DA). This directional bias may be tradeable.`);
    }

    if (topConstraints.length > 0) {
      const c = topConstraints[0];
      insights.push(`Active congestion on ${c.name.length > 35 ? c.name.slice(0, 35) + '...' : c.name} (${c.count} bindings, $${c.totalCost.toFixed(0)} cost) likely contributes to spread opportunity.`);
    }

    const eventDrivenZones = opportunities.filter(o => getSignalType(o) === 'event-driven');
    const recurringZones = opportunities.filter(o => getSignalType(o) === 'recurring');
    if (eventDrivenZones.length > 0 && recurringZones.length > 0) {
      insights.push(`${recurringZones.length} zones show recurring spreads (lower risk), while ${eventDrivenZones.length} zones appear event-driven (higher reward, less predictable).`);
    }

    if (mostVolatile && mostVolatile.zone !== top?.zone) {
      insights.push(`${mostVolatile.zone} is the most volatile zone (sigma ${mostVolatile.volatility.toFixed(1)}). Higher verification risk but potential for outsized real-time gains.`);
    }

    return insights.slice(0, 5);
  }, [opportunities, topConstraints, mostVolatile]);

  const batteryInsights = useMemo(() => {
    if (!opportunities.length) return [];
    const insights: string[] = [];
    const top = opportunities[0];
    const signal = getSignalType(top);

    insights.push(`Best zone for ${durationLabel.toLowerCase()} battery: ${top.zone} at $${top.revenue.toFixed(2)}/MW estimated revenue from ${top.events} spread events.`);

    if (signal === 'recurring') {
      insights.push(`${top.zone} shows a recurring pattern — value appears persistent rather than one-off. This favors longer-term battery positioning.`);
    } else if (signal === 'event-driven') {
      insights.push(`${top.zone} value appears event-driven — opportunity may not persist. Consider shorter commitment or flexible dispatch strategy.`);
    } else {
      insights.push(`${top.zone} shows moderate signal consistency. Value appears steady but not strongly trending in either direction.`);
    }

    if (topConstraints.length > 0) {
      const congestionDriven = topConstraints[0].totalCost > 100;
      if (congestionDriven) {
        insights.push(`Opportunity appears congestion-driven (${topConstraints[0].name.slice(0, 30)}... $${topConstraints[0].totalCost.toFixed(0)} cost). Storage value strongest behind binding constraints.`);
      }
    }

    if (demandContext) {
      const loadFactor = demandContext.peak / demandContext.avg;
      if (loadFactor > 1.3) {
        insights.push(`High peak-to-average load ratio (${loadFactor.toFixed(2)}x) indicates load-driven spreads. Battery value likely concentrated in peak hours.`);
      } else {
        insights.push(`Moderate load profile (peak/avg ratio ${loadFactor.toFixed(2)}x). Spread opportunity may span more hours, favoring longer-duration assets.`);
      }
    }

    const secondBest = opportunities[1];
    if (secondBest) {
      const gap = ((top.revenue - secondBest.revenue) / secondBest.revenue * 100);
      if (gap > 20) {
        insights.push(`Structurally strongest: ${top.zone} leads ${secondBest.zone} by ${gap.toFixed(0)}% on revenue. Location advantage appears material.`);
      } else {
        insights.push(`${top.zone} and ${secondBest.zone} offer similar battery value. Consider transmission and interconnection factors for siting.`);
      }
    }

    return insights.slice(0, 5);
  }, [opportunities, durationLabel, topConstraints, demandContext]);

  const buildAiContext = () => {
    const ctx: Record<string, any> = {};
    if (activeOpp) {
      ctx.selected_zone = active;
      ctx.zone_rank = `#${activeRank} of ${opportunities.length}`;
      ctx.avg_spread = `$${activeOpp.avgSpread.toFixed(2)}/MWh`;
      ctx.max_spread = `$${activeOpp.maxSpread.toFixed(0)}/MWh`;
      ctx.estimated_revenue = `$${activeOpp.revenue.toFixed(2)}/MW (${durationLabel})`;
      ctx.volatility = activeOpp.volatility.toFixed(1);
      ctx.signal_type = signalLabels[signalType];
      ctx.spread_events = activeOpp.events;
      ctx.rt_premium_pct = `${(activeOpp.rtPremiumPct * 100).toFixed(0)}%`;
    }
    if (bestZone && bestZone.zone !== active) {
      ctx.top_zone = `${bestZone.zone} ($${bestZone.revenue.toFixed(2)}/MW)`;
    }
    ctx.battery_duration = durationLabel;
    ctx.date_range = dateRangeLabel;
    ctx.zones_analyzed = opportunities.length;
    if (topConstraints.length > 0) {
      ctx.top_constraints = topConstraints.slice(0, 3).map(c => `${c.name} (${c.count} bindings, $${c.totalCost.toFixed(0)})`).join('; ');
    }
    if (demandContext) {
      ctx.peak_load = `${demandContext.peak.toLocaleString()} MW`;
      ctx.avg_load = `${demandContext.avg.toLocaleString()} MW`;
    }
    if (traderInsights.length > 0) {
      ctx.trader_insight_summary = traderInsights[0];
    }
    if (batteryInsights.length > 0) {
      ctx.battery_insight_summary = batteryInsights[0];
    }
    return ctx;
  };

  async function handleAiExplain(question?: string) {
    const q = question || aiPrompt.trim();
    if (!q) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      const res = await fetch('/api/ai-explainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, context: buildAiContext() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiResponse({ answer: data.detail || 'Request failed', status: 'error', drivers: [], caveats: [] });
      } else {
        setAiResponse(data);
      }
    } catch {
      setAiResponse({ answer: 'Request failed. Is the API server running?', status: 'error', drivers: [], caveats: [] });
    } finally {
      setAiLoading(false);
    }
  }

  const heroSummary = useMemo(() => {
    if (!bestZone) return { line1: '', line2: '', line3: '' };
    const signal = getSignalType(bestZone);
    if (role === 'trader') {
      return {
        line1: `Best opportunity: ${bestZone.zone} — $${bestZone.avgSpread.toFixed(2)}/MWh avg spread, $${bestZone.maxSpread.toFixed(0)} peak`,
        line2: `Ranks #1 by ${metricLabels[rankMetric].toLowerCase()}: ${signal === 'recurring' ? 'recurring spread pattern with consistent dislocation' : signal === 'event-driven' ? 'event-driven volatility with outsized spread spikes' : 'moderate signal with steady spread behavior'}`,
        line3: `Action: ${signal === 'recurring' ? 'Systematic DA-RT arb opportunity — consider position sizing across peak hours' : signal === 'event-driven' ? 'Monitor for real-time spikes — set alerts on spread thresholds for quick execution' : 'Steady spread profile supports measured position entry on this zone'}`,
      };
    }
    return {
      line1: `Best zone: ${bestZone.zone} — $${bestZone.revenue.toFixed(0)}/MW est. ${durationLabel.toLowerCase()} revenue from ${bestZone.events} events`,
      line2: `Ranks #1 by ${metricLabels[rankMetric].toLowerCase()}: ${signal === 'recurring' ? 'persistent pattern favors long-term storage siting' : signal === 'event-driven' ? 'episodic value — may not persist for multi-year commitment' : 'moderate consistency supports balanced storage deployment'}`,
      line3: `Decision: ${signal === 'recurring' ? 'Strong structural case for battery deployment — value appears durable' : signal === 'event-driven' ? 'Consider shorter-term or flexible dispatch — value concentration is episodic' : 'Viable for storage but weigh against zones with stronger structural signals'}`,
    };
  }, [bestZone, role, rankMetric, durationLabel]);

  const traderRankColumns = useMemo(() => {
    return opportunities.map(o => ({
      ...o,
      signalStrength: o.avgSpread * (o.positiveSpreads / (o.events || 1)),
      spreadFrequency: o.positiveSpreads,
      regimeTag: getSignalType(o),
    }));
  }, [opportunities]);

  const batteryRankColumns = useMemo(() => {
    return opportunities.map(o => {
      const rev1h = o.avgSpread * 1;
      const rev2h = o.avgSpread * 2;
      const rev4h = o.avgSpread * 4;
      const persistence = o.positiveSpreads / (o.events || 1);
      const structuralScore = persistence * o.avgSpread * (1 / (1 + o.volatility / (o.avgSpread || 1)));
      return { ...o, rev1h, rev2h, rev4h, persistence, structuralScore };
    });
  }, [opportunities]);

  return (
    <div className="page">
      <div className="opp-hero-header">
        <div className="opp-title-block">
          <h1>
            Opportunity Explorer
            <span className="opp-lens-badge">Intelligence</span>
          </h1>
          <p className="page-subtitle" style={{ marginTop: 4, maxWidth: 600 }}>
            NYISO zone opportunity analysis with role-specific insights.
          </p>
        </div>
        <div className="opp-role-toggle">
          <button
            className={`opp-role-btn${role === 'trader' ? ' active trader' : ''}`}
            onClick={() => setRole('trader')}
          >
            Trader
          </button>
          <button
            className={`opp-role-btn${role === 'battery' ? ' active battery' : ''}`}
            onClick={() => setRole('battery')}
          >
            Battery Strategist
          </button>
        </div>
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          Analyzing DA-RT spreads across NYISO zones...
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
              <div className="opp-control-label">Duration</div>
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
            <div className="opp-control-group">
              <div className="opp-control-label">Date Range</div>
              <div className="opp-date-range">
                <input
                  type="date"
                  className="opp-date-input"
                  value={startDate || availableDates[0] || ''}
                  min={availableDates[0] || ''}
                  max={endDate || availableDates[availableDates.length - 1] || ''}
                  onChange={e => setStartDate(e.target.value)}
                />
                <span className="opp-date-sep">to</span>
                <input
                  type="date"
                  className="opp-date-input"
                  value={endDate || availableDates[availableDates.length - 1] || ''}
                  min={startDate || availableDates[0] || ''}
                  max={availableDates[availableDates.length - 1] || ''}
                  onChange={e => setEndDate(e.target.value)}
                />
                {(startDate || endDate) && (
                  <button
                    className="opp-date-reset"
                    onClick={() => { setStartDate(''); setEndDate(''); }}
                    title="Reset to full range"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="opp-answer-card">
            <div className="opp-answer-role-label">{role === 'trader' ? 'Trader View' : 'Battery Strategist View'}</div>
            <div className="opp-answer-line">{heroSummary.line1}</div>
            <div className="opp-answer-line">{heroSummary.line2}</div>
            <div className="opp-answer-line opp-answer-action">{heroSummary.line3}</div>
          </div>

          <div className="opp-kpi-strip">
            <div className="opp-kpi hero-kpi">
              <div className="opp-kpi-label">Top Zone</div>
              <div className="opp-kpi-value">{bestZone.zone}</div>
              <div className="opp-kpi-sub">By {metricLabels[rankMetric].toLowerCase()}</div>
            </div>
            <div className="opp-kpi">
              <div className="opp-kpi-label">{durationLabel} Revenue</div>
              <div className="opp-kpi-value">${bestZone.revenue.toFixed(0)}<span className="unit">/MW</span></div>
              <div className="opp-kpi-sub">Best zone est.</div>
            </div>
            <div className="opp-kpi">
              <div className="opp-kpi-label">Avg Spread</div>
              <div className="opp-kpi-value">${bestZone.avgSpread.toFixed(2)}<span className="unit">/MWh</span></div>
              <div className="opp-kpi-sub">Top spreads</div>
            </div>
            {role === 'trader' ? (
              <div className="opp-kpi">
                <div className="opp-kpi-label">Peak Spread</div>
                <div className="opp-kpi-value">${bestZone.maxSpread.toFixed(0)}<span className="unit">/MWh</span></div>
                <div className="opp-kpi-sub">Max observed</div>
              </div>
            ) : (
              <div className="opp-kpi">
                <div className="opp-kpi-label">Signal Type</div>
                <div className="opp-kpi-value" style={{ fontSize: '1.1rem' }}>{signalLabels[getSignalType(bestZone)]}</div>
                <div className="opp-kpi-sub">Top zone pattern</div>
              </div>
            )}
            <div className="opp-kpi">
              <div className="opp-kpi-label">{role === 'trader' ? 'Most Volatile' : 'Spread Events'}</div>
              <div className="opp-kpi-value">{role === 'trader' ? (mostVolatile?.zone || '—') : bestZone.events}</div>
              <div className="opp-kpi-sub">{role === 'trader' ? `σ ${mostVolatile?.volatility.toFixed(1) || '—'}` : `${durationLabel} window`}</div>
            </div>
          </div>

          <CollapsibleSection
            key={`current-signal-${role}`}
            title="Current Signal"
            badge={role === 'trader' ? 'Primary' : undefined}
            defaultOpen={role === 'trader'}
          >
            {traderInsights.length > 0 && (
              <div className="takeaway-section opp-embedded-section">
                <div className="takeaway-header">
                  <span className="takeaway-title">{role === 'trader' ? 'Trader Takeaways' : 'Current Market Signals'}</span>
                  <span className="takeaway-badge trader">Short-Term</span>
                </div>
                <div className="takeaway-list">
                  {traderInsights.map((insight, i) => (
                    <div className="takeaway-item trader" key={i}>
                      <span className="takeaway-num">{i + 1}</span>
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="chart-card opp-embedded-chart">
              <div className="chart-card-header">
                <div className="chart-card-title">DA vs RT Price — {active}</div>
                <span className="chart-badge">Hourly</span>
              </div>
              {chartData.length > 0 ? (
                <LineChart data={chartData} xKey="Date" yKeys={['DA LMP', 'RT LMP']} height={260} />
              ) : (
                <div className="empty-state" style={{ padding: 48 }}>Select a zone to view price detail</div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            key={`structural-${role}`}
            title="Structural Opportunity"
            badge={role === 'battery' ? 'Primary' : undefined}
            defaultOpen={role === 'battery'}
          >
            {batteryInsights.length > 0 && (
              <div className="takeaway-section opp-embedded-section">
                <div className="takeaway-header">
                  <span className="takeaway-title">{role === 'battery' ? 'Battery Strategist Takeaways' : 'Structural Signals'}</span>
                  <span className="takeaway-badge battery">Storage</span>
                </div>
                <div className="takeaway-list">
                  {batteryInsights.map((insight, i) => (
                    <div className="takeaway-item battery" key={i}>
                      <span className="takeaway-num">{i + 1}</span>
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="chart-card opp-embedded-chart">
              <div className="chart-card-header">
                <div className="chart-card-title">Spread Over Time — {active}</div>
                <span className="chart-badge">Daily</span>
              </div>
              {spreadOverTimeData.length > 0 ? (
                <LineChart data={spreadOverTimeData} xKey="Date" yKeys={['Avg Spread', 'Max Spread']} height={260} />
              ) : (
                <div className="empty-state" style={{ padding: 48 }}>Select a zone to view spread trend</div>
              )}
            </div>
          </CollapsibleSection>

          <div className="opp-main-grid">
            <div className="chart-card">
              <div className="chart-card-header">
                <div className="chart-card-title">Zone Rankings — {barChartLabel}</div>
                <span className="chart-badge">{durationLabel}</span>
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
                  <div className="stat-label">Avg Spread</div>
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
                  <div className="stat-label">Events</div>
                  <div className="stat-value">{activeOpp?.events || '—'}</div>
                </div>
                <div className="opp-zone-stat">
                  <div className="stat-label">Volatility (σ)</div>
                  <div className="stat-value">{activeOpp?.volatility.toFixed(1) || '—'}</div>
                </div>
                <div className="opp-zone-stat">
                  <div className="stat-label">Signal</div>
                  <div className="stat-value">{signalLabels[signalType]}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="opp-ranking-section">
            <div className="opp-ranking-header">
              <h3>{role === 'trader' ? 'Zone Rankings — Trader' : `Zone Rankings — ${durationLabel} Battery`}</h3>
              <button className="opp-ranking-toggle" onClick={() => setShowAllRanks(!showAllRanks)} aria-expanded={showAllRanks}>
                {showAllRanks ? 'Show Top 5' : `Show All ${opportunities.length}`}
              </button>
            </div>
            {role === 'trader' ? (
              <>
                <div style={{ padding: '8px 24px 4px', borderBottom: '1px solid var(--border-light)' }}>
                  <div className="opp-rank-row" style={{ cursor: 'default', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', padding: '4px 0' }}>
                    <div>#</div>
                    <div>Zone</div>
                    <div>Signal Strength</div>
                    <div>Spread Freq</div>
                    <div>Volatility (σ)</div>
                    <div>Regime</div>
                  </div>
                </div>
                {(showAllRanks ? traderRankColumns : traderRankColumns.slice(0, 5)).map((o, i) => (
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
                    <div className="rank-metric">{o.signalStrength.toFixed(1)}</div>
                    <div className="rank-metric">{o.spreadFrequency}</div>
                    <div className="rank-metric">{o.volatility.toFixed(1)}</div>
                    <div><span className={`opp-regime-tag ${o.regimeTag}`}>{signalLabels[o.regimeTag]}</span></div>
                  </div>
                ))}
              </>
            ) : (
              <>
                <div style={{ padding: '8px 24px 4px', borderBottom: '1px solid var(--border-light)' }}>
                  <div className="opp-rank-row opp-rank-row-battery" style={{ cursor: 'default', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', padding: '4px 0' }}>
                    <div>#</div>
                    <div>Zone</div>
                    <div>1h Value</div>
                    <div>2h Value</div>
                    <div>4h Value</div>
                    <div>Persistence</div>
                    <div>Structural</div>
                  </div>
                </div>
                {(showAllRanks ? batteryRankColumns : batteryRankColumns.slice(0, 5)).map((o, i) => (
                  <div
                    key={o.zone}
                    className={`opp-rank-row opp-rank-row-battery${o.zone === active ? ' selected' : ''}`}
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
                    <div className="rank-revenue">${o.rev1h.toFixed(0)}/MW</div>
                    <div className="rank-revenue">${o.rev2h.toFixed(0)}/MW</div>
                    <div className="rank-revenue">${o.rev4h.toFixed(0)}/MW</div>
                    <div className="rank-metric">{(o.persistence * 100).toFixed(0)}%</div>
                    <div className="rank-metric">{o.structuralScore.toFixed(1)}</div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div style={{ marginBottom: 20 }}>
            <button
              className="opp-more-analysis-toggle"
              onClick={() => setShowMoreAnalysis(!showMoreAnalysis)}
              aria-expanded={showMoreAnalysis}
            >
              <span>{showMoreAnalysis ? 'Hide' : 'Show'} More Analysis</span>
              <span style={{ fontSize: 16 }}>{showMoreAnalysis ? '−' : '+'}</span>
            </button>
          </div>

          {showMoreAnalysis && (
            <div className="opp-more-analysis">
              <div className="opp-tab-bar">
                <button className={`opp-tab${moreAnalysisTab === 'charts' ? ' active' : ''}`} onClick={() => setMoreAnalysisTab('charts')}>Charts</button>
                <button className={`opp-tab${moreAnalysisTab === 'ai' ? ' active' : ''}`} onClick={() => setMoreAnalysisTab('ai')}>AI Analyst</button>
                <button className={`opp-tab${moreAnalysisTab === 'data' ? ' active' : ''}`} onClick={() => setMoreAnalysisTab('data')}>Raw Data</button>
              </div>

              {moreAnalysisTab === 'charts' && (
                <div style={{ padding: 20 }}>
                  {(topConstraints.length > 0 || mostVolatile) && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <div className="opp-section-label">
                          Supporting Context
                        </div>
                      </div>
                      <div className="opp-driver-grid">
                        {topConstraints.slice(0, 2).map((c, i) => (
                          <div className="opp-driver-card" key={i}>
                            <div className="driver-label">Active Constraint</div>
                            <div className="driver-value">{c.name.length > 28 ? c.name.slice(0, 28) + '...' : c.name}</div>
                            <div className="driver-sub">{c.count} bindings · ${c.totalCost.toFixed(0)} cost</div>
                          </div>
                        ))}
                        {demandContext && (
                          <div className="opp-driver-card">
                            <div className="driver-label">System Load</div>
                            <div className="driver-value">{demandContext.peak.toLocaleString()} MW peak</div>
                            <div className="driver-sub">Avg {demandContext.avg.toLocaleString()} MW · ratio {(demandContext.peak / demandContext.avg).toFixed(2)}x</div>
                          </div>
                        )}
                        <div className="opp-driver-card">
                          <div className="driver-label">Highest Volatility</div>
                          <div className="driver-value">{mostVolatile?.zone || '—'}</div>
                          <div className="driver-sub">σ = {mostVolatile?.volatility.toFixed(1) || '—'} · {mostVolatile?.positiveSpreads || 0} events</div>
                        </div>
                        <div className="opp-driver-card">
                          <div className="driver-label">Zones Analyzed</div>
                          <div className="driver-value">{opportunities.length}</div>
                          <div className="driver-sub">{opportunities.filter(o => o.avgSpread > 5).length} with avg &gt; $5</div>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="grid-2">
                    <div className="chart-card">
                      <div className="chart-card-header">
                        <div className="chart-card-title">{role === 'trader' ? 'Spread Over Time' : 'DA vs RT Price'} — {active}</div>
                        <span className="chart-badge">{role === 'trader' ? 'Daily' : 'Hourly'}</span>
                      </div>
                      {role === 'trader' ? (
                        spreadOverTimeData.length > 0 ? (
                          <LineChart data={spreadOverTimeData} xKey="Date" yKeys={['Avg Spread', 'Max Spread']} height={260} />
                        ) : (
                          <div className="empty-state" style={{ padding: 48 }}>No spread data</div>
                        )
                      ) : (
                        chartData.length > 0 ? (
                          <LineChart data={chartData} xKey="Date" yKeys={['DA LMP', 'RT LMP']} height={260} />
                        ) : (
                          <div className="empty-state" style={{ padding: 48 }}>No price data</div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              )}

              {moreAnalysisTab === 'ai' && (
                <div className="ai-embed-section opp-embedded-section">
                  <div className="ai-embed-header">
                    <div>
                      <div className="ai-embed-title">AI Opportunity Analyst</div>
                      <div className="ai-embed-sub">Ask about {active} opportunity context</div>
                    </div>
                    <button
                      className="ai-btn ai-btn-primary"
                      onClick={() => handleAiExplain(`Explain the current opportunity state for ${active}. Why does it rank #${activeRank}? What are the key ${role === 'trader' ? 'trader' : 'battery strategy'} implications?`)}
                      disabled={aiLoading}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {aiLoading ? 'Analyzing...' : 'Explain Opportunity'}
                    </button>
                  </div>

                  <div className="ai-embed-body">
                    <div className="ai-embed-prompts">
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8 }}>
                        Quick Questions
                      </div>
                      {OPP_PROMPTS.map(sp => (
                        <button
                          key={sp.prompt}
                          className="suggested-prompt"
                          onClick={() => { setAiPrompt(sp.prompt); handleAiExplain(sp.prompt); }}
                          disabled={aiLoading}
                        >
                          <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--primary)', marginBottom: 2 }}>{sp.label}</div>
                          {sp.prompt}
                        </button>
                      ))}
                    </div>

                    <div className="ai-embed-main">
                      <div className="ai-embed-input-row">
                        <textarea
                          className="ai-page-textarea"
                          value={aiPrompt}
                          onChange={e => setAiPrompt(e.target.value)}
                          placeholder={`Ask about ${active} opportunity or strategy...`}
                          rows={3}
                          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleAiExplain(); }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button className="ai-btn ai-btn-primary" onClick={() => handleAiExplain()} disabled={aiLoading || !aiPrompt.trim()}>
                            {aiLoading ? 'Analyzing...' : 'Ask Analyst'}
                          </button>
                          <button className="ai-btn ai-btn-secondary" onClick={() => { setAiPrompt(''); setAiResponse(null); }}>
                            Clear
                          </button>
                          {aiLoading && <div className="spinner" style={{ width: 18, height: 18 }} />}
                        </div>
                      </div>

                      {aiResponse?.status === 'unconfigured' && (
                        <div className="ai-alert ai-alert-warning" style={{ marginTop: 16 }}>
                          AI Analyst requires an API key. Set <code>OPENAI_API_KEY</code> to enable.
                        </div>
                      )}

                      {aiResponse && aiResponse.status !== 'unconfigured' && (
                        <div className="ai-response-card" style={{ marginTop: 16 }}>
                          <div className="ai-response-header">
                            <span className="ai-response-label">Analyst — {active}</span>
                            {aiResponse.status === 'error' && <span className="badge" style={{ background: 'var(--danger)', color: '#fff', marginLeft: 8 }}>Error</span>}
                          </div>
                          <div className="ai-response-body">
                            {aiResponse.answer.split('\n').map((line, i) => (
                              <p key={i} style={{ margin: '0 0 8px' }}>{line}</p>
                            ))}
                          </div>
                          {aiResponse.trader_takeaways && aiResponse.trader_takeaways.length > 0 && (
                            <div className="ai-response-section">
                              <div className="ai-response-section-title">Trader Takeaways</div>
                              <ul className="ai-response-list">
                                {aiResponse.trader_takeaways.map((d, i) => <li key={i}>{d}</li>)}
                              </ul>
                            </div>
                          )}
                          {aiResponse.battery_takeaways && aiResponse.battery_takeaways.length > 0 && (
                            <div className="ai-response-section">
                              <div className="ai-response-section-title" style={{ color: 'var(--accent)' }}>Battery Takeaways</div>
                              <ul className="ai-response-list">
                                {aiResponse.battery_takeaways.map((d, i) => <li key={i} style={{ borderLeftColor: 'var(--accent)' }}>{d}</li>)}
                              </ul>
                            </div>
                          )}
                          {aiResponse.key_signals && aiResponse.key_signals.length > 0 && (
                            <div className="ai-response-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div className="ai-response-section-title" style={{ color: 'var(--text-muted)' }}>Key Signals</div>
                              <ul className="ai-response-list caveat">
                                {aiResponse.key_signals.map((s, i) => <li key={i}>{s}</li>)}
                              </ul>
                            </div>
                          )}
                          {aiResponse.caveats && aiResponse.caveats.length > 0 && (
                            <div className="ai-response-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                              <div className="ai-response-section-title" style={{ color: 'var(--text-muted)' }}>Caveats</div>
                              <ul className="ai-response-list caveat">
                                {aiResponse.caveats.map((c, i) => <li key={i}>{c}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {moreAnalysisTab === 'data' && (
                <div style={{ padding: 20 }}>
                  <div style={{ marginBottom: 12 }}>
                    <button
                      className="collapsible-header"
                      onClick={() => setShowRawTable(!showRawTable)}
                      aria-expanded={showRawTable}
                      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}
                    >
                      <span>All Zones ({opportunities.length})</span>
                      <span style={{ fontSize: 18 }}>{showRawTable ? '−' : '+'}</span>
                    </button>
                    {showRawTable && (
                      <div style={{ marginTop: 8, overflow: 'auto' }}>
                        <table className="rank-table" style={{ borderSpacing: 0, width: '100%' }}>
                          <thead>
                            <tr>
                              <th style={{ width: 50 }}>#</th>
                              <th>Zone</th>
                              <th>Avg Spread</th>
                              <th>Max Spread</th>
                              <th>Revenue</th>
                              <th>Events</th>
                              <th>Vol</th>
                              <th>Pos. Spreads</th>
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
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
