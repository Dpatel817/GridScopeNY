export const NYISO_ZONES: Record<string, string> = {
  'WEST': 'A',
  'GENESE': 'B',
  'CENTRL': 'C',
  'NORTH': 'D',
  'MHK VL': 'E',
  'CAPITL': 'F',
  'HUD VL': 'G',
  'MILLWD': 'H',
  'DUNWOD': 'I',
  'N.Y.C.': 'J',
  'LONGIL': 'K',
};

export const ZONE_NAMES = Object.keys(NYISO_ZONES);

export const EXCLUDED_ZONES = new Set(['H Q', 'NPX', 'O H', 'PJM']);

export function isNyisoZone(zone: string): boolean {
  return zone in NYISO_ZONES;
}

export function zoneLabel(zone: string): string {
  const code = NYISO_ZONES[zone];
  return code ? `Zone ${code} (${zone})` : zone;
}

export function filterNyisoZones(zones: string[]): string[] {
  return zones.filter(z => z in NYISO_ZONES);
}
