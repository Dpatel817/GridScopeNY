import { useState, useMemo } from 'react'
import { useDataset } from '../hooks/useDataset'
import MetricsRow, { buildMetrics } from '../components/MetricsRow'
import DataTable from '../components/DataTable'
import LineChart from '../components/LineChart'
import EmptyState from '../components/EmptyState'

const DATASETS: Record<string, { label: string; entityCol?: string; valueCol: string; tsCol: string }> = {
  dam_limiting_constraints: { label: 'DA Limiting Constraints', entityCol: 'Limiting Facility', valueCol: 'Constraint Cost',       tsCol: 'Time Stamp' },
  rt_limiting_constraints:  { label: 'RT Limiting Constraints', entityCol: 'Limiting Facility', valueCol: 'Constraint Cost',       tsCol: 'Time Stamp' },
  out_sched:                { label: 'DA Scheduled Outages',    entityCol: 'Equipment',          valueCol: 'Outage Duration Hours', tsCol: 'Time Stamp' },
  outage_schedule:          { label: 'Outage Schedule',         entityCol: 'Equipment',          valueCol: 'Outage Duration Hours', tsCol: 'Out Start' },
  sc_line_outages:          { label: 'Scheduled Line Outages',  entityCol: 'Equipment',          valueCol: 'Outage Duration Hours', tsCol: 'Time Stamp' },
  rt_line_outages:          { label: 'RT Line Outages',         entityCol: 'Equipment',          valueCol: 'Outage Duration Hours', tsCol: 'Time Stamp' },
  zonal_uplift:             { label: 'Zonal Uplift',            entityCol: 'Zone',               valueCol: 'Zonal Uplift',          tsCol: 'Time Stamp' },
}

const TABS = ['Chart', 'Data Table']

export default function Congestion() {
  const [dsKey, setDsKey] = useState('dam_limiting_constraints')
  const [tab, setTab] = useState('Chart')
  const cfg = DATASETS[dsKey]
  const { data: result, loading } = useDataset('congestion', dsKey)
  const rows = result?.data ?? []

  const entities = useMemo(() => {
    if (!cfg.entityCol) return []
    const uniq = [...new Set(rows.map(r => r[cfg.entityCol!] as string).filter(Boolean))]
    return uniq.slice(0, 10)
  }, [rows, cfg])

  const chartData = useMemo(() => {
    if (!rows.length) return []
    if (cfg.entityCol && entities.length) {
      const byTime: Record<string, Record<string, unknown>> = {}
      for (const row of rows) {
        const t = row[cfg.tsCol] as string
        if (!t) continue
        if (!byTime[t]) byTime[t] = { ts: t }
        const ent = row[cfg.entityCol!] as string
        if (ent && entities.includes(ent)) byTime[t][ent] = row[cfg.valueCol]
      }
      return Object.values(byTime).sort((a, b) => String(a.ts) < String(b.ts) ? -1 : 1).slice(-500)
    }
    return rows.map(r => ({ ts: r[cfg.tsCol], [cfg.valueCol]: r[cfg.valueCol] })).slice(-500)
  }, [rows, cfg, entities])

  const metrics = useMemo(() => buildMetrics(rows, cfg.valueCol), [rows, cfg])

  return (
    <div className="page">
      <div className="page-header">
        <h1>🚧 Congestion</h1>
        <p>Limiting constraints, line outages, outage schedules, and uplift data</p>
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
