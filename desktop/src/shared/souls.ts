export interface SoulAttribute {
  name: string;
  label: string;
  value: number;
  percent: boolean;
  rolls: number;
}

export interface SoulRecord {
  id: string;
  itemId: number | null;
  suitId: number | null;
  position: number | null;
  stars: number | null;
  level: number | null;
  locked: boolean;
  equipped: boolean;
  discarded: boolean;
  baseAttributeIndex: number | null;
  baseValue: number | null;
  attributeRolls: Array<{ name: string; factor: number }>;
  name?: string;
  iconKey?: string | null;
  iconUrl?: string | null;
  mainAttribute?: SoulAttribute | null;
  subAttributes?: SoulAttribute[];
  intrinsicAttributes?: SoulAttribute[];
  attributesComplete?: boolean;
  setEffects?: string[];
}

export interface SoulSnapshot {
  instanceId: string;
  fetchedAt: string;
  source: 'memory';
  total: number;
  failed: number;
  souls: SoulRecord[];
  warnings: string[];
}

export interface SoulFetchProgress {
  instanceId: string;
  message: string;
  completed?: number | null;
  total?: number | null;
}
