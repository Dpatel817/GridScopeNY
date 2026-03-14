import { useState } from 'react'
import { useDataset, useInventory } from '../hooks/useDataset'

const SUGGESTED_PROMPTS = [
  { label: 'Price Separation', prompt: 'Why did Zone J prices separate from Zone G today?' },
  { label: 'Congestion Impact', prompt: 'Explain what happens when the Linden constraint is binding.' },
  { label: 'Interface Pressure', prompt: 'What causes high congestion costs at the UPNY/SENY interface?' },
  { label: 'Negative Prices', prompt: 'Why do off-peak prices sometimes go negative in NYISO?' },
  { label: 'Battery Strategy', prompt: 'What zones are best for 2-hour battery arbitrage in NYISO and why?' },
  { label: 'Demand Response', prompt: 'How does summer peak demand affect real-time prices in downstate NY?' },
]

interface AIResponse {
  answer: string;
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
  const { data: interfaceData } = useDataset('dam_imer', 'daily')
  const { inventory } = useInventory()

  const marketContext = (() => {
    const ctx: Record<string, any> = {}

    if (priceData?.data?.length) {
      const records = priceData.data
      const lmps = records.map((r: any) => Number(r.LMP)).filter(Boolean)
      const zones = [...new Set(records.map((r: any) => String(r.Zone)))]
      ctx['avg_da_lmp'] = lmps.length ? `$${(lmps.reduce((a: number, b: number) => a + b, 0) / lmps.length).toFixed(2)}/MWh` : null
      ctx['max_da_lmp'] = lmps.length ? `$${Math.max(...lmps).toFixed(2)}/MWh` : null
      ctx['min_da_lmp'] = lmps.length ? `$${Math.min(...lmps).toFixed(2)}/MWh` : null
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
    }

    if (rtPriceData?.data?.length) {
      const rtRecords = rtPriceData.data
      const rtLmps = rtRecords.map((r: any) => Number(r.LMP)).filter(Boolean)
      ctx['avg_rt_lmp'] = rtLmps.length ? `$${(rtLmps.reduce((a: number, b: number) => a + b, 0) / rtLmps.length).toFixed(2)}/MWh` : null

      if (priceData?.data?.length) {
        const daAvg = Number(ctx['avg_da_lmp']?.replace(/[^0-9.-]/g, '')) || 0
        const rtAvg = rtLmps.reduce((a: number, b: number) => a + b, 0) / rtLmps.length
        const spread = daAvg - rtAvg
        ctx['da_rt_spread'] = `$${spread.toFixed(2)}/MWh (DA ${spread > 0 ? 'premium' : 'discount'})`
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
        if (fuel && gen) {
          fuels[fuel] = (fuels[fuel] || 0) + gen
        }
      }
      const total = Object.values(fuels).reduce((a, b) => a + b, 0)
      if (total > 0) {
        const sorted = Object.entries(fuels).sort((a, b) => b[1] - a[1])
        ctx['generation_mix'] = sorted.slice(0, 5).map(([f, v]) => `${f}: ${((v/total)*100).toFixed(1)}%`).join(', ')
      }
    }

    if (congestionData?.data?.length) {
      const records = congestionData.data
      const constraints: Record<string, number> = {}
      for (const r of records) {
        const name = String(r['Limiting Facility'] || r['Constraint Name'] || '')
        const cost = Math.abs(Number(r['Constraint Cost'] || r['Shadow Price'] || 0))
        if (name && cost) {
          constraints[name] = (constraints[name] || 0) + cost
        }
      }
      const sorted = Object.entries(constraints).sort((a, b) => b[1] - a[1])
      if (sorted.length > 0) {
        ctx['top_congested_constraints'] = sorted.slice(0, 3).map(([n, v]) => `${n} ($${v.toFixed(0)})`).join(', ')
      }
    }

    if (interfaceData?.data?.length) {
      const records = interfaceData.data
      const zoneImers: Record<string, number[]> = {}
      for (const r of records) {
        const zone = String(r['Zone'] || '')
        const lmp = Number(r['LMP'] || 0)
        if (zone && lmp) {
          if (!zoneImers[zone]) zoneImers[zone] = []
          zoneImers[zone].push(lmp)
        }
      }
      const avgImers = Object.entries(zoneImers).map(([z, vals]) => ({
        zone: z,
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      })).sort((a, b) => b.avg - a.avg)
      if (avgImers.length > 0) {
        ctx['imer_price_summary'] = avgImers.slice(0, 3).map(f => `${f.zone}: $${f.avg.toFixed(2)}/MWh`).join(', ')
      }
    }

    if (inventory) {
      const available = Object.values(inventory).reduce((sum: number, page: any) =>
        sum + Object.values(page).filter((d: any) => d.status === 'available').length, 0)
      ctx['datasets_available'] = available
    }

    return ctx
  })()

  async function handleExplain() {
    if (!prompt.trim()) return
    setLoading(true)
    setResponse(null)
    try {
      const res = await fetch('/api/ai-explainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: prompt.trim(),
          context: marketContext,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResponse({ answer: data.detail || 'Request failed', status: 'error', drivers: [], caveats: [] })
      } else {
        setResponse(data)
      }
    } catch {
      setResponse({ answer: 'Request failed. Is the API server running?', status: 'error', drivers: [], caveats: [] })
    } finally {
      setLoading(false)
    }
  }

  function handleSuggested(p: string) {
    setPrompt(p)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>AI Market Analyst</h1>
        <p className="page-subtitle">
          Ask questions about NYISO market behavior — grounded in your current dashboard data
        </p>
      </div>

      {Object.keys(marketContext).length > 0 && (
        <div className="insight-card" style={{ marginBottom: 24 }}>
          <div className="insight-title">Current Market Context</div>
          <div className="insight-body">
            {marketContext.avg_da_lmp && <>DA LMP: <strong>{marketContext.avg_da_lmp}</strong> avg</>}
            {marketContext.max_da_lmp && <> (peak: <strong>{marketContext.max_da_lmp}</strong>)</>}
            {marketContext.avg_rt_lmp && <> | RT LMP: <strong>{marketContext.avg_rt_lmp}</strong> avg</>}
            {marketContext.da_rt_spread && <> | Spread: <strong>{marketContext.da_rt_spread}</strong></>}
            {marketContext.zones_count && <> across <strong>{marketContext.zones_count} zones</strong></>}.
            {marketContext.highest_price_zone && <> Highest: <strong>{marketContext.highest_price_zone}</strong></>}
            {marketContext.lowest_price_zone && <>, lowest: <strong>{marketContext.lowest_price_zone}</strong>.</>}
            {marketContext.peak_forecast_load && <> Peak load: <strong>{marketContext.peak_forecast_load}</strong>.</>}
            {marketContext.generation_mix && <> Gen mix: <strong>{marketContext.generation_mix}</strong>.</>}
            {marketContext.top_congested_constraints && <> Top constraints: <strong>{marketContext.top_congested_constraints}</strong>.</>}
            {marketContext.imer_price_summary && <> IMER: <strong>{marketContext.imer_price_summary}</strong>.</>}
            {marketContext.datasets_available && <> {marketContext.datasets_available} datasets loaded.</>}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ gap: 24, alignItems: 'start' }}>
        <div>
          <div className="ai-page-card">
            <div className="ai-page-card-title">Ask a Question</div>
            <textarea
              className="ai-page-textarea"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="What drove high prices in Zone J this week?"
              rows={4}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleExplain() }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <button className="ai-btn ai-btn-primary" onClick={handleExplain} disabled={loading || !prompt.trim()}>
                {loading ? 'Analyzing...' : 'Ask Analyst'}
              </button>
              <button className="ai-btn ai-btn-secondary" onClick={() => { setPrompt(''); setResponse(null) }}>
                Clear
              </button>
              {loading && <div className="spinner" style={{ width: 18, height: 18 }} />}
            </div>
          </div>

          {response?.status === 'unconfigured' && (
            <div className="ai-alert ai-alert-warning" style={{ marginTop: 16 }}>
              AI Analyst requires an API key. Set the <code>OPENAI_API_KEY</code> environment variable to enable this feature.
            </div>
          )}

          {response && response.status !== 'unconfigured' && (
            <div className="ai-response-card" style={{ marginTop: 16 }}>
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
              {response.drivers && response.drivers.length > 0 && (
                <div className="ai-response-section">
                  <div className="ai-response-section-title">Likely Drivers</div>
                  <ul className="ai-response-list">
                    {response.drivers.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
              )}
              {response.caveats && response.caveats.length > 0 && (
                <div className="ai-response-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div className="ai-response-section-title" style={{ color: 'var(--text-muted)' }}>Caveats</div>
                  <ul className="ai-response-list caveat">
                    {response.caveats.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="ai-page-card">
            <div className="ai-page-card-title">Suggested Questions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SUGGESTED_PROMPTS.map(sp => (
                <button
                  key={sp.prompt}
                  className="suggested-prompt"
                  onClick={() => handleSuggested(sp.prompt)}
                >
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--primary)', marginBottom: 2 }}>{sp.label}</div>
                  {sp.prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
