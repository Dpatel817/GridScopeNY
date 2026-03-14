import { useState } from 'react';
import ResolutionSelector from '../components/ResolutionSelector';
import DatasetSection from '../components/DatasetSection';

const DATASETS = [
  'dam_limiting_constraints',
  'rt_limiting_constraints',
  'sc_line_outages',
  'rt_line_outages',
  'out_sched',
  'outage_schedule',
];

export default function Congestion() {
  const [resolution, setResolution] = useState('hourly');

  return (
    <div className="page">
      <div className="page-header">
        <h1>Congestion</h1>
        <p>Day-Ahead & Real-Time Limiting Constraints, Scheduled & Actual Outages</p>
      </div>

      <ResolutionSelector value={resolution} onChange={setResolution} />

      {DATASETS.map((key, i) => (
        <DatasetSection
          key={key}
          datasetKey={key}
          resolution={resolution}
          defaultExpanded={i === 0}
        />
      ))}
    </div>
  );
}
