// Generate explicit synthetic community data and validate it before any remote import.
// This script only writes local SQL; use the documented Wrangler command to import it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '../../..');
const shared = path.join(root, 'desktop/dist-test-renderer/shared');
const { soulCatalog } = require(path.join(shared, 'soul-catalog-data.js'));
const { normalizeCommunityBuild, communityBuildTitle, normalizeCommunityEntry } = require(path.join(shared, 'soul-community.js'));
const { evaluatePlan, planScore, formatPlanScore, OPTIMIZATION_OBJECTIVES } = require(path.join(shared, 'soul-optimizer.js'));
const { SIX_STAR_MAIN_VALUES, SIX_STAR_SUBSTAT_ROLLS, BOSS_INTRINSIC_VALUES } = require(path.join(shared, 'soul-attribute-limits.js'));
const { SOUL_SLOT_MAIN_ATTRIBUTES } = require(path.join(shared, 'soul-slots.js'));
const out = path.join(root, 'artifacts/soul-community-test-data');
const batch = 'soul-community-synthetic-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sql = value => typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
let state = 0x5eed2026;
const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
const choose = values => values[Math.floor(random() * values.length)];
const shuffle = values => { const result = [...values]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; };
const heroes = new Map(soulCatalog.heroes.filter(h => h.base).map(h => [h.name, h]));
const suits = new Map(soulCatalog.suits.map(s => [s.name, s]));
const users = ['山风', '月见', '青岚', '萤火', '白露', '星河', '竹影', '花信', '雪晴', '流云', '霜叶', '朝雾', '初夏', '秋水', '冬夜', '春晓']
  .map((name, index) => ({ name: `测试用户${String(index + 1).padStart(2, '0')}·${name}`, owner: hash(`${batch}:synthetic-owner:${index}`) }));
const damageSets = [['针女', '鬼灵歌伎'], ['针女', '鬼灵歌伎'], ['海月火玉', '荒骷髅'], ['破势', '镇墓兽'], ['狂骨', '荒骷髅'], ['隐念', '鬼灵歌伎'], ['海月火玉', '无刀取'], ['针女', '镇墓兽']];
const supportSets = [['招财猫', '火灵'], ['火灵', '蚌精'], ['地藏像', '木魅'], ['雪幽魂', '蚌精'], ['遗念火', '招财猫']];
const preferred = {
  damage: ['critRateAdditionVal', 'critPowerAdditionVal', 'attackAdditionRate', 'speedAdditionVal'],
  attack: ['attackAdditionRate', 'attackAdditionVal', 'critPowerAdditionVal', 'speedAdditionVal'],
  speed: ['speedAdditionVal', 'maxHpAdditionRate', 'debuffResist', 'defenseAdditionRate'],
  hp: ['maxHpAdditionRate', 'maxHpAdditionVal', 'speedAdditionVal', 'debuffResist'],
  defense: ['defenseAdditionRate', 'defenseAdditionVal', 'maxHpAdditionRate', 'speedAdditionVal'],
  crit: ['critRateAdditionVal', 'critPowerAdditionVal', 'attackAdditionRate', 'speedAdditionVal'],
  critDamage: ['critPowerAdditionVal', 'critRateAdditionVal', 'attackAdditionRate', 'speedAdditionVal'],
  hit: ['debuffEnhance', 'speedAdditionVal', 'maxHpAdditionRate', 'debuffResist'],
  resist: ['debuffResist', 'speedAdditionVal', 'maxHpAdditionRate', 'defenseAdditionRate'],
};
const objectiveMain = { attack: 'attackAdditionRate', hp: 'maxHpAdditionRate', defense: 'defenseAdditionRate', speed: 'speedAdditionVal', crit: 'critRateAdditionVal', critDamage: 'critPowerAdditionVal', hit: 'debuffEnhance', resist: 'debuffResist' };
function gear(hero, objective, index, pair) {
  const positions = shuffle([1, 2, 3, 4, 5, 6]);
  return [1, 2, 3, 4, 5, 6].map(position => {
    const suit = suits.get(pair[positions.indexOf(position) < 4 ? 0 : 1]);
    assert.ok(suit, `Unknown suit: ${pair}`);
    const allowed = SOUL_SLOT_MAIN_ATTRIBUTES[position];
    let main = objectiveMain[objective];
    if (objective === 'damage') main = position === 6 ? (index % 3 === 0 ? 'critRateAdditionVal' : 'critPowerAdditionVal') : 'attackAdditionRate';
    if (!allowed.includes(main)) main = position === 2 && objective !== 'damage' ? 'speedAdditionVal' : choose(allowed);
    if (index % 13 === 0 && allowed.length > 1) main = choose(allowed);
    let names = [...preferred[objective]];
    if (index % 5 === 0) names[3] = choose(['attackAdditionVal', 'maxHpAdditionVal', 'defenseAdditionVal'].filter(name => !names.includes(name)));
    const rolls = [1, 1, 1, 1];
    // Nine total allocations; include exact single-stat maxima and balanced rolls.
    if (index >= 160) { rolls[0] = 4; rolls[1] = 3; }
    else if (index % 11 === 0) rolls[0] = 6;
    else for (let n = 0; n < 5; n++) rolls[Math.floor(random() * (index % 4 === 0 ? 4 : 3))]++;
    const strength = index >= 160 ? .98 : [.82, .86, .90, .94, .98][index % 5];
    const subAttributes = names.map((name, i) => ({ name, rolls: rolls[i], value: Number((SIX_STAR_SUBSTAT_ROLLS[name] * rolls[i] * (index < 160 && index % 11 === 0 ? 1 : Math.min(1, strength + random() * .015))).toFixed(6)) }));
    const intrinsic = suit.boss ? (index >= 160 ? 'critRateAdditionVal' : choose(['critRateAdditionVal', 'attackAdditionRate', 'maxHpAdditionRate', 'debuffResist'])) : null;
    return { position, suitId: suit.id, stars: 6, level: 15, mainAttribute: { name: main, value: SIX_STAR_MAIN_VALUES[main] }, subAttributes,
      intrinsicAttributes: intrinsic ? [{ name: intrinsic, value: BOSS_INTRINSIC_VALUES[intrinsic] }] : [] };
  });
}
const cases = [
  ...Array.from({ length: 80 }, () => ['大天狗', 'damage']),
  ...Array.from({ length: 24 }, () => ['阿修罗', 'damage']),
  ...Array.from({ length: 16 }, (_, n) => [n % 2 ? '须佐之男' : '玉藻前', 'damage']),
  ...Array.from({ length: 40 }, (_, n) => [['山兔', '镰鼬', '不见岳', '缘结神', '帝释天'][n % 5], Object.keys(OPTIMIZATION_OBJECTIVES)[1 + n % 8]]),
  ...Array.from({ length: 16 }, () => ['大天狗', 'damage']),
];
const anchor = Date.now();
const entries = cases.map(([name, objective], index) => {
  const hero = heroes.get(name), user = users[index % users.length]; assert.ok(hero?.base, `Unknown hero: ${name}`);
  const pair = index >= 160 ? ['针女', '鬼灵歌伎'] : (objective === 'damage' ? damageSets : supportSets)[index % (objective === 'damage' ? damageSets.length : supportSets.length)];
  const souls = gear(hero, objective, index, pair);
  const raw = { version: 1, heroId: hero.id, objective, title: communityBuildTitle(hero, souls, soulCatalog.suits), author: user.name, base: hero.base,
    souls, ranges: index % 4 === 0 ? { crit: { min: 1 } } : index % 4 === 1 ? { speed: { min: 160 } } : {}, target: {} };
  const score = planScore(evaluatePlan(normalizeCommunityBuild(raw).souls, hero.base, soulCatalog.suits), objective);
  if (index % 4 === 0) raw.target = { min: score * 1.1 };
  if (index % 4 === 1) raw.target = { min: score * .9, max: score * 1.1 };
  if (index % 4 === 2) raw.target = { max: score * .9 };
  const build = normalizeCommunityBuild(raw), id = hash(`${batch}:${index}:${JSON.stringify(build)}`);
  const createdAt = new Date(anchor - (cases.length - 1 - index) * 3 * 3600_000).toISOString();
  normalizeCommunityEntry({ ...build, id, createdAt });
  return { id, createdAt, owner: user.owner, build, score };
});
assert.equal(new Set(entries.map(e => e.id)).size, entries.length);
const seedStatements = [
  ...users.map(user => `INSERT INTO community_authors (owner_hash, author_key, name) VALUES (${sql(user.owner)}, ${sql(user.name.toLocaleLowerCase('en-US'))}, ${sql(user.name)}) ON CONFLICT DO NOTHING;`),
  ...entries.map(e => `INSERT INTO builds (id, hero_id, objective, created_at, payload, delete_hash) SELECT ${[e.id, e.build.heroId, e.build.objective, e.createdAt, JSON.stringify(e.build), e.owner].map(sql).join(', ')} WHERE EXISTS (SELECT 1 FROM community_authors WHERE owner_hash = ${sql(e.owner)} AND name = ${sql(e.build.author)}) ON CONFLICT DO NOTHING;`),
];
const owners = users.map(u => sql(u.owner)).join(', '), ids = entries.map(e => sql(e.id)).join(', ');
const cleanupStatements = [
  `DELETE FROM builds WHERE id IN (${ids}) AND delete_hash IN (${owners});`,
  `DELETE FROM community_authors WHERE owner_hash IN (${owners}) AND name LIKE '测试用户%' AND NOT EXISTS (SELECT 1 FROM builds WHERE builds.delete_hash = community_authors.owner_hash) AND NOT EXISTS (SELECT 1 FROM community_accounts WHERE community_accounts.owner_hash = community_authors.owner_hash);`,
];
const db = new DatabaseSync(':memory:');
try {
  for (const file of fs.readdirSync(path.join(__dirname, '../migrations')).sort()) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
  db.exec("INSERT INTO community_authors VALUES ('real-owner', 'real-user', '真实用户'); INSERT INTO builds VALUES ('real-build', 217, 'damage', '2026-10-01T00:00:00.000Z', '{}', 'real-owner');");
  db.exec(seedStatements.join('\n')); db.exec(seedStatements.join('\n'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM builds').get().n, entries.length + 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_accounts').get().n, 0);
  for (const row of db.prepare("SELECT payload FROM builds WHERE id <> 'real-build'").all()) normalizeCommunityBuild(JSON.parse(row.payload));
  db.exec(cleanupStatements.join('\n'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM builds').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_authors').get().n, 1);
} finally { db.close(); }
const groups = [...new Set(cases.map(([hero, objective]) => `${hero}|${objective}`))].map(key => {
  const [hero, objective] = key.split('|'), matches = entries.filter(e => e.build.heroId === heroes.get(hero).id && e.build.objective === objective);
  return { hero, heroId: heroes.get(hero).id, objective, count: matches.length, minScore: formatPlanScore(Math.min(...matches.map(e => e.score)), objective), maxScore: formatPlanScore(Math.max(...matches.map(e => e.score)), objective) };
});
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'seed.sql'), `-- ${batch}: clearly labelled synthetic profiles and gear; idempotent, no GitHub identities/sessions.\n${seedStatements.join('\n')}\n`);
fs.writeFileSync(path.join(out, 'cleanup.sql'), `-- Remove this exact synthetic batch only.\n${cleanupStatements.join('\n')}\n`);
fs.writeFileSync(path.join(out, 'verify.sql'), `SELECT COUNT(*) AS test_builds, COUNT(DISTINCT delete_hash) AS test_users FROM builds WHERE id IN (${ids}) AND delete_hash IN (${owners});\nSELECT hero_id, objective, COUNT(*) AS count FROM builds WHERE delete_hash IN (${owners}) GROUP BY hero_id, objective ORDER BY count DESC;\n`);
fs.writeFileSync(path.join(out, 'preflight.sql'), `SELECT owner_hash, name FROM community_authors WHERE author_key IN (${users.map(u => sql(u.name.toLocaleLowerCase('en-US'))).join(', ')});\n`);
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ batch, users, groups, ids: entries.map(e => e.id), count: entries.length, createdAt: new Date(anchor).toISOString() }, null, 2));
console.log(JSON.stringify({ users: users.length, builds: entries.length, groups, output: out, checked: ['standard attributes', 'SQLite import', 'repeat import', 'cleanup preserves other users', 'no synthetic GitHub accounts'] }, null, 2));
