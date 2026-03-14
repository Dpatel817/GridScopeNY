import { useState, useEffect, useCallback } from 'react';

export interface DatasetMeta {
  label: string;
  native: string;
  chart_y: string;
  chart_group: string;
  wide_format: boolean;
  value_cols: string[];
  group_cols: string[];
  filterable: boolean;
}

export interface DatasetResponse {
  dataset: string;
  label: string;
  status: string;
  rows: number;
  aggregated_rows?: number;
  returned_rows: number;
  resolution: string;
  columns: string[];
  data: Record<string, any>[];
  meta: DatasetMeta;
}

export function useDataset(
  datasetKey: string,
  resolution: string = 'raw',
  filterCol?: string,
  filterVal?: string,
  limit: number = 10000
) {
  const [data, setData] = useState<DatasetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!datasetKey) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ resolution, limit: String(limit) });
      if (filterCol && filterVal) {
        params.set('filter_col', filterCol);
        params.set('filter_val', filterVal);
      }
      const res = await fetch(`/api/dataset/${datasetKey}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [datasetKey, resolution, filterCol, filterVal, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function useInventory() {
  const [inventory, setInventory] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/inventory')
      .then(r => r.json())
      .then(d => { setInventory(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return { inventory, loading }
}

export function useFilterOptions(datasetKey: string, column: string) {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!datasetKey || !column) return;
    fetch(`/api/filters/${datasetKey}/${column}`)
      .then(r => r.json())
      .then(json => setOptions(json.options || []))
      .catch(() => setOptions([]));
  }, [datasetKey, column]);

  return options;
}
