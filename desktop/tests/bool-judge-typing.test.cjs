const { test } = require('node:test');
const assert = require('node:assert/strict');
const modelModule = require('../dist-test-renderer/canvas/model/canvas-workflow-model.js');

const deps = (raw = {}) => ({
  state: { raw }, Model: {}, VariableSystem: {}, nodes: () => [], position: () => ({x:0,y:0}), variableCards: () => ({}),
  compatibleRefType: () => true, definitionSchema: (value) => value, nodeHeight: () => 100, baseHeight: 96, nodeWidth: 260,
  decoHeight: 22, variableCardWidth: 168, variableCardHeight: 58, variableCardPortY: 29, variablePinX: 10,
  runCardWidth: 250, runCardBaseHeight: 78, runVariableHeight: 24, runCardGapX: 48, runCardGapY: 92,
  catalogByName: () => null, fieldLabel: (name) => name, workflowNodeInputs: () => [], nextVariableCardId: () => '',
  workflowReference: () => '',
});
test('bool_judge operand pins infer scalar and variable types for endpoint styling', () => {
  const model = modelModule.createCanvasWorkflowModel(deps({inputs:{name:{type:'string',default:'x'}}}));
  const pins = model.nodeVariablePins({ id:'b', type:'bool_judge', expression:{eq:[0, {ref:'inputs.name'}]} });
  assert.equal(pins[0].type, 'integer');
  assert.equal(pins[1].type, 'string');
});

test('布尔判断卡片端点按表达式形态投影：比较两操作数 / 绑定一个布尔口 / 嵌套无端点', () => {
  const model = modelModule.createCanvasWorkflowModel(deps({inputs:{运行中:{type:'boolean',default:false}, 数量:{type:'integer'}}}));
  const comparison = model.nodeVariablePins({ id:'c', type:'bool_judge', expression:{gt:[{ref:'inputs.数量'}, 3]} });
  assert.deepEqual(comparison.map((pin) => pin.param), ['left', 'right']);
  assert.equal(comparison[1].type, 'integer');

  // 整卡绑定：只有一个布尔口（与判断节点的布尔条件口同一套语义），不再是两个幽灵操作数。
  const bound = model.nodeVariablePins({ id:'b', type:'bool_judge', expression:{ref:'inputs.运行中'} });
  assert.deepEqual(bound.map((pin) => pin.param), ['condition']);
  assert.equal(bound[0].type, 'boolean');
  assert.equal(bound[0].variable, '运行中');
  assert.equal(bound[0].scope, 'inputs');
  assert.equal(bound[0].configured, true);
  assert.deepEqual(bound[0].value, {ref:'inputs.运行中'});

  // 字面量 true/false 也是「整卡就是一个布尔值」，只是没有来源可回读。
  const literal = model.nodeVariablePins({ id:'t', type:'bool_judge', expression:true });
  assert.deepEqual(literal.map((pin) => pin.param), ['condition']);
  assert.equal(literal[0].configured, true);
  assert.equal(literal[0].variable, '');

  // 嵌套条件（and/or/not/exists）没有可拖的端点：内容在「嵌套条件（进阶）」里编辑。
  for (const expression of [{and:[{eq:[1,1]},{eq:[1,2]}]}, {or:[{eq:[1,1]}]}, {not:{eq:[1,1]}}, {exists:{ref:'inputs.数量'}}, {and:[0,0]}]) {
    assert.deepEqual(model.nodeVariablePins({ id:'n', type:'bool_judge', expression }), [], JSON.stringify(expression));
  }
});
