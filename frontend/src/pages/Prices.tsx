import { useState } from 'react';
import ResolutionSelector from '../components/ResolutionSelector';
import DatasetSection from '../components/DatasetSection';

const DATASETS = [
  'da_lbmp_zone',
  'rt_lbmp_zone',
  'integrated_rt_lbmp_zone',
  'da_lbmp_gen',
  'rt_lbmp_gen',
  'integrated_rt_lbmp_gen',
  'reference_bus_lbmp',
  'ext_rto_cts_price',
  'damasp',
  'rtasp',
];

export default function Prices() {
  const [resolution, setResolution] = useState('hourly');

  return (
    <div className="page">
      <div className="page-header">
        <h1>Prices</h1>
        <p>Day-Ahead & Real-Time LBMPs, Ancillary Services, CTS Prices</p>
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
