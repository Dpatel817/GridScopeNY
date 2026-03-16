import { useState, useRef, useEffect } from 'react';
import { useDataset, useInventory } from '../hooks/useDataset';
import { isNyisoZone } from '../data/zones';

interface AIResponse {
  answer: string;
  trader_takeaways?: string[];
  battery_takeaways?: string[];
  key_signals?: string[];
  drivers?: string[];
  caveats?: string[];
  status: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  details?: AIResponse;
}

const PAGE_PROMPTS: Record<string, { label: string; prompt: string }[]> = {
  overview: [
    { label: 'Market snapshot', prompt: 'Give me a quick snapshot of the current NYISO market state.' },
    { label: 'Top signals', prompt: 'What are the top signals I should watch today?' },
  ],
  prices: [
    { label: 'Spread behavior', prompt: 'What is the trader takeaway from today\'s DA-RT spread behavior across NYISO zones?' },
    { label: 'Price dislocation', prompt: 'Are there any unusual price dislocations between upstate and downstate zones?' },
  ],
  demand: [
    { label: 'Forecast accuracy', prompt: 'How accurate has the load forecast been and what does that mean for trading?' },
    { label: 'Peak load outlook', prompt: 'What is the peak load outlook and how does it affect prices?' },
  ],
  generation: [
    { label: 'Fuel mix shifts', prompt: 'What fuel mix shifts are notable today and what do they mean for prices?' },
    { label: 'Renewable impact', prompt: 'How is renewable generation affecting the market today?' },
  ],
  interfaces: [
    { label: 'Flow constraints', prompt: 'Which interface flows look constrained and what are the price implications?' },
    { label: 'Import/export', prompt: 'What is the current import/export picture for NYISO?' },
  ],
  congestion: [
    { label: 'Binding constraints', prompt: 'Which constraints are most costly and what zones are affected?' },
    { label: 'Congestion outlook', prompt: 'Is congestion looking structural or event-driven right now?' },
  ],
  opportunities: [
    { label: 'Best battery zone', prompt: 'What is the best 2-hour battery zone right now and why?' },
    { label: 'Structural vs event', prompt: 'Does the top opportunity look structural or event-driven?' },
  ],
  interconnection: [
    { label: 'Queue trends', prompt: 'What are the notable trends in the interconnection queue?' },
    { label: 'Pipeline outlook', prompt: 'What does the generation pipeline look like for NYISO?' },
  ],
};

const GLOBAL_PROMPTS: { label: string; prompt: string }[] = [
  { label: 'Cross-market signals', prompt: 'What cross-market signals should I watch — spanning prices, congestion, demand, and generation?' },
  { label: 'Constraint impact', prompt: 'Which binding constraints are most impactful today and how are they affecting zonal prices?' },
  { label: 'Scarcity signals', prompt: 'Are there any scarcity signals from ancillary service prices or tight reserve conditions?' },
  { label: 'Full market brief', prompt: 'Give me a comprehensive market brief covering prices, demand, generation, congestion, and ancillary services.' },
];

export default function MarketAnalystWidget({ currentPage }: { currentPage: string }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: priceData } = useDataset('da_lbmp_zone', 'daily', undefined, undefined, 10000, 730);
  const { data: rtPriceData } = useDataset('rt_lbmp_zone', 'daily', undefined, undefined, 10000, 730);
  const { data: demandData } = useDataset('isolf', 'daily', undefined, undefined, 10000, 730);
  const { data: genData } = useDataset('rtfuelmix', 'daily', undefined, undefined, 10000, 730);
  const { data: congestionData } = useDataset('dam_limiting_constraints', 'daily', undefined, undefined, 10000, 730);
  const { data: damaspData } = useDataset('damasp', 'daily', undefined, undefined, 10000, 730);
  const { data: rtaspData } = useDataset('rtasp', 'daily', undefined, undefined, 10000, 730);
  const { data: flowData } = useDataset('external_limits_flows', 'daily', undefined, undefined, 10000, 730);
  const { data: demandActual } = useDataset('pal', 'daily', undefined, undefined, 10000, 730);
  const { inventory } = useInventory();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  const buildContext = () => {
    const ctx: Record<string, any> = {};
    ctx.current_page = currentPage;

    if (priceData?.data?.length) {
      const records = priceData.data.filter((r: any) => isNyisoZone(String(r.Zone)));
      const lmps = records.map((r: any) => Number(r.LMP)).filter(Boolean);
      if (lmps.length) {
        ctx.avg_da_lmp = `$${(lmps.reduce((a: number, b: number) => a + b, 0) / lmps.length).toFixed(2)}/MWh`;
        ctx.max_da_lmp = `$${Math.max(...lmps).toFixed(2)}/MWh`;
        ctx.min_da_lmp = `$${Math.min(...lmps).toFixed(2)}/MWh`;
      }

      const byZone: Record<string, number[]> = {};
      for (const r of records) {
        const z = String(r.Zone);
        if (!byZone[z]) byZone[z] = [];
        byZone[z].push(Number(r.LMP) || 0);
      }
      const zoneAvgs = Object.entries(byZone).map(([z, vals]) => ({
        zone: z, avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      })).sort((a, b) => b.avg - a.avg);
      if (zoneAvgs.length) {
        ctx.highest_price_zone = `${zoneAvgs[0].zone} ($${zoneAvgs[0].avg.toFixed(2)}/MWh)`;
        ctx.lowest_price_zone = `${zoneAvgs[zoneAvgs.length - 1].zone} ($${zoneAvgs[zoneAvgs.length - 1].avg.toFixed(2)}/MWh)`;
        ctx.zone_price_ranking = zoneAvgs.slice(0, 5).map(z => `${z.zone}: $${z.avg.toFixed(2)}`).join(', ');
      }

      if (rtPriceData?.data?.length) {
        const rtRecords = rtPriceData.data.filter((r: any) => isNyisoZone(String(r.Zone)));
        const rtLmps = rtRecords.map((r: any) => Number(r.LMP)).filter(Boolean);
        if (rtLmps.length) {
          ctx.avg_rt_lmp = `$${(rtLmps.reduce((a: number, b: number) => a + b, 0) / rtLmps.length).toFixed(2)}/MWh`;
          ctx.max_rt_lmp = `$${Math.max(...rtLmps).toFixed(2)}/MWh`;
        }
        const rtByZone: Record<string, number[]> = {};
        for (const r of rtRecords) {
          const z = String(r.Zone);
          if (!rtByZone[z]) rtByZone[z] = [];
          rtByZone[z].push(Number(r.LMP) || 0);
        }
        const spreadRanks = zoneAvgs.map(da => {
          const rtAvg = rtByZone[da.zone]
            ? rtByZone[da.zone].reduce((a, b) => a + b, 0) / rtByZone[da.zone].length : da.avg;
          return { zone: da.zone, spread: da.avg - rtAvg, absSpread: Math.abs(da.avg - rtAvg) };
        }).sort((a, b) => b.absSpread - a.absSpread);
        ctx.top_spread_zones = spreadRanks.slice(0, 3).map(s => `${s.zone}: $${s.spread.toFixed(2)} (DA-RT)`).join(', ');
        ctx.dart_spread_direction = spreadRanks[0]?.spread > 0 ? 'DA premium' : 'RT premium';
      }
    }

    if (demandData?.data?.length) {
      const nyiso = demandData.data.map((r: any) => Number(r.NYISO || 0)).filter(Boolean);
      if (nyiso.length) {
        ctx.peak_forecast_load = `${Math.max(...nyiso).toLocaleString()} MW`;
        ctx.min_forecast_load = `${Math.min(...nyiso).toLocaleString()} MW`;
        ctx.avg_forecast_load = `${Math.round(nyiso.reduce((a: number, b: number) => a + b, 0) / nyiso.length).toLocaleString()} MW`;
      }
    }

    if (demandActual?.data?.length) {
      const actuals = demandActual.data.map((r: any) => Number(r.NYISO || r['Actual Load'] || 0)).filter(Boolean);
      if (actuals.length) {
        ctx.peak_actual_load = `${Math.max(...actuals).toLocaleString()} MW`;
        if (demandData?.data?.length) {
          const forecasts = demandData.data.map((r: any) => Number(r.NYISO || 0)).filter(Boolean);
          if (forecasts.length) {
            const avgForecast = forecasts.reduce((a: number, b: number) => a + b, 0) / forecasts.length;
            const avgActual = actuals.reduce((a: number, b: number) => a + b, 0) / actuals.length;
            const errorPct = ((avgForecast - avgActual) / avgActual * 100);
            ctx.forecast_error = `${errorPct > 0 ? '+' : ''}${errorPct.toFixed(1)}% (${errorPct > 0 ? 'over-forecast' : 'under-forecast'})`;
          }
        }
      }
    }

    if (genData?.data?.length) {
      const fuels: Record<string, number> = {};
      for (const r of genData.data) {
        const fuel = String(r['Fuel Type'] || r['Fuel Category'] || '');
        const gen = Number(r['Generation MW'] || r['Gen MWh'] || 0);
        if (fuel && gen) fuels[fuel] = (fuels[fuel] || 0) + gen;
      }
      const total = Object.values(fuels).reduce((a, b) => a + b, 0);
      if (total > 0) {
        const sorted = Object.entries(fuels).sort((a, b) => b[1] - a[1]);
        ctx.generation_mix = sorted.slice(0, 5).map(([f, v]) => `${f}: ${((v / total) * 100).toFixed(1)}%`).join(', ');
        ctx.total_generation = `${Math.round(total).toLocaleString()} MW`;
        const renewables = ['Wind', 'Solar', 'Hydro'].reduce((s, f) => s + (fuels[f] || 0), 0);
        ctx.renewable_share = `${((renewables / total) * 100).toFixed(1)}%`;
      }
    }

    if (congestionData?.data?.length) {
      const constraints: Record<string, { totalCost: number; count: number; facilities: Set<string> }> = {};
      for (const r of congestionData.data) {
        const name = String(r['Limiting Facility'] || r['Constraint Name'] || '');
        const cost = Math.abs(Number(r['Constraint Cost'] || r['Shadow Price'] || 0));
        if (name && cost) {
          if (!constraints[name]) constraints[name] = { totalCost: 0, count: 0, facilities: new Set() };
          constraints[name].totalCost += cost;
          constraints[name].count++;
          const facility = String(r['Contingency Name'] || '');
          if (facility) constraints[name].facilities.add(facility);
        }
      }
      const sorted = Object.entries(constraints).sort((a, b) => b[1].totalCost - a[1].totalCost);
      if (sorted.length) {
        ctx.top_constraints = sorted.slice(0, 5).map(([n, v]) =>
          `${n}: $${v.totalCost.toFixed(0)} total (${v.count} intervals)`
        ).join('; ');
        ctx.total_congestion_cost = `$${sorted.reduce((s, [, v]) => s + v.totalCost, 0).toFixed(0)}`;
        ctx.binding_constraint_count = sorted.length;
        ctx.constraint_analysis = sorted.slice(0, 3).map(([n, v]) => ({
          name: n,
          total_cost: `$${v.totalCost.toFixed(0)}`,
          frequency: v.count,
          avg_shadow_price: `$${(v.totalCost / v.count).toFixed(2)}`,
        }));
      }
    }

    if (damaspData?.data?.length) {
      const products = ['10 Min Spin', '10 Min Non-Sync', '30 Min OR', 'Reg Cap'];
      const aspStats: Record<string, { max: number; avg: number; count: number }> = {};
      for (const r of damaspData.data) {
        for (const p of products) {
          const val = Number(r[p] || 0);
          if (val) {
            if (!aspStats[p]) aspStats[p] = { max: 0, avg: 0, count: 0 };
            aspStats[p].max = Math.max(aspStats[p].max, val);
            aspStats[p].avg += val;
            aspStats[p].count++;
          }
        }
      }
      const daAspSummary = Object.entries(aspStats)
        .filter(([, v]) => v.count > 0)
        .map(([p, v]) => `${p}: avg $${(v.avg / v.count).toFixed(2)}, max $${v.max.toFixed(2)}`)
        .join('; ');
      if (daAspSummary) ctx.da_ancillary_prices = daAspSummary;
    }

    if (rtaspData?.data?.length) {
      const products = ['10 Min Spin', '10 Min Non-Sync', '30 Min OR', 'Reg Cap'];
      const aspStats: Record<string, { max: number; avg: number; count: number }> = {};
      for (const r of rtaspData.data) {
        for (const p of products) {
          const val = Number(r[p] || 0);
          if (val) {
            if (!aspStats[p]) aspStats[p] = { max: 0, avg: 0, count: 0 };
            aspStats[p].max = Math.max(aspStats[p].max, val);
            aspStats[p].avg += val;
            aspStats[p].count++;
          }
        }
      }
      const rtAspSummary = Object.entries(aspStats)
        .filter(([, v]) => v.count > 0)
        .map(([p, v]) => `${p}: avg $${(v.avg / v.count).toFixed(2)}, max $${v.max.toFixed(2)}`)
        .join('; ');
      if (rtAspSummary) ctx.rt_ancillary_prices = rtAspSummary;

      const rtSpinMax = aspStats['10 Min Spin']?.max || 0;
      const rtRegMax = aspStats['Reg Cap']?.max || 0;
      if (rtSpinMax > 50 || rtRegMax > 50) {
        ctx.scarcity_signal = `Elevated RT ancillary prices detected — 10 Min Spin peak $${rtSpinMax.toFixed(2)}, Reg Cap peak $${rtRegMax.toFixed(2)}`;
      }
    }

    if (flowData?.data?.length) {
      const interfaces: Record<string, { flows: number[]; limits: number[] }> = {};
      for (const r of flowData.data) {
        const name = String(r['Interface Name'] || r['Point Name'] || '');
        const flow = Number(r['Flow MW'] || r['Flow (MW)'] || r['Power (MW)'] || 0);
        const limit = Number(r['Positive Limit'] || r['Limit (MW)'] || 0);
        if (name) {
          if (!interfaces[name]) interfaces[name] = { flows: [], limits: [] };
          interfaces[name].flows.push(flow);
          if (limit) interfaces[name].limits.push(limit);
        }
      }
      const flowSummary = Object.entries(interfaces)
        .filter(([, v]) => v.flows.length > 0)
        .map(([name, v]) => {
          const avgFlow = v.flows.reduce((a, b) => a + b, 0) / v.flows.length;
          const maxFlow = Math.max(...v.flows);
          const avgLimit = v.limits.length ? v.limits.reduce((a, b) => a + b, 0) / v.limits.length : 0;
          const utilization = avgLimit ? (avgFlow / avgLimit * 100) : 0;
          return { name, avgFlow, maxFlow, utilization };
        })
        .sort((a, b) => b.utilization - a.utilization);
      if (flowSummary.length) {
        ctx.interface_flows = flowSummary.slice(0, 5).map(f =>
          `${f.name}: avg ${Math.round(f.avgFlow)} MW, max ${Math.round(f.maxFlow)} MW${f.utilization ? `, ${f.utilization.toFixed(0)}% utilized` : ''}`
        ).join('; ');
        const constrained = flowSummary.filter(f => f.utilization > 80);
        if (constrained.length) {
          ctx.constrained_interfaces = constrained.map(f => `${f.name} (${f.utilization.toFixed(0)}%)`).join(', ');
        }
      }
    }

    if (inventory) {
      const available = Object.values(inventory).reduce((sum: number, page: any) =>
        sum + Object.values(page).filter((d: any) => d.status === 'available').length, 0);
      ctx.datasets_available = available;
    }

    return ctx;
  };

  async function handleSend(question?: string) {
    const q = question || prompt.trim();
    if (!q || loading) return;

    const userMsg: Message = { role: 'user', content: q };
    setMessages(prev => [...prev, userMsg]);
    setPrompt('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai-explainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, context: buildContext(), search_all_datasets: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.detail || 'Request failed', details: { answer: data.detail || 'Request failed', status: 'error' } }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.answer, details: data }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Request failed. Is the API server running?', details: { answer: 'Request failed.', status: 'error' } }]);
    } finally {
      setLoading(false);
    }
  }

  const pagePrompts = PAGE_PROMPTS[currentPage] || PAGE_PROMPTS.overview;
  const allPrompts = [...pagePrompts, ...GLOBAL_PROMPTS];

  return (
    <>
      <button
        className={`maw-fab${open ? ' maw-fab-hidden' : ''}`}
        onClick={() => setOpen(true)}
        title="AI Market Analyst"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {open && (
        <div className="maw-panel">
          <div className="maw-header">
            <div className="maw-header-title">
              <span className="maw-header-label">AI Market Analyst</span>
              <span className="maw-header-page">All Markets</span>
            </div>
            <div className="maw-header-actions">
              {messages.length > 0 && (
                <button className="maw-clear-btn" onClick={() => setMessages([])} title="Clear chat">
                  Clear
                </button>
              )}
              <button className="maw-close-btn" onClick={() => setOpen(false)} title="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>

          <div className="maw-messages">
            {messages.length === 0 && (
              <div className="maw-empty">
                <div className="maw-empty-title">Ask anything about the NYISO market</div>
                <div className="maw-empty-sub">Uses data from all pages — prices, demand, generation, congestion, flows, ancillary services</div>
                <div className="maw-quick-prompts">
                  {allPrompts.map(qp => (
                    <button key={qp.prompt} className="maw-quick-btn" onClick={() => handleSend(qp.prompt)} disabled={loading}>
                      {qp.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`maw-msg maw-msg-${msg.role}`}>
                <div className="maw-msg-content">
                  {msg.role === 'assistant' ? (
                    <>
                      {msg.content.split('\n').map((line, j) => (
                        <p key={j} style={{ margin: '0 0 6px' }}>{line}</p>
                      ))}
                      {msg.details?.trader_takeaways && msg.details.trader_takeaways.length > 0 && (
                        <div className="maw-section">
                          <div className="maw-section-title">Trader Takeaways</div>
                          <ul className="maw-list">
                            {msg.details.trader_takeaways.map((t, j) => <li key={j}>{t}</li>)}
                          </ul>
                        </div>
                      )}
                      {msg.details?.battery_takeaways && msg.details.battery_takeaways.length > 0 && (
                        <div className="maw-section">
                          <div className="maw-section-title accent">Battery Strategy</div>
                          <ul className="maw-list accent">
                            {msg.details.battery_takeaways.map((t, j) => <li key={j}>{t}</li>)}
                          </ul>
                        </div>
                      )}
                      {msg.details?.caveats && msg.details.caveats.length > 0 && (
                        <div className="maw-section">
                          <div className="maw-section-title muted">Caveats</div>
                          <ul className="maw-list muted">
                            {msg.details.caveats.map((c, j) => <li key={j}>{c}</li>)}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="maw-msg maw-msg-assistant">
                <div className="maw-msg-content maw-loading">
                  <div className="maw-dots"><span /><span /><span /></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {messages.length > 0 && (
            <div className="maw-suggestions">
              {allPrompts.slice(0, 4).map(qp => (
                <button key={qp.prompt} className="maw-suggest-btn" onClick={() => handleSend(qp.prompt)} disabled={loading}>
                  {qp.label}
                </button>
              ))}
            </div>
          )}

          <div className="maw-input-area">
            <textarea
              ref={textareaRef}
              className="maw-textarea"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Ask about prices, congestion, demand, generation, ancillary services..."
              rows={2}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              className="maw-send-btn"
              onClick={() => handleSend()}
              disabled={loading || !prompt.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
