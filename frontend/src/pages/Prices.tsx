import { useState, useMemo } from 'react'
import { useDataset } from '../hooks/useDataset'
import MetricsRow, { buildMetrics } from '../components/MetricsRow'
import DataTable from '../components/DataTable'
import LineChart from '../components/LineChart'
import EmptyState from '../components/EmptyState'

const DATASETS: Record<string, { label: string; entityCol: string; valueOptions: string[] }> = {
  da_lbmp_zone:            { label: 'DA LBMP — Zonal',         entityCol: 'Zone',      valueOptions: ['LMP','MLC','MCC'] },
  rt_lbmp_zone:            { label: 'RT LBMP — Zonal',         entityCol: 'Zone',      valueOptions: ['LMP','MLC','MCC'] },
  da_lbmp_gen:             { label: 'DA LBMP — Generator',     entityCol: 'Generator', valueOptions: ['LMP','MLC','MCC'] },
  rt_lbmp_gen:             { label: 'RT LBMP — Generator',     entityCol: 'Generator', valueOptions: ['LMP','MLC','MCC'] },
  integrated_rt_lbmp_zone: { label: 'Integrated RT LBMP — Zone', entityCol: 'Zone',   valueOptions: ['LMP','MLC','MCC'] },
  damasp:                  { label: 'DA Ancillary Prices',     entityCol: 'Zone',      valueOptions: ['10 Min Spin','10 Min Non-Sync','30 Min OR','Reg Cap'] },
  rtasp:                   { label: 'RT Ancillary Prices',     entityCol: 'Zone',      valueOptions: ['10 Min Spin','10 Min Non-Sync','30 Min OR','Reg Cap'] },
  ext_rto_cts_price:       { label: 'External RTO CTS Price',  entityCol: 'Generator', valueOptions: ['Gen LMP','External CTS Price','CTS Spread'] },
}

const TABS = ['Overview', 'Chart', 'Data Table']

export default function Prices() {
  const [dsKey, setDsKey] = useState('da_lbmp_zone')
  const [tab, setTab] = useState('Overview')
  const cfg = DATASETS[dsKey]
  const { data: result, loading } = useDataset('prices', dsKey)

  const rows = result?.data ?? []

  const valueCol = useMemo(() => {
    const opts = cfg.valueOptions
    return opts.find(c => rows.length && rows[0][c] !== undefined) || opts[0]
  }, [cfg, rows])

  const entities = useMemo(() => {
    const col = cfg.entityCol
    const uniq = [...new Set(rows.map(r => r[col] as string).filter(Boolean))]
    return uniq.slice(0, 12)
  }, [rows, cfg])

  const chartData = useMemo(() => {
    if (!rows.length) return []
    const tsCol = rows[0]['Time Stamp'] !== undefined ? 'Time Stamp' : 'RTC Execution Time'
    const byTime: Record<string, Record<string, unknown>> = {}
    for (const row of rows) {
      const t = row[tsCol] as string
      if (!t) continue
      if (!byTime[t]) byTime[t] = { ts: t }
      const ent = row[cfg.entityCol] as string
      if (ent && entities.includes(ent)) byTime[t][ent] = row[valueCol]
    }
    return Object.values(byTime).sort((a, b) => String(a.ts) < String(b.ts) ? -1 : 1).slice(-500)
  }, [rows, cfg, entities, valueCol])

  const metrics = useMemo(() => buildMetrics(rows, valueCol), [rows, valueCol])

  return (
    <div className="page">
      <div className="page-header">
        <h1>💲 Prices</h1>
        <p>Day-ahead and real-time LBMP prices by zone and generator</p>
      </div>

      <div className="controls">
        <div className="control-group">
          <label>Dataset</label>
          <select value={dsKey} onChange={e => setDsKey(e.target.value)}>
            {Object.entries(DATASETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading...</div>}

      {!loading && !rows.length && <EmptyState />}

      {!loading && rows.length > 0 && (
        <>
          <MetricsRow metrics={metrics} />

          <div className="tabs">
            {TABS.map(t => <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t}</div>)}
          </div>

          {tab === 'Overview' && (
            <div>
              <LineChart data={chartData} xKey="ts" yKeys={entities.slice(0, 6)} title={`${cfg.label} — ${valueCol}`} height={320} />
              <div className="card" style={{ marginTop: 16 }}>
                <div className="card-title">Summary</div>
                <p style={{ fontSize: 13 }}>Dataset: <strong>{cfg.label}</strong> · Rows: <strong>{rows.length.toLocaleString()}</strong> · Metric: <strong>{valueCol}</strong></p>
                {result?.nan_summary && Object.keys(result.nan_summary).length > 0 && (
                  <div className="alert alert-info" style={{ marginTop: 8 }}>
                    NaN counts: {Object.entries(result.nan_summary).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'Chart' && (
            <div className="card">
              <LineChart data={chartData} xKey="ts" yKeys={entities.slice(0, 8)} title={`${cfg.label} — ${valueCol}`} height={400} />
            </div>
          )}

          {tab === 'Data Table' && (
            <DataTable data={rows} maxRows={200} />
          )}
        </>
      )}
    </div>
  )
}
