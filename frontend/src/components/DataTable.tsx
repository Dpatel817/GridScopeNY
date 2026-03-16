import { useState } from 'react'

interface Props {
  data: Record<string, unknown>[]
  columns?: string[]
  maxRows?: number
  hasMore?: boolean
  onLoadMore?: () => void
  loadingMore?: boolean
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number' && isNaN(v)) return '—'
  if (typeof v === 'string' && v.includes('T') && v.includes(':')) {
    try { return new Date(v).toLocaleString() } catch { return v }
  }
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return String(v)
}

export default function DataTable({ data, columns, maxRows = 500, hasMore, onLoadMore, loadingMore }: Props) {
  const [displayCount, setDisplayCount] = useState(maxRows)

  if (!data || !data.length) return <p style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No data</p>
  const cols = columns || Object.keys(data[0])
  const rows = data.slice(0, displayCount)
  const canShowMore = displayCount < data.length

  return (
    <div className="data-table-wrapper">
      <table>
        <thead>
          <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map(c => <td key={c}>{fmtCell(row[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span>Showing {Math.min(displayCount, data.length).toLocaleString()} of {data.length.toLocaleString()} loaded rows</span>
        {canShowMore && (
          <button
            onClick={() => setDisplayCount(prev => prev + maxRows)}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              background: 'var(--bg-tertiary, #2a2a3e)',
              color: 'var(--text-primary, #e0e0e0)',
              border: '1px solid var(--border-color, #3a3a5c)',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Show more rows
          </button>
        )}
        {hasMore && onLoadMore && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              background: 'var(--accent, #6366f1)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: loadingMore ? 'not-allowed' : 'pointer',
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? 'Loading...' : 'Load more from server'}
          </button>
        )}
      </div>
    </div>
  )
}
