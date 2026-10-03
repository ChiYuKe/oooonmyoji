const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..');
const flush = () => new Promise(resolve => setImmediate(resolve));

/** 设置面板用到的最小 DOM 桩：只验证"什么时候去读配置"，不验证排版。 */
function element(tag = 'div', dataset = {}) {
  const listeners = {};
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(), dataset, value: '', checked: false, disabled: false, textContent: '',
    className: '', placeholder: '', children: [], focused: false,
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
      toggle: (name, force) => { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); },
    },
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name]; },
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    fire(name, event = {}) { for (const fn of listeners[name] || []) fn({ target: this, type: name, preventDefault() {}, ...event }); },
    focus() { this.focused = true; },
    appendChild(child) { this.children.push(child); return child; }, append(...kids) { this.children.push(...kids); },
    querySelector: () => null, querySelectorAll: () => [],
    closest: selector => (selector === '[data-settings-page]' && dataset.settingsPage ? this : null),
  };
}

function harness({ storage = {}, apiOverrides = {} } = {}) {
  const tabs = ['appearance', 'interface', 'runtime', 'ai', 'shortcuts', 'about'].map(page => {
    const tab = element('button', { settingsPage: page });
    tab.setAttribute('aria-selected', page === 'appearance' ? 'true' : 'false');
    return tab;
  });
  const byPage = new Map(tabs.map(tab => [tab.dataset.settingsPage, tab]));
  const nav = {
    listeners: {},
    querySelector: selector => (selector.includes('aria-selected="true"') ? tabs.find(tab => tab.getAttribute('aria-selected') === 'true') ?? null : null),
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    dispatch(name, event) { for (const fn of this.listeners[name] || []) fn(event); },
  };
  const elements = new Map(['settings-ai-enabled', 'settings-ai-url', 'settings-ai-model', 'settings-ai-key', 'settings-ai-status', 'settings-ai-test', 'settings-ai-clear']
    .map(id => [id, element(id === 'settings-ai-enabled' ? 'input' : 'div')]));
  for (const [selector, node] of [
    ['#settings-tab-ai', byPage.get('ai')], ['#module-settings .settings-nav', nav],
    ['#settings-content-view', element('select')], ['#settings-auto-refresh', element('input')],
    ['#settings-default-workflow', element('input')], ['#settings-restore-session', element('input')],
    ['#settings-debug-enabled', element('input')], ['#settings-debug-annotate', element('input')],
    ['#settings-debug-status', element('p')], ['#settings-runtime-resources', element('div')],
    ['#settings-runtime-progress', element('p')],
  ]) elements.set(selector, node);
  const loads = { ai: 0, debug: 0, resources: 0 };
  const toasts = [];
  let shown = 0;
  const api = {
    getAiSettings: async () => { loads.ai++; return { enabled: true, baseUrl: 'https://example.com/v1', model: 'demo', hasApiKey: true }; },
    saveAiSettings: async value => ({ enabled: value.enabled, baseUrl: value.baseUrl, model: value.model, hasApiKey: true }),
    testAiConnection: async () => undefined,
    getDebugSettings: async () => { loads.debug++; return { enabled: true, annotateScreenshots: false }; },
    updateDebugSettings: async value => value,
    getRuntimeResourceStatus: async () => { loads.resources++; return { ready: true, activeVariant: 'cpu', variants: [] }; },
    installRuntimeResources: async () => undefined,
    activateRuntimeResources: async () => ({ ready: true, activeVariant: 'cpu', variants: [] }),
    removeRuntimeResources: async () => ({ ready: true, activeVariant: 'cpu', variants: [] }),
    onRuntimeResourceProgress: () => () => {},
    ...apiOverrides,
  };
  const node = selector => elements.get(selector) ?? elements.get(`#${selector}`);
  globalThis.document = {
    getElementById: id => elements.get(id) ?? null,
    querySelector: selector => elements.get(selector) ?? null,
    createElement: tag => element(tag),
  };
  globalThis.window = {
    localStorage: { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = value; } },
    addEventListener: () => {}, clearInterval: () => {}, setInterval: () => 0, confirm: () => true,
  };
  const { createSettingsPanel } = require('../dist-test-renderer/renderer/settings-panel.js');
  const panel = createSettingsPanel({
    api, contentBrowser: { getView: () => 'list', setView: () => {} },
    showToast: message => toasts.push(message), showPanel: () => { shown++; }, refreshInstances: () => {},
  });
  return { panel, nav, byPage, node, loads, toasts, storage, shown: () => shown };
}

/** 模拟 public/settings/settings.js 的 select()：只改 aria-selected，不读任何配置。 */
function selectPage(byPage, page) {
  for (const tab of byPage.values()) tab.setAttribute('aria-selected', String(tab.dataset.settingsPage === page));
  return byPage.get(page);
}

test('分类页切到前台时才读对应的配置', async () => {
  const h = harness();
  h.panel.bind();
  // 面板"被显示出来"这件事本身不读配置——布局还原出来的面板就停在这个状态。
  assert.deepEqual(h.loads, { ai: 0, debug: 0, resources: 0 });

  h.nav.dispatch('click', { target: selectPage(h.byPage, 'ai'), type: 'click' });
  await flush();
  assert.equal(h.loads.ai, 1);
  assert.equal(h.node('settings-ai-url').value, 'https://example.com/v1');
  assert.match(h.node('settings-ai-status').textContent, /已自动保存/);
  assert.deepEqual({ debug: h.loads.debug, resources: h.loads.resources }, { debug: 0, resources: 0 });

  // 没有数据的分类页不该顺带发请求；点栏目里的空白处也一样。
  h.nav.dispatch('click', { target: selectPage(h.byPage, 'appearance'), type: 'click' });
  h.nav.dispatch('click', { target: element('div'), type: 'click' });
  await flush();
  assert.deepEqual(h.loads, { ai: 1, debug: 0, resources: 0 });

  h.nav.dispatch('click', { target: selectPage(h.byPage, 'runtime'), type: 'click' });
  await flush();
  assert.deepEqual({ debug: h.loads.debug, resources: h.loads.resources }, { debug: 1, resources: 1 });
  assert.equal(h.node('settings-debug-enabled').checked, true);

  // 方向键换页也算切到前台；其他按键不该触发读配置。
  h.nav.dispatch('keydown', { target: selectPage(h.byPage, 'ai'), type: 'keydown', key: 'ArrowDown' });
  await flush();
  assert.equal(h.loads.ai, 2);
  h.nav.dispatch('keydown', { target: h.byPage.get('ai'), type: 'keydown', key: 'a' });
  await flush();
  assert.equal(h.loads.ai, 2);
});

test('重启后由布局还原的面板补一次同步：启动行为勾选与 Debug 开关都取真实配置', async () => {
  const h = harness({ storage: { 'onmyoji-studio.settings.auto-refresh': 'false' } });
  h.panel.bind();
  h.panel.readSettings();
  h.panel.refreshPanelData();
  await flush();

  assert.equal(h.node('settings-auto-refresh').checked, false);
  assert.equal(h.node('settings-default-workflow').checked, true);
  assert.equal(h.node('settings-restore-session').checked, true);
  assert.equal(h.node('settings-content-view').value, 'list');
  assert.equal(h.node('settings-debug-enabled').checked, true);
  assert.equal(h.node('settings-debug-annotate').checked, false);
  assert.match(h.node('settings-debug-status').textContent, /调试截图 开/);
  assert.equal(h.node('settings-ai-enabled').checked, true);
  assert.equal(h.node('settings-ai-url').value, 'https://example.com/v1');
  assert.equal(h.node('settings-ai-model').value, 'demo');
  assert.equal(h.node('settings-ai-key').value, '');
  assert.equal(h.node('settings-ai-key').placeholder, '已保存密钥；留空保持不变');
  assert.deepEqual(h.loads, { ai: 1, debug: 1, resources: 1 });
  // 同步不改变面板显隐：showPanel 由 openSettingsPanel 负责。
  assert.equal(h.shown(), 0);
  // 打开面板走的仍是同一套同步。
  h.panel.openSettingsPanel();
  await flush();
  assert.deepEqual(h.loads, { ai: 2, debug: 2, resources: 2 });
  assert.equal(h.shown(), 1);
});

test('读配置失败时把原因写在页面上，而不是假装是空配置', async () => {
  const h = harness({ apiOverrides: { getDebugSettings: async () => { throw new Error('boom'); } } });
  await assert.rejects(h.panel.refreshDebugSettings(), /boom/);
  assert.match(h.node('settings-debug-status').textContent, /读取配置失败/);
});

test('启动时对布局还原出的设置面板补一次同步', () => {
  const source = fs.readFileSync(path.join(base, 'src/renderer/main.ts'), 'utf8');
  const readAt = source.indexOf('settings.readSettings();');
  const syncAt = source.indexOf("if (workbenchFrame?.isOpen('settings')) settings.refreshPanelData();");
  assert.ok(readAt >= 0, 'main.ts 应当仍然读回启动行为');
  assert.ok(syncAt > readAt, '补同步必须发生在读回启动行为之后，否则勾选框会写回默认值');
});
