// Run via npm test (builds the renderer test output first).
// 画布小地图：按包围盒与视口绘制缩略元素，验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createCanvasMinimap } = require('../dist-test-renderer/canvas/canvas/minimap.js');

function harness(options = {}) {
  const state = createCanvasState();
  let cleared = 0;
  const mini = {
    attrs: {},
    children: [],
    set innerHTML(value) { cleared += 1; this.children = []; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
  const svgEl = (tag, attrs, parent) => {
    const node = {tag, attrs};
    parent.children.push(node);
    return node;
  };
  const minimap = createCanvasMinimap({
    state,
    $: () => mini,
    svgEl,
    bounds: () => options.bounds || {minX: 10, minY: 20, maxX: 110, maxY: 120},
    nodes: () => options.nodes || [],
    position: () => options.position || {x: 50, y: 60},
    nodeHeight: () => options.nodeHeight ?? 96,
    instanceRunCards: () => options.runCards || [],
    variableCardList: () => options.cards || [],
    wrap: {getBoundingClientRect: () => ({width: 400, height: 300})},
    nodeWidth: 260,
    runCardWidth: 250,
    variableCardWidth: 168,
    variableCardHeight: 58,
  });
  return {state, minimap, mini, cleared: () => cleared};
}

test('小地图按包围盒加内边距并包含所有卡片类型与视口框', () => {
  const h = harness({
    nodes: [{id: 'n', type: 'task'}],
    runCards: [{x: 1, y: 2, height: 78}],
    cards: [{x: 3, y: 4}],
  });
  h.state.panX = -40;
  h.state.panY = -56;
  h.state.zoom = 2;
  h.minimap.renderMinimap();
  assert.equal(h.mini.attrs.viewBox, '-30 -20 180 180');
  assert.deepEqual(h.mini.children, [
    {tag: 'rect', attrs: {class: 'mini-node type-task', x: 50, y: 60, width: 260, height: 96}},
    {tag: 'rect', attrs: {class: 'mini-node type-instance-run', x: 1, y: 2, width: 250, height: 78}},
    {tag: 'rect', attrs: {class: 'mini-node type-variable-card', x: 3, y: 4, width: 168, height: 58}},
    {tag: 'rect', attrs: {class: 'mini-viewport', x: 20, y: 28, width: 200, height: 150}},
  ]);
});

test('小地图重绘前清空自身内容', () => {
  const h = harness();
  h.minimap.renderMinimap();
  h.minimap.renderMinimap();
  assert.equal(h.cleared(), 2);
  assert.equal(h.mini.children.length, 1);
});

test('空内容时包围盒保持最小尺寸', () => {
  const h = harness({bounds: {minX: 0, minY: 0, maxX: 0, maxY: 0}});
  h.minimap.renderMinimap();
  assert.equal(h.mini.attrs.viewBox, '-40 -40 80 80');
});
