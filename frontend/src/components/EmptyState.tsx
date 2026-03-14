import { useState } from 'react'

interface Props {
  message?: string
  showEtlButton?: boolean
}

export default function EmptyState({ message, showEtlButton = true }: Props) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function runEtl() {
    setRunning(true)
    setResult(null)
    try {
      await fetch('/api/etl/fetch', { method: 'POST' })
      await fetch('/api/etl/process', { method: 'POST' })
      setResult('ETL complete. Refresh the page to see data.')
    } catch {
      setResult('ETL failed. Check the server logs.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="empty-state">
      <div className="empty-icon">📭</div>
      <h3>No data available</h3>
      <p>{message || 'No processed data found for this dataset.'}</p>
      {showEtlButton && (
        <>
          <p style={{ marginBottom: 16 }}>
            Run the ETL to fetch the latest NYISO market data.
          </p>
          <button className="btn btn-primary" onClick={runEtl} disabled={running}>
            {running ? '⏳ Running ETL...' : '▶ Fetch & Process Data'}
          </button>
          {result && (
            <div className={`alert alert-${result.includes('complete') ? 'success' : 'danger'}`} style={{ marginTop: 12, textAlign: 'left' }}>
              {result}
            </div>
          )}
        </>
      )}
    </div>
  )
}
