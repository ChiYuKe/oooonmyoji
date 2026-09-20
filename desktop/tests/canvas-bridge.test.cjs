// Run via npm test (builds the renderer test output first).
// 画布桥接：模式检测、消息信封与桌面控制命令都直接验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasBridge } = require('../dist-test-renderer/canvas/bridge.js');

function harness(mode) {
  const posted = [];
  const clicks = [];
  const listeners = {};
  const bodyClasses = new Set();
  const doc = {
    body: { classList: { add: (name) => bodyClasses.add(name) } },
    getElementById: (id) => ({ click: () => clicks.push(id) }),
  };
  const win = {
    location: { search: mode === 'details' ? '?mode=details' : '' },
    parent: { postMessage: (message) => posted.push(message) },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    dispatchEvent: () => {},
  };
  const bridge = createCanvasBridge({ win, doc });
  bridge.setTopbarControls({
    setWorkflow: (value) => posted.push({ topbar: ['workflow', value] }),
    setInstance: (value) => posted.push({ topbar: ['instance', value] }),
    setRuntimeEdgePreview: (value) => posted.push({ topbar: ['runtime-edge-preview', value] }),
  });
  return {
    bridge,
    posted,
    clicks,
    bodyClasses,
    shell: (payload) => listeners.message({ data: { source: 'desktop-shell', payload } }),
    random: (data) => listeners.message({ data }),
    legacy: bridge.editorApi(),
  };
}

test('模式由查询参数决定并标记到 body', () => {
  assert.equal(harness('canvas').bridge.mode, 'canvas');
  assert(harness('canvas').bodyClasses.has('desktop-canvas-mode'), true);
  assert.equal(harness('details').bridge.mode, 'details');
  assert(harness('details').bodyClasses.has('desktop-details-mode'), true);
});

test('消息发送保持 legacy-editor 信封与状态信封', () => {
  const h = harness('canvas');
  h.bridge.post({ type: 'ready' });
  assert.deepEqual(h.posted, [{ source: 'legacy-editor', message: { type: 'ready' } }]);
  h.bridge.postState({ dirty: true });
  assert.deepEqual(h.posted[1], { source: 'legacy-editor-state', state: { dirty: true } });
  h.legacy.postMessage({ type: 'save' });
  assert.deepEqual(h.posted[2], { source: 'legacy-editor', message: { type: 'save' } });
});

test('desktopPing 立即回应 ready，不派发给编辑器监听器', () => {
  const h = harness('canvas');
  const seen = [];
  h.bridge.subscribe((payload) => seen.push(payload));
  h.shell({ type: 'desktopPing' });
  assert.deepEqual(h.posted, [{ source: 'legacy-editor', message: { type: 'ready' } }]);
  assert.deepEqual(seen, []);
});

test('desktopControl 复用工具条按钮与顶栏选择器', () => {
  const h = harness('canvas');
  h.shell({ type: 'desktopControl', command: 'run' });
  h.shell({ type: 'desktopControl', command: 'save' });
  assert.deepEqual(h.clicks, ['btn-run', 'btn-save']);
  h.shell({ type: 'desktopControl', command: 'switchWorkflow', value: 'workflows/a.json' });
  h.shell({ type: 'desktopControl', command: 'selectInstance', value: 'mumu-0' });
  h.shell({ type: 'desktopControl', command: 'setRuntimeEdgePreview', value: false });
  assert.deepEqual(h.posted, [
    { topbar: ['workflow', 'workflows/a.json'] },
    { topbar: ['instance', 'mumu-0'] },
    { topbar: ['runtime-edge-preview', false] },
  ]);
});

test('普通壳层消息派发给订阅者，状态读写沿用旧语义', () => {
  const h = harness('canvas');
  const seen = [];
  h.bridge.subscribe((payload) => seen.push(payload));
  h.shell({ type: 'init', document: { uri: 'workflows/a.json' } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'init');

  assert.deepEqual(h.legacy.getState(), {});
  const stored = h.legacy.setState({ dirty: true });
  assert.deepEqual(stored, { dirty: true });
  assert.deepEqual(h.legacy.getState(), { dirty: true });
  assert.deepEqual(h.legacy.setState(undefined), {});
});

test('非桌面壳层来源的消息被忽略', () => {
  const h = harness('canvas');
  const seen = [];
  h.bridge.subscribe((payload) => seen.push(payload));
  h.random({ source: 'other', payload: { type: 'init' } });
  h.random(null);
  assert.deepEqual(seen, []);
  assert.deepEqual(h.posted, []);
});
