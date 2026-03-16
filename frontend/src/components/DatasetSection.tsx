import { useState, useCallback, useEffect } from 'react';
import { useDataset, useFilterOptions, DatasetResponse } from '../hooks/useDataset';
import LineChart from './LineChart';
import DataTable from './DataTable';
import MetricsRow, { buildMetrics } from './MetricsRow';

const DATASET_LABELS: Record<string, string> = {
  da_lbmp_zone: 'DA Zonal LBMP (P-2A)',
  rt_lbmp_zone: 'RT Zonal LBMP (P-24A)',
  integrated_rt_lbmp_zone: 'Integrated RT Zonal LBMP (P-4A)',
  da_lbmp_gen: 'DA Generator LBMP (P-2B)',
  rt_lbmp_gen: 'RT Generator LBMP (P-24B)',
  integrated_rt_lbmp_gen: 'Integrated RT Generator LBMP (P-4B)',
  reference_bus_lbmp: 'Reference Bus LBMP (P-28)',
  ext_rto_cts_price: 'RTC vs External RTO CTS Prices (P-42)',
  damasp: 'DA Ancillary Service Prices (P-5)',
  rtasp: 'RT Ancillary Service Prices (P-6B)',
  isolf: 'ISO Load Forecast (P-7)',
  pal: 'RT Actual Load (P-58B)',
  pal_integrated: 'Integrated RT Actual Load (P-58C)',
  lfweather: 'Weather Forecast (P-7A)',
  rtfuelmix: 'RT Fuel Mix (P-63)',
  gen_maint_report: 'Generation Maintenance Report (P-15)',
  op_in_commit: 'Operator-Initiated Commitments (P-26)',
  dam_imer: 'DA Intermittent Forecast (P-69)',
  rt_imer: 'RT Intermittent Forecast (P-68)',
  btm_da_forecast: 'BTM Solar DA Forecast (P-72)',
  btm_estimated_actual: 'BTM Solar Estimated Actual (P-73)',
  external_limits_flows: 'External Limits & Flows (P-62)',
  atc_ttc: 'ATC/TTC (P-46)',
  ttcf: 'Transfer Capability (TTCF)',
  par_flows: 'PAR Flows (P-36)',
  erie_circulation_da: 'Erie DA Circulation (P-70A)',
  erie_circulation_rt: 'Erie RT Circulation (P-70B)',
  dam_limiting_constraints: 'DA Limiting Constraints (P-511A)',
  rt_limiting_constraints: 'RT Limiting Constraints (P-33)',
  sc_line_outages: 'RT Scheduled Outages (P-54A)',
  rt_line_outages: 'RT Actual Outages (P-54B)',
  out_sched: 'DA Scheduled Outages (P-54C)',
  outage_schedule: 'Outage Schedules (P-14B)',
  rt_events: 'Real-Time Events (P-35)',
  oper_messages: 'Operational Announcements',
  generator_names: 'Generator Names (P-19)',
  load_names: 'Load Names (P-20)',
  active_transmission_nodes: 'Active Transmission Nodes (P-66)',
  interconnection_queue: 'Interconnection Queue (All Sheets)',
  iq_active: 'Active Queue Projects',
  iq_cluster: 'Cluster Study Projects',
  iq_affected_system: 'Affected System Projects',
  iq_in_service: 'In-Service Projects',
  iq_withdrawn: 'Withdrawn Projects',
  iq_changes: 'Queue Changes (Since Last Scrape)',
  iq_summary: 'Queue Summary',
};

interface Props {
  datasetKey: string;
  resolution: string;
  defaultExpanded?: boolean;
}

const WIDE_FORMAT_KEYS = ['isolf'];

function resetPaginationState(
  setAllRecords: (v: Record<string, any>[]) => void,
  setPaginationMeta: (v: { total_rows: number; has_more: boolean } | null) => void,
) {
  setAllRecords([]);
  setPaginationMeta(null);
}

export default function DatasetSection({ datasetKey, resolution, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [allRecords, setAllRecords] = useState<Record<string, any>[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [paginationMeta, setPaginationMeta] = useState<{ total_rows: number; has_more: boolean } | null>(null);
  const effectiveRes = resolution;
  const { data, loading, error } = useDataset(
    expanded ? datasetKey : '',
    effectiveRes
  );

  const meta = data?.meta;
  const isFilterable = meta?.filterable;
  const filterColumn = meta?.group_cols?.[0] || '';
  const filterOptions = useFilterOptions(
    isFilterable && expanded ? datasetKey : '',
    filterColumn
  );
  const [filterVal, setFilterVal] = useState('');

  const { data: filteredData, loading: filteredLoading } = useDataset(
    isFilterable && filterVal && expanded ? datasetKey : '',
    effectiveRes,
    filterColumn,
    filterVal
  );

  useEffect(() => {
    resetPaginationState(setAllRecords, setPaginationMeta);
  }, [datasetKey, resolution, expanded, filterVal]);

  const activeData = isFilterable && filterVal ? filteredData : data;
  const isLoading = isFilterable && filterVal ? filteredLoading : loading;

  const baseRecords = activeData?.data || [];
  const records = allRecords.length > 0 ? allRecords : baseRecords;

  const hasMore = paginationMeta ? paginationMeta.has_more : (activeData?.has_more ?? false);
  const totalRows = paginationMeta ? paginationMeta.total_rows : (activeData?.total_rows ?? 0);

  const handleLoadMore = useCallback(async () => {
    if (!activeData || loadingMore) return;
    setLoadingMore(true);
    try {
      const existingRecords = allRecords.length > 0 ? allRecords : baseRecords;
      const nextOffset = existingRecords.length;
      const params = new URLSearchParams({
        resolution: effectiveRes,
        limit: '10000',
        days: '90',
        offset: String(nextOffset),
      });
      if (isFilterable && filterVal && filterColumn) {
        params.set('filter_col', filterColumn);
        params.set('filter_val', filterVal);
      }
      const res = await fetch(`/api/dataset/${datasetKey}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DatasetResponse = await res.json();
      const merged = [...existingRecords, ...json.data];
      setAllRecords(merged);
      setPaginationMeta({ total_rows: json.total_rows, has_more: json.has_more });
    } catch (e) {
      console.error('Failed to load more data:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [activeData, loadingMore, baseRecords, allRecords, effectiveRes, filterVal, filterColumn, isFilterable, datasetKey]);

  const label = activeData?.label || DATASET_LABELS[datasetKey] || datasetKey;
  const native = meta?.native || '';
  const isTimeSeries = ['hourly', '5min'].includes(native);
  const isWide = WIDE_FORMAT_KEYS.includes(datasetKey) || meta?.wide_format;

  const chartY = meta?.chart_y || '';
  const chartGroup = meta?.chart_group || '';
  const valueCols = meta?.value_cols || [];

  function getChartData() {
    if (!records.length) return { data: [], xKey: '', yKeys: [] as string[] };

    if (isWide) {
      const xKey = records[0]?.Date ? 'Date' : (records[0]?.['Time Stamp'] ? 'Time Stamp' : 'Date');
      return { data: records, xKey, yKeys: valueCols.filter(c => records[0]?.[c] !== undefined) };
    }

    if (chartGroup && records.length > 0 && records[0][chartGroup] !== undefined) {
      const groups = [...new Set(records.map(r => String(r[chartGroup])))].slice(0, 8);
      const dateKey = records[0]?.Date ? 'Date' : 'HE';

      if (effectiveRes === 'on_peak' || effectiveRes === 'off_peak' || effectiveRes === 'daily') {
        const pivoted: Record<string, any> = {};
        for (const r of records) {
          const key = String(r.Date || r[dateKey] || '');
          if (!pivoted[key]) pivoted[key] = { [dateKey]: key };
          const g = String(r[chartGroup]);
          if (groups.includes(g)) pivoted[key][g] = r[chartY];
        }
        return { data: Object.values(pivoted), xKey: dateKey, yKeys: groups };
      }

      const pivoted: Record<string, any> = {};
      for (const r of records) {
        const key = `${r.Date}_${r.HE}`;
        if (!pivoted[key]) pivoted[key] = { Date: r.Date, HE: r.HE };
        const g = String(r[chartGroup]);
        if (groups.includes(g)) pivoted[key][g] = r[chartY];
      }
      return { data: Object.values(pivoted), xKey: 'Date', yKeys: groups };
    }

    const xKey = records[0]?.Date ? 'Date' : (records[0]?.['Time Stamp'] ? 'Time Stamp' : 'HE');
    return { data: records, xKey, yKeys: chartY ? [chartY] : valueCols.slice(0, 4) };
  }

  const nativeLabel = native === '5min' ? '5-min' : native === 'hourly' ? 'Hourly' : native === 'daily' ? 'Daily' : 'Table';
  const rowInfo = activeData ? `${(activeData.returned_rows || 0).toLocaleString()} rows` : '';
  const supportsAgg = isTimeSeries;

  return (
    <div className="dataset-section">
      <div
        className={`dataset-header ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="expand-icon">{expanded ? '▾' : '▸'}</span>
        <span className="dataset-label">{label}</span>
        <span className="dataset-badge">{nativeLabel}</span>
        {!expanded && activeData && <span className="dataset-rows">{rowInfo}</span>}
      </div>

      {expanded && (
        <div className="dataset-body">
          {isLoading && <div className="loading"><div className="spinner" /> Loading...</div>}
          {error && <div className="alert alert-danger">{error}</div>}

          {!isLoading && !error && activeData?.status === 'empty' && (
            <p style={{ color: 'var(--text-muted)', padding: 12 }}>No data available. Run ETL to fetch data.</p>
          )}

          {!isLoading && !error && records.length > 0 && (
            <>
              {isFilterable && (
                <div className="controls" style={{ marginBottom: 12 }}>
                  <div className="control-group">
                    <label>Filter by {filterColumn}</label>
                    <select value={filterVal} onChange={e => setFilterVal(e.target.value)}>
                      <option value="">All (zone-level summary)</option>
                      {filterOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {supportsAgg && (
                <MetricsRow metrics={buildMetrics(records, chartY || valueCols[0])} />
              )}

              {isTimeSeries && records.length > 1 && (() => {
                const { data: cd, xKey, yKeys } = getChartData();
                return cd.length > 1 ? <div className="card"><LineChart data={cd} xKey={xKey} yKeys={yKeys} height={280} /></div> : null;
              })()}

              <DataTable
                data={records}
                maxRows={500}
                hasMore={hasMore}
                onLoadMore={handleLoadMore}
                loadingMore={loadingMore}
              />

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {totalRows > 0 ? `${totalRows.toLocaleString()} total rows` : `${(activeData?.rows ?? 0).toLocaleString()} total rows`}
                {activeData?.aggregated_rows ? ` | ${activeData.aggregated_rows.toLocaleString()} after aggregation` : ''}
                {` | ${records.length.toLocaleString()} loaded`}
                {hasMore && ` | More data available`}
                {effectiveRes !== 'raw' && supportsAgg ? ` | Resolution: ${effectiveRes}` : ''}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
