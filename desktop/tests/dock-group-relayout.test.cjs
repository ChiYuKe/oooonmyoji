// Run via npm test (builds the desktop output first).
// 标签栏高度兜底重排：拖拽让位/弹出收回等结构性变更之后，必须重新测量每个分组的
// 标签栏高度（dockview 的 `_cachedHeaderSize` 在分组被隐藏或跨文档搬家后会停在 0），
// 否则面板内容会顶到分组顶部盖住标签栏——现象就是「标签页标签不见了」。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { installGroupRelayout } = require('../dist-test-renderer/renderer/shell/docking/relayout.js');

/** 最小 window/document 桩：假计时器 + 事件表，够这个模块用。 */
function stubDom() {
  const timers = new Map();
  let nextTimerId = 1;
  const listeners = new Map();
  const on = (target, type, handler) => {
    const key = `${target}:${type}`;
    const set = listeners.get(key) ?? new Set();
    set.add(handler);
    listeners.set(key, set);
  };
  const off = (target, type, handler) => {
    listeners.get(`${target}:${type}`)?.delete(handler);
  };
  globalThis.window = {
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    addEventListener: (type, handler) => on('window', type, handler),
    removeEventListener: (type, handler) => off('window', type, handler),
    requestAnimationFrame: (fn) => { fn(0); return 1; },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    addEventListener: (type, handler) => on('document', type, handler),
    removeEventListener: (type, handler) => off('document', type, handler),
  };
  return {
    pending: () => timers.size,
    /** 跑完当前排队的计时器（按登记顺序）。 */
    flush() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.fn();
      }
    },
    fire(target, type, event = {}) {
      for (const handler of [...(listeners.get(`${target}:${type}`) ?? [])]) handler(event);
    },
    listenerCount: (target, type) => listeners.get(`${target}:${type}`)?.size ?? 0,
  };
}

function makeGroup(id, log, { throws = false } = {}) {
  return {
    id,
    header: { hidden: false },
    relayout: () => {
      if (throws) throw new Error(`group ${id} is being disposed`);
      log.push(id);
    },
  };
}

/** dockview api 桩：只实现本模块用到的事件与 groups。 */
function stubApi(groups) {
  const handlers = new Map();
  const register = (name) => (handler) => {
    handlers.set(name, handler);
    return { dispose: () => handlers.delete(name) };
  };
  const api = {
    get groups() {
      return groups;
    },
    onDidAddPopoutGroup: register('addPopoutGroup'),
    onDidRemovePopoutGroup: register('removePopoutGroup'),
    onDidLayoutFromJSON: register('layoutFromJSON'),
    onDidMovePanel: register('movePanel'),
    onDidMutateLayout: register('mutateLayout'),
  };
  return {
    api,
    fire: (name, payload) => handlers.get(name)?.(payload),
    subscribed: (name) => handlers.has(name),
  };
}

test('内层停靠区不把外层内容层误认成覆盖标签，也不修复其他嵌套分组', () => {
  const dom = stubDom(), log = [];
  window.innerWidth = 800; window.innerHeight = 600;
  const root = { style: { paddingRight: '' } }, outer = {}, child = {};
  const header = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 28 }) };
  const ownGroup = { closest: () => root, querySelector: () => header };
  const childGroup = { closest: () => child, querySelector() { throw new Error('不能检查别的停靠区'); } };
  root.querySelectorAll = () => [ownGroup, childGroup];
  class FakeElement {
    closest(selector) { return selector === '.dv-render-overlay' ? { closest: () => outer } : null; }
  }
  const previousElement = globalThis.Element; globalThis.Element = FakeElement;
  document.elementsFromPoint = () => [new FakeElement()];
  const installed = installGroupRelayout(stubApi([makeGroup('own', log)]).api, root);
  try {
    dom.flush();
    assert.deepEqual(log, ['own']);
    assert.equal(root.style.paddingRight, '', '外层祖先层不会触发尺寸抖动');
  } finally { installed.dispose(); globalThis.Element = previousElement; }
});

test('结构性变更后排空计时器才重排，并覆盖所有分组', () => {
  const dom = stubDom();
  const log = [];
  const groups = [makeGroup('left', log), makeGroup('right', log)];
  const stub = stubApi(groups);
  installGroupRelayout(stub.api);

  stub.fire('mutateLayout', { kind: 'drop', origin: 'user' });
  assert.deepEqual(log, [], '变更当拍不立刻重排，等 dockview 收尾');
  assert.equal(dom.pending(), 1);
  dom.flush();
  assert.deepEqual(log, ['left', 'right']);
});

test('同一轮里的多次变更合并成一次重排', () => {
  const dom = stubDom();
  const log = [];
  const stub = stubApi([makeGroup('only', log)]);
  installGroupRelayout(stub.api);

  for (const name of ['addPopoutGroup', 'removePopoutGroup', 'layoutFromJSON', 'movePanel', 'mutateLayout']) {
    stub.fire(name, {});
  }
  assert.equal(dom.pending(), 1, '只留一个待执行的重排');
  dom.flush();
  assert.deepEqual(log, ['only']);
});

test('弹出/收回、移动面板与从 JSON 恢复都会请求重排', () => {
  const dom = stubDom();
  const log = [];
  const stub = stubApi([makeGroup('g', log)]);
  installGroupRelayout(stub.api);

  for (const name of ['addPopoutGroup', 'removePopoutGroup', 'layoutFromJSON', 'movePanel']) {
    log.length = 0;
    stub.fire(name, {});
    dom.flush();
    assert.deepEqual(log, ['g'], `${name} 之后应重排`);
  }
});

test('拖拽收尾与窗口失焦（原生拖放丢到窗口外）也会重排', () => {
  const dom = stubDom();
  const log = [];
  const stub = stubApi([makeGroup('g', log)]);
  installGroupRelayout(stub.api);

  for (const event of [['document', 'dragend'], ['document', 'drop'], ['window', 'blur']]) {
    log.length = 0;
    dom.fire(event[0], event[1]);
    dom.flush();
    assert.deepEqual(log, ['g'], `${event[1]} 之后应重排`);
  }
});

test('relayoutNow 立即重排，且单个分组出错不影响其他分组', () => {
  const dom = stubDom();
  const log = [];
  const stub = stubApi([makeGroup('broken', log, { throws: true }), makeGroup('healthy', log)]);
  const installed = installGroupRelayout(stub.api);

  installed.relayoutNow();
  assert.deepEqual(log, ['healthy']);

  // 已经排队的一次重排会被立即调用取代，不会重复执行。
  stub.fire('mutateLayout', {});
  installed.relayoutNow();
  assert.deepEqual(log, ['healthy', 'healthy']);
  assert.equal(dom.pending(), 0, '立即重排后不应再留待执行的计时器');
});

test('发现被隐藏的标签栏就地修回来并重排（不必重启应用）', () => {
  const dom = stubDom();
  const log = [];
  const hidden = makeGroup('hidden', log);
  hidden.header.hidden = true;
  const stub = stubApi([hidden, makeGroup('healthy', log)]);
  const installed = installGroupRelayout(stub.api);

  installed.relayoutNow();
  assert.equal(hidden.header.hidden, false, '标签栏恢复显示');
  assert.deepEqual(log, ['hidden', 'healthy']);
  dom.flush();
});

test('dispose 取消待执行的重排并解除订阅', () => {
  const dom = stubDom();
  const log = [];
  const groups = [makeGroup('g', log)];
  const stub = stubApi(groups);
  const installed = installGroupRelayout(stub.api);
  assert.equal(stub.subscribed('mutateLayout'), true);

  stub.fire('mutateLayout', {});
  installed.dispose();
  assert.equal(dom.pending(), 0, '待执行的重排已取消');
  assert.equal(stub.subscribed('mutateLayout'), false, 'dockview 事件已解除');
  assert.equal(dom.listenerCount('document', 'dragend'), 0);
  assert.equal(dom.listenerCount('window', 'blur'), 0);

  groups.length = 0;
  groups.push(makeGroup('late', log));
  stub.fire('mutateLayout', {});
  dom.flush();
  installed.relayoutNow();
  assert.deepEqual(log, [], 'dispose 后不再重排');
});
