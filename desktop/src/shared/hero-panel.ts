import type { OwnedHero } from './hero-ownership';
import { evaluatePlan, PANEL_LABELS, type HeroProfile, type Panel, type PanelKey, type SuitProfile } from './soul-optimizer';
import type { SoulRecord } from './souls';

export interface HeroBaseRequest { heroId: number; level: number; stars: number; awake: boolean }
export const PANEL_KEYS = Object.keys(PANEL_LABELS) as PanelKey[];
export const EMPTY_PANEL: Panel = { attack: 0, hp: 0, defense: 0, speed: 0, crit: 0, critDamage: 0, hit: 0, resist: 0 };

export function readHeroPanel(value: unknown): Panel | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (PANEL_KEYS.some(key => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || (data[key] as number) < 0)) return null;
  return Object.fromEntries(PANEL_KEYS.map(key => [key, data[key]])) as Panel;
}

export function ownedHeroBaseRequest(copy: OwnedHero, profile: HeroProfile): HeroBaseRequest {
  return { heroId: copy.heroId, level: copy.level, stars: copy.stars,
    awake: [1, 5, 6].includes(profile.rarity) ? false : copy.awake };
}

/** The offline encyclopedia is specifically level 40, six stars, in its recorded form. */
export function catalogHeroBase(request: HeroBaseRequest, profile: HeroProfile): Panel | null {
  return request.heroId === profile.id && request.level === 40 && request.stars === 6 && request.awake === Boolean(profile.awake)
    ? readHeroPanel(profile.base) : null;
}

export interface OwnedEquipmentPanel {
  total: Panel | null;
  addition: Record<PanelKey, number | null>;
  incomplete: boolean;
}

export function ownedEquipmentPanel(copy: OwnedHero, records: ReadonlyMap<string, SoulRecord>, base: Panel | null, catalog: SuitProfile[]): OwnedEquipmentPanel {
  const souls = copy.equips.filter((id): id is string => Boolean(id)).map(id => records.get(id));
  const missing = souls.some(soul => !soul?.attributesComplete || !soul.mainAttribute
    || !catalog.some(suit => suit.id === soul.suitId)
    || [soul.mainAttribute, ...(soul.subAttributes ?? []), ...(soul.intrinsicAttributes ?? [])].some(attr => !Number.isFinite(attr.value) || attr.value < 0));
  if (missing) return { total: null, addition: Object.fromEntries(PANEL_KEYS.map(key => [key, null])) as OwnedEquipmentPanel['addition'], incomplete: true };
  const equipped = souls as SoulRecord[];
  if (base) {
    const total = evaluatePlan(equipped, base, catalog);
    return { total, addition: Object.fromEntries(PANEL_KEYS.map(key => [key, total[key] - base[key]])) as Panel, incomplete: false };
  }
  // Flat values and percentage points remain exact offline. Base-scaled additions wait for the actual base.
  const flat = evaluatePlan(equipped, EMPTY_PANEL, catalog);
  const unit = evaluatePlan(equipped, Object.fromEntries(PANEL_KEYS.map(key => [key, 1])) as Panel, catalog);
  return { total: null, addition: Object.fromEntries(PANEL_KEYS.map(key => [key,
    Math.abs(unit[key] - flat[key] - 1) < 1e-9 ? flat[key] : null])) as OwnedEquipmentPanel['addition'], incomplete: false };
}
