// Run via npm test (builds the desktop output first).
// 工作区状态：文档存储与按文档自动保存队列都直接用编译产物验证。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDocumentStore } = require('../dist-electron/shared/workspace/documents.js');
const { createAutoSaveQueue } = require('../dist-electron/shared/workspace/autosave.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function manualTimers() {
  const handlers = new Map();
  let nextId = 0;
  return {
    setTimer: (handler) => { handlers.set(++nextId, handler); return nextId; },
    clearTimer: (id) => { handlers.delete(id); },
    fire: () => {
      const first = handlers.entries().next();
      if (first.done) return false;
      handlers.delete(first.value[0]);
      first.value[1]();
      return true;
    },
    count: () => handlers.size,
  };
}

test('文档存储保证 uri 唯一并维护活动文档', () => {
  const store = createDocumentStore();
  const first = store.ensure('workflows/a.json');
  const again = store.ensure('workflows/a.json');
  assert.equal(first, again);
  assert.equal(store.tabs().length, 1);

  store.ensure('workflows/b.json');
  store.setActive('workflows/b.json');
  assert.equal(store.activeUri(), 'workflows/b.json');
  assert.equal(store.activeTab().uri, 'workflows/b.json');

  store.setText('workflows/b.json', 'body');
  store.setDirty('workflows/b.json', true);
  assert.equal(store.activeText(), 'body');
  assert.equal(store.isDirty(), true);

  // 删除活动文档后不再有活动项，由调用方决定下一个。
  assert.equal(store.remove('workflows/b.json'), true);
  assert.equal(store.activeUri(), '');
  assert.equal(store.tabs().length, 1);
  assert.equal(store.remove('workflows/missing.json'), false);
});

test('文档重命名同步记录与活动项', () => {
  const store = createDocumentStore();
  store.ensure('workflows/old.json');
  store.setActive('workflows/old.json');
  store.rename('workflows/old.json', 'workflows/new.json');
  assert.equal(store.tab('workflows/old.json'), undefined);
  assert.equal(store.activeUri(), 'workflows/new.json');
  assert.equal(store.tab('workflows/new.json').uri, 'workflows/new.json');
});

test('返回栈随活动文档切换，会话恢复整体替换列表', () => {
  const store = createDocumentStore();
  store.ensure('workflows/a.json');
  store.setActive('workflows/a.json');
  store.pushActiveBackStack('workflows/root.json');
  assert.deepEqual(store.activeBackStack(), ['workflows/root.json']);
  assert.equal(store.popActiveBackStack(), 'workflows/root.json');
  assert.equal(store.popActiveBackStack(), undefined);

  store.replaceAll([
    { uri: 'workflows/b.json', text: 'unsaved', dirty: true, backStack: ['workflows/a.json'] },
  ], 'workflows/b.json');
  assert.equal(store.tabs().length, 1);
  assert.equal(store.activeText(), 'unsaved');
  assert.equal(store.isDirty(), true);
});

test('同一文档的旧版本保存成功不清除新修改的脏标记', async () => {
  const timers = manualTimers();
  const saves = [];
  const saved = [];
  const queue = createAutoSaveQueue({
    save: (uri, text) => { const entry = deferred(); saves.push({ uri, text, ...entry }); return entry.promise; },
    onSaved: (uri, text) => saved.push({ uri, text }),
    onFailed: () => { throw new Error('不应失败'); },
    delayMs: 10,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  queue.schedule('workflows/a.json', 'v1');
  assert.equal(timers.count(), 1);
  timers.fire();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].text, 'v1');

  // 首个写盘还在途时产生新修改：版本递增，旧结果必须被忽略。
  queue.schedule('workflows/a.json', 'v2');
  saves[0].resolve();
  await queue.flush('workflows/a.json');
  await Promise.resolve();
  assert.deepEqual(saved, []);

  timers.fire();
  assert.equal(saves.length, 2);
  assert.equal(saves[1].text, 'v2');
  saves[1].resolve();
  await queue.flush('workflows/a.json');
  assert.deepEqual(saved, [{ uri: 'workflows/a.json', text: 'v2' }]);
});

test('取消防抖后不再写盘，在途保存结果也不再回调', async () => {
  const timers = manualTimers();
  const saves = [];
  const settled = [];
  const queue = createAutoSaveQueue({
    save: (uri, text) => { const entry = deferred(); saves.push({ uri, text, ...entry }); return entry.promise; },
    onSaved: (uri) => settled.push(['saved', uri]),
    onFailed: (uri) => settled.push(['failed', uri]),
    delayMs: 10,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  queue.schedule('workflows/a.json', 'v1');
  queue.cancel('workflows/a.json');
  assert.equal(queue.hasPending('workflows/a.json'), false);
  assert.equal(timers.count(), 0);

  timers.fire();
  assert.equal(saves.length, 0);
  await queue.wait();
  assert.deepEqual(settled, []);
});

test('写盘失败按版本回调，等待覆盖所有文档的在途保存', async () => {
  const timers = manualTimers();
  const saves = [];
  const failed = [];
  const restored = [];
  const queue = createAutoSaveQueue({
    save: (uri, text) => { const entry = deferred(); saves.push({ uri, text, ...entry }); return entry.promise; },
    onSaved: (uri) => restored.push(uri),
    onFailed: (uri, error) => failed.push([uri, String(error)]),
    delayMs: 10,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  queue.schedule('workflows/a.json', 'body-a');
  queue.schedule('workflows/b.json', 'body-b');
  timers.fire();
  timers.fire();
  assert.deepEqual(saves.map((entry) => entry.uri).sort(), ['workflows/a.json', 'workflows/b.json']);

  const aSave = saves.find((entry) => entry.uri === 'workflows/a.json');
  const bSave = saves.find((entry) => entry.uri === 'workflows/b.json');
  aSave.reject(new Error('disk full'));
  bSave.resolve();
  await queue.wait();

  assert.deepEqual(failed, [['workflows/a.json', 'Error: disk full']]);
  assert.deepEqual(restored, ['workflows/b.json']);
  assert.equal(queue.hasPending('workflows/a.json'), false);
});
