// Run via npm test (builds the renderer test output first).
// 画布命令：删除变量卡片后，参数必须回到默认值而不是继续引用已删掉的变量。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createCanvasConnections } = require('../dist-test-renderer/canvas/interactions/connections.js');
const { createEditorCommands } = require('../dist-test-renderer/canvas/state/editor-commands.js');

function harness(raw, { withConnection = true } = {}) {
  const state = createCanvasState();
  state.raw = raw;
  const model = createWorkflowModel(state);
  const calls = {toasts: [], rendered: 0, cardSequence: 0};
  const commands = createEditorCommands({
    state,
    mutate: (fn) => fn(),
    nodeById: model.nodeById,
    nodes: model.nodes,
    layout: model.layout,
    position: () => ({x: 0, y: 0}),
    clone: (value) => JSON.parse(JSON.stringify(value)),
    toast: (message, error) => calls.toasts.push([message, Boolean(error)]),
    variableCards: () => model.variableCards(),
    variableLinks: () => model.variableLinks(),
    // 真实实现的 id 生成在节点模块里；这里只要唯一即可。
    nextVariableCardId: () => `card_${++calls.cardSequence}`,
    parameterLiteralCache: () => state.paramLiteralCache || (state.paramLiteralCache = {}),
    parameterLiteralCacheKey: (node, name) => `${node.id}:${name}`,
    setVariableCardSelection: () => {},
    variableInputTargetAt: () => null,
    instanceRunCards: () => [],
    displayNameOfDefinition: (definition, name) => name || '',
    wrap: {clientWidth: 0, clientHeight: 0},
    variableCardWidth: 160,
    variableCardHeight: 96,
    variableCardPortY: 40,
    nodeWidth: 260,
    runCardWidth: 200,
  });
  const connections = withConnection
    ? createCanvasConnections({
        state,
        graph: {setPointerCapture: () => {}, releasePointerCapture: () => {}},
        worldPoint: () => ({x: 0, y: 0}),
        render: () => { calls.rendered += 1; },
        snapshot: (value) => value,
        mutate: (fn) => fn(),
        connect: () => {},
        disconnect: () => {},
        variableConnectionTargetAt: () => null,
        nodeById: model.nodeById,
        instanceRunCards: () => [],
        variableCompatibleWithPin: () => true,
        variableCompatibleWithInstanceInput: () => true,
        variableLinks: model.variableLinks,
        displayNameOfDefinition: model.displayNameOfDefinition,
        variableDisplayNameOf: model.variableDisplayNameOf,
        toast: (message, error) => calls.toasts.push([message, Boolean(error)]),
      })
    : null;
  return {state, model, commands, connections, calls};
}

const baseRaw = () => ({
  schema_version: 4,
  id: 'verify',
  nodes: [{id: 'n', type: 'task', params: {seconds: {ref: 'inputs.等待'}}}],
  inputs: {等待: {type: 'number', default: 8}},
  variables: {},
  _variableLinks: {'n:seconds': 'card_1'},
  _variableCards: {'card_1': {name: '等待', scope: 'inputs', x: 0, y: 0}},
  _layout: {n: {x: 0, y: 0}},
});

test('删除变量卡片：参数回到默认值，不再引用已删掉的变量', () => {
  const h = harness(baseRaw());

  h.commands.removeVariableCard('card_1');

  const params = h.state.raw.nodes[0].params;
  assert.equal(Object.prototype.hasOwnProperty.call(params, 'seconds'), false, '参数应被移除，卡片落回定义默认值');
  assert.equal(h.state.raw._variableLinks['n:seconds'], undefined);
  assert.equal(h.state.raw._variableCards.card_1, undefined);
});

test('连线映射丢失但参数还引用着变量：删卡片同样要清掉这个孤儿引用', () => {
  const raw = baseRaw();
  // 真实场景：连线映射与引用是两个记录，`_variableLinks` 里已经没有这一项了。
  delete raw._variableLinks['n:seconds'];
  const h = harness(raw);

  h.commands.removeVariableCard('card_1');

  const params = h.state.raw.nodes[0].params;
  assert.equal(Object.prototype.hasOwnProperty.call(params, 'seconds'), false, '孤儿引用也必须清掉，否则参数继续指向已删除的变量');
});

test('断线：参数回到默认值（不留下 ref）', () => {
  const h = harness(baseRaw());

  h.connections.disconnectVariableFromPin('n', 'seconds');

  assert.equal(
    Object.prototype.hasOwnProperty.call(h.state.raw.nodes[0].params, 'seconds'),
    false,
    '断开参数引用后应回落到动作默认值',
  );
  assert.equal(h.state.raw._variableLinks['n:seconds'], undefined);
});

test('孤儿引用的收敛覆盖嵌套 inputs 与实例子输入', () => {
  const raw = {
    schema_version: 4,
    id: 'verify-nested',
    nodes: [
      {
        id: 'n',
        type: 'task',
        params: {inputs: {数量: {ref: 'inputs.等待'}}},
        runs: [{instance: 'mumu-0', inputs: {超时: {ref: 'variables.等待'}}}],
      },
    ],
    inputs: {等待: {type: 'number', default: 8}},
    variables: {等待: {type: 'number', default: 3}},
    _variableLinks: {},
    _variableCards: {
      card_a: {name: '等待', scope: 'inputs', x: 0, y: 0},
      card_b: {name: '等待', scope: 'variables', x: 40, y: 0},
    },
    _layout: {n: {x: 0, y: 0}},
  };
  const h = harness(raw);

  h.commands.removeVariableCards(['card_a', 'card_b']);

  const node = h.state.raw.nodes[0];
  assert.deepEqual(node.params.inputs, {}, '嵌套 inputs 里的引用也要清掉');
  assert.deepEqual(node.runs[0].inputs, {}, '实例子输入里的引用也要清掉');
});

test('还有另一张同变量卡片存活时：绑定改指存活卡片，参数保持引用', () => {
  const raw = baseRaw();
  raw._variableCards.card_2 = {name: '等待', scope: 'inputs', x: 40, y: 0};
  const h = harness(raw);

  h.commands.removeVariableCard('card_1');

  assert.deepEqual(h.state.raw.nodes[0].params.seconds, {ref: 'inputs.等待'}, '同名变量还有卡片时绑定保留');
  assert.equal(h.state.raw._variableLinks['n:seconds'], 'card_2');
});
