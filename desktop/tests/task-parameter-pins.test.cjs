const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');


function extractFunction(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `找不到函数 ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 未闭合`);
}

function harness() {
  let context;
  context = vm.createContext({
    state: { raw: { _inputParams: {} }, catalog: [] },
    catalogByName: (name) => context.state.catalog.find((item) => item.name === name),
    workflowNodeInputs: () => [],
    variableTypeOf: () => 'any',
    fieldLabel: (name) => ({ message: '提示信息', fields: '字段列表' }[name] || name),
  });
  context.state.catalog = [{
    name: 'core.log',
    parameters: {
      message: { type: 'string', required: true },
      fields: { type: 'object' },
    },
  }];
  const model = require('../dist-test-renderer/canvas/model/canvas-workflow-model.js').createCanvasWorkflowModel({
    state: context.state, Model: {}, VariableSystem: {}, nodes: () => [], position: () => ({ x: 0, y: 0 }),
    variableCards: () => ({}), compatibleRefType: () => true, definitionSchema: definition => definition, nodeHeight: () => 0,
    baseHeight: 96, nodeWidth: 260, decoHeight: 22, variableCardWidth: 168, variableCardHeight: 58,
    variableCardPortY: 29, variablePinX: 10, runCardWidth: 250, runCardBaseHeight: 78, runVariableHeight: 24,
    runCardGapX: 48, runCardGapY: 92,
    catalogByName: name => context.state.catalog.find(item => item.name === name),
    fieldLabel: name => ({ message: '提示信息', fields: '字段列表' }[name] || name),
    workflowNodeInputs: () => [], nextVariableCardId: () => '', workflowReference: () => '',
  });
  context.inputParameterNames = model.inputParameterNames;
  context.nodeVariablePins = model.nodeVariablePins;
  context.paramRowNames = model.paramRowNames;
  context.paramRowsExpanded = model.paramRowsExpanded;
  return context;
}

test('任务必填参数自动生成变量端口', () => {
  const context = harness();
  const node = { id: 'task_1', type: 'task', action: 'core.log', params: { message: '你好' } };
  assert.deepEqual(Array.from(context.inputParameterNames(node)), ['message']);
  assert.deepEqual(Array.from(context.nodeVariablePins(node), ({ param, label, type }) => ({ param, label, type })), [
    { param: 'message', label: '提示信息', type: 'string' },
  ]);
});

test('必填参数即使尚未填写也保留端口，可选参数只在配置后出现', () => {
  const context = harness();
  const empty = { id: 'task_2', type: 'task', action: 'core.log', params: {} };
  assert.deepEqual(Array.from(context.inputParameterNames(empty)), ['message']);

  const withOptional = { id: 'task_3', type: 'task', action: 'core.log', params: { fields: {} } };
  assert.deepEqual(Array.from(context.inputParameterNames(withOptional)), ['message', 'fields']);
});

test('旧版输入端点元数据仍然可以恢复端口', () => {
  const context = harness();
  context.state.raw._inputParams.task_legacy = { fields: true };
  const node = { id: 'task_legacy', type: 'task', action: 'core.log', params: {} };
  assert.deepEqual(Array.from(context.inputParameterNames(node)), ['message', 'fields']);
});

test('非任务节点不生成任务参数端口', () => {
  const context = harness();
  assert.deepEqual(Array.from(context.nodeVariablePins({ id: 'sequence_1', type: 'sequence', action: 'core.log', params: {} })), []);
});

test('展开参数行时列出清单里的全部参数，折叠时回到必填 + 已配置', () => {
  const context = harness();
  context.state.paramRowsExpanded = new Set();
  const node = { id: 'task_open', type: 'task', action: 'core.log', params: { message: '你好' } };
  // 折叠：只显示必填与已配置（与端口集一致，保证行高与连线端点对齐）。
  assert.deepEqual(Array.from(context.paramRowNames(node)), ['message']);
  // 展开：清单里的全部参数都成行，未配置的可选参数也在列表里。
  context.state.paramRowsExpanded.add('task_open');
  assert.deepEqual(Array.from(context.paramRowNames(node)), ['message', 'fields']);
  assert.deepEqual(Array.from(context.paramRowNames(node), (name) => typeof name), ['string', 'string']);
  // 没有展开集合（旧状态）时按折叠处理，不改变既有节点高度。
  context.state.paramRowsExpanded = undefined;
  assert.deepEqual(Array.from(context.paramRowNames(node)), ['message']);
  // paramRowNames 只回答「显示哪些行」；节点类型过滤由 nodeVariablePins 负责。
  assert.deepEqual(Array.from(context.paramRowNames({ id: 'seq', type: 'sequence', action: 'core.log', params: {} })), ['message']);
  assert.deepEqual(Array.from(context.nodeVariablePins({ id: 'seq', type: 'sequence', action: 'core.log', params: {} })), []);
  // 未知动作没有定义可展开，退回必填 + 已配置。
  context.state.paramRowsExpanded = new Set(['task_unknown']);
  assert.deepEqual(Array.from(context.paramRowNames({ id: 'task_unknown', type: 'task', action: 'nope', params: {} })), []);
  // 旧版 _inputParams 元数据在折叠状态下也能让清单里的参数成行。
  context.state.paramRowsExpanded = new Set();
  context.state.raw._inputParams.task_legacy = { fields: true };
  const legacyNode = { id: 'task_legacy', type: 'task', action: 'core.log', params: {} };
  assert.deepEqual(Array.from(context.paramRowNames(legacyNode)), ['message', 'fields']);
  const legacyPin = Array.from(context.nodeVariablePins(legacyNode)).find((pin) => pin.param === 'fields');
  assert.equal(legacyPin.definition.type, 'object');
  assert.deepEqual(Array.from(context.nodeVariablePins(legacyNode), (pin) => pin.param), ['message', 'fields']);
});

test('展开状态按 Set 协议判断，跨 realm 注入的集合同样生效', () => {
  const context = harness();
  const node = { id: 'task_open', type: 'task', action: 'core.log', params: { message: '你好' } };
  // 独立预览页 / 测试 vm 塞进来的集合来自别的 realm，instanceof Set 为 false，必须按鸭子类型识别。
  const foreign = { has: (id) => id === 'task_open', add: () => {}, delete: () => {} };
  context.state.paramRowsExpanded = foreign;
  assert.deepEqual(Array.from(context.paramRowNames(node)), ['message', 'fields']);
  assert.equal(context.state.paramRowsExpanded, foreign, '识别到集合时不能替换成新对象');
  // 展开集合缺失或类型不对时补一个本 realm 的集合，并回到折叠状态。
  for (const broken of [undefined, null, 'task_open', [], 7]) {
    context.state.paramRowsExpanded = broken;
    assert.deepEqual(Array.from(context.paramRowNames(node)), ['message']);
    const set = context.paramRowsExpanded();
    assert.equal(typeof set.add, 'function');
    assert.equal(typeof set.has, 'function');
    assert.equal(set.size, 0);
    assert.equal(context.state.paramRowsExpanded, set);
  }
});

test('参数行引脚携带定义、配置状态与当前值供卡片渲染', () => {
  const context = harness();
  context.state.paramRowsExpanded = new Set(['task_open']);
  const node = { id: 'task_open', type: 'task', action: 'core.log', params: { message: '你好' } };
  const pins = Array.from(context.nodeVariablePins(node), (pin) => ({
    param: pin.param, label: pin.label, type: pin.type, configured: pin.configured,
    required: pin.required, value: pin.value, definition: pin.definition,
  }));
  assert.equal(pins.length, 2);
  assert.equal(pins[0].param, 'message');
  assert.equal(pins[0].configured, true);
  assert.equal(pins[0].value, '你好');
  assert.equal(pins[0].required, true);
  assert.equal(pins[0].definition.type, 'string');
  assert.equal(pins[1].param, 'fields');
  assert.equal(pins[1].configured, false);
  assert.equal(pins[1].value, undefined);
  // 折叠时未配置的可选参数不出现，避免卡片被可选参数撑高。
  context.state.paramRowsExpanded.clear();
  assert.deepEqual(Array.from(context.nodeVariablePins(node), (pin) => pin.param), ['message']);
});
