export interface InterfaceMeta {
  raw: string;
  display: string;
  classification: 'Internal' | 'External';
  region: string;
  direction: string;
}

const INTERFACE_METADATA: Record<string, InterfaceMeta> = {
  'CENTRAL EAST - VC': {
    raw: 'CENTRAL EAST - VC',
    display: 'Central East (VC)',
    classification: 'Internal',
    region: 'East-West Boundary',
    direction: 'West → East',
  },
  'DYSINGER EAST': {
    raw: 'DYSINGER EAST',
    display: 'Dysinger East',
    classification: 'Internal',
    region: 'Western NY Boundary',
    direction: 'West → Central',
  },
  'MOSES SOUTH': {
    raw: 'MOSES SOUTH',
    display: 'Moses South',
    classification: 'Internal',
    region: 'Northern NY Boundary',
    direction: 'North → South',
  },
  'SPR/DUN-SOUTH': {
    raw: 'SPR/DUN-SOUTH',
    display: 'Sprainbrook / Dunwoodie South',
    classification: 'Internal',
    region: 'Downstate Boundary',
    direction: 'Upstate → Downstate',
  },
  'TOTAL EAST': {
    raw: 'TOTAL EAST',
    display: 'Total East',
    classification: 'Internal',
    region: 'East-West Aggregate',
    direction: 'West → East',
  },
  'UPNY CONED': {
    raw: 'UPNY CONED',
    display: 'Upstate NY → Con Edison',
    classification: 'Internal',
    region: 'Upstate-Downstate Boundary',
    direction: 'Upstate → NYC',
  },
  'WEST CENTRAL': {
    raw: 'WEST CENTRAL',
    display: 'West Central',
    classification: 'Internal',
    region: 'Western NY Boundary',
    direction: 'West → Central',
  },
  'SCH - HQ - NY': {
    raw: 'SCH - HQ - NY',
    display: 'Hydro-Québec → NY',
    classification: 'External',
    region: 'Québec',
    direction: 'Import from HQ',
  },
  'SCH - HQ_CEDARS': {
    raw: 'SCH - HQ_CEDARS',
    display: 'HQ Cedars',
    classification: 'External',
    region: 'Québec',
    direction: 'Import via Cedars',
  },
  'SCH - HQ_CHPE': {
    raw: 'SCH - HQ_CHPE',
    display: 'HQ CHPE (Champlain Hudson)',
    classification: 'External',
    region: 'Québec',
    direction: 'Import via CHPE',
  },
  'SCH - HQ_IMPORT_EXPORT': {
    raw: 'SCH - HQ_IMPORT_EXPORT',
    display: 'HQ Import / Export',
    classification: 'External',
    region: 'Québec',
    direction: 'Bidirectional',
  },
  'SCH - NE - NY': {
    raw: 'SCH - NE - NY',
    display: 'New England → NY',
    classification: 'External',
    region: 'New England (ISO-NE)',
    direction: 'Import from NE',
  },
  'SCH - NPX_1385': {
    raw: 'SCH - NPX_1385',
    display: 'NE Northport 1385',
    classification: 'External',
    region: 'New England (ISO-NE)',
    direction: 'Import via 1385',
  },
  'SCH - NPX_CSC': {
    raw: 'SCH - NPX_CSC',
    display: 'NE Cross-Sound Cable',
    classification: 'External',
    region: 'New England (ISO-NE)',
    direction: 'Import via CSC',
  },
  'SCH - OH - NY': {
    raw: 'SCH - OH - NY',
    display: 'Ontario → NY',
    classification: 'External',
    region: 'Ontario (IESO)',
    direction: 'Import from Ontario',
  },
  'SCH - PJ - NY': {
    raw: 'SCH - PJ - NY',
    display: 'PJM → NY',
    classification: 'External',
    region: 'PJM',
    direction: 'Import from PJM',
  },
  'SCH - PJM_HTP': {
    raw: 'SCH - PJM_HTP',
    display: 'PJM Hudson (HTP)',
    classification: 'External',
    region: 'PJM',
    direction: 'Import via HTP',
  },
  'SCH - PJM_NEPTUNE': {
    raw: 'SCH - PJM_NEPTUNE',
    display: 'PJM Neptune Cable',
    classification: 'External',
    region: 'PJM',
    direction: 'Import via Neptune',
  },
  'SCH - PJM_VFT': {
    raw: 'SCH - PJM_VFT',
    display: 'PJM Linden VFT',
    classification: 'External',
    region: 'PJM',
    direction: 'Import via VFT',
  },
};

export function getInterfaceMeta(raw: string): InterfaceMeta {
  if (INTERFACE_METADATA[raw]) return INTERFACE_METADATA[raw];
  const isExternal = raw.startsWith('SCH') || raw.includes('IMPORT') || raw.includes('EXPORT');
  return {
    raw,
    display: raw,
    classification: isExternal ? 'External' : 'Internal',
    region: 'Unclassified',
    direction: '',
  };
}

export function getDisplayName(raw: string): string {
  return INTERFACE_METADATA[raw]?.display || raw;
}

export function getClassification(raw: string): 'Internal' | 'External' {
  return INTERFACE_METADATA[raw]?.classification || 'Internal';
}

export default INTERFACE_METADATA;
