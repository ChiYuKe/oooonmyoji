const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const editorPath = path.join(__dirname, '../dist-test-renderer/canvas/editor.js');
const source = fs.readFileSync(editorPath, 'utf8');
const { createCanvasPortMenu } = require('../dist-test-renderer/canvas/interactions/port-menu.js');

const MIGRATED_PORT_MENU = new Set([
  'nodeInputPortMenuItems', 'nodeOutputPortMenuItems', 'nodeVariablePinMenuItems',
  'instanceRunPinMenuItems', 'variableCardPortMenuItems', 'insertNodeAbove', 'addChildNode',
  'promotePinToVariable', 'copyVariableReference',
]);
const call = (ctx, name, ...args) => (typeof ctx[name] === 'function' ? ctx[name](...args) : undefined);

/** 迁移期：用编译产物的工厂包装 vm 上下文里的依赖桩，保持测试以裸名调用。 */
function createPortMenuFor(ctx) {
  const state = ctx.state || {raw: null};
  const box = {};
  // 上下文里显式的桩优先；没有桩时回落到模块自身的实现（与旧闭包一致）。
  const fromCtxOr = (name, ...args) => (typeof ctx[name] === 'function' ? ctx[name](...args) : box.menu[name](...args));
  const menu = createCanvasPortMenu({
    state,
    startConnectionFromInput: (...args) => call(ctx, 'startConnectionFromInput', ...args),
    startConnection: (...args) => call(ctx, 'startConnection', ...args),
    startVariableConnectionFromPin: (...args) => call(ctx, 'startVariableConnectionFromPin', ...args),
    startVariableConnectionFromInstanceInput: (...args) => call(ctx, 'startVariableConnectionFromInstanceInput', ...args),
    startVariableConnectionFromCard: (...args) => call(ctx, 'startVariableConnectionFromCard', ...args),
    parentOf: (...args) => call(ctx, 'parentOf', ...args),
    buildNode: (...args) => call(ctx, 'buildNode', ...args),
    canConnect: (...args) => call(ctx, 'canConnect', ...args),
    connect: (...args) => call(ctx, 'connect', ...args) ?? true,
    disconnect: (...args) => call(ctx, 'disconnect', ...args),
    mutate: (fn) => (typeof ctx.mutate === 'function' ? ctx.mutate(fn) : fn()),
    nodeById: (id) => call(ctx, 'nodeById', id),
    position: (node) => call(ctx, 'position', node) || {x: 0, y: 0},
    layout: () => (typeof ctx.layout === 'function' ? ctx.layout() : (state.raw._layout ||= {})),
    nodes: () => (typeof ctx.nodes === 'function' ? ctx.nodes() : (state.raw.nodes || [])),
    nodeVariablePins: (node) => call(ctx, 'nodeVariablePins', node) || [],
    variableCards: () => (typeof ctx.variableCards === 'function' ? ctx.variableCards() : (state.raw._variableCards ||= {})),
    variableLinks: () => (typeof ctx.variableLinks === 'function' ? ctx.variableLinks() : (state.raw._variableLinks ||= {})),
    nextVariableCardId: () => (typeof ctx.nextVariableCardId === 'function' ? ctx.nextVariableCardId() : 'card_1'),
    variableCardList: () => call(ctx, 'variableCardList') || [],
    variableCardPosition: (node, index) => call(ctx, 'variableCardPosition', node, index) || {x: 0, y: 0},
    focusVariableCard: (card) => call(ctx, 'focusVariableCard', card),
    placeVariableCard: (...args) => call(ctx, 'placeVariableCard', ...args),
    disconnectVariableFromPin: (...args) => call(ctx, 'disconnectVariableFromPin', ...args),
    disconnectVariableFromInstanceInput: (...args) => call(ctx, 'disconnectVariableFromInstanceInput', ...args),
    removeVariableCard: (id) => call(ctx, 'removeVariableCard', id),
    insertNodeAbove: (...args) => fromCtxOr('insertNodeAbove', ...args),
    addChildNode: (...args) => fromCtxOr('addChildNode', ...args),
    promotePinToVariable: (...args) => fromCtxOr('promotePinToVariable', ...args),
    copyVariableReference: (...args) => fromCtxOr('copyVariableReference', ...args),
    fieldLabel: (param) => (typeof ctx.fieldLabel === 'function' ? ctx.fieldLabel(param) : param),
    toast: (...args) => call(ctx, 'toast', ...args),
    typeNames: ctx.TYPE_NAMES || {},
    get nodeWidth() { return typeof ctx.NODE_W === 'number' ? ctx.NODE_W : 260; },
    getNavigator: () => ctx.navigator,
  });
  box.menu = menu;
  return menu;
}

/** 与其它渲染层测试一致：按函数名切片执行生产代码，不打开桌面窗口。 */
function extractFunction(src, name) {
  const start = src.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `找不到函数 ${name}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < src.length; index += 1) {
    if (src[index] === '{') depth += 1;
    if (src[index] === '}') depth -= 1;
    if (depth === 0) return src.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 未闭合`);
}

function runFunction(name, context) {
  if (MIGRATED_PORT_MENU.has(name)) return createPortMenuFor(context)[name];
  if (name === 'openPortContextMenu') {
    return require('../dist-test-renderer/canvas/ui/canvas-helpers.js').createCanvasHelpers({
      state: {}, $: () => null, nodes: () => [], worldPoint: (event) => context.worldPoint(event),
      render: () => {}, contextMenuSuppressedByPan: () => context.contextMenuSuppressedByPan(),
      setVariableCardSelection: () => {}, wrap: { getBoundingClientRect: () => ({ width: 0, height: 0 }) },
      variableCardWidth: 168, variableCardHeight: 58,
    }).openPortContextMenu;
  }
  vm.runInContext(extractFunction(source, name), context);
  return context[name];
}

function contextWith(stubs = {}) {
  return vm.createContext({
    mutate: (fn) => fn(),
    worldPoint: (event) => ({ x: event.clientX, y: event.clientY }),
    ...stubs,
  });
}

function fakeEvent(x = 10, y = 20) {
  return {
    clientX: x,
    clientY: y,
    defaultPrevented: false,
    stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

test('openPortContextMenu 阻止冒泡并返回端口世界坐标', () => {
  const context = contextWith({ contextMenuSuppressedByPan: () => false });
  const openPortContextMenu = runFunction('openPortContextMenu', context);
  const event = fakeEvent(12, 34);
  assert.deepEqual(openPortContextMenu(event), { x: 12, y: 34 });
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
});

test('openPortContextMenu 吞掉右键平移结束后的误触', () => {
  const suppressed = { value: false };
  const context = contextWith({ contextMenuSuppressedByPan: () => suppressed.value });
  const openPortContextMenu = runFunction('openPortContextMenu', context);
  suppressed.value = true;
  assert.equal(openPortContextMenu(fakeEvent()), null);
  suppressed.value = false;
  assert.deepEqual(openPortContextMenu(fakeEvent(3, 4)), { x: 3, y: 4 });
});

test('输入端口菜单：连线、断开链接（Break Link），插入节点收进子菜单（Reroute）', () => {
  const calls = [];
  const context = contextWith({
    parentOf: () => ({ node: { id: 'parent_1', name: '父节点' }, index: 0 }),
    startConnectionFromInput: (event, nodeId, point) => calls.push(['input-connect', event, nodeId, point]),
    disconnect: (parentId, childId) => calls.push(['disconnect', parentId, childId]),
    insertNodeAbove: (childId, type) => calls.push(['insert', childId, type]),
  });
  const nodeInputPortMenuItems = runFunction('nodeInputPortMenuItems', context);
  const point = { x: 5, y: 6 };
  const items = nodeInputPortMenuItems('task_1', point);
  assert.equal(items.length, 5);
  assert.equal(items[0].label, '从这里开始连线');
  items[0].run();
  assert.deepEqual(calls[0], ['input-connect', null, 'task_1', point]);
  assert.equal(items[1], 'separator');
  assert.equal(items[2].label, '断开与「父节点」的链接');
  assert.equal(items[2].danger, true);
  items[2].run();
  assert.deepEqual(calls[1], ['disconnect', 'parent_1', 'task_1']);
  assert.equal(items[3], 'separator');
  assert.equal(items[4].label, '在上方插入节点');
  assert.deepEqual(JSON.parse(JSON.stringify(items[4].children.map((child) => child.label))), ['Sequence', 'Selector', 'Simple Parallel', 'Parallel', 'Repeat Until', 'Branch', 'Switch']);
  items[4].children[0].run();
  assert.deepEqual(calls[2], ['insert', 'task_1', 'sequence']);
});

test('输入端口菜单：未连父节点时只有开始连线', () => {
  const context = contextWith({ parentOf: () => null });
  const nodeInputPortMenuItems = runFunction('nodeInputPortMenuItems', context);
  const items = nodeInputPortMenuItems('task_2', { x: 0, y: 0 });
  assert.equal(items.length, 1);
  assert.equal(items[0].label, '从这里开始连线');
});

test('输出端口菜单：连线、断开全部链接（Break All Links），创建节点收进子菜单', () => {
  const calls = [];
  const nodes = { parent_1: { id: 'parent_1', children: ['child_a', 'child_b', 'ghost'] }, child_a: { id: 'child_a' }, child_b: { id: 'child_b' } };
  const context = contextWith({
    nodeById: (id) => nodes[id] || null,
    startConnection: (event, nodeId, point) => calls.push(['output-connect', event, nodeId, point]),
    disconnect: (parentId, childId) => calls.push(['disconnect', parentId, childId]),
    addChildNode: (parentId, type, point) => calls.push(['add-child', parentId, type, point]),
  });
  const nodeOutputPortMenuItems = runFunction('nodeOutputPortMenuItems', context);
  const point = { x: 7, y: 8 };
  const items = nodeOutputPortMenuItems('parent_1', point);
  assert.equal(items.length, 5);
  assert.equal(items[0].label, '从这里开始连线');
  items[0].run();
  assert.deepEqual(calls[0], ['output-connect', null, 'parent_1', point]);
  assert.equal(items[1], 'separator');
  assert.equal(items[2].label, '断开全部子链接（2 条）');
  items[2].run();
  // 只断开仍存在的子节点，每个一次
  assert.deepEqual(calls.slice(1, 3), [['disconnect', 'parent_1', 'child_a'], ['disconnect', 'parent_1', 'child_b']]);
  assert.equal(items[3], 'separator');
  assert.equal(items[4].label, '创建并连接节点');
  assert.deepEqual(JSON.parse(JSON.stringify(items[4].children.map((child) => child.label))), ['Task', 'Sequence', 'Selector', 'Simple Parallel', 'Parallel', 'Repeat Until', 'Branch', 'Switch', 'Instance Parallel']);
  items[4].children[0].run();
  assert.deepEqual(calls[3], ['add-child', 'parent_1', 'task', point]);
});

test('变量端口菜单：未绑定时开始连线或提升为变量（Promote to Variable）', () => {
  const calls = [];
  const context = contextWith({
    variableCardList: () => [],
    startVariableConnectionFromPin: (event, nodeId, param, point) => calls.push(['pin-connect', event, nodeId, param, point]),
    promotePinToVariable: (nodeId, param, pin) => calls.push(['promote', nodeId, param, pin]),
  });
  const nodeVariablePinMenuItems = runFunction('nodeVariablePinMenuItems', context);
  const items = nodeVariablePinMenuItems('task_1', { param: 'template', variable: '', scope: 'inputs' }, { x: 1, y: 2 });
  assert.equal(items.length, 3);
  assert.equal(items[0].label, '从这里开始连线（绑定变量）');
  items[0].run();
  assert.deepEqual(calls[0], ['pin-connect', null, 'task_1', 'template', { x: 1, y: 2 }]);
  assert.equal(items[1], 'separator');
  assert.equal(items[2].label, '提升为变量');
  items[2].run();
  assert.deepEqual(calls[1], ['promote', 'task_1', 'template', { param: 'template', variable: '', scope: 'inputs' }]);
});

test('变量端口菜单：已绑定时可定位、复制或断开链接，嵌套引用定位到顶层卡片', () => {
  const calls = [];
  const context = contextWith({
    variableCardList: () => [{ id: 'card_1', scope: 'inputs', name: 'boss' }],
    focusVariableCard: (card) => calls.push(['focus', card.name]),
    copyVariableReference: (scope, name) => calls.push(['copy', scope, name]),
    disconnectVariableFromPin: (nodeId, param) => calls.push(['unpin', nodeId, param]),
  });
  const nodeVariablePinMenuItems = runFunction('nodeVariablePinMenuItems', context);
  const items = nodeVariablePinMenuItems('task_1', { param: 'hp', variable: 'boss.hp', scope: 'inputs' }, { x: 0, y: 0 });
  assert.equal(items.length, 4);
  assert.equal(items[0].label, '定位到变量卡片');
  items[0].run();
  assert.deepEqual(calls[0], ['focus', 'boss']);
  assert.equal(items[1].label, '复制变量引用');
  items[1].run();
  assert.deepEqual(calls[1], ['copy', 'inputs', 'boss']);
  assert.equal(items[2], 'separator');
  assert.equal(items[3].label, '断开变量链接');
  items[3].run();
  assert.deepEqual(calls[2], ['unpin', 'task_1', 'hp']);
});

test('变量端口菜单：已绑定但没有卡片时提供创建变量卡片（Get）', () => {
  const calls = [];
  const context = contextWith({
    variableCardList: () => [],
    placeVariableCard: (scope, name, point, options) => calls.push(['place-card', scope, name, point, options]),
  });
  const nodeVariablePinMenuItems = runFunction('nodeVariablePinMenuItems', context);
  const items = nodeVariablePinMenuItems('task_1', { param: 'template', variable: 'boss', scope: 'inputs' }, { x: 11, y: 12 });
  assert.equal(items.length, 4);
  assert.equal(items[0].label, '创建变量卡片（Get）');
  items[0].run();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['place-card', 'inputs', 'boss', { x: 11, y: 12 }, { connect: false }]);
});

test('实例运行卡变量端口菜单：绑定与未绑定两种形态', () => {
  const calls = [];
  const context = contextWith({
    variableCardList: () => [{ id: 'card_9', scope: 'variables', name: 'rounds' }],
    focusVariableCard: (card) => calls.push(['focus', card.name]),
    copyVariableReference: (scope, name) => calls.push(['copy', scope, name]),
    disconnectVariableFromInstanceInput: (nodeId, runIndex, param) => calls.push(['unpin-run', nodeId, runIndex, param]),
    startVariableConnectionFromInstanceInput: (event, nodeId, runIndex, param, point) => calls.push(['run-connect', event, nodeId, runIndex, param, point]),
  });
  const instanceRunPinMenuItems = runFunction('instanceRunPinMenuItems', context);

  const card = {
    node: { id: 'inst_1' },
    index: 0,
    run: { inputs: { rounds: { ref: 'variables.rounds' } } },
  };
  const bound = instanceRunPinMenuItems(card, { name: 'rounds' }, { x: 3, y: 4 });
  assert.equal(bound.length, 4);
  assert.equal(bound[0].label, '定位到变量卡片');
  bound[0].run();
  assert.deepEqual(calls[0], ['focus', 'rounds']);
  assert.equal(bound[1].label, '复制变量引用');
  bound[1].run();
  assert.deepEqual(calls[1], ['copy', 'variables', 'rounds']);
  assert.equal(bound[2], 'separator');
  assert.equal(bound[3].label, '断开变量链接');
  bound[3].run();
  assert.deepEqual(calls[2], ['unpin-run', 'inst_1', 0, 'rounds']);

  const unbound = instanceRunPinMenuItems({ node: { id: 'inst_1' }, index: 1, run: { inputs: {} } }, { name: 'count' }, { x: 5, y: 6 });
  assert.equal(unbound.length, 1);
  assert.equal(unbound[0].label, '从这里开始连线（绑定变量）');
  unbound[0].run();
  assert.deepEqual(calls[3], ['run-connect', null, 'inst_1', 1, 'count', { x: 5, y: 6 }]);
});

test('变量卡片输出端口菜单：开始连线、复制引用或删除卡片', () => {
  const calls = [];
  const context = contextWith({
    startVariableConnectionFromCard: (event, scope, name, cardId, point) => calls.push(['card-connect', event, scope, name, cardId, point]),
    copyVariableReference: (scope, name) => calls.push(['copy', scope, name]),
    removeVariableCard: (id) => calls.push(['remove-card', id]),
  });
  const variableCardPortMenuItems = runFunction('variableCardPortMenuItems', context);
  const items = variableCardPortMenuItems({ id: 'card_2', scope: 'inputs', name: 'boss' }, { x: 9, y: 10 });
  assert.equal(items.length, 4);
  assert.equal(items[0].label, '从这里开始连线');
  items[0].run();
  assert.deepEqual(calls[0], ['card-connect', null, 'inputs', 'boss', 'card_2', { x: 9, y: 10 }]);
  assert.equal(items[1].label, '复制变量引用');
  items[1].run();
  assert.deepEqual(calls[1], ['copy', 'inputs', 'boss']);
  assert.equal(items[2], 'separator');
  assert.equal(items[3].label, '删除变量卡片');
  items[3].run();
  assert.deepEqual(calls[2], ['remove-card', 'card_2']);
});

test('在上方插入组合节点：先连父节点再连子节点，位置取父与子的中点', () => {
  const calls = [];
  const nodes = [];
  const layout = {};
  const created = { id: 'sequence_1', type: 'sequence', children: [] };
  const context = contextWith({
    parentOf: (childId) => ({ node: { id: 'parent_1', type: 'selector', children: ['task_1'] }, index: 0 }),
    buildNode: (type) => ({ ...created, type }),
    canConnect: () => null,
    position: (node) => (node.id === 'parent_1' ? { x: 100, y: 100 } : { x: 300, y: 300 }),
    nodeById: (id) => ({ id, type: 'task' }),
    nodes: () => nodes,
    layout: () => layout,
    connect: (parentId, childId) => calls.push(['connect', parentId, childId]),
    toast: (message) => calls.push(['toast', message]),
    TYPE_NAMES: { sequence: '顺序' },
    state: { selected: new Set(), selectedRun: null, inspector: 'node' },
  });
  const insertNodeAbove = runFunction('insertNodeAbove', context);
  insertNodeAbove('task_1', 'sequence');
  assert.deepEqual(calls, [['connect', 'parent_1', 'sequence_1'], ['connect', 'sequence_1', 'task_1'], ['toast', '已在上方插入 顺序']]);
  assert.deepEqual(JSON.parse(JSON.stringify(layout.sequence_1)), { x: 200, y: 176 });
  assert.equal(nodes.length, 1);
});

test('在上方插入组合节点：连接不合法时只提示不修改图', () => {
  const calls = [];
  const context = contextWith({
    parentOf: () => ({ node: { id: 'parent_1', type: 'simple_parallel' }, index: 0 }),
    buildNode: () => ({ id: 'parallel_1', type: 'simple_parallel', children: [] }),
    canConnect: () => 'Simple Parallel 只能连接两个子节点',
    toast: (message) => calls.push(['toast', message]),
  });
  const insertNodeAbove = runFunction('insertNodeAbove', context);
  insertNodeAbove('task_1', 'simple_parallel');
  assert.deepEqual(calls, [['toast', 'Simple Parallel 只能连接两个子节点']]);
});

test('添加子节点：校验通过时入图并连接', () => {
  const calls = [];
  const nodes = [];
  const layout = {};
  const context = contextWith({
    NODE_W: 80,
    buildNode: () => ({ id: 'task_2', type: 'task', children: undefined, action: 'core.log', params: {} }),
    canConnect: () => null,
    nodes: () => nodes,
    layout: () => layout,
    connect: (parentId, childId) => calls.push(['connect', parentId, childId]),
    state: { selected: new Set(), selectedRun: null, inspector: 'node' },
  });
  const addChildNode = runFunction('addChildNode', context);
  addChildNode('sequence_1', 'task', { x: 100, y: 200 });
  assert.equal(nodes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(layout.task_2)), { x: 60, y: 224 });
  assert.deepEqual(calls, [['connect', 'sequence_1', 'task_2']]);
});

test('添加子节点：父节点不接受时提示且不修改图', () => {
  const calls = [];
  const context = contextWith({
    buildNode: () => ({ id: 'task_3', type: 'task' }),
    canConnect: () => 'Task 没有子节点输出',
    toast: (message) => calls.push(['toast', message]),
  });
  const addChildNode = runFunction('addChildNode', context);
  addChildNode('task_1', 'task', { x: 0, y: 0 });
  assert.deepEqual(calls, [['toast', 'Task 没有子节点输出']]);
});

test('提升为变量：把字面量转成输入定义、绑定端口，并创建变量卡片自动连上', () => {
  const node = { id: 'task_1', type: 'task', params: { template: 'assets/a.png' } };
  const calls = [];
  const cards = {};
  const links = {};
  const context = contextWith({
    nodeById: () => node,
    fieldLabel: (name) => ({ template: '模板' }[name] || name),
    variableCards: () => cards,
    variableLinks: () => links,
    nextVariableCardId: () => 'card_new',
    variableCardPosition: () => ({ x: 40, y: 80 }),
    nodeVariablePins: () => [{ param: 'template' }],
    toast: (message) => calls.push(['toast', message]),
    state: { raw: { inputs: {} } },
  });
  const promotePinToVariable = runFunction('promotePinToVariable', context);
  promotePinToVariable('task_1', 'template', { param: 'template', type: 'asset' });
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.raw.inputs.模板)), { type: 'asset', default: 'assets/a.png', display_name: '模板' });
  assert.deepEqual(JSON.parse(JSON.stringify(node.params.template)), { ref: 'inputs.模板' });
  // 画布上生成变量卡片并登记连线
  assert.deepEqual(JSON.parse(JSON.stringify(cards.card_new)), { name: '模板', scope: 'inputs', x: 40, y: 80 });
  assert.equal(links['task_1:template'], 'card_new');
  assert.deepEqual(calls, [['toast', '已创建变量「模板」并连接端口']]);
});

test('提升为变量：数组元素、对象字段与边界一起带过去，变量详情才有结构化控件', () => {
  const node = { id: 'task_9', type: 'task', params: { random_interval: [0.2, 0.6], roi: [10, 20, 30, 40], match: { x: 1, y: 2 } } };
  const context = contextWith({
    nodeById: () => node,
    fieldLabel: (name) => ({ random_interval: '随机间隔（秒）', roi: '识别区域' }[name] || name),
    variableCards: () => ({}),
    variableLinks: () => ({}),
    nextVariableCardId: () => 'card_x',
    variableCardPosition: () => ({ x: 0, y: 0 }),
    nodeVariablePins: () => [],
    toast: () => {},
    state: { raw: { inputs: {} } },
  });
  const promote = runFunction('promotePinToVariable', context);
  promote('task_9', 'random_interval', {
    param: 'random_interval', type: 'array',
    definition: { type: 'array', items: { type: 'duration', min: 0 }, min_items: 2, max_items: 2, default: [0, 0] },
  });
  promote('task_9', 'roi', { param: 'roi', type: 'rect', definition: { type: 'rect' } });
  promote('task_9', 'match', { param: 'match', type: 'object', definition: { type: 'object', required: true } });
  // 随机间隔：变量拿到 items/min_items/max_items，详情栏就能给两个元素输入框。
  // 标签里的全角括号会规范化成下划线（首尾不带）。
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.raw.inputs['随机间隔_秒'])), {
    type: 'array', items: { type: 'duration', min: 0 }, min_items: 2, max_items: 2,
    default: [0.2, 0.6], display_name: '随机间隔（秒）',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.raw.inputs['识别区域'])), {
    type: 'rect', default: [10, 20, 30, 40], display_name: '识别区域',
  });
  // required 这类调用参数不进变量定义；对象本身保留字面量默认值。
  assert.deepEqual(JSON.parse(JSON.stringify(context.state.raw.inputs.match)), { type: 'object', default: { x: 1, y: 2 } });

  // 端口没有字面量时用清单默认值，避免变量卡片空着。
  const fresh = { id: 'task_10', type: 'task', params: {} };
  const freshContext = contextWith({
    nodeById: () => fresh,
    fieldLabel: (name) => name,
    variableCards: () => ({}),
    variableLinks: () => ({}),
    nextVariableCardId: () => 'card_y',
    variableCardPosition: () => ({ x: 0, y: 0 }),
    nodeVariablePins: () => [],
    toast: () => {},
    state: { raw: { inputs: {} } },
  });
  runFunction('promotePinToVariable', freshContext)('task_10', 'random_interval', {
    param: 'random_interval', type: 'array',
    definition: { type: 'array', items: { type: 'duration' }, min_items: 2, max_items: 2, default: [0, 0] },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(freshContext.state.raw.inputs.random_interval)), {
    type: 'array', items: { type: 'duration' }, min_items: 2, max_items: 2, default: [0, 0],
  });
});

test('提升为变量：已绑定端口不允许重复提取，重名时自动编号', () => {
  const node = { id: 'task_2', type: 'task', params: { hp: { ref: 'inputs.boss' } } };
  const calls = [];
  const context = contextWith({
    nodeById: () => node,
    fieldLabel: (name) => name,
    variableCards: () => ({}),
    variableLinks: () => ({}),
    nextVariableCardId: () => 'card_new',
    variableCardPosition: () => ({ x: 0, y: 0 }),
    nodeVariablePins: () => [],
    toast: (message) => calls.push(['toast', message]),
    state: { raw: { inputs: { 模板: { type: 'string' } } } },
  });
  const promotePinToVariable = runFunction('promotePinToVariable', context);
  promotePinToVariable('task_2', 'hp', { param: 'hp', type: 'number' });
  assert.deepEqual(calls, [['toast', '该端口已绑定变量，不能重复提取']]);

  const literal = { id: 'task_3', type: 'task', params: { template: 1 } };
  const cards = {};
  const links = {};
  const second = contextWith({
    nodeById: () => literal,
    fieldLabel: (name) => ({ template: '模板' }[name] || name),
    variableCards: () => cards,
    variableLinks: () => links,
    nextVariableCardId: () => 'card_2',
    variableCardPosition: () => ({ x: 60, y: 120 }),
    nodeVariablePins: () => [{ param: 'template' }],
    toast: () => {},
    state: { raw: { inputs: { 模板: { type: 'string' } } } },
  });
  const promoteAgain = runFunction('promotePinToVariable', second);
  promoteAgain('task_3', 'template', { param: 'template', type: 'integer' });
  assert.deepEqual(JSON.parse(JSON.stringify(second.state.raw.inputs.模板_1)), { type: 'integer', default: 1, display_name: '模板' });
  assert.deepEqual(JSON.parse(JSON.stringify(literal.params.template)), { ref: 'inputs.模板_1' });
  assert.deepEqual(JSON.parse(JSON.stringify(cards.card_2)), { name: '模板_1', scope: 'inputs', x: 60, y: 120 });
  assert.equal(links['task_3:template'], 'card_2');
});

test('复制变量引用：走剪贴板，成功时提示已复制', async () => {
  const calls = [];
  const context = contextWith({
    navigator: { clipboard: { writeText: (text) => { calls.push(['clipboard', text]); return Promise.resolve(); } } },
    toast: (message) => calls.push(['toast', message]),
  });
  const copyVariableReference = runFunction('copyVariableReference', context);
  copyVariableReference('inputs', '模板');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [['clipboard', 'inputs.模板'], ['toast', '已复制 inputs.模板']]);
});

test('复制变量引用：没有剪贴板时直接提示文本', () => {
  const calls = [];
  const context = contextWith({ toast: (message) => calls.push(['toast', message]) });
  const copyVariableReference = runFunction('copyVariableReference', context);
  copyVariableReference('variables', 'count');
  assert.deepEqual(calls, [['toast', '请手动复制：variables.count']]);
});

test('五类端口都接入了右键菜单，UE 交互（常驻搜索、子菜单、打平过滤）全部接线', () => {
  const cardsSource = fs.readFileSync(path.join(__dirname, '../src/canvas/render/cards.ts'), 'utf8');
  const nodeCardSource = fs.readFileSync(path.join(__dirname, '../src/canvas/render/node-card.ts'), 'utf8');
  assert.match(nodeCardSource, /input\.addEventListener\('contextmenu', \(event: any\) => \{\s*const point = openPortContextMenu\(event\);/);
  assert.match(nodeCardSource, /output\.addEventListener\('contextmenu', \(event: any\) => \{\s*const point = openPortContextMenu\(event\);/);
  assert.match(nodeCardSource, /hit\.addEventListener\('contextmenu', \(event: any\) => \{\s*const point = openPortContextMenu\(event\);/);
  assert.match(cardsSource, /port\.addEventListener\('contextmenu', \(event: any\) => \{\s*const point = openPortContextMenu\(event\);/);
  assert.match(nodeCardSource, /showMenu\(event\.clientX, event\.clientY, nodeInputPortMenuItems\(node\.id, point\)\)/);
  assert.match(nodeCardSource, /showMenu\(event\.clientX, event\.clientY, nodeOutputPortMenuItems\(node\.id, point\)\)/);
  assert.match(nodeCardSource, /showMenu\(event\.clientX, event\.clientY, nodeVariablePinMenuItems\(node\.id, pin, point\)\)/);
  assert.match(cardsSource, /showMenu\(event\.clientX, event\.clientY, instanceRunPinMenuItems\(card, variable, point\)\)/);
  assert.match(cardsSource, /showMenu\(event\.clientX, event\.clientY, variableCardPortMenuItems\(card, point\)\)/);
  const portMenuSource = fs.readFileSync(path.join(__dirname, '../src/canvas/interactions/port-menu.ts'), 'utf8');
  assert.match(portMenuSource, /function insertNodeAbove\(childId: string, type: string\)/);
  assert.match(portMenuSource, /function addChildNode\(parentId: string, type: string, point: PortPoint\)/);
  assert.match(portMenuSource, /function promotePinToVariable\(nodeId: string, param: string, pin: PortPin\)/);
  assert.match(portMenuSource, /function copyVariableReferenceDefault\(scope: string, name: string\)/);
  // UE 风格：搜索框常驻顶部（菜单浮层已迁到 src/canvas/ui/overlays.ts）
  const overlaysSource = fs.readFileSync(path.join(__dirname, '../src/canvas/ui/overlays.ts'), 'utf8');
  assert.match(overlaysSource, /const search = document\.createElement\('input'\);/);
  assert.match(overlaysSource, /search\.placeholder = '搜索操作…'/);
  // UE 风格：子菜单 + 搜索时打平子菜单
  assert.match(overlaysSource, /button\.classList\.add\('has-submenu'\)/);
  assert.match(overlaysSource, /chevron\.className = 'menu-chevron'/);
  assert.match(overlaysSource, /el\('div', 'context-menu context-menu-sub'\)/);
  assert.match(overlaysSource, /if \(item\.children && item\.children\.length\) \{ for \(const child of item\.children\) walk\(child\); return; \}/);
  // UE 风格：端口菜单提供创建变量卡片（Get）
  assert.match(portMenuSource, /创建变量卡片（Get）/);
  // 提升为变量：创建输入定义 + 绑定端口 + 画布变量卡片自动连线
  assert.match(portMenuSource, /variableCards\(\)\[cardId\] = \{ name, scope: 'inputs', x: at\.x, y: at\.y \};/);
  assert.match(portMenuSource, /variableLinks\(\)\[`\$\{nodeId\}:\$\{param\}`\] = cardId;/);
  // UE 风格：普通节点卡片右键也有节点菜单（复制/剪切/删除）
  assert.match(nodeCardSource, /\{ label: '删除节点', danger: true, run: \(\) => deleteSelection\(\) \},\n        \]\);\n      \}\);\n    \}/);
  assert.equal((nodeCardSource.match(/删除节点', danger: true/g) || []).length, 2); // 子流程节点 + 普通节点
  // UE 行为：菜单外的按下/右键会收起当前菜单（避免旧菜单盖住端口导致无法再次右键），菜单空白处右键也收起并抑制原生菜单
  assert.match(source, /document\.addEventListener\('mousedown', \(event\) => \{\s*if \(event\.target instanceof Element && event\.target\.closest\('\.context-menu'\)\)\s*return;\s*hideMenus\(\);\s*\}, true\)/);
  assert.match(source, /document\.addEventListener\('contextmenu', \(event\) => \{\s*const target = event\.target instanceof Element \? event\.target : null;\s*const inMenu = target\?\.closest\('\.context-menu'\);/);
  assert.match(source, /if \(!target\?\.closest\('\.context-menu button'\)\)\s*hideMenus\(\);/);
});
