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
    { label: 'Fuel type mix', prompt: 'How is the fuel type mix evolving in the queue?' },
  ],
};

export default function MarketAnalystWidget({ currentPage }: { currentPage: string }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: priceData } = useDataset('da_lbmp_zone', 'daily');
  const { data: rtPriceData } = useDataset('rt_lbmp_zone', 'daily');
  const { data: demandData } = useDataset('isolf', 'daily');
  const { data: genData } = useDataset('rtfuelmix', 'daily');
  const { data: congestionData } = useDataset('dam_limiting_constraints', 'daily');
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
      }

      if (rtPriceData?.data?.length) {
        const rtRecords = rtPriceData.data.filter((r: any) => isNyisoZone(String(r.Zone)));
        const rtByZone: Record<string, number[]> = {};
        for (const r of rtRecords) {
          const z = String(r.Zone);
          if (!rtByZone[z]) rtByZone[z] = [];
          rtByZone[z].push(Number(r.LMP) || 0);
        }
        const spreadRanks = zoneAvgs.map(da => {
          const rtAvg = rtByZone[da.zone]
            ? rtByZone[da.zone].reduce((a, b) => a + b, 0) / rtByZone[da.zone].length : da.avg;
          return { zone: da.zone, spread: Math.abs(da.avg - rtAvg) };
        }).sort((a, b) => b.spread - a.spread);
        ctx.top_spread_zones = spreadRanks.slice(0, 3).map(s => `${s.zone}: $${s.spread.toFixed(2)}`).join(', ');
      }
    }

    if (demandData?.data?.length) {
      const nyiso = demandData.data.map((r: any) => Number(r.NYISO || 0)).filter(Boolean);
      if (nyiso.length) ctx.peak_forecast_load = `${Math.max(...nyiso).toLocaleString()} MW`;
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
        ctx.generation_mix = sorted.slice(0, 4).map(([f, v]) => `${f}: ${((v / total) * 100).toFixed(1)}%`).join(', ');
      }
    }

    if (congestionData?.data?.length) {
      const constraints: Record<string, number> = {};
      for (const r of congestionData.data) {
        const name = String(r['Limiting Facility'] || r['Constraint Name'] || '');
        const cost = Math.abs(Number(r['Constraint Cost'] || r['Shadow Price'] || 0));
        if (name && cost) constraints[name] = (constraints[name] || 0) + cost;
      }
      const sorted = Object.entries(constraints).sort((a, b) => b[1] - a[1]);
      if (sorted.length) {
        ctx.top_constraints = sorted.slice(0, 3).map(([n, v]) => `${n} ($${v.toFixed(0)})`).join(', ');
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
        body: JSON.stringify({ question: q, context: buildContext() }),
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

  const quickPrompts = PAGE_PROMPTS[currentPage] || PAGE_PROMPTS.overview;

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
              <span className="maw-header-page">{currentPage}</span>
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
                <div className="maw-empty-sub">Context-aware based on the page you're viewing</div>
                <div className="maw-quick-prompts">
                  {quickPrompts.map(qp => (
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
              {quickPrompts.map(qp => (
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
              placeholder="Ask about the market..."
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
