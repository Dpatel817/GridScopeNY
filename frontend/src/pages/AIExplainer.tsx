import { useState } from 'react'
import { useDataset, useInventory } from '../hooks/useDataset'
import { isNyisoZone } from '../data/zones'

const TRADER_PROMPTS = [
  { label: 'Spread Behavior', prompt: 'What is the trader takeaway from today\'s DA-RT spread behavior across NYISO zones?' },
  { label: 'Congestion Sensitivity', prompt: 'Which zones look most congestion-sensitive today?' },
  { label: 'RT Arbitrage', prompt: 'Is this more of a real-time arbitrage story or a structural value story?' },
  { label: 'Price Dislocation', prompt: 'Are there any unusual price dislocations between upstate and downstate zones?' },
]

const BATTERY_PROMPTS = [
  { label: 'Best Battery Zone', prompt: 'What is the best 2-hour battery zone right now and why?' },
  { label: 'Structural vs Event', prompt: 'Does this opportunity look structural or event-driven?' },
  { label: 'Dashboard Evidence', prompt: 'What dashboard evidence supports the top battery opportunity?' },
  { label: 'Duration Strategy', prompt: 'Should I position for 1-hour or 4-hour battery duration in the current market?' },
]

interface AIResponse {
  answer: string;
  trader_takeaways?: string[];
  battery_takeaways?: string[];
  key_signals?: string[];
  drivers?: string[];
  caveats?: string[];
  status: string;
}

export default function AIExplainer() {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState<AIResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: priceData } = useDataset('da_lbmp_zone', 'daily')
  const { data: rtPriceData } = useDataset('rt_lbmp_zone', 'daily')
  const { data: demandData } = useDataset('isolf', 'daily')
  const { data: genData } = useDataset('rtfuelmix', 'daily')
  const { data: congestionData } = useDataset('dam_limiting_constraints', 'daily')
  const { data: rtEventsData } = useDataset('rt_events', 'raw')
  const { data: operData } = useDataset('oper_messages', 'raw')
  const { inventory } = useInventory()

  const marketContext = (() => {
    const ctx: Record<string, any> = {}

    if (priceData?.data?.length) {
      const records = priceData.data.filter((r: any) => isNyisoZone(String(r.Zone)))
      const lmps = records.map((r: any) => Number(r.LMP)).filter(Boolean)
      const zones = [...new Set(records.map((r: any) => String(r.Zone)))]
      ctx['avg_da_lmp'] = lmps.length ? `$${(lmps.reduce((a: number, b: number) => a + b, 0) / lmps.length).toFixed(2)}/MWh` : null
      ctx['max_da_lmp'] = lmps.length ? `$${Math.max(...lmps).toFixed(2)}/MWh` : null
      ctx['zones_count'] = zones.length

      const byZone: Record<string, number[]> = {}
      for (const r of records) {
        const z = String(r.Zone)
        if (!byZone[z]) byZone[z] = []
        byZone[z].push(Number(r.LMP) || 0)
      }
      const zoneAvgs = Object.entries(byZone).map(([z, vals]) => ({
        zone: z,
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      })).sort((a, b) => b.avg - a.avg)
      ctx['highest_price_zone'] = `${zoneAvgs[0]?.zone} ($${zoneAvgs[0]?.avg.toFixed(2)}/MWh)`
      ctx['lowest_price_zone'] = `${zoneAvgs[zoneAvgs.length - 1]?.zone} ($${zoneAvgs[zoneAvgs.length - 1]?.avg.toFixed(2)}/MWh)`

      const top3 = zoneAvgs.slice(0, 3).map(z => `${z.zone}: $${z.avg.toFixed(2)}`).join(', ')
      const bot3 = zoneAvgs.slice(-3).map(z => `${z.zone}: $${z.avg.toFixed(2)}`).join(', ')
      ctx['zone_price_ranking'] = `Top: ${top3}. Bottom: ${bot3}`

      if (rtPriceData?.data?.length) {
        const rtRecords = rtPriceData.data.filter((r: any) => isNyisoZone(String(r.Zone)))
        const rtLmps = rtRecords.map((r: any) => Number(r.LMP)).filter(Boolean)
        ctx['avg_rt_lmp'] = rtLmps.length ? `$${(rtLmps.reduce((a: number, b: number) => a + b, 0) / rtLmps.length).toFixed(2)}/MWh` : null

        const rtByZone: Record<string, number[]> = {}
        for (const r of rtRecords) {
          const z = String(r.Zone)
          if (!rtByZone[z]) rtByZone[z] = []
          rtByZone[z].push(Number(r.LMP) || 0)
        }
        const spreadRanks = zoneAvgs.map(da => {
          const rtAvg = rtByZone[da.zone]
            ? rtByZone[da.zone].reduce((a, b) => a + b, 0) / rtByZone[da.zone].length : da.avg
          return { zone: da.zone, spread: Math.abs(da.avg - rtAvg) }
        }).sort((a, b) => b.spread - a.spread)
        ctx['spread_rankings'] = spreadRanks.slice(0, 5).map(s => `${s.zone}: $${s.spread.toFixed(2)}`).join(', ')
        ctx['top_battery_zone'] = spreadRanks[0]?.zone
        ctx['battery_revenue'] = `$${(spreadRanks[0]?.spread * 2).toFixed(2)}/MW (2h est.)`
      }
    }

    if (demandData?.data?.length) {
      const records = demandData.data
      const nyiso = records.map((r: any) => Number(r.NYISO || 0)).filter(Boolean)
      ctx['peak_forecast_load'] = nyiso.length ? `${Math.max(...nyiso).toLocaleString()} MW` : null
      ctx['avg_forecast_load'] = nyiso.length ? `${Math.round(nyiso.reduce((a: number, b: number) => a + b, 0) / nyiso.length).toLocaleString()} MW` : null
    }

    if (genData?.data?.length) {
      const records = genData.data
      const fuels: Record<string, number> = {}
      for (const r of records) {
        const fuel = String(r['Fuel Type'] || r['Fuel Category'] || '')
        const gen = Number(r['Generation MW'] || r['Gen MWh'] || 0)
        if (fuel && gen) fuels[fuel] = (fuels[fuel] || 0) + gen
      }
      const total = Object.values(fuels).reduce((a, b) => a + b, 0)
      if (total > 0) {
        const sorted = Object.entries(fuels).sort((a, b) => b[1] - a[1])
        ctx['generation_mix'] = sorted.slice(0, 5).map(([f, v]) => `${f}: ${((v/total)*100).toFixed(1)}%`).join(', ')
      }
    }

    if (congestionData?.data?.length) {
      const constraints: Record<string, number> = {}
      for (const r of congestionData.data) {
        const name = String(r['Limiting Facility'] || r['Constraint Name'] || '')
        const cost = Math.abs(Number(r['Constraint Cost'] || r['Shadow Price'] || 0))
        if (name && cost) constraints[name] = (constraints[name] || 0) + cost
      }
      const sorted = Object.entries(constraints).sort((a, b) => b[1] - a[1])
      if (sorted.length > 0) {
        ctx['top_congested_constraints'] = sorted.slice(0, 3).map(([n, v]) => `${n} ($${v.toFixed(0)})`).join(', ')
      }
    }

    if (rtEventsData?.data?.length) {
      const notable = rtEventsData.data
        .filter((r: any) => !String(r.Message || '').startsWith('Start of day'))
        .slice(-5)
        .map((r: any) => `${r['Time Stamp']?.slice(5, 16) || ''}: ${r.Message}`)
      if (notable.length > 0) ctx['rt_events'] = notable.join('; ')
    }

    if (operData?.data?.length) {
      const msgs = [...new Set(operData.data.map((r: any) => `${r['Message Type']}: ${r.Message}`))].slice(0, 3)
      if (msgs.length > 0) ctx['oper_messages'] = msgs.join('; ')
    }

    if (inventory) {
      const available = Object.values(inventory).reduce((sum: number, page: any) =>
        sum + Object.values(page).filter((d: any) => d.status === 'available').length, 0)
      ctx['datasets_available'] = available
    }

    return ctx
  })()

  async function handleExplain(question?: string) {
    const q = question || prompt.trim()
    if (!q) return
    setLoading(true)
    setResponse(null)
    try {
      const res = await fetch('/api/ai-explainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, context: marketContext }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResponse({ answer: data.detail || 'Request failed', status: 'error' })
      } else {
        setResponse(data)
      }
    } catch {
      setResponse({ answer: 'Request failed. Is the API server running?', status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const contextItems = [
    marketContext.avg_da_lmp && `DA LMP avg: ${marketContext.avg_da_lmp}`,
    marketContext.avg_rt_lmp && `RT LMP avg: ${marketContext.avg_rt_lmp}`,
    marketContext.spread_rankings && `Top spreads: ${marketContext.spread_rankings}`,
    marketContext.top_battery_zone && `Top battery zone: ${marketContext.top_battery_zone} (${marketContext.battery_revenue})`,
    marketContext.top_congested_constraints && `Constraints: ${marketContext.top_congested_constraints}`,
    marketContext.peak_forecast_load && `Peak load: ${marketContext.peak_forecast_load}`,
    marketContext.generation_mix && `Gen mix: ${marketContext.generation_mix}`,
  ].filter(Boolean)

  return (
    <div className="page">
      <div className="page-header">
        <h1>AI Market Analyst</h1>
        <p className="page-subtitle">
          Ask zone-based NYISO questions and get trader and battery-strategy insights grounded in current dashboard data.
        </p>
      </div>

      {contextItems.length > 0 && (
        <div className="insight-card" style={{ marginBottom: 24 }}>
          <div className="insight-title">Current Market Context (Zones A-K)</div>
          <div className="insight-body" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {contextItems.map((item, i) => (
              <span key={i} style={{ fontSize: 13 }}>{item}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <div className="ai-page-card">
          <div className="ai-page-card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Ask a Question</span>
            <button
              className="ai-btn ai-btn-primary"
              onClick={() => handleExplain('Explain the current top opportunity across NYISO zones. Which zone leads, why, and what are the trader and battery strategy implications?')}
              disabled={loading}
              style={{ fontSize: 12 }}
            >
              {loading ? 'Analyzing...' : 'Explain Current Opportunity'}
            </button>
          </div>
          <textarea
            className="ai-page-textarea"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="What is the best battery zone right now and why?"
            rows={3}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleExplain() }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="ai-btn ai-btn-primary" onClick={() => handleExplain()} disabled={loading || !prompt.trim()}>
              {loading ? 'Analyzing...' : 'Ask Analyst'}
            </button>
            <button className="ai-btn ai-btn-secondary" onClick={() => { setPrompt(''); setResponse(null) }}>
              Clear
            </button>
            {loading && <div className="spinner" style={{ width: 18, height: 18 }} />}
          </div>
        </div>
      </div>

      {response?.status === 'unconfigured' && (
        <div className="ai-alert ai-alert-warning" style={{ marginBottom: 20 }}>
          AI Analyst requires an API key. Set the <code>OPENAI_API_KEY</code> environment variable to enable this feature.
        </div>
      )}

      {response && response.status !== 'unconfigured' && (
        <div className="ai-response-card" style={{ marginBottom: 24 }}>
          <div className="ai-response-header">
            <span className="ai-response-icon">📊</span>
            <span className="ai-response-label">Analyst Note</span>
            {response.status === 'error' && <span className="badge" style={{ background: 'var(--danger)', color: '#fff', marginLeft: 8 }}>Error</span>}
          </div>
          <div className="ai-response-body">
            {response.answer.split('\n').map((line, i) => (
              <p key={i} style={{ margin: '0 0 8px' }}>{line}</p>
            ))}
          </div>
          {response.trader_takeaways && response.trader_takeaways.length > 0 && (
            <div className="ai-response-section">
              <div className="ai-response-section-title">Trader Takeaways</div>
              <ul className="ai-response-list">
                {response.trader_takeaways.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
          {response.battery_takeaways && response.battery_takeaways.length > 0 && (
            <div className="ai-response-section">
              <div className="ai-response-section-title" style={{ color: 'var(--accent)' }}>Battery Strategist Takeaways</div>
              <ul className="ai-response-list" style={{ '--accent-color': 'var(--accent)' } as any}>
                {response.battery_takeaways.map((d, i) => <li key={i} style={{ borderLeftColor: 'var(--accent)' }}>{d}</li>)}
              </ul>
            </div>
          )}
          {response.key_signals && response.key_signals.length > 0 && (
            <div className="ai-response-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="ai-response-section-title" style={{ color: 'var(--text-muted)' }}>Key Supporting Signals</div>
              <ul className="ai-response-list caveat">
                {response.key_signals.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {response.caveats && response.caveats.length > 0 && (
            <div className="ai-response-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="ai-response-section-title" style={{ color: 'var(--text-muted)' }}>Caveat</div>
              <ul className="ai-response-list caveat">
                {response.caveats.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid-2" style={{ gap: 20 }}>
        <div className="ai-page-card">
          <div className="ai-page-card-title" style={{ color: 'var(--primary)' }}>📈 Trader Questions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {TRADER_PROMPTS.map(sp => (
              <button
                key={sp.prompt}
                className="suggested-prompt"
                onClick={() => { setPrompt(sp.prompt); handleExplain(sp.prompt) }}
                disabled={loading}
              >
                <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--primary)', marginBottom: 2 }}>{sp.label}</div>
                {sp.prompt}
              </button>
            ))}
          </div>
        </div>
        <div className="ai-page-card">
          <div className="ai-page-card-title" style={{ color: 'var(--accent)' }}>🔋 Battery Strategist Questions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BATTERY_PROMPTS.map(sp => (
              <button
                key={sp.prompt}
                className="suggested-prompt"
                onClick={() => { setPrompt(sp.prompt); handleExplain(sp.prompt) }}
                disabled={loading}
              >
                <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--accent)', marginBottom: 2 }}>{sp.label}</div>
                {sp.prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
