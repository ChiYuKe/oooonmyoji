const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/lineup-service-harness.cjs');
const sources = ['bilibili', 'netease-community', 'netease-official', 'weibo', 'nga'];
const request = { keyword: '阴阳师 御魂阵容', order: 'pubdate', forceRefresh: true };

const emptyBilibili = () => Response.json({ code: 0, data: { result: [] } });
const ngaPage = content => new Response(`<title>阴阳师 NGA玩家社区</title><table id='topicrows'>${content ?? ''}</table>`);
const captcha = () => new Response('<title>百度安全验证</title>');
const unrelated = () => new Response('<li class="b_algo"><h2><a href="https://example.com/">无关页面</a></h2></li>');

test('all failures retain individual restriction and verification reasons', async () => {
  const { service } = harness(async url => url.includes('api.bilibili.com') ? new Response('', { status: 412 }) : url.includes('baidu.com') ? captcha() : unrelated());
  const result = await service.searchLineups(request);
  assert.deepEqual(result.unavailableSources, sources);
  assert.equal(result.results.length, 0);
  assert.match(result.sourceErrors[0].message, /HTTP 412/);
  for (const error of result.sourceErrors.slice(1, 4)) {
    assert.match(error.message, /Bing：未返回可用的目标站点链接/);
    assert.match(error.message, /百度：需要网页安全验证/);
  }
  assert.match(result.sourceErrors[4].message, /NGA.*页面结构无法识别/);
});

test('one failed source does not discard other source results; grouped domains apply the keyword to both', async () => {
  const queries = [];
  const { service } = harness(async raw => {
    const url = new URL(raw);
    if (url.hostname === 'api.bilibili.com') return emptyBilibili();
    if (url.hostname === 'bbs.nga.cn') return ngaPage(`<tr class='topicrow'><td><a href='/read.php?tid=123' class='topic'>阴阳师 &amp; 御魂副本攻略</a></td></tr>`);
    const query = url.searchParams.get('q') ?? url.searchParams.get('wd');
    queries.push(query);
    if (query.includes('site:weibo.com')) return captcha();
    const host = query.includes('site:ds.163.com') ? 'ds.163.com' : query.includes('site:yys.163.com') ? 'yys.163.com' : 'bbs.nga.cn';
    const link = `https://www.bing.com/ck/a?u=a1${Buffer.from(`http://${host}/guide`).toString('base64url')}&amp;ntb=1`;
    return new Response(`<li class="b_algo"><h2><a href="${link}">阴阳师 &amp; 御魂&#x9635;容</a></h2><p>搭配说明</p></li>`);
  });
  const result = await service.searchLineups(request);
  assert.deepEqual(result.unavailableSources, ['weibo']);
  assert.equal(result.results.length, 3);
  assert.ok(result.results.every(item => item.url.startsWith('https://') && /阴阳师 & 御魂(?:阵容|副本攻略)/.test(item.title)));
  assert.ok(queries.includes('(site:yys.163.com OR site:yys.16163.com) 阴阳师 御魂阵容'));
});

test('explicit no-result pages are successful empty searches', async () => {
  const { service } = harness(async url => url.includes('api.bilibili.com') ? emptyBilibili() : url.includes('bbs.nga.cn') ? ngaPage() : new Response('<div class="b_no">没有找到相关结果</div>'));
  const result = await service.searchLineups(request);
  assert.deepEqual(result, { results: [], unavailableSources: [], sourceErrors: [] });
});

test('malformed entities cannot crash the entire source and off-site links are rejected', async () => {
  const { service } = harness(async url => url.includes('api.bilibili.com') ? emptyBilibili() : url.includes('bbs.nga.cn') ? ngaPage() : url.includes('baidu.com') ? captcha() : new Response('<li class="b_algo"><h2><a href="https://ds.163.com.evil.example/a">外站</a></h2></li><li class="b_algo"><h2><a href="https://ds.163.com/a">阴阳师 &#999999999;</a></h2></li>'));
  const result = await service.searchLineups(request);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, 'https://ds.163.com/a');
  assert.equal(result.unavailableSources.length, 2);
});

test('concurrent identical requests share network calls and return separate mutable results', async () => {
  let calls = 0;
  const { service } = harness(async url => {
    calls++;
    await new Promise(resolve => setImmediate(resolve));
    return url.includes('api.bilibili.com') ? emptyBilibili() : url.includes('bbs.nga.cn') ? ngaPage() : new Response('<div class="b_no"></div>');
  });
  const [first, second] = await Promise.all([service.searchLineups(request), service.searchLineups(request)]);
  assert.equal(calls, 10);
  first.unavailableSources.push('nga');
  assert.deepEqual(second.unavailableSources, []);
});

test('Bilibili restrictions pause repeated requests for one minute, then allow retry', async () => {
  let calls = 0;
  const { service, advance } = harness(async () => { calls++; return new Response('', { status: 412 }); });
  await assert.rejects(service.searchBilibiliLineups(request), /HTTP 412/);
  await assert.rejects(service.searchBilibiliLineups({ ...request, keyword: '阴阳师 斗技' }), /一分钟/);
  assert.equal(calls, 1);
  advance(60_001);
  await assert.rejects(service.searchBilibiliLineups(request), /HTTP 412/);
  assert.equal(calls, 2);
});

test('network timeouts are reported for both indexes', async () => {
  const { service } = harness(async () => { throw new Error('The operation was aborted due to timeout'); });
  const result = await service.searchLineups(request);
  assert.ok(result.sourceErrors.every(error => error.message.includes('超时')));
});
