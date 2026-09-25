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
  const calls = {rendered: 0, mutated: 0, renderFlags: []};
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
    // 组内被边界行代表的变量（组内不画的卡片）：组内排列不得碰它们。
    groupRepresentedRefs: options.groupRepresentedRefs,
    // 锁定的卡片自动排列时保持原位；「当前组」由调用方给出（进组或选中组卡）。
    isLocked: options.isLocked,
    currentNodeGroupId: options.currentNodeGroupId,
    wrap,
    minimap: () => options.minimap || null,
    render: (flags) => { calls.rendered += 1; calls.renderFlags.push(flags); },
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

test('自动排列：纯数据卡片贴在引用它的卡片左边，不再排到整张图右边', () => {
  // 值卡片（Break / 布尔判断）没有执行父级：旧算法把它们当成独立的树，
  // 于是各自占一整条横向档位、被推到整张图最右边，数据线横跨半个画布。
  const raw = {root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['seq']},
    {id: 'seq', type: 'sequence', children: ['a', 'cond']},
    {id: 'a', type: 'task', params: {}},
    {id: 'break_1', type: 'break', ref: {ref: 'nodes.a.output'}},
    {id: 'bool_1', type: 'bool_judge', expression: {eq: [{ref: 'nodes.break_1.output.state'}, 'settlement']}},
    {id: 'cond', type: 'condition', children: [], expression: {ref: 'nodes.bool_1.output.value'}},
  ]};
  const pins = {
    break_1: [{param: 'ref', value: {ref: 'nodes.a.output'}}],
    bool_1: [{param: 'left', value: {ref: 'nodes.break_1.output.state'}}, {param: 'right', value: 'settlement'}],
    cond: [{param: 'condition', value: {ref: 'nodes.bool_1.output.value'}}],
  };
  const h = harness(raw, {nodeVariablePins: (node) => pins[node.id] || []});
  h.viewport.autoLayout(false);
  const layout = h.state.raw._layout;
  // 数据链读成「左 → 右」：break_1 → bool_1 → cond。
  assert.ok(layout.bool_1.x < layout.cond.x, `布尔判断应该在判断卡左边（${layout.bool_1.x} < ${layout.cond.x}）`);
  assert.ok(layout.break_1.x < layout.bool_1.x, `拆分卡应该在布尔判断左边（${layout.break_1.x} < ${layout.bool_1.x}）`);
  // 与使用者同一行：数据从左侧水平流入，不上下乱跳。
  assert.equal(layout.bool_1.y, layout.cond.y);
  assert.equal(layout.break_1.y, layout.bool_1.y);
});

test('自动排列：没有使用者的孤立值卡片仍补在第一行，不会重叠', () => {
  const raw = {root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task', params: {}},
    {id: 'bool_1', type: 'bool_judge', expression: {eq: [0, 0]}},
  ]};
  const h = harness(raw, {nodeVariablePins: () => []});
  h.viewport.autoLayout(false);
  const layout = h.state.raw._layout;
  assert.ok(Number.isFinite(layout.bool_1.x) && Number.isFinite(layout.bool_1.y));
  assert.notEqual(`${layout.bool_1.x},${layout.bool_1.y}`, `${layout.a.x},${layout.a.y}`);
});

test('自动排列的行距跟着卡片实际高度走：高卡片不会压到下一层', () => {
  // 卡片高度随参数行数变化（固定卡片一行 28px，6 项的卡就有 264px）。行距写死 baseHeight + 112
  // 时，高卡片会盖住下一层的卡片——预览里看到的就是一层层互相叠住的虚线框。
  const raw = {root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['big']},
    {id: 'big', type: 'task', children: ['leaf'], params: {}},
    {id: 'leaf', type: 'task', params: {}},
  ]};
  const tall = 264;
  const h = harness(raw, {nodeHeight: (node) => (node.id === 'big' ? tall : 96)});
  const positions = h.viewport.autoLayoutPreview('all');
  assert.equal(positions.root.y, 0);
  assert.equal(positions.big.y, 96 + 112, '第一层按 root 的实际高度让位');
  assert.equal(positions.leaf.y, positions.big.y + tall + 112, '下一层要按 big 的实际高度让位，而不是固定 208');
  assert(positions.leaf.y - positions.big.y >= tall, '层与层之间不能重叠');

  // 高度都是 baseHeight 时行为不变：老用例（深度 × 208）继续成立。
  const plain = harness(tree());
  assert.deepEqual(plain.viewport.autoLayoutPreview('all'), {a: {x: 0, y: 416}, b: {x: 332, y: 416}, seq: {x: 166, y: 208}, root: {x: 166, y: 0}});
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

test('组内自动排列：被组边界行代表的卡片不动（组内根本不画它）', () => {
  // 组边界卡的「重新校验」行代表 inputs.v_edge：组内视图不画这张卡（variableCardList 过滤掉了），
  // 组内排列也不许搬它——否则用户在组内看不到任何变化，出组才发现外层那张卡片跳走了。
  const raw = {
    root: 'root',
    nodes: [
      {id: 'b', type: 'task', params: {x: {ref: 'inputs.v_in'}, y: {ref: 'inputs.v_edge'}}},
      {id: 'c', type: 'task', params: {}},
    ],
    inputs: {v_in: {type: 'number'}, v_edge: {type: 'number'}},
    _variableCards: {
      card_edge: {name: 'v_edge', scope: 'inputs', x: -224, y: 544},
      card_in: {name: 'v_in', scope: 'inputs', x: 100, y: 200},
    },
    _nodeGroups: {node_group_1: {name: '节点组 1', nodeIds: ['b', 'c'], pins: [{nodeId: 'b', param: 'y'}]}},
    _layout: {b: {x: -504, y: 176}, c: {x: 496, y: 664}, node_group_1: {x: 0, y: 416}},
  };
  const projection = () => [
    {id: '__node_group_interface__:node_group_1', type: 'node_group_interface', children: ['b'], _nodeGroupInterface: true},
    {id: '__node_group_variables__:node_group_1', type: 'node_group_variables', children: [], _nodeGroupVariables: true},
    {id: 'b', type: 'task', children: ['c']},
    {id: 'c', type: 'task', children: []},
  ];
  const pins = (node) => node.id === 'b'
    ? [{param: 'x', scope: 'inputs', variable: 'v_in'}, {param: 'y', scope: 'inputs', variable: 'v_edge'}]
    : [];
  const h = harness(raw, {
    nodes: projection,
    nodeVariablePins: pins,
    // editor.variableCardList() 在组内会过滤掉这个引用对应的卡片（边界行代替了它）。
    groupRepresentedRefs: () => new Set(['inputs.v_edge']),
  });
  h.state.nodeGroupId = 'node_group_1';
  h.viewport.autoLayout();

  // 被边界行代表的卡片：坐标逐字不变（它的绑定节点 b 这次确实被重排了）。
  assert.deepEqual(h.state.raw._variableCards.card_edge, {name: 'v_edge', scope: 'inputs', x: -224, y: 544});
  // 没被边界行代表的卡片照旧贴着成员走。
  assert.deepEqual(h.state.raw._variableCards.card_in, {name: 'v_in', scope: 'inputs', x: -224, y: 288});
  // 反过来：外层排列（不在组内）时两条规则都不生效，被代表的卡片照旧贴到节点旁边。
  const outer = harness(JSON.parse(JSON.stringify(raw)), {nodeVariablePins: pins});
  outer.viewport.autoLayout();
  assert.deepEqual(outer.state.raw._variableCards.card_edge, {name: 'v_edge', scope: 'inputs', x: -224, y: 104});
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
  // 缩放只改视口：重绘必须带 viewport 标记，不能顺带重建面板（500 节点上就是每帧几毫秒）。
  assert.deepEqual(h.calls.renderFlags, [{viewport: true}]);

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

// —— 阶段 5：自动排列范围、锁定位置、排列预览、画布位置前进/后退 ——

test('自动排列范围=选中：只动选中的卡片，并按选区左上角为基准', () => {
  const raw = tree();
  raw._layout = {root: {x: 1000, y: 500}, seq: {x: 1000, y: 800}, a: {x: 900, y: 1100}, b: {x: 1300, y: 1100}};
  const h = harness(raw);
  h.state.selected = new Set(['a', 'b']);
  h.viewport.autoLayout(true, 'selected');
  // 基准 = 选区包围盒左上角 (900, 1100)；两张叶子横向排开。
  assert.deepEqual(h.state.raw._layout.a, {x: 900, y: 1100});
  assert.deepEqual(h.state.raw._layout.b, {x: 1232, y: 1100});
  // 范围外的卡片一个都不动。
  assert.deepEqual(h.state.raw._layout.root, {x: 1000, y: 500});
  assert.deepEqual(h.state.raw._layout.seq, {x: 1000, y: 800});
});

test('自动排列范围=当前组：只排组成员，组外保持原位', () => {
  const raw = {
    root: 'root',
    nodes: [
      {id: 'root', type: 'root', children: ['g1', 'g2']},
      {id: 'g1', type: 'task', params: {}},
      {id: 'g2', type: 'task', params: {}},
    ],
    _layout: {root: {x: 0, y: 0}, g1: {x: 900, y: 700}, g2: {x: 1500, y: 700}},
    _nodeGroups: [{id: 'grp', name: '组', nodeIds: ['g1'], pins: [], pinPolicy: 'explicit-v1'}],
  };
  const h = harness(raw, {currentNodeGroupId: () => 'grp'});
  h.viewport.autoLayout(true, 'group');
  // 组里只有 g1：排到组包围盒左上角（原位）。
  assert.deepEqual(h.state.raw._layout.g1, {x: 900, y: 700});
  assert.deepEqual(h.state.raw._layout.g2, {x: 1500, y: 700}, '组外卡片不动');
  assert.deepEqual(h.state.raw._layout.root, {x: 0, y: 0});
});

test('自动排列：锁定的卡片保持原位，只作为父级居中的锚点', () => {
  const raw = tree();
  raw._layout = {root: {x: 500, y: 300}, seq: {x: 500, y: 100}, a: {x: 900, y: 900}, b: {x: 1300, y: 900}};
  raw._layoutLocks = ['a'];
  const h = harness(raw, {isLocked: (id) => id === 'a'});
  h.viewport.autoLayout(false);
  assert.deepEqual(h.state.raw._layout.a, {x: 900, y: 900}, '锁定的卡片位置不动');
  // 未锁的 b 排到第一个叶子位（a 锁定时不占叶子槽，父级用 a 的当前横坐标居中）。
  assert.equal(h.state.raw._layout.b.y, 416);
  assert.equal(typeof h.state.raw._layout.b.x, 'number');
});

test('autoLayoutPreview 只算不写：不产生历史也不改文档', () => {
  const raw = tree();
  raw._layout = {root: {x: 0, y: 0}};
  const h = harness(raw);
  const positions = h.viewport.autoLayoutPreview('all');
  assert.equal(h.calls.mutated, 0, '预览不进历史');
  assert.deepEqual(raw._layout, {root: {x: 0, y: 0}}, '预览不碰文档');
  assert.deepEqual(Object.keys(positions).sort(), ['a', 'b', 'root', 'seq']);
  assert.deepEqual(positions.root, {x: 166, y: 0});
});

test('applyLayoutPositions 写入预览位置：一次写入、卡片跟随', () => {
  const raw = tree();
  const h = harness(raw);
  const positions = h.viewport.autoLayoutPreview('all');
  h.viewport.applyLayoutPositions(positions);
  assert.deepEqual(h.state.raw._layout.a, {x: 0, y: 416});
  assert.deepEqual(h.state.raw._layout.root, {x: 166, y: 0});
});

test('画布位置后退/前进：在快照之间移动，边缘处返回 false', () => {
  const h = harness(tree());
  h.state.panX = 80; h.state.panY = 48; h.state.zoom = 1;
  h.viewport.recordViewport();                       // 快照 0
  h.state.panX = 200; h.state.panY = 120; h.state.zoom = 1.5;
  h.viewport.recordViewport();                       // 快照 1
  assert.deepEqual(h.viewport.viewportHistoryState(), {canBack: true, canForward: false, length: 2});

  assert.equal(h.viewport.viewportBack(), true);
  assert.equal(h.state.panX, 80);
  assert.equal(h.state.panY, 48);
  assert.equal(h.state.zoom, 1);
  assert.deepEqual(h.viewport.viewportHistoryState(), {canBack: false, canForward: true, length: 2});

  assert.equal(h.viewport.viewportForward(), true);
  assert.equal(h.state.panX, 200);
  assert.equal(h.state.zoom, 1.5);
  assert.equal(h.viewport.viewportForward(), false, '已经在最新位置');

  h.viewport.viewportBack();
  assert.equal(h.viewport.viewportBack(), false, '已经在最早位置');
});

test('画布位置历史：重复快照不重复入栈，中间操作会丢弃「未来」分支', () => {
  const h = harness(tree());
  h.viewport.recordViewport();
  h.viewport.recordViewport();
  assert.equal(h.viewport.viewportHistoryState().length, 1, '相同快照只留一条');

  h.state.panX = 300;
  h.viewport.recordViewport();
  h.viewport.viewportBack();
  assert.equal(h.viewport.viewportHistoryState().canForward, true);
  // 后退之后再产生新位置：前进分支被丢弃。
  h.state.panX = 500;
  h.viewport.recordViewport();
  assert.equal(h.viewport.viewportHistoryState().canForward, false);
  assert.equal(h.viewport.viewportHistoryState().length, 2);
});
