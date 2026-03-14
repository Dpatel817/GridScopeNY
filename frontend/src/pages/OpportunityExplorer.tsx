import { useState, useMemo } from 'react'
import { useDataset } from '../hooks/useDataset'
import DataTable from '../components/DataTable'
import EmptyState from '../components/EmptyState'
import MetricsRow, { buildMetrics } from '../components/MetricsRow'

const DATASETS = [
  { key: 'da_lbmp_zone', cat: 'prices', label: 'DA LBMP — Zonal', scoreCol: 'LMP' },
  { key: 'rt_lbmp_zone', cat: 'prices', label: 'RT LBMP — Zonal', scoreCol: 'LMP' },
  { key: 'da_lbmp_gen',  cat: 'prices', label: 'DA LBMP — Generator', scoreCol: 'LMP' },
  { key: 'damasp',       cat: 'prices', label: 'DA Ancillary Prices', scoreCol: '10 Min Spin' },
  { key: 'dam_limiting_constraints', cat: 'congestion', label: 'DA Limiting Constraints', scoreCol: 'Constraint Cost' },
]

export default function OpportunityExplorer() {
  const [dsIdx, setDsIdx] = useState(0)
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [topN, setTopN] = useState(50)
  const ds = DATASETS[dsIdx]
  const { data: result, loading } = useDataset(ds.cat, ds.key, 10000)
  const rows = result?.data ?? []

  const ranked = useMemo(() => {
    if (!rows.length) return []
    const scoreCol = ds.scoreCol
    const scored = rows
      .map(r => ({ ...r, _score: Number(r[scoreCol] ?? 0) }))
      .filter(r => !isNaN(r._score))
      .sort((a, b) => sort === 'desc' ? b._score - a._score : a._score - b._score)
    return scored.slice(0, topN)
  }, [rows, ds, sort, topN])

  const metrics = useMemo(() => buildMetrics(rows, ds.scoreCol), [rows, ds])

  return (
    <div className="page">
      <div className="page-header">
        <h1>🔎 Opportunity Explorer</h1>
        <p>Rank and surface market opportunities by price, spread, or constraint cost</p>
      </div>

      <div className="controls">
        <div className="control-group">
          <label>Dataset</label>
          <select value={dsIdx} onChange={e => setDsIdx(Number(e.target.value))}>
            {DATASETS.map((d, i) => <option key={i} value={i}>{d.label}</option>)}
          </select>
        </div>
        <div className="control-group">
          <label>Sort</label>
          <select value={sort} onChange={e => setSort(e.target.value as 'desc' | 'asc')}>
            <option value="desc">Highest first</option>
            <option value="asc">Lowest first</option>
          </select>
        </div>
        <div className="control-group">
          <label>Top N</label>
          <select value={topN} onChange={e => setTopN(Number(e.target.value))}>
            {[20, 50, 100, 250].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading...</div>}
      {!loading && !rows.length && <EmptyState />}

      {!loading && rows.length > 0 && (
        <>
          <MetricsRow metrics={metrics} />
          <div className="card">
            <div className="card-title">
              Top {topN} rows — ranked by <strong>{ds.scoreCol}</strong> ({sort === 'desc' ? 'highest' : 'lowest'} first)
            </div>
            <DataTable data={ranked} maxRows={topN} />
          </div>
        </>
      )}
    </div>
  )
}
