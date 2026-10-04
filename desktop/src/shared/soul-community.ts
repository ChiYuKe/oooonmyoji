import { evaluatePlan, planScore, PANEL_LABELS, OPTIMIZATION_OBJECTIVES } from './soul-optimizer';
import type { OptimizationOptions, Panel, PanelKey, SoulPlan, SuitProfile } from './soul-optimizer';
import type { SoulAttribute, SoulRecord } from './souls';
import { SOUL_SLOT_MAIN_ATTRIBUTES, SOUL_MAIN_ATTRIBUTE_LABELS } from './soul-slots';
import { SIX_STAR_SUBSTAT_ROLLS, SIX_STAR_MAIN_VALUES, BOSS_INTRINSIC_VALUES, SIX_STAR_SUBSTAT_MIN_FACTOR, SIX_STAR_SUBSTAT_MAX_ALLOCATIONS, SIX_STAR_SUBSTAT_TOTAL_ALLOCATIONS } from './soul-attribute-limits';
import { suitMechanicRanges } from './soul-substat-standard';

export const COMMUNITY_VERSION = 1;
export const COMMUNITY_DEFAULT_ENDPOINT = 'https://onmyoji-soul-community.liukele015.workers.dev';
export const COMMUNITY_MAX_BYTES = 24_000;
export const COMMUNITY_CACHE_TTL_MS = 15 * 60_000;
export interface CommunityBuild {
  version: 1; heroId: number; objective: OptimizationOptions['objective']; title: string; author: string;
  base: Panel; ranges: OptimizationOptions['ranges']; target: { min?: number; max?: number }; souls: SoulRecord[];
}
export interface CommunityEntry extends CommunityBuild { id: string; createdAt: string }
export interface CommunityPage { entries: CommunityEntry[]; cursor: string | null; filterVersion?: 1; cache?: { savedAt: number; stale: boolean } }
export interface CommunityListOptions { refresh?: boolean }
export interface CommunityAccount { githubId: string; login: string; author: string }
export interface CommunityAccountState { user: CommunityAccount | null; persistent: boolean; offline?: boolean }
export interface CommunityLoginPrompt { userCode: string; verificationUrl: string; expiresAt: number; interval: number }
export type CommunityLoginResult = { status: 'pending'; interval: number } | { status: 'complete'; account: CommunityAccountState };
export interface CommunityOwnedPage { uploads: { id: string; title: string }[]; cursor: string | null }
export function normalizeCommunityAuthor(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw Error('署名需为 1 至 30 个字符，不可包含控制字符。');
  const author = value.normalize('NFKC').trim();
  if (!author || author.length > 30) throw Error('署名需为 1 至 30 个字符。');
  return author;
}
export function normalizeCommunityAccount(value: unknown): CommunityAccount {
  const row = object(value);
  if (typeof row.githubId !== 'string' || !/^[1-9]\d{0,15}$/.test(row.githubId) || typeof row.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(row.login)) throw Error('社区账号信息无效。');
  return { githubId: row.githubId, login: row.login, author: shortText(row.author, 30, row.login.slice(0, 30)) };
}
export interface CommunityFilters {
  search?: string; author?: string; suit4?: number; suit2?: number;
  main2?: string; main4?: string; main6?: string; after?: string; before?: string;
}
export interface CommunityQuery extends CommunityFilters { heroId: number; objective: OptimizationOptions['objective']; cursor?: string; order?: 'newest' | 'oldest' }
/** Shared validation for the renderer, IPC bridge and public service. */
export function normalizeCommunityQuery(value: unknown): CommunityQuery {
  const row = object(value);
  if (!Object.hasOwn(OPTIMIZATION_OBJECTIVES, String(row.objective))) throw Error('社区查询指标无效。');
  const query: CommunityQuery = { heroId: integer(row.heroId, 1, 10_000_000), objective: row.objective as CommunityQuery['objective'] };
  for (const key of ['search', 'author'] as const) if (row[key] != null && row[key] !== '') query[key] = shortText(row[key], key === 'search' ? 60 : 30, '').normalize('NFKC');
  for (const key of ['suit4', 'suit2'] as const) if (row[key] != null) query[key] = integer(row[key], 1, 10_000_000);
  for (const position of [2, 4, 6] as const) {
    const key = `main${position}` as const;
    if (row[key] != null && row[key] !== '') {
      if (typeof row[key] !== 'string' || !SOUL_SLOT_MAIN_ATTRIBUTES[position].includes(row[key])) throw Error('社区主属性筛选无效。');
      query[key] = row[key];
    }
  }
  for (const key of ['after', 'before'] as const) if (row[key] != null && row[key] !== '') {
    if (typeof row[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row[key]) || !Number.isFinite(Date.parse(row[key])) || new Date(`${row[key]}T00:00:00Z`).toISOString().slice(0, 10) !== row[key]) throw Error('上传日期无效。');
    query[key] = row[key];
  }
  if (query.after && query.before && query.after > query.before) throw Error('上传开始日期不能晚于结束日期。');
  if (row.order != null) {
    if (!['newest', 'oldest'].includes(String(row.order))) throw Error('社区排序方式无效。');
    query.order = row.order as CommunityQuery['order'];
  }
  if (row.cursor) {
    if (typeof row.cursor !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\|[a-f0-9]{64}$/.test(row.cursor) || !Number.isFinite(Date.parse(row.cursor.split('|')[0]))) throw Error('社区分页标识无效。');
    query.cursor = row.cursor;
  }
  return query;
}
export function matchesCommunityFilters(entry: CommunityEntry, filters: CommunityFilters): boolean {
  const folded = (s: string): string => s.normalize('NFKC').toLocaleLowerCase('en-US');
  const localDate = new Date(new Date(entry.createdAt).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  return (!filters.search || folded(`${entry.title} ${entry.author}`).includes(folded(filters.search)))
    && (!filters.author || folded(entry.author).includes(folded(filters.author)))
    && (!filters.suit4 || entry.souls.filter(s => s.suitId === filters.suit4).length >= 4)
    && (!filters.suit2 || entry.souls.filter(s => s.suitId === filters.suit2).length >= (filters.suit2 === filters.suit4 ? 6 : 2))
    && [2, 4, 6].every(position => !filters[`main${position}` as 'main2'] || entry.souls.find(s => s.position === position)?.mainAttribute?.name === filters[`main${position}` as 'main2'])
    && (!filters.after || localDate >= filters.after) && (!filters.before || localDate <= filters.before);
}
export interface CommunityApi {
  getCommunityAccount(endpoint: string): Promise<CommunityAccountState>;
  renameCommunityAccount(endpoint: string, author: string): Promise<CommunityAccountState>;
  startCommunityLogin(endpoint: string, legacyToken: string): Promise<CommunityLoginPrompt>;
  pollCommunityLogin(endpoint: string): Promise<CommunityLoginResult>;
  cancelCommunityLogin(endpoint: string): Promise<void>;
  openCommunityLogin(endpoint: string): Promise<void>;
  logoutCommunityAccount(endpoint: string): Promise<void>;
  listCommunityOwnedBuilds(endpoint: string, cursor?: string): Promise<CommunityOwnedPage>;
  listCommunityBuilds(endpoint: string, query: CommunityQuery, options?: CommunityListOptions): Promise<CommunityPage>;
  uploadCommunityBuild(endpoint: string, build: CommunityBuild, deleteToken: string): Promise<{ id: string; createdAt: string; author: string }>;
  deleteCommunityBuild(endpoint: string, id: string, deleteToken: string): Promise<void>;
}
export interface CommunityComparison {
  entry: CommunityEntry; plan: SoulPlan; originalScore: number; delta: number; violations: string[]; meetsTarget: boolean;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('社区方案格式无效。');
  return value as Record<string, unknown>;
};
const amount = (value: unknown, max = 1_000_000): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw Error('社区方案属性数值无效。');
  return value;
};
const integer = (value: unknown, min: number, max: number): number => {
  const number = amount(value, max); if (!Number.isInteger(number) || number < min) throw Error('社区方案编号无效。'); return number;
};
const shortText = (value: unknown, max: number, fallback: string): string => {
  if (typeof value !== 'string' || value.length > max) throw Error('社区方案名称过长或无效。');
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim() || fallback;
};
const flat = new Set(['attackAdditionVal', 'maxHpAdditionVal', 'defenseAdditionVal', 'speedAdditionVal']);
const attributeTolerance = .00001;
function minimumAllocations(attr: SoulAttribute): number {
  return Math.max(1, Math.ceil((attr.value - attributeTolerance) / SIX_STAR_SUBSTAT_ROLLS[attr.name]));
}
function attr(value: unknown, kind: 'main' | 'sub' | 'intrinsic'): SoulAttribute {
  const row = object(value), name = String(row.name);
  if (!Object.hasOwn(SOUL_MAIN_ATTRIBUTE_LABELS, name)) throw Error('社区方案包含未知属性。');
  const fixed = (kind === 'main' ? SIX_STAR_MAIN_VALUES : BOSS_INTRINSIC_VALUES)[name];
  const cap = kind === 'sub' ? (SIX_STAR_SUBSTAT_ROLLS[name] ?? 0) * SIX_STAR_SUBSTAT_MAX_ALLOCATIONS : fixed;
  if (cap == null) throw Error('社区方案固有属性类型无效。');
  const result = { name, value: amount(row.value, cap + attributeTolerance), label: SOUL_MAIN_ATTRIBUTE_LABELS[name], percent: !flat.has(name), rolls: integer(row.rolls ?? 0, 0, SIX_STAR_SUBSTAT_MAX_ALLOCATIONS) };
  if (kind !== 'sub') {
    if (Math.abs(result.value - fixed) > attributeTolerance) throw Error('社区方案主属性或固有属性不符合六星 +15 标准。');
  } else {
    const allocations = result.rolls || minimumAllocations(result), upper = SIX_STAR_SUBSTAT_ROLLS[name] * allocations;
    if (allocations > SIX_STAR_SUBSTAT_MAX_ALLOCATIONS || result.value < upper * SIX_STAR_SUBSTAT_MIN_FACTOR - attributeTolerance || result.value > upper + attributeTolerance) throw Error('社区方案副属性数值与属性分配次数不符。');
  }
  return result;
}
/** Rebuild an allowlisted payload: no inventory IDs, instances, paths, image URLs or account data. */
export function normalizeCommunityBuild(value: unknown): CommunityBuild {
  const row = object(value);
  if (row.version !== COMMUNITY_VERSION || !Object.hasOwn(OPTIMIZATION_OBJECTIVES, String(row.objective))) throw Error('社区方案版本或评分指标不受支持。');
  const rawBase = object(row.base), base = {} as Panel;
  for (const key of Object.keys(PANEL_LABELS) as PanelKey[]) base[key] = amount(rawBase[key]);
  const rawRanges = object(row.ranges), ranges: OptimizationOptions['ranges'] = {};
  const rawTarget = object(row.target ?? {}), target: CommunityBuild['target'] = {};
  if (rawTarget.min != null) target.min = amount(rawTarget.min, 1_000_000_000);
  if (rawTarget.max != null) target.max = amount(rawTarget.max, 1_000_000_000);
  if (target.min != null && target.max != null && target.min > target.max) throw Error('目标评分上下限无效。');
  for (const [key, value] of Object.entries(rawRanges)) {
    if (!Object.hasOwn(PANEL_LABELS, key)) throw Error('社区方案包含未知面板限制。');
    const bounds = object(value), range: { min?: number; max?: number } = {};
    if (bounds.min != null) range.min = amount(bounds.min);
    if (bounds.max != null) range.max = amount(bounds.max);
    if (range.min != null && range.max != null && range.min > range.max) throw Error('社区方案属性上下限无效。');
    ranges[key as PanelKey] = range;
  }
  if (!Array.isArray(row.souls) || row.souls.length !== 6) throw Error('请分享完整的六件御魂方案。');
  const souls = row.souls.map((value, index): SoulRecord => {
    const gear = object(value), position = integer(gear.position, 1, 6);
    if (gear.stars !== 6 || gear.level !== 15) throw Error('社区方案目前仅支持六星 +15 御魂。');
    const main = attr(gear.mainAttribute, 'main');
    if (!SOUL_SLOT_MAIN_ATTRIBUTES[position].includes(main.name)) throw Error('社区方案主属性与位置不符。');
    if (!Array.isArray(gear.subAttributes) || gear.subAttributes.length > 4 || gear.subAttributes.length < 3) throw Error('社区方案副属性数量无效。');
    const subs = gear.subAttributes.map(value => attr(value, 'sub'));
    if (new Set(subs.map(a => a.name)).size !== subs.length) throw Error('社区方案副属性重复。');
    if (subs.reduce((total, attr) => total + (attr.rolls || minimumAllocations(attr)), 0) > SIX_STAR_SUBSTAT_TOTAL_ALLOCATIONS) throw Error('每件六星 +15 御魂最多九次副属性分配，不能同时将多条属性堆至上限。');
    const rawIntrinsic = gear.intrinsicAttributes ?? [];
    if (!Array.isArray(rawIntrinsic) || rawIntrinsic.length > 1) throw Error('社区方案固有属性无效。');
    return { id: `community-slot-${index + 1}`, itemId: null, suitId: integer(gear.suitId, 1, 10_000_000), position, stars: 6, level: 15,
      locked: false, equipped: false, discarded: false, baseAttributeIndex: null, baseValue: null, attributeRolls: [],
      mainAttribute: main, subAttributes: subs, intrinsicAttributes: rawIntrinsic.map(value => attr(value, 'intrinsic')), attributesComplete: true };
  }).sort((a, b) => a.position! - b.position!);
  if (new Set(souls.map(s => s.position)).size !== 6) throw Error('社区方案御魂位置重复。');
  souls.forEach(s => { s.id = `community-slot-${s.position}`; });
  return { version: 1, heroId: integer(row.heroId, 1, 10_000_000), objective: row.objective as CommunityBuild['objective'],
    title: shortText(row.title, 60, '御魂方案'), author: shortText(row.author, 30, '匿名用户'), base, ranges, target, souls };
}
export function normalizeCommunityEntry(value: unknown): CommunityEntry {
  const row = object(value);
  if (typeof row.id !== 'string' || !/^[a-f0-9]{64}$/.test(row.id) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw Error('社区方案标识无效。');
  return { ...normalizeCommunityBuild(value), id: row.id, createdAt: row.createdAt };
}
export function createCommunityBuild(plan: SoulPlan, inventory: readonly SoulRecord[], options: OptimizationOptions, heroId: number, title: string, author: string, target: CommunityBuild['target'] = {}): CommunityBuild {
  return normalizeCommunityBuild({ version: 1, heroId, title, author, base: options.base, objective: options.objective, ranges: options.ranges, target,
    souls: plan.ids.map(id => inventory.find(soul => soul.id === id)) });
}
export function communityBuildTitle(hero: Pick<import('./soul-optimizer').HeroProfile, 'name'>, souls: readonly SoulRecord[], catalog: readonly SuitProfile[]): string {
  const counts = new Map<number, number>();
  for (const soul of souls) if (soul.suitId != null) counts.set(soul.suitId, (counts.get(soul.suitId) ?? 0) + 1);
  const sets = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id, count]) => `${catalog.find(s => s.id === id)?.name ?? '未知御魂'}×${count}`);
  return `${hero.name} · ${sets.join(' + ')}`.slice(0, 60);
}
export function compareCommunityBuild(entry: CommunityEntry, original: SoulPlan, inventory: readonly SoulRecord[], catalog: SuitProfile[], options: OptimizationOptions, target?: { min?: number; max?: number }): CommunityComparison {
  const known = new Map(catalog.map(suit => [suit.id, suit]));
  if (entry.souls.some(soul => !known.has(soul.suitId!))) throw Error('方案含有本地目录尚未支持的套装。');
  const panel = evaluatePlan(entry.souls, options.base, catalog), score = planScore(panel, options.objective), counts = new Map<number, number>();
  entry.souls.forEach(soul => counts.set(soul.suitId!, (counts.get(soul.suitId!) ?? 0) + 1));
  const violations: string[] = [], requirements = new Map<number, number>();
  options.requirements.forEach(r => requirements.set(r.suitId, (requirements.get(r.suitId) ?? 0) + r.count));
  for (const [id, count] of requirements) if ((counts.get(id) ?? 0) < count) violations.push(`${known.get(id)!.name}不足 ${count} 件`);
  if (options.twoPieceAttribute && ![...counts].some(([id, count]) => count >= 2 && known.get(id)?.bonus?.name === options.twoPieceAttribute)) violations.push('两件套加成属性不符');
  for (const soul of entry.souls) {
    const allowed = options.mainAttributes[soul.position!];
    if (allowed?.length && !allowed.includes(soul.mainAttribute!.name)) violations.push(`${soul.position} 号位主属性不符`);
  }
  const requiredGear = options.requirements.flatMap(r => Array.from({ length: r.count }, () => ({ suitId: r.suitId })));
  for (const [key, range] of Object.entries(suitMechanicRanges(entry.souls, suitMechanicRanges(requiredGear, options.ranges)))) {
    const v = panel[key as PanelKey];
    if ((range.min != null && v + 1e-9 < range.min) || (range.max != null && v - 1e-9 > range.max)) violations.push(`${PANEL_LABELS[key as PanelKey]}不满足限制`);
  }
  const originals = original.ids.map(id => inventory.find(s => s.id === id));
  if (originals.some(s => !s?.mainAttribute)) throw Error('原方案御魂已不完整，请重新计算。');
  const originalScore = planScore(evaluatePlan(originals as SoulRecord[], options.base, catalog), options.objective);
  return { entry, plan: { ids: entry.souls.map(s => s.id), panel, score, suits: [...counts].map(([id, count]) => ({ id, count })) }, originalScore,
    delta: score - originalScore, violations, meetsTarget: !violations.length && !!target && (target.min == null || score + 1e-9 >= target.min) && (target.max == null || score - 1e-9 <= target.max) };
}
export function normalizeCommunityEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw Error('请填写社区服务地址。');
  let url: URL; try { url = new URL(value.trim()); } catch { throw Error('社区服务地址无效。'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw Error('社区服务需使用 HTTPS 地址。');
  return url.href.replace(/\/$/, '');
}
