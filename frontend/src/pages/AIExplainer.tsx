import { useState } from 'react'

const EXAMPLES = [
  'Why did Zone J prices separate from Zone G today?',
  'Explain what happens when the Linden constraint is binding.',
  'What causes high congestion costs at the UPNY/SENY interface?',
  'Why do off-peak prices sometimes go negative in NYISO?',
]

export default function AIExplainer() {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'ok' | 'error' | 'unconfigured' | null>(null)

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
    } catch (e) {
      setResponse('Request failed. Is the API server running?')
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>🤖 AI Explainer</h1>
        <p>Ask questions about NYISO market behavior — powered by GPT</p>
      </div>

      <div className="card">
        <div className="card-title">Ask a Question</div>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Why did Zone J prices separate from Zone G today?"
          rows={4}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleExplain() }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={handleExplain} disabled={loading || !prompt.trim()}>
            {loading ? '⏳ Explaining...' : '✨ Explain'}
          </button>
          <button className="btn btn-secondary" onClick={() => { setPrompt(''); setResponse(''); setStatus(null) }}>
            Clear
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Example Questions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              className="btn btn-secondary"
              style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: 13 }}
              onClick={() => setPrompt(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {status === 'unconfigured' && (
        <div className="alert alert-warning">
          AI Explainer is not configured. Set the <code>OPENAI_API_KEY</code> environment variable to enable this feature.
        </div>
      )}

      {response && status !== 'unconfigured' && (
        <div className="card">
          <div className="card-title">Response</div>
          <div className="response-box">{response}</div>
        </div>
      )}

      {status === 'unconfigured' && response && (
        <div className="card">
          <div className="card-title">Response</div>
          <div className="response-box">{response}</div>
        </div>
      )}
    </div>
  )
}
