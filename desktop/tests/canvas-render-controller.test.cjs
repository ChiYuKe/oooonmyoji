// Run via npm test (builds the renderer test output first).
// 持久化图层渲染控制器：视口裁剪、按帧合并、局部更新与整层重建次数的验证。
//
// 这里用最小 DOM 替身而不是真实 DOM：断言的是**架构契约**（有没有整层重建、
// 挂载了多少卡片、哪些连线被裁剪），不是像素结果。真实帧时间由
// scripts/canvas-benchmark.cjs 在 Electron 里量。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createCanvasRenderController } = require('../dist-test-renderer/canvas/render/render-controller.js');
const { createRenderScheduler } = require('../dist-test-renderer/canvas/render/render-scheduler.js');
const { createSpatialIndex } = require('../dist-test-renderer/canvas/render/spatial-index.js');
const zoomLevel = require('../dist-test-renderer/canvas/render/zoom-level.js');

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

function buildGraph(count, options = {}) {
  const nodes = [];
  const stepX = options.stepX ?? 300;
  const perRow = options.perRow ?? 10;
  for (let index = 0; index < count; index += 1) {
    const parent = index === 0 ? null : Math.floor((index - 1) / 2);
    nodes.push({
      id: `n${index}`,
      type: index === 0 ? 'root' : 'task',
      children: [],
      pins: [],
      _parent: parent,
    });
  }
  for (const node of nodes) if (node._parent !== null) nodes[node._parent].children.push(node.id);
  for (let index = 0; index < count; index += 1) {
    const node = nodes[index];
    node._pos = { x: (index % perRow) * stepX, y: Math.floor(index / perRow) * 200 };
  }
  return nodes;
}

function harness(nodes, options = {}) {
  const state = createCanvasState();
  state.raw = {root: nodes[0] ? nodes[0].id : null, nodes: nodes.map((node) => ({id: node.id, type: node.type, children: node.children, pins: node.pins}))};
  state.zoom = options.zoom ?? 1;
  state.panX = options.panX ?? 0;
  state.panY = options.panY ?? 0;

  const calls = {rendered: 0, nodes: 0, cards: 0, edges: 0, runs: 0, previews: 0};
  const posOf = new Map(nodes.map((node) => [node.id, {...node._pos}]));
  const byId = new Map(state.raw.nodes.map((node) => [node.id, node]));
  const structural = [];
  for (const node of nodes) for (const childId of node.children) structural.push({id: `${node.id}->${childId}`, kind: 'structural', parentId: node.id, childId});

  const host = fakeElement('svg');
  const context = {
    state,
    graph: host,
    svgEl: (tag, attrs, parent) => { const node = fakeElement(tag, attrs); if (parent) parent.appendChild(node); return node; },
    nodes: () => state.raw.nodes,
    nodeById: (id) => byId.get(id) || null,
    position: (node) => posOf.get(node.id) || {x: 0, y: 0},
    nodeHeight: () => 96,
    structuralEdges: () => structural,
    instanceRunCards: () => options.runCards ? options.runCards() : [],
    variableCardList: () => options.cards ? options.cards() : [],
    variableCardRect: (card) => ({x: card.x, y: card.y, width: 168, height: 58}),
    nodeVariablePins: (node) => node.pins || [],
    docVersion: () => state.docVersion,
    viewportSize: () => ({width: options.width ?? 1920, height: options.height ?? 1080}),
    renderNode: (layer, node) => {
      calls.nodes += 1;
      const group = fakeElement('g', {class: 'node', transform: `translate(${posOf.get(node.id).x},${posOf.get(node.id).y})`});
      group.dataset.id = node.id;
      // 一个卡片带几个子元素，用来验证「重建」而不是「补属性」。
      for (const className of ['node-box', 'node-head', 'node-name']) group.appendChild(fakeElement('rect', {class: className}));
      group.paths = [...group.children];
      layer.appendChild(group);
      return group;
    },
    renderVariableCard: (layer, card) => {
      calls.cards += 1;
      const group = fakeElement('g', {class: 'variable-card', transform: `translate(${card.x},${card.y})`});
      group.dataset.variable = card.name;
      layer.appendChild(group);
      return group;
    },
    renderInstanceRunCard: (layer, card) => {
      calls.runs += 1;
      const group = fakeElement('g', {class: 'instance-run-card', transform: `translate(${card.x},${card.y})`});
      layer.appendChild(group);
      return group;
    },
    renderEdge: (layer, parent, childId, order) => {
      calls.edges += 1;
      const group = fakeElement('g', {class: 'edge'});
      group.dataset.parent = parent.id;
      group.dataset.child = childId;
      const path = fakeElement('path', {class: 'edge-hit', d: `M ${order}`});
      group.appendChild(path);
      group.paths = [path];
      layer.appendChild(group);
      return group;
    },
    renderInstanceRunEdge: (layer, card) => {
      calls.edges += 1;
      const group = fakeElement('g', {class: 'instance-run-edge'});
      group.paths = [fakeElement('path', {class: 'instance-run-edge-line'})];
      layer.appendChild(group);
      return group;
    },
    renderVariableEdges: () => {},
    renderReferenceEdges: () => {},
    renderConnectionPreviews: (layer) => {
      calls.previews += 1;
      // 只画当前那一条，和 edges.ts 里的实现一致。
      const className = state.connect ? 'connection-preview'
        : state.variableConnect ? 'variable-connection-preview' : 'reference-connection-preview';
      layer.appendChild(fakeElement('path', {class: className, d: 'M 0 0 L 1 1'}));
    },
    nodeSignature: (id) => JSON.stringify(byId.get(id) || {}),
    cardSignature: options.cardSignature || ((card) => JSON.stringify(card)),
    runCardSignature: (card) => JSON.stringify(card.run || {}),
    edgeGeometry: (kind, parentId, childId) => {
      const from = posOf.get(parentId);
      const to = posOf.get(childId);
      if (!from || !to) return null;
      return {from: {x: from.x + 130, y: from.y + 96}, to: {x: to.x + 130, y: to.y}};
    },
    nodeWidth: 260,
    runCardWidth: 250,
    runCardBaseHeight: 78,
  };

  const patched = {transforms: [], edges: 0};
  const patchers = {
    // `nodeTransformReturns: false` 模拟真实补丁的行为：reconcile 的位置同步已经写过 transform，
    // 补丁于是返回 false（「DOM 没变」），不能据此判断节点有没有移动。
    nodeTransform: (id, x, y) => { patched.transforms.push([id, x, y]); return options.nodeTransformReturns ?? true; },
    nodeEdges: () => { patched.edges += 1; },
  };

  const controller = createCanvasRenderController({
    state,
    host,
    context,
    patchers,
    onFrame: () => { calls.rendered += 1; },
  });
  return {state, controller, host, calls, patched, posOf, structural};
}

test('首次渲染挂载全部卡片，但整层重建只发生一次', () => {
  const nodes = buildGraph(40, {perRow: 10});
  const h = harness(nodes, {width: 4200, height: 1200});
  h.controller.request({full: true});
  assert.equal(h.calls.nodes, 40);
  assert.equal(h.calls.edges, 39);
  assert.equal(h.controller.stats().fullRebuilds, 1);
  assert.equal(h.controller.stats().mountedNodes, 40);
});

test('视口裁剪：只挂载外扩区内的节点与连线', () => {
  // 10 列 × 5 行，列距 300 → 宽 3000；视口 500 + 左右各 300 外扩 = 1100。
  const nodes = buildGraph(50, {perRow: 10, stepX: 300});
  const h = harness(nodes, {width: 500, height: 400, panX: 0, panY: 0});
  h.controller.request({full: true});
  const active = h.controller.activeNodeIds();
  assert.ok(active.length > 0 && active.length < 50, `应当只挂载视口附近的节点，实际 ${active.length}`);
  assert.ok(active.includes('n0'), '视口内节点必须挂载');
  // 视口右边界 500 + 外扩 300 = 800；第 4 列起（x=900）必须被裁掉。
  // 曲线本身穿过视口时，允许它的画外端点以轻量占位壳挂载。
  assert.ok(active.length < 25, `连线带入边界端点后仍应裁剪过半节点，实际 ${active.length}`);
  const stats = h.controller.stats();
  assert.ok(stats.culledNodes > 0);
  // 连线按曲线本身与视口的交集挂载；一端在画面外时，画面内的线段仍然保留。
  const wires = h.host.children[0].children.find((child) => child.attrs.class === 'wires');
  assert.ok(wires.children.length < 49, `裁剪后连线应少于总数，实际 ${wires.children.length}`);
  assert.ok(wires.children.length > 0, '画面内的结构线必须保留');
});

test('平移只更新根图层变换，不重建任何卡片，也不触发整层重建', () => {
  const nodes = buildGraph(30, {perRow: 10, stepX: 300});
  const h = harness(nodes, {width: 900, height: 400});
  h.controller.request({full: true});
  const before = {full: h.controller.stats().fullRebuilds, active: h.controller.activeNodeIds().length};
  h.state.panX = -400;
  h.controller.request({viewport: true});
  assert.equal(h.controller.stats().fullRebuilds, before.full, '平移不得整层重建');
  const root = h.host.children[0];
  assert.match(root.attrs.transform, /translate\(-400,0\) scale\(1\)/);
  // 平移会露出新节点：允许挂载新增的可见节点，但每一帧的重建量与「新露出的节点数」一致。
  const stats = h.controller.stats();
  assert.equal(h.calls.nodes, before.active + stats.mountedNodes, '只有新可见的节点被挂载');
  assert.ok(stats.mountedNodes > 0, '平移应当露出新节点');
  assert.equal(stats.fullRebuilds, before.full);
});

test('缩放只更新根图层变换与缩放分级 class', () => {
  const nodes = buildGraph(12, {perRow: 4, stepX: 300});
  const h = harness(nodes, {width: 900, height: 400});
  h.controller.request({full: true});
  const before = h.calls.nodes;
  h.state.zoom = 0.5;
  h.controller.request({viewport: true});
  assert.equal(h.controller.stats().fullRebuilds, 1, '缩放不得整层重建');
  assert.equal(h.controller.stats().detailLevel, 'full', '分级由渲染入口决定，控制器不自作主张');
  h.state.zoom = 1.4;
  h.controller.request({viewport: true});
  assert.match(h.host.children[0].attrs.transform, /scale\(1\.4\)/);
  void before;
});

test('放大后连线一端被卡片裁剪时，画面内的线段不消失', () => {
  const nodes = buildGraph(2, {perRow: 2});
  nodes[0]._pos = {x: 100, y: -500};
  nodes[1]._pos = {x: 100, y: 120};
  nodes[1].type = 'node_group';
  const h = harness(nodes, {width: 500, height: 400, zoom: 0.5});

  h.controller.request({full: true});
  let wires = h.host.children[0].children.find((child) => child.attrs.class === 'wires');
  assert.equal(wires.children.length, 1, '缩小时两端可见，连线应存在');

  h.state.zoom = 1.4;
  h.controller.request({viewport: true});
  wires = h.host.children[0].children.find((child) => child.attrs.class === 'wires');
  assert.ok(h.controller.activeNodeIds().includes('n0'), '画面外的源端点应保留，避免连线悬空');
  assert.ok(h.controller.activeNodeIds().includes('n1'), '画面内的节点组必须保留');
  assert.equal(wires.children.length, 1, '曲线与视口相交时不应整条消失');
});

test('节点内容签名不变时只补属性，签名变化才重建', () => {
  const nodes = buildGraph(4, {perRow: 4});
  const h = harness(nodes, {width: 1200, height: 400});
  h.controller.request({full: true});
  const initialMounts = h.calls.nodes;
  assert.equal(initialMounts, 4);
  // 同一个文档版本：元素原样复用，连签名都不重算。
  h.controller.request({viewport: true, selection: true});
  assert.equal(h.calls.nodes, initialMounts, '签名不变时不得重建卡片');
  assert.ok(h.controller.stats().reusedNodes >= 4, '不改内容的帧应当直接复用元素');
  // 文档版本 +1 且节点内容变化：只重建内容真正变化的那个节点。
  h.state.raw.nodes[0].name = '改名了';
  h.state.docVersion += 1;
  h.controller.request({graph: true});
  assert.equal(h.calls.nodes, initialMounts + 1, '内容变化只重建受影响的那个节点');
  assert.equal(h.controller.stats().mountedNodes, 1);
});

test('拖拽：只改被拖节点的 transform 并刷新相邻连线', () => {
  const nodes = buildGraph(6, {perRow: 3});
  const h = harness(nodes, {width: 1600, height: 800});
  h.controller.request({full: true});
  const builtBefore = h.calls.nodes;
  h.state.drag = {kind: 'nodes', origins: {n2: {...h.posOf.get('n2')}}};
  h.posOf.set('n2', {x: 999, y: 555});
  h.controller.request({viewport: true, interaction: true});
  assert.equal(h.calls.nodes, builtBefore, '拖拽不得重建卡片');
  assert.deepEqual(h.patched.transforms, [['n2', 999, 555]]);
  assert.equal(h.patched.edges, 1, '只刷新被拖节点的相邻连线');
});

test('拖拽：变量卡片补丁移动整组卡片，不重建卡片', () => {
  const nodes = buildGraph(2, {perRow: 2});
  // 变量卡片只有在被可见任务节点的引脚引用时才会**额外**保留到画外；
  // 视口内的卡片一律挂载，所以这里把两张卡片绑到视口里的两个任务节点上。
  nodes[1].pins = [
    {param: 'count', scope: 'inputs', variable: 'count'},
    {param: 'other', scope: 'inputs', variable: 'other'},
  ];
  const cards = [
    {id: 'c1', name: 'count', scope: 'inputs', x: 10, y: 10},
    {id: 'c2', name: 'other', scope: 'inputs', x: 10, y: 90},
  ];
  const h = harness(nodes, {
    width: 1600, height: 800, cards: () => cards,
    // 与 render-entry 一致：位置不进签名，拖拽才走 transform 补丁而不是重建。
    cardSignature: (card) => { const {x, y, ...rest} = card; void x; void y; return JSON.stringify(rest); },
  });
  h.controller.request({full: true});
  const layer = h.host.children[0].children.find((child) => child.attrs.class === 'variable-cards');
  const groups = () => layer.children.filter((child) => String(child.attrs.class || '').includes('variable-card'));
  assert.equal(groups().length, 2, '被节点引脚引用的变量卡片都要挂载');
  const builtBefore = h.calls.cards;
  cards[0].x = 200;
  cards[1].x = 200;
  cards[1].y = 280;
  h.state.drag = {kind: 'variable-card', id: 'c1', origins: {c1: {x: 10, y: 10}, c2: {x: 10, y: 90}}};
  h.controller.request({viewport: true, interaction: true});
  assert.equal(h.calls.cards, builtBefore, '拖拽不得重建卡片');
  assert.deepEqual(groups().map((group) => group.attrs.transform), ['translate(200,10)', 'translate(200,280)']);
});

test('拖拽：transform 已由位置同步写好（补丁返回 false）时，相邻连线仍必须跟着走', () => {
  // 复现用户的「拖卡片时线不跟着走」：reconcile 里的位置同步会先把 transform 写成新值，
  // 之后 applyPatches 调用的 nodeTransform 恒返回 false（DOM 没变）；
  // 以前拿这个返回值当「节点有没有移动」的依据，于是相邻连线一次都不补。
  const nodes = buildGraph(2, {perRow: 2});
  const h = harness(nodes, {width: 1200, height: 600, nodeTransformReturns: false});
  h.controller.request({full: true});
  const group = h.host.children[0].children.find((child) => child.attrs.class === 'cards')
    .children.find((child) => child.dataset.id === 'n1');
  h.state.drag = {kind: 'nodes', origins: {n1: {...h.posOf.get('n1')}}};

  h.posOf.set('n1', {x: 500, y: 700});
  h.controller.request({viewport: true, interaction: true});
  assert.equal(group.attrs.transform, 'translate(500,700)', '卡片要跟着指针走');
  assert.equal(h.patched.edges, 1, '位置变了就必须重算相邻连线（不能因为补丁返回 false 就跳过）');

  // 位置没变的帧不重复重算：拖拽停在原地时不做无谓的 setAttribute。
  h.controller.request({viewport: true, interaction: true});
  assert.equal(h.patched.edges, 1);

  // 再移动一帧：又要补一次。
  h.posOf.set('n1', {x: 508, y: 716});
  h.controller.request({viewport: true, interaction: true});
  assert.equal(h.patched.edges, 2);
});

test('节点坐标在文档里改了：已挂载卡片就地改 transform，不重建也不重复写', () => {
  // 复现「点了自动排列没反应，滚一下画布才刷新」：位置不进内容签名（否则拖拽每帧都要重建），
  // 于是文档里的坐标变了、内容没变的帧必须自己把 transform 对齐，否则元素会停在旧位置。
  const nodes = buildGraph(2, {perRow: 2});
  const h = harness(nodes, {width: 1200, height: 600});
  h.controller.request({full: true});
  const built = h.calls.nodes;
  const cardLayer = h.host.children[0].children.find((child) => child.attrs.class === 'cards');
  const group = cardLayer.children.find((child) => child.dataset.id === 'n1');
  assert.equal(group.attrs.transform, 'translate(300,0)');

  h.posOf.set('n1', {x: 40, y: 800});
  h.state.docVersion += 1;
  h.controller.request({graph: true});
  assert.equal(h.calls.nodes, built, '只是换位置：不得重建卡片');
  assert.equal(group.attrs.transform, 'translate(40,800)', '已挂载卡片必须就地换到新坐标');

  // 坐标没变的帧不能再写一次 DOM（每帧对每张卡都写会拖慢平移/缩放）。
  let writes = 0;
  const original = group.setAttribute.bind(group);
  group.setAttribute = (name, value) => { writes += 1; original(name, value); };
  h.controller.request({viewport: true});
  h.controller.request({viewport: true});
  assert.equal(writes, 0, '坐标没变时不得重复写 transform');
});

test('变量卡片坐标在文档里改了（自动排列）：就地改 transform，不重建', () => {
  const nodes = buildGraph(2, {perRow: 2});
  const cards = [{id: 'c1', name: 'count', scope: 'inputs', x: 40, y: 40}];
  const h = harness(nodes, {
    width: 1200, height: 600, cards: () => cards,
    // 与 render-entry 一致：位置不进签名，拖拽/搬运只改 transform。
    cardSignature: (card) => { const {x, y, ...rest} = card; void x; void y; return JSON.stringify(rest); },
  });
  h.controller.request({full: true});
  const built = h.calls.cards;
  const layer = h.host.children[0].children.find((child) => child.attrs.class === 'variable-cards');
  const group = layer.children[0];
  assert.equal(group.attrs.transform, 'translate(40,40)');

  cards[0].x = 600;
  cards[0].y = 300;
  h.state.docVersion += 1;
  h.controller.request({graph: true});
  assert.equal(h.calls.cards, built, '只是换位置：不得重建变量卡片');
  assert.equal(group.attrs.transform, 'translate(600,300)', '变量卡片必须就地换到新坐标');
});

test('实例运行卡坐标在文档里变了：就地改 transform，不重建', () => {
  const nodes = buildGraph(2, {perRow: 2});
  const runCards = [{key: 'n1:0', node: nodes[1], index: 0, run: {}, variables: [], x: 500, y: 600, height: 78}];
  const h = harness(nodes, {width: 2000, height: 2000, runCards: () => runCards});
  h.controller.request({full: true});
  const built = h.calls.runs;
  const layer = h.host.children[0].children.find((child) => child.attrs.class === 'cards');
  const group = layer.children.find((child) => child.attrs.class === 'instance-run-card');
  assert.equal(group.attrs.transform, 'translate(500,600)');

  runCards[0].x = 100;
  runCards[0].y = 120;
  h.state.docVersion += 1;
  h.controller.request({graph: true});
  assert.equal(h.calls.runs, built, '只是换位置：不得重建实例运行卡');
  assert.equal(group.attrs.transform, 'translate(100,120)');
});

test('视口内的变量卡片与是否被引用无关：拖进画布的未绑定卡片必须挂载', () => {
  // 复现：变量面板拖进画布、还没接到任何端点时，卡片是「未绑定」的。
  // 数据边档位（zoom ≥ 0.45）曾经只保留「被引脚引用」的卡片，
  // 于是新卡片整张不挂载——用户看到的是「拖进来没反应，缩到概览档才出现」。
  const nodes = buildGraph(2, {perRow: 2});
  const cards = [{id: 'c1', name: 'count', scope: 'inputs', x: 40, y: 40}];
  const h = harness(nodes, {width: 1200, height: 600, cards: () => cards});
  h.controller.request({full: true});
  assert.deepEqual(h.controller.activeCardIds(), ['c1'], '视口内的未绑定变量卡片必须立刻可见');
  assert.equal(h.calls.cards, 1);

  // 之后任何一次结构重绘（例如改一个节点的参数）也不能把它裁掉。
  h.state.docVersion += 1;
  h.controller.request({graph: true});
  assert.ok(h.controller.activeCardIds().includes('c1'), '结构重绘不得丢掉视口内的未绑定卡片');

  // 卡片真的移出视口时才允许卸载：裁剪依旧按视口生效。
  cards[0].x = 5000;
  h.state.docVersion += 1;
  h.controller.request({graph: true});
  assert.deepEqual(h.controller.activeCardIds(), [], '移出视口的未绑定卡片仍然要被裁掉');
});

test('变量卡裁剪：视口外的已绑定卡片保留（连线不悬空），视口内的未绑定卡片也保留', () => {
  const nodes = buildGraph(2, {perRow: 2});
  // n1 的引脚引用 inputs.count：对应的卡片放在画外，仍然必须挂着，否则变量连线会悬空。
  nodes[1].pins = [{param: 'count', scope: 'inputs', variable: 'count'}];
  const cards = [
    {id: 'unbound', name: 'other', scope: 'inputs', x: 40, y: 40},
    {id: 'bound', name: 'count', scope: 'inputs', x: 9000, y: 9000},
  ];
  const h = harness(nodes, {width: 1200, height: 600, cards: () => cards});
  h.controller.request({full: true});
  const active = h.controller.activeCardIds();
  assert.ok(active.includes('unbound'), '视口内的未绑定卡片必须挂载');
  assert.ok(active.includes('bound'), '被引脚引用的画外卡片必须保留');
});

test('视口内新增未绑定变量卡片：不因此重建连线图层', () => {
  const nodes = buildGraph(4, {perRow: 4});
  const cards = [];
  const h = harness(nodes, {width: 2000, height: 800, cards: () => cards});
  h.controller.request({full: true});
  const edgesBefore = h.calls.edges;
  cards.push({id: 'c1', name: 'count', scope: 'inputs', x: 40, y: 40});
  h.state.docVersion += 1;
  h.controller.request({graph: true});
  assert.ok(h.controller.activeCardIds().includes('c1'));
  assert.equal(h.calls.edges, edgesBefore, '未绑定卡片不改变任何连线，不应重建连线图层');
});

test('相邻连线越界时释放，回到视口后重建', () => {
  const nodes = buildGraph(4, {perRow: 4, stepX: 300});
  const h = harness(nodes, {width: 700, height: 300, panX: 0, panY: 0});
  h.controller.request({full: true});
  const wires = h.host.children[0].children.find((child) => child.attrs.class === 'wires');
  const edgesBefore = wires.children.length;
  assert.ok(edgesBefore > 0);
  // 视口只留第一个节点：后面的节点与它们的连线一起被裁剪。
  h.state.panX = -100000;
  h.controller.request({viewport: true});
  assert.equal(h.controller.activeNodeIds().length, 0);
  assert.equal(wires.children.length, 0, '全部裁剪后不应留下悬空连线');
  h.state.panX = 0;
  h.controller.request({viewport: true});
  assert.ok(wires.children.length > 0, '回到视口后重建');
});

test('选中连线不会被视口裁剪丢掉', () => {
  const nodes = buildGraph(4, {perRow: 4, stepX: 300});
  const h = harness(nodes, {width: 500, height: 300, panX: 0, panY: 0});
  h.controller.request({full: true});
  h.state.panX = -100000;
  h.controller.request({viewport: true});
  assert.equal(h.controller.activeNodeIds().length, 0, '没有选中时全部裁剪');
  // 选中一条连线：即使它的端点已经出视口，也不应该留下半截线。
  h.state.selectedEdge = {parent: 'n0', child: 'n1'};
  h.controller.request({viewport: true, selection: true});
  const active = h.controller.activeNodeIds();
  const wires = h.host.children[0].children.find((child) => child.attrs.class === 'wires');
  const hasEdge = wires.children.some((edge) => edge.dataset.parent === 'n0' && edge.dataset.child === 'n1');
  if (hasEdge) {
    assert.ok(active.includes('n0') && active.includes('n1'), '连线的两端必须都已挂载');
  } else {
    // 两端都出了视口：连线被裁掉是允许的，但不能只挂载半截。
    assert.ok(!active.includes('n0') && !active.includes('n1'));
  }
  // 端点回到视口内：选中连线必须重新出现。
  h.state.panX = 0;
  h.controller.request({viewport: true, selection: true});
  const wiresBack = h.host.children[0].children.find((child) => child.attrs.class === 'wires');
  assert.ok(wiresBack.children.some((edge) => edge.dataset.parent === 'n0' && edge.dataset.child === 'n1'));
  const activeBack = h.controller.activeNodeIds();
  assert.ok(activeBack.includes('n0'));
});

test('导出期间挂载全部节点，导出后恢复裁剪', () => {
  const nodes = buildGraph(40, {perRow: 10, stepX: 300});
  const h = harness(nodes, {width: 600, height: 300});
  h.controller.request({full: true});
  const culled = h.controller.activeNodeIds().length;
  assert.ok(culled < 40);
  h.controller.setRenderAll(true);
  assert.equal(h.controller.activeNodeIds().length, 40, '导出必须看到全部节点');
  h.controller.setRenderAll(false);
  assert.ok(h.controller.activeNodeIds().length < 40, '导出结束后恢复裁剪');
  assert.equal(h.controller.stats().fullRebuilds, 1, '导出开关不应整层重建');
});

test('渲染调度器把同一帧的多次请求合并成一次', () => {
  let queued = [];
  const frames = [];
  const scheduler = createRenderScheduler({
    run: (flags) => frames.push(flags),
    // 模拟浏览器的 rAF：回调不在调用栈里同步执行，而是排到下一帧。
    scheduleFrame: (fn) => { queued.push(fn); },
    coalesce: true,
  });
  const runFrame = () => { const pendingFrames = queued; queued = []; for (const fn of pendingFrames) fn(); };

  scheduler.coalesce({viewport: true});
  scheduler.coalesce({viewport: true});
  scheduler.coalesce({selection: true});
  assert.equal(queued.length, 1, '同一帧只排一次帧回调');
  assert.equal(frames.length, 0, '帧回调执行前不渲染');
  runFrame();
  assert.equal(frames.length, 1, '同帧只执行一次');
  assert.deepEqual(frames[0], {viewport: true, selection: true}, '标记要合并');

  // request 是同步的：选中/就地编辑器这类路径不能延后一帧。
  scheduler.request({graph: true});
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[1], {graph: true});

  // 没有帧调度能力时 coalesce 退化成同步，测试环境无需自行推进帧。
  const syncFrames = [];
  const sync = createRenderScheduler({run: (flags) => syncFrames.push(flags), scheduleFrame: (fn) => fn(), coalesce: false});
  sync.coalesce({viewport: true});
  assert.equal(syncFrames.length, 1);
});

test('空间索引：矩形查询返回精确相交的条目', () => {
  const index = createSpatialIndex(200);
  index.rebuild([
    {id: 'a', x: 0, y: 0, width: 100, height: 100},
    {id: 'b', x: 1000, y: 1000, width: 100, height: 100},
    {id: 'c', x: 50, y: 50, width: 400, height: 400},
  ]);
  assert.deepEqual(index.queryRect({x: 0, y: 0, width: 120, height: 120}).sort(), ['a', 'c']);
  assert.deepEqual(index.queryRect({x: 2000, y: 2000, width: 10, height: 10}), []);
  // 点查询返回格子候选（粗筛）：120,120 同时落在 a 与 c 的格子里，精确判断由调用方做。
  assert.deepEqual(index.candidatesAt(120, 120).sort(), ['a', 'c']);
  assert.deepEqual(index.queryRect({x: 1000, y: 1000, width: 0, height: 0}), ['b']);
  assert.equal(index.size(), 3);
});

test('缩放分级带迟滞，不会在阈值上反复切换', () => {
  assert.equal(zoomLevel.detailLevelForZoom(1), 'full');
  assert.equal(zoomLevel.detailLevelForZoom(0.75), 'full');
  assert.equal(zoomLevel.detailLevelForZoom(0.74), 'compact');
  assert.equal(zoomLevel.detailLevelForZoom(0.45), 'compact');
  assert.equal(zoomLevel.detailLevelForZoom(0.44), 'overview');
  // 迟滞：0.75 边界上轻微抖动保持原级。
  assert.equal(zoomLevel.resolveDetailLevel(0.74, 'full'), 'full');
  assert.equal(zoomLevel.resolveDetailLevel(0.71, 'full'), 'compact');
  assert.equal(zoomLevel.resolveDetailLevel(0.76, 'compact'), 'compact');
  assert.equal(zoomLevel.resolveDetailLevel(0.79, 'compact'), 'full');
  assert.equal(zoomLevel.showsDataEdges('overview'), false);
  assert.equal(zoomLevel.showsDataEdges('compact'), true);
  assert.equal(zoomLevel.FOCUS_ZOOM, 0.8);
});

test('图层容器按固定顺序创建一次，重复渲染不会重建图层', () => {
  const nodes = buildGraph(6, {perRow: 3});
  const h = harness(nodes, {width: 1600, height: 800});
  h.controller.request({full: true});
  const graphChildren = h.host.children.length;
  const layer = h.host.children[0];
  h.controller.request({viewport: true});
  h.controller.request({graph: true});
  assert.equal(h.host.children.length, graphChildren, '图层不重建');
  assert.deepEqual(layer.children.map((child) => child.attrs.class), [
    'wires', 'variable-edges', 'reference-edges', 'cards', 'variable-cards', 'previews', 'overlays',
  ]);
});

test('临时连线预览：拖线时每帧重画一条，松手后清空且不累积', () => {
  const nodes = buildGraph(4, {perRow: 2});
  const h = harness(nodes, {width: 1600, height: 800});
  h.controller.request({full: true});
  const previews = () => h.host.children[0].children.find((child) => child.attrs.class === 'previews');
  assert.equal(previews().children.length, 0, '没有拖线时预览层为空');
  assert.equal(h.calls.previews, 0);

  // 变量卡片端口拖出一帧：预览层里出现一条，且是当前这一种。
  h.state.variableConnect = {direction: 'from-card', scope: 'inputs', variable: 'count', cardId: 'c1', x: 10, y: 10, hover: null, pointerId: null};
  h.controller.request({viewport: true, interaction: true});
  assert.equal(previews().children.length, 1);
  assert.equal(previews().children[0].attrs.class, 'variable-connection-preview');
  assert.equal(h.calls.previews, 1);

  // 拖动中的后续帧：旧的先清掉，不会一帧叠一条。
  for (let frame = 0; frame < 5; frame += 1) h.controller.request({viewport: true, interaction: true});
  assert.equal(previews().children.length, 1, '预览不累积');
  assert.equal(h.calls.previews, 6);

  // 松手（状态清空）后剩下的那一帧要把它清掉。
  h.state.variableConnect = null;
  h.controller.request({viewport: true, interaction: true});
  assert.equal(previews().children.length, 0, '松手后预览必须清空');
  assert.equal(h.calls.previews, 6, '没有拖线状态时不再调预览渲染');

  // 节点连线与输出引用走同一条通道。
  h.state.connect = {direction: 'from-output', parent: 'n0', x: 0, y: 0, hover: null, pointerId: null};
  h.controller.request({viewport: true, interaction: true});
  assert.equal(previews().children[0].attrs.class, 'connection-preview');
  h.state.connect = null;
  h.state.referenceConnect = {nodeId: 'n0', x: 0, y: 0, hover: null, pointerId: null};
  h.controller.request({viewport: true, interaction: true});
  assert.equal(previews().children[0].attrs.class, 'reference-connection-preview');
});
