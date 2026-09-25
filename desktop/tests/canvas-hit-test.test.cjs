// Run via npm test (builds the renderer test output first).
// 连线命中测试：节点端口、变量端点、实例子输入与变量卡片的就近判定。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createCanvasHitTest } = require('../dist-test-renderer/canvas/interactions/hit-test.js');

function harness(options = {}) {
  const state = createCanvasState();
  state.raw = options.raw || {nodes: []};
  const model = createWorkflowModel(state);
  const calls = {compatiblePin: 0, compatibleInstance: 0};
  const hit = createCanvasHitTest({
    state,
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    nodes: model.nodes,
    nodeById: model.nodeById,
    position: model.position,
    nodeHeight: () => options.nodeHeight ?? 96,
    nodeVariablePins: (node) => node.pins || [],
    variableCompatibleWithPin: () => { calls.compatiblePin += 1; return options.compatiblePin !== false; },
    variableCompatibleWithInstanceInput: () => { calls.compatibleInstance += 1; return options.compatibleInstance !== false; },
    instanceRunCards: () => options.runCards || [],
    instanceRunInputPosition: (card, index) => ({x: card.x + 10, y: card.y + 78 + index * 24 + 12}),
    variableCardList: () => options.cards || [],
    portRadius: 7,
    nodeWidth: 260,
    baseHeight: 96,
    runVariableHeight: 24,
    variablePinX: 10,
    runCardWidth: 250,
    runCardBaseHeight: 78,
    variableCardWidth: 168,
    variableCardHeight: 58,
    variableCardPortY: 29,
  });
  return {state, hit, calls};
}

const rect = {nodes: [
  {id: 'root', type: 'root', children: ['a']},
  {id: 'a', type: 'sequence', children: []},
  {id: 'b', type: 'task'},
], _layout: {root: {x: 0, y: 0}, a: {x: 0, y: 200}, b: {x: 400, y: 200}}};

test('connectionTargetAt 按拖拽方向选择输入/输出侧并跳过 root/自身', () => {
  const h = harness({raw: JSON.parse(JSON.stringify(rect))});
  h.state.connect = {direction: 'from-output', parent: 'b'};
  assert.equal(h.hit.connectionTargetAt({clientX: 130, clientY: 200}), 'a');
  // root 不是合法目标，远离任何端点时为 null
  assert.equal(h.hit.connectionTargetAt({clientX: 130, clientY: 0}), null);
  const self = harness({raw: JSON.parse(JSON.stringify(rect))});
  self.state.connect = {direction: 'from-output', parent: 'a'};
  assert.equal(self.hit.connectionTargetAt({clientX: 130, clientY: 200}), null);

  const output = harness({raw: JSON.parse(JSON.stringify(rect))});
  output.state.connect = {direction: 'from-input', child: 'b'};
  assert.equal(output.hit.connectionTargetAt({clientX: 130, clientY: 296}), 'a');
  const task = harness({raw: JSON.parse(JSON.stringify(rect))});
  task.state.connect = {direction: 'from-input', child: 'a'};
  assert.equal(task.hit.connectionTargetAt({clientX: 530, clientY: 296}), null);
  assert.equal(task.hit.connectionTargetAt(null), null);
});

test('判断节点底部两个口分别吸附：左真右假，execPortAt 给出落点口位', () => {
  const raw = {nodes: [
    {id: 'root', type: 'root', children: ['judge']},
    {id: 'judge', type: 'condition', expression: true, children: ['a'], ports: ['true']},
    {id: 'a', type: 'task'},
    {id: 'b', type: 'task'},
  ], _layout: {root: {x: 0, y: 0}, judge: {x: 0, y: 200}, a: {x: -200, y: 400}, b: {x: 400, y: 400}}};
  const h = harness({raw: JSON.parse(JSON.stringify(raw))});
  h.state.connect = {direction: 'from-input', child: 'b'};

  // 卡片底边 y = 200 + 96；真口 x = 78、假口 x = 182。
  assert.equal(h.hit.connectionTargetAt({clientX: 78, clientY: 296}), 'judge');
  assert.equal(h.hit.connectionTargetAt({clientX: 182, clientY: 296}), 'judge');
  assert.equal(h.hit.execPortAt({x: 78, y: 296}, 'judge'), 'true');
  assert.equal(h.hit.execPortAt({x: 182, y: 296}, 'judge'), 'false');
  assert.equal(h.hit.execPortAt({x: 129, y: 296}, 'judge'), 'true', '中点偏左算真口');
  assert.equal(h.hit.execPortAt({x: 130, y: 296}, 'judge'), 'false');
  // 普通节点没有口位；任务节点不能被当成父节点命中。
  assert.equal(h.hit.execPortAt({x: 80, y: 296}, 'a'), null);
  assert.equal(h.hit.connectionTargetAt({clientX: 530, clientY: 496}), null);
});

test('variablePinTargetAt 就近命中引脚，落在卡片本体内回退到首个兼容引脚', () => {
  const node = {id: 'a', type: 'task', pins: [{param: 'template'}, {param: 'threshold'}]};
  const h = harness({raw: {nodes: [node], inputs: {}, _layout: {a: {x: 0, y: 0}}}});
  const pin = h.hit.variablePinTargetAt({x: 10, y: 108}, 'inputs', '模板');
  assert.deepEqual(pin, {nodeId: 'a', param: 'template', x: 10, y: 108});
  const body = h.hit.variablePinTargetAt({x: 100, y: 40}, 'inputs', '模板');
  assert.deepEqual(body, {nodeId: 'a', param: 'template', x: 10, y: 108});
  assert.equal(h.hit.variablePinTargetAt({x: 2000, y: 2000}, 'inputs', '模板'), null);

  const incompatible = harness({raw: {nodes: [node], _layout: {a: {x: 0, y: 0}}}, compatiblePin: false});
  assert.equal(incompatible.hit.variablePinTargetAt({x: 10, y: 108}, 'inputs', '模板'), null);
});

test('判断节点 bool 输入端点固定在左侧说明区并支持类型命中', () => {
  const judge = {
    id: 'judge', type: 'condition', expression: {eq: [1, 1]},
    pins: [{param: 'condition', type: 'boolean'}],
  };
  const h = harness({raw: {nodes: [judge], inputs: {enabled: {type: 'boolean'}}, _layout: {judge: {x: 100, y: 200}}}});
  // 布尔输入口与其他数据口统一：x 左缘内缩 10（variablePinX），y 固定在说明区。
  assert.deepEqual(
    h.hit.variablePinTargetAt({x: 110, y: 264}, 'inputs', 'enabled'),
    {nodeId: 'judge', param: 'condition', x: 110, y: 264},
  );
  assert.equal(h.hit.variablePinTargetAt({x: 1000, y: 1000}, 'inputs', 'enabled'), null);
});

test('bool_judge 左侧两个输入端点分别命中 left / right', () => {
  const boolJudge = {
    id: 'bool_1', type: 'bool_judge', expression: {eq: [1, 'settlement']},
    pins: [
      {param: 'left', type: 'any'},
      {param: 'right', type: 'any'},
    ],
  };
  const h = harness({raw: {
    nodes: [boolJudge],
    inputs: {current: {type: 'string'}},
    _layout: {bool_1: {x: 100, y: 200}},
  }});
  assert.deepEqual(
    h.hit.variablePinTargetAt({x: 110, y: 264}, 'inputs', 'current'),
    {nodeId: 'bool_1', param: 'left', x: 110, y: 264},
  );
  assert.deepEqual(
    h.hit.variablePinTargetAt({x: 110, y: 288}, 'inputs', 'current'),
    {nodeId: 'bool_1', param: 'right', x: 110, y: 288},
  );
});

test('instanceRunInputTargetAt 命中端点或输入行，不兼容返回 null', () => {
  const run = {instance: 'mumu-0', inputs: {}};
  const card = {node: {id: 'p', type: 'task', runs: [run]}, index: 0, x: 100, y: 200, run, variables: [{name: 'input_id'}]};
  const h = harness({runCards: [card]});
  const dot = h.hit.instanceRunInputTargetAt({x: 110, y: 290}, 'variables', 'count');
  assert.deepEqual(dot, {kind: 'instance-input', nodeId: 'p', runIndex: 0, param: 'input_id', x: 110, y: 290});
  const row = h.hit.instanceRunInputTargetAt({x: 200, y: 290}, 'variables', 'count');
  assert.equal(row.param, 'input_id');
  assert.equal(h.hit.instanceRunInputTargetAt({x: 1000, y: 1000}, 'variables', 'count'), null);

  const incompatible = harness({runCards: [card], compatibleInstance: false});
  assert.equal(incompatible.hit.instanceRunInputTargetAt({x: 110, y: 290}, 'variables', 'count'), null);
  assert.equal(incompatible.calls.compatibleInstance > 0, true);
});

test('variableInputTargetAt 先找节点引脚再找实例输入', () => {
  const node = {id: 'a', type: 'task', pins: [{param: 'template'}]};
  const run = {instance: 'mumu-0', inputs: {}};
  const card = {node: {id: 'p', type: 'task'}, index: 0, x: 100, y: 200, run, variables: [{name: 'input_id'}]};
  const h = harness({raw: {nodes: [node], _layout: {a: {x: 0, y: 0}}}, runCards: [card]});
  assert.deepEqual(h.hit.variableInputTargetAt({x: 10, y: 108}, 'inputs', '模板'), {nodeId: 'a', param: 'template', x: 10, y: 108});
  assert.equal(h.hit.variableInputTargetAt({x: 110, y: 290}, 'inputs', '模板').kind, 'instance-input');
});

test('variableCardTargetAt 就近命中卡片端口，落在卡片内回退端口坐标', () => {
  const node = {id: 'a', type: 'task', pins: [{param: 'template'}]};
  const h = harness({
    raw: {nodes: [node], inputs: {模板: {type: 'asset'}}, _layout: {a: {x: 0, y: 0}}},
    cards: [{id: 'card_1', name: '模板', scope: 'inputs', x: 300, y: 0}],
  });
  assert.deepEqual(h.hit.variableCardTargetAt({x: 468, y: 29}, 'a', 'template'), {card: '模板', scope: 'inputs', cardId: 'card_1', x: 468, y: 29});
  assert.deepEqual(h.hit.variableCardTargetAt({x: 350, y: 20}, 'a', 'template'), {card: '模板', scope: 'inputs', cardId: 'card_1', x: 468, y: 29});
  assert.equal(h.hit.variableCardTargetAt({x: 0, y: 0}, 'a', 'template'), null);
});

test('variableCardTargetAtInstanceInput 依赖运行项存在', () => {
  const run = {instance: 'mumu-0', inputs: {}};
  const card = {node: {id: 'p', type: 'task'}, index: 0, x: 100, y: 200, run, variables: [{name: 'input_id'}]};
  const h = harness({runCards: [card], cards: [{id: 'card_1', name: '计数', scope: 'variables', x: 300, y: 0}]});
  assert.deepEqual(h.hit.variableCardTargetAtInstanceInput({x: 468, y: 29}, 'p', 0, 'input_id'), {card: '计数', scope: 'variables', cardId: 'card_1', x: 468, y: 29});
  assert.equal(h.hit.variableCardTargetAtInstanceInput({x: 468, y: 29}, 'p', 5, 'input_id'), null);
});

test('variableConnectionTargetAt 按连线方向分派且无连线时返回 null', () => {
  const node = {id: 'a', type: 'task', pins: [{param: 'template'}]};
  const run = {instance: 'mumu-0', inputs: {}};
  const card = {node: {id: 'p', type: 'task'}, index: 0, x: 100, y: 200, run, variables: [{name: 'input_id'}]};
  const h = harness({
    raw: {nodes: [node], inputs: {模板: {type: 'asset'}}, _layout: {a: {x: 0, y: 0}}},
    runCards: [card],
    cards: [{id: 'card_1', name: '模板', scope: 'inputs', x: 300, y: 0}],
  });
  h.state.variableConnect = {direction: 'from-card', scope: 'inputs', variable: '模板'};
  assert.deepEqual(h.hit.variableConnectionTargetAt({clientX: 10, clientY: 108}), {nodeId: 'a', param: 'template', x: 10, y: 108});
  h.state.variableConnect = {direction: 'from-pin', nodeId: 'a', param: 'template'};
  assert.equal(h.hit.variableConnectionTargetAt({clientX: 468, clientY: 29}).cardId, 'card_1');
  h.state.variableConnect = {direction: 'from-instance-input', nodeId: 'p', runIndex: 0, param: 'input_id'};
  assert.equal(h.hit.variableConnectionTargetAt({clientX: 468, clientY: 29}).cardId, 'card_1');
  h.state.variableConnect = null;
  assert.equal(h.hit.variableConnectionTargetAt({clientX: 468, clientY: 29}), null);
});
