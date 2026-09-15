const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');

/** 与其它渲染层测试一致：切片执行生产函数，不打开桌面窗口。 */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `未找到 ${name}`);
  const end = source.indexOf('\n}\n', start);
  assert(end > start, `未闭合 ${name}`);
  return source.slice(start, end + 3);
}

function harness() {
  const ctx = vm.createContext({WORKFLOW_SESSION_VERSION: 1});
  const code = [extract('serializeWorkflowSession'), extract('parseWorkflowSession'), extract('reconcileWorkflowSession')].join('\n');
  vm.runInContext(stripTypeScriptTypes(code), ctx);
  return ctx;
}

const tab = (uri, extra = {}) => ({uri, text: '', dirty: false, backStack: [], ...extra});

test('会话序列化只为脏标签保留正文并保持顺序', () => {
  const ctx = harness();
  const raw = ctx.serializeWorkflowSession([
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
  const ctx = harness();
  assert.equal(ctx.parseWorkflowSession(null), undefined);
  assert.equal(ctx.parseWorkflowSession('not json'), undefined);
  assert.equal(ctx.parseWorkflowSession('[]'), undefined);
  assert.equal(ctx.parseWorkflowSession('{"tabs":[]}'), undefined);

  const session = ctx.parseWorkflowSession(JSON.stringify({
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
  const ctx = harness();
  const session = ctx.parseWorkflowSession(JSON.stringify({
    tabs: [{uri: 'workflows/a.json'}, {uri: 'workflows/gone.json'}, {uri: 'workflows/c.json'}],
    activeUri: 'workflows/gone.json',
  }));
  const reconciled = ctx.reconcileWorkflowSession(session, ['workflows/a.json', 'workflows/c.json']);
  assert.equal(reconciled.tabs.length, 2);
  assert.equal(reconciled.activeUri, 'workflows/a.json');
  assert.equal(ctx.reconcileWorkflowSession(session, ['workflows/other.json']), undefined);
  assert.equal(ctx.reconcileWorkflowSession(undefined, ['workflows/a.json']), undefined);
});
