interface Props {
  data: Record<string, unknown>[]
  columns?: string[]
  maxRows?: number
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

export default function DataTable({ data, columns, maxRows = 100 }: Props) {
  if (!data || !data.length) return <p style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No data</p>
  const cols = columns || Object.keys(data[0])
  const rows = data.slice(0, maxRows)
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
      {data.length > maxRows && (
        <p style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
          Showing {maxRows.toLocaleString()} of {data.length.toLocaleString()} rows
        </p>
      )}
    </div>
  )
}
