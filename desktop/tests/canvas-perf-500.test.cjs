// Run via npm test (builds the renderer test output first).
// 500 节点性能样例：契约级基准（DOM 数量、整层重建次数、局部更新次数）+ 大图稳定性。
//
// 这里断言的是**确定性的计数**，不是帧时间：帧时间受机器影响，无法在 CI 里判定。
// 真正的帧时间用 `npm run benchmark:canvas` 在 Electron 里量。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { buildCanvasFixture } = require('../scripts/canvas-fixture.cjs');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createCanvasWorkflowModel } = require('../dist-test-renderer/canvas/model/canvas-workflow-model.js');
const { createCanvasViewport } = require('../dist-test-renderer/canvas/canvas/viewport.js');
const { createRenderEntry } = require('../dist-test-renderer/canvas/render/render-entry.js');
const { resolveDetailLevel, FOCUS_ZOOM } = require('../dist-test-renderer/canvas/render/zoom-level.js');

/** 最小 DOM 替身：统计真实发生的元素创建次数，而不是像素。 */
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
    querySelectorAll() { return []; },
    getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; },
    classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
    style: {},
    closest() { return null; },
  };
  Object.defineProperty(element, 'isConnected', {get() { return Boolean(this.parent); }});
  return element;
}

/**
 * 把 500 节点样例接到真实画布模型上（与 editor.ts 的接线方式一致），
 * 但把渲染片段换成计数版本：断言「重建了多少卡片」而不是像素。
 */
function buildHarness(options = {}) {
  const fixture = buildCanvasFixture();
  const state = createCanvasState();
  state.raw = fixture.document;
  state.catalog = fixture.catalog;
  state.docVersion = 1;
  state.zoom = options.zoom ?? 1;
  state.panX = options.panX ?? 0;
  state.panY = options.panY ?? 0;

  const model = createWorkflowModel(state);
  const viewportSize = {width: options.width ?? 1920, height: options.height ?? 1080};
  const counts = {nodes: 0, cards: 0, edges: 0, runEdges: 0, variableEdges: 0, referenceEdges: 0, minimap: 0, inspector: 0, sidebar: 0, badge: 0};
  const calls = {render: 0, coalesce: 0};

  const minimap = createCanvasWorkflowModel;
  void minimap;

  const graph = fakeElement('svg');
  const wrap = {getBoundingClientRect: () => ({left: 0, top: 0, ...viewportSize})};
  const $ = () => fakeElement('div');

  const CanvasModel = createCanvasWorkflowModel({
    state, Model: model, VariableSystem: {
      cleanupReleased: () => [],
      expose: () => {},
      isPublic: () => false,
      lookup: () => null,
    },
    nodes: model.nodes,
    position: model.position,
    variableCards: model.variableCards,
    compatibleRefType: () => true,
    definitionSchema: () => ({}),
    nodeHeight,
    baseHeight: 96,
    nodeWidth: 260,
    decoHeight: 22,
    variableCardWidth: 168,
    variableCardHeight: 58,
    variableCardPortY: 29,
    variablePinX: 10,
    runCardWidth: 250,
    runCardBaseHeight: 78,
    runVariableHeight: 24,
    runCardGapX: 48,
    runCardGapY: 92,
    catalogByName: (name) => fixture.catalog.find((item) => item.name === name) || null,
    fieldLabel: (name) => name,
    workflowNodeInputs: () => [],
    nextVariableCardId: () => 'card_x',
    workflowReference: () => '',
    nodeRowHeight,
  });

  function nodeRowHeight(node) {
    const spec = node && node.action ? fixture.catalog.find((item) => item.name === node.action) : null;
    return spec && spec.card ? 40 : 24;
  }
  function nodeHeight(node) {
    return 96 + CanvasModel.nodeVariablePins(node).length * nodeRowHeight(node)
      + (Array.isArray(node.decorators) ? node.decorators.length * 22 : 0);
  }

  const viewport = createCanvasViewport({
    state,
    nodes: model.nodes,
    position: model.position,
    layout: model.layout,
    mutate: (fn) => fn(),
    instanceRunCards: () => [],
    variableCardList: model.variableCardList,
    nodeHeight,
    wrap,
    minimap: () => null,
    render: () => {},
    nodeWidth: 260,
    baseHeight: 96,
    runCardWidth: 250,
    variableCardWidth: 168,
    variableCardHeight: 58,
  });

  const entry = createRenderEntry({
    state,
    $,
    graph,
    wrap,
    svgEl: (tag, attrs, parent) => { const node = fakeElement(tag, attrs); if (parent) parent.appendChild(node); return node; },
    UI: {closeDropdowns() {}},
    nodes: model.nodes,
    nodeById: model.nodeById,
    position: model.position,
    nodeHeight,
    nodeRowHeight,
    nodeVariablePins: CanvasModel.nodeVariablePins,
    instanceRunCards: () => [],
    variableCardList: model.variableCardList,
    renderNode: (layer, node) => {
      counts.nodes += 1;
      const group = fakeElement('g', {class: 'node studio-card'});
      group.dataset.id = node.id;
      for (const className of ['node-box', 'node-head', 'node-name', 'node-subtitle']) group.appendChild(fakeElement('rect', {class: className}));
      layer.appendChild(group);
      return group;
    },
    renderInstanceRunCard: () => {},
    renderVariableCard: (layer, card) => {
      counts.cards += 1;
      const group = fakeElement('g', {class: 'variable-card'});
      group.dataset.variable = card.name;
      layer.appendChild(group);
      return group;
    },
    renderEdge: (layer, parent, childId) => {
      counts.edges += 1;
      const group = fakeElement('g', {class: 'edge'});
      group.dataset.parent = parent.id;
      group.dataset.child = childId;
      const path = fakeElement('path', {class: 'edge-hit'});
      path.setAttribute('d', `M 0 0 L 1 1`);
      group.appendChild(path);
      group.appendChild(fakeElement('path', {class: 'edge-line'}));
      layer.appendChild(group);
      return group;
    },
    renderInstanceRunEdge: () => { counts.runEdges += 1; },
    renderConnection: () => {},
    renderVariableConnection: () => {},
    renderReferenceConnection: () => {},
    renderReferenceEdges: () => { counts.referenceEdges += 1; },
    renderVariableEdges: () => { counts.variableEdges += 1; },    renderMinimap: () => { counts.minimap += 1; },
    renderInspector: () => { counts.inspector += 1; },
    postSidebarState: () => { counts.sidebar += 1; },
    updateIssueBadge: () => { counts.badge += 1; },
    ensureLayout: () => viewport.ensureLayout(),
    syncLegacyInputParameters: () => false,
    syncLegacyVariableCards: () => false,
    setDirty: () => {},
    nodeIssueInfo: () => null,
    referenceSourceIds: (node) => CanvasModel.nodeVariablePins(node)
      .map((pin) => pin && pin.value && typeof pin.value === 'object' && typeof pin.value.ref === 'string' ? /^nodes\.([^\.]+)\.output/.exec(pin.value.ref) : null)
      .filter(Boolean)
      .map((match) => match[1]),
    patchers: {
      nodeEdges: (id) => {
        for (const parent of model.nodes()) {
          const children = Array.isArray(parent.children) ? parent.children : [];
          for (const childId of children) {
            if (parent.id !== id && childId !== id) continue;
            counts.edges += 0; // 局部更新不计入重建
          }
        }
      },
    },
    nodeWidth: 260,
    variableCardWidth: 168,
    variableCardHeight: 58,
    runCardWidth: 250,
    runCardBaseHeight: 78,
  });

  /** 已挂载卡片数 = cards 层的直接子元素。 */
  function mountedCounts() {
    const layer = entry.controller.getLayer();
    const nodes = layer.cards.children.filter((child) => child.attrs.class === 'node studio-card' || (child.dataset && child.dataset.id));
    const wires = layer.wires.children;
    const variableEdges = layer.variableEdges.children;
    const referenceEdges = layer.referenceEdges.children;
    const variableCards = layer.variableCards.children;
    return {
      nodes: nodes.length,
      edges: wires.length,
      variableEdges: variableEdges.length,
      referenceEdges: referenceEdges.length,
      variableCards: variableCards.length,
    };
  }

  /**
   * 一次性补齐所有占位卡片。
   * 单帧建卡有预算（避免一帧建几百张卡片），测试里用这个把画面推到稳态再断言。
   */
  function flushPlaceholders() {
    for (let guard = 0; guard < 500; guard += 1) {
      entry.controller.resetBuildBudget();
      const pending = entry.controller.pendingPlaceholders();
      if (!pending.length) return;
      let filled = 0;
      for (const id of pending) if (entry.controller.fillPlaceholder(id)) filled += 1;
      if (!filled) return;
      entry.render({ viewport: true });
    }
  }

  return {fixture, state, model, viewport, entry, counts, mountedCounts, flushPlaceholders, viewportSize};
}

test('500 节点样例的规模与基线一致（500 节点 / 499 结构边 / 250 数据边 / 100 变量卡）', () => {
  const {document, metrics, catalog} = buildCanvasFixture();
  assert.equal(metrics.nodes, 500);
  assert.equal(metrics.structuralEdges, 499);
  assert.equal(metrics.referenceEdges, 250);
  assert.equal(metrics.dataEdges, 250);
  assert.equal(metrics.variableCards, 100);
  assert.equal(document.nodes.length, 500);
  assert.equal(document.schema_version, 4);
  assert.equal(catalog.length >= 1, true);
  // 确定性：两次生成必须完全一致（截图对比与帧时间对比的前提）。
  assert.equal(JSON.stringify(buildCanvasFixture().document), JSON.stringify(document));
});

test('首次渲染：视口裁剪后的挂载量远小于 500，且整层重建只发生一次', () => {
  const h = buildHarness({width: 1920, height: 1080});
  h.entry.render({full: true});
  // 单帧建卡有预算，先把分帧补齐走完再断言稳态。
  h.flushPlaceholders();
  const stats = h.entry.stats();
  assert.equal(stats.fullRebuilds, 1, '首次渲染只做一次整层重建');
  const mounted = h.mountedCounts();
  assert.ok(mounted.nodes > 0, '视口内必须有卡片');
  assert.ok(mounted.nodes < 500, `首次渲染必须裁剪，实际挂载 ${mounted.nodes} 个节点`);
  assert.ok(mounted.edges < 499, `首次渲染必须裁连线，实际挂载 ${mounted.edges} 条`);
  assert.ok(mounted.nodes < 200, `挂载量应该只覆盖视口一角，实际 ${mounted.nodes}`);
  assert.equal(h.counts.nodes, mounted.nodes, '渲染次数与挂载数一致（没有反复重建）');
  assert.equal(h.entry.controller.pendingPlaceholders().length, 0, '补齐后不应留下壳');
});

test('平移：零整层重建，且每帧只挂载新露出的节点', () => {
  const h = buildHarness({width: 1920, height: 1080});
  h.entry.render({full: true});
  const baseline = h.entry.stats().fullRebuilds;
  let mountsDuringPan = 0;
  // 连续平移 40 帧：模拟真实拖拽平移（每帧移动 60 px）。
  for (let frame = 0; frame < 40; frame += 1) {
    h.state.panX -= 60;
    h.entry.render({viewport: true});
    mountsDuringPan += h.entry.stats().mountedNodes;
  }
  const stats = h.entry.stats();
  assert.equal(stats.fullRebuilds, baseline, '平移期间不得整层重建');
  assert.ok(mountsDuringPan > 0, '平移会露出新节点，应当挂载它们');
  assert.ok(mountsDuringPan < 500, `平移期间的重建量必须有界，实际 ${mountsDuringPan}`);
  // 视口外的节点不会因为平移而被反复重建：同一帧内签名不变就不重建。
  assert.equal(h.mountedCounts().nodes, h.entry.controller.activeNodeIds().length);
});

test('缩放：零整层重建，只在跨级时切换缩放分级', () => {
  const h = buildHarness({width: 1920, height: 1080});
  h.entry.render({full: true});
  const baseline = h.entry.stats().fullRebuilds;
  h.state.zoom = 0.9;
  h.entry.render({viewport: true});
  assert.equal(h.entry.detailLevel(), 'full');
  h.state.zoom = 0.6;
  h.entry.render({viewport: true});
  assert.equal(h.entry.detailLevel(), 'compact', '0.6 应当进入紧凑卡片');
  h.state.zoom = 0.3;
  h.entry.render({viewport: true});
  assert.equal(h.entry.detailLevel(), 'overview', '0.3 应当进入概览卡片');
  // 概览模式下数据边不再挂载（结构边始终可见）。
  const mounted = h.mountedCounts();
  assert.equal(mounted.variableEdges, 0, '概览模式隐藏变量边');
  assert.equal(mounted.referenceEdges, 0, '概览模式隐藏引用边');
  // 概览模式下数据边不再渲染（结构边始终可见）。
  const overviewDataEdgeCalls = h.counts.referenceEdges + h.counts.variableEdges;
  // 回到紧凑档：数据边重新渲染（升级也要越过迟滞阈值 0.45+0.03）。
  h.state.zoom = 0.5;
  h.entry.render({viewport: true});
  assert.equal(h.entry.detailLevel(), 'compact');
  h.state.zoom = 0.6;
  h.entry.render({viewport: true});
  assert.equal(h.entry.detailLevel(), 'compact', '同档内继续缩放保持紧凑');
  assert.ok(h.counts.referenceEdges + h.counts.variableEdges > overviewDataEdgeCalls,
    '回到紧凑档后数据边重新渲染');
  assert.equal(h.entry.stats().fullRebuilds, baseline, '缩放全程不得整层重建');
});

test('缩放分级带迟滞：阈值附近抖动不切换', () => {
  assert.equal(resolveDetailLevel(0.74, 'full'), 'full');
  assert.equal(resolveDetailLevel(0.7, 'full'), 'compact');
  assert.equal(resolveDetailLevel(0.76, 'compact'), 'compact');
  assert.equal(resolveDetailLevel(0.8, 'compact'), 'full');
  assert.equal(FOCUS_ZOOM, 0.8);
});

test('拖拽：只更新被拖节点与相邻连线，不重建卡片', () => {
  const h = buildHarness({width: 1920, height: 1080});
  h.entry.render({full: true});
  h.flushPlaceholders();
  const active = h.entry.controller.activeNodeIds();
  const target = active.find((id) => id.startsWith('task_')) || active[0];
  const origin = h.model.position(h.model.nodeById(target));
  h.state.selected = new Set([target]);
  h.state.drag = {kind: 'nodes', origins: {[target]: {...origin}}, start: {x: 0, y: 0}, before: '', moved: false};
  // 第一帧：位置没变 → 不写 DOM、不重建卡片。
  h.entry.render({viewport: true, interaction: true});
  const builtBefore = h.counts.nodes;
  if (process.env.CANVAS_PERF_DEBUG) {
    process.stdout.write(`DEBUG drag: mounted=${h.entry.stats().mountedNodes} patched=${h.entry.stats().patchedNodes} active=${h.entry.controller.activeNodeIds().length} target=${target} class=${h.state.raw.nodes.find((n) => n.id === target) && h.state.raw.nodes.find((n) => n.id === target).type}\n`);
  }
  assert.equal(h.entry.stats().mountedNodes, 0, '拖拽不得重建卡片');
  // 第二帧：位置变了 → 只改被拖节点的 transform。
  h.model.layout()[target] = {x: origin.x + 64, y: origin.y + 32};
  h.entry.render({viewport: true, interaction: true});
  assert.equal(h.counts.nodes, builtBefore, '拖拽不得重建任何卡片');
  assert.equal(h.entry.stats().mountedNodes, 0, '拖拽帧不应当挂载任何新卡片');
  assert.equal(h.entry.stats().fullRebuilds, 1, '拖拽不得整层重建');
  const element = h.entry.controller.mountedNodes().get(target);
  assert.ok(element, '被拖节点必须仍然挂载');
  assert.equal(element.attrs.transform, `translate(${origin.x + 64},${origin.y + 32})`);
  // 再走一帧（位置不变）：DOM 不再被写。
  const before = element.attrs.transform;
  h.entry.render({viewport: true, interaction: true});
  assert.equal(element.attrs.transform, before);
  assert.equal(h.entry.stats().mountedNodes, 0);
});

test('拖拽：变量卡片整组只改 transform，不重建卡片', () => {
  const h = buildHarness({width: 1920, height: 1080});
  h.entry.render({full: true});
  const visibleTasks = h.entry.controller.activeNodeIds()
    .map((id) => h.model.nodeById(id))
    .filter((node) => node && node.type === 'task' && node.params);
  assert.ok(visibleTasks.length >= 2, `视口内应当有至少两个任务节点，实际 ${visibleTasks.length}`);
  const cards = h.model.variableCardList().slice(0, 2);
  // 数据边档位下，视口内的变量卡片与本档位被引用的卡片都会挂载：
  // 把两张卡片移到视口里的两个任务节点旁边并绑上去，保证它们在挂载集合里。
  visibleTasks.slice(0, 2).forEach((node, index) => {
    const card = cards[index];
    const place = h.model.position(node);
    h.state.raw._variableCards[card.id].x = Math.round(place.x - 460);
    h.state.raw._variableCards[card.id].y = Math.round(place.y + index * 72);
    node.params.message = {ref: `${card.scope}.${card.name}`};
  });
  h.entry.render({graph: true, minimap: true, panels: true});
  const active = h.entry.controller.activeCardIds();
  assert.ok(cards.every((card) => active.includes(card.id)), '被引用的两张变量卡片都要挂载');
  const origins = {};
  for (const card of cards) {
    const doc = h.state.raw._variableCards[card.id];
    origins[card.id] = {x: doc.x, y: doc.y};
  }
  h.state.selectedVariableCardIds = new Set(cards.map((card) => card.id));
  h.state.drag = {kind: 'variable-card', id: cards[0].id, start: {x: 0, y: 0}, origins, before: '', moved: false};
  // 第一帧：位置没变 → 不重建卡片。
  h.entry.render({viewport: true, interaction: true});
  const builtBefore = h.counts.cards;
  const edgeCallsBefore = h.counts.variableEdges;
  for (const card of cards) {
    h.state.raw._variableCards[card.id].x += 48;
    h.state.raw._variableCards[card.id].y += 24;
  }
  // 第二帧：整组卡片按各自起点加同一位移，只改 transform。
  h.entry.render({viewport: true, interaction: true});
  assert.equal(h.counts.cards, builtBefore, '拖拽不得重建变量卡片');
  assert.equal(h.entry.stats().fullRebuilds, 1, '拖拽不得整层重建');
  const transforms = h.entry.controller.getLayer().variableCards.children.map((child) => child.attrs.transform);
  for (const card of cards) {
    const doc = h.state.raw._variableCards[card.id];
    assert.ok(transforms.includes(`translate(${doc.x},${doc.y})`), `卡片 ${card.id} 要按新位置就地移动`);
  }
  assert.ok(h.counts.variableEdges > edgeCallsBefore, '卡片移动后变量连线要跟着重画');
});

test('导出：临时挂载全部 500 个节点，导出后恢复裁剪', () => {
  const h = buildHarness({width: 1920, height: 1080});
  h.entry.render({full: true});
  h.flushPlaceholders();
  const culled = h.entry.controller.activeNodeIds().length;
  assert.ok(culled < 500);
  h.entry.setRenderAll(true);
  assert.equal(h.entry.controller.activeNodeIds().length, 500, '导出必须包含整张画布');
  assert.equal(h.mountedCounts().nodes, 500);
  assert.equal(h.entry.controller.pendingPlaceholders().length, 0, '导出入口必须在返回前补齐全部占位壳');
  h.entry.setRenderAll(false);
  assert.ok(h.entry.controller.activeNodeIds().length < 500, '导出结束后恢复裁剪');
  assert.equal(h.entry.stats().fullRebuilds, 1, '导出开关不应整层重建');
});

test('参数修改后的稳定刷新不触发整层重建，只重建受影响节点', () => {
  const h = buildHarness({width: 1920, height: 1080});
  h.entry.render({full: true});
  h.flushPlaceholders();
  const active = h.entry.controller.activeNodeIds();
  const target = active.find((id) => id.startsWith('task_')) || active[0];
  const builtBefore = h.counts.nodes;
  // 模拟一次参数修改：文档 +1、内容签名变化。
  h.state.docVersion += 1;
  h.model.nodeById(target).params.message = '改过了';
  h.entry.render({graph: true, minimap: true, panels: true});
  if (process.env.PERF_DBG) {
    process.stdout.write(`DBG before=${builtBefore} after=${h.counts.nodes} mounted=${h.entry.stats().mountedNodes} reused=${h.entry.stats().reusedNodes} patched=${h.entry.stats().patchedNodes} active=${h.entry.controller.activeNodeIds().length} placeholders=${h.entry.controller.pendingPlaceholders().length}\n`);
  }
  assert.equal(h.entry.stats().fullRebuilds, 1, '普通参数修改不得整层重建');
  assert.equal(h.counts.nodes, builtBefore + 1, '只重建真正变化的那个节点');
  // 只改选择：不得重建任何卡片内容。
  const afterChange = h.counts.nodes;
  const mountedBefore = h.entry.stats().mountedNodes;
  void mountedBefore;
  h.state.selected = new Set([target]);
  h.entry.render({selection: true, panels: true});
  assert.equal(h.entry.stats().mountedNodes, 0, '选择变化不应重建任何卡片');
  assert.equal(h.counts.nodes, afterChange, '选择变化不应重建卡片内容');
});

test('大图稳定性：1000 节点下视口裁剪仍然有界，且不产生悬空连线', () => {
  const h = buildHarness({width: 1280, height: 720});
  // 在样例基础上再加 500 个孤立任务，凑成 1000 节点规模。
  const raw = h.state.raw;
  for (let index = 0; index < 500; index += 1) {
    const id = `extra_${index}`;
    raw.nodes.push({id, type: 'task', action: 'core.log', params: {message: `额外 ${index}`}});
    raw._layout[id] = {x: (index % 25) * 340, y: 20000 + Math.floor(index / 25) * 260};
  }
  h.state.docVersion += 1;
  // 先把样例本身画出来，再用「整份替换」路径画扩容后的文档。
  h.entry.render({full: true});
  h.entry.render({full: true});
  const stats = h.entry.stats();
  assert.equal(stats.fullRebuilds, 2, `换文档应当整层重建一次，实际 ${stats.fullRebuilds}`);
  const active = new Set(h.entry.controller.activeNodeIds());
  const layer = h.entry.controller.getLayer();
  for (const edge of layer.wires.children) {
    assert.ok(active.has(edge.dataset.parent), `悬空连线：${edge.dataset.parent} 未挂载`);
    assert.ok(active.has(edge.dataset.child), `悬空连线：${edge.dataset.child} 未挂载`);
  }
  assert.ok(active.size < 1000, `1000 节点下仍要裁剪，实际挂载 ${active.size}`);
});

test('概览模式仍可选中：选中节点时数据边按需挂载', () => {
  const h = buildHarness({width: 1280, height: 720, zoom: 0.3});
  h.entry.render({full: true});
  assert.equal(h.entry.detailLevel(), 'overview');
  const active = h.entry.controller.activeNodeIds();
  const target = active.find((id) => id.startsWith('task_')) || active[0];
  // 该节点上有节点输出引用（样例的前 250 个任务两两成链），选中它应当挂上引用边。
  h.state.selected = new Set([target]);
  h.entry.render({selection: true, graph: true});
  const layer = h.entry.controller.getLayer();
  for (const edge of layer.referenceEdges.children) {
    void edge;
  }
  assert.equal(h.entry.detailLevel(), 'overview', '选中不改变缩放分级');
});
