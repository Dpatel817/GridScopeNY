import { useState } from 'react';
import { useDataset, useFilterOptions } from '../hooks/useDataset';
import LineChart from './LineChart';
import DataTable from './DataTable';
import MetricsRow, { buildMetrics } from './MetricsRow';

interface Props {
  datasetKey: string;
  resolution: string;
  defaultExpanded?: boolean;
}

const WIDE_FORMAT_KEYS = ['isolf'];

export default function DatasetSection({ datasetKey, resolution, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
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

  const activeData = isFilterable && filterVal ? filteredData : data;
  const isLoading = isFilterable && filterVal ? filteredLoading : loading;
  const records = activeData?.data || [];
  const label = activeData?.label || datasetKey;
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

              <DataTable data={records} maxRows={200} />

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {activeData?.rows?.toLocaleString()} total rows
                {activeData?.aggregated_rows ? ` | ${activeData.aggregated_rows.toLocaleString()} after aggregation` : ''}
                {` | ${activeData?.returned_rows?.toLocaleString()} returned`}
                {effectiveRes !== 'raw' && supportsAgg ? ` | Resolution: ${effectiveRes}` : ''}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
