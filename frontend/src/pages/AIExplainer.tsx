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
  const { data: demandData } = useDataset('isolf', 'daily')
  const { inventory } = useInventory()

  const marketContext = (() => {
    const ctx: Record<string, any> = {}

    if (priceData?.data?.length) {
      const records = priceData.data
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
      ctx['highest_price_zone'] = zoneAvgs[0]?.zone
      ctx['lowest_price_zone'] = zoneAvgs[zoneAvgs.length - 1]?.zone
    }

    if (demandData?.data?.length) {
      const records = demandData.data
      const nyiso = records.map((r: any) => Number(r.NYISO || 0)).filter(Boolean)
      ctx['peak_forecast_load'] = nyiso.length ? `${Math.max(...nyiso).toLocaleString()} MW` : null
      ctx['avg_forecast_load'] = nyiso.length ? `${Math.round(nyiso.reduce((a: number, b: number) => a + b, 0) / nyiso.length).toLocaleString()} MW` : null
    }

    if (inventory) {
      const available = Object.values(inventory).reduce((sum: number, page: any) =>
        sum + Object.values(page).filter((d: any) => d.status === 'available').length, 0)
      ctx['datasets_available'] = available
    }

    ctx['resolution'] = 'daily'
    ctx['current_page'] = 'AI Analyst'

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
            {marketContext.avg_da_lmp && <>Avg DA LMP is <strong>{marketContext.avg_da_lmp}</strong></>}
            {marketContext.max_da_lmp && <> (peak: <strong>{marketContext.max_da_lmp}</strong>)</>}
            {marketContext.zones_count && <> across <strong>{marketContext.zones_count} zones</strong></>}
            {marketContext.highest_price_zone && <>, highest in <strong>{marketContext.highest_price_zone}</strong></>}
            {marketContext.lowest_price_zone && <>, lowest in <strong>{marketContext.lowest_price_zone}</strong></>}.
            {marketContext.peak_forecast_load && <> Peak forecast load: <strong>{marketContext.peak_forecast_load}</strong>.</>}
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
