/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';

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
  total_rows: number;
  offset: number;
  has_more: boolean;
  resolution: string;
  columns: string[];
  data: Record<string, any>[];
  meta: DatasetMeta;
}

interface UseDatasetOptions {
  refreshMs?: number;
  loadAllPages?: boolean;
}

export function useDataset(
  datasetKey: string,
  resolution: string = 'raw',
  filterCol?: string,
  filterVal?: string,
  limit: number = 10000,
  days: number = 0,
  offset: number = 0,
  options: UseDatasetOptions = {},
) {
  const refreshMs = options.refreshMs ?? 15 * 60 * 1000;
  const loadAllPages = options.loadAllPages ?? false;
  const [data, setData] = useState<DatasetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  const queryIdRef = useRef('');
  const queryId = `${datasetKey}:${resolution}:${filterCol}:${filterVal}:${days}:${offset}`;
  if (queryIdRef.current !== queryId) {
    queryIdRef.current = queryId;
    hasDataRef.current = false;
  }

  const fetchData = useCallback(async () => {
    if (!datasetKey) return;
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    try {
      const fetchPage = async (pageOffset: number): Promise<DatasetResponse> => {
        const params = new URLSearchParams({
          resolution,
          limit: String(limit),
          days: String(days),
          offset: String(pageOffset),
        });
        if (filterCol && filterVal) {
          params.set('filter_col', filterCol);
          params.set('filter_val', filterVal);
        }
        const res = await fetch(`/api/dataset/${datasetKey}?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };

      if (!loadAllPages) {
        const json = await fetchPage(offset);
        hasDataRef.current = true;
        setData(json);
        return;
      }

      const firstPage = await fetchPage(offset);
      const combinedData = [...firstPage.data];
      let nextOffset = offset + (firstPage.returned_rows || firstPage.data.length);
      let hasMore = firstPage.has_more;

      while (hasMore) {
        const page = await fetchPage(nextOffset);
        combinedData.push(...page.data);
        const pageSize = page.returned_rows || page.data.length;
        if (pageSize === 0) break;
        nextOffset += pageSize;
        hasMore = page.has_more;
      }

      hasDataRef.current = true;
      setData({
        ...firstPage,
        data: combinedData,
        returned_rows: combinedData.length,
        offset,
        has_more: combinedData.length < firstPage.total_rows,
      });
    } catch (e: any) {
      setError(e.message || 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [datasetKey, resolution, filterCol, filterVal, limit, days, offset, loadAllPages]);

  useEffect(() => {
    fetchData();
    if (refreshMs <= 0) return;
    const timer = window.setInterval(() => {
      fetchData();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [fetchData, refreshMs]);

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
