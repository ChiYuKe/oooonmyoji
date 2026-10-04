const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { soulCatalog } = require('../dist-electron/shared/soul-catalog-data.js');
const { evaluatePlan, planScore } = require('../dist-electron/shared/soul-optimizer.js');
const { createCommunityBuild, normalizeCommunityBuild, communityBuildTitle, compareCommunityBuild, normalizeCommunityEndpoint } = require('../dist-electron/shared/soul-community.js');
const root = path.resolve(__dirname, '../..');
let worker;
const workerOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-community-test-'));
after(() => { assert.ok(path.resolve(workerOutput).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(workerOutput, { recursive: true, force: true }); });
function fixture() {
  const hero = soulCatalog.heroes.find(h => h.name === '大天狗');
  const attr = (name, value, rolls = 1) => ({ name, value, rolls, label: 'untrusted label', percent: false });
  const mains = [['attackAdditionVal', 486], ['attackAdditionRate', .55], ['defenseAdditionVal', 104], ['attackAdditionRate', .55], ['maxHpAdditionVal', 2052], ['critRateAdditionVal', .55]];
  const souls = mains.map(([name, value], i) => ({ id: `private-${i}`, itemId: 123, suitId: i < 4 ? 300083 : 300092, position: i + 1, stars: 6, level: 15,
    equipped: true, attributesComplete: true, mainAttribute: attr(name, value), subAttributes: [attr('critPowerAdditionVal', .15, 4), attr('speedAdditionVal', 3), attr('debuffResist', .04), attr(name === 'attackAdditionRate' ? 'critRateAdditionVal' : 'attackAdditionRate', .08, 3)],
    intrinsicAttributes: [], iconUrl: 'file:///private/path.png', instanceId: 'my account' }));
  const options = { base: hero.base, objective: 'damage', ranges: {}, requirements: [{ suitId: 300083, count: 4 }], mainAttributes: {}, onlySix: true, onlyMaxLevel: true, unequipped: false, excludeDiscarded: true, excludedIds: [], seconds: 10, limit: 10 };
  const panel = evaluatePlan(souls, options.base, soulCatalog.suits), score = planScore(panel, options.objective);
  const plan = { ids: souls.map(s => s.id), panel, score, suits: [{ id: 300083, count: 4 }, { id: 300092, count: 2 }] };
  const target = { min: score - 1, max: score + 1 };
  const build = createCommunityBuild(plan, souls, options, hero.id, '达标方案', '分享者', target);
  const entry = { ...build, id: 'a'.repeat(64), createdAt: '2026-10-05T00:00:00.000Z' };
  return { hero, souls, options, plan, target, build, entry };
}
test('upload allowlist removes IDs, account metadata and URLs; never changes inventory', () => {
  const f = fixture(), before = JSON.stringify(f.souls), build = createCommunityBuild({ ...f.plan, score: 999999 }, f.souls, f.options, f.hero.id, 'test', '', f.target);
  assert.equal(build.author, '匿名用户');
  assert.equal(JSON.stringify(f.souls), before);
  const serialized = JSON.stringify(build);
  for (const privateValue of ['private-', 'file://', 'my account', 'instanceId', 'iconUrl']) assert.ok(!serialized.includes(privateValue));
  assert.equal(build.souls[0].mainAttribute.label, '攻击');
  assert.equal(build.souls[0].itemId, null);
  assert.deepEqual(build.target, f.target);
});
test('validation rejects bad positions, impossible numbers and duplicate attributes; target is optional', () => {
  const { build } = fixture();
  for (const mutate of [b => b.souls.pop(), b => b.souls[0].position = 2, b => b.souls[0].subAttributes[0].value = 99,
    b => b.souls[0].subAttributes[0].value = NaN, b => b.souls[0].subAttributes[0].name = 'unknown',
    b => b.souls[0].level = 14, b => b.target = { min: 2, max: 1 }, b => b.version = 9,
    b => b.souls[0].subAttributes[1] = b.souls[0].subAttributes[0]]) {
    const bad = structuredClone(build); mutate(bad); assert.throws(() => normalizeCommunityBuild(bad));
  }
  assert.deepEqual(normalizeCommunityBuild({ ...build, target: undefined }).target, {});
  assert.deepEqual(normalizeCommunityBuild({ ...build, target: {} }).target, {});
  assert.equal(normalizeCommunityEndpoint(' https://example.com/ '), 'https://example.com');
  assert.equal(normalizeCommunityEndpoint('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com?secret=1', 'file:///tmp/test', 'invalid']) assert.throws(() => normalizeCommunityEndpoint(url));
});
test('real gear can have a substat matching its main stat; system title uses actual suit counts', () => {
  const f = fixture();
  f.souls[0].subAttributes[0] = { ...f.souls[0].mainAttribute, value: 75, rolls: 3 };
  const build = createCommunityBuild(f.plan, f.souls, f.options, f.hero.id, '', '');
  assert.equal(build.souls[0].subAttributes[0].name, build.souls[0].mainAttribute.name);
  const title = communityBuildTitle(f.hero, build.souls, soulCatalog.suits);
  assert.ok(title.startsWith(`${f.hero.name} · `));
  for (const suit of f.plan.suits) assert.ok(title.includes(`${soulCatalog.suits.find(s => s.id === suit.id).name}×${suit.count}`));
  assert.equal(communityBuildTitle(f.hero, [...build.souls].reverse(), soulCatalog.suits), title);
});
test('six-star standard accepts true boundary stats and rejects excess values, allocations and fixed main/intrinsic stats', () => {
  const { build } = fixture();
  const caps = { attackAdditionVal: 162, maxHpAdditionVal: 684, defenseAdditionVal: 30, speedAdditionVal: 18,
    attackAdditionRate: .18, maxHpAdditionRate: .18, defenseAdditionRate: .18, critRateAdditionVal: .18,
    critPowerAdditionVal: .24, debuffEnhance: .24, debuffResist: .24 };
  for (const [name, cap] of Object.entries(caps)) {
    const testBuild = structuredClone(build), otherNames = Object.keys(caps).filter(n => n !== name).slice(0, 3);
    testBuild.souls[0].subAttributes = [{ name, value: cap, rolls: 6 }, ...otherNames.map(name => ({ name, value: caps[name] / 6, rolls: 1 }))];
    assert.doesNotThrow(() => normalizeCommunityBuild(testBuild), name);
    testBuild.souls[0].subAttributes[0].value = cap + .001; assert.throws(() => normalizeCommunityBuild(testBuild), undefined, name);
  }
  const tooMany = structuredClone(build); tooMany.souls[0].subAttributes = ['critRateAdditionVal','attackAdditionRate','speedAdditionVal','critPowerAdditionVal'].map(name => ({ name, value: caps[name], rolls: 6 }));
  assert.throws(() => normalizeCommunityBuild(tooMany), /九次/);
  tooMany.souls[0].subAttributes.forEach(a => delete a.rolls); assert.throws(() => normalizeCommunityBuild(tooMany), /九次/);
  const wrongRoll = structuredClone(build); wrongRoll.souls[0].subAttributes[0].rolls = 1; assert.throws(() => normalizeCommunityBuild(wrongRoll), /分配次数/);
  const wrongMain = structuredClone(build); wrongMain.souls[0].mainAttribute.value = 500; assert.throws(() => normalizeCommunityBuild(wrongMain));
  const wrongIntrinsic = structuredClone(build); wrongIntrinsic.souls[0].intrinsicAttributes = [{ name: 'speedAdditionVal', value: 8 }]; assert.throws(() => normalizeCommunityBuild(wrongIntrinsic), /固有属性/);
});
test('comparison rescores both real schemes under viewer conditions and reports every incompatible constraint', () => {
  const f = fixture(), forged = { ...f.entry, score: 999999, panel: { attack: 999999 }, base: { ...f.options.base, attack: 999999 } };
  const report = compareCommunityBuild(forged, { ...f.plan, score: 999999, panel: {} }, f.souls, soulCatalog.suits, f.options, f.target);
  assert.equal(report.delta, 0); assert.equal(report.meetsTarget, true); assert.deepEqual(report.plan.panel, f.plan.panel);
  const different = { ...f.options, requirements: [{ suitId: 300036, count: 4 }], twoPieceAttribute: 'debuffEnhance', mainAttributes: { 2: ['speedAdditionVal'] }, ranges: { speed: { min: 999 } } };
  const rejected = compareCommunityBuild(f.entry, f.plan, f.souls, soulCatalog.suits, different, f.target);
  assert.equal(rejected.meetsTarget, false); assert.equal(rejected.violations.length, 4);
  assert.equal(compareCommunityBuild(f.entry, f.plan, f.souls, soulCatalog.suits, f.options, { min: f.plan.score + 1 }).meetsTarget, false);
});
function workerHarness() {
  const db = new DatabaseSync(':memory:');
  for (const migration of fs.readdirSync(path.join(root, 'cloudflare/soul-community/migrations')).sort()) db.exec(fs.readFileSync(path.join(root, 'cloudflare/soul-community/migrations', migration), 'utf8'));
  let permitted = true;
  const env = { DB: { async batch(statements) { db.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; } }, prepare(sql) { let bindings = []; return { bind(...values) { bindings = values; return this; },
    async all() { return { results: db.prepare(sql).all(...bindings) }; }, async first() { return db.prepare(sql).get(...bindings) ?? null; }, async run() { return db.prepare(sql).run(...bindings); } }; } },
    READ_LIMITER: { async limit() { return { success: permitted }; } }, WRITE_LIMITER: { async limit() { return { success: permitted }; } } };
  if (!worker) {
    execFileSync(process.execPath, [path.join(root, 'desktop/node_modules/typescript/bin/tsc'), '-p', path.join(root, 'cloudflare/soul-community/tsconfig.json'), '--noEmit', 'false', '--module', 'Node16', '--moduleResolution', 'Node16', '--rootDir', root, '--outDir', workerOutput]);
    worker = require(path.join(workerOutput, 'cloudflare/soul-community/src/index.js')).default;
  }
  const call = async (method, pathname = '/v1/builds', body, token = 'b'.repeat(64), headers = {}) => worker.fetch(new Request(`https://community.example${pathname}`, { method,
    headers: { 'Content-Type': 'application/json', 'X-Delete-Token': token, Authorization: `Bearer ${token}`, ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env);
  return { db, env, call, throttle() { permitted = false; } };
}
test('GitHub identity login binds legacy uploads, works across devices and revokes guest/session access', async () => {
  const h = workerHarness(), f = fixture(), originalFetch = global.fetch;
  let githubId = 123456, githubLogin = 'GithubTester', mode = 'authorized', requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    assert.equal(init.redirect, 'manual', 'Workers only supports follow/manual; redirect responses must never receive OAuth credentials');
    if (String(url).endsWith('/login/device/code')) {
      assert.equal(new URLSearchParams(init.body).get('scope'), '');
      return Response.json({ device_code: 'd'.repeat(40), user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    }
    if (String(url).endsWith('/login/oauth/access_token')) return Response.json(mode === 'pending' ? { error: 'authorization_pending' } : { access_token: 'isolated-smoke-key', token_type: 'bearer', scope: '' });
    assert.equal(url, 'https://api.github.com/user'); assert.equal(init.headers.Authorization, 'Bearer isolated-smoke-key');
    return Response.json({ id: githubId, login: githubLogin, type: 'User' });
  };
  const signIn = async legacy => {
    const start = await (await h.call('POST', '/v1/auth/github/start', undefined, legacy)).json();
    assert.equal(start.verificationUrl, 'https://github.com/login/device'); assert.equal(start.device_code, undefined);
    h.db.prepare('UPDATE community_login_flows SET next_poll_at = 0').run();
    const response = await h.call('POST', '/v1/auth/github/poll', undefined, legacy, { 'X-Login-Token': start.flowToken });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    const published = await (await h.call('POST', '/v1/builds', f.build)).json(); h.env.GITHUB_CLIENT_ID = 'public-test-client';
    assert.equal((await h.call('POST', '/v1/builds', f.build)).status, 401);
    const login = await signIn('b'.repeat(64)); assert.equal(login.status, 'complete'); assert.equal(login.user.author, f.build.author); assert.match(login.sessionToken, /^cs_[a-f0-9]{64}$/);
    assert.equal(login.access_token, undefined);
    const account = await (await h.call('GET', '/v1/account', undefined, login.sessionToken)).json(); assert.equal(account.user.githubId, '123456');
    assert.equal((await h.call('DELETE', `/v1/builds/${published.id}`)).status, 401);
    const deviceTwo = await signIn('c'.repeat(64));
    const owned = await (await h.call('GET', '/v1/my-builds', undefined, deviceTwo.sessionToken)).json(); assert.equal(owned.uploads[0].id, published.id);
    assert.equal((await h.call('POST', '/v1/builds', { ...f.build, author: '账号署名' }, deviceTwo.sessionToken)).status, 201);
    const renamed = await (await h.call('GET', '/v1/account', undefined, login.sessionToken)).json(); assert.equal(renamed.user.author, '账号署名');
    const rename = await h.call('POST', '/v1/account', { author: '　新署名Ａ　' }, login.sessionToken);
    assert.equal(rename.status, 200); assert.equal((await rename.json()).user.author, '新署名A');
    assert.equal((await (await h.call('GET', '/v1/account', undefined, deviceTwo.sessionToken)).json()).user.author, '新署名A');
    const publicBuilds = await (await h.call('GET', `/v1/builds?heroId=${f.hero.id}&objective=damage`)).json();
    assert.ok(publicBuilds.entries.every(entry => entry.author === '新署名A'));
    for (const author of ['', 'x'.repeat(31), 'bad\nname', 123]) assert.equal((await h.call('POST', '/v1/account', { author }, login.sessionToken)).status, 400);
    assert.equal((await h.call('POST', '/v1/account', '{broken', login.sessionToken)).status, 400);
    assert.equal((await h.call('POST', '/v1/account', { author: 'x'.repeat(3000) }, login.sessionToken)).status, 413);
    assert.equal((await h.call('POST', '/v1/account', { author: '未登录改名' })).status, 401);
    githubId = 654321; githubLogin = 'OtherTester';
    const other = await signIn('b'.repeat(64)); assert.equal(other.status, 'complete');
    assert.equal((await h.call('POST', '/v1/account', { author: '新署名a' }, other.sessionToken)).status, 409);
    assert.equal((await (await h.call('GET', '/v1/account', undefined, other.sessionToken)).json()).user.author, other.user.author);
    assert.deepEqual((await (await h.call('GET', '/v1/my-builds', undefined, other.sessionToken)).json()).uploads, []);
    assert.equal((await h.call('DELETE', `/v1/builds/${published.id}`, undefined, other.sessionToken)).status, 403);
    assert.equal((await h.call('GET', '/v1/account', undefined, `cs_${'a'.repeat(64)}`)).status, 401);
    assert.equal((await h.call('POST', '/v1/auth/logout', undefined, login.sessionToken)).status, 200);
    assert.equal((await h.call('GET', '/v1/account', undefined, login.sessionToken)).status, 401);
    assert.equal((await h.call('DELETE', `/v1/builds/${published.id}`, undefined, deviceTwo.sessionToken)).status, 200);
    const dump = JSON.stringify(h.db.prepare('SELECT * FROM community_sessions').all());
    assert.ok(!dump.includes(deviceTwo.sessionToken)); assert.ok(!dump.includes('isolated-smoke-key'));
  } finally { global.fetch = originalFetch; h.db.close(); }
});
test('GitHub flows enforce poll intervals, cancellation, expiry and actual verified account identity', async () => {
  const h = workerHarness(), originalFetch = global.fetch; h.env.GITHUB_CLIENT_ID = 'public-test-client';
  let exchangeCount = 0, mode = 'pending';
  global.fetch = async url => {
    if (String(url).endsWith('/login/device/code')) return Response.json({ device_code: 'd'.repeat(40), user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    if (String(url).endsWith('/login/oauth/access_token')) { exchangeCount++; return Response.json(mode === 'pending' ? { error: 'slow_down', interval: 10 } : mode === 'denied' ? { error: 'access_denied' } : { access_token: 'isolated-smoke-key' }); }
    return Response.json({ id: 1, login: 'Organization', type: 'Organization' });
  };
  const start = async () => (await h.call('POST', '/v1/auth/github/start')).json();
  const poll = token => h.call('POST', '/v1/auth/github/poll', undefined, 'b'.repeat(64), { 'X-Login-Token': token });
  try {
    const flow = await start(); assert.equal((await (await poll(flow.flowToken)).json()).status, 'pending'); assert.equal(exchangeCount, 0);
    h.db.prepare('UPDATE community_login_flows SET next_poll_at = 0').run();
    const concurrent = await Promise.all([poll(flow.flowToken), poll(flow.flowToken)]); assert.ok(concurrent.every(r => r.status === 200)); assert.equal(exchangeCount, 1);
    assert.equal(h.db.prepare('SELECT interval_seconds FROM community_login_flows').get().interval_seconds, 10);
    await h.call('POST', '/v1/auth/github/cancel', undefined, 'b'.repeat(64), { 'X-Login-Token': flow.flowToken }); assert.equal((await poll(flow.flowToken)).status, 410);
    const expired = await start(); h.db.prepare('UPDATE community_login_flows SET expires_at = 0').run(); assert.equal((await poll(expired.flowToken)).status, 410);
    const denied = await start(); mode = 'denied'; h.db.prepare('UPDATE community_login_flows SET next_poll_at = 0').run(); assert.equal((await poll(denied.flowToken)).status, 410);
    const invalid = await start(); mode = 'identity'; h.db.prepare('UPDATE community_login_flows SET next_poll_at = 0').run(); assert.equal((await poll(invalid.flowToken)).status, 502);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM community_accounts').get().n, 0);
    h.throttle(); assert.equal((await h.call('POST', '/v1/auth/github/start')).status, 429);
  } finally { global.fetch = originalFetch; h.db.close(); }
});
test('saved community sessions are encrypted, isolated by service and unavailable to renderer layouts', () => {
  const { SoulCommunityAuthStore } = require('../dist-electron/main/soulCommunityAuthStore.js');
  let saved = '', available = true;
  const storage = { available: () => available, encrypt: value => `sealed:${value.split('').reverse().join('')}`, decrypt: value => { if (!value.startsWith('sealed:')) throw Error('bad ciphertext'); return value.slice(7).split('').reverse().join(''); } };
  const file = { read: () => saved, write: value => { saved = value; } };
  const store = new SoulCommunityAuthStore(storage, file), user = { githubId: '123', login: 'Tester', author: '署名' }, token = `cs_${'f'.repeat(64)}`;
  store.set('https://one.example', { token, user, expiresAt: Date.now() + 60000 }); assert.ok(!saved.includes(token));
  const reopened = new SoulCommunityAuthStore(storage, file); assert.equal(reopened.get('https://one.example').token, token); assert.equal(reopened.get('https://other.example'), undefined);
  const copy = reopened.get('https://one.example'); copy.user.author = '篡改'; assert.equal(reopened.get('https://one.example').user.author, '署名');
  reopened.remove('https://one.example'); assert.equal(new SoulCommunityAuthStore(storage, file).get('https://one.example'), undefined);
  available = false; const before = saved, memoryOnly = new SoulCommunityAuthStore(storage, file);
  memoryOnly.set('https://one.example', { token, user, expiresAt: Date.now() + 60000 }); assert.equal(memoryOnly.persistent(), false); assert.equal(saved, before); assert.equal(memoryOnly.get('https://one.example').token, token);
});
test('Worker + actual SQLite migration: upload, filter, deduplicate, paginate and owner-only withdrawal', async () => {
  const h = workerHarness(), f = fixture();
  try {
    const first = await h.call('POST', '/v1/builds', f.build); assert.equal(first.status, 201); const published = await first.json();
    const again = await h.call('POST', '/v1/builds', { ...f.build, title: '更新名称' }); assert.equal((await again.json()).id, published.id);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM builds').get().n, 1);
    const listPath = `/v1/builds?heroId=${f.hero.id}&objective=damage`;
    const listed = await (await h.call('GET', listPath)).json(); assert.equal(listed.entries[0].title, communityBuildTitle(f.hero, f.souls, soulCatalog.suits)); assert.equal(listed.cursor, null);
    assert.ok(!JSON.stringify(listed).includes('delete_hash'));
    assert.equal((await h.call('DELETE', `/v1/builds/${published.id}`, undefined, 'c'.repeat(64))).status, 403);
    const insert = h.db.prepare('INSERT INTO builds VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < 52; i++) insert.run(i.toString(16).padStart(64, '0'), f.hero.id, 'damage', '2026-01-01T00:00:00.000Z', JSON.stringify(f.build), 'test');
    const page = await (await h.call('GET', listPath)).json(); assert.equal(page.entries.length, 50); assert.ok(page.cursor);
    const next = await (await h.call('GET', `${listPath}&cursor=${encodeURIComponent(page.cursor)}`)).json(); assert.equal(next.entries.length, 3); assert.equal(next.cursor, null);
    assert.equal(new Set([...page.entries, ...next.entries].map(v => v.id)).size, 53);
    assert.equal((await h.call('GET', '/v1/builds?heroId=1&objective=damage')).status, 200);
    assert.equal((await h.call('GET', `${listPath}&cursor=bad`)).status, 400);
    assert.equal((await h.call('DELETE', `/v1/builds/${published.id}`)).status, 200);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM builds WHERE id = ?').get(published.id).n, 0);
  } finally { h.db.close(); }
});
test('Worker reserves unique signatures by owner, normalizes names and keeps all builds in sync', async () => {
  const h = workerHarness(), f = fixture();
  try {
    const first = await h.call('POST', '/v1/builds', { ...f.build, author: 'Alice' }); assert.equal(first.status, 201);
    const response = await first.json(); assert.equal(response.author, 'Alice');
    const clash = await h.call('POST', '/v1/builds', { ...f.build, author: ' ＡＬＩＣＥ ' }, 'c'.repeat(64));
    assert.equal(clash.status, 409); assert.match((await clash.json()).error, /已被其他用户使用/);
    const renamed = await h.call('POST', '/v1/builds', { ...f.build, author: '新的署名', target: {} }); assert.equal(renamed.status, 201);
    const list = await (await h.call('GET', `/v1/builds?heroId=${f.hero.id}&objective=damage`)).json();
    assert.equal(list.entries.length, 2); assert.ok(list.entries.every(e => e.author === '新的署名'));
    const races = await Promise.all(['c', 'd'].map(token => h.call('POST', '/v1/builds', { ...f.build, author: '同时申请' }, token.repeat(64))));
    assert.deepEqual(races.map(r => r.status).sort(), [201, 409]);
    const anonymous = await h.call('POST', '/v1/builds', { ...f.build, author: '' }, 'e'.repeat(64)); assert.equal(anonymous.status, 201);
    assert.match((await anonymous.json()).author, /^御魂玩家-[a-f0-9]{12}$/);
  } finally { h.db.close(); }
});
test('Worker accepts scores below/above reference target and uploads without any target', async () => {
  const h = workerHarness(), { build } = fixture();
  try {
    for (const target of [{ min: 9999999 }, { max: 0 }, undefined]) {
      const response = await h.call('POST', '/v1/builds', { ...build, target, ranges: { speed: { min: 999 } } });
      assert.equal(response.status, 201);
    }
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM builds').get().n, 3);
  } finally { h.db.close(); }
});
test('Worker rejects fabricated panel builds, malformed bodies and throttles requests', async () => {
  const h = workerHarness(), { build } = fixture();
  try {
    assert.equal((await h.call('POST', '/v1/builds', { ...build, base: { ...build.base, attack: build.base.attack + 1 } })).status, 400);
    assert.equal((await h.call('POST', '/v1/builds', '{broken')).status, 400);
    assert.equal((await h.call('POST', '/v1/builds', 'x'.repeat(24001))).status, 400);
    assert.equal((await h.call('PUT')).status, 405); assert.equal((await h.call('GET', '/missing')).status, 404);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM builds').get().n, 0);
    h.throttle(); assert.equal((await h.call('POST', '/v1/builds', build)).status, 429);
  } finally { h.db.close(); }
});
test('desktop network bridge validates input and translates failed service responses', async () => {
  const filename = path.join(root, 'desktop/dist-electron/main/soulCommunityService.js');
  const exports = {}; let response = Response.json({ error: '请求过于频繁' }, { status: 429 }), calls = 0;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { exports, require(name) { if (name === 'electron') return { app: { getPath: () => path.join(workerOutput, 'bridge-errors') }, net: { async fetch(url, init) { calls++; assert.equal(init.redirect, 'error'); return response; } } }; return require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name); }, Buffer, URLSearchParams, AbortSignal, Error });
  const { build, hero, entry } = fixture();
  await assert.rejects(exports.uploadCommunityBuild('https://example.com', build, 'bad'), /凭据/); assert.equal(calls, 0);
  await assert.rejects(exports.listCommunityBuilds('https://example.com', { heroId: hero.id, objective: 'damage' }), /频繁/);
  response = Response.json({ entries: [entry], cursor: null });
  const page = await exports.listCommunityBuilds('https://example.com', { heroId: hero.id, objective: 'damage' }); assert.equal(page.entries.length, 1);
  response = Response.json({ entries: [{}], cursor: null });
  const stale = await exports.listCommunityBuilds('https://example.com', { heroId: hero.id, objective: 'damage' }, { refresh: true });
  assert.equal(stale.cache.stale, true); assert.equal(stale.entries.length, 1);
});
test('network bridge persists cache across instances and invalidates it only after successful mutations', async () => {
  const filename = path.join(root, 'desktop/dist-electron/main/soulCommunityService.js'), f = fixture();
  const directory = path.join(workerOutput, 'bridge-cache'), query = { heroId: f.hero.id, objective: 'damage' }, endpoint = 'https://community.example';
  let gets = 0, failMutation = false;
  const create = () => {
    const exports = {};
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { exports, require(name) {
      if (name === 'electron') return { app: { getPath: () => directory }, net: { async fetch(_url, init) {
        if (!init.method) { gets++; return Response.json({ entries: [f.entry], cursor: null }); }
        if (failMutation) return Response.json({ error: '操作失败' }, { status: 500 });
        return Response.json(init.method === 'POST' ? { id: f.entry.id, createdAt: f.entry.createdAt, author: f.entry.author } : { ok: true });
      } } };
      return require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name);
    }, Buffer, URLSearchParams, AbortSignal, Error }); return exports;
  };
  const service = create(); await service.listCommunityBuilds(endpoint, query);
  assert.ok(fs.existsSync(path.join(directory, 'soul-community-cache.json')));
  const reopened = create(); assert.equal((await reopened.listCommunityBuilds(endpoint, query)).cache.stale, false); assert.equal(gets, 1);
  failMutation = true;
  await assert.rejects(reopened.uploadCommunityBuild(endpoint, f.build, 'b'.repeat(64)), /操作失败/);
  await reopened.listCommunityBuilds(endpoint, query); assert.equal(gets, 1);
  failMutation = false; await reopened.uploadCommunityBuild(endpoint, f.build, 'b'.repeat(64));
  await reopened.listCommunityBuilds(endpoint, query); assert.equal(gets, 2);
  await reopened.deleteCommunityBuild(endpoint, f.entry.id, 'b'.repeat(64));
  await reopened.listCommunityBuilds(endpoint, query); assert.equal(gets, 3);
  await reopened.listCommunityBuilds(endpoint, query, { refresh: true }); assert.equal(gets, 4);
});
test('community cache persists pages and empty results, shares concurrent loads and isolates query fields', async () => {
  const { SoulCommunityCache } = require('../dist-electron/main/soulCommunityCache.js');
  const f = fixture(), endpoint = 'https://community.example', query = { heroId: f.hero.id, objective: 'damage' };
  let saved = null, calls = 0, now = Date.now();
  const store = { read: () => saved, write: value => { saved = value; } }, cache = new SoulCommunityCache(store, () => now);
  const fetch = async () => { calls++; await tick(); return { entries: [f.entry], cursor: null, filterVersion: 1 }; };
  const pages = await Promise.all([cache.list(endpoint, query, fetch), cache.list(endpoint, query, fetch)]);
  assert.equal(calls, 1); pages[0].entries[0].title = '不能修改缓存'; assert.equal(pages[1].entries[0].title, f.entry.title);
  const cached = await cache.list(endpoint, { objective: 'damage', heroId: f.hero.id, order: 'newest' }, fetch);
  assert.equal(calls, 1); assert.equal(cached.entries[0].title, f.entry.title); assert.equal(cached.cache.stale, false);
  const reopened = new SoulCommunityCache(store, () => now);
  assert.equal((await reopened.list(endpoint, query, fetch)).cache.savedAt, now); assert.equal(calls, 1);
  for (const change of [{ heroId: 999 }, { objective: 'speed' }, { search: '针女' }, { author: '分享者' }, { suit4: 300083 }, { suit2: 300092 }, { main2: 'attackAdditionRate' }, { main4: 'attackAdditionRate' }, { main6: 'critRateAdditionVal' }, { after: '2026-10-04' }, { before: '2026-10-05' }, { order: 'oldest' }, { cursor: `${f.entry.createdAt}|${f.entry.id}` }]) {
    await reopened.list(endpoint, { ...query, ...change }, fetch);
  }
  assert.equal(calls, 14); await reopened.list('https://other.example', query, fetch); assert.equal(calls, 15);
  let emptyCalls = 0;
  const emptyQuery = { ...query, search: '没有数据' }, emptyFetch = async () => { emptyCalls++; return { entries: [], cursor: null }; };
  await reopened.list(endpoint, emptyQuery, emptyFetch); await reopened.list(endpoint, emptyQuery, emptyFetch); assert.equal(emptyCalls, 1);
  assert.ok(saved.length < 4_000_000); assert.ok(!saved.includes('deleteToken'));
});
test('community cache expires, forces refresh, preserves visibly stale offline data and retries failed queries', async () => {
  const { SoulCommunityCache } = require('../dist-electron/main/soulCommunityCache.js');
  const { COMMUNITY_CACHE_TTL_MS } = require('../dist-electron/shared/soul-community.js');
  const f = fixture(), endpoint = 'https://community.example', query = { heroId: f.hero.id, objective: 'damage' };
  let now = Date.now(), saved = null, calls = 0;
  const store = { read: () => saved, write: value => { saved = value; } }, cache = new SoulCommunityCache(store, () => now);
  const fetch = async () => { calls++; return { entries: [f.entry], cursor: null }; };
  await cache.list(endpoint, query, fetch); now += COMMUNITY_CACHE_TTL_MS - 1;
  await cache.list(endpoint, query, fetch); assert.equal(calls, 1);
  now++; await cache.list(endpoint, query, fetch); assert.equal(calls, 2);
  await cache.list(endpoint, query, fetch, true); assert.equal(calls, 3);
  const failure = async () => { throw Error('offline'); };
  const offline = await cache.list(endpoint, query, failure, true); assert.equal(offline.cache.stale, true); assert.equal(offline.entries.length, 1);
  const reopened = new SoulCommunityCache(store, () => now);
  assert.equal((await reopened.list(endpoint, query, fetch)).cache.stale, true); assert.equal(calls, 3);
  await assert.rejects(cache.list(endpoint, { ...query, search: '未缓存' }, failure), /offline/);
  await cache.list(endpoint, { ...query, search: '未缓存' }, fetch); assert.equal(calls, 4);
  now += 7 * 24 * 3600_000;
  await assert.rejects(cache.list(endpoint, query, failure), /offline/);
});
test('community cache invalidation clears every service page and late replies cannot restore withdrawn data', async () => {
  const { SoulCommunityCache } = require('../dist-electron/main/soulCommunityCache.js');
  const f = fixture(), endpoint = 'https://community.example', query = { heroId: f.hero.id, objective: 'damage' };
  let saved = null, calls = 0, resolve;
  const store = { read: () => saved, write: value => { saved = value; } }, cache = new SoulCommunityCache(store);
  const fetch = async () => { calls++; return { entries: [], cursor: null }; };
  await cache.list(endpoint, query, fetch); await cache.list(endpoint, { ...query, search: '针女' }, fetch);
  await cache.list('https://other.example', query, fetch);
  const pending = cache.list(endpoint, { ...query, author: '分享者' }, () => new Promise(r => { resolve = r; }));
  cache.invalidate(endpoint); resolve({ entries: [f.entry], cursor: null }); await pending;
  assert.equal(JSON.parse(saved).pages.length, 1);
  await cache.list('https://other.example', query, fetch); assert.equal(calls, 3);
  await cache.list(endpoint, query, fetch); await cache.list(endpoint, { ...query, author: '分享者' }, fetch); assert.equal(calls, 5);
});
test('community cache bounds storage and recovers from corrupt files and unwritable storage', async () => {
  const { SoulCommunityCache } = require('../dist-electron/main/soulCommunityCache.js');
  const query = { heroId: 1, objective: 'damage' }, endpoint = 'https://community.example';
  let saved = '{broken', calls = 0;
  const store = { read: () => saved, write: value => { saved = value; } }, cache = new SoulCommunityCache(store);
  const fetch = async () => { calls++; return { entries: [], cursor: null }; };
  for (let n = 0; n < 45; n++) await cache.list(endpoint, { ...query, heroId: n + 1 }, fetch);
  assert.equal(JSON.parse(saved).pages.length, 40);
  await cache.list(endpoint, query, fetch); assert.equal(calls, 46);
  const noDisk = new SoulCommunityCache({ read() { throw Error('disk'); }, write() { throw Error('disk'); } });
  await noDisk.list(endpoint, query, fetch); await noDisk.list(endpoint, query, fetch); assert.equal(calls, 47);
});
function viewHarness(list, options = {}) {
  const values = options.values ?? new Map(), elements = new Map();
  if (!values.has('onmyoji-studio.souls.community')) values.set('onmyoji-studio.souls.community', JSON.stringify({ endpoint: options.endpoint ?? 'https://community.example', author: '', deleteToken: '' }));
  function element(tag = 'div') {
    const localElements = new Map();
    const node = { tag, children: [], textContent: '', value: '', className: '', attrs: {}, dataset: {}, disabled: false, hidden: false, events: {},
      append(...children) { for (const child of children) child.parent = this; this.children.push(...children); }, replaceChildren(...children) { this.children = children; this.textContent = ''; },
      prepend(...children) { for (const child of children) child.parent = this; this.children.unshift(...children); },
      isConnected: true, open: false, focus() { this.focused = true; },
      showModal() { this.open = true; this.modalShows = (this.modalShows ?? 0) + 1; },
      close() { this.open = false; this.events.close?.(); },
      remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); },
      setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(event, fn) { this.events[event] = fn; },
      removeEventListener(event, fn) { if (this.events[event] === fn) delete this.events[event]; },
      querySelector(selector) { const name = selector.match(/data-community="(.*?)"/)?.[1]; return localElements.get(name) ?? this.children.find(child => name && child.dataset.community === name) ?? this.children.map(child => child.querySelector(selector)).find(Boolean) ?? null; },
      querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]); },
      async fire(event = 'click', data) { return this.events[event]?.(data); } };
    node.classList = { toggle() {}, add(name) { node.className += ` ${name}`; } }; node.ownerDocument = { createElement: element, createElementNS: (_namespace, tag) => element(tag) };
    Object.defineProperty(node, 'innerHTML', { set(html) {
      localElements.clear(); for (const name of html.matchAll(/data-community="(.*?)"/g)) { const child = element(); child.dataset.community = name[1]; localElements.set(name[1], child); elements.set(name[1], child); }
      const account = localElements.get('account');
      if (account) for (const name of ['account-avatar', 'account-name', 'account-login', 'account-badge', 'account-status', 'login-actions', 'login', 'logout', 'login-prompt', 'login-code', 'login-open', 'login-cancel', 'rename-fields', 'rename-author', 'rename-save']) {
        account.append(localElements.get(name)); localElements.delete(name);
      }
    } });
    return node;
  }
  const host = element(), uploadHost = element(), accountButton = options.accountButton ? element('button') : undefined; let uploads = [];
  host.ownerDocument.body = element('body');
  const api = { readLayout: key => values.get(key) ?? null, writeLayout: (key, value) => values.set(key, value), listCommunityBuilds: list,
    async uploadCommunityBuild(endpoint, build, token) { uploads.push({ endpoint, build, token }); return { id: 'd'.repeat(64), createdAt: new Date().toISOString(), author: build.author }; }, async deleteCommunityBuild() {} };
  Object.assign(api, options.api ?? {});
  const module = require('../dist-test-renderer/renderer/soul-community-view.js');
  let visibility; const opened = [];
  const originalObserver = global.IntersectionObserver;
  global.IntersectionObserver = class { constructor(callback) { visibility = this; this.callback = callback; } observe() {} disconnect() { this.disconnected = true; } fire(visible) { this.callback([{ isIntersecting: visible }]); } };
  let view;
  try { view = options.panels ? module.installSoulCommunityPanels(host, uploadHost, api, soulCatalog.suits, upload => opened.push(upload), accountButton) : module.installSoulCommunity(host, api, soulCatalog.suits, uploadHost); }
  finally { global.IntersectionObserver = originalObserver; }
  return { view, host, uploadHost, elements, uploads, values, element, visibility, opened, api, accountButton };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('titlebar account dialog shares login controls and updates without a calculated soul plan', async () => {
  const timers = [], originalTimeout = global.setTimeout, originalClear = global.clearTimeout;
  global.setTimeout = callback => { timers.push(callback); return timers.length; }; global.clearTimeout = () => {};
  const user = { githubId: '123456', login: 'Tester', author: '我的署名' };
  let starts = 0, logouts = 0;
  const h = viewHarness(async () => ({ entries: [], cursor: null }), { panels: true, accountButton: true, api: {
    async getCommunityAccount() { return { user: null, persistent: true }; },
    async startCommunityLogin() { starts++; return { userCode: 'ABCD-EFGH', interval: 5 }; },
    async openCommunityLogin() {},
    async pollCommunityLogin() { return { status: 'complete', account: { user, persistent: true } }; },
    async renameCommunityAccount(_endpoint, author) { if (author === '重名') throw Error('这个署名已被其他用户使用'); return { user: { ...user, author }, persistent: true }; },
    async logoutCommunityAccount() { logouts++; },
    async listCommunityOwnedBuilds() { return { uploads: [], cursor: null }; },
  } });
  const dialog = h.host.ownerDocument.body.children.find(node => node.tag === 'dialog');
  try {
    await tick(); assert.equal(h.accountButton.textContent, '用户登录');
    assert.ok(dialog.children.includes(h.elements.get('account')));
    await h.accountButton.fire(); assert.equal(dialog.open, true); assert.equal(starts, 0);
    await h.elements.get('login').fire(); assert.equal(starts, 1); assert.equal(h.accountButton.textContent, '登录中…');
    dialog.close(); await h.accountButton.fire(); assert.equal(h.elements.get('login-code').value, 'ABCD-EFGH');
    timers.shift()(); await tick(); assert.equal(h.accountButton.textContent, user.author); assert.match(h.accountButton.title, /Tester/);
    assert.equal(h.elements.get('author').value, user.author);
    h.elements.get('rename-author').value = '新署名'; await h.elements.get('rename-save').fire();
    assert.equal(h.accountButton.textContent, '新署名'); assert.equal(h.elements.get('author').value, '新署名');
    assert.equal(JSON.parse(h.values.get('onmyoji-studio.souls.community')).author, '新署名');
    h.elements.get('rename-author').value = '重名'; await h.elements.get('rename-save').fire();
    assert.match(h.elements.get('account-status').textContent, /其他用户/); assert.equal(h.accountButton.textContent, '新署名');
    await h.elements.get('logout').fire(); assert.equal(logouts, 1); assert.equal(h.accountButton.textContent, '用户登录');
  } finally { h.view.dispose(); global.setTimeout = originalTimeout; global.clearTimeout = originalClear; }
  assert.equal(dialog.isConnected, false); assert.equal(h.accountButton.events.click, undefined);
});
test('GitHub upload UI requires login, shows authorization code, synchronizes owned builds and cancels late polls', async () => {
  const f = fixture(), timers = [], originalTimeout = global.setTimeout, originalClear = global.clearTimeout;
  global.setTimeout = callback => { timers.push(callback); return timers.length; }; global.clearTimeout = () => {};
  let starts = 0, opens = 0, polls = 0, cancels = 0, loggedOut = 0;
  const user = { githubId: '123456', login: 'Tester', author: 'GitHub署名' };
  const h = viewHarness(async () => ({ entries: [f.entry], cursor: null }), { api: {
    async getCommunityAccount() { return { user: null, persistent: true }; },
    async startCommunityLogin(_endpoint, legacy) { starts++; assert.match(legacy, /^[a-f0-9]{64}$/); return { userCode: 'ABCD-EFGH', verificationUrl: 'https://github.com/login/device', expiresAt: Date.now() + 900000, interval: 5 }; },
    async openCommunityLogin() { opens++; },
    async pollCommunityLogin() { polls++; return { status: 'complete', account: { user: { ...user }, persistent: true } }; },
    async cancelCommunityLogin() { cancels++; }, async logoutCommunityAccount() { loggedOut++; },
    async listCommunityOwnedBuilds() { return { uploads: [{ id: f.entry.id, title: f.entry.title }], cursor: null }; },
  } });
  try {
    h.view.update({ hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options }); await tick();
    assert.equal(h.elements.get('upload').disabled, true); await h.elements.get('upload').fire(); assert.equal(h.uploads.length, 0);
    await h.elements.get('login').fire(); assert.equal(starts, 1); assert.equal(opens, 1); assert.equal(h.elements.get('login-code').value, 'ABCD-EFGH');
    assert.equal(h.elements.get('login-prompt').hidden, false); timers.shift()(); await tick();
    assert.equal(polls, 1); assert.equal(h.elements.get('login-prompt').hidden, true); assert.equal(h.elements.get('upload').disabled, false);
    assert.equal(h.elements.get('author').value, user.author); assert.equal(h.elements.get('owned').children.length, 1); assert.match(h.elements.get('account-login').textContent, /Tester/);
    await h.elements.get('upload').fire(); assert.equal(h.uploads.length, 1); assert.equal(h.uploads[0].build.author, user.author);
    assert.ok([...h.values.values()].every(value => !value.includes('sessionToken') && !value.includes('cs_')));
    await h.elements.get('logout').fire(); assert.equal(loggedOut, 1); assert.equal(h.elements.get('upload').disabled, true);
    await h.elements.get('login').fire(); const cancelledTimer = timers.shift(); await h.elements.get('login-cancel').fire(); cancelledTimer(); await tick();
    assert.equal(cancels, 1); assert.equal(polls, 1); assert.equal(h.elements.get('login-code').value, '');
  } finally { h.view.dispose(); global.setTimeout = originalTimeout; global.clearTimeout = originalClear; }
});
test('desktop GitHub bridge keeps flow/session secrets out of IPC and automatically authenticates mutations', async () => {
  const filename = path.join(root, 'desktop/dist-electron/main/soulCommunityService.js'), f = fixture(), directory = path.join(workerOutput, 'bridge-github');
  const user = { githubId: '123456', login: 'Tester', author: '分享者' }, sessionToken = `cs_${'e'.repeat(64)}`, flowToken = 'f'.repeat(64);
  const requests = [], opened = []; let pendingResponse;
  const exports = {}, safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text.split('').reverse().join('')), decryptString: buffer => buffer.toString().split('').reverse().join('') };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { exports, require(name) {
    if (name === 'electron') return { app: { getPath: () => directory }, safeStorage, shell: { async openExternal(url) { opened.push(url); } }, net: { async fetch(url, init) {
      requests.push({ url, init });
      if (url.endsWith('/start')) return Response.json({ flowToken, userCode: 'ABCD-EFGH', verificationUrl: 'https://github.com/login/device', expiresAt: Date.now() + 900000, interval: 5 });
      if (url.endsWith('/poll')) return pendingResponse ?? Response.json({ status: 'complete', user, sessionToken, expiresAt: Date.now() + 86400000 });
      if (url.endsWith('/account')) { if (init.method === 'POST') user.author = JSON.parse(init.body).author; return Response.json({ user }); }
      if (url.endsWith('/my-builds')) return Response.json({ uploads: [{ id: f.entry.id, title: f.entry.title }], cursor: null });
      if (url.endsWith('/builds') && init.method === 'POST') return Response.json({ id: f.entry.id, createdAt: f.entry.createdAt, author: user.author });
      return Response.json({ ok: true });
    } } };
    return require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name);
  }, Buffer, URLSearchParams, AbortSignal, Error });
  const endpoint = 'https://community.example';
  const prompt = await exports.startCommunityLogin(endpoint, 'b'.repeat(64)); assert.equal(prompt.flowToken, undefined);
  await exports.openCommunityLogin(endpoint); assert.deepEqual(opened, ['https://github.com/login/device']);
  const complete = await exports.pollCommunityLogin(endpoint); assert.equal(complete.status, 'complete'); assert.equal(complete.sessionToken, undefined);
  assert.ok(!fs.readFileSync(path.join(directory, 'soul-community-auth.json'), 'utf8').includes(sessionToken));
  const renamed = await exports.renameCommunityAccount(endpoint, '　新署名Ａ　');
  assert.equal(renamed.user.author, '新署名A'); assert.equal(renamed.sessionToken, undefined);
  assert.equal(requests.at(-1).init.headers.Authorization, `Bearer ${sessionToken}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'soul-community-auth.json'), 'utf8')).sessions[0].user.author, '新署名A');
  await exports.uploadCommunityBuild(endpoint, f.build, 'b'.repeat(64)); assert.equal(requests.at(-1).init.headers.Authorization, `Bearer ${sessionToken}`); assert.equal(requests.at(-1).init.headers['X-Delete-Token'], undefined);
  await exports.deleteCommunityBuild(endpoint, f.entry.id, 'b'.repeat(64)); assert.equal(requests.at(-1).init.headers.Authorization, `Bearer ${sessionToken}`);
  assert.equal((await exports.listCommunityOwnedBuilds(endpoint)).uploads[0].id, f.entry.id);
  await exports.logoutCommunityAccount(endpoint); assert.equal((await exports.getCommunityAccount(endpoint)).user, null);
  let finish;
  await exports.startCommunityLogin(endpoint, 'b'.repeat(64)); pendingResponse = new Promise(resolve => { finish = resolve; });
  const polling = exports.pollCommunityLogin(endpoint); await tick(); await exports.cancelCommunityLogin(endpoint);
  finish(Response.json({ status: 'complete', user, sessionToken, expiresAt: Date.now() + 86400000 }));
  await assert.rejects(polling, /取消/); assert.equal((await exports.getCommunityAccount(endpoint)).user, null);
});
test('community UI allows any score and missing target while requiring complete actual gear', async () => {
  const f = fixture(), h = viewHarness(async () => ({ entries: [f.entry], cursor: null }));
  const context = { hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options, target: f.target }, before = JSON.stringify(f);
  h.view.update(context); await tick(); assert.equal(h.elements.get('upload').disabled, false); assert.equal(h.elements.get('results').children.length, 1);
  h.view.update({ ...context, target: { min: f.plan.score + 1 } }); assert.equal(h.elements.get('upload').disabled, false);
  await h.elements.get('upload').fire(); assert.equal(h.uploads.length, 1);
  h.view.update({ ...context, target: undefined }); assert.equal(h.elements.get('upload').disabled, false);
  await h.elements.get('upload').fire(); assert.equal(h.uploads.length, 2);
  assert.deepEqual(h.uploads[1].build.target, {});
  h.view.update({ ...context, target: { max: 0 } }); assert.equal(h.elements.get('upload').disabled, false);
  h.view.update({ ...context, inventory: f.souls.slice(1) }); assert.equal(h.elements.get('upload').disabled, true);
  assert.ok(h.elements.get('upload-hint').textContent.includes('社区方案格式无效'));
  assert.equal(h.uploads[0].build.souls.length, 6); assert.equal(h.uploads[0].token.length, 64);
  assert.equal(JSON.stringify(f), before);
  h.view.update(); assert.equal(h.elements.get('upload').disabled, true); assert.equal(h.elements.get('results').children.length, 0);
  h.view.dispose();
});
test('upload UI generates names and persists signature and ownership immediately across restart', async () => {
  const f = fixture(), list = async () => ({ entries: [], cursor: null });
  const h = viewHarness(list), context = { hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options };
  h.view.update(context); await tick();
  assert.equal(h.elements.get('title').value, communityBuildTitle(f.hero, f.souls, soulCatalog.suits));
  const generated = h.elements.get('author').value; assert.match(generated, /^御魂玩家-[a-f0-9]{12}$/);
  h.elements.get('author').value = '记住我的署名'; await h.elements.get('author').fire('input');
  const saved = JSON.parse(h.values.get('onmyoji-studio.souls.community')); assert.equal(saved.author, '记住我的署名');
  h.elements.get('title').value = '手工篡改'; await h.elements.get('upload').fire();
  assert.equal(h.uploads[0].build.title, communityBuildTitle(f.hero, f.souls, soulCatalog.suits));
  h.view.dispose();
  const reopened = viewHarness(list, { values: h.values });
  assert.equal(reopened.elements.get('author').value, '记住我的署名');
  assert.equal(JSON.parse(reopened.values.get('onmyoji-studio.souls.community')).deleteToken, saved.deleteToken);
  reopened.view.dispose();
});
test('late community responses cannot repopulate a cleared or different source context', async () => {
  const f = fixture(), pending = [];
  const h = viewHarness(() => new Promise(resolve => pending.push(resolve))), context = { hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options, target: f.target };
  h.view.update(context); h.view.update(); pending[0]({ entries: [f.entry], cursor: null }); await tick();
  assert.equal(h.elements.get('results').children.length, 0);
  h.view.update(context); h.view.dispose(); pending[1]({ entries: [f.entry], cursor: null }); await tick();
  assert.equal(h.elements.get('results').children.length, 0);
});
test('dockable community panels open independently, load on visibility and keep upload/list statuses separate', async () => {
  const f = fixture(); let requests = 0;
  const h = viewHarness(async () => { requests++; return { entries: [f.entry], cursor: null }; }, { panels: true });
  const trigger = h.element('button');
  assert.equal(h.host.querySelector('[data-community="upload"]'), null);
  assert.equal(h.uploadHost.querySelector('[data-community="comparison"]'), null);
  assert.equal(h.host.children[0].tag, 'section'); assert.equal(h.uploadHost.children[0].tag, 'section');
  h.view.update({ hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options, target: f.target });
  assert.equal(requests, 0);
  h.view.show(trigger, true); assert.equal(h.elements.get('author').focused, true); assert.equal(requests, 0);
  await h.elements.get('connect').fire(); assert.equal(requests, 0);
  await h.elements.get('upload').fire(); assert.equal(h.uploads.length, 1); assert.equal(requests, 0);
  assert.match(h.elements.get('upload-status').textContent, /已公开上传/);
  h.view.show(trigger); await tick(); assert.equal(requests, 1);
  h.view.show(trigger, true); assert.equal(requests, 1);
  await h.elements.get('upload').fire(); assert.equal(h.uploads.length, 2); assert.equal(requests, 2);
  assert.match(h.elements.get('upload-status').textContent, /已公开上传/); assert.match(h.elements.get('status').textContent, /已载入/);
  h.visibility.fire(false); h.view.update({ hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options }); assert.equal(requests, 2);
  h.visibility.fire(true); await tick(); assert.equal(requests, 2, 'recent pages remain available when reopening the panel');
  await h.elements.get('refresh').fire(); await tick(); assert.equal(requests, 3);
  assert.deepEqual(h.opened, [true, false, true]);
  h.view.dispose(); assert.equal(h.host.children.length, 0); assert.equal(h.uploadHost.children.length, 0); assert.equal(h.visibility.disconnected, true);
  h.view.show(trigger); h.visibility.fire(true); assert.equal(requests, 3);
});
test('community panels restore deployed default service address from invalid saved undefined', () => {
  const h = viewHarness(async () => ({ entries: [], cursor: null }), { panels: true, endpoint: 'undefined' });
  assert.equal(h.elements.get('endpoint').value, 'https://onmyoji-soul-community.liukele015.workers.dev');
  h.view.dispose();
});

test('Worker filters the whole query before paging, with literal text, combined gear and inclusive Shanghai dates', async () => {
  const h = workerHarness(), f = fixture();
  try {
    const insert = h.db.prepare('INSERT INTO builds VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < 60; i++) {
      const build = structuredClone(f.build);
      build.author = i === 59 ? "测试_%'" : '其他人'; build.title = communityBuildTitle(f.hero, build.souls, soulCatalog.suits);
      if (i >= 55) build.souls[1].mainAttribute = { ...build.souls[1].mainAttribute, name: 'speedAdditionVal', value: 57 };
      insert.run((i + 100).toString(16).padStart(64, '0'), f.hero.id, 'damage', i < 30 ? '2026-10-04T15:59:59.000Z' : '2026-10-04T16:00:00.000Z', JSON.stringify(build), 'test');
    }
    const base = `/v1/builds?heroId=${f.hero.id}&objective=damage`;
    const get = async suffix => (await h.call('GET', base + suffix)).json();
    const matched = await get('&suit4=300083&suit2=300092&main2=speedAdditionVal&after=2026-10-05&before=2026-10-05');
    assert.equal(matched.entries.length, 5); assert.equal(matched.cursor, null); assert.equal(matched.filterVersion, 1);
    assert.equal((await get('&author=' + encodeURIComponent("_%'"))).entries.length, 1);
    assert.equal((await get('&search=' + encodeURIComponent("_%'"))).entries.length, 1);
    assert.equal((await get('&suit4=300083&suit2=300083')).entries.length, 0);
    assert.equal((await get('&before=2026-10-04')).entries.length, 30);
    assert.equal((await get('&after=2026-10-05')).entries.length, 30);
    const oldest = await get('&order=oldest'), next = await get('&order=oldest&cursor=' + encodeURIComponent(oldest.cursor));
    assert.equal(oldest.entries.length, 50); assert.equal(next.entries.length, 10);
    const all = [...oldest.entries, ...next.entries]; assert.equal(new Set(all.map(e => e.id)).size, 60);
    assert.ok(all.slice(0, 30).every(e => e.createdAt === '2026-10-04T15:59:59.000Z'));
    for (const bad of ['&suit4=NaN', '&suit2=1.5', '&main2=unknown', '&after=2026-02-30', '&after=2026-10-06&before=2026-10-05', '&order=score', '&search=' + 'x'.repeat(61)]) assert.equal((await h.call('GET', base + bad)).status, 400, bad);
  } finally { h.db.close(); }
});

test('community filtering paginates, sorts recalculated scores, clears hidden detail and remembers per-hero choices', async () => {
  const f = fixture(), rows = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(f.entry), id: (i + 1).toString(16).padStart(64, '0'), author: `分享者${i}`, createdAt: new Date(Date.parse(f.entry.createdAt) + i * 1000).toISOString() }));
  rows[0].souls[0].subAttributes[0].value = .14;
  const queries = [], h = viewHarness(async (_endpoint, query) => { queries.push(query); return { entries: rows, cursor: null, filterVersion: 1 }; });
  const context = { hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options, target: f.target };
  h.view.update(context); await tick();
  assert.equal(h.elements.get('results').children.length, 12); assert.equal(h.elements.get('page').textContent, '第 1 / 3 页');
  await h.elements.get('next').fire(); assert.equal(h.elements.get('page').textContent, '第 2 / 3 页');
  await h.elements.get('next').fire(); assert.equal(h.elements.get('results').children.length, 6); assert.equal(h.elements.get('next').disabled, true);
  h.elements.get('sort').value = 'score-asc'; await h.elements.get('sort').fire('change'); await tick();
  assert.equal(queries.length, 1, 'client score ordering uses existing entries');
  assert.equal(h.elements.get('results').children[0].children[1].textContent.startsWith('分享者0 · '), true);
  h.elements.get('score-min').value = String(f.plan.score + 1); await h.elements.get('score-min').fire('input');
  assert.equal(h.elements.get('results').children.length, 0); assert.equal(h.elements.get('comparison').children.length, 0); assert.match(h.elements.get('summary').textContent, /没有匹配/);
  await h.elements.get('reset').fire(); await tick();
  h.elements.get('panel-crit-min').value = String(f.plan.panel.crit * 100 + .1); await h.elements.get('panel-crit-min').fire('input'); assert.equal(h.elements.get('results').children.length, 0);
  h.elements.get('panel-crit-max').value = '1'; await h.elements.get('panel-crit-max').fire('input'); assert.match(h.elements.get('filter-hint').textContent, /下限不能高于/);
  await h.elements.get('reset').fire(); await tick();
  h.elements.get('filter-author').value = '分享者29'; await h.elements.get('apply').fire('click', { preventDefault() {} }); await tick();
  assert.equal(h.elements.get('results').children.length, 1); assert.equal(queries.at(-1).author, '分享者29');
  h.view.dispose();
  const reopened = viewHarness(async (_endpoint, query) => { assert.equal(query.author, '分享者29'); return { entries: rows, cursor: null, filterVersion: 1 }; }, { values: h.values });
  reopened.view.update(context); await tick(); assert.equal(reopened.elements.get('filter-author').value, '分享者29'); assert.equal(reopened.elements.get('results').children.length, 1); reopened.view.dispose();
});

test('community local conditions, own uploads and favorites update without issuing requests', async () => {
  const f = fixture(); let requests = 0;
  const h = viewHarness(async () => { requests++; return { entries: [f.entry], cursor: 'more', filterVersion: 1 }; });
  const context = { hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options, target: f.target };
  h.view.update(context); await tick();
  h.elements.get('match').value = 'target'; await h.elements.get('match').fire('change'); assert.equal(h.elements.get('results').children.length, 1);
  h.view.update({ ...context, target: { min: f.plan.score + 1 } }); assert.equal(h.elements.get('results').children.length, 0);
  h.elements.get('match').value = 'all'; await h.elements.get('match').fire('change');
  const favorite = h.elements.get('comparison').children[0].children.at(-1); assert.equal(favorite.textContent, '收藏方案'); await favorite.fire();
  h.elements.get('scope').value = 'favorites'; await h.elements.get('scope').fire('change'); assert.equal(h.elements.get('results').children.length, 1);
  await h.elements.get('comparison').children[0].children.at(-1).fire(); assert.equal(h.elements.get('comparison').children.length, 0);
  h.elements.get('scope').value = 'mine'; await h.elements.get('scope').fire('change'); assert.equal(h.elements.get('results').children.length, 0);
  h.values.set('onmyoji-studio.souls.community.uploads.https://community.example', JSON.stringify([{ id: f.entry.id, title: f.entry.title }]));
  h.view.update(context); assert.equal(h.elements.get('results').children.length, 1);
  assert.equal(requests, 1); assert.match(h.elements.get('summary').textContent, /还有未加载/); h.view.dispose();
});

test('changed remote filters discard old responses and legacy services report local-only filtering', async () => {
  const f = fixture(), pending = [], queries = [];
  const h = viewHarness((_endpoint, query) => { queries.push(query); return new Promise(resolve => pending.push(resolve)); });
  h.view.update({ hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options });
  h.elements.get('search').value = '匹配不到'; await h.elements.get('apply').fire('click', { preventDefault() {} });
  assert.equal(queries.length, 2); assert.equal(queries[1].cursor, undefined);
  pending[1]({ entries: [f.entry], cursor: null }); await tick();
  assert.equal(h.elements.get('results').children.length, 0); assert.match(h.elements.get('summary').textContent, /仅支持本地筛选/);
  pending[0]({ entries: [f.entry], cursor: 'stale' }); await tick();
  assert.equal(h.elements.get('results').children.length, 0); assert.equal(h.elements.get('more').hidden, true);
  h.elements.get('after').value = '2026-10-06'; h.elements.get('before').value = '2026-10-05';
  await h.elements.get('apply').fire('click', { preventDefault() {} }); assert.equal(queries.length, 2); assert.match(h.elements.get('filter-hint').textContent, /开始日期/); h.view.dispose();
});

test('percent objective ranges use displayed percent values and deltas use percentage points', async () => {
  const f = fixture(), options = { ...f.options, objective: 'critDamage' }, entry = { ...f.entry, objective: 'critDamage' };
  const h = viewHarness(async () => ({ entries: [entry], cursor: null, filterVersion: 1 }));
  h.view.update({ hero: f.hero, plan: f.plan, inventory: f.souls, options }); await tick();
  assert.equal(h.elements.get('score-label').textContent, '社区评分范围（%）');
  h.elements.get('score-min').value = String(f.plan.panel.critDamage * 100 + 1); await h.elements.get('score-min').fire('input'); assert.equal(h.elements.get('results').children.length, 0);
  h.elements.get('score-min').value = String(f.plan.panel.critDamage * 100 - 1); await h.elements.get('score-min').fire('input'); assert.equal(h.elements.get('results').children.length, 1);
  h.elements.get('delta-min').value = '.1'; await h.elements.get('delta-min').fire('input'); assert.equal(h.elements.get('results').children.length, 0);
  h.elements.get('delta-min').value = '-.1'; await h.elements.get('delta-min').fire('input'); assert.equal(h.elements.get('results').children.length, 1); h.view.dispose();
});

test('changing list filters does not cancel the status and ownership of an in-flight upload', async () => {
  const f = fixture(), h = viewHarness(async () => ({ entries: [], cursor: null, filterVersion: 1 }));
  let finish;
  h.api.uploadCommunityBuild = () => new Promise(resolve => { finish = resolve; });
  h.view.update({ hero: f.hero, plan: f.plan, inventory: f.souls, options: f.options }); await tick();
  const uploading = h.elements.get('upload').fire(); assert.equal(h.elements.get('upload').disabled, true);
  h.elements.get('search').value = '新查询'; await h.elements.get('apply').fire('click', { preventDefault() {} }); await tick();
  finish({ id: 'd'.repeat(64), createdAt: f.entry.createdAt, author: '分享者' }); await uploading;
  assert.match(h.elements.get('upload-status').textContent, /已公开上传/); assert.equal(h.elements.get('owned').children.length, 1); assert.equal(h.elements.get('upload').disabled, false); h.view.dispose();
});

test('network bridge forwards validated filters and preserves server filter capability', async () => {
  const filename = path.join(root, 'desktop/dist-electron/main/soulCommunityService.js'), exports = {}, f = fixture();
  let requested, calls = 0;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { exports, require(name) { if (name === 'electron') return { app: { getPath: () => path.join(workerOutput, 'bridge-filters') }, net: { async fetch(url) { calls++; requested = new URL(url); return Response.json({ entries: [f.entry], cursor: null, filterVersion: 1 }); } } }; return require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name); }, Buffer, URLSearchParams, AbortSignal, Error });
  const query = { heroId: f.hero.id, objective: 'damage', search: "测试&_%'", author: '署名', suit4: 300083, suit2: 300092, main2: 'speedAdditionVal', main4: 'attackAdditionRate', main6: 'critRateAdditionVal', after: '2026-10-01', before: '2026-10-05', order: 'oldest' };
  const page = await exports.listCommunityBuilds('https://community.example', query); assert.equal(page.filterVersion, 1);
  for (const [key, value] of Object.entries(query)) assert.equal(requested.searchParams.get(key), String(value));
  await assert.rejects(exports.listCommunityBuilds('https://community.example', { ...query, suit4: 1.5 }));
  await assert.rejects(exports.listCommunityBuilds('https://community.example', { ...query, cursor: 'bad' })); assert.equal(calls, 1);
});
