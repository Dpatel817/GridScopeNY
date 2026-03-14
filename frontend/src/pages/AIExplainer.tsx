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

export default function AIExplainer() {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'ok' | 'error' | 'unconfigured' | null>(null)

  const { data: priceData } = useDataset('da_lbmp_zone', 'daily')
  const { inventory } = useInventory()

  const marketContext = (() => {
    if (!priceData?.data?.length) return null
    const records = priceData.data
    const lmps = records.map((r: any) => Number(r.LMP)).filter(Boolean)
    const avgLmp = lmps.length ? lmps.reduce((a: number, b: number) => a + b, 0) / lmps.length : 0
    const maxLmp = lmps.length ? Math.max(...lmps) : 0
    const zones = [...new Set(records.map((r: any) => String(r.Zone)))]
    const datasetCount = inventory
      ? Object.values(inventory).reduce((sum: number, page: any) =>
          sum + Object.values(page).filter((d: any) => d.status === 'available').length, 0)
      : 0
    return { avgLmp, maxLmp, zones, datasetCount }
  })()

  async function handleExplain() {
    if (!prompt.trim()) return
    setLoading(true)
    setResponse('')
    setStatus(null)
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      })
      const data = await res.json()
      setResponse(data.response || data.detail || 'No response')
      setStatus(data.status || 'ok')
    } catch {
      setResponse('Request failed. Is the API server running?')
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>AI Market Analyst</h1>
        <p className="page-subtitle">
          Ask questions about NYISO market behavior — your AI-powered energy analyst
        </p>
      </div>

      {marketContext && (
        <div className="insight-card" style={{ marginBottom: 24 }}>
          <div className="insight-title">Current Market Context</div>
          <div className="insight-body">
            Avg DA LMP is <strong>${marketContext.avgLmp.toFixed(2)}/MWh</strong> across {marketContext.zones.length} zones
            (peak: ${marketContext.maxLmp.toFixed(2)}/MWh).
            {marketContext.datasetCount > 0 && <> {marketContext.datasetCount} datasets are loaded and available for analysis.</>}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ gap: 24, alignItems: 'start' }}>
        <div>
          <div className="card">
            <div className="card-title">Ask a Question</div>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="What drove high prices in Zone J this week?"
              rows={4}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleExplain() }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={handleExplain} disabled={loading || !prompt.trim()}>
                {loading ? 'Analyzing...' : 'Ask Analyst'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setPrompt(''); setResponse(''); setStatus(null) }}>
                Clear
              </button>
            </div>
          </div>

          {status === 'unconfigured' && (
            <div className="alert alert-warning">
              AI Analyst requires an API key. Set the <code>OPENAI_API_KEY</code> environment variable to enable this feature.
            </div>
          )}

          {response && (
            <div className="card">
              <div className="card-title">Analysis</div>
              <div className="response-box">{response}</div>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="card-title">Suggested Questions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SUGGESTED_PROMPTS.map(sp => (
                <button
                  key={sp.prompt}
                  className="suggested-prompt"
                  onClick={() => setPrompt(sp.prompt)}
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
