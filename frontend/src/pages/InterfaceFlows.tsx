import { useState } from 'react';
import ResolutionSelector from '../components/ResolutionSelector';
import DatasetSection from '../components/DatasetSection';

const DATASETS = [
  'external_limits_flows',
  'atc_ttc',
  'ttcf',
  'par_flows',
  'erie_circulation_da',
  'erie_circulation_rt',
];

export default function InterfaceFlows() {
  const [resolution, setResolution] = useState('hourly');

  return (
    <div className="page">
      <div className="page-header">
        <h1>Interface Flows</h1>
        <p>External & Internal Interface Flows, ATC/TTC, Derates, PAR, Lake Erie</p>
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
