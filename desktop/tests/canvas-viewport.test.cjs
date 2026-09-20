// Run via npm test (builds the renderer test output first).
// 画布视口与布局计算：自动布局、包围盒、适配、缩放与坐标换算验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createCanvasViewport } = require('../dist-test-renderer/canvas/canvas/viewport.js');

function harness(raw, options = {}) {
  const state = createCanvasState();
  state.raw = raw;
  const model = createWorkflowModel(state);
  const calls = {rendered: 0, mutated: 0};
  const wrap = {getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300}), clientWidth: 400, clientHeight: 300};
  const viewport = createCanvasViewport({
    state,
    // 默认用真实节点；验证折叠节点组时传入投影视图（含组卡、不含折叠起来的成员）。
    nodes: options.nodes ?? model.nodes,
    position: model.position,
    layout: model.layout,
    mutate: (fn) => { calls.mutated += 1; fn(); },
    instanceRunCards: () => options.runCards || [],
    variableCardList: model.variableCardList,
    nodeHeight: options.nodeHeight || (() => 96),
    // 自动排列按变量端点判断卡片归属；缺省时只看显式连线。
    nodeVariablePins: options.nodeVariablePins,
    wrap,
    minimap: () => options.minimap || null,
    render: () => { calls.rendered += 1; },
    nodeWidth: 260,
    baseHeight: 96,
    runCardWidth: 250,
    variableCardWidth: 168,
    variableCardHeight: 58,
  });
  return {state, model, viewport, calls};
}

function tree() {
  return {root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['seq']},
    {id: 'seq', type: 'sequence', children: ['a', 'b']},
    {id: 'a', type: 'task', params: {}},
    {id: 'b', type: 'task', params: {}},
  ]};
}

test('autoLayout 叶子横向排开、父节点居中、深度决定纵向', () => {
  const h = harness(tree());
  h.viewport.autoLayout(false);
  assert.equal(h.calls.mutated, 0);
  assert.deepEqual(h.state.raw._layout, {
    a: {x: 0, y: 416},
    b: {x: 332, y: 416},
    seq: {x: 166, y: 208},
    root: {x: 166, y: 0},
  });
  const recorded = harness(tree());
  recorded.viewport.autoLayout();
  assert.equal(recorded.calls.mutated, 1);
});

test('autoLayout 为未连边的孤立节点补位', () => {
  const h = harness({root: 'root', nodes: [
    {id: 'root', type: 'root', children: []},
    {id: 'lonely', type: 'task', params: {}},
  ]});
  h.viewport.autoLayout(false);
  assert.deepEqual(h.state.raw._layout.root, {x: 0, y: 0});
  assert.deepEqual(h.state.raw._layout.lonely, {x: 332, y: 0});
});

test('自动排列把绑定卡片贴到所属节点旁边（左侧、参数行对齐），未绑定卡片跟随整张图的位移', () => {
  const raw = tree();
  raw.inputs = {超时: {type: 'number'}};
  raw._layout = {root: {x: 1000, y: 0}, seq: {x: 1000, y: 208}, a: {x: 900, y: 416}, b: {x: 1232, y: 416}};
  raw._variableCards = {
    // 绑在 b 上（显式连线）：自动排列后贴到 b 左侧。
    card_1: {name: '超时', scope: 'inputs', x: 700, y: 400},
    // 没有绑定但在图的范围内：按整张图的包围盒位移跟随（保持相对位置）。
    card_2: {name: '超时', scope: 'inputs', x: 1200, y: 300},
  };
  raw._variableLinks = {'b:超时': 'card_1'};
  const h = harness(raw);
  h.viewport.autoLayout();
  // 自动排列后：a=(0,416)、b=(332,416)、seq=(166,208)、root=(166,0)。
  assert.deepEqual(h.state.raw._layout.b, {x: 332, y: 416});
  // 绑定卡片贴到 b 左侧：x = 332 - 168 - 56 = 108 → 对齐 8 的网格得 112；
  // 紧挨 b 的那一行左边已经被 a / seq 占着，于是纵向让开一格（+144）落在行间空隙里。
  assert.deepEqual(h.state.raw._variableCards.card_1, {name: '超时', scope: 'inputs', x: 112, y: 528});
  // 整张图的最左节点从 900 到 0：位移 (-900, 0)，图内的未绑定卡片同样跟随
  // （位移不是 8 的倍数，结果会重新对齐到 8 的网格）。
  assert.deepEqual(h.state.raw._variableCards.card_2, {name: '超时', scope: 'inputs', x: 304, y: 300});
});

test('绑定卡片即使停在 1500px 外，也会被贴回所属节点旁边', () => {
  // 复现真实文档里的现象：卡片绑定的变量被某个节点引用，但那个节点这次没挪窝
  // （位移 0），只跟着位移走的话卡片就留在 1500+ 像素外——`fitView` 把它算进包围盒，
  // 整张图被缩小、卡片孤零零飘在空白处。现在贴回它所属节点旁边。
  const raw = {
    root: 'root',
    nodes: [
      {id: 'root', type: 'root', children: ['seq']},
      {id: 'seq', type: 'sequence', children: ['a', 'b']},
      {id: 'a', type: 'task', params: {}},
      {id: 'b', type: 'task', params: {x: {ref: 'variables.v_x'}}},
    ],
    variables: {v_x: {type: 'number'}},
    _variableCards: {card_1: {name: 'v_x', scope: 'variables', x: -128, y: 2832}},
    _variableLinks: {},
    _layout: {root: {x: 0, y: 0}, seq: {x: 0, y: 208}, a: {x: 0, y: 416}, b: {x: 332, y: 416}},
  };
  const h = harness(raw, {
    // 端点按「作用域.变量名」唯一匹配找到卡片（旧文档没有 _variableLinks）。
    nodeVariablePins: (node) => node.id === 'b' ? [{param: 'x', scope: 'variables', variable: 'v_x'}] : [],
  });
  h.viewport.autoLayout();
  // b 在 (332,416)：卡片贴到它左侧并纵向对齐，纵向让开 a / seq 占着的行带。
  assert.deepEqual(h.state.raw._variableCards.card_1, {name: 'v_x', scope: 'variables', x: 112, y: 568});
});

test('没有绑定的卡片跑远了，才收回图的左侧列', () => {
  const raw = tree();
  raw.inputs = {超时: {type: 'number'}};
  raw._layout = {root: {x: 0, y: 0}, seq: {x: 0, y: 208}, a: {x: 0, y: 416}, b: {x: 332, y: 416}};
  // 没有 _variableLinks、没有任何端点引用它 → 找不到所属节点，只能收回图的左侧。
  raw._variableCards = {card_1: {name: '超时', scope: 'inputs', x: 6000, y: 9000}};
  const h = harness(raw);
  h.viewport.autoLayout();
  assert.deepEqual(h.state.raw._variableCards.card_1, {name: '超时', scope: 'inputs', x: -224, y: 0});
});

test('ensureLayout 的兜底布局不动卡片坐标', () => {
  const raw = tree();
  raw.inputs = {超时: {type: 'number'}};
  raw._variableCards = {card_1: {name: '超时', scope: 'inputs', x: 700, y: 400}};
  const h = harness(raw); // 没有任何 _layout → ensureLayout 会跑一次兜底布局
  h.viewport.ensureLayout();
  assert.deepEqual(h.state.raw._variableCards.card_1, {name: '超时', scope: 'inputs', x: 700, y: 400});
});

test('autoLayout 把折叠的节点组整组搬走（成员不留在原地）', () => {
  // 折叠时投影里只有组卡，成员不在其中：组卡被排进新网格后，成员必须跟着整组平移，
  // 否则进组/解散组时成员又会出现在空白处。
  const raw = {
    root: 'root',
    nodes: [
      {id: 'root', type: 'root', children: ['a']},
      {id: 'a', type: 'sequence', children: ['b']},
      {id: 'b', type: 'task', params: {}},
      {id: 'c', type: 'task', params: {}},
    ],
    _nodeGroups: {node_group_1: {name: '节点组 1', nodeIds: ['b', 'c'], pins: []}},
    _layout: {
      root: {x: 1000, y: 0}, a: {x: 1000, y: 208},
      b: {x: 1000, y: 416}, c: {x: 2000, y: 900},
      node_group_1: {x: 1504, y: 656},
    },
  };
  const projection = () => [
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'sequence', children: ['node_group_1']},
    {id: 'node_group_1', type: 'node_group', children: [], _nodeGroup: true},
  ];
  const h = harness(raw, {nodes: projection});
  h.viewport.autoLayout();
  assert.deepEqual(h.state.raw._layout.root, {x: 0, y: 0});
  assert.deepEqual(h.state.raw._layout.a, {x: 0, y: 208});
  assert.deepEqual(h.state.raw._layout.node_group_1, {x: 0, y: 416});
  // 组卡位移 (-1504, -240)：两个成员整组平移，组内相对关系不变。
  assert.deepEqual(h.state.raw._layout.b, {x: -504, y: 176});
  assert.deepEqual(h.state.raw._layout.c, {x: 496, y: 664});
});

test('组内自动排列：只排成员，组卡位置与组外卡片一律不碰', () => {
  // 用户要求：组内自动排列不影响组外。组卡位置属于外层布局，组外卡片也不归这次排列管。
  const raw = {
    root: 'root',
    nodes: [
      {id: 'b', type: 'task', params: {}},
      {id: 'c', type: 'task', params: {}},
      {id: 'outside', type: 'task', params: {x: {ref: 'variables.v_out'}}},
    ],
    variables: {v_out: {type: 'number'}, v_in: {type: 'number'}},
    _variableCards: {
      // 挂在组外节点上的卡片：组内排列一个像素都不该动。
      card_out: {name: 'v_out', scope: 'variables', x: -128, y: 2832},
      // 挂在组成员 b 上的卡片：跟着成员一起搬。
      card_in: {name: 'v_in', scope: 'variables', x: 100, y: 200},
    },
    _nodeGroups: {node_group_1: {name: '节点组 1', nodeIds: ['b', 'c'], pins: []}},
    _layout: {
      b: {x: -504, y: 176}, c: {x: 496, y: 664},
      outside: {x: 4000, y: 4000},
      node_group_1: {x: 0, y: 416},
    },
  };
  // 进组后的投影：接口卡 + 成员（组卡不在其中）。成员之间的边保留（b → c）。
  const projection = () => [
    {id: '__node_group_interface__:node_group_1', type: 'node_group_interface', children: ['b'], _nodeGroupInterface: true},
    {id: 'b', type: 'task', children: ['c']},
    {id: 'c', type: 'task', children: []},
  ];
  const h = harness(raw, {
    nodes: projection,
    nodeVariablePins: (node) => node.id === 'b' ? [{param: 'x', scope: 'variables', variable: 'v_in'}] : [],
  });
  h.state.nodeGroupId = 'node_group_1';
  h.viewport.autoLayout();

  // 组内也按树排：接口卡（深度 0）→ b（深度 1）→ c（深度 2），不再是平铺一行。
  assert.deepEqual(h.state.raw._layout.b, {x: 0, y: 208});
  assert.deepEqual(h.state.raw._layout.c, {x: 0, y: 416});
  // 组卡在外层的位置不动（组内排列不重排组外）。
  assert.deepEqual(h.state.raw._layout.node_group_1, {x: 0, y: 416});
  // 组外节点不动。
  assert.deepEqual(h.state.raw._layout.outside, {x: 4000, y: 4000});
  // 组外卡片不动（以前会被「跑远了就收回图左侧」的规则搬走）。
  assert.deepEqual(h.state.raw._variableCards.card_out, {name: 'v_out', scope: 'variables', x: -128, y: 2832});
  // 挂在成员 b 上的卡片贴着 b 放：x = 0 - 168 - 56 → -224，纵向对齐 b 的那一行。
  assert.deepEqual(h.state.raw._variableCards.card_in, {name: 'v_in', scope: 'variables', x: -224, y: 288});
});

test('组内视图的包围盒只算本组内容：组外卡片不会把 fitView 拉远', () => {
  const raw = {
    root: 'root',
    nodes: [
      {id: 'b', type: 'task', params: {}},
      {id: 'outside', type: 'task', params: {x: {ref: 'variables.v_out'}}},
    ],
    variables: {v_out: {type: 'number'}, v_in: {type: 'number'}},
    _variableCards: {
      // 组外卡片停在很远处：外层排列会把它收回图内，但**组内视图**绝不能把它算进包围盒。
      card_out: {name: 'v_out', scope: 'variables', x: 5000, y: 6000},
      card_in: {name: 'v_in', scope: 'variables', x: 70, y: 80},
    },
    _nodeGroups: {node_group_1: {name: '节点组 1', nodeIds: ['b'], pins: []}},
    _layout: {b: {x: -400, y: -300}, outside: {x: 0, y: 0}, node_group_1: {x: 0, y: 0}},
  };
  const projection = () => [
    {id: '__node_group_interface__:node_group_1', type: 'node_group_interface', children: ['b'], _nodeGroupInterface: true},
    {id: 'b', type: 'task', children: []},
  ];
  const h = harness(raw, {
    nodes: projection,
    nodeVariablePins: (node) => node.id === 'b' ? [{param: 'x', scope: 'variables', variable: 'v_in'}] : [],
  });
  // 外层：远处的卡片也算进包围盒（所以自动排列会把它收回来）。
  assert.deepEqual(h.viewport.bounds(), {minX: -400, minY: -300, maxX: 5000 + 168, maxY: 6000 + 58});
  // 组内：只算挂在成员 b 上的卡片 → 那个 5000/6000 的组外卡片不会把 fitView 拉远。
  h.state.nodeGroupId = 'node_group_1';
  assert.deepEqual(h.viewport.bounds(), {minX: -400, minY: -300, maxX: 260, maxY: 138});
});

test('ensureLayout 仅在缺坐标时自动布局', () => {
  const h = harness(tree());
  h.state.raw._layout = {root: {x: 0, y: 0}, seq: {x: 0, y: 0}, a: {x: 0, y: 0}, b: {x: 0, y: 0}};
  h.viewport.ensureLayout();
  assert.equal(h.calls.mutated, 0);
  assert.deepEqual(h.state.raw._layout.seq, {x: 0, y: 0});
  const missing = harness(tree());
  missing.viewport.ensureLayout();
  assert.deepEqual(missing.state.raw._layout.seq, {x: 166, y: 208});
});

test('bounds 合并节点、实例卡与变量卡', () => {
  const h = harness({root: 'n', nodes: [{id: 'n', type: 'task', params: {}}], inputs: {超时: {type: 'number'}}, _layout: {n: {x: 100, y: 50}}}, {
    runCards: [{x: 20, y: 10, height: 78}],
  });
  h.model.variableCards().card_1 = {name: '超时', scope: 'inputs', x: 5, y: 5};
  assert.deepEqual(h.viewport.bounds(), {minX: 5, minY: 5, maxX: 360, maxY: 146});
  const empty = harness(null);
  assert.deepEqual(empty.viewport.bounds(), {minX: 0, minY: 0, maxX: 260, maxY: 96});
});

test('worldPoint 与 zoomAt 按视口换算并限制缩放范围', () => {
  const h = harness(tree());
  h.state.panX = 10; h.state.panY = 20; h.state.zoom = 2;
  assert.deepEqual(h.viewport.worldPoint({clientX: 30, clientY: 60}), {x: 10, y: 20});

  h.state.zoom = 1; h.state.panX = 80; h.state.panY = 48;
  h.viewport.zoomAt(2);
  assert.equal(h.state.zoom, 2);
  assert.equal(h.state.panX, -40);
  assert.equal(h.state.panY, -54);
  assert.equal(h.calls.rendered, 1);

  h.viewport.zoomAt(10);
  assert.equal(h.state.zoom, 2.5);
  h.viewport.zoomAt(0.001);
  assert.equal(h.state.zoom, 0.25);
});

test('fitView 为小地图预留底部空间并居中内容', () => {
  const h = harness(tree(), {minimap: {getBoundingClientRect: () => ({height: 60})}});
  h.state.raw._layout = {root: {x: 0, y: 0}, seq: {x: 0, y: 0}, a: {x: 0, y: 0}, b: {x: 0, y: 0}};
  h.viewport.fitView();
  const zoom = 216 / 256;
  assert.equal(h.state.zoom, zoom);
  assert.equal(h.state.panX, (400 - 260 * zoom) / 2);
  assert.equal(h.state.panY, (216 - 96 * zoom) / 2);
  assert.equal(h.calls.rendered, 1);
});

test('bezier 输出带最小弯曲量的三次曲线', () => {
  const h = harness(tree());
  assert.equal(h.viewport.bezier(0, 0, 100, 20), 'M 0 0 C 0 48, 100 -28, 100 20');
});
