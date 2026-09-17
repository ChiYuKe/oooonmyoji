// Run via npm test (builds the renderer test output first).
// 卡片值格式化与摘要：纯计算，直接验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {nodeCardSummary, compactValue, workflowInputVariableValue, variableValueSummary, instanceLabel} = require('../dist-test-renderer/canvas/render/card-values.js');

test('nodeCardSummary 优先展示常用参数，其次按节点类型说明', () => {
  assert.equal(nodeCardSummary({type: 'task', params: {present: false, timeout_seconds: 5, threshold: 0.8}}), '等待消失 · 超时 5s · 阈值 80%');
  assert.equal(nodeCardSummary({type: 'task', params: {a: 1, b: 2}}), '2 项参数 · 详情栏编辑');
  assert.equal(nodeCardSummary({type: 'task', params: {}}), '详情栏编辑参数');
  assert.equal(nodeCardSummary({type: 'root', params: {}}), '工作流入口');
  assert.equal(nodeCardSummary({type: 'sequence', params: {}}), '按顺序执行子节点');
  assert.equal(nodeCardSummary({type: 'unknown', params: {}}), '详情栏查看配置');
});

test('compactValue 处理未传值、引用、字符串、对象与截断', () => {
  assert.equal(compactValue(undefined), '未传值');
  assert.equal(compactValue({ref: 'inputs.timeout'}), '← timeout');
  assert.equal(compactValue('文本'), '文本');
  assert.equal(compactValue({a: 1}), '{"a":1}');
  assert.equal(compactValue([1, 2], Infinity), '[1,2]');
  assert.equal(compactValue('1234567890', 5), '1234…');
});

test('workflowInputVariableValue 区分已传值、默认值与必填', () => {
  const variable = {name: 'timeout', definition: {default: 3}};
  assert.equal(workflowInputVariableValue({inputs: {timeout: 9}}, variable), '9');
  assert.equal(workflowInputVariableValue({}, variable), '默认 3');
  assert.equal(workflowInputVariableValue({}, {name: 'x', definition: {required: true}}), '需要传值');
  assert.equal(workflowInputVariableValue({}, {name: 'x', definition: {}}), '未传值');
});

test('variableValueSummary 覆盖默认值、必填与未设默认', () => {
  assert.equal(variableValueSummary({default: 0}), '0');
  assert.equal(variableValueSummary({default: {attempts: 2}}), '{"attempts":2}');
  assert.equal(variableValueSummary({required: true}), '必填');
  assert.equal(variableValueSummary({}), '未设默认');
});

test('instanceLabel 优先显示名，其次后端推导，最后回退', () => {
  const instances = [
    {id: 'a', displayName: '模拟器一'},
    {id: 'b', backend: 'mumu', mumuIndex: 2},
    {id: 'c'},
  ];
  assert.equal(instanceLabel('a', instances), '模拟器一');
  assert.equal(instanceLabel('b', instances), 'MuMu 2');
  assert.equal(instanceLabel('c', instances), 'c');
  assert.equal(instanceLabel('missing', instances), 'missing');
  assert.equal(instanceLabel('', instances, '未选择实例'), '未选择实例');
});
