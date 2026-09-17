// Run via npm test (builds the renderer test output first).
// 画布命令：连接规则、增删、选择子树与复制粘贴全部验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
const { createCanvasCommands } = require('../dist-test-renderer/canvas/state/commands.js');

function harness(raw) {
  const state = createCanvasState();
  state.raw = raw;
  state.catalog = [{name: 'core.capture'}];
  state.instances = [{id: 'mumu-0'}];
  const model = createWorkflowModel(state);
  const toasts = [];
  const history = createEditorHistory({
    state,
    cleanupReleased: () => [],
    clearVariableCardSelection: () => {},
    nodeById: model.nodeById,
    normalizeRaw: (value) => value,
    setDirty: () => {},
    render: () => {},
  });
  const commands = createCanvasCommands({
    state,
    nodes: model.nodes,
    nodeById: model.nodeById,
    layout: model.layout,
    mutate: history.mutate,
    clone: (value) => JSON.parse(JSON.stringify(value)),
    toast: (message, error) => toasts.push([message, Boolean(error)]),
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    wrap: {clientWidth: 400, clientHeight: 300},
    nodeWidth: 260,
    baseHeight: 96,
  });
  return {state, model, history, commands, toasts};
}

function tree() {
  return {
    root: 'root',
    nodes: [
      {id: 'root', type: 'root', children: ['seq']},
      {id: 'seq', type: 'sequence', children: ['a', 'b']},
      {id: 'a', type: 'task', action: 'core.capture', params: {}},
      {id: 'b', type: 'task', action: 'core.capture', params: {}},
    ],
  };
}

test('连接规则覆盖 task/root/环与 simple_parallel 首子节点', () => {
  const h = harness(tree());
  assert.equal(h.commands.canConnect('a', 'seq'), 'Task 没有子节点输出');
  assert.equal(h.commands.canConnect('seq', 'root'), 'Root 不允许父节点');
  const h2 = harness({root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['seq']},
    {id: 'seq', type: 'sequence', children: ['a', 'seq2']},
    {id: 'a', type: 'task', action: 'core.capture', params: {}},
    {id: 'seq2', type: 'sequence', children: ['c']},
    {id: 'c', type: 'task', action: 'core.capture', params: {}},
  ]});
  assert.equal(h2.commands.canConnect('seq2', 'seq'), '连接会形成环');
  const h3 = harness({root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['sp']},
    {id: 'sp', type: 'simple_parallel', children: []},
    {id: 'seq', type: 'sequence', children: ['a']},
    {id: 'a', type: 'task', action: 'core.capture', params: {}},
  ]});
  assert.equal(h3.commands.canConnect('sp', 'seq'), '第一个子节点必须是主 Task');
  assert.equal(h3.commands.canConnect('sp', 'a'), null);
});

test('connect 迁移父节点、替换根子节点并同步 switch cases', () => {
  const h = harness({root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['seq']},
    {id: 'seq', type: 'sequence', children: ['a']},
    {id: 'seq2', type: 'sequence', children: []},
    {id: 'a', type: 'task', action: 'core.capture', params: {}},
  ]});
  h.commands.connect('seq2', 'a');
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'seq2').children, ['a']);
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'seq').children, []);

  const h2 = harness({root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task', action: 'core.capture', params: {}},
    {id: 'sw', type: 'switch', children: [], cases: [{value: 0, child: 'b'}], expression: 0},
    {id: 'b', type: 'task', action: 'core.capture', params: {}},
  ]});
  h2.commands.connect('root', 'sw');
  assert.deepEqual(h2.state.raw.nodes.find((node) => node.id === 'root').children, ['sw']);
  h2.commands.disconnect('root', 'sw');
  assert.deepEqual(h2.state.raw.nodes.find((node) => node.id === 'root').children, []);
  h2.commands.connect('sw', 'a');
  assert.deepEqual(h2.state.raw.nodes.find((node) => node.id === 'sw').cases.map((item) => item.child), ['b', 'a']);
  h2.commands.disconnect('sw', 'a');
  assert.deepEqual(h2.state.raw.nodes.find((node) => node.id === 'sw').cases.map((item) => item.child), ['b']);
});

test('addNode 生成节点、坐标并选中，buildNode 按类型给默认值', () => {
  const h = harness(tree());
  const task = h.commands.buildNode('task');
  assert.equal(task.action, 'core.capture');
  assert.equal(Object.hasOwn(task, 'children'), false);
  const instances = h.commands.buildNode('instance_parallel');
  assert.deepEqual(instances.runs, [{instance: 'mumu-0', workflow: '', inputs: {}}]);

  h.commands.addNode('sequence', {x: 100, y: 100});
  const added = h.state.raw.nodes.find((node) => node.id === 'sequence_1');
  assert.deepEqual(h.state.raw._layout.sequence_1, {x: -30, y: 52});
  assert.deepEqual([...h.state.selected], ['sequence_1']);
});

test('deleteSelection 删除选中节点并清理布局，选中连线时只断开', () => {
  const h = harness(tree());
  h.state.selected = new Set(['seq']);
  h.commands.deleteSelection();
  // 与原实现一致：删除所选节点本身，子树保留为孤儿节点（复制/剪切才含子树）。
  assert.deepEqual(h.state.raw.nodes.map((node) => node.id), ['root', 'a', 'b']);
  assert.deepEqual(h.state.raw.nodes[0].children, []);
  assert.deepEqual(h.state.raw._layout, {});

  const h2 = harness(tree());
  h2.state.selectedEdge = {parent: 'seq', child: 'a'};
  h2.commands.deleteSelection();
  assert.deepEqual(h2.state.raw.nodes.find((node) => node.id === 'seq').children, ['b']);
  assert.equal(h2.state.selectedEdge, null);
});

test('复制粘贴重映射 ID、children 与节点输出引用', () => {
  const h = harness(tree());
  h.state.raw.nodes[3].params = {value: {ref: 'nodes.a.output.value'}};
  h.state.selected = new Set(['seq']);
  assert.equal(h.commands.copySelection(), true);
  h.commands.pasteClipboard({x: 40, y: 40});
  const copy = h.state.raw.nodes.find((node) => node.id === 'seq_1');
  assert.ok(copy);
  assert.deepEqual(copy.children, ['a_1', 'b_1']);
  assert.deepEqual([...h.state.selected].sort(), ['a_1', 'b_1', 'seq_1']);
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'b_1').params, {value: {ref: 'nodes.a_1.output.value'}});
});

test('剪切移除选中子树，空剪贴板粘贴给出提示', () => {
  const h = harness(tree());
  h.state.selected = new Set(['a']);
  assert.equal(h.commands.cutSelection(), true);
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'seq').children, ['b']);
  assert.deepEqual(h.toasts.at(-1), ['已剪切 1 个节点', false]);
  h.state.clipboard = null;
  assert.equal(h.commands.pasteClipboard(), false);
  assert.deepEqual(h.toasts.at(-1), ['剪贴板为空', true]);
});
