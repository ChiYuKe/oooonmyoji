const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/lineup-service-harness.cjs');
const ngaParser = harness(async () => { throw new Error('Unexpected network request'); }, 'ngaLineupService').service.parseNgaGuidePage;
const parseNgaGuidePage = (...args) => structuredClone(ngaParser(...args));
const soul = { keyword: '阴阳师 御魂阵容', order: 'pubdate' };
const board = (header = '', rows = '') => `<title>阴阳师 NGA玩家社区</title><span class='postrow'><span id='toppedtopic'>${header}</span></span><table id='topicrows'>${rows}</table>`;
const row = (tid, title, date = 1791000000, replies = 8) => `<tr class='row1 topicrow'><td><a class='replies' href='/read.php?tid=${tid}'>${replies}</a></td><td><a href='/read.php?tid=${tid}&amp;_fp=1' class='topic'>${title}</a></td><td><a href='/nuke.php?uid=1' class='author'>作者 &amp; 伙伴</a><span id='t_pt1_0' class='silver postdate'>${date}</span></td></tr>`;
const visitor = () => new Response(`<title>访客不能直接访问</title><script>document.cookie = 'guestJs=123_public-test;domain='+d+';path=/'</script>`, { status: 403 });
const fixtures = () => new Response(board('[url=/read.php?pid=123&amp;amp;amp;opt=128][b][color=orange]御魂副本[/color][/b][/url][url=/read.php?tid=456]当前版本斗技精华帖汇总[/url]'));

test('parses curated BBCode entries and canonicalizes detail URLs without changing categories', () => {
  const html = board('[url=https://ngabbs.com/read.php?tid=100][b][攻略合集]神罚/魂十[/b][/url][url=/read.php?pid=123&amp;amp;amp;opt=128][b]御魂副本[/b][/url][url=/read.php?tid=456]当前版本斗技精华帖汇总[/url]');
  const result = parseNgaGuidePage(html, soul);
  assert.deepEqual(result.map(item => item.url), ['https://bbs.nga.cn/read.php?tid=100', 'https://bbs.nga.cn/read.php?pid=123&opt=128']);
  assert.equal(result[0].title, '[攻略合集]神罚/魂十');
  assert.equal(result[0].publishedAt, 0);
  assert.ok(result.every(item => item.source === 'nga' && /^SRCH-/.test(item.bvid)));
});

test('recent guide rows carry authors, timestamps and replies; chatter and exchanges are excluded', () => {
  const html = board('', row(1, '魂土低配阵容攻略') + row(2, '金币逢魔换金币') + row(3, '魂土御魂翻车集中帖') + row(4, '今天这分组真好笑') + row(5, '帮打魂土阵容求助') + row(6, '[斗技心得]低配配队'));
  const result = parseNgaGuidePage(html, soul);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, '魂土低配阵容攻略');
  assert.equal(result[0].author, '作者 & 伙伴');
  assert.equal(result[0].publishedAt, 1791000000);
  assert.equal(result[0].replies, 8);
});

test('explicit category and supplementary terms filter titles independently', () => {
  const html = board('', row(1, '魂土15秒低配阵容攻略') + row(2, '魂土16秒低配阵容攻略') + row(3, '魂土15秒高配阵容攻略'));
  const result = parseNgaGuidePage(html, { ...soul, categoryId: 'soul', extraKeyword: '15秒 低配' });
  assert.deepEqual(result.map(item => item.title), ['魂土15秒低配阵容攻略']);
  assert.equal(parseNgaGuidePage(html, { ...soul, keyword: '阴阳师 御魂阵容 15秒 低配' }).length, 1);
});

test('rejects off-site, credentialed, script and non-detail links even when their titles match', () => {
  const badUrls = ['https://bbs.nga.cn.evil.example/read.php?tid=123', 'javascript:alert(1)', 'https://user:pass@bbs.nga.cn/read.php?tid=123', '/nuke.php?tid=123', '/read.php?tid=abc'];
  const html = board(badUrls.map(url => `[url=${url}]御魂副本[/url]`).join(''));
  assert.deepEqual(parseNgaGuidePage(html, soul), []);
});

test('deduplicates pinned and recent links while retaining richer metadata', () => {
  const html = board('[tid=123][b]魂土阵容攻略[/b][/tid]', row(123, '魂土阵容攻略'));
  const result = parseNgaGuidePage(html, soul);
  assert.equal(result.length, 1);
  assert.equal(result[0].publishedAt, 1791000000);
});

test('follows only the supplied guest session flow once, uses isolated cookies and never calls search engines', async () => {
  const calls = [];
  const h = harness(async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? visitor() : fixtures(); }, 'ngaLineupService');
  const results = await h.service.searchNgaLineups(soul);
  assert.equal(results.length, 1);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.url.startsWith('https://bbs.nga.cn/thread.php?fid=538') && call.options.credentials === 'include'));
  assert.ok(h.partitions.every(name => name === 'onmyoji-nga-public'));
  assert.deepEqual(h.cookies.map(cookie => ({ name: cookie.name, value: cookie.value, url: cookie.url })), [{ name: 'guestJs', value: '123_public-test', url: 'https://bbs.nga.cn/' }]);
  assert.ok(new URL(calls[1].url).searchParams.has('rand'));
});

test('guest rejection is bounded and a later query can recover without caching failure', async () => {
  let calls = 0, allow = false;
  const h = harness(async () => { calls++; return allow ? fixtures() : visitor(); }, 'ngaLineupService');
  await assert.rejects(h.service.searchNgaLineups(soul), /需要网页访问确认或登录/);
  assert.equal(calls, 2);
  allow = true;
  assert.equal((await h.service.searchNgaLineups(soul)).length, 1);
  assert.equal(calls, 5);
});

test('page failures preserve accessible guide entries without falling back to unrelated search results', async () => {
  const h = harness(async url => new URL(url).searchParams.get('page') === '1' ? fixtures() : new Response('', { status: 503 }), 'ngaLineupService');
  const result = await h.service.searchNgaLineups(soul);
  assert.equal(result.length, 1);
});

test('shares board requests across categories, honors forced refresh and limits short-lived cache reuse', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; await new Promise(resolve => setImmediate(resolve)); return fixtures(); }, 'ngaLineupService');
  const [soulResults, duelResults] = await Promise.all([h.service.searchNgaLineups(soul), h.service.searchNgaLineups({ keyword: '阴阳师 斗技', order: 'pubdate' })]);
  assert.equal(calls, 3);
  assert.equal(soulResults.length, 1); assert.equal(duelResults.length, 1);
  await h.service.searchNgaLineups(soul); assert.equal(calls, 3);
  await h.service.searchNgaLineups({ ...soul, forceRefresh: true }); assert.equal(calls, 6);
  h.advance(60_001);
  await h.service.searchNgaLineups(soul); assert.equal(calls, 9);
});

test('decodes GBK forum pages before matching Chinese categories', async () => {
  const buffer = Buffer.concat([
    Buffer.from('<title>'), Buffer.from('d2f5d1f4caa6', 'hex'), Buffer.from(" NGA</title><span class='postrow'><span id='toppedtopic'>[url=/read.php?tid=123]"),
    Buffer.from('d3f9bbeab8b1b1be', 'hex'), Buffer.from("[/url]</span></span><table id='topicrows'></table>"),
  ]);
  const h = harness(async () => new Response(buffer, { headers: { 'content-type': 'text/html; charset=GBK' } }), 'ngaLineupService');
  const result = await h.service.searchNgaLineups(soul);
  assert.equal(result[0].title, '御魂副本');
});

test('sorts recent guides by publication or replies, never treating replies as views', async () => {
  const h = harness(async () => new Response(board('', row(1, '魂土攻略', 1791000000, 100) + row(2, '魂土阵容', 1791010000, 1))), 'ngaLineupService');
  assert.equal((await h.service.searchNgaLineups(soul))[0].replies, 1);
  const popular = await h.service.searchNgaLineups({ ...soul, order: 'click' });
  assert.equal(popular[0].replies, 100);
  assert.equal(popular[0].views, 0);
});
