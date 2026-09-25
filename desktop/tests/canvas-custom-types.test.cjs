// Run via npm test (builds the renderer test output first).
// 「收成自定义类型」：把节点配置变成 x- 类型定义，并按类型新建节点。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createCanvasCommands } = require('../dist-test-renderer/canvas/state/commands.js');
const { collapseNodeIntoCustomType, customTypeNameFor } = require('../dist-test-renderer/canvas/model/custom-types.js');
const { toGraphDocument, toCanvasDocument } = require('../dist-electron/shared/workflow/index.js');

// 画布文档的 schema_version 是 4（v5 文件读进来时由 `toCanvasDocument` 转成编辑形态）；
// 这里必须按真实形态构造，否则 `toGraphDocument` 会把它当成「已经是一份图文档」直接返回。
function document(nodes, extra = {}) {
  return { schema_version: 4, id: 'custom', version: '5.0.0', resolution: [1920, 1080], root: 'root', inputs: {}, variables: {}, nodes, edges: [], ...extra };
}

test('收成自定义类型：字面量进预设，引用不进（节点自己一个字段都不动）', () => {
  const raw = document([
    {id: 'root', type: 'root', at: {x: 0, y: 0}},
    {
      id: 'tap_1',
      type: 'task',
      name: '点掉结算页',
      action: 'input.tap_match',
      params: {verify_gone: true, threshold: 0.9, roi: {ref: 'inputs.识别区域'}, match: {ref: 'nodes.classify.output.match'}},
      at: {x: 0, y: 100},
    },
  ]);
  const before = JSON.stringify(raw.nodes[1]);
  const result = collapseNodeIntoCustomType(raw, 'tap_1');

  assert.equal(result.name, 'x-点掉结算页');
  assert.deepEqual(raw.nodeTypes[result.name], {
    base: 'task',
    title: '点掉结算页',
    action: 'input.tap_match',
    params: {verify_gone: true, threshold: 0.9},
  }, '引用型参数（roi / match）不进预设');
  assert.equal(JSON.stringify(raw.nodes[1]) !== before, true, '节点多了 _nodeType');
  const node = raw.nodes[1];
  assert.equal(node._nodeType, 'x-点掉结算页');
  assert.deepEqual(node.params.roi, {ref: 'inputs.识别区域'}, '节点自己的引用原样保留');
  assert.equal(node.type, 'task', '画布内部仍按基类工作');
});

test('收成自定义类型：类型名去重、重复收会被拒', () => {
  const raw = document([
    {id: 'root', type: 'root', at: {x: 0, y: 0}},
    {id: 'a', type: 'task', name: '记一笔', action: 'core.log', params: {message: 'x'}, at: {x: 0, y: 100}},
    {id: 'b', type: 'task', name: '记一笔', action: 'core.log', params: {message: 'y'}, at: {x: 0, y: 200}},
  ]);
  const first = collapseNodeIntoCustomType(raw, 'a');
  const second = collapseNodeIntoCustomType(raw, 'b');
  assert.equal(first.name, 'x-记一笔');
  assert.equal(second.name, 'x-记一笔_2', '撞名自动加序号');
  assert.equal(collapseNodeIntoCustomType(raw, 'a').error, '这个节点已经是自定义类型了');
  assert.equal(collapseNodeIntoCustomType(raw, 'ghost').error, '找不到这个节点');
});

test('收成自定义类型：没有名字时用动作名，值卡片的表达式也进预设', () => {
  const raw = document([
    {id: 'root', type: 'root', at: {x: 0, y: 0}},
    {id: 'j1', type: 'bool_judge', expression: {eq: [{ref: 'nodes.classify.output.state'}, 'settlement']}, at: {x: 0, y: 100}},
    {id: 'task_1', type: 'task', action: 'core.log', params: {message: 'hi'}, at: {x: 0, y: 200}},
  ]);
  assert.equal(customTypeNameFor(raw, raw.nodes[2]), 'x-core.log');
  // 表达式里带引用 → 不进预设（否则所有实例都会指向同一个来源节点）。
  const judge = collapseNodeIntoCustomType(raw, 'j1');
  assert.deepEqual(raw.nodeTypes[judge.name], {base: 'bool_judge'});
  const task = collapseNodeIntoCustomType(raw, 'task_1');
  assert.deepEqual(raw.nodeTypes[task.name], {base: 'task', action: 'core.log', params: {message: 'hi'}});
});

test('按自定义类型新建节点：铺上预设、保留类型名，并存进文件', () => {
  const raw = document(
    [{id: 'root', type: 'root', at: {x: 0, y: 0}}, {id: 'tap_1', type: 'task', name: '点掉结算页', action: 'input.tap_match', params: {verify_gone: true}, at: {x: 0, y: 100}}],
    {},
  );
  const name = collapseNodeIntoCustomType(raw, 'tap_1').name;
  delete raw.nodes[1]._nodeType; // 假设原始节点只是被收过类型，这里模拟「重新建一个」

  const state = createCanvasState();
  state.raw = raw;
  state.catalog = [{name: 'core.capture'}, {name: 'core.log'}];
  state.instances = [];
  const commands = createCanvasCommands({
    state,
    nodes: () => state.raw.nodes,
    nodeById: (id) => state.raw.nodes.find((node) => node.id === id) || null,
    layout: () => (state.raw._layout = state.raw._layout || {}),
    mutate: (fn) => fn(),
    worldPoint: () => ({x: 0, y: 0}),
    nextId: (prefix) => `${prefix}_new`,
    wrap: {clientWidth: 400, clientHeight: 300},
    nodeWidth: 240,
    baseHeight: 96,
    buildNodeOptions: {},
  });
  commands.addNode(name, {x: 100, y: 200});
  const created = state.raw.nodes[state.raw.nodes.length - 1];
  assert.equal(created.type, 'task', '画布内部按基类');
  assert.equal(created._nodeType, name);
  assert.equal(created.action, 'input.tap_match', '预设的动作铺上了');
  assert.equal(created.params.verify_gone, true);
  assert.equal(created.name, '点掉结算页', '标题来自定义的 title');

  // 存进文件：类型还原成 x-…，定义跟着走。
  const saved = toGraphDocument(state.raw);
  const savedNode = saved.nodes.find((node) => node.id === created.id);
  assert.equal(savedNode.type, name);
  assert.equal(savedNode._nodeType, undefined);
  assert.equal(saved.nodeTypes[name].base, 'task');
  // 再读回来：画布看到的还是基类 + 预设。
  const reloaded = toCanvasDocument(saved);
  const back = reloaded.nodes.find((node) => node.id === created.id);
  assert.equal(back.type, 'task');
  assert.equal(back._nodeType, name);
  assert.equal(back.action, 'input.tap_match');
});
