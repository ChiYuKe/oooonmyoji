// Run via npm test (builds the renderer test output first).
// 渲染入口的浮层契约：框选矩形（.marquee）必须随拖拽出现、更新、并在抬起后消失。
//
// 这里用最小 DOM 替身而不是真实 DOM：断言的是「元素被创建/更新/移除」这一结构契约。
// 框选矩形在改造中从「每帧随整张画布重建」改成了持久浮层，很容易在重构里丢掉，
// 所以单独用真实 createRenderEntry 接线来守住它。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createRenderEntry } = require('../dist-test-renderer/canvas/render/render-entry.js');
const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
const { createEditorCommands } = require('../dist-test-renderer/canvas/state/editor-commands.js');

function fakeElement(tag, attrs = {}) {
  const element = {
    tag,
    attrs: {...attrs},
    children: [],
    parent: null,
    dataset: {},
    textContent: '',
    setAttribute(name, value) { this.attrs[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parent = null; },
    replaceChildren(...nodes) { for (const child of [...this.children]) this.removeChild(child); for (const node of nodes) this.appendChild(node); },
    remove() { if (this.parent) this.parent.removeChild(this); },
  };
  Object.defineProperty(element, 'isConnected', { get() { return Boolean(this.parent); } });
  return element;
}

function harness(options = {}) {
  const state = createCanvasState();
  const previewCalls = {connection: 0, variable: 0, reference: 0};
  state.raw = options.raw ?? {
    root: 'root',
    nodes: [
      {id: 'root', type: 'root', children: ['a']},
      {id: 'a', type: 'task', action: 'core.log', params: {message: 'x'}},
    ],
    inputs: {}, variables: {},
    _layout: {root: {x: 0, y: 0}, a: {x: 0, y: 300}},
  };
  const model = createWorkflowModel(state);
  const graph = fakeElement('svg');

  const entry = createRenderEntry({
    state,
    $: () => fakeElement('div'),
    graph,
    wrap: graph,
    // 视口尺寸缓存替身：默认 0×0（与没有 DOM 测量能力时的兜底一致），
    // 需要真实裁剪范围（例如验证「拖进画布的卡片可见」）时由调用方给出尺寸。
    measurement: options.measurement ?? {read: () => ({width: 0, height: 0, left: 0, top: 0})},
    svgEl: (tag, attrs, parent) => { const node = fakeElement(tag, attrs); if (parent) parent.appendChild(node); return node; },
    UI: {closeDropdowns() {}},
    nodes: model.nodes,
    nodeById: model.nodeById,
    position: model.position,
    nodeHeight: () => 96,
    nodeRowHeight: () => 24,
    nodeVariablePins: () => [],
    instanceRunCards: () => [],
    variableCardList: model.variableCardList,
    renderNode: (layer, node) => { const group = fakeElement('g', {class: 'node studio-card'}); group.dataset.id = node.id; layer.appendChild(group); return group; },
    renderInstanceRunCard: () => {},
    renderVariableCard: (layer, card) => {
      const group = fakeElement('g', {class: 'variable-card', transform: `translate(${card.x},${card.y})`});
      group.dataset.variable = card.name;
      layer.appendChild(group);
      return group;
    },
    renderEdge: (layer) => fakeElement('g', {class: 'edge'}, layer) && layer.children[layer.children.length - 1],
    renderInstanceRunEdge: () => {},
    renderConnection: (layer) => {
      previewCalls.connection += 1;
      layer.appendChild(fakeElement('path', {class: 'connection-preview'}));
    },
    renderVariableConnection: (layer) => {
      previewCalls.variable += 1;
      layer.appendChild(fakeElement('path', {class: 'variable-connection-preview'}));
    },
    renderReferenceConnection: (layer) => {
      previewCalls.reference += 1;
      layer.appendChild(fakeElement('path', {class: 'reference-connection-preview'}));
    },
    renderReferenceEdges: () => {},
    renderVariableEdges: () => {},
    renderMinimap: () => {},
    renderInspector: () => {},
    postSidebarState: () => {},
    updateIssueBadge: () => {},
    nodeIssueInfo: options.nodeIssueInfo,
    ensureLayout: () => {},
    syncLegacyInputParameters: () => false,
    syncLegacyVariableCards: () => false,
    setDirty: () => {},
    nodeWidth: 260,
    variableCardWidth: 168,
    variableCardHeight: 58,
    runCardWidth: 250,
    runCardBaseHeight: 78,
    // 额外注入点：用来复现/守住「外部位置函数不得影响变量卡片裁剪」这类接线事故。
    ...(options.entryDeps ?? {}),
  });

  const marquees = () => entry.controller.getLayer().overlays.children.filter((child) => child.attrs.class === 'marquee');
  const cards = () => entry.controller.getLayer().cards.children.filter((child) => child.attrs.class?.includes('studio-card'));
  const variableCards = () => entry.controller.getLayer().variableCards.children
    .filter((child) => String(child.attrs.class || '').includes('variable-card'));
  return {state, entry, graph, marquees, cards, variableCards, model, previewCalls};
}

test('空的节点错误信息不会给全部卡片加粉色错误描边', () => {
  const h = harness({nodeIssueInfo: () => ({node: [], params: new Map()})});
  h.entry.render({full: true});
  h.entry.render({selection: true});
  assert(h.cards().length > 0);
  assert(h.cards().every((card) => !card.attrs.class.includes('node-invalid')));

  const invalid = harness({nodeIssueInfo: () => ({node: [{message: '错误'}], params: new Map()})});
  invalid.entry.render({full: true});
  invalid.entry.render({selection: true});
  assert(invalid.cards().length > 0);
  assert(invalid.cards().every((card) => card.attrs.class.includes('node-invalid')));
});

test('框选：拖拽时出现并随之更新，抬起后消失', () => {
  const h = harness();
  h.entry.render({full: true});
  assert.equal(h.marquees().length, 0, '未框选时不应有框选矩形');

  // 按下：pointer.ts 会先置 marquee 再走「视口 + 交互」重绘。
  h.state.marquee = {x1: 100, y1: 50, x2: 100, y2: 50, additive: false};
  h.state.drag = {kind: 'marquee'};
  h.entry.render({viewport: true, interaction: true});
  const created = h.marquees();
  assert.equal(created.length, 1, '按下后必须出现框选矩形');
  // 创建时属性直接写入，后续更新走 setAttribute（字符串），统一按字符串比较。
  assert.equal(String(created[0].attrs.x), '100');
  assert.equal(String(created[0].attrs.y), '50');
  assert.equal(String(created[0].attrs.width), '0');
  assert.equal(String(created[0].attrs.height), '0');

  // 移动：矩形就地更新，不重建、不叠加。
  h.state.marquee.x2 = 420;
  h.state.marquee.y2 = 310;
  h.entry.render({viewport: true, interaction: true});
  const moved = h.marquees();
  assert.equal(moved.length, 1, '拖拽中不应出现第二个框选矩形');
  assert.equal(moved[0], created[0], '拖拽中应复用同一个元素');
  assert.equal(String(moved[0].attrs.width), '320');
  assert.equal(String(moved[0].attrs.height), '260');

  // 反向拖拽：使用 min/abs，宽高必须为正。
  h.state.marquee.x2 = 40;
  h.state.marquee.y2 = 10;
  h.entry.render({viewport: true, interaction: true});
  const reversed = h.marquees()[0];
  assert.equal(String(reversed.attrs.x), '40');
  assert.equal(String(reversed.attrs.y), '10');
  assert.equal(String(reversed.attrs.width), '60');
  assert.equal(String(reversed.attrs.height), '40');

  // 抬起：pointer.ts 清掉 marquee，重绘后浮层里不应再有框选矩形。
  h.state.marquee = null;
  h.state.drag = null;
  h.entry.render({viewport: true, interaction: true, selection: true});
  assert.equal(h.marquees().length, 0, '抬起后框选矩形必须被移除');
});

test('框选矩形挂在浮层里，且浮层在卡片之上', () => {
  const h = harness();
  h.entry.render({full: true});
  const root = h.entry.controller.getLayer().root;
  const order = root.children.map((child) => child.attrs.class);
  assert.deepEqual(order, ['wires', 'variable-edges', 'reference-edges', 'cards', 'variable-cards', 'previews', 'overlays'],
    '预览层在卡片之上、浮层之下；浮层层必须在最后创建，框选矩形才不会被卡片盖住');

  h.state.marquee = {x1: 0, y1: 0, x2: 10, y2: 10, additive: false};
  h.entry.render({viewport: true, interaction: true});
  const marquee = h.marquees()[0];
  assert.equal(marquee.parent, h.entry.controller.getLayer().overlays, '框选矩形必须挂在浮层里');
  assert.ok(order.indexOf('overlays') === order.length - 1, '浮层保持在最后');
});

test('框选不影响卡片：拖拽帧不重建卡片、不整层重建', () => {
  const h = harness();
  h.entry.render({full: true});
  const fullRebuilds = h.entry.stats().fullRebuilds;
  h.state.marquee = {x1: 0, y1: 0, x2: 0, y2: 0, additive: false};
  h.state.drag = {kind: 'marquee'};
  for (let step = 1; step <= 5; step += 1) {
    h.state.marquee.x2 = step * 60;
    h.state.marquee.y2 = step * 40;
    h.entry.render({viewport: true, interaction: true});
  }
  assert.equal(h.entry.stats().fullRebuilds, fullRebuilds, '框选期间不得整层重建');
  assert.equal(h.entry.stats().mountedNodes, 0, '框选期间不得重建卡片');
  assert.equal(h.marquees().length, 1);
  assert.equal(h.entry.controller.pendingPlaceholders().length, 0);
});

test('拖线预览：拖拽中每帧一条、抬起后消失，且不累积', () => {
  // 拖出但还没落下的那条线不属于文档，控制器给一个独立预览层、每帧清空重画。
  // 这层和框选矩形一样，最容易在「整层重建 → 持久图层」的改造里被丢掉。
  const h = harness();
  h.entry.render({full: true});
  const previewLayer = () => h.entry.controller.getLayer().previews;
  assert.equal(previewLayer().children.length, 0, '没有拖线时预览层为空');
  assert.deepEqual(h.previewCalls, {connection: 0, variable: 0, reference: 0});

  const fullRebuilds = h.entry.stats().fullRebuilds;

  // 变量卡片端口拖出：必须立刻出现预览线。
  h.state.variableConnect = {direction: 'from-card', scope: 'inputs', variable: 'count', cardId: 'card_1', x: 10, y: 20, hover: null, pointerId: null};
  h.entry.render({viewport: true, interaction: true});
  assert.equal(h.previewCalls.variable, 1, '从变量卡片端口拖出必须画预览线');
  assert.equal(previewLayer().children.length, 1);
  assert.equal(String(previewLayer().children[0].attrs.class), 'variable-connection-preview');

  // 拖动中的后续帧：先清空再重画，不叠加。
  for (let step = 1; step <= 5; step += 1) {
    h.state.variableConnect.x = step * 30;
    h.state.variableConnect.y = step * 20;
    h.entry.render({viewport: true, interaction: true});
  }
  assert.equal(previewLayer().children.length, 1, '拖动中预览不累积');
  assert.equal(h.previewCalls.variable, 6);
  assert.equal(h.entry.stats().fullRebuilds, fullRebuilds, '拖线不得整层重建');

  // 抬起：状态清空后的那一帧把预览清掉，之后不再画。
  h.state.variableConnect = null;
  h.entry.render({viewport: true, interaction: true, selection: true});
  assert.equal(previewLayer().children.length, 0, '抬起后预览必须消失');
  assert.equal(h.previewCalls.variable, 6);
  h.entry.render({viewport: true, interaction: true});
  assert.equal(h.previewCalls.variable, 6, '没有拖线状态时不再回调');

  // 节点连线与输出引用走同一条通道。
  h.state.connect = {direction: 'from-output', parent: 'a', x: 0, y: 0, hover: null, pointerId: null};
  h.entry.render({viewport: true, interaction: true});
  assert.equal(String(previewLayer().children[0].attrs.class), 'connection-preview');
  h.state.connect = null;
  h.state.referenceConnect = {nodeId: 'a', x: 0, y: 0, hover: null, pointerId: null};
  h.entry.render({viewport: true, interaction: true});
  assert.equal(String(previewLayer().children[0].attrs.class), 'reference-connection-preview');
  h.state.referenceConnect = null;
  h.entry.render({viewport: true, interaction: true});
  assert.equal(previewLayer().children.length, 0);
});

test('变量卡片按自身坐标裁剪：注入的位置函数（节点侧算法）不得决定可见性', () => {
  // 复现接线事故：画布入口一度把 `CanvasWorkflowModel.variableCardPosition`
  // （「把卡片放到某节点某一行旁边」的节点侧算法，对卡片而言 position(card) 恒为 0,0，
  // 于是每张卡片都返回同一个固定点）当成卡片位置传给渲染入口。所有卡片的裁剪矩形
  // 因此塌到那一个点上：视口滚到那个点才挂载——用户看到的是「拖进画布没反应，
  // 滚一下才出现」。这里注入同样的「恒定返回一个点」的函数，裁剪必须仍然按卡片自己的坐标。
  const raw = {
    root: 'root',
    nodes: [{id: 'root', type: 'root', children: []}],
    inputs: {count: {type: 'number', default: 1}},
    variables: {},
    _variableCards: {card_1: {name: 'count', scope: 'inputs', x: 2000, y: 1500}},
    _variableLinks: {},
    _layout: {root: {x: 0, y: 0}},
  };
  const fixed = () => ({x: 320, y: 96});
  const h = harness({
    raw,
    measurement: {read: () => ({width: 400, height: 300, left: 0, top: 0})},
    entryDeps: {variableCardPosition: fixed},
  });
  // 视口在原点附近：卡片在 (2000,1500)，绝不能因为那个固定点(320,96)在视口里就挂载。
  h.entry.render({full: true});
  assert.deepEqual(h.entry.controller.activeCardIds(), [], '画布外的变量卡片不得挂载');
  assert.equal(h.variableCards().length, 0);

  // 滚到卡片附近：必须挂载（并且是它自己的坐标）。
  h.state.panX = -1900;
  h.state.panY = -1400;
  h.entry.render({viewport: true});
  assert.deepEqual(h.entry.controller.activeCardIds(), ['card_1'], '视口滚到卡片处必须挂载');
  assert.equal(h.variableCards().length, 1);
});

test('从变量面板拖进画布的卡片立刻出现（不需要滚动/缩放）', () => {
  // 复现用户路径：变量面板 dragstart → 画布 drop 落到空白处（没有兼容端点可吸附）
  // → placeVariableCard 写文档 → mutate 触发图形重绘。
  // 造出来的卡片是「未绑定」的，数据边档位（zoom ≥ 0.45）必须照样挂载它。
  const raw = {
    root: 'root',
    nodes: [
      {id: 'root', type: 'root', children: ['a']},
      {id: 'a', type: 'task', action: 'core.log', params: {message: 'x'}},
    ],
    inputs: {count: {type: 'number', default: 1}},
    variables: {},
    _variableCards: {}, _variableLinks: {},
    _layout: {root: {x: 0, y: 0}, a: {x: 0, y: 300}},
  };
  const h = harness({
    raw,
    measurement: {read: () => ({width: 1200, height: 600, left: 0, top: 0})},
  });
  h.entry.render({full: true});
  assert.equal(h.variableCards().length, 0, '初始没有变量卡片');

  const history = createEditorHistory({
    state: h.state,
    cleanupReleased: () => [],
    clearVariableCardSelection: () => {},
    nodeById: h.model.nodeById,
    setDirty: () => {},
    // 与画布入口一致：结构变化走图形重绘。
    renderGraph: () => h.entry.render({graph: true, minimap: true, panels: true, selection: true}),
  });
  let cardSeq = 0;
  const commands = createEditorCommands({
    state: h.state,
    mutate: (fn) => history.mutate(fn),
    nodeById: h.model.nodeById,
    nodes: h.model.nodes,
    layout: () => ({}),
    position: h.model.position,
    clone: (value) => JSON.parse(JSON.stringify(value)),
    toast: () => {},
    variableCards: h.model.variableCards,
    variableLinks: h.model.variableLinks,
    nextVariableCardId: () => `card_${cardSeq += 1}`,
    setVariableCardSelection: h.model.setVariableCardSelection,
    // 落点附近没有兼容端点：吸附目标为 null，走「在落点新建卡片」分支。
    variableInputTargetAt: () => null,
    instanceRunCards: () => [],
    displayNameOfDefinition: (definition, name) => (definition && definition.display_name) || name || '',
    wrap: {clientWidth: 1200, clientHeight: 600, getBoundingClientRect: () => ({width: 1200, height: 600, left: 0, top: 0})},
    variableCardWidth: 168, variableCardHeight: 58, variableCardPortY: 29, nodeWidth: 260, runCardWidth: 250,
  });

  commands.placeVariableCard('inputs', 'count', {x: 320, y: 240});

  assert.deepEqual(Object.keys(raw._variableCards), ['card_1'], '卡片要写进文档');
  assert.deepEqual(h.entry.controller.activeCardIds(), ['card_1'], '重绘后卡片必须立刻挂载');
  const mounted = h.variableCards();
  assert.equal(mounted.length, 1, '卡片元素必须立刻出现在变量卡图层里');
  assert.equal(mounted[0].dataset.variable, 'count');
});

