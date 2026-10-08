#!/usr/bin/env node
/**
 * Import the organised 6-star / level-40 shikigami base-panel table.
 *
 * Usage: node scripts/import-hero-base.cjs <directory containing hero_base_6star40.json>
 *
 * Input is produced by the game-forensics tooling:
 *   yys-lineup/tools/build_hero_base_index.py  ->  out/hero_base_6star40.json
 *
 * Why this exists: game-battle-data.generated.json carries the hero *growth
 * coefficients* (hpStarSt / *Delta / awakeInc*) but NOT the growth table itself,
 * so a base panel cannot be recomputed from it.  soul-catalog-data.ts has the
 * final 6-star L40 panel, but keyed by its own ids and without any way to map a
 * battle heroId (SP / skin / variant ids differ) onto it.  This module closes
 * both gaps: normalised values, npc flags, and a coefficient-verified alias map.
 */
const fs = require('node:fs');
const path = require('node:path');

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('Usage: node scripts/import-hero-base.cjs <directory containing hero_base_6star40.json>');
  process.exit(2);
}

const sourcePath = path.resolve(sourceDir, 'hero_base_6star40.json');
const outputPath = path.resolve(__dirname, '../src/shared/hero-base-data.generated.ts');
const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

if (!raw || typeof raw !== 'object' || !raw.heroes || !raw.meta) {
  throw new Error(`Invalid hero base export: ${sourcePath}`);
}
if (raw.meta.level !== 40 || raw.meta.star !== 6) {
  throw new Error(`Unexpected meta in ${sourcePath}: level=${raw.meta.level} star=${raw.meta.star}`);
}

const entries = Object.entries(raw.heroes);
const npcIds = [];
const awakeUnavailable = [];
const out = {};
for (const [idText, hero] of entries) {
  const id = Number(idText);
  if (!Number.isInteger(id) || !hero.base) throw new Error(`Invalid hero row: ${idText}`);
  const b = hero.base;
  for (const key of ['hp', 'attack', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist']) {
    if (!Number.isFinite(b[key])) throw new Error(`Hero ${id} has non-finite ${key}`);
  }
  if (hero.kind === 'npc') npcIds.push(id);
  if (hero.awakeStatus === 'awake0-complete') awakeUnavailable.push(id);
  out[id] = {
    name: hero.name,
    rarity: hero.rarity ?? null,
    pinyin: hero.pinyin ?? '',
    awake: Boolean(hero.awake),
    awakeStatus: hero.awakeStatus ?? 'unknown',
    kind: hero.kind,
    base: b,
  };
}

const strict = Object.fromEntries(
  Object.entries(raw.aliasesStrict || {}).map(([k, v]) => [Number(k), Number(v)]));
const loose = Object.fromEntries(
  Object.entries(raw.aliasesLoose || {}).map(([k, v]) => [Number(k), Number(v)]));

function emitRecord(name, title, record) {
  const items = Object.entries(record).map(([k, v]) => [Number(k), v])
    .sort((a, b) => a[0] - b[0]);
  const rows = [];
  for (let i = 0; i < items.length; i += 8) {
    rows.push('  ' + items.slice(i, i + 8).map(([k, v]) => `${k}: ${v}`).join(', ') + ',');
  }
  return `/** ${title} */\nexport const ${name}: Readonly<Record<number, number>> = {\n${rows.join('\n')}\n};\n`;
}

const sourceLabel = path.basename(path.resolve(sourceDir));
const output = `// Generated from ${sourceLabel}/hero_base_6star40.json.
// Re-run scripts/import-hero-base.cjs after refreshing the game export.
// Source of the panels: NetEase's public simulator (get_hero_attr?level=40&star=6),
// i.e. exactly the level/star used by 乱斗 / 对弈竞猜.

export const HERO_BASE_SCHEMA_VERSION = 1;

/** Every panel below is a 6-star, level-40 base panel. */
export const HERO_BASE_META = {
  level: ${raw.meta.level},
  star: ${raw.meta.star},
  generatedFrom: ${JSON.stringify(raw.meta.updated ?? '')},
  heroCount: ${entries.length},
} as const;

export interface HeroBasePanel {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  crit: number;
  critDamage: number;
  hit: number;
  resist: number;
}

export interface HeroBaseEntry {
  name: string;
  rarity: number | null;
  pinyin: string;
  /** true = 面板为觉醒形态 */
  awake: boolean;
  /**
   * 面板的觉醒来源：
   * - awake1            原目录即为觉醒态（可信）
   * - awake1-fetched    原本未觉醒，已用 awake=1 重新抓取补齐（可信）
   * - awake0-complete  该形态没有独立觉醒态（全部 SP 51 个 + UR 1 个 + 无觉醒版本的 N 卡
   *   17 个），接口的 awake=0 返回即为**完整面板**，可直接使用
   */
  awakeStatus: 'awake1' | 'awake1-fetched' | 'awake0-complete' | string;
  kind: 'shikigami' | 'npc' | 'suspect';
  base: HeroBasePanel;
}

/** NPC / 素材条目：不应作为战斗式神处理。 */
export const heroBaseNpcIds: readonly number[] = [${npcIds.sort((a, b) => a - b).join(', ')}];

/** 无独立觉醒态的式神 id（全部 SP/UR + 部分 N 卡）；其面板本身即完整值。 */
export const heroBaseAwake0CompleteIds: readonly number[] = [${awakeUnavailable.sort((a, b) => a - b).join(', ')}];

const NPC_ID_SET = new Set<number>(heroBaseNpcIds);

export const heroBaseById: Readonly<Record<number, HeroBaseEntry>> = ${JSON.stringify(out, null, 2)};

${emitRecord('heroBaseAliasStrict', '客户端 heroId -> 目录 id；属性系数与目录行完全一致（安全）', strict)}
${emitRecord('heroBaseAliasLoose', '同名但属性系数不同（SP / 皮肤 / 其他形态）；仅在 strict 未命中时回退', loose)}
/** 解析任意 heroId（含 SP / 皮肤 / 变体 id）到六星 40 级基础面板。 */
export function heroBaseOf(heroId: number): HeroBaseEntry | undefined {
  return heroBaseById[heroId]
    ?? heroBaseById[heroBaseAliasStrict[heroId]]
    ?? heroBaseById[heroBaseAliasLoose[heroId]];
}

/** 该 heroId 是否可作为战斗式神（排除 NPC / 素材）。 */
export function isPlayableHero(heroId: number): boolean {
  const entry = heroBaseOf(heroId);
  return Boolean(entry) && entry!.kind !== 'npc' && !NPC_ID_SET.has(heroId);
}
`;

fs.writeFileSync(outputPath, output, 'utf8');
console.log(JSON.stringify({
  heroes: entries.length,
  aliasesStrict: Object.keys(strict).length,
  aliasesLoose: Object.keys(loose).length,
  npc: npcIds.length,
  output: path.relative(process.cwd(), outputPath),
}, null, 2));
