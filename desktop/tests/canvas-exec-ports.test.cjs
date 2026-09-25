// Run via npm test (builds the renderer test output first).
// 判断节点的口位推导与几何：卡片绘制、连线起点、命中吸附、端口菜单共用这一份定义。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const ports = require('../dist-test-renderer/canvas/model/exec-ports.js');

test('ports 与 children 对齐；没写 ports 时按位置推导', () => {
  assert.deepEqual(ports.conditionPortsOf({children: ['a', 'b']}), ['true', 'false']);
  assert.deepEqual(ports.conditionPortsOf({children: ['a'], ports: ['false']}), ['false']);
  assert.deepEqual(ports.conditionPortsOf({children: []}), []);
  assert.deepEqual(ports.conditionPortsOf({children: ['a', 'b'], ports: ['false']}), ['false', 'true']);
  assert.equal(ports.conditionChildOf({children: ['a', 'b'], ports: ['false', 'true']}, 'true'), 'b');
  assert.equal(ports.conditionChildOf({children: ['a']}, 'false'), null);
  assert.equal(ports.conditionPortOfChild({children: ['a', 'b']}, 'b'), 'false');
  assert.equal(ports.conditionPortOfChild({children: ['a']}, 'nope'), null);
});

test('口位几何：左真右假，指针就近取口', () => {
  assert.equal(ports.conditionPortOffset(260, 'true'), 78);
  assert.equal(ports.conditionPortOffset(260, 'false'), 182);
  assert.equal(ports.nearestConditionPort(260, 10), 'true');
  assert.equal(ports.nearestConditionPort(260, 129), 'true');
  assert.equal(ports.nearestConditionPort(260, 130), 'false');
  assert.equal(ports.nearestConditionPort(260, 259), 'false');
});

test('bool_judge 左右表达式输入端点几何独立且不复用 condition 端口', () => {
  assert.deepEqual(ports.expressionInputOffset({type: 'condition'}, 'condition'), {x: 10, y: 64});
  assert.deepEqual(ports.expressionInputOffset({type: 'bool_judge'}, 'left'), {x: 10, y: 64});
  assert.deepEqual(ports.expressionInputOffset({type: 'bool_judge'}, 'right'), {x: 10, y: 88});
  assert.equal(ports.expressionInputOffset({type: 'bool_judge'}, 'condition'), null);
  assert.equal(ports.isBoolJudgeOperandPin({type: 'bool_judge'}, 'left'), true);
  assert.equal(ports.isBoolJudgeOperandPin({type: 'bool_judge'}, 'right'), true);
  assert.equal(ports.isBooleanInputPin({type: 'bool_judge'}, 'condition'), false);
});

test('表达式形态：二元比较 / 整卡绑定 / 嵌套（含坏形状）', () => {
  const shape = (expression) => ports.boolJudgeExpressionShape(expression);
  for (const operator of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains']) {
    assert.equal(shape({[operator]: [1, 2]}), 'comparison', `${operator} 是二元比较`);
  }
  // 整卡就是一个 bool 值：引用绑定或字面量。
  assert.equal(shape({ref: 'inputs.运行中'}), 'binding');
  assert.equal(shape(true), 'binding');
  assert.equal(shape(false), 'binding');
  // 嵌套逻辑与坏形状：卡面只回读，没有可编辑的操作数。
  assert.equal(shape({and: [{eq: [1, 1]}, {eq: [1, 2]}]}), 'nested');
  assert.equal(shape({or: [{eq: [1, 1]}]}), 'nested');
  assert.equal(shape({not: {eq: [1, 1]}}), 'nested');
  assert.equal(shape({exists: {ref: 'nodes.a.output'}}), 'nested');
  // `{and: [0, 0]}` 是 Python 校验直接拒绝的表达式（操作数必须是条件或 bool）：
  // 卡片不许把它画成「两个操作数 + and」的样子。
  assert.equal(shape({and: [0, 0]}), 'nested');
  // 操作数数量不对、ref 不是字符串、多键、空值：都算认不出的坏形状。
  assert.equal(shape({eq: [1]}), 'nested');
  assert.equal(shape({eq: [1, 2, 3]}), 'nested');
  assert.equal(shape({ref: 3}), 'nested');
  assert.equal(shape({eq: [1, 2], ne: [1, 2]}), 'nested');
  assert.equal(shape(undefined), 'nested');
  assert.equal(shape('eq'), 'nested');
  assert.equal(shape([1, 2]), 'nested');
});

test('整卡绑定形态只留一个布尔输入口，几何与判断节点的布尔条件口一致', () => {
  const bound = {type: 'bool_judge', expression: {ref: 'inputs.运行中'}};
  assert.equal(ports.boolJudgeShape(bound), 'binding');
  assert.equal(ports.isBooleanInputPin(bound, 'condition'), true);
  assert.equal(ports.isBooleanInputPin(bound, 'left'), false);
  assert.deepEqual(ports.expressionInputOffset(bound, 'condition'), {x: 10, y: 64});
  assert.equal(ports.isBoolJudgeOperandPin(bound, 'condition'), false, '绑定口不是可编辑操作数');

  // 比较形态仍是两个操作数口，没有布尔条件口。
  const compared = {type: 'bool_judge', expression: {eq: [1, 2]}};
  assert.equal(ports.isBooleanInputPin(compared, 'condition'), false);
  assert.equal(ports.expressionInputOffset(compared, 'condition'), null);
  // 嵌套形态没有任何输入口可拖。
  const nested = {type: 'bool_judge', expression: {and: [{eq: [1, 1]}]}};
  assert.equal(ports.isBooleanInputPin(nested, 'condition'), false);
  assert.deepEqual(ports.boolJudgeShape(nested), 'nested');
});
