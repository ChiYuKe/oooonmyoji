/**
 * Convert Operator 的边界：只在二元比较运算符之间转换。
 *
 * UE 的 `K2Node_PromotableOperator` 也只转换同类二元运算（Equal ↔ Greater …）；
 * 「与/或/非」不是比较运算符，把 `{eq: [a, b]}` 换成 `{and: [a, b]}` 会写出
 * Python 校验直接拒绝的表达式（`{and: [0, 0]}`：操作数必须是条件对象或 bool），
 * 卡面也没有对应的可编辑引脚——嵌套条件只能走「嵌套条件（进阶）」浮层。
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createEditorCommands } = require('../dist-test-renderer/canvas/state/editor-commands.js');
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness(nodes) {
  const raw = { inputs: {}, variables: {}, nodes };
  const state = createCanvasState();
  state.raw = raw;
  const model = createWorkflowModel(state);
  const calls = {toasts: [], renders: 0};
  const commands = createEditorCommands({
    state,
    mutate: (fn) => { fn(); calls.renders += 1; },
    nodeById: model.nodeById,
    nodes: model.nodes,
    layout: model.layout,
    position: () => ({x: 0, y: 0}),
    clone: (value) => JSON.parse(JSON.stringify(value)),
    toast: (message, error) => calls.toasts.push([message, Boolean(error)]),
    variableCards: () => model.variableCards(),
    variableLinks: () => model.variableLinks(),
    nextVariableCardId: () => 'card_1',
    parameterLiteralCache: () => ({}),
    parameterLiteralCacheKey: (node, name) => `${node.id}:${name}`,
    setVariableCardSelection: () => {},
    variableInputTargetAt: () => null,
    instanceRunCards: () => [],
    displayNameOfDefinition: (definition, name) => name || '',
    wrap: {clientWidth: 0, clientHeight: 0},
    variableCardWidth: 160, variableCardHeight: 96, variableCardPortY: 40, nodeWidth: 260, runCardWidth: 200,
  });
  return {raw, commands, calls};
}

test('比较形态之间换运算符：操作数原样保留', () => {
  const h = harness([{id: 'j1', type: 'bool_judge', expression: {gt: [{ref: 'inputs.数量'}, 3]}}]);
  h.commands.setBoolJudgeOperator('j1', 'lte');
  assert.deepEqual(plain(h.raw.nodes[0].expression), {lte: [{ref: 'inputs.数量'}, 3]});
  h.commands.setBoolJudgeOperator('j1', 'eq');
  assert.deepEqual(plain(h.raw.nodes[0].expression), {eq: [{ref: 'inputs.数量'}, 3]});
});

test('不许把比较卡转成与/或/非，也不许动嵌套卡与绑定卡', () => {
  const h = harness([
    {id: 'j1', type: 'bool_judge', expression: {eq: [1, 2]}},
    {id: 'j2', type: 'bool_judge', expression: {and: [{eq: [1, 1]}, {gt: [2, 1]}]}},
    {id: 'j3', type: 'bool_judge', expression: {ref: 'inputs.运行中'}},
    {id: 'j4', type: 'bool_judge', expression: {and: [0, 0]}},
  ]);
  // 目标是嵌套运算符：直接拒绝（菜单也不会列出来）。
  h.commands.setBoolJudgeOperator('j1', 'and');
  h.commands.setBoolJudgeOperator('j1', 'not');
  assert.deepEqual(plain(h.raw.nodes[0].expression), {eq: [1, 2]}, '比较卡保持原样');
  // 当前已经是嵌套 / 绑定 / 坏形状：没有可转换的运算符，一律不动。
  h.commands.setBoolJudgeOperator('j2', 'gt');
  h.commands.setBoolJudgeOperator('j3', 'eq');
  h.commands.setBoolJudgeOperator('j4', 'eq');
  assert.deepEqual(plain(h.raw.nodes[1].expression), {and: [{eq: [1, 1]}, {gt: [2, 1]}]});
  assert.deepEqual(plain(h.raw.nodes[2].expression), {ref: 'inputs.运行中'});
  assert.deepEqual(plain(h.raw.nodes[3].expression), {and: [0, 0]}, '坏形状留给嵌套条件编辑器修');
  assert.equal(h.calls.renders, 0, '拒绝时不产生任何改动');
});
