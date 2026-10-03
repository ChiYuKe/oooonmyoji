import type { SoulRecord } from './souls';
import { SOUL_SLOT_MAIN_ATTRIBUTES, SOUL_SLOT_DEFAULT_MAIN_ATTRIBUTES } from './soul-slots';

export const PANEL_LABELS = { attack: '攻击', hp: '生命', defense: '防御', speed: '速度', crit: '暴击', critDamage: '暴击伤害', hit: '效果命中', resist: '效果抵抗' } as const;
export type PanelKey = keyof typeof PANEL_LABELS;
export type Panel = Record<PanelKey, number>;
export const OPTIMIZATION_OBJECTIVES = {
  damage: { label: '伤害输出', description: '按攻击 × 期望暴击倍率评分，暴击收益最多计入 100%。', percent: false },
  attack: { label: '攻击', description: '优先提高配装后的总攻击，可同时设置速度、暴击等属性限制。', percent: false },
  speed: { label: '速度', description: '优先提高配装后的总速度，主属性、副属性和面板加成均计入。', percent: false },
  hp: { label: '生命', description: '优先提高配装后的总生命，可同时设置其他属性上下限。', percent: false },
  defense: { label: '防御', description: '优先提高配装后的总防御，可同时设置生命、速度等属性限制。', percent: false },
  crit: { label: '暴击', description: '优先提高配装后的暴击，超过 100% 的面板值仍参与此指标评分。', percent: true },
  critDamage: { label: '暴击伤害', description: '优先提高配装后的暴击伤害，建议配合“暴击至少 100%”使用。', percent: true },
  hit: { label: '效果命中', description: '优先提高配装后的效果命中，可同时设置速度、生命等属性限制。', percent: true },
  resist: { label: '效果抵抗', description: '优先提高配装后的效果抵抗，可同时设置速度、生命等属性限制。', percent: true },
} as const;
export type OptimizationObjective = keyof typeof OPTIMIZATION_OBJECTIVES;
/** Main attribute each objective pairs with; a slot that cannot roll it searches every main attribute it can roll. */
export const OPTIMIZATION_MAIN_ATTRIBUTES: Readonly<Record<OptimizationObjective, string>> = {
  damage: 'attackAdditionRate', attack: 'attackAdditionRate', hp: 'maxHpAdditionRate', defense: 'defenseAdditionRate',
  speed: 'speedAdditionVal', crit: 'critRateAdditionVal', critDamage: 'critPowerAdditionVal', hit: 'debuffEnhance', resist: 'debuffResist',
};
/** Main attributes a slot should preselect for the chosen objective. */
export function objectiveMainAttributes(objective: OptimizationObjective, position: number): string[] {
  // 伤害输出 is scored as attack × crit, so it keeps the standard attack%/crit slot defaults.
  if (objective === 'damage') return [...(SOUL_SLOT_DEFAULT_MAIN_ATTRIBUTES[position] ?? SOUL_SLOT_MAIN_ATTRIBUTES[position] ?? [])];
  const allowed = SOUL_SLOT_MAIN_ATTRIBUTES[position] ?? [];
  const attribute = OPTIMIZATION_MAIN_ATTRIBUTES[objective];
  if (allowed.includes(attribute)) return [attribute];
  // 该位打不出指标对应的主属性（如 2／6 号位的效果命中、4 号位的速度）：全选该位可用主属性，
  // 只靠副属性堆指标的御魂（例如二号位速度、六号位生命加成的命中套）也能参与搜索。
  return [...allowed];
}
export function formatPlanScore(score: number, objective?: OptimizationObjective): string {
  if (!Number.isFinite(score)) return '—';
  return objective && OPTIMIZATION_OBJECTIVES[objective].percent ? `${(score * 100).toFixed(2)}%` : score.toFixed(2);
}
export interface HeroProfile { id: number; name: string; rarity: number; pinyin: string; awake?: boolean; base: Panel | null }
export interface SuitProfile { id: number; name: string; bonus: { name: string; value: number } | null; four: string; boss: boolean }
export interface OptimizationOptions {
  base: Panel;
  objective: OptimizationObjective;
  requirements: Array<{ suitId: number; count: 2 | 4 }>;
  twoPieceAttribute?: string;
  mainAttributes: Partial<Record<number, string[]>>;
  ranges: Partial<Record<PanelKey, { min?: number; max?: number }>>;
  onlySix: boolean;
  onlyMaxLevel: boolean;
  unequipped: boolean;
  excludeDiscarded: boolean;
  excludedIds: string[];
  seconds: number;
  limit: number;
}
export interface SoulPlan { ids: string[]; panel: Panel; score: number; suits: Array<{ id: number; count: number }> }
export type SoulPlanSortKey = 'score' | PanelKey;
/** Reorder the returned plans without changing the search objective or source results. */
export function sortSoulPlans(plans: readonly SoulPlan[], key: SoulPlanSortKey = 'score'): SoulPlan[] {
  return plans.map((plan, index) => ({ plan, index }))
    .sort((a, b) => (key === 'score' ? b.plan.score - a.plan.score : b.plan.panel[key] - a.plan.panel[key]) || a.index - b.index)
    .map(item => item.plan);
}
export interface SearchProgress { visited: number; elapsed: number; found: number; candidates: number[]; skipped: number }
export interface SearchResult extends SearchProgress { plans: SoulPlan[]; status: 'complete' | 'timeout' | 'cancelled' }

const ATTRS = ['attackAdditionVal', 'attackAdditionRate', 'maxHpAdditionVal', 'maxHpAdditionRate', 'defenseAdditionVal', 'defenseAdditionRate', 'speedAdditionVal', 'speedAdditionRate', 'critRateAdditionVal', 'critPowerAdditionVal', 'debuffEnhance', 'debuffResist'];
const zero = (): number[] => Array(ATTRS.length).fill(0);
const panel = (base: Panel, v: number[]): Panel => ({
  attack: base.attack * (1 + v[1]) + v[0], hp: base.hp * (1 + v[3]) + v[2],
  defense: base.defense * (1 + v[5]) + v[4], speed: base.speed * (1 + v[7]) + v[6],
  crit: base.crit + v[8], critDamage: base.critDamage + v[9], hit: base.hit + v[10], resist: base.resist + v[11],
});
export function planScore(p: Panel, objective: OptimizationOptions['objective']): number {
  return objective === 'damage' ? p.attack * (1 + Math.min(1, Math.max(0, p.crit)) * Math.max(0, p.critDamage - 1)) : p[objective];
}
function vector(soul: SoulRecord): number[] {
  const v = zero();
  for (const attr of [soul.mainAttribute!, ...(soul.subAttributes ?? []), ...(soul.intrinsicAttributes ?? [])]) {
    const index = ATTRS.indexOf(attr.name);
    if (index >= 0) v[index] += attr.value;
  }
  return v;
}
function bonuses(counts: Map<number, number>, suits: Map<number, SuitProfile>): number[] {
  const v = zero();
  for (const [id, count] of counts) {
    const bonus = suits.get(id)?.bonus;
    if (count >= 2 && bonus) { const i = ATTRS.indexOf(bonus.name); if (i >= 0) v[i] += bonus.value; }
  }
  return v;
}
export function evaluatePlan(souls: SoulRecord[], base: Panel, catalog: SuitProfile[]): Panel {
  const counts = new Map<number, number>(); const sum = zero();
  for (const soul of souls) {
    if (soul.suitId != null) counts.set(soul.suitId, (counts.get(soul.suitId) ?? 0) + 1);
    vector(soul).forEach((value, i) => { sum[i] += value; });
  }
  const extra = bonuses(counts, new Map(catalog.map(suit => [suit.id, suit])));
  return panel(base, sum.map((value, i) => value + extra[i]));
}

/** Exact branch-and-bound; a time/cancellation limit returns explicitly incomplete results.
 * Every eligible item participates. No per-slot shortlist silently removes candidates.
 */
export async function optimizeSouls(souls: SoulRecord[], catalog: SuitProfile[], options: OptimizationOptions,
  progress: (value: SearchProgress) => void = () => {}, cancelled: () => boolean = () => false): Promise<SearchResult> {
  if (!Object.hasOwn(OPTIMIZATION_OBJECTIVES, options.objective)) throw new Error('请选择有效的效果指标');
  for (const value of Object.values(options.base)) if (!Number.isFinite(value) || value < 0) throw new Error('式神基础面板必须为非负数');
  for (const range of Object.values(options.ranges)) {
    if ((range.min != null && (!Number.isFinite(range.min) || range.min < 0)) || (range.max != null && (!Number.isFinite(range.max) || range.max < 0)) || (range.min != null && range.max != null && range.min > range.max)) throw new Error('属性范围无效，请检查上下限');
  }
  const started = performance.now();
  const suitMap = new Map(catalog.map(suit => [suit.id, suit]));
  const excluded = new Set(options.excludedIds), seen = new Set<string>();
  let skipped = 0;
  const slots: Array<Array<{ soul: SoulRecord; v: number[]; rank: number }>> = Array.from({ length: 6 }, () => []);
  for (const soul of souls) {
    if (seen.has(soul.id)) continue; seen.add(soul.id);
    if (soul.position == null || !Number.isInteger(soul.position) || soul.position < 1 || soul.position > 6 || !soul.attributesComplete || !soul.mainAttribute || !suitMap.has(soul.suitId ?? -1)
      || [soul.mainAttribute, ...(soul.subAttributes ?? []), ...(soul.intrinsicAttributes ?? [])].some(attr => !Number.isFinite(attr.value) || attr.value < 0)) { skipped++; continue; }
    if (excluded.has(soul.id) || (options.onlySix && soul.stars !== 6) || (options.onlyMaxLevel && soul.level !== 15) || (options.unequipped && soul.equipped) || (options.excludeDiscarded && soul.discarded)) continue;
    const allowed = options.mainAttributes[soul.position];
    if (allowed?.length && !allowed.includes(soul.mainAttribute.name)) continue;
    const v = vector(soul);
    slots[soul.position - 1].push({ soul, v, rank: planScore(panel(options.base, v), options.objective) });
  }
  const candidates = slots.map(slot => slot.length), plans: SoulPlan[] = [];
  let visited = 0, found = 0, status: SearchResult['status'] = 'complete';
  const info = (): SearchProgress => ({ visited, found, skipped, candidates, elapsed: (performance.now() - started) / 1000 });
  progress(info());
  if (slots.some(slot => !slot.length)) return { ...info(), plans, status };
  const requiredIds = new Set(options.requirements.map(requirement => requirement.suitId));
  slots.forEach(slot => slot.sort((a, b) => Number(requiredIds.has(b.soul.suitId!)) - Number(requiredIds.has(a.soul.suitId!)) || b.rank - a.rank || a.soul.id.localeCompare(b.soul.id)));
  const order = [0, 1, 2, 3, 4, 5].sort((a, b) => slots[a].length - slots[b].length);
  const upper: number[][] = Array.from({ length: 7 }, zero), lower: number[][] = Array.from({ length: 7 }, zero);
  const availability: Array<Map<number, number>> = Array.from({ length: 7 }, () => new Map());
  for (let depth = 5; depth >= 0; depth--) {
    const slot = slots[order[depth]];
    availability[depth] = new Map(availability[depth + 1]);
    for (const suit of new Set(slot.map(item => item.soul.suitId!))) availability[depth].set(suit, (availability[depth].get(suit) ?? 0) + 1);
    for (let i = 0; i < ATTRS.length; i++) {
      let min = Infinity, max = 0;
      for (const item of slot) { min = Math.min(min, item.v[i]); max = Math.max(max, item.v[i]); }
      upper[depth][i] = upper[depth + 1][i] + max; lower[depth][i] = lower[depth + 1][i] + min;
    }
  }
  // At most three distinct two-piece bonuses can be active with six slots.
  const maxBonus = ATTRS.map(name => catalog.filter(s => availability[0].get(s.id)! >= 2 && s.bonus?.name === name).map(s => s.bonus!.value).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
  const requirements = new Map<number, number>();
  for (const requirement of options.requirements) requirements.set(requirement.suitId, (requirements.get(requirement.suitId) ?? 0) + requirement.count);
  if ([...requirements.values()].reduce((a, b) => a + b, 0) > 6) throw new Error('指定套装超过六个位置');
  const counts = new Map<number, number>(), prefixes = Array.from({ length: 7 }, zero), chosen: SoulRecord[] = Array(6);
  const groupSuits = options.twoPieceAttribute ? catalog.filter(s => s.bonus?.name === options.twoPieceAttribute && !requirements.has(s.id)).map(s => s.id) : [];
  const fits = (p: Panel): boolean => Object.entries(options.ranges).every(([key, range]) => (range.min == null || p[key as PanelKey] + 1e-9 >= range.min) && (range.max == null || p[key as PanelKey] - 1e-9 <= range.max));
  const limit = Math.max(1, Math.min(100, options.limit));
  const keys = new Set<string>();
  function* search(depth: number): Generator<void> {
    const current = prefixes[depth];
    visited++;
    if ((visited & 511) === 0) yield;
    let requiredRemaining = 0;
    for (const [id, count] of requirements) {
      const needed = Math.max(0, count - (counts.get(id) ?? 0)); requiredRemaining += needed;
      if ((availability[depth].get(id) ?? 0) < needed) return;
    }
    if (requiredRemaining > 6 - depth) return;
    if (options.twoPieceAttribute && !groupSuits.some(id => {
      const needed = Math.max(0, 2 - (counts.get(id) ?? 0));
      return needed <= (availability[depth].get(id) ?? 0) && needed + requiredRemaining <= 6 - depth;
    })) return;
    const high = panel(options.base, current.map((v, i) => v + upper[depth][i] + maxBonus[i]));
    const low = panel(options.base, current.map((v, i) => v + lower[depth][i]));
    for (const [key, range] of Object.entries(options.ranges)) if ((range.min != null && high[key as PanelKey] + 1e-9 < range.min) || (range.max != null && low[key as PanelKey] - 1e-9 > range.max)) return;
    if (plans.length === limit && planScore(high, options.objective) < plans[plans.length - 1].score - 1e-9) return;
    if (depth === 6) {
      if (options.twoPieceAttribute && ![...counts].some(([id, count]) => count >= 2 && !requirements.has(id) && suitMap.get(id)?.bonus?.name === options.twoPieceAttribute)) return;
      // Evaluate a leaf in slot order so repeated subtract/add backtracking cannot
      // change scores of identical panels through accumulated floating-point drift.
      const p = evaluatePlan(chosen, options.base, catalog);
      if (!fits(p)) return;
      found++;
      const ids = chosen.map(s => s.id), key = ids.join('|');
      if (keys.has(key)) return;
      const plan: SoulPlan = { ids, panel: p, score: planScore(p, options.objective), suits: [...counts].filter(([, count]) => count >= 2).map(([id, count]) => ({ id, count })) };
      plans.push(plan); keys.add(key);
      plans.sort((a, b) => b.score - a.score || a.ids.join('|').localeCompare(b.ids.join('|')));
      if (plans.length > limit) keys.delete(plans.pop()!.ids.join('|'));
      return;
    }
    const position = order[depth];
    for (const item of slots[position]) {
      chosen[position] = item.soul; const id = item.soul.suitId!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      for (let i = 0; i < ATTRS.length; i++) prefixes[depth + 1][i] = current[i] + item.v[i];
      yield* search(depth + 1);
      if (counts.get(id) === 1) counts.delete(id); else counts.set(id, counts.get(id)! - 1);
    }
  }
  const generator = search(0);
  let lastProgress = started;
  for (;;) {
    if (cancelled()) { status = 'cancelled'; break; }
    if ((performance.now() - started) / 1000 >= Math.max(0.05, options.seconds)) { status = 'timeout'; break; }
    const slice = performance.now(); let next: IteratorResult<void>;
    do { next = generator.next(); } while (!next.done && performance.now() - slice < 12);
    if (next.done) break;
    if (performance.now() - lastProgress >= 150) { progress(info()); lastProgress = performance.now(); }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return { ...info(), plans, status };
}
