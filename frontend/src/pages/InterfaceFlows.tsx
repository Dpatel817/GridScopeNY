import { useState, useMemo } from 'react'
import { useDataset } from '../hooks/useDataset'
import MetricsRow, { buildMetrics } from '../components/MetricsRow'
import DataTable from '../components/DataTable'
import LineChart from '../components/LineChart'
import EmptyState from '../components/EmptyState'

const DATASETS: Record<string, { label: string; entityCol?: string; valueCol: string }> = {
  external_limits_flows: { label: 'External Limits & Flows', entityCol: 'Interface',      valueCol: 'Flow' },
  atc_ttc:               { label: 'ATC / TTC',               entityCol: 'Interface',      valueCol: 'DAM TTC' },
  ttcf:                  { label: 'TTCF',                    entityCol: 'Interface Name', valueCol: 'Revised Import TTC' },
  par_flows:             { label: 'PAR Flows',               entityCol: 'Interface',      valueCol: 'PAR Flow' },
  erie_circulation_da:   { label: 'Erie Circulation DA',     entityCol: undefined,        valueCol: 'Lake Erie Circulation' },
  erie_circulation_rt:   { label: 'Erie Circulation RT',     entityCol: undefined,        valueCol: 'Lake Erie Circulation' },
}

const TABS = ['Chart', 'Data Table']

export default function InterfaceFlows() {
  const [dsKey, setDsKey] = useState('external_limits_flows')
  const [tab, setTab] = useState('Chart')
  const cfg = DATASETS[dsKey]
  const { data: result, loading } = useDataset('interfaces', dsKey)
  const rows = result?.data ?? []

  const entities = useMemo(() => {
    if (!cfg.entityCol) return []
    const uniq = [...new Set(rows.map(r => r[cfg.entityCol!] as string).filter(Boolean))]
    return uniq.slice(0, 12)
  }, [rows, cfg])

  const tsCol = useMemo(() => rows.length && rows[0]['Time Stamp'] !== undefined ? 'Time Stamp' : 'Date Out', [rows])

  const chartData = useMemo(() => {
    if (!rows.length) return []
    if (cfg.entityCol && entities.length) {
      const byTime: Record<string, Record<string, unknown>> = {}
      for (const row of rows) {
        const t = row[tsCol] as string
        if (!t) continue
        if (!byTime[t]) byTime[t] = { ts: t }
        const ent = row[cfg.entityCol!] as string
        if (ent && entities.includes(ent)) byTime[t][ent] = row[cfg.valueCol]
      }
      return Object.values(byTime).sort((a, b) => String(a.ts) < String(b.ts) ? -1 : 1).slice(-500)
    }
    return rows.map(r => ({ ts: r[tsCol], [cfg.valueCol]: r[cfg.valueCol] })).slice(-500)
  }, [rows, cfg, entities, tsCol])

  const metrics = useMemo(() => buildMetrics(rows, cfg.valueCol), [rows, cfg])

  return (
    <div className="page">
      <div className="page-header">
        <h1>🔌 Interface Flows</h1>
        <p>External interface limits, flows, ATC/TTC, PAR schedules, and Erie Circulation</p>
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
          {tab === 'Chart' && (
            <div className="card">
              <LineChart
                data={chartData}
                xKey="ts"
                yKeys={cfg.entityCol ? entities.slice(0, 8) : [cfg.valueCol]}
                title={`${cfg.label} — ${cfg.valueCol}`}
                height={360}
              />
            </div>
          )}
          {tab === 'Data Table' && <DataTable data={rows} maxRows={200} />}
        </>
      )}
    </div>
  )
}
