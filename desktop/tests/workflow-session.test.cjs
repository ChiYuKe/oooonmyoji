// Run via npm test (builds the desktop output first).
// 会话序列化已迁到 shared/workspace/session.ts：直接导入编译产物，不截取源码。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  serializeWorkflowSession,
  parseWorkflowSession,
  reconcileWorkflowSession,
} = require('../dist-electron/shared/workspace/session.js');

const tab = (uri, extra = {}) => ({uri, text: '', dirty: false, backStack: [], ...extra});

test('会话序列化只为脏标签保留正文并保持顺序', () => {
  const raw = serializeWorkflowSession([
    tab('workflows/a.json', {text: 'saved', dirty: false, backStack: ['workflows/root.json']}),
    tab('workflows/b.json', {text: 'unsaved', dirty: true}),
  ], 'workflows/b.json');
  const payload = JSON.parse(raw);
  assert.equal(payload.version, 1);
  assert.equal(payload.activeUri, 'workflows/b.json');
  assert.deepEqual(payload.tabs, [
    {uri: 'workflows/a.json', text: '', dirty: false, backStack: ['workflows/root.json']},
    {uri: 'workflows/b.json', text: 'unsaved', dirty: true, backStack: []},
  ]);
});

test('会话解析容忍损坏数据并规范化脏标记', () => {
  assert.equal(parseWorkflowSession(null), undefined);
  assert.equal(parseWorkflowSession('not json'), undefined);
  assert.equal(parseWorkflowSession('[]'), undefined);
  assert.equal(parseWorkflowSession('{"tabs":[]}'), undefined);

  const session = parseWorkflowSession(JSON.stringify({
    tabs: [
      {uri: 'workflows/a.json', text: 'body', dirty: true, backStack: ['x', 7, 'y']},
      {uri: '', text: 'skip'},
      {uri: 'workflows/b.json', text: '', dirty: true},
    ],
    activeUri: 'workflows/missing.json',
  }));
  assert.equal(session.tabs.length, 2);
  assert.equal(session.tabs[0].uri, 'workflows/a.json');
  assert.equal(session.tabs[0].text, 'body');
  assert.equal(session.tabs[0].dirty, true);
  assert.deepEqual(Array.from(session.tabs[0].backStack), ['x', 'y']);
  // 空正文不允许保留脏标记，避免恢复出空文档。
  assert.equal(session.tabs[1].uri, 'workflows/b.json');
  assert.equal(session.tabs[1].text, '');
  assert.equal(session.tabs[1].dirty, false);
  assert.equal(session.activeUri, 'workflows/a.json');
});

test('会话恢复会丢弃已不存在的画布并回退激活项', () => {
  const session = parseWorkflowSession(JSON.stringify({
    tabs: [{uri: 'workflows/a.json'}, {uri: 'workflows/gone.json'}, {uri: 'workflows/c.json'}],
    activeUri: 'workflows/gone.json',
  }));
  const reconciled = reconcileWorkflowSession(session, ['workflows/a.json', 'workflows/c.json']);
  assert.equal(reconciled.tabs.length, 2);
  assert.equal(reconciled.activeUri, 'workflows/a.json');
  assert.equal(reconcileWorkflowSession(session, ['workflows/other.json']), undefined);
  assert.equal(reconcileWorkflowSession(undefined, ['workflows/a.json']), undefined);
});
