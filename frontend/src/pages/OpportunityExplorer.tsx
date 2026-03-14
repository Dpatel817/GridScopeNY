import { useState, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import DataTable from '../components/DataTable';
import MetricsRow, { buildMetrics } from '../components/MetricsRow';
import EmptyState from '../components/EmptyState';

export default function OpportunityExplorer() {
  const [duration, setDuration] = useState<'1h' | '2h' | '4h'>('2h');
  const { data: daData, loading: daLoading } = useDataset('da_lbmp_zone', 'hourly');
  const { data: rtData, loading: rtLoading } = useDataset('rt_lbmp_zone', 'hourly');

  const loading = daLoading || rtLoading;

  const opportunities = useMemo(() => {
    if (!daData?.data?.length || !rtData?.data?.length) return [];

    const daByKey: Record<string, number> = {};
    for (const r of daData.data) {
      const key = `${r.Date}_${r.HE}_${r.Zone}`;
      daByKey[key] = Number(r.LMP) || 0;
    }

    const durationHours = duration === '1h' ? 1 : duration === '2h' ? 2 : 4;

    const zoneData: Record<string, { spreads: number[]; zone: string }> = {};
    for (const r of rtData.data) {
      const key = `${r.Date}_${r.HE}_${r.Zone}`;
      const rtLmp = Number(r.LMP) || 0;
      const daLmp = daByKey[key] || 0;
      const spread = Math.abs(rtLmp - daLmp);
      const zone = String(r.Zone);
      if (!zoneData[zone]) zoneData[zone] = { spreads: [], zone };
      zoneData[zone].spreads.push(spread);
    }

    const results = Object.values(zoneData).map(({ zone, spreads }) => {
      spreads.sort((a, b) => b - a);
      const topN = spreads.slice(0, durationHours * 24);
      const avgSpread = topN.reduce((s, v) => s + v, 0) / (topN.length || 1);
      const maxSpread = spreads[0] || 0;
      const revenue = avgSpread * durationHours;
      return {
        Zone: zone,
        'Avg DA-RT Spread ($/MWh)': avgSpread.toFixed(2),
        'Max Spread ($/MWh)': maxSpread.toFixed(2),
        [`Est. ${duration} Revenue ($/MW)`]: revenue.toFixed(2),
        'Spread Events': topN.length,
      };
    });

    results.sort((a, b) => Number(b[`Est. ${duration} Revenue ($/MW)`]) - Number(a[`Est. ${duration} Revenue ($/MW)`]));
    return results;
  }, [daData, rtData, duration]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Battery Opportunity Explorer</h1>
        <p>Rank zones by battery-style DA-RT arbitrage opportunity</p>
      </div>

      <div className="controls">
        <div className="control-group">
          <label>Battery Duration</label>
          <select value={duration} onChange={e => setDuration(e.target.value as any)}>
            <option value="1h">1-Hour</option>
            <option value="2h">2-Hour</option>
            <option value="4h">4-Hour</option>
          </select>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner" /> Loading price data...</div>}

      {!loading && !opportunities.length && <EmptyState message="No price data available to compute opportunities." />}

      {!loading && opportunities.length > 0 && (
        <>
          <MetricsRow metrics={buildMetrics(
            opportunities.map(o => ({ val: Number(o[`Est. ${duration} Revenue ($/MW)`]) })),
            'val'
          ).map(m => ({ ...m, label: m.label.replace('val', `${duration} Rev`) }))} />
          <div className="card">
            <div className="card-title">Zone Rankings by {duration} Battery Opportunity</div>
            <DataTable data={opportunities} maxRows={50} />
          </div>
        </>
      )}
    </div>
  );
}
