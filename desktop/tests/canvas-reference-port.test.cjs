/**
 * 任务卡「节点输出引用」口：输出字段枚举、类型兼容、落点解析、引用绑定/断开与值显示。
 *
 * Task 在 Behavior Tree 里是叶子（没有执行流输出），右侧的口专门用来把
 * `nodes.<id>.output.<字段>` 拖到别的节点的参数行上。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Rows = require('../dist-test-renderer/canvas/render/param-rows.js');

const CATALOG = [
  {
    name: 'vision.detect_state',
    parameters: { states: { type: 'array', items: { type: 'object' }, required: true }, allow_ocr: { type: 'boolean', default: true } },
    outputSchema: { type: 'object', properties: { state: { type: 'string' }, confidence: { type: 'number' } }, required: ['state'] },
  },
  {
    name: 'vision.wait_template',
    parameters: { template: { type: 'asset', required: true }, timeout_seconds: { type: 'duration', required: true } },
    // 数组输出：没有字段名，整体输出一个候选。
    outputSchema: { type: 'array' },
  },
  {
    name: 'core.sleep',
    parameters: { seconds: { type: 'duration', required: true } },
    outputSchema: { type: 'object', properties: { elapsed: { type: 'number' } } },
  },
  {
    name: 'core.log',
    parameters: { message: { type: 'string' } },
    outputSchema: { type: 'object', properties: { logged: { type: 'string' } } },
  },
  {
    name: 'core.assert',
    parameters: { ok: { type: 'boolean' } },
    outputSchema: { type: 'object', properties: { passed: { type: 'boolean' } } },
  },
  {
    name: 'core.mixed',
    parameters: { message: { type: 'string', required: true }, ok: { type: 'boolean' } },
    outputSchema: { type: 'object', properties: { logged: { type: 'string' } } },
  },
  {
    name: 'vision.wait_matches',
    parameters: { template: { type: 'asset', required: true } },
    outputSchema: {
      type: 'array',
      items: { type: 'object', properties: { x: { type: 'integer' }, confidence: { type: 'number' } } },
    },
  },
  {
    name: 'input.tap_thing',
    parameters: { match: { type: 'object' } },
    outputSchema: { type: 'object', properties: { clicked: { type: 'boolean' } } },
  },
];

function harness() {
  const context = { state: { raw: { _inputParams: {} }, catalog: CATALOG, zoom: 1 } };
  const model = require('../dist-test-renderer/canvas/model/canvas-workflow-model.js').createCanvasWorkflowModel({
    state: context.state, Model: {}, VariableSystem: {}, nodes: () => context.state.raw.nodes || [],
    position: () => ({ x: 0, y: 0 }), variableCards: () => ({}), compatibleRefType: (expected, actual) => {
      // 简化版兼容规则：any 通吃；object 只接受 object；其余同类型。
      const left = (expected && expected.type) || 'any';
      const right = (actual && actual.type) || 'any';
      if (left === 'any' || right === 'any') return true;
      if (left === 'object') return right === 'object';
      if (left === 'array') return right === 'array';
      if (left === 'number' || left === 'integer' || left === 'duration') return right === 'number' || right === 'integer' || right === 'duration';
      return left === right;
    },
    // 用真实的画布 schema 工具：rect 这类复合定义的展开（prefixItems / 分量名）就是它负责的。
    definitionSchema: (definition) => require('../dist-test-renderer/canvas/model/schema.js').createEditorSchema().definitionSchema(definition),
    nodeHeight: () => 0, baseHeight: 96, nodeWidth: 260, decoHeight: 22,
    variableCardWidth: 168, variableCardHeight: 58, variableCardPortY: 29, variablePinX: 10,
    runCardWidth: 250, runCardBaseHeight: 78, runVariableHeight: 24, runCardGapX: 48, runCardGapY: 92,
    catalogByName: (name) => CATALOG.find((item) => item.name === name) || null,
    fieldLabel: (name) => ({ state: '页面状态', confidence: '置信度', target: '目标' }[name] || name),
    workflowNodeInputs: () => [], nextVariableCardId: () => '', workflowReference: () => '',
    nodeVariablePins: (node) => node.pins || [],
  });
  context.model = model;
  return context;
}

test('nodeOutputFields 对象输出逐字段给引用，数组输出给整体 + 前几项', () => {
  const { model } = harness();
  const detect = { id: 'n1', type: 'task', name: '识别当前页面状态', action: 'vision.detect_state' };
  assert.deepEqual(model.nodeOutputFields(detect).map((item) => [item.field, item.ref, item.label]), [
    ['state', 'nodes.n1.output.state', '页面状态'],
    ['confidence', 'nodes.n1.output.confidence', '置信度'],
  ]);
  // 元素类型未知的数组（只有 type: array）不给下标引用：运行时也解析不出字段。
  const wait = { id: 'n2', type: 'task', name: '等待战斗结束', action: 'vision.wait_template' };
  assert.deepEqual(model.nodeOutputFields(wait).map((item) => [item.field, item.ref]), [['', 'nodes.n2.output']]);
  // 匹配数组（items 是对象）：整体 + 第 1 项 + 该项的一层字段，这样才能喂给「单个对象」参数。
  // 自由数组不列第 2 项起：元素同形、下标无语义，运行时还可能不存在。
  const matches = { id: 'n3', type: 'task', name: '等待战斗结束', action: 'vision.wait_matches' };
  assert.deepEqual(model.nodeOutputFields(matches).map((item) => item.field), [
    '', '0', '0.x', '0.confidence',
  ]);
  assert.equal(model.nodeOutputFields(matches)[1].ref, 'nodes.n3.output.0');
  assert.equal(model.nodeOutputFields(matches)[2].label, '第 1 项 · x');
  // 没有声明长度的数组不再补下标。
  assert.equal(model.nodeOutputFields(matches).some((item) => /^[1-9]/.test(item.field)), false);
  // 没有 action / 清单里没有这个 Action：没有输出候选。
  assert.deepEqual(model.nodeOutputFields({ id: 'n4', type: 'task' }), []);
  assert.deepEqual(model.nodeOutputFields({ id: 'n5', type: 'task', action: 'nope' }), []);
  assert.deepEqual(model.nodeOutputFields(null), []);
});

test('referenceCompatibleWithPin 按值类型判断，引用显示名用节点名 + 字段标签', () => {
  const { model, state } = harness();
  state.raw.nodes = [
    { id: 'n1', type: 'task', name: '识别当前页面状态', action: 'vision.detect_state' },
    { id: 'n2', type: 'task', name: '等待战斗结束', action: 'vision.wait_template' },
    { id: 't1', type: 'task', name: '点击挑战按钮', action: 'core.sleep', params: {} },
  ];
  const detect = state.raw.nodes.find((node) => node.id === 'n1');
  const sleep = state.raw.nodes.find((node) => node.id === 't1');
  // core.sleep 的 seconds 是 duration/数值：state 是 string → 不兼容；wait_template 的 timeout 也是数值 → 不兼容。
  assert.equal(model.referenceCompatibleWithPin(detect, 'state', sleep, 'seconds'), false);
  assert.equal(model.referenceCompatibleWithPin(detect, 'confidence', sleep, 'seconds'), true);
  assert.deepEqual(model.referenceFieldsForPin(detect, sleep, 'seconds').map((item) => item.field), ['confidence']);
  // 数组输出的整体引用能进数组参数。
  const wait = { id: 'n2', type: 'task', name: '等待战斗结束', action: 'vision.wait_template' };
  const detectState = { id: 'n3', type: 'task', name: '识别状态', action: 'vision.detect_state' };
  assert.deepEqual(model.referenceFieldsForPin(wait, detectState, 'states').map((item) => item.field), ['']);
  // 显示名：nodes.<id>.output.<字段> → 节点名.字段标签，数组下标写作 [n]。
  assert.equal(model.referenceDisplayName('nodes.n1.output.state'), '识别当前页面状态.页面状态');
  assert.equal(model.referenceDisplayName('nodes.n2.output'), '等待战斗结束');
  assert.equal(model.referenceDisplayName('nodes.n2.output.0'), '等待战斗结束[0]');
  assert.equal(model.referenceDisplayName('nodes.n2.output.0.confidence'), '等待战斗结束[0].置信度');
  // 匹配数组 → 单个对象参数：拖过去应该给出「第 1 项」，而不是因为数组≠对象连不上。
  const matches = { id: 'm1', type: 'task', name: '等待战斗结束', action: 'vision.wait_matches' };
  const tapThing = { id: 'm2', type: 'task', name: '点击匹配项', action: 'input.tap_thing', params: {} };
  assert.deepEqual(model.referenceFieldsForPin(matches, tapThing, 'match').map((item) => item.field), ['0']);
  assert.equal(model.referenceFieldsForPin(matches, tapThing, 'match')[0].ref, 'nodes.m1.output.0');
  // 数值参数只接受「第 1 项 · 数值字段」，不接受整个对象项。
  const numeric = { id: 'm3', type: 'task', name: '数值', action: 'core.sleep', params: {} };
  assert.deepEqual(model.referenceFieldsForPin(matches, numeric, 'seconds').map((item) => item.field),
    ['0.x', '0.confidence']);
  // 源节点已删除时用 id 兜底，字段名仍走共享标签。
  assert.equal(model.referenceDisplayName('nodes.gone.output.state'), 'gone.页面状态');
  assert.equal(model.referenceDisplayName('inputs.x'), 'inputs.x');
  assert.equal(model.referenceDisplayName(undefined), '');
});

test('命中测试只认能接受该输出的参数端点', () => {
  const { model, state } = harness();
  state.raw.nodes = [
    { id: 'n1', type: 'task', name: '识别当前页面状态', action: 'vision.detect_state', params: {} },
    { id: 'n2', type: 'task', name: '等待战斗结束', action: 'vision.wait_template', params: {} },
    { id: 't1', type: 'task', name: '输出日志', action: 'core.mixed', params: {}, pins: [
      { param: 'message', label: '日志内容', type: 'string', configured: true, definition: { type: 'string', required: true } },
      { param: 'ok', label: '断言值', type: 'boolean', configured: true, definition: { type: 'boolean' } },
    ] },
    { id: 't2', type: 'task', name: '断言校验', action: 'core.assert', params: {}, pins: [
      { param: 'ok', label: '断言值', type: 'boolean', configured: false, definition: { type: 'boolean' } },
    ] },
  ];
  const hitTest = require('../dist-test-renderer/canvas/interactions/hit-test.js').createCanvasHitTest({
    state,
    worldPoint: (event) => ({ x: event.clientX, y: event.clientY }),
    nodes: () => state.raw.nodes,
    nodeById: (id) => state.raw.nodes.find((node) => node.id === id) || null,
    position: (node) => ({ x: node.id === 't1' ? 320 : 640, y: 0 }),
    nodeHeight: () => 96,
    nodeRowHeight: () => 24,
    nodeVariablePins: (node) => node.pins || [],
    variableCompatibleWithPin: () => true,
    variableCompatibleWithInstanceInput: () => true,
    referenceFieldsForPin: (source, target, param) => model.referenceFieldsForPin(source, target, param),
    instanceRunCards: () => [],
    instanceRunInputPosition: () => ({ x: 0, y: 0 }),
    variableCardList: () => [],
    portRadius: 7, nodeWidth: 260, baseHeight: 96, runVariableHeight: 24, variablePinX: 10,
    runCardWidth: 250, runCardBaseHeight: 78, variableCardWidth: 168, variableCardHeight: 58, variableCardPortY: 29,
  });
  // 行带：t1 第 0 行 y 96..120（message）、第 1 行 y 120..144（ok）。
  // 捏住端点小圆 → message，并带回兼容字段。
  const pinHit = hitTest.referenceTargetAt({ x: 330, y: 108 }, 'n1');
  assert.ok(pinHit, 'string 端点应该能被命中');
  assert.equal(pinHit.nodeId, 't1');
  assert.equal(pinHit.param, 'message');
  assert.deepEqual(pinHit.fields.map((item) => item.field), ['state']);
  // 落在行带右侧（值区）也绑这一行。
  assert.equal(hitTest.referenceTargetAt({ x: 500, y: 108 }, 'n1').param, 'message');
  // 落在下一行（boolean，不兼容）不能吸到上一行的 message —— 这是「乱吸附」的回归点。
  assert.equal(hitTest.referenceTargetAt({ x: 500, y: 132 }, 'n1'), null);
  assert.equal(hitTest.referenceTargetAt({ x: 330, y: 132 }, 'n1'), null);
  // 表头（行带之外）不吸附；整张不兼容的卡片也不吸附。
  assert.equal(hitTest.referenceTargetAt({ x: 400, y: 40 }, 'n1'), null);
  assert.equal(hitTest.referenceTargetAt({ x: 650, y: 108 }, 'n1'), null);
  // 源节点自己不算目标。
  assert.equal(hitTest.referenceTargetAt({ x: 10, y: 108 }, 'n1'), null);
  // 被拒绝时也要能说出光标下是哪一行，好提示「这个参数不接受该输出类型」。
  assert.equal(hitTest.referenceMissAt({ x: 500, y: 132 }, 'n1').param, 'ok');
  assert.equal(hitTest.referenceMissAt({ x: 500, y: 108 }, 'n1').param, 'message');
  assert.equal(hitTest.referenceMissAt({ x: 400, y: 40 }, 'n1'), null, '表头不算落点');
  assert.equal(hitTest.referenceMissAt({ x: 10, y: 108 }, 'n1'), null, '源节点自己不算落点');
});

test('拆分卡片的来源行是引用落点：整行吸附，落点解释也认这一行', () => {
  const { model, state } = harness();
  state.raw.nodes = [
    { id: 'n1', type: 'task', name: '识别当前页面状态', action: 'vision.detect_state', params: {} },
    { id: 'b1', type: 'break', name: '拆分页面状态', pins: [
      { param: 'ref', label: '拆分来源', type: 'any', configured: false, required: true, definition: null },
    ] },
  ];
  const hitTest = require('../dist-test-renderer/canvas/interactions/hit-test.js').createCanvasHitTest({
    state,
    worldPoint: (event) => ({ x: event.clientX, y: event.clientY }),
    nodes: () => state.raw.nodes,
    nodeById: (id) => state.raw.nodes.find((node) => node.id === id) || null,
    position: () => ({ x: 0, y: 0 }),
    nodeHeight: () => 120,
    nodeRowHeight: () => 24,
    nodeVariablePins: (node) => node.pins || [],
    variableCompatibleWithPin: () => true,
    variableCompatibleWithInstanceInput: () => true,
    referenceFieldsForPin: (source, target, param) => model.referenceFieldsForPin(source, target, param),
    instanceRunCards: () => [],
    instanceRunInputPosition: () => ({ x: 0, y: 0 }),
    variableCardList: () => [],
    portRadius: 7, nodeWidth: 260, baseHeight: 96, runVariableHeight: 24, variablePinX: 10,
    runCardWidth: 250, runCardBaseHeight: 78, variableCardWidth: 168, variableCardHeight: 58, variableCardPortY: 29,
  });
  // 行带 y 96..120：落在行上（不只捏住引脚小圆）也吸附到「拆分来源」这一行。
  const rowHit = hitTest.referenceTargetAt({ x: 150, y: 108 }, 'n1');
  assert.ok(rowHit, '拆分来源行应该能被命中');
  assert.equal(rowHit.nodeId, 'b1');
  assert.equal(rowHit.param, 'ref');
  // 拆分来源不挑输出类型：来源输出的全部候选都兼容。
  assert.ok(rowHit.fields.length, '应该带回兼容字段');
  // 落点解释（拖线落空时的提示）同样认这一行。
  assert.equal(hitTest.referenceMissAt({ x: 150, y: 108 }, 'n1').param, 'ref');
});

test('拆分来源落点候选只给 object / array：整体输出 + 复合字段，标量字段与标量来源挡掉', () => {
  const { model, state } = harness();
  const detect = { id: 'n1', type: 'task', name: '识别当前页面状态', action: 'vision.detect_state' };
  const matches = { id: 'm1', type: 'task', name: '等待匹配', action: 'vision.wait_matches' };
  const breakNode = { id: 'b1', type: 'break', name: '拆分', ref: { ref: 'nodes.n1.output' } };
  const scalarBreak = { id: 'b2', type: 'break', name: '拆标量', ref: { ref: 'nodes.n1.output.state' } };
  state.raw.nodes = [detect, matches, breakNode, scalarBreak];

  // object 输出：给「整体输出」（拆 struct 的常见用法），标量字段 state / confidence 不给。
  const detectFields = model.referenceFieldsForPin(detect, breakNode, 'ref');
  assert.deepEqual(detectFields.map((item) => item.field), ['']);
  assert.equal(detectFields[0].ref, 'nodes.n1.output');
  assert.equal(model.referenceCompatibleWithPin(detect, 'state', breakNode, 'ref'), false, '标量字段不能当拆分来源');

  // array 输出：同样只给整体（拆开后卡片自己会露出「第 1 项」等引脚）。
  assert.deepEqual(model.referenceFieldsForPin(matches, breakNode, 'ref').map((item) => item.field), ['']);

  // 拆分卡片的输出也能再拆：拆的是 object 时给整体输出……
  assert.deepEqual(model.referenceFieldsForPin(breakNode, scalarBreak, 'ref').map((item) => item.field), ['']);
  // ……而拆出来是标量（.state）的拆分卡不能再当来源。
  assert.deepEqual(model.referenceFieldsForPin(scalarBreak, breakNode, 'ref'), []);
});

test('breakFieldPins 只给 object / array 输出的顶层字段（UE Break 的引脚列）', () => {
  const { model, state } = harness();
  const detect = { id: 'n1', type: 'task', name: '识别当前页面状态', action: 'vision.detect_state' };
  const matches = { id: 'm1', type: 'task', name: '等待匹配', action: 'vision.wait_matches' };
  const objectBreak = { id: 'b1', type: 'break', name: '拆整体', ref: { ref: 'nodes.n1.output' } };
  const arrayBreak = { id: 'b3', type: 'break', name: '拆数组', ref: { ref: 'nodes.m1.output' } };
  const scalarBreak = { id: 'b2', type: 'break', name: '拆标量', ref: { ref: 'nodes.n1.output.state' } };
  state.raw.nodes = [detect, matches, objectBreak, arrayBreak, scalarBreak];

  // object 输出：每个顶层字段一个引脚（嵌套的 state.x 之类不铺成引脚）。
  assert.deepEqual(model.breakFieldPins(objectBreak).map((item) => item.field), ['state', 'confidence']);
  assert.equal(model.breakFieldPins(objectBreak)[0].ref, 'nodes.b1.output.state');
  // array 输出：整体 + 第 1 项。
  assert.deepEqual(model.breakFieldPins(arrayBreak).map((item) => item.field), ['', '0']);
  // 拆出来是标量的拆分卡没有引脚（卡片退回一个通用输出口）。
  assert.deepEqual(model.breakFieldPins(scalarBreak), []);
  // 未绑定来源的拆分卡没有输出 schema → 没有引脚。
  assert.deepEqual(model.breakFieldPins({ id: 'b4', type: 'break' }), []);
  // 任务卡/布尔判断卡本来就没有字段引脚。
  assert.deepEqual(model.breakFieldPins(detect), []);
  assert.deepEqual(model.breakFieldPins({ id: 'y', type: 'bool_judge' }), []);
});

test('拆分来源可以是工作流输入/变量：区域 rect 自动拆成 X / Y / W / H 四个引脚', () => {
  const { model, state } = harness();
  state.raw.inputs = { 识别区域: { type: 'rect', default: [720, 973, 486, 107] } };
  state.raw.variables = { 目标点: { type: 'point', default: { x: 1, y: 2 } } };
  const areaBreak = { id: 'b1', type: 'break', name: '拆分区域', ref: { ref: 'inputs.识别区域' } };
  const pointBreak = { id: 'b2', type: 'break', name: '拆分坐标', ref: { ref: 'variables.目标点' } };
  state.raw.nodes = [areaBreak, pointBreak];

  // rect 是定长元组：四个分量各一个引脚（不带「整体」），ref 走下标。
  const pins = model.breakFieldPins(areaBreak);
  assert.deepEqual(pins.map((item) => item.field), ['0', '1', '2', '3']);
  assert.deepEqual(pins.map((item) => item.label), ['X', 'Y', 'W', 'H']);
  assert.deepEqual(pins.map((item) => item.ref), [
    'nodes.b1.output.0', 'nodes.b1.output.1', 'nodes.b1.output.2', 'nodes.b1.output.3',
  ]);
  // point 是对象：按属性拆。
  assert.deepEqual(model.breakFieldPins(pointBreak).map((item) => item.field), ['x', 'y']);
  // 输入/变量按路径取子 schema：拆分来源的候选也认得 rect。
  assert.deepEqual(model.resolveReferenceSchema('inputs.识别区域.2'), { type: 'integer', title: 'W' });
  assert.equal(model.resolveReferenceSchema('inputs.识别区域.9'), undefined, '定长元组越界没有 schema');
  assert.equal(model.resolveReferenceSchema('inputs.不存在'), undefined);
  // 拆出来的分量还能继续作为别的节点的引用候选。
  assert.deepEqual(model.nodeOutputFields(areaBreak).map((item) => item.field), ['0', '1', '2', '3']);
});

test('引用值在卡片上显示成「已绑定」样式和节点名', () => {
  const compact = (value, max = 18) => String(value === undefined ? '' : value).slice(0, max);
  const view = Rows.paramRowValueView({
    param: 'threshold', definition: { type: 'number' }, configured: true,
    value: { ref: 'nodes.n1.output.confidence' },
  }, compact, '识别当前页面状态.置信度');
  assert.equal(view.tone, 'bound');
  assert.equal(view.text, '← 识别当前页面状态.置信度');
  assert.equal(view.title, 'threshold：引用 识别当前页面状态.置信度（nodes.n1.output.confidence）');
  // 没有显示名时回落到引用原文。
  const raw = Rows.paramRowValueView({ param: 'threshold', definition: { type: 'number' }, configured: true, value: { ref: 'nodes.n1.output.confidence' } }, compact);
  assert.equal(raw.tone, 'bound');
  assert.equal(raw.text, '← nodes.n1.output.confidence');
  // 变量绑定仍然是原来的文案。
  const variable = Rows.paramRowValueView({ param: 'threshold', variable: '阈值', scope: 'inputs', definition: { type: 'number' } }, compact);
  assert.equal(variable.text, '← 阈值');
  assert.equal(variable.tone, 'bound');
});
