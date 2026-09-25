// Run via npm test (builds the renderer test output first).
// 画布命令：连接规则、增删、选择子树与复制粘贴全部验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
const { createCanvasCommands } = require('../dist-test-renderer/canvas/state/commands.js');

function harness(raw, options = {}) {
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
    publishClipboard: options.publishClipboard,
    onNodesRemoved: options.onNodesRemoved,
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

test('删除与剪切在同一次 mutate 内回调 onNodesRemoved（节点组元数据同步入口）', () => {
  const removed = [];
  const h = harness(tree(), {onNodesRemoved: (ids) => removed.push([...ids])});
  h.state.selected = new Set(['seq']);
  h.commands.deleteSelection();
  assert.deepEqual(removed, [['seq']]);

  removed.length = 0;
  h.state.selected = new Set(['a']);
  h.commands.cutSelection();
  assert.deepEqual(removed, [['a']]);
});

test('判断节点：真/假口各接一个子节点，口位与 children 对齐', () => {
  const h = harness({root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['judge']},
    {id: 'judge', type: 'condition', expression: true},
    {id: 'a', type: 'task', action: 'core.capture', params: {}},
    {id: 'b', type: 'task', action: 'core.capture', params: {}},
    {id: 'c', type: 'task', action: 'core.capture', params: {}},
  ]});
  const judge = () => h.state.raw.nodes.find((node) => node.id === 'judge');

  // 默认接真口；第一次连接会写出显式的 ports，口位不再靠位置猜。
  assert.equal(h.commands.connect('judge', 'a'), true);
  assert.deepEqual(judge().children, ['a']);
  assert.deepEqual(judge().ports, ['true']);

  // 假口独立：先接假口（真口仍空着），再占用真口。
  assert.equal(h.commands.connect('judge', 'b', 'false'), true);
  assert.deepEqual(judge().children, ['a', 'b']);
  assert.deepEqual(judge().ports, ['true', 'false']);

  // 口位排他：真口被占了就换不了（先断开再连）；两个口都满了报「最多两条分支」。
  assert.match(h.commands.canConnect('judge', 'c'), /最多两条分支/);
  assert.equal(h.commands.connect('judge', 'c'), false);
  h.commands.disconnect('judge', 'b');
  assert.deepEqual(judge().children, ['a']);
  assert.match(h.commands.canConnect('judge', 'c'), /真口已经接了/);
  assert.equal(h.commands.connect('judge', 'c'), false);
  assert.deepEqual(h.toasts.at(-1), ['真口已经接了「a」，先断开再连', true]);

  // 断开真口：剩下的那支仍然留在假口，口位不会顺势漂到真口。
  h.commands.connect('judge', 'b', 'false');
  h.commands.disconnect('judge', 'a');
  assert.deepEqual(judge().children, ['b']);
  assert.deepEqual(judge().ports, ['false']);

  // 只接假口时条件成立没有真分支，仍然按失败返回（由父节点决定）。
  assert.equal(h.commands.canConnect('judge', 'a'), null);

  const condition = h.commands.buildNode('condition');
  assert.equal(condition.type, 'condition');
  assert.deepEqual(condition.expression, {eq: [1, 1]});
  assert.equal(Object.hasOwn(condition, 'children'), false);
  assert.equal(Object.hasOwn(condition, 'ports'), false);
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

test('粘贴判断节点时口位跟着 children 一起重映射', () => {
  const h = harness({root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['judge']},
    {id: 'judge', type: 'condition', expression: true, children: ['on_false'], ports: ['false']},
    {id: 'on_false', type: 'task', action: 'core.capture', params: {}},
  ], _layout: {root: {x: 0, y: 0}, judge: {x: 0, y: 112}, on_false: {x: 0, y: 224}}});
  h.state.selected = new Set(['judge']);
  h.commands.copySelection();
  h.commands.pasteClipboard({x: 400, y: 300});
  const copy = h.state.raw.nodes.find((node) => node.id === 'judge_1');
  assert.deepEqual(copy.children, ['on_false_1']);
  assert.deepEqual(copy.ports, ['false'], '只接假口的分支粘贴后仍然挂在假口');
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

/** 带变量绑定的子树：卡片绑 `inputs.运行轮次`，并在画布上有一张变量卡片。 */
function boundTree() {
  return {
    root: 'root',
    inputs: {运行轮次: {type: 'integer', default: 3}},
    nodes: [
      {id: 'root', type: 'root', children: ['a']},
      {id: 'a', type: 'task', action: 'core.capture', params: {value: {ref: 'inputs.运行轮次'}}},
    ],
    _layout: {a: {x: 10, y: 20}},
    _variableCards: {card_1: {name: '运行轮次', scope: 'inputs', x: 100, y: 200}},
  };
}

test('复制把节点、布局与引用到的变量/卡片一起交给壳层（跨画布粘贴的前提）', () => {
  const published = [];
  const h = harness(boundTree(), {publishClipboard: (payload) => published.push(payload)});
  h.state.docUri = 'file:///w/a.json';
  h.state.selected = new Set(['a']);

  assert.equal(h.commands.copySelection(), true);

  assert.equal(published.length, 1, '复制要交给壳层，别的画布才拿得到');
  const payload = published[0];
  assert.equal(payload, h.state.clipboard, '画布状态与壳层拿到的是同一份内容');
  assert.equal(payload.version, 1);
  assert.equal(payload.sourceUri, 'file:///w/a.json');
  assert.deepEqual(payload.nodes.map((node) => node.id), ['a']);
  assert.deepEqual(payload.layout, {a: {x: 10, y: 20}});
  assert.deepEqual(payload.variables, [{scope: 'inputs', name: '运行轮次', definition: {type: 'integer', default: 3}}]);
  assert.deepEqual(payload.cards, [{scope: 'inputs', name: '运行轮次', x: 100, y: 200}]);
});

test('跨画布粘贴：目标文档补上被引用的输入与变量卡片，并按新节点 id 接线', () => {
  const source = harness(boundTree());
  source.state.docUri = 'file:///w/a.json';
  source.state.selected = new Set(['a']);
  source.commands.copySelection();
  // 壳层广播的是结构化克隆（跨窗口/跨 iframe 走 postMessage），测试里同样过一遍 JSON。
  const payload = JSON.parse(JSON.stringify(source.state.clipboard));

  const target = harness({root: 'root', nodes: [{id: 'root', type: 'root', children: []}], _layout: {}});
  target.state.docUri = 'file:///w/b.json';
  target.state.clipboard = payload;

  assert.equal(target.commands.pasteClipboard({x: 400, y: 300}), true);
  const pasted = target.state.raw.nodes.find((node) => node.id === 'a_1');
  assert.ok(pasted, '新文档里生成重命名后的节点');
  assert.deepEqual(pasted.params, {value: {ref: 'inputs.运行轮次'}});
  assert.deepEqual(target.state.raw.inputs['运行轮次'], {type: 'integer', default: 3}, '输入定义被补进目标文档');
  assert.deepEqual(target.state.raw._layout.a_1, {x: 400, y: 300}, '锚点是剪贴板包围盒左上角，所以落在鼠标处');
  const cardIds = Object.keys(target.state.raw._variableCards);
  assert.equal(cardIds.length, 1);
  assert.deepEqual(target.state.raw._variableCards[cardIds[0]], {
    name: '运行轮次', scope: 'inputs', x: 490, y: 480,
  }, '变量卡片跟着整组一起偏移');
  assert.equal(target.state.raw._variableLinks['a_1:value'], cardIds[0], '连线项按新节点 id 补上');
});

test('同文档粘贴不重复补变量与卡片', () => {
  const h = harness(boundTree());
  h.state.docUri = 'file:///w/a.json';
  h.state.selected = new Set(['a']);
  h.commands.copySelection();

  h.commands.pasteClipboard({x: 400, y: 300});

  assert.deepEqual(Object.keys(h.state.raw.inputs), ['运行轮次']);
  assert.equal(Object.keys(h.state.raw._variableCards).length, 1, '源文档本来就有卡片，不再补一张');
  assert.deepEqual(h.state.raw.inputs['运行轮次'], {type: 'integer', default: 3});
});

test('目标文档已有同名变量时以目标为准；已有卡片时也只接线', () => {
  const source = harness(boundTree());
  source.state.docUri = 'file:///w/a.json';
  source.state.selected = new Set(['a']);
  source.commands.copySelection();
  const payload = JSON.parse(JSON.stringify(source.state.clipboard));

  const target = harness({
    root: 'root',
    inputs: {运行轮次: {type: 'string', default: '目标自己的定义'}},
    nodes: [{id: 'root', type: 'root', children: []}],
    _layout: {},
    _variableCards: {card_9: {name: '运行轮次', scope: 'inputs', x: -50, y: -60}},
  });
  target.state.docUri = 'file:///w/b.json';
  target.state.clipboard = payload;

  target.commands.pasteClipboard({x: 0, y: 0});

  assert.deepEqual(target.state.raw.inputs['运行轮次'], {type: 'string', default: '目标自己的定义'}, '不覆盖目标文档的定义');
  assert.deepEqual(Object.keys(target.state.raw._variableCards), ['card_9'], '不新建重复卡片');
  assert.equal(target.state.raw._variableLinks['a_1:value'], 'card_9', '直接把新节点接到已有卡片上');
});
