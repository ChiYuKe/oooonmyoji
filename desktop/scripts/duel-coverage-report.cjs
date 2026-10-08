const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const catalogModule = require(path.join(root, 'dist-test-renderer', 'shared', 'soul-catalog-data.js'));
const registryModule = require(path.join(root, 'dist-test-renderer', 'renderer', 'features', 'duel', 'engine', 'content',
  'register-migrated-content.js'));
const catalog = catalogModule.soulCatalog;
const registry = registryModule.createMigratedContentRegistry();

function status(value) {
  return value === 'verified' || value === 'partial' ? value : 'unsupported';
}

function countStatuses(entries, key) {
  return entries.reduce((counts, entry) => {
    counts[entry[key]] += 1;
    return counts;
  }, { verified: 0, partial: 0, unsupported: 0 });
}

const heroes = catalog.heroes.map(hero => {
  const definition = registry.getHero(hero.id);
  return { id: hero.id, name: hero.name, ai: status(definition?.aiCoverage),
    mechanics: status(definition?.mechanicsCoverage),
    gaps: [
      definition?.aiCoverageNotes?.length ? `AI：${definition.aiCoverageNotes.join('；')}` : '',
      definition?.mechanicsCoverageNotes?.length ? `机制：${definition.mechanicsCoverageNotes.join('；')}` : '',
    ].filter(Boolean).join('；') };
});
const souls = catalog.suits.filter(soul => !soul.boss).map(soul => {
  const definition = registry.getSoul(`soul:${soul.id}`);
  return { id: soul.id, name: soul.name, mechanics: status(definition?.mechanicsCoverage),
    gaps: definition?.mechanicsCoverageNotes?.join('；') ?? '' };
});
const statuses = registry.statusDefinitions().map(definition => ({ id: definition.id,
  mechanics: status(definition.mechanicsCoverage) })).sort((left, right) => left.id.localeCompare(right.id));

const lines = [
  '# 斗技引擎内容覆盖清单',
  '',
  `由 \`npm run coverage:duel\` 生成；图鉴数据版本：${catalog.updated}。状态只反映独立规则注册及声明的覆盖级别，不代表未实现机制已经补齐。`,
  '',
  '## 汇总',
  '',
  '| 内容 | 总数 | 已实现并验证 | 部分实现 | 未实现／未注册 |',
  '|---|---:|---:|---:|---:|',
];

const heroAi = countStatuses(heroes, 'ai');
const heroMechanics = countStatuses(heroes, 'mechanics');
const soulMechanics = countStatuses(souls, 'mechanics');
const statusMechanics = countStatuses(statuses, 'mechanics');
lines.push(`| 式神 AI | ${heroes.length} | ${heroAi.verified} | ${heroAi.partial} | ${heroAi.unsupported} |`);
lines.push(`| 式神机制 | ${heroes.length} | ${heroMechanics.verified} | ${heroMechanics.partial} | ${heroMechanics.unsupported} |`);
lines.push(`| 御魂机制 | ${souls.length} | ${soulMechanics.verified} | ${soulMechanics.partial} | ${soulMechanics.unsupported} |`);
lines.push(`| 已注册状态 | ${statuses.length} | ${statusMechanics.verified} | ${statusMechanics.partial} | ${statusMechanics.unsupported} |`);
lines.push('', '## 式神', '', '| ID | 名称 | AI | 机制 | 未覆盖规则 |', '|---:|---|---|---|---|');
for (const hero of heroes) lines.push(`| ${hero.id} | ${hero.name} | ${hero.ai} | ${hero.mechanics} | ${hero.gaps || '—'} |`);
lines.push('', '## 御魂', '', '| ID | 名称 | 机制 | 未覆盖规则 |', '|---:|---|---|---|');
for (const soul of souls) lines.push(`| ${soul.id} | ${soul.name} | ${soul.mechanics} | ${soul.gaps || '—'} |`);
lines.push('', '## 已注册状态', '', '| 状态 ID | 机制 |', '|---|---|');
for (const item of statuses) lines.push(`| \`${item.id}\` | ${item.mechanics} |`);
lines.push('');

const report = lines.join('\n');
if (process.argv.includes('--write')) {
  const output = path.join(root, 'docs', 'DUEL_ENGINE_COVERAGE.md');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, report, 'utf8');
}
process.stdout.write(`${heroes.length} heroes, ${souls.length} souls, ${statuses.length} registered statuses\n`);
process.stdout.write(`Hero mechanics: ${JSON.stringify(heroMechanics)}\n`);
process.stdout.write(`Soul mechanics: ${JSON.stringify(soulMechanics)}\n`);
if (!process.argv.includes('--write')) process.stdout.write(report);
