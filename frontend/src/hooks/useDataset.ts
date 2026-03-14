import { useState, useEffect } from 'react'

export interface DatasetResult {
  dataset: string
  category: string
  rows: number
  returned_rows: number
  columns: string[]
  data: Record<string, unknown>[]
  status: 'ok' | 'empty' | 'error'
  message?: string
  nan_summary?: Record<string, number>
}

export function useDataset(category: string, dataset: string, limit = 5000) {
  const [data, setData] = useState<DatasetResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!category || !dataset) return
    setLoading(true)
    setError(null)
    fetch(`/api/${category}/${dataset}?limit=${limit}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [category, dataset, limit])

  return { data, loading, error }
}

export function useInventory() {
  const [inventory, setInventory] = useState<Record<string, Record<string, {status: string; rows: number}>> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/inventory')
      .then(r => r.json())
      .then(d => { setInventory(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return { inventory, loading }
}
