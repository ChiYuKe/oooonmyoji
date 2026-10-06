import type { Panel, PanelKey } from './soul-optimizer';
import type { DuelTargetShape, DuelTargetSide } from './duel-skill-inference';

export type DuelSide = 'red' | 'blue';
export const DUEL_DATA_SCHEMA = 'onmyoji-studio.manual-duel';
export const DUEL_DATA_VERSION = 4;

export interface DuelFighterRecord {
  fighterId: string;
  side: DuelSide;
  slot: number;
  heroId: number | null;
  heroName: string | null;
  fourSuitId: string | null;
  fourSuitName: string | null;
  skillLevel: number;
  panel: Panel | null;
  unitType?: 'summon';
  ownerFighterId?: string;
  ownerHeroId?: number;
}

export interface DuelSummonRecord {
  summonId: string;
  side: DuelSide;
  ownerSlot: number;
  ownerFighterId: string;
  ownerHeroId: number;
  name: string;
  active: boolean;
  summonedAt: string;
}

export interface DuelActionRecord {
  actionId: string;
  sequence: number;
  occurredAt: string;
  cycle: number;
  round: number;
  side: DuelSide;
  actorSlot: number;
  actorFighterId: string;
  actorSnapshot: DuelFighterRecord;
  targetSides: DuelTargetSide[];
  targetShape: DuelTargetShape;
  inferenceConfident: boolean;
  skillId: string;
  skillName: string;
  skillCost: number | null;
  targetFighterIds: string[];
  targetSnapshots: DuelFighterRecord[];
  effectId: string;
  effectIds: string[];
  effectName: string;
  effectTargetFighterIds: string[];
  effectTargetSnapshots: DuelFighterRecord[];
  effectValue: number | null;
  effectUnit: string | null;
  detail: string;
}

export interface DuelMatchRecord {
  schema: typeof DUEL_DATA_SCHEMA;
  schemaVersion: typeof DUEL_DATA_VERSION;
  matchId: string;
  source: 'manual';
  status: 'in_progress' | 'complete';
  savedAt?: string;
  savedFromMatchId?: string;
  panelConvention: { percentageFields: PanelKey[]; storedAs: 'fraction' };
  createdAt: string;
  updatedAt: string;
  currentCycle: number;
  currentRound: number;
  rosters: Record<DuelSide, DuelFighterRecord[]>;
  summons: DuelSummonRecord[];
  actions: DuelActionRecord[];
}

export interface DuelDatasetExport {
  schema: typeof DUEL_DATA_SCHEMA;
  schemaVersion: typeof DUEL_DATA_VERSION;
  exportedAt: string;
  matches: DuelMatchRecord[];
}

export interface DuelDatasetStore extends DuelDatasetExport {
  activeMatchId: string;
}

export interface DuelHeroCatalogEntry { id: number; name: string; base?: Panel | null }
export interface DuelSuitCatalogEntry { id: number | string; name: string }

export function createDuelId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${random ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`}`;
}

export function createDuelFighter(side: DuelSide, slot: number, hero?: DuelHeroCatalogEntry, fourSuitId?: string, fourSuitName?: string): DuelFighterRecord {
  return {
    fighterId: createDuelId('fighter'), side, slot,
    heroId: hero?.id ?? null, heroName: hero?.name ?? null,
    fourSuitId: fourSuitId || null, fourSuitName: fourSuitName || null,
    skillLevel: 5, panel: hero?.base ? { ...hero.base } : null,
  };
}

export function snapshotDuelFighter(fighter: DuelFighterRecord): DuelFighterRecord {
  return { ...fighter, panel: fighter.panel ? { ...fighter.panel } : null };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isSide = (value: unknown): value is DuelSide => value === 'red' || value === 'blue';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function panelOrNull(value: unknown): Panel | null {
  if (!isRecord(value)) return null;
  const keys: PanelKey[] = ['hp', 'attack', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist'];
  if (!keys.every(key => finite(value[key]))) return null;
  return Object.fromEntries(keys.map(key => [key, value[key]])) as unknown as Panel;
}

function normalizeFighter(value: unknown, side: DuelSide, slot: number, heroes: DuelHeroCatalogEntry[], suits: DuelSuitCatalogEntry[]): DuelFighterRecord {
  if (typeof value === 'number') value = { heroId: value };
  const saved = isRecord(value) ? value : {};
  const heroId = Number.isInteger(saved.heroId) ? Number(saved.heroId) : null;
  const hero = heroes.find(item => item.id === heroId);
  const suitRaw = saved.fourSuitId ?? saved.fourSuit;
  const suit = suits.find(item => String(item.id) === String(suitRaw));
  const panel = panelOrNull(saved.panel) ?? (hero?.base ? { ...hero.base } : null);
  return {
    fighterId: typeof saved.fighterId === 'string' && saved.fighterId ? saved.fighterId : createDuelId('fighter'),
    side, slot,
    heroId: hero?.id ?? null,
    heroName: hero ? hero.name : null,
    fourSuitId: suit ? String(suit.id) : null,
    fourSuitName: suit?.name ?? null,
    skillLevel: 5,
    panel,
  };
}

function snapshotRef(value: unknown, fallback: DuelFighterRecord): DuelFighterRecord {
  if (!isRecord(value)) return snapshotDuelFighter(fallback);
  return {
    fighterId: typeof value.fighterId === 'string' ? value.fighterId : fallback.fighterId,
    side: isSide(value.side) ? value.side : fallback.side,
    slot: Number.isInteger(value.slot) ? Number(value.slot) : fallback.slot,
    heroId: Number.isInteger(value.heroId) ? Number(value.heroId) : null,
    heroName: typeof value.heroName === 'string' ? value.heroName : null,
    fourSuitId: typeof value.fourSuitId === 'string' ? value.fourSuitId : null,
    fourSuitName: typeof value.fourSuitName === 'string' ? value.fourSuitName : null,
    skillLevel: 5,
    panel: panelOrNull(value.panel),
    ...(value.unitType === 'summon' ? { unitType: 'summon' as const, ownerFighterId: typeof value.ownerFighterId === 'string' ? value.ownerFighterId : '', ownerHeroId: Number.isInteger(value.ownerHeroId) ? Number(value.ownerHeroId) : undefined } : {}),
  };
}

function decodeTarget(value: number, actingSide: DuelSide): { side: DuelSide; slot: number } {
  return value < 0 ? { side: actingSide, slot: Math.abs(value) - 1 } : { side: actingSide === 'red' ? 'blue' : 'red', slot: value };
}

const effectIds: Record<string, string> = {
  伤害: 'damage', 治疗: 'healing', 护盾: 'shield', 控制: 'control', 驱散: 'dispel', 拉条: 'gauge_push', 推条: 'gauge_pull', 复活: 'revive', 其他: 'other',
};

export function createDuelMatch(heroes: DuelHeroCatalogEntry[], suits: DuelSuitCatalogEntry[]): DuelMatchRecord {
  const now = new Date().toISOString();
  return {
    schema: DUEL_DATA_SCHEMA, schemaVersion: DUEL_DATA_VERSION, matchId: createDuelId('match'), source: 'manual', status: 'in_progress',
    panelConvention: { percentageFields: ['crit', 'critDamage', 'hit', 'resist'], storedAs: 'fraction' },
    createdAt: now, updatedAt: now, currentCycle: 1, currentRound: 1,
    rosters: {
      red: Array.from({ length: 5 }, (_, slot) => normalizeFighter(null, 'red', slot, heroes, suits)),
      blue: Array.from({ length: 5 }, (_, slot) => normalizeFighter(null, 'blue', slot, heroes, suits)),
    },
    summons: [], actions: [],
  };
}

export function loadDuelDataset(value: unknown, heroes: DuelHeroCatalogEntry[], suits: DuelSuitCatalogEntry[]): DuelDatasetStore {
  const saved = isRecord(value) ? value : {};
  if (Array.isArray(saved.matches)) {
    const matches = saved.matches.map(item => loadDuelMatch(item, heroes, suits));
    const unique = new Map<string, DuelMatchRecord>();
    for (const match of matches) unique.set(match.matchId, match);
    const records = [...unique.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const activeMatchId = typeof saved.activeMatchId === 'string' && unique.has(saved.activeMatchId)
      ? saved.activeMatchId
      : records.at(-1)?.matchId ?? '';
    return { schema: DUEL_DATA_SCHEMA, schemaVersion: DUEL_DATA_VERSION, exportedAt: new Date().toISOString(), activeMatchId, matches: records };
  }
  const legacyMatch = loadDuelMatch(value, heroes, suits);
  return { schema: DUEL_DATA_SCHEMA, schemaVersion: DUEL_DATA_VERSION, exportedAt: new Date().toISOString(), activeMatchId: legacyMatch.matchId, matches: [legacyMatch] };
}

export function loadDuelMatch(value: unknown, heroes: DuelHeroCatalogEntry[], suits: DuelSuitCatalogEntry[]): DuelMatchRecord {
  const saved = isRecord(value) ? value : {};
  const match = createDuelMatch(heroes, suits);
  if (isRecord(saved.rosters)) for (const side of ['red', 'blue'] as const) {
    const values = Array.isArray(saved.rosters[side]) ? saved.rosters[side] as unknown[] : [];
    match.rosters[side] = Array.from({ length: 5 }, (_, slot) => normalizeFighter(values[slot], side, slot, heroes, suits));
  }
  if (Array.isArray(saved.summons)) match.summons = saved.summons.flatMap((raw): DuelSummonRecord[] => {
    if (!isRecord(raw) || !isSide(raw.side) || typeof raw.summonId !== 'string' || typeof raw.ownerFighterId !== 'string' || !Number.isInteger(raw.ownerSlot) || !Number.isInteger(raw.ownerHeroId) || typeof raw.name !== 'string') return [];
    return [{ summonId: raw.summonId, side: raw.side, ownerSlot: Number(raw.ownerSlot), ownerFighterId: raw.ownerFighterId, ownerHeroId: Number(raw.ownerHeroId), name: raw.name, active: raw.active !== false, summonedAt: typeof raw.summonedAt === 'string' ? raw.summonedAt : match.createdAt }];
  });
  if (typeof saved.matchId === 'string' && saved.matchId) match.matchId = saved.matchId;
  if (typeof saved.createdAt === 'string') match.createdAt = saved.createdAt;
  if (typeof saved.updatedAt === 'string') match.updatedAt = saved.updatedAt;
  if (typeof saved.savedAt === 'string') match.savedAt = saved.savedAt;
  if (typeof saved.savedFromMatchId === 'string') match.savedFromMatchId = saved.savedFromMatchId;
  if (Number.isInteger(saved.currentCycle) && Number(saved.currentCycle) > 0) match.currentCycle = Number(saved.currentCycle);
  else match.currentCycle = 1;
  if (Number.isInteger(saved.round) && Number(saved.round) > 0) match.currentRound = Number(saved.round);
  else if (Number.isInteger(saved.currentRound) && Number(saved.currentRound) > 0) match.currentRound = Number(saved.currentRound);
  if (Array.isArray(saved.actions)) {
    match.actions = saved.actions.flatMap((raw, index) => {
      if (!isRecord(raw) || !isSide(raw.side) || !(Number.isInteger(raw.actorSlot) || Number.isInteger(raw.actor))) return [];
      const side = raw.side, actorSlot = Number.isInteger(raw.actorSlot) ? Number(raw.actorSlot) : Number(raw.actor);
      const actorFallback = match.rosters[side][actorSlot] ?? normalizeFighter(raw.actorSnapshot, side, actorSlot, heroes, suits);
      const rawTargets = Array.isArray(raw.targets) ? raw.targets.filter(finite) : [];
      const rawEffectTargets = Array.isArray(raw.effectTargets) ? raw.effectTargets.filter(finite) : [];
      const targetSnapshots = Array.isArray(raw.targetSnapshots) ? raw.targetSnapshots : [];
      const effectTargetSnapshots = Array.isArray(raw.effectTargetSnapshots) ? raw.effectTargetSnapshots : [];
      const refFor = (code: number): DuelFighterRecord => {
        const target = decodeTarget(code, side);
        return snapshotDuelFighter(match.rosters[target.side][target.slot] ?? normalizeFighter(null, target.side, target.slot, heroes, suits));
      };
      const actionSide = isSide(raw.side) ? raw.side : side;
      const targets = Array.isArray(raw.targetFighterIds) && raw.targetFighterIds.every(item => typeof item === 'string') ? raw.targetFighterIds as string[] : rawTargets.map(code => refFor(code).fighterId);
      const effectTargets = Array.isArray(raw.effectTargetFighterIds) && raw.effectTargetFighterIds.every(item => typeof item === 'string') ? raw.effectTargetFighterIds as string[] : rawEffectTargets.map(code => refFor(code).fighterId);
      const fallbackById = (id: string, ownerSide: DuelSide): DuelFighterRecord => match.rosters[ownerSide].find(fighter => fighter.fighterId === id) ?? normalizeFighter(null, ownerSide, 0, heroes, suits);
      const skillName = typeof raw.skillName === 'string' ? raw.skillName : typeof raw.skill === 'string' ? raw.skill : '普攻';
      const effectName = typeof raw.effectName === 'string' ? raw.effectName : typeof raw.effect === 'string' ? raw.effect : '其他';
      return [{
        actionId: typeof raw.actionId === 'string' ? raw.actionId : createDuelId('action'),
        sequence: Number.isInteger(raw.sequence) && Number(raw.sequence) > 0 ? Number(raw.sequence) : index + 1,
        occurredAt: typeof raw.occurredAt === 'string' ? raw.occurredAt : (typeof saved.updatedAt === 'string' ? saved.updatedAt : match.updatedAt),
        cycle: Number.isInteger(raw.cycle) && Number(raw.cycle) > 0 ? Number(raw.cycle) : match.currentCycle,
        round: Number.isInteger(raw.round) && Number(raw.round) > 0 ? Number(raw.round) : match.currentRound,
        side: actionSide, actorSlot, actorFighterId: typeof raw.actorFighterId === 'string' ? raw.actorFighterId : actorFallback.fighterId,
        actorSnapshot: snapshotRef(raw.actorSnapshot, actorFallback),
        targetSides: Array.isArray(raw.targetSides) && raw.targetSides.every(item => item === 'ally' || item === 'enemy' || item === 'self')
          ? raw.targetSides as DuelTargetSide[] : [],
        targetShape: raw.targetShape === 'single' || raw.targetShape === 'multiple' || raw.targetShape === 'all' || raw.targetShape === 'none' ? raw.targetShape : 'none',
        inferenceConfident: raw.inferenceConfident === true,
        skillId: typeof raw.skillId === 'string' ? raw.skillId : skillName === '普攻' ? 'basic_attack' : `legacy:${skillName}`,
        skillName, skillCost: finite(raw.skillCost) ? raw.skillCost : null,
        targetFighterIds: targets,
        targetSnapshots: targetSnapshots.length
          ? targetSnapshots.map((snapshot, targetIndex) => snapshotRef(snapshot, fallbackById(targets[targetIndex] ?? '', side)))
          : rawTargets.map(code => refFor(code)),
        effectId: typeof raw.effectId === 'string' ? raw.effectId : effectIds[effectName] ?? 'other',
        effectIds: Array.isArray(raw.effectIds) && raw.effectIds.every(item => typeof item === 'string') ? raw.effectIds as string[] : [typeof raw.effectId === 'string' ? raw.effectId : effectIds[effectName] ?? 'other'],
        effectName,
        effectTargetFighterIds: effectTargets,
        effectTargetSnapshots: effectTargetSnapshots.length
          ? effectTargetSnapshots.map((snapshot, targetIndex) => snapshotRef(snapshot, fallbackById(effectTargets[targetIndex] ?? '', side)))
          : rawEffectTargets.map(code => refFor(code)),
        effectValue: finite(raw.effectValue) ? raw.effectValue : null,
        effectUnit: typeof raw.effectUnit === 'string' ? raw.effectUnit : null,
        detail: typeof raw.detail === 'string' ? raw.detail : '',
      }];
    });
    match.actions.sort((left, right) => left.sequence - right.sequence);
    match.actions.forEach((action, index) => { action.sequence = index + 1; });
  }
  match.schema = DUEL_DATA_SCHEMA; match.schemaVersion = DUEL_DATA_VERSION; match.source = 'manual';
  match.status = saved.status === 'complete' ? 'complete' : 'in_progress';
  return match;
}

export function exportDuelDataset(matches: DuelMatchRecord[]): DuelDatasetExport {
  return { schema: DUEL_DATA_SCHEMA, schemaVersion: DUEL_DATA_VERSION, exportedAt: new Date().toISOString(), matches: [...matches] };
}
