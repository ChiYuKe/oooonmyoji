// Run via npm test (builds the desktop output first).
// 独立弹窗「顶置」：安装后按持久化偏好给已有/新开弹窗回发顶置状态，
// 弹窗回车报到（popoutReady）时再回一次，按钮回报（popoutAlwaysOnTop）按面板 id 写回存储。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { installPopoutAlwaysOnTop } = require('../dist-test-renderer/renderer/docking/popout-topmost.js');

function stubWindow() {
  const stored = new Map();
  const listeners = new Map();
  globalThis.window = {
    onmyoji: {
      readLayout: (key) => stored.get(key) ?? null,
      writeLayout: (key, value) => {
        if (value === null) stored.delete(key);
        else stored.set(key, value);
      },
    },
    localStorage: { getItem: () => null, removeItem: () => {} },
    addEventListener: (type, handler) => {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener: (type, handler) => {
      listeners.get(type)?.delete(handler);
    },
  };
  return { stored, listeners };
}

/** 模拟一个 dockview 弹窗；win 兼作 message 事件的 event.source。 */
function popoutWindow(id) {
  const posted = [];
  return { window: { id, postMessage: (data) => { posted.push(data); } }, posted };
}

function panel(id) {
  return { api: { id } };
}

function groupView(win, panelIds, activeId = panelIds[0]) {
  return {
    window: win.window,
    group: { panels: panelIds.map(panel), activePanel: panel(activeId) },
  };
}

/** 可手动触发 onDidAddPopoutGroup 的 dockview api 桩。 */
function stubApi(initialPopouts = []) {
  const popouts = [...initialPopouts];
  let addedHandler;
  return {
    api: {
      getPopouts: () => popouts,
      onDidAddPopoutGroup: (handler) => {
        addedHandler = handler;
        return { dispose: () => { addedHandler = undefined; } };
      },
      fireAdded(popout) {
        popouts.push(popout);
        addedHandler?.(popout);
      },
    },
  };
}

function install(api, flags = {}) {
  let current = { ...flags };
  const writes = [];
  const storage = {
    read: () => ({ ...current }),
    write: (next) => { current = { ...next }; writes.push(current); },
  };
  const installed = installPopoutAlwaysOnTop(api, storage);
  return { storage, writes, dispose: installed.dispose };
}

/** 模拟主窗口收到的弹窗消息。 */
function deliver(win, data, source) {
  for (const handler of win.listeners.get('message') ?? []) handler({ data, source });
}

test('已有弹窗安装时按持久化偏好回发顶置', () => {
  const win = stubWindow();
  const first = popoutWindow('settings-window');
  const apiStub = stubApi([groupView(first, ['settings', 'overview'], 'settings')]);
  install(apiStub.api, { settings: true });
  assert.deepEqual(first.posted, [{ source: 'dockview-main', type: 'popoutTopmost', flag: true }]);
});

test('组内任一面板带顶置偏好就回发', () => {
  const win = stubWindow();
  const first = popoutWindow('group-window');
  const apiStub = stubApi([groupView(first, ['settings', 'overview'], 'settings')]);
  install(apiStub.api, { overview: true });
  assert.equal(first.posted.length, 1, '偏好挂在不活动的面板上也整窗顶置');
});

test('没有顶置偏好的弹窗不回发', () => {
  const win = stubWindow();
  const first = popoutWindow('plain-window');
  const apiStub = stubApi([groupView(first, ['settings'])]);
  install(apiStub.api, {});
  assert.deepEqual(first.posted, []);
});

test('新弹窗打开时同样回发偏好', () => {
  const win = stubWindow();
  const opened = popoutWindow('opened-window');
  const apiStub = stubApi([]);
  install(apiStub.api, { soulOptimizer: true });
  apiStub.api.fireAdded(groupView(opened, ['soulOptimizer']));
  assert.deepEqual(opened.posted, [{ source: 'dockview-main', type: 'popoutTopmost', flag: true }]);
});

test('弹窗加载完成报到后按当前偏好回发（含取消顶置）', () => {
  const win = stubWindow();
  const first = popoutWindow('settings-window');
  const apiStub = stubApi([groupView(first, ['settings'])]);
  const { writes } = install(apiStub.api, {});
  deliver(win, { source: 'dockview-popout', type: 'popoutReady' }, first.window);
  assert.deepEqual(first.posted, [{ source: 'dockview-main', type: 'popoutTopmost', flag: false }], '报到即回发当前状态');
  deliver(win, { source: 'dockview-popout', type: 'popoutAlwaysOnTop', flag: true }, first.window);
  assert.deepEqual(writes, [{ settings: true }]);
  first.posted.length = 0;
  deliver(win, { source: 'dockview-popout', type: 'popoutReady' }, first.window);
  assert.deepEqual(first.posted, [{ source: 'dockview-main', type: 'popoutTopmost', flag: true }], '报到回发最新偏好');
});

test('按钮回报按活动面板 id 写回，别的面板不受影响', () => {
  const win = stubWindow();
  const first = popoutWindow('group-window');
  const apiStub = stubApi([groupView(first, ['settings', 'overview'], 'overview')]);
  const { writes } = install(apiStub.api, {});
  deliver(win, { source: 'dockview-popout', type: 'popoutAlwaysOnTop', flag: true }, first.window);
  assert.deepEqual(writes, [{ overview: true }]);
  const second = popoutWindow('settings-window');
  apiStub.api.fireAdded(groupView(second, ['settings']));
  assert.deepEqual(second.posted, [], '另一个面板不继承顶置偏好');
  deliver(win, { source: 'dockview-popout', type: 'popoutAlwaysOnTop', flag: false }, first.window);
  assert.deepEqual(writes, [{ overview: true }, { overview: false }]);
  const reopened = popoutWindow('group-window-2');
  apiStub.api.fireAdded(groupView(reopened, ['overview']));
  assert.deepEqual(reopened.posted, [], '取消顶置后重开不再回发');
});

test('非弹窗消息与未知来源的消息忽略', () => {
  const win = stubWindow();
  const first = popoutWindow('settings-window');
  const apiStub = stubApi([groupView(first, ['settings'])]);
  const { writes } = install(apiStub.api, {});
  deliver(win, { source: 'something-else', type: 'popoutAlwaysOnTop', flag: true }, first.window);
  deliver(win, { source: 'dockview-popout', type: 'popoutAlwaysOnTop', flag: true }, { not: 'a popout window' });
  deliver(win, { source: 'dockview-popout', type: 'popoutAlwaysOnTop', flag: true }, null);
  deliver(win, { source: 'dockview-popout', type: 'other', flag: true }, first.window);
  assert.deepEqual(writes, []);
});

test('dispose 移除消息监听与弹窗订阅', () => {
  const win = stubWindow();
  const first = popoutWindow('settings-window');
  const apiStub = stubApi([]);
  const { dispose } = install(apiStub.api, { settings: true });
  dispose();
  assert.equal(win.listeners.get('message')?.size ?? 0, 0, '消息监听已移除');
  const opened = popoutWindow('late-window');
  apiStub.api.fireAdded(groupView(opened, ['settings']));
  assert.deepEqual(opened.posted, [], 'dispose 后新弹窗不再回发');
});
