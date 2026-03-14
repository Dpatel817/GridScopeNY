import { useState } from 'react';
import ResolutionSelector from '../components/ResolutionSelector';
import DatasetSection from '../components/DatasetSection';

const DATASETS = [
  'rtfuelmix',
  'gen_maint_report',
  'op_in_commit',
  'dam_imer',
  'rt_imer',
  'btm_da_forecast',
  'btm_estimated_actual',
];

export default function Generation() {
  const [resolution, setResolution] = useState('hourly');

  return (
    <div className="page">
      <div className="page-header">
        <h1>Generation</h1>
        <p>Real-Time Fuel Mix, IMER Reports, BTM Solar, Maintenance & Commitments</p>
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
