// Run via npm test (builds the renderer test output first).
// 连线生命周期与变量连接命令：普通连线、指针捕获、变量绑定/解绑验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createCanvasCommands } = require('../dist-test-renderer/canvas/state/commands.js');
const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
const { createCanvasConnections } = require('../dist-test-renderer/canvas/interactions/connections.js');

function harness(raw, options = {}) {
  const state = createCanvasState();
  state.raw = raw;
  const model = createWorkflowModel(state);
  const calls = {rendered: 0, toasts: [], mutated: 0, captured: [], released: [], emptyDrops: []};
  const history = createEditorHistory({
    state,
    cleanupReleased: () => [],
    clearVariableCardSelection: () => {},
    nodeById: model.nodeById,
    normalizeRaw: (value) => value,
    setDirty: () => {},
    render: () => { calls.rendered += 1; },
  });
  const commands = createCanvasCommands({
    state,
    nodes: model.nodes,
    nodeById: model.nodeById,
    layout: model.layout,
    mutate: history.mutate,
    clone: (value) => JSON.parse(JSON.stringify(value)),
    toast: (message, error) => calls.toasts.push([message, Boolean(error)]),
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    wrap: {clientWidth: 0, clientHeight: 0},
    nodeWidth: 260,
    baseHeight: 96,
  });
  const connections = createCanvasConnections({
    state,
    graph: {
      setPointerCapture: (id) => calls.captured.push(id),
      releasePointerCapture: (id) => calls.released.push(id),
    },
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    render: () => { calls.rendered += 1; },
    snapshot: history.snapshot,
    mutate: (fn) => { calls.mutated += 1; history.mutate(fn); },
    connect: commands.connect,
    disconnect: commands.disconnect,
    variableConnectionTargetAt: () => options.variableTarget ? options.variableTarget() : null,
    nodeById: model.nodeById,
    instanceRunCards: () => options.runCards || [],
    variableCompatibleWithPin: () => options.compatiblePin !== false,
    variableCompatibleWithInstanceInput: () => options.compatibleInstance !== false,
    variableLinks: model.variableLinks,
    displayNameOfDefinition: model.displayNameOfDefinition,
    variableDisplayNameOf: model.variableDisplayNameOf,
    referenceConnectionTargetAt: () => options.referenceTarget ? options.referenceTarget() : null,
    referenceMissAt: () => options.referenceMiss || null,
    showMenu: options.showMenu,
    fieldLabel: (name) => name,
    referenceFieldsForPin: options.referenceFieldsForPin,
    // 拆分卡字段引脚定向绑定：按候选把 field 解析成 ref。
    nodeOutputFields: (node) => (options.nodeOutputFields ? options.nodeOutputFields(node) : []),
    toast: (message, error) => calls.toasts.push([message, Boolean(error)]),
    onEmptyVariableDrop: options.onEmptyVariableDrop
      ? (connection, point) => { calls.emptyDrops.push([connection, point]); return options.onEmptyVariableDrop(connection, point); }
      : undefined,
  });
  return {state, model, commands, connections, calls};
}

const event = (extra = {}) => ({button: 0, pointerId: 3, clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {}, ...extra});

test('startConnection 记录起点并清空边选中，按钮非左键忽略', () => {
  const h = harness({nodes: [{id: 'a'}, {id: 'b'}], _layout: {a: {x: 0, y: 0}, b: {x: 0, y: 200}}});
  h.state.selectedEdge = {parent: 'a', child: 'b'};
  h.connections.startConnection(event(), 'a');
  assert.equal(h.state.connect.direction, 'from-output');
  assert.equal(h.state.connect.parent, 'a');
  assert.equal(h.state.selectedEdge, null);
  assert.deepEqual(h.calls.captured, [3]);
  assert.equal(h.calls.rendered, 1);

  h.connections.startConnection(event({button: 2}), 'b');
  assert.equal(h.state.connect.parent, 'a');
});

test('cancelConnection 释放指针并清空连线状态', () => {
  const h = harness({nodes: [{id: 'a'}]});
  h.connections.startConnection(event(), 'a');
  h.connections.cancelConnection();
  assert.equal(h.state.connect, null);
  assert.deepEqual(h.calls.released, [3]);
});

test('finishConnection 重连时把子节点从旧父节点移入新父节点', () => {
  const h = harness({nodes: [
    {id: 'root', type: 'root', children: ['seq1']},
    {id: 'seq1', type: 'sequence', children: ['a', 'b']},
    {id: 'seq2', type: 'sequence', children: ['c']},
    {id: 'a', type: 'task'},
    {id: 'b', type: 'task'},
    {id: 'c', type: 'task'},
  ], _layout: {}});
  h.connections.startConnection(event(), 'seq1');
  h.state.connect.oldChild = 'b';
  h.state.connect.oldIndex = 1;
  h.connections.finishConnection(event(), 'c');
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'seq1').children, ['a', 'c']);
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'seq2').children, []);
  assert.deepEqual(h.calls.toasts, []);
});

test('finishConnection from-input 反向连接父节点', () => {
  const h = harness({nodes: [
    {id: 'root', type: 'root', children: []},
    {id: 'a', type: 'task'},
  ]});
  h.connections.startConnectionFromInput(event(), 'a');
  h.connections.finishConnection(event(), 'root');
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'root').children, ['a']);
  assert.equal(h.state.connect, null);
});

test('变量绑定参数端点：写入 ref、连线映射与提示，不兼容给出错误', () => {
  const h = harness({nodes: [{id: 'n', type: 'task', params: {}}], inputs: {模板: {type: 'asset'}}, _layout: {n: {x: 0, y: 0}}});
  h.connections.connectVariableToPin('inputs', '模板', 'n', 'template', 'card_1');
  assert.deepEqual(h.state.raw.nodes[0].params.template, {ref: 'inputs.模板'});
  assert.equal(h.state.raw._variableLinks['n:template'], 'card_1');
  assert.deepEqual(h.calls.toasts.at(-1), ['参数 template ← 变量 模板', false]);

  h.connections.disconnectVariableFromPin('n', 'template');
  assert.equal(Object.prototype.hasOwnProperty.call(h.state.raw.nodes[0].params, 'template'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(h.state.raw._variableLinks, 'n:template'), false);

  const bad = harness({nodes: [{id: 'n', type: 'task', params: {}}], inputs: {模板: {type: 'asset'}}, _layout: {n: {x: 0, y: 0}}}, {compatiblePin: false});
  bad.connections.connectVariableToPin('inputs', '模板', 'n', 'template');
  assert.deepEqual(bad.calls.toasts.at(-1)[1], true);
  assert.deepEqual(bad.state.raw.nodes[0].params, {});
});

test('判断节点 bool 变量端口：写入 expression，断开恢复默认条件', () => {
  const h = harness({
    nodes: [{id: 'judge', type: 'condition', expression: {eq: [1, 1]}}],
    inputs: {启用: {type: 'boolean'}},
    _layout: {judge: {x: 0, y: 0}},
  });
  h.connections.connectVariableToPin('inputs', '启用', 'judge', 'condition', 'card_bool');
  assert.deepEqual(h.state.raw.nodes[0].expression, {ref: 'inputs.启用'});
  assert.equal(h.state.raw._variableLinks['judge:condition'], 'card_bool');
  h.connections.disconnectVariableFromPin('judge', 'condition');
  assert.deepEqual(h.state.raw.nodes[0].expression, {eq: [1, 1]});
  assert.equal(h.state.raw._variableLinks['judge:condition'], undefined);
});

test('布尔判断卡片：整卡绑定形态只有一个布尔口，嵌套形态没有可写的操作数', () => {
  const h = harness({
    nodes: [
      {id: 'bool_ref', type: 'bool_judge', expression: {ref: 'variables.旧来源'}},
      {id: 'bool_and', type: 'bool_judge', expression: {and: [{eq: [1, 1]}, {gt: [2, 1]}]}},
    ],
    inputs: {运行中: {type: 'boolean'}},
    variables: {旧来源: {type: 'boolean'}},
    _layout: {bool_ref: {x: 0, y: 0}, bool_and: {x: 0, y: 200}},
  }, {referenceFieldsForPin: () => [{field: 'value', label: '布尔值', schema: {type: 'boolean'}, ref: 'nodes.bool_ref.output.value'}]});

  // 整卡绑定形态换一个 bool 来源：表达式整体换成 `{ref}`（不是往不存在的操作数里塞值）。
  h.connections.connectVariableToPin('inputs', '运行中', 'bool_ref', 'condition', 'card_1');
  assert.deepEqual(h.state.raw.nodes[0].expression, {ref: 'inputs.运行中'});
  assert.deepEqual(h.state.raw.nodes[0], {id: 'bool_ref', type: 'bool_judge', expression: {ref: 'inputs.运行中'}}, '不生成 params');
  // 断开 = 回到出厂比较表达式（与判断节点的布尔口同一套语义）。
  h.connections.disconnectVariableFromPin('bool_ref', 'condition');
  assert.deepEqual(h.state.raw.nodes[0].expression, {eq: [1, 1]});

  // 比较形态被写布尔口 = 转成整卡绑定形态（卡面此刻没画这个口，防的是过期拖拽/旧调用方）。
  h.connections.connectVariableToPin('inputs', '运行中', 'bool_ref', 'condition', 'card_1');
  assert.deepEqual(h.state.raw.nodes[0].expression, {ref: 'inputs.运行中'});
  // 节点输出引用同样整体替换表达式。
  h.connections.connectReferenceToPin('bool_ref', 'nodes.bool_ref.output.value', '布尔值', 'bool_ref', 'condition');
  assert.deepEqual(h.state.raw.nodes[0].expression, {ref: 'nodes.bool_ref.output.value'});
  h.connections.disconnectReferenceFromPin('bool_ref', 'condition');
  assert.deepEqual(h.state.raw.nodes[0].expression, {eq: [1, 1]});

  // 嵌套条件卡没有操作数引脚：过期的拖拽落到 left/right 上不许改坏表达式。
  const before = JSON.parse(JSON.stringify(h.state.raw.nodes[1].expression));
  h.connections.connectVariableToPin('inputs', '运行中', 'bool_and', 'left', 'card_2');
  h.connections.connectReferenceToPin('bool_ref', 'nodes.bool_ref.output.value', '布尔值', 'bool_and', 'right');
  assert.deepEqual(h.state.raw.nodes[1].expression, before, '嵌套表达式保持原样');
});

test('判断节点 bool 端口拒绝不兼容变量', () => {
  const h = harness({
    nodes: [{id: 'judge', type: 'condition', expression: {eq: [1, 1]}}],
    inputs: {计数: {type: 'integer'}},
    _layout: {judge: {x: 0, y: 0}},
  }, {compatiblePin: false});
  h.connections.connectVariableToPin('inputs', '计数', 'judge', 'condition');
  assert.deepEqual(h.state.raw.nodes[0].expression, {eq: [1, 1]});
  assert.equal(h.calls.toasts.at(-1)[1], true);
});

test('布尔判断卡片：左右输入分别写回表达式，输出引用可挂到判断节点的布尔口', () => {
  const h = harness({
    nodes: [
      {id: 'bool_1', type: 'bool_judge', expression: {eq: [1, 1]}},
      {id: 'judge', type: 'condition', expression: {eq: [1, 1]}},
    ],
    inputs: {当前值: {type: 'string'}, 目标值: {type: 'string'}, 启用: {type: 'boolean'}},
    _layout: {bool_1: {x: 0, y: 0}, judge: {x: 0, y: 200}},
  }, {referenceFieldsForPin: () => [{field: 'value', label: '布尔值', ref: 'nodes.bool_1.output.value'}]});

  // 变量分别写入比较表达式的左右操作数。
  h.connections.connectVariableToPin('inputs', '当前值', 'bool_1', 'left', 'card_left');
  h.connections.connectVariableToPin('inputs', '目标值', 'bool_1', 'right', 'card_right');
  assert.deepEqual(h.state.raw.nodes[0].expression, {eq: [{ref: 'inputs.当前值'}, {ref: 'inputs.目标值'}]});
  assert.equal(h.state.raw._variableLinks['bool_1:left'], 'card_left');
  assert.equal(h.state.raw._variableLinks['bool_1:right'], 'card_right');
  h.connections.disconnectVariableFromPin('bool_1', 'left');
  assert.deepEqual(h.state.raw.nodes[0].expression, {eq: ['', {ref: 'inputs.目标值'}]});

  // 布尔判断卡片的输出引用 → 判断节点的布尔条件口（引用源可以是卡片）。
  h.connections.connectReferenceToPin('bool_1', 'nodes.bool_1.output.value', '布尔值', 'judge', 'condition');
  assert.deepEqual(h.state.raw.nodes[1].expression, {ref: 'nodes.bool_1.output.value'});
  h.connections.disconnectReferenceFromPin('judge', 'condition');
  assert.deepEqual(h.state.raw.nodes[1].expression, {eq: [1, 1]});
});

test('condition 的 bool 口只接受 boolean 引用，bool_judge 左右 operand 接受比较值引用', () => {
  const h = harness({
    nodes: [
      {id: 'judge', type: 'condition', expression: {eq: [1, 1]}},
      {id: 'bool_1', type: 'bool_judge', expression: {eq: [1, 1]}},
      {id: 'task_1', type: 'task', action: 'vision.match_template'},
    ],
    _layout: {judge: {x: 0, y: 0}, bool_1: {x: 0, y: 200}, task_1: {x: 0, y: 400}},
  }, {referenceFieldsForPin: (_source, targetNode) => targetNode.type === 'condition'
    ? []
    : [{field: 'count', label: '计数', schema: {type: 'integer'}, ref: 'nodes.task_1.output.count'}]});

  // condition.condition 仍然是严格 boolean 输入。
  h.connections.connectReferenceToPin('task_1', 'nodes.task_1.output.count', '计数', 'judge', 'condition');
  assert.deepEqual(h.state.raw.nodes[0].expression, {eq: [1, 1]});
  assert.equal(h.calls.toasts.at(-1)[1], true);

  // bool_judge.left/right 是比较表达式 operand，可以分别接入非 boolean 输出。
  h.connections.connectReferenceToPin('task_1', 'nodes.task_1.output.count', '计数', 'bool_1', 'left');
  h.connections.connectReferenceToPin('task_1', 'nodes.task_1.output.count', '计数', 'bool_1', 'right');
  assert.deepEqual(h.state.raw.nodes[1].expression, {
    eq: [
      {ref: 'nodes.task_1.output.count'},
      {ref: 'nodes.task_1.output.count'},
    ],
  });
});

test('拆分卡片：来源绑定写在顶层 ref 字段上，断开时整体移除', () => {
  const h = harness({
    nodes: [
      {id: 'task_1', type: 'task', action: 'vision.match_template'},
      {id: 'break_1', type: 'break'},
    ],
    inputs: {计数: {type: 'integer'}},
    _layout: {task_1: {x: 0, y: 0}, break_1: {x: 0, y: 200}},
  });

  // 节点输出引用 → 拆分来源行：写入顶层 ref（不是 params）。
  h.connections.connectReferenceToPin('task_1', 'nodes.task_1.output.0', '第 1 项', 'break_1', 'ref');
  assert.deepEqual(h.state.raw.nodes[1].ref, {ref: 'nodes.task_1.output.0'});
  assert.equal(h.state.raw.nodes[1].params, undefined);
  h.connections.disconnectReferenceFromPin('break_1', 'ref');
  assert.equal(h.state.raw.nodes[1].ref, undefined);

  // 变量也能作为拆分来源（运行时引用语法同样支持）。
  h.connections.connectVariableToPin('inputs', '计数', 'break_1', 'ref', 'card_x');
  assert.deepEqual(h.state.raw.nodes[1].ref, {ref: 'inputs.计数'});
  assert.equal(h.state.raw._variableLinks['break_1:ref'], 'card_x');
  h.connections.disconnectVariableFromPin('break_1', 'ref');
  assert.equal(h.state.raw.nodes[1].ref, undefined);
  assert.equal(h.state.raw._variableLinks['break_1:ref'], undefined);
});

test('拆分卡字段引脚起拖：落点按该字段定向绑定，不再弹字段菜单', () => {
  const target = {kind: 'pin', nodeId: 'use_1', param: 'value', x: 0, y: 0, fields: [
    {field: 'matched', label: '已匹配', ref: 'nodes.break_1.output.matched'},
    {field: 'top_score', label: '最高分', ref: 'nodes.break_1.output.top_score'},
  ]};
  const menus = [];
  const h = harness({
    nodes: [
      {id: 'break_1', type: 'break', ref: {ref: 'nodes.wait_1.output'}},
      {id: 'use_1', type: 'task', action: 'test.consume', params: {}},
    ],
    _layout: {break_1: {x: 0, y: 0}, use_1: {x: 0, y: 200}},
  }, {
    referenceTarget: () => target,
    showMenu: (x, y, items) => menus.push(items),
    nodeOutputFields: (node) => (node.id === 'break_1' ? [
      {field: '', label: '输出', ref: 'nodes.break_1.output'},
      {field: 'matched', label: '已匹配', ref: 'nodes.break_1.output.matched'},
      {field: 'top_score', label: '最高分', ref: 'nodes.break_1.output.top_score'},
    ] : []),
  });
  // 从「已匹配」字段引脚起拖 → 落点直接写这一个引用。
  h.connections.startReferenceConnection(event(), 'break_1', undefined, 'matched');
  h.connections.finishReferenceConnection(event());
  assert.deepEqual(h.state.raw.nodes[1].params.value, {ref: 'nodes.break_1.output.matched'});
  assert.equal(menus.length, 0, '字段已定，不应该再弹字段菜单');

  // 「整体输出」引脚（field 为空串）同样定向绑定，而不是被当成「没带字段」退回菜单。
  h.connections.startReferenceConnection(event(), 'break_1', undefined, '');
  h.connections.finishReferenceConnection(event());
  assert.deepEqual(h.state.raw.nodes[1].params.value, {ref: 'nodes.break_1.output'});
  assert.equal(menus.length, 0, '整体输出引脚也不弹菜单');

  // 通用输出口起拖（没有字段）时仍旧弹菜单让用户挑。
  h.connections.startReferenceConnection(event(), 'break_1');
  h.connections.finishReferenceConnection(event());
  assert.equal(menus.length, 1, '通用输出口保留字段选择菜单');
});

test('变量绑定实例子输入：写入 runs inputs 与映射，断开清理', () => {
  const run = {instance: 'mumu-0', inputs: {}};
  const card = {node: {id: 'p', type: 'task', runs: [run]}, index: 0, x: 0, y: 0, run, variables: [{name: 'input_id', definition: {type: 'number'}}]};
  const h = harness({nodes: [{id: 'p', type: 'task', runs: [run]}], variables: {计数: {type: 'number', default: 0}}, _layout: {p: {x: 0, y: 0}}}, {runCards: [card]});
  h.connections.connectVariableToInstanceInput('variables', '计数', 'p', 0, 'input_id', 'card_1');
  assert.deepEqual(run.inputs.input_id, {ref: 'variables.计数'});
  assert.equal(h.state.raw._variableLinks['p:runs.0.inputs.input_id'], 'card_1');
  h.connections.disconnectVariableFromInstanceInput('p', 0, 'input_id');
  assert.deepEqual(run.inputs, {});
  assert.equal(h.state.raw._variableLinks['p:runs.0.inputs.input_id'], undefined);
});

test('finishVariableConnection 按方向路由到目标并处理无目标', () => {
  const run = {instance: 'mumu-0', inputs: {}};
  const card = {node: {id: 'p', type: 'task', runs: [run]}, index: 0, x: 0, y: 0, run, variables: [{name: 'input_id', definition: {type: 'number'}}]};
  const pinTarget = {kind: 'pin', nodeId: 'n', param: 'template', x: 0, y: 0};
  const h = harness({nodes: [{id: 'n', type: 'task', params: {}}, {id: 'p', type: 'task', runs: [run]}], inputs: {模板: {type: 'asset'}}, _layout: {n: {x: 0, y: 0}, p: {x: 0, y: 0}}}, {
    runCards: [card],
    variableTarget: () => pinTarget,
  });
  h.connections.startVariableConnectionFromCard(event(), 'inputs', '模板', 'card_1');
  h.connections.finishVariableConnection(event());
  assert.deepEqual(h.state.raw.nodes[0].params.template, {ref: 'inputs.模板'});

  const noTarget = harness({nodes: []});
  noTarget.connections.startVariableConnectionFromPin(event(), 'x', 'p');
  noTarget.connections.finishVariableConnection(event());
  assert.equal(noTarget.state.variableConnect, null);
  assert.equal(noTarget.calls.rendered > 0, true);
});

test('变量线拖到空白处把原连接与落点交给自动创建入口', () => {
  const h = harness({nodes: [{id: 'n', type: 'task', params: {}}]}, {
    onEmptyVariableDrop: () => true,
  });
  h.connections.startVariableConnectionFromPin(event(), 'n', 'template');
  h.connections.finishVariableConnection(event({clientX: 320, clientY: 180}));
  assert.equal(h.state.variableConnect, null);
  assert.equal(h.calls.emptyDrops.length, 1);
  assert.equal(h.calls.emptyDrops[0][0].direction, 'from-pin');
  assert.equal(h.calls.emptyDrops[0][0].nodeId, 'n');
  assert.equal(h.calls.emptyDrops[0][0].param, 'template');
  assert.deepEqual(h.calls.emptyDrops[0][1], {x: 320, y: 180});
  assert.deepEqual(h.calls.released, [3]);
});
