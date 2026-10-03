import type { SoulRecord } from './souls';

export interface OwnedHero {
  id: string;
  heroId: number;
  level: number;
  stars: number;
  awake: boolean;
  locked: boolean;
  skills: Array<{ id: number; level: number }>;
  /** Six positions in order; null means that slot is unequipped. */
  equips: Array<string | null>;
}

/** A complete inventory scan, separate from the static encyclopedia. */
export interface HeroOwnershipSnapshot {
  instanceId: string;
  fetchedAt: string;
  total: number;
  counts: Record<string, number>;
  source: 'memory';
  /** Absent in older count-only caches. */
  heroes?: OwnedHero[];
  equippedSouls?: SoulRecord[];
}

export interface HeroOwnershipProgress {
  instanceId: string;
  message: string;
  completed?: number;
  total?: number;
}

export function readHeroOwnership(value: unknown, instanceId: string): HeroOwnershipSnapshot | null {
  const data = value as HeroOwnershipSnapshot | null;
  if (!data || data.instanceId !== instanceId || data.source !== 'memory'
    || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt))
    || !Number.isSafeInteger(data.total) || data.total < 0
    || !data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts)) return null;
  let total = 0;
  for (const [id, count] of Object.entries(data.counts)) {
    if (!/^[1-9]\d{0,8}$/.test(id) || !Number.isSafeInteger(count) || count <= 0) return null;
    total += count;
  }
  if (total !== data.total) return null;
  if (data.heroes === undefined && data.equippedSouls === undefined) return data;
  if (!Array.isArray(data.heroes) || data.heroes.length !== total || !Array.isArray(data.equippedSouls)) return null;
  const ids = new Set<string>(), counts: Record<string, number> = {}, souls = new Map<string, SoulRecord>();
  const integer = (v: unknown, lo: number, hi: number): boolean => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;
  for (const soul of data.equippedSouls) {
    if (!soul || typeof soul.id !== 'string' || !soul.id || souls.has(soul.id)
      || !integer(soul.position, 1, 6) || !integer(soul.stars, 1, 6) || !integer(soul.level, 0, 15)
      || !integer(soul.itemId, 1, 999999999) || !integer(soul.suitId, 1, 999999999)
      || !Array.isArray(soul.attributeRolls) || soul.attributeRolls.some(a => !a || typeof a.name !== 'string' || !Number.isFinite(a.factor))) return null;
    for (const attributes of [soul.mainAttribute ? [soul.mainAttribute] : [], soul.subAttributes ?? [], soul.intrinsicAttributes ?? []]) {
      if (!Array.isArray(attributes) || attributes.some(a => !a || typeof a.name !== 'string' || typeof a.label !== 'string'
        || !Number.isFinite(a.value) || typeof a.percent !== 'boolean' || !integer(a.rolls, 0, 100))) return null;
    }
    if (soul.setEffects !== undefined && (!Array.isArray(soul.setEffects) || soul.setEffects.some(s => typeof s !== 'string'))) return null;
    souls.set(soul.id, soul);
  }
  for (const hero of data.heroes) {
    if (!hero || typeof hero.id !== 'string' || !hero.id || ids.has(hero.id) || !integer(hero.heroId, 1, 999999999)
      || !integer(hero.level, 1, 60) || !integer(hero.stars, 1, 6) || typeof hero.awake !== 'boolean' || typeof hero.locked !== 'boolean'
      || !Array.isArray(hero.skills) || hero.skills.some(s => !s || !integer(s.id, 1, 999999999) || !integer(s.level, 1, 20))
      || new Set(hero.skills.map(s => s.id)).size !== hero.skills.length
      || !Array.isArray(hero.equips) || hero.equips.length !== 6
      || hero.equips.some((id, i) => id !== null && (typeof id !== 'string' || !id || souls.get(id)?.position !== i + 1))) return null;
    ids.add(hero.id); counts[hero.heroId] = (counts[hero.heroId] ?? 0) + 1;
  }
  return Object.keys(counts).length === Object.keys(data.counts).length
    && Object.entries(counts).every(([id, count]) => data.counts[id] === count) ? data : null;
}

export interface OwnedHeroGroup { hero: OwnedHero; count: number; lockedCount: number; ids: string[] }

/** UID and locking are instance metadata, not differences in build configuration. */
export function groupOwnedHeroes(snapshot: HeroOwnershipSnapshot, heroId: number): OwnedHeroGroup[] {
  const souls = new Map(snapshot.equippedSouls?.map(s => [s.id, s]));
  const groups = new Map<string, OwnedHeroGroup>();
  for (const hero of snapshot.heroes ?? []) {
    if (hero.heroId !== heroId) continue;
    const key = JSON.stringify([hero.heroId, hero.level, hero.stars, hero.awake,
      [...hero.skills].sort((a, b) => a.id - b.id).map(s => [s.id, s.level]),
      hero.equips.map(id => {
        if (!id) return null;
        const soul = souls.get(id);
        if (!soul) return ['unresolved', id];
        const attrs = (values: SoulRecord['subAttributes']) => [...(values ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map(a => [a.name, a.value, a.percent, a.rolls]);
        return [soul.itemId, soul.suitId, soul.position, soul.stars, soul.level, soul.baseAttributeIndex, soul.baseValue,
          attrs(soul.mainAttribute ? [soul.mainAttribute] : []), attrs(soul.subAttributes), attrs(soul.intrinsicAttributes),
          [...soul.attributeRolls].sort((a, b) => a.name.localeCompare(b.name) || a.factor - b.factor), soul.attributesComplete];
      })]);
    const group = groups.get(key);
    if (group) { group.count++; group.lockedCount += Number(hero.locked); group.ids.push(hero.id); }
    else groups.set(key, { hero, count: 1, lockedCount: Number(hero.locked), ids: [hero.id] });
  }
  return [...groups.values()].sort((a, b) => b.hero.level - a.hero.level || b.hero.stars - a.hero.stars || b.count - a.count);
}
