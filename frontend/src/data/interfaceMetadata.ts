export interface InterfaceMeta {
  raw: string;
  display: string;
  classification: "Internal" | "External";
  region: string;
  direction: string;
}

const INTERFACE_METADATA: Record<string, InterfaceMeta> = {
  "CENTRAL EAST - VC": {
    raw: "CENTRAL EAST - VC",
    display: "Central East (VC)",
    classification: "Internal",
    region: "East-West Boundary",
    direction: "North → South",
  },
  "DYSINGER EAST": {
    raw: "DYSINGER EAST",
    display: "Dysinger East",
    classification: "Internal",
    region: "Western NY Boundary",
    direction: "West → East",
  },
  "MOSES SOUTH": {
    raw: "MOSES SOUTH",
    display: "Moses South",
    classification: "Internal",
    region: "Northern NY Boundary",
    direction: "North → South",
  },
  "SPR/DUN-SOUTH": {
    raw: "SPR/DUN-SOUTH",
    display: "Sprainbrook / Dunwoodie South",
    classification: "Internal",
    region: "Downstate Boundary",
    direction: "Upstate → Zone J",
  },
  "TOTAL EAST": {
    raw: "TOTAL EAST",
    display: "Total East",
    classification: "Internal",
    region: "East-West Aggregate",
    direction: "West → East",
  },
  "UPNY CONED": {
    raw: "UPNY CONED",
    display: "Upstate NY → Con Edison",
    classification: "Internal",
    region: "Upstate-Downstate Boundary",
    direction: "Upstate → Zone J",
  },
  "WEST CENTRAL": {
    raw: "WEST CENTRAL",
    display: "West Central",
    classification: "Internal",
    region: "Western NY Boundary",
    direction: "West → East",
  },
  "SCH - HQ - NY": {
    raw: "SCH - HQ - NY",
    display: "HQ AC",
    classification: "External",
    region: "Québec",
    direction: "Bidirectional",
  },
  "SCH - HQ_CEDARS": {
    raw: "SCH - HQ_CEDARS",
    display: "HQ Cedars",
    classification: "External",
    region: "Québec",
    direction: "Bidirectional",
  },
  "SCH - HQ_CHPE": {
    raw: "SCH - HQ_CHPE",
    display: "HQ CHPE",
    classification: "External",
    region: "Québec",
    direction: "Imports via CHPE",
  },
  "SCH - HQ_IMPORT_EXPORT": {
    raw: "SCH - HQ_IMPORT_EXPORT",
    display: "HQ Import / Export",
    classification: "External",
    region: "Québec",
    direction: "Bidirectional",
  },
  "SCH - NE - NY": {
    raw: "SCH - NE - NY",
    display: "NE AC",
    classification: "External",
    region: "New England (ISO-NE)",
    direction: "Bidirectional",
  },
  "SCH - NPX_1385": {
    raw: "SCH - NPX_1385",
    display: "1385",
    classification: "External",
    region: "New England (ISO-NE)",
    direction: "Bidirectional",
  },
  "SCH - NPX_CSC": {
    raw: "SCH - NPX_CSC",
    display: "CSC",
    classification: "External",
    region: "New England (ISO-NE)",
    direction: "Imports via CSC",
  },
  "SCH - OH - NY": {
    raw: "SCH - OH - NY",
    display: "IMO AC",
    classification: "External",
    region: "Ontario (IESO)",
    direction: "Bidirectional",
  },
  "SCH - PJ - NY": {
    raw: "SCH - PJ - NY",
    display: "PJM AC",
    classification: "External",
    region: "PJM",
    direction: "Bidirectional",
  },
  "SCH - PJM_HTP": {
    raw: "SCH - PJM_HTP",
    display: "PJM HTP",
    classification: "External",
    region: "PJM",
    direction: "Bidirectional",
  },
  "SCH - PJM_NEPTUNE": {
    raw: "SCH - PJM_NEPTUNE",
    display: "PJM Neptune",
    classification: "External",
    region: "PJM",
    direction: "Import via Neptune",
  },
  "SCH - PJM_VFT": {
    raw: "SCH - PJM_VFT",
    display: "PJM VFT",
    classification: "External",
    region: "PJM",
    direction: "Bidirectional",
  },
};

export function getInterfaceMeta(raw: string): InterfaceMeta {
  if (INTERFACE_METADATA[raw]) return INTERFACE_METADATA[raw];
  const isExternal =
    raw.startsWith("SCH") || raw.includes("IMPORT") || raw.includes("EXPORT");
  return {
    raw,
    display: raw,
    classification: isExternal ? "External" : "Internal",
    region: "Unclassified",
    direction: "",
  };
}

export function getDisplayName(raw: string): string {
  return INTERFACE_METADATA[raw]?.display || raw;
}

export function getClassification(raw: string): "Internal" | "External" {
  return INTERFACE_METADATA[raw]?.classification || "Internal";
}

export default INTERFACE_METADATA;
