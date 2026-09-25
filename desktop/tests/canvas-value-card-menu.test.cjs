/**
 * 值卡片的节点右键菜单：对齐 UE 的节点菜单——
 * `K2Node_BreakStruct` 的结构体类型、`K2Node_PromotableOperator` 的
 * 「Convert Operator → Convert to Equal/…」（K2Node_PromotableOperator.cpp:143）。
 * 这两类节点在 UE 里没有详情面板，设置全部走这里。
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createCanvasPortMenu} = require('../dist-test-renderer/canvas/interactions/port-menu.js');

function harness(raw, options = {}) {
  const state = {raw, selected: new Set(), selectedEdge: null, selectedRun: null};
  const calls = {references: [], operators: [], editors: [], disconnected: [], variables: []};
  const menu = createCanvasPortMenu({
    state,
    startConnectionFromInput() {},
    startConnection() {},
    startReferenceConnection() {},
    startVariableConnectionFromPin() {},
    startVariableConnectionFromInstanceInput() {},
    startVariableConnectionFromCard() {},
    parentOf: () => null,
    buildNode: () => ({}),
    canConnect: () => null,
    connect() {},
    disconnect() {},
    mutate: (fn) => fn(),
    nodeById: (id) => (raw.nodes || []).find((node) => node.id === id) || null,
    position: () => ({x: 0, y: 0}),
    layout: () => ({}),
    nodes: () => raw.nodes || [],
    nodeVariablePins: (node) => node.pins || [],
    nodeOutputFields: () => [],
    disconnectReferenceFromPin: (nodeId, param) => calls.disconnected.push([nodeId, param]),
    disconnectVariableFromPin: (nodeId, param) => calls.variables.push([nodeId, param]),
    connectReferenceToPin: (sourceNodeId, ref) => calls.references.push([sourceNodeId, ref]),
    breakSourceCandidates: options.candidates,
    setBoolJudgeOperator: (nodeId, operator) => calls.operators.push([nodeId, operator]),
    openValueCardEditor: (nodeId) => calls.editors.push(nodeId),
    variableCards: () => ({}),
    variableLinks: () => ({}),
    nextVariableCardId: () => 'v1',
    variableCardList: () => [],
    variableCardPosition: () => ({x: 0, y: 0}),
    focusVariableCard() {},
    placeVariableCard() {},
    disconnectVariableFromInstanceInput() {},
    removeVariableCard() {},
    fieldLabel: (name) => name,
    toast() {},
    typeNames: {},
    nodeWidth: 260,
    variableCardWidth: 168,
    variableCardPortY: 29,
  });
  return {menu, calls, state};
}

const labels = (items) => items.filter((item) => typeof item === 'object').map((item) => item.label);

test('拆分卡片菜单：列出来源候选（UE 的结构体选择）、断开来源与进阶入口', () => {
  const h = harness({nodes: [{id: 'b1', type: 'break', ref: {ref: 'nodes.a.output'}}]}, {
    candidates: () => [{ref: 'nodes.a.output', label: '识别页面 · 输出'}, {ref: 'inputs.区域', label: '识别区域 · 输入'}],
  });
  const items = h.menu.valueCardMenuItems('b1');
  assert.deepEqual(labels(items), ['更改拆分来源', '断开拆分来源', '拆分字段（进阶）…']);

  const sources = items[0].children;
  assert.deepEqual(labels(sources), ['识别页面 · 输出（nodes.a.output）', '识别区域 · 输入（inputs.区域）']);
  sources[0].run();
  sources[1].run();
  assert.deepEqual(h.calls.references, [['a', 'nodes.a.output'], ['inputs', 'inputs.区域']], '按下标来源写入 ref');

  items[1].run();
  assert.deepEqual(h.calls.disconnected, [['b1', 'ref']]);
  items.find((item) => typeof item === 'object' && item.label === '拆分字段（进阶）…').run();
  assert.deepEqual(h.calls.editors, ['b1']);
});

test('未绑定来源的拆分卡片：不出现「断开拆分来源」', () => {
  const h = harness({nodes: [{id: 'b1', type: 'break'}]}, {candidates: () => []});
  const items = h.menu.valueCardMenuItems('b1');
  assert.deepEqual(labels(items), ['拆分字段（进阶）…']);
});

test('布尔判断卡片菜单：Convert Operator 列出其它运算符，当前的不重复列', () => {
  const h = harness({nodes: [{id: 'j1', type: 'bool_judge', expression: {gt: [1, 2]}}]});
  const items = h.menu.valueCardMenuItems('j1');
  assert.deepEqual(labels(items), ['改为', '嵌套条件（进阶）…']);

  const operators = items[0].children;
  const names = labels(operators);
  assert.equal(names.includes('大于'), false, '当前运算符不重复列');
  assert.deepEqual(names.slice(0, 3), ['等于', '不等于', '大于等于']);
  // 与/或/非不是比较运算符：转过去会写出 `{and: [0, 0]}` 这种 Python 校验直接拒绝的表达式，
  // 嵌套逻辑一律走「嵌套条件（进阶）…」。UE 的 Convert Operator 同样只转换同类二元运算符。
  assert.deepEqual(names.filter((name) => ['与', '或', '非'].includes(name)), []);

  operators.find((item) => item.label === '包含').run();
  assert.deepEqual(h.calls.operators, [['j1', 'contains']]);
});

test('嵌套 / 整卡绑定形态的布尔判断卡片：没有 Convert Operator，只留进阶入口', () => {
  const nested = harness({nodes: [{id: 'j1', type: 'bool_judge', expression: {and: [{eq: [1, 1]}, {gt: [2, 1]}]}}]});
  assert.deepEqual(labels(nested.menu.valueCardMenuItems('j1')), ['嵌套条件（进阶）…']);
  nested.menu.valueCardMenuItems('j1')[0].run();
  assert.deepEqual(nested.calls.editors, ['j1']);

  const bound = harness({nodes: [{id: 'j2', type: 'bool_judge', expression: {ref: 'inputs.运行中'}}]});
  assert.deepEqual(labels(bound.menu.valueCardMenuItems('j2')), ['嵌套条件（进阶）…']);
  // `{and: [0, 0]}` 这类坏形状同样不给「改为」。
  const broken = harness({nodes: [{id: 'j3', type: 'bool_judge', expression: {and: [0, 0]}}]});
  assert.deepEqual(labels(broken.menu.valueCardMenuItems('j3')), ['嵌套条件（进阶）…']);
});

test('其它类型没有值卡片菜单', () => {
  const h = harness({nodes: [{id: 't1', type: 'task'}, {id: 's1', type: 'sequence'}]});
  assert.deepEqual(h.menu.valueCardMenuItems('t1'), []);
  assert.deepEqual(h.menu.valueCardMenuItems('s1'), []);
  assert.deepEqual(h.menu.valueCardMenuItems('missing'), []);
});
