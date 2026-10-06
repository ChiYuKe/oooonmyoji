import { evaluatePlan, planScore, PANEL_LABELS } from './soul-optimizer';
import type { OptimizationOptions, Panel, PanelKey, SuitProfile } from './soul-optimizer';
import type { SoulAttribute, SoulRecord } from './souls';
import { OBJECTIVE_SUBSTATS, suitMechanicRanges } from './soul-substat-standard';
import { SIX_STAR_SUBSTAT_ROLLS, SIX_STAR_MAIN_VALUES, BOSS_INTRINSIC_VALUES, SIX_STAR_SUBSTAT_MIN_FACTOR, REFERENCE_SUBSTAT_MAX_FACTOR, SIX_STAR_SUBSTAT_MAX_ALLOCATIONS, SIX_STAR_SUBSTAT_TOTAL_ALLOCATIONS } from './soul-attribute-limits';
import type { SoulTargetAnalysis } from './soul-target-analysis';
import { SOUL_MAIN_ATTRIBUTE_LABELS, SOUL_SLOT_MAIN_ATTRIBUTES } from './soul-slots';

export interface SoulReference { souls: SoulRecord[]; panel: Panel; score: number; meetsTarget: boolean }
export interface SoulReferenceResult { configs: SoulReference[]; reason?: string }
const panelAttributes: Record<PanelKey, string[]> = {
  attack: ['attackAdditionRate', 'attackAdditionVal'], hp: ['maxHpAdditionRate', 'maxHpAdditionVal'],
  defense: ['defenseAdditionRate', 'defenseAdditionVal'], speed: ['speedAdditionVal'],
  crit: ['critRateAdditionVal'], critDamage: ['critPowerAdditionVal'], hit: ['debuffEnhance'], resist: ['debuffResist'],
};
const flat = new Set(['attackAdditionVal', 'maxHpAdditionVal', 'defenseAdditionVal', 'speedAdditionVal']);
const allowedMains = (position: number, options: OptimizationOptions): readonly string[] => {
  const legal = SOUL_SLOT_MAIN_ATTRIBUTES[position] ?? [];
  const selected = options.mainAttributes[position];
  return selected?.length ? legal.filter(name => selected.includes(name)) : legal;
};
const key = (souls: readonly SoulRecord[]): string => souls.map(s => [
  `${s.position}:${s.suitId}`,
  `${s.mainAttribute!.name}:${s.mainAttribute!.value}`,
  s.subAttributes!.map(a => `${a.name}:${a.value}`).join(','),
  (s.intrinsicAttributes ?? []).map(a => `${a.name}:${a.value}`).join(','),
].join(';')).join('|');
function contribution(subs: readonly SoulAttribute[], base: Panel): Panel {
  const result: Panel = { attack: 0, hp: 0, defense: 0, speed: 0, crit: 0, critDamage: 0, hit: 0, resist: 0 };
  for (const attr of subs) for (const [panelKey, names] of Object.entries(panelAttributes)) {
    if (names.includes(attr.name)) result[panelKey as PanelKey] += attr.value * (attr.name.endsWith('Rate') ? base[panelKey as PanelKey] : 1);
  }
  return result;
}
function sampledSubstats(source: SoulRecord, names: readonly string[], counts: readonly number[], variant: number): SoulAttribute[] {
  // A reproducible sample of each allocation, not one shared quality multiplier for the whole item.
  // The 98% sampling ceiling deliberately excludes perfect theoretical rolls from recommendations.
  const seed = `${source.position}:${source.suitId}:${source.mainAttribute!.name}:${names.join(',')}:${counts.join(',')}:${variant}`;
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  const random = (): number => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  return names.map((name, index) => {
    let total = 0;
    for (let roll = 0; roll < counts[index]; roll++) total += SIX_STAR_SUBSTAT_ROLLS[name] * (SIX_STAR_SUBSTAT_MIN_FACTOR + (REFERENCE_SUBSTAT_MAX_FACTOR - SIX_STAR_SUBSTAT_MIN_FACTOR) * random());
    return { name, label: name, percent: !flat.has(name), rolls: counts[index], value: Number(total.toFixed(8)) };
  });
}
function candidatesForMain(source: SoulRecord, options: OptimizationOptions, analysis: SoulTargetAnalysis, boss: boolean): SoulRecord[] {
  const intrinsics: SoulAttribute[][] = boss ? Object.entries(BOSS_INTRINSIC_VALUES).map(([name, value]) => [
    { name, value, label: SOUL_MAIN_ATTRIBUTE_LABELS[name], percent: true, rolls: 1 },
  ]) : [[]];
  const required = Object.entries(analysis.ranges).filter(([, range]) => range.min != null).flatMap(([name]) => panelAttributes[name as PanelKey]);
  const preferred = [...new Set([...OBJECTIVE_SUBSTATS[options.objective], ...required])].filter(name => name !== source.mainAttribute!.name);
  const fillers = Object.keys(SIX_STAR_SUBSTAT_ROLLS).filter(name => name !== source.mainAttribute!.name);
  const patterns = new Map<string, string[]>();
  const add = (names: string[]): void => {
    const pattern = [...new Set(names)].filter(name => name !== source.mainAttribute!.name).slice(0, 4);
    if (pattern.length === 4) patterns.set([...pattern].sort().join(','), pattern);
  };
  add((source.subAttributes ?? []).map(a => a.name));
  // Vary the fourth attribute as well as the balance of objective and required stats.
  for (let offset = 0; offset < Math.max(1, preferred.length); offset++) {
    const rotated = [...preferred.slice(offset), ...preferred.slice(0, offset)];
    for (const filler of fillers) add([...rotated.slice(0, 3), filler, ...rotated, ...fillers]);
  }
  const result: SoulRecord[] = [];
  for (const names of patterns.values()) for (let a = 1; a <= SIX_STAR_SUBSTAT_MAX_ALLOCATIONS; a++) for (let b = 1; b <= SIX_STAR_SUBSTAT_MAX_ALLOCATIONS; b++) for (let c = 1; c <= SIX_STAR_SUBSTAT_MAX_ALLOCATIONS; c++) {
    const d = SIX_STAR_SUBSTAT_TOTAL_ALLOCATIONS - a - b - c; if (d < 1 || d > SIX_STAR_SUBSTAT_MAX_ALLOCATIONS) continue;
    const counts = [a, b, c, d];
    // Output recommendations must not spend repeated allocations on unrelated defense/hit just to lower their score.
    if (options.objective === 'damage' && names.some((name, index) => !preferred.includes(name) && counts[index] > 1)) continue;
    for (let variant = 0; variant < 3; variant++) {
      const subAttributes = sampledSubstats(source, names, counts, variant);
      for (const intrinsicAttributes of intrinsics) result.push({
        id: `reference-slot-${source.position}-${source.mainAttribute!.name}-${result.length}`, itemId: null, suitId: source.suitId, position: source.position,
        stars: 6, level: 15, locked: false, equipped: false, discarded: false, baseAttributeIndex: null, baseValue: null,
        name: source.name, iconKey: source.iconKey, iconUrl: source.iconUrl, attributeRolls: [], attributesComplete: true,
        mainAttribute: { ...source.mainAttribute! }, intrinsicAttributes: intrinsicAttributes.map(attr => ({ ...attr })),
        subAttributes: subAttributes.map(attr => ({ ...attr })),
      });
    }
  }
  return result;
}
function candidates(source: SoulRecord, options: OptimizationOptions, analysis: SoulTargetAnalysis, boss: boolean): SoulRecord[] {
  return allowedMains(source.position!, options).flatMap(name => candidatesForMain({ ...source, mainAttribute: {
    name, value: SIX_STAR_MAIN_VALUES[name], label: SOUL_MAIN_ATTRIBUTE_LABELS[name], percent: !flat.has(name), rolls: 1,
  } }, options, analysis, boss));
}

/** Set bonuses depend on counts, while main attributes belong to positions.
 * Assign the same set counts freely without moving a position's main/substats.
 * Intrinsics travel with their set, so only boss pieces carry boss intrinsics. */
function flexibleSuitLayouts(source: readonly SoulRecord[]): number[][] {
  const counts = new Map<number, number>();
  for (const soul of source) counts.set(soul.suitId!, (counts.get(soul.suitId!) ?? 0) + 1);
  const ids = [...counts.keys()].sort((a, b) => a - b), result: number[][] = [];
  const visit = (layout: number[]): void => {
    if (layout.length === 6) { result.push([...layout]); return; }
    for (const id of ids) if (counts.get(id)!) {
      counts.set(id, counts.get(id)! - 1); layout.push(id); visit(layout); layout.pop(); counts.set(id, counts.get(id)! + 1);
    }
  };
  visit([]); return result;
}
function assignSuitLayout(souls: readonly SoulRecord[], layout: readonly number[], sources: readonly SoulRecord[], catalog: Map<number, SuitProfile>): SoulRecord[] {
  const pieces = new Map<number, SoulRecord[]>();
  for (const soul of souls) { const group = pieces.get(soul.suitId!) ?? []; group.push(soul); pieces.set(soul.suitId!, group); }
  return souls.map((soul, index) => {
    const suitId = layout[index], piece = pieces.get(suitId)!.shift()!, metadata = sources.find(source => source.suitId === suitId)!;
    return { ...soul, id: `reference-slot-${index + 1}-suit-${suitId}-${soul.id}`, suitId,
      name: catalog.get(suitId)!.name, iconKey: metadata.iconKey, iconUrl: metadata.iconUrl,
      mainAttribute: { ...soul.mainAttribute! }, subAttributes: soul.subAttributes!.map(attribute => ({ ...attribute })),
      intrinsicAttributes: (piece.intrinsicAttributes ?? []).map(attribute => ({ ...attribute })),
    };
  });
}

/** Independent hypothetical replacement gear. Never alters or reuses actual inventory IDs. */
export function generateSoulReferences(analysis: SoulTargetAnalysis, options: OptimizationOptions, catalog: SuitProfile[]): SoulReferenceResult {
  if (analysis.souls.some(s => s.stars !== 6 || s.level !== 15)) return { configs: [], reason: '系统参考配置目前适用于六星 +15 方案。' };
  const fail = (reason: string): SoulReferenceResult => ({ configs: [], reason });
  const ranges: OptimizationOptions['ranges'] = {};
  // Intersect the user's options and analysis constraints; a stale report cannot silently drop a restriction.
  for (const name of new Set([...Object.keys(options.ranges), ...Object.keys(analysis.ranges)])) {
    if (!Object.hasOwn(PANEL_LABELS, name)) return fail('属性限制无效，请检查后重新计算。');
    const range: {min?: number; max?: number} = {};
    for (const bounds of [options.ranges[name as PanelKey], analysis.ranges[name as PanelKey]]) {
      if (!bounds) continue;
      for (const amount of [bounds.min, bounds.max]) if (amount != null && (!Number.isFinite(amount) || amount < 0)) return fail('属性范围无效，请检查上下限。');
      if (bounds.min != null) range.min = Math.max(range.min ?? 0, bounds.min);
      if (bounds.max != null) range.max = Math.min(range.max ?? Infinity, bounds.max);
    }
    ranges[name as PanelKey] = range;
  }
  analysis = {...analysis, ranges: suitMechanicRanges(analysis.souls, ranges)};
  if (Object.values(analysis.ranges).some(range => range.min != null && range.max != null && range.min > range.max)) return fail('属性上下限冲突，无法生成同时满足全部限制的参考配置。');
  if (!Number.isFinite(analysis.target) || analysis.target < 0 || (analysis.targetMax != null && (!Number.isFinite(analysis.targetMax) || analysis.targetMax < analysis.target))) return fail('目标评分范围无效，请检查上下限。');
  const suits = new Map(catalog.map(suit => [suit.id, suit]));
  const templateMatches = (souls: readonly SoulRecord[], checkMains = true): boolean => {
    if (souls.length !== 6 || new Set(souls.map(soul => soul.position)).size !== 6) return false;
    const counts = new Map<number, number>();
    for (const [index, soul] of souls.entries()) {
      if (soul.position !== index + 1 || !soul.mainAttribute || !suits.has(soul.suitId!)) return false;
      if (!SOUL_SLOT_MAIN_ATTRIBUTES[soul.position]?.includes(soul.mainAttribute.name)) return false;
      if (checkMains && !allowedMains(soul.position, options).includes(soul.mainAttribute.name)) return false;
      counts.set(soul.suitId!, (counts.get(soul.suitId!) ?? 0) + 1);
    }
    const requirements = new Map<number, number>();
    for (const requirement of options.requirements) requirements.set(requirement.suitId, (requirements.get(requirement.suitId) ?? 0) + requirement.count);
    for (const [id, count] of requirements) if ((counts.get(id) ?? 0) < count) return false;
    return !options.twoPieceAttribute || [...counts].some(([id, count]) => count >= 2 && suits.get(id)?.bonus?.name === options.twoPieceAttribute);
  };
  if (!templateMatches(analysis.souls, false)) return fail('原方案的套装与当前限制不符，请重新计算后生成参考配置。');
  const bounds = Object.entries(analysis.ranges) as Array<[PanelKey, { min?: number; max?: number }]>;
  const scale = Math.max(1e-6, analysis.target, analysis.targetMax ?? 0, analysis.currentScore);
  const distance = (score: number): number => Math.max(0, analysis.target - score, analysis.targetMax == null ? 0 : score - analysis.targetMax);
  const violations = (panel: Panel): number => bounds.reduce((sum, [name, range]) => sum +
    Math.max(0, (range.min ?? -Infinity) - panel[name], panel[name] - (range.max ?? Infinity)) /
    Math.max(.01, Math.abs(range.min ?? range.max ?? 1)), 0);
  const withinBounds = (panel: Panel): boolean => Object.values(panel).every(Number.isFinite) && bounds.every(([name, range]) =>
    (range.min == null || panel[name] + 1e-9 >= range.min) && (range.max == null || panel[name] - 1e-9 <= range.max));
  const fitness = (panel: Panel): number => {
    const score = planScore(panel, options.objective);
    // Panel constraints take priority. Within the goal range prefer its lower bound (or upper bound for upper-only goals).
    const aim = analysis.target > 0 ? analysis.target : analysis.targetMax ?? score;
    const wastedCrit = options.objective === 'damage' ? Math.max(0, panel.crit - Math.max(1, analysis.ranges.crit?.min ?? 0)) : 0;
    return violations(panel) * 1000 + distance(score) / scale * 10 + wastedCrit * .01 + Math.abs(score - aim) / scale * .001;
  };
  const relevantKeys = [...new Set<PanelKey>([...(options.objective === 'damage' ? ['attack', 'crit', 'critDamage'] as const : [options.objective]), ...bounds.map(([name]) => name)])];
  const panelKey = (panel: Panel): string => relevantKeys.map(name => panel[name].toFixed(8)).join('|');
  const pools = analysis.souls.map(s => candidates(s, options, analysis, Boolean(catalog.find(suit => suit.id === s.suitId)?.boss)));
  if (pools.some(pool => !pool.length)) return { configs: [], reason: '当前主属性无法生成完整参考配置。' };
  const contributions = pools.map(pool => pool.map(s => contribution([s.mainAttribute!, ...s.subAttributes!, ...(s.intrinsicAttributes ?? [])], options.base)));
  const seed = pools.map(pool => pool[Math.floor(pool.length / 2)]);
  type State = { souls: SoulRecord[]; panel: Panel; rank: number };
  const seedPanel = evaluatePlan(seed, options.base, catalog);
  let beam: State[] = [{ souls: seed, panel: seedPanel, rank: fitness(seedPanel) }];
  const found = new Map<string, State>();
  for (let pass = 0; pass < 2; pass++) for (let slot = 0; slot < 6; slot++) {
    const next: State[] = []; const seen = new Set<string>();
    for (const state of beam) {
      const previousSoul = state.souls[slot];
      const previous = contribution([previousSoul.mainAttribute!, ...previousSoul.subAttributes!, ...(previousSoul.intrinsicAttributes ?? [])], options.base);
      for (let index = 0; index < pools[slot].length; index++) {
        const panel = { ...state.panel }, candidate = contributions[slot][index];
        for (const name of Object.keys(panel) as PanelKey[]) panel[name] += candidate[name] - previous[name];
        const rank = fitness(panel);
        if (next.length === 8 && rank >= next[7].rank) continue;
        const signature = panelKey(panel);
        if (seen.has(signature)) continue;
        const souls = [...state.souls]; souls[slot] = pools[slot][index];
        seen.add(signature); next.push({ souls, panel, rank }); next.sort((a, b) => a.rank - b.rank); if (next.length > 8) next.pop();
      }
    }
    beam = next;
    for (const state of beam) if (withinBounds(state.panel)) found.set(key(state.souls), state);
  }
  // Recompute and enforce every hard constraint before selecting display results. Never fall back to near misses.
  const achieved = [...found.values()].map(state => {
    const panel = evaluatePlan(state.souls, options.base, catalog);
    return {...state, panel, score: planScore(panel, options.objective), rank: fitness(panel)};
  }).filter(state => templateMatches(state.souls) && withinBounds(state.panel) && Number.isFinite(state.score) && distance(state.score) <= 1e-9)
    .sort((a, b) => a.rank - b.rank);
  const selected = new Set<string>();
  const layouts = flexibleSuitLayouts(analysis.souls), originalLayout = analysis.souls.map(soul => soul.suitId!);
  const chosenLayouts: number[][] = [];
  const layoutDistance = (a: readonly number[], b: readonly number[]): number => a.reduce((sum, id, index) => sum + Number(id !== b[index]), 0);
  const configs = achieved.filter(state => {
    const signature = panelKey(state.panel); if (selected.has(signature)) return false;
    selected.add(signature); return true;
  }).slice(0, 3).map(state => {
    const available = layouts.filter(layout => !chosenLayouts.some(chosen => layoutDistance(layout, chosen) === 0));
    const layout = (available.length ? available : layouts).slice().sort((a, b) => {
      const score = (candidate: number[]): number => Math.min(...[originalLayout, ...chosenLayouts].map(other => layoutDistance(candidate, other)));
      return score(b) - score(a) || layoutDistance(b, originalLayout) - layoutDistance(a, originalLayout) || a.join(',').localeCompare(b.join(','));
    })[0];
    chosenLayouts.push(layout);
    const souls = assignSuitLayout(state.souls, layout, analysis.souls, suits);
    const panel = evaluatePlan(souls, options.base, catalog), score = planScore(panel, options.objective);
    return { souls, panel, score, meetsTarget: templateMatches(souls) && withinBounds(panel) && Number.isFinite(score) && distance(score) <= 1e-9 };
  }).filter(reference => reference.meetsTarget);
  return { configs, reason: !configs.length ? '本次生成未找到同时满足目标评分范围和全部限制的参考配置。条件保持不变，结果不代表理论上限。' : undefined };
}
