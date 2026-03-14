import { useState } from 'react';
import ResolutionSelector from '../components/ResolutionSelector';
import DatasetSection from '../components/DatasetSection';

const DATASETS = [
  'isolf',
  'pal',
  'pal_integrated',
  'lfweather',
];

export default function Demand() {
  const [resolution, setResolution] = useState('hourly');

  return (
    <div className="page">
      <div className="page-header">
        <h1>Demand</h1>
        <p>ISO Load Forecast, Actual Load, Weather Forecast</p>
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
