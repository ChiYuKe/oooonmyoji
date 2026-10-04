// Read-only verification through the same public API used by the desktop app.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..'), output = path.join(root, 'artifacts/soul-community-test-data');
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
const shared = path.join(root, 'desktop/dist-test-renderer/shared');
const { COMMUNITY_DEFAULT_ENDPOINT, normalizeCommunityEntry, compareCommunityBuild, matchesCommunityFilters } = require(path.join(shared, 'soul-community.js'));
const { soulCatalog } = require(path.join(shared, 'soul-catalog-data.js'));
const { evaluatePlan, planScore } = require(path.join(shared, 'soul-optimizer.js'));
async function list(query) {
  const response = await fetch(`${COMMUNITY_DEFAULT_ENDPOINT}/v1/builds?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `Public query failed: ${JSON.stringify(query)}`);
  const page = await response.json(); assert.equal(page.filterVersion, 1);
  for (const entry of page.entries) normalizeCommunityEntry(entry);
  return page;
}
(async () => {
  const expected = new Set(manifest.ids), found = new Set(), dagou = [];
  let requests = 0;
  for (const group of manifest.groups) {
    let cursor;
    do {
      const page = await list({ heroId: group.heroId, objective: group.objective, ...(cursor ? { cursor } : {}) }); requests++;
      for (const entry of page.entries) if (expected.has(entry.id)) {
        assert.ok(entry.author.startsWith('测试用户')); found.add(entry.id);
        if (group.hero === '大天狗' && group.objective === 'damage') dagou.push(entry);
      }
      cursor = page.cursor;
    } while (cursor);
  }
  assert.equal(found.size, manifest.count); assert.equal(dagou.length, manifest.groups.find(g => g.hero === '大天狗' && g.objective === 'damage').count);
  const hero = soulCatalog.heroes.find(h => h.name === '大天狗'), original = dagou[0];
  const panel = evaluatePlan(original.souls, hero.base, soulCatalog.suits);
  const plan = { ids: original.souls.map(s => s.id), panel, score: planScore(panel, 'damage'), suits: [] };
  const options = { base: hero.base, objective: 'damage', requirements: [{ suitId: 300036, count: 4 }, { suitId: 300077, count: 2 }], mainAttributes: { 2: ['attackAdditionRate'], 4: ['attackAdditionRate'], 6: ['critRateAdditionVal', 'critPowerAdditionVal'] }, ranges: { crit: { min: 1 } } };
  const reports = dagou.map(entry => compareCommunityBuild(entry, plan, original.souls, soulCatalog.suits, options, { min: 22000 }));
  assert.ok(reports.some(r => r.violations.length)); assert.ok(reports.some(r => !r.violations.length));
  assert.ok(reports.some(r => r.meetsTarget)); assert.ok(reports.some(r => !r.violations.length && !r.meetsTarget));
  const filters = [{ search: '针女' }, { author: '测试用户01' }, { suit4: 300036, suit2: 300077 }, { main2: 'speedAdditionVal' }, { main4: 'attackAdditionRate', main6: 'critPowerAdditionVal' }, { order: 'oldest' }];
  for (const filter of filters) {
    const page = await list({ heroId: hero.id, objective: 'damage', ...filter }); requests++;
    assert.ok(page.entries.length > 0);
    assert.ok(page.entries.every(entry => matchesCommunityFilters(entry, filter)));
  }
  const result = { testUsers: manifest.users.length, verifiedBuilds: found.size, heroes: new Set(manifest.groups.map(g => g.hero)).size, objectives: new Set(manifest.groups.map(g => g.objective)).size,
    dagou: { count: dagou.length, compatible: reports.filter(r => !r.violations.length).length, reached22000: reports.filter(r => r.meetsTarget).length, below22000: reports.filter(r => !r.violations.length && !r.meetsTarget).length }, requests, verifiedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
