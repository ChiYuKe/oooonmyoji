// Run via npm test (builds the renderer test output first).
// 画布小地图：按包围盒与视口绘制缩略元素，并验证「结构重建」与「视口框更新」已解耦。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createCanvasMinimap, MINIMAP_DRAG_INTERVAL_MS } = require('../dist-test-renderer/canvas/canvas/minimap.js');

function harness(options = {}) {
  const state = createCanvasState();
  let cleared = 0;
  let positions = options.positions || {n: {x: 50, y: 60}};
  const mini = {
    attrs: {},
    children: [],
    set innerHTML(value) { cleared += 1; this.children = []; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
  const svgEl = (tag, attrs, parent) => {
    const node = {tag, attrs, setAttribute(name, value) { this.attrs[name] = value; }};
    parent.children.push(node);
    return node;
  };
  const minimap = createCanvasMinimap({
    state,
    $: () => mini,
    svgEl,
    bounds: () => options.bounds || {minX: 10, minY: 20, maxX: 110, maxY: 120},
    nodes: () => options.nodes || [],
    position: (node) => positions[node.id] || {x: 50, y: 60},
    nodeHeight: () => options.nodeHeight ?? 96,
    instanceRunCards: () => options.runCards || [],
    variableCardList: () => options.cards || [],
    // 阶段 5 标记：运行状态着色与「按状态/类型隐藏」的过滤。
    nodeRunStatus: options.nodeRunStatus,
    isNodeFiltered: options.isNodeFiltered,
    wrap: {getBoundingClientRect: () => ({width: 400, height: 300})},
    nodeWidth: 260,
    runCardWidth: 250,
    variableCardWidth: 168,
    variableCardHeight: 58,
  });
  return {
    state, minimap, mini,
    cleared: () => cleared,
    move: (next) => { positions = next; },
  };
}

test('小地图按包围盒加内边距并包含所有卡片类型与视口框', () => {
  const h = harness({
    nodes: [{id: 'n', type: 'task'}],
    runCards: [{x: 1, y: 2, height: 78, key: 'n:0'}],
    cards: [{id: 'card_1', x: 3, y: 4}],
  });
  h.state.panX = -40;
  h.state.panY = -56;
  h.state.zoom = 2;
  h.minimap.renderMinimap();
  assert.equal(h.mini.attrs.viewBox, '-30 -20 180 180');
  assert.deepEqual(h.mini.children.map((child) => ({tag: child.tag, attrs: child.attrs})), [
    {tag: 'rect', attrs: {class: 'mini-node type-task', x: 50, y: 60, width: 260, height: 96}},
    {tag: 'rect', attrs: {class: 'mini-node type-instance-run', x: 1, y: 2, width: 250, height: 78}},
    {tag: 'rect', attrs: {class: 'mini-node type-variable-card', x: 3, y: 4, width: 168, height: 58}},
    {tag: 'rect', attrs: {class: 'mini-viewport', x: '20', y: '28', width: '200', height: '150'}},
  ]);
});

test('平移缩放只更新视口框：结构未变时不重建、不清空', () => {
  const h = harness();
  h.minimap.renderMinimap();
  const afterFirst = h.mini.children.length;
  assert.equal(h.cleared(), 1);
  assert.equal(h.minimap.structureBuilds(), 1);

  // 视口变化：结构签名不变，只更新 mini-viewport。
  h.state.panX = -80;
  h.state.zoom = 1;
  h.minimap.renderMinimap();
  h.minimap.renderMinimap();
  assert.equal(h.cleared(), 1, '同一结构下不应清空重建');
  assert.equal(h.mini.children.length, afterFirst);
  assert.equal(h.minimap.structureBuilds(), 1);
  assert.equal(h.minimap.viewportUpdates(), 3);
  const viewport = h.mini.children.find((child) => child.attrs.class === 'mini-viewport');
  assert.equal(viewport.attrs.width, '400');
});

test('节点位置变化触发结构重建', () => {
  const h = harness({nodes: [{id: 'n', type: 'task'}]});
  h.minimap.renderMinimap();
  assert.equal(h.minimap.structureBuilds(), 1);
  h.move({n: {x: 500, y: 300}});
  h.minimap.renderMinimap();
  assert.equal(h.cleared(), 2);
  assert.equal(h.minimap.structureBuilds(), 2);
  const node = h.mini.children.find((child) => child.attrs.class === 'mini-node type-task');
  assert.equal(node.attrs.x, 500);
  assert.equal(node.attrs.y, 300);
});

test('拖拽期间结构更新按 100 毫秒节流，视口框仍然更新', () => {
  const h = harness({nodes: [{id: 'n', type: 'task'}]});
  h.state.drag = {kind: 'nodes'};
  h.minimap.renderMinimap({now: 1000});
  assert.equal(h.minimap.structureBuilds(), 1);
  h.move({n: {x: 200, y: 100}});
  h.minimap.renderMinimap({now: 1000 + MINIMAP_DRAG_INTERVAL_MS - 1});
  assert.equal(h.minimap.structureBuilds(), 1, '节流窗口内不重建结构');
  h.minimap.renderMinimap({now: 1000 + MINIMAP_DRAG_INTERVAL_MS});
  assert.equal(h.minimap.structureBuilds(), 2, '超过窗口后重建一次');
  // 松手后立刻精确更新。
  h.state.drag = null;
  h.move({n: {x: 700, y: 400}});
  h.minimap.renderMinimap({now: 1000 + MINIMAP_DRAG_INTERVAL_MS + 1});
  assert.equal(h.minimap.structureBuilds(), 3);
});

test('空内容时包围盒保持最小尺寸', () => {
  const h = harness({bounds: {minX: 0, minY: 0, maxX: 0, maxY: 0}});
  h.minimap.renderMinimap();
  assert.equal(h.mini.attrs.viewBox, '-40 -40 80 80');
});

// —— 阶段 5：小地图标记运行中 / 失败 / 搜索目标，并跳过被隐藏的卡片 ——

test('小地图按运行状态着色：运行中与失败各自带状态 class', () => {
  const h = harness({
    nodes: [{id: 'run', type: 'task'}, {id: 'bad', type: 'task'}, {id: 'idle', type: 'task'}],
    nodeRunStatus: (node) => ({run: 'running', bad: 'failed'}[node.id] || ''),
  });
  h.minimap.renderMinimap();
  const classes = h.mini.children
    .filter((child) => child.tag === 'rect' && String(child.attrs.class).startsWith('mini-node'))
    .map((child) => child.attrs.class);
  assert.deepEqual(classes, [
    'mini-node type-task run-running',
    'mini-node type-task run-failed',
    'mini-node type-task',
  ]);
});

test('小地图标出搜索/定位目标：独立 class，不跟状态色抢', () => {
  const h = harness({
    nodes: [{id: 'a', type: 'task'}, {id: 'b', type: 'task'}],
    nodeRunStatus: (node) => (node.id === 'a' ? 'failed' : ''),
  });
  h.state.searchTargetId = 'a';
  h.minimap.renderMinimap();
  const target = h.mini.children.find((child) => String(child.attrs.class).includes('mini-search-target'));
  assert.equal(target.attrs.class, 'mini-node type-task run-failed mini-search-target');
  // 目标变化要触发结构重建（否则小地图上的标记停在旧卡片上）。
  h.state.searchTargetId = 'b';
  h.minimap.renderMinimap();
  assert.equal(h.minimap.structureBuilds(), 2);
});

test('被「按状态/类型隐藏」筛掉的卡片不在小地图上出现', () => {
  const h = harness({
    nodes: [{id: 'keep', type: 'task'}, {id: 'gone', type: 'task'}],
    isNodeFiltered: (node) => node.id === 'gone',
  });
  h.minimap.renderMinimap();
  const ids = h.mini.children.filter((child) => child.tag === 'rect' && String(child.attrs.class).startsWith('mini-node')).map((child) => child.attrs.x);
  assert.equal(ids.length, 1, '被隐藏的卡片不画缩略矩形');
});

test('小地图不再每帧清空：整体重建只发生在 invalidate 之后', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  assert.match(css, /\.mini-viewport\s*\{/, '视口框仍由样式单独控制');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/canvas/minimap.ts'), 'utf8');
  assert.doesNotMatch(source, /^\s+mini\.innerHTML = ''$/m, '结构重建不再是无条件清空');
});
