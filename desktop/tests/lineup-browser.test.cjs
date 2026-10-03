const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installLineupBrowser } = require('../dist-test-renderer/renderer/lineup-browser.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
const allSources = ['bilibili', 'netease-community', 'netease-official', 'weibo', 'nga'];
const cacheKey = 'onmyoji-studio.lineup-search-cache.v4';
const soulKey = JSON.stringify(['阴阳师 御魂阵容', 'pubdate']);
const guide = { bvid: 'BV1234567890', source: 'bilibili', title: '御魂通关攻略', author: '作者', url: 'https://www.bilibili.com/video/BV1234567890/', description: '', publishedAt: 0, duration: '', views: 0, favorites: 0 };
const failure = { results: [], unavailableSources: allSources, sourceErrors: allSources.map(source => ({ source, message: source === 'bilibili' ? '搜索请求被站点限制（HTTP 412）' : '百度：需要网页安全验证' })) };

function harness({ storage = {}, search = async () => failure } = {}) {
  let doc;
  function element(tag = 'div', dataset = {}) {
    const listeners = {};
    return {
      tagName: tag.toUpperCase(), dataset, value: '', children: [], disabled: false, hidden: false, textContent: '', ownerDocument: doc,
      setAttribute(name, value) { this[name] = value; },
      hasAttribute(name) { return name === 'data-lineup-order' && !!this.dataset.lineupOrder; },
      addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
      removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter(item => item !== fn); },
      fire(name) { for (const fn of listeners[name] || []) fn({ target: this, preventDefault() {} }); },
      append(...children) { this.children.push(...children.flatMap(child => child.fragment ? child.children : [child])); },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      closest() { return this; },
      querySelector() { return null; }, querySelectorAll() { return []; },
    };
  }
  doc = { createElement: tag => element(tag), createTextNode: text => ({ textContent: text }), createDocumentFragment: () => ({ ...element(), fragment: true }) };
  const nodes = Object.fromEntries(['form', 'search', 'results', 'status', 'errors', 'refresh', 'bookmark-count', 'bookmarks', 'categories', 'sources'].map(name => [name, element(name === 'form' ? 'form' : name === 'search' ? 'input' : 'div', { lineup: name })]));
  const submit = element('button');
  const orders = ['pubdate', 'click'].map(lineupOrder => element('button', { lineupOrder }));
  nodes.form.querySelector = () => submit;
  nodes.categories.querySelectorAll = () => nodes.categories.children;
  nodes.sources.querySelectorAll = () => nodes.sources.children;
  const root = element();
  root.querySelector = selector => nodes[selector.match(/data-lineup="([^"]+)"/)?.[1]];
  root.querySelectorAll = selector => selector === '[data-lineup-order]' ? orders : [];
  root.contains = () => true;
  const calls = [], opened = [];
  const api = {
    readLayout: key => storage[key] ?? null, writeLayout: (key, value) => { storage[key] = value; },
    searchLineups: async request => { calls.push(request); return search(request); },
    openLineupSource: async (...args) => { opened.push(args); }, openLineupPost: async () => {}, openLineupUrl: async () => {},
  };
  return { browser: installLineupBrowser(root, api), nodes, calls, opened, storage, orders };
}

test('legacy failed empty cache triggers a new request and never writes another failed empty entry', async () => {
  const h = harness({ storage: { [cacheKey]: JSON.stringify({ [soulKey]: { ...failure, cachedAt: Date.now() } }) } });
  h.browser.load(); await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.parse(h.storage[cacheKey])[soulKey], undefined);
  assert.match(h.nodes.status.textContent, /未缓存空结果/);
  assert.equal(h.nodes.errors.children.length, 5);
  assert.equal(h.nodes.errors.hidden, false);
  assert.match(h.nodes.errors.children[0].children[0].textContent, /HTTP 412/);
  h.nodes.errors.children[2].children[1].fire('click'); await flush();
  assert.equal(h.opened[0][0], 'netease-official');
});

test('failed forced refresh keeps prior cards and cache timestamps', async () => {
  const cachedAt = Date.now() - 5000;
  const h = harness({ storage: { [cacheKey]: JSON.stringify({ [soulKey]: { results: [guide], unavailableSources: [], cachedAt } }) } });
  h.browser.load(); await flush();
  assert.equal(h.calls.length, 0);
  h.nodes.refresh.fire('click'); await flush();
  assert.equal(h.calls[0].forceRefresh, true);
  assert.equal(h.nodes.results.children[0].className, 'lineup-card');
  assert.match(h.nodes.results.children[0].children[0].children[1].textContent, /缓存攻略/);
  assert.match(h.nodes.status.textContent, /保留了哔哩哔哩/);
  assert.equal(JSON.parse(h.storage[cacheKey])[soulKey].cachedAt, cachedAt);
});

test('IPC failure keeps matching old guides and restores the refresh button', async () => {
  const h = harness({ storage: { [cacheKey]: JSON.stringify({ [soulKey]: { results: [guide], unavailableSources: [], cachedAt: Date.now() } }) }, search: async () => { throw new Error('服务连接失败'); } });
  h.browser.load(); h.nodes.refresh.fire('click'); await flush();
  assert.equal(h.nodes.results.children[0].className, 'lineup-card');
  assert.match(h.nodes.status.textContent, /服务连接失败.*已保留/);
  assert.equal(h.nodes.refresh.disabled, false);
});

test('online results are not removed by a second literal substring filter', async () => {
  const h = harness({ search: async () => ({ results: [guide], unavailableSources: [] }) });
  h.nodes.search.value = '魂土 15 秒 低配';
  h.nodes.form.fire('submit'); await flush();
  assert.equal(h.nodes.results.children[0].className, 'lineup-card');
});

test('a late category response cannot overwrite a newer category or its error details', async () => {
  let finishOld;
  const h = harness({ search: request => request.keyword.includes('御魂阵容') ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ results: [guide], unavailableSources: [] }) });
  h.browser.load();
  h.nodes.categories.children[1].fire('click'); await flush();
  finishOld(failure); await flush();
  assert.equal(h.nodes.results.children[0].className, 'lineup-card');
  assert.equal(h.nodes.errors.hidden, true);
  assert.equal(h.nodes.refresh.disabled, false);
});

test('returning from bookmarks retries failed searches instead of staying on the empty state', async () => {
  const h = harness(); h.browser.load(); await flush();
  h.nodes.bookmarks.fire('click');
  assert.equal(h.nodes.errors.hidden, true);
  h.nodes.bookmarks.fire('click'); await flush();
  assert.equal(h.calls.length, 2);
});
