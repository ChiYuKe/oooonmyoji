// Run via npm test (builds the renderer test output first).
// 画布连线渲染：父子连线、实例运行连线、拖拽预览与变量连线验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createCanvasEdges, dataEdgeTone } = require('../dist-test-renderer/canvas/canvas/edges.js');

function fakeNode(tag, attrs = {}) {
  return {
    tag, attrs, children: [], dataset: {}, events: {}, textContent: '',
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); },
    fire(name, extra = {}) { for (const fn of this.events[name] || []) fn({button: 0, preventDefault() {}, stopPropagation() {}, altKey: false, ...extra}); },
    querySelectorAll(selector) {
      const cls = selector.replace(/^\./, '');
      return this.children.flatMap((child) => [...((child.attrs.class || '').split(' ').includes(cls) ? [child] : []), ...child.querySelectorAll(selector)]);
    },
  };
}

function harness(nodes, options = {}) {
  const state = createCanvasState();
  state.raw = {root: 'root', nodes};
  const calls = {disconnected: [], disconnectedPins: [], disconnectedInstance: [], disconnectedReferences: [], mutated: 0, rendered: 0, inspector: []};
  const edges = createCanvasEdges({
    state,
    svgEl: (tag, attrs, parent) => { const node = fakeNode(tag, attrs); parent.children.push(node); return node; },
    bezier: (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x2} ${y2}`,
    nodes: () => state.raw.nodes,
    nodeById: (id) => state.raw.nodes.find((node) => node.id === id) || null,
    referenceSourceById: options.referenceSourceById,
    edgeRunTargetIds: options.edgeRunTargetIds,
    // 阶段 6：连线上的校验问题（有的话连线涂红并给出悬停说明）。
    edgeIssues: options.edgeIssues,
    position: (node) => (options.positions && options.positions[node.id]) || {x: 0, y: 0},
    nodeHeight: () => options.nodeHeight ?? 96,
    instanceRunCards: () => options.runCards || [],
    instanceRunInputPosition: (card, index) => ({x: card.x + 10, y: card.y + index * 24}),
    variableCardList: () => options.cards || [],
    nodeVariablePins: (node) => node.pins || [],
    variablePinPosition: (node, index) => ({x: 10, y: 96 + index * 24 + 12}),
    disconnect: (parent, child) => calls.disconnected.push([parent, child]),
    disconnectVariableFromPin: (nodeId, param) => calls.disconnectedPins.push([nodeId, param]),
    disconnectVariableFromInstanceInput: (nodeId, runIndex, param) => calls.disconnectedInstance.push([nodeId, runIndex, param]),
    disconnectReferenceFromPin: (nodeId, param) => calls.disconnectedReferences.push([nodeId, param]),
    mutate: (fn) => { calls.mutated += 1; fn(); },
    requestInspector: (selection) => calls.inspector.push(selection),
    render: () => { calls.rendered += 1; },
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    captureConnectionPointer: () => 7,
    nodeWidth: 260,
    runCardWidth: 250,
    baseHeight: 96,
    runVariableHeight: 24,
    variableCardWidth: 168,
    variableCardPortY: 29,
    variablePinX: 10,
    taskOutputPortY: 16,
  });
  return {state, edges, calls, layer: fakeNode('g')};
}

test('renderEdge 绘制选中状态、运行状态与顺序号并支持重连和断开', () => {  const h = harness([
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task'},
  ], {positions: {root: {x: 0, y: 0}, a: {x: 0, y: 300}}});
  h.state.selectedEdge = {parent: 'root', child: 'a'};
  h.state.run.set('a', {status: 'succeeded'});
  h.edges.renderEdge(h.layer, h.state.raw.nodes[0], 'a', 0);
  const group = h.layer.children[0];
  assert.equal(group.attrs.class, 'edge selected run-succeeded');
  assert.deepEqual(group.dataset, {parent: 'root', child: 'a'});
  const order = group.children.find((child) => child.attrs.class === 'edge-order');
  assert.equal(order.textContent, '1');
  assert.equal(group.children.find((child) => child.attrs.class === 'edge-hit').attrs.d, 'M 130 96 C 130 300');

  group.fire('dblclick');
  assert.deepEqual(h.calls.disconnected, [['root', 'a']]);
  assert.equal(h.calls.mutated, 1);

  const hit = group.children.find((child) => child.attrs.class === 'edge-hit');
  hit.fire('mousedown');
  assert.deepEqual(h.calls.inspector, [{kind: 'edge', parent: 'root', child: 'a'}]);
  assert.deepEqual(h.state.selectedEdge, {parent: 'root', child: 'a'});

  const rewire = group.children.find((child) => child.attrs.class === 'edge-rewire');
  rewire.fire('pointerdown', {clientX: 5, clientY: 6});
  assert.deepEqual(h.state.connect, {direction: 'from-output', parent: 'root', x: 5, y: 6, oldChild: 'a', oldIndex: 0, hover: null, pointerId: 7});
});

test('缩放分级只隐藏卡内元素，不改变卡片尺寸', () => {
  // 概览档曾经用 scaleY 把卡片压扁到 26%：缩小画布时卡片会突然变矮。
  // 现在分级只负责显隐，卡片尺寸始终等于布局尺寸，结构线也从真实底边出发。
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  assert.doesNotMatch(css, /--overview-card-scale/, '不得再保留概览压扁比例');
  assert.doesNotMatch(css, /scaleY\(/, '不得再用 scaleY 压扁卡片');
  const zoomSource = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/render/zoom-level.ts'), 'utf8');
  assert.doesNotMatch(zoomSource, /OVERVIEW_CARD_SCALE|visualNodeHeight/, '视觉高度不再与分级绑定');
  assert.equal(require('../dist-test-renderer/canvas/render/zoom-level.js').OVERVIEW_CARD_SCALE, undefined);

  const h = harness([
    {id: 'root', type: 'root', children: ['inside']},
    {id: 'inside', type: 'task'},
  ], {nodeHeight: 100, positions: {root: {x: 0, y: 0}, inside: {x: 0, y: 300}}});

  h.edges.renderEdge(h.layer, h.state.raw.nodes[0], 'inside', 0);
  const edgePath = h.layer.children[0].children.find((child) => child.attrs.class === 'edge-hit');
  assert.equal(edgePath.attrs.d, 'M 130 100 C 130 300', '连线起点必须落在卡片真实底边');
});

test('运行事件就地更新连线状态，无需等待视口重绘', () => {
  const h = harness([
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task'},
  ]);
  h.edges.renderEdge(h.layer, h.state.raw.nodes[0], 'a', 0);
  const group = h.layer.children[0];
  assert.equal(group.attrs.class, 'edge');

  h.state.run.set('a', {status: 'running'});
  assert.equal(h.edges.patchRunEdgeStates('a'), 1);
  assert.equal(group.attrs.class, 'edge run-running');

  h.state.run.set('a', {status: 'succeeded'});
  assert.equal(h.edges.patchRunEdgeStates('a'), 1);
  assert.equal(group.attrs.class, 'edge run-succeeded');

  h.state.run.clear();
  assert.equal(h.edges.patchRunEdgeStates(), 1);
  assert.equal(group.attrs.class, 'edge');
});

test('折叠组代理线继承组内真实入口节点的运行效果并实时刷新', () => {
  const h = harness([
    {id: 'selector', type: 'selector', children: ['group']},
    {id: 'group', type: 'node_group', _nodeGroup: true, children: []},
  ], {edgeRunTargetIds: (parentId, childId) => parentId === 'selector' && childId === 'group' ? ['inside'] : [childId]});
  h.edges.renderEdge(h.layer, h.state.raw.nodes[0], 'group', 2);
  const edge = h.layer.children[0];
  assert.equal(edge.attrs.class, 'edge edge-collapsed-group');

  h.state.run.set('inside', {status: 'running'});
  assert.equal(h.edges.patchRunEdgeStates('inside'), 1, '真实节点事件必须命中代理边');
  assert.equal(edge.attrs.class, 'edge run-running edge-collapsed-group');

  h.state.run.set('inside', {status: 'succeeded'});
  assert.equal(h.edges.patchRunEdgeStates('inside'), 1);
  assert.equal(edge.attrs.class, 'edge run-succeeded edge-collapsed-group');
  assert.equal(h.edges.patchRunEdgeStates('unrelated'), 0, '无关节点不触碰这条代理边');
});

test('多入口组代理线与组卡使用同一优先级，当前运行态不会显示成旧绿色', () => {
  const h = harness([
    {id: 'selector', type: 'selector', children: ['group']},
    {id: 'group', type: 'node_group', _nodeGroup: true, children: []},
  ], {edgeRunTargetIds: () => ['old-entry', 'current-entry']});
  h.state.run.set('old-entry', {status: 'succeeded'});
  h.state.run.set('current-entry', {status: 'running'});
  h.edges.renderEdge(h.layer, h.state.raw.nodes[0], 'group', 0);
  const edge = h.layer.children[0];
  assert.equal(edge.attrs.class, 'edge run-running edge-collapsed-group');

  h.state.run.set('current-entry', {status: 'failed'});
  assert.equal(h.edges.patchRunEdgeStates('current-entry'), 1);
  assert.equal(edge.attrs.class, 'edge run-failed edge-collapsed-group');
});

test('Alt + 左键在连线上直接断开，并保持选区与重连语义', () => {
  const build = () => harness([
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task'},
  ], {positions: {root: {x: 0, y: 0}, a: {x: 0, y: 300}}});

  // Alt + 左键：断开这条连线，且不进入选中/详情栏。
  const h = build();
  h.edges.renderEdge(h.layer, h.state.raw.nodes[0], 'a', 0);
  const group = h.layer.children[0];
  const hit = group.children.find((child) => child.attrs.class === 'edge-hit');
  hit.fire('mousedown', {altKey: true});
  assert.deepEqual(h.calls.inspector, [], 'Alt 点击不当成选中');
  assert.equal(h.state.selectedEdge, null);
  group.fire('mousedown', {altKey: true});
  assert.deepEqual(h.calls.disconnected, [['root', 'a']]);
  assert.equal(h.calls.mutated, 1, '断开要进历史，可 Ctrl+Z');
  assert.equal(h.state.selectedEdge, null);

  // 已选中的就是这条：断开后清掉选区，免得详情栏停在已删除的连线上。
  const selected = build();
  selected.state.selectedEdge = {parent: 'root', child: 'a'};
  selected.edges.renderEdge(selected.layer, selected.state.raw.nodes[0], 'a', 0);
  selected.layer.children[0].fire('mousedown', {altKey: true});
  assert.deepEqual(selected.calls.disconnected, [['root', 'a']]);
  assert.equal(selected.state.selectedEdge, null);

  // 顺序徽标上同样生效；拖拽重连旋钮优先，不被断开抢走。
  const onBadge = build();
  onBadge.edges.renderEdge(onBadge.layer, onBadge.state.raw.nodes[0], 'a', 0);
  onBadge.layer.children[0].fire('mousedown', {altKey: true, target: {closest: () => null}});
  assert.deepEqual(onBadge.calls.disconnected, [['root', 'a']]);
  const onRewire = build();
  onRewire.edges.renderEdge(onRewire.layer, onRewire.state.raw.nodes[0], 'a', 0);
  onRewire.layer.children[0].fire('mousedown', {altKey: true, target: {closest: (selector) => (selector === '.edge-rewire' ? {} : null)}});
  assert.deepEqual(onRewire.calls.disconnected, [], '重连旋钮上的 Alt 点击仍然开始重连');

  // 不带 Alt 的左键保持原有选中语义。
  const plain = build();
  plain.edges.renderEdge(plain.layer, plain.state.raw.nodes[0], 'a', 0);
  plain.layer.children[0].children.find((child) => child.attrs.class === 'edge-hit').fire('mousedown');
  assert.deepEqual(plain.calls.inspector, [{kind: 'edge', parent: 'root', child: 'a'}]);
  assert.deepEqual(plain.calls.disconnected, []);
});

test('renderInstanceRunEdge 标注运行序号与卡片连线', () => {
  const card = {node: {id: 'p', type: 'task'}, index: 1, key: 'p:1', x: 100, y: 400, variables: []};
  const h = harness([{id: 'p', type: 'task'}], {positions: {p: {x: 0, y: 0}}, runCards: [card]});
  h.edges.renderInstanceRunEdge(h.layer, card);
  const group = h.layer.children[0];
  assert.equal(group.attrs.class, 'instance-run-edge');
  assert.equal(group.attrs['data-run-key'], 'p:1');
  assert.equal(group.children.find((child) => child.attrs.class === 'edge-order').textContent, '2');
});

test('renderConnection 覆盖 from-output 与 from-input 预览', () => {
  const h = harness([
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task'},
  ], {positions: {root: {x: 0, y: 0}, a: {x: 0, y: 300}}});
  h.state.connect = {direction: 'from-output', parent: 'root', x: 5, y: 6, hover: {x: 1, y: 2}};
  h.edges.renderConnection(h.layer);
  assert.equal(h.layer.children[0].attrs.class, 'connection-preview snapped');
  assert.equal(h.layer.children[0].attrs.d, 'M 130 96 C 5 6');

  h.layer.children.length = 0;
  h.state.connect = {direction: 'from-input', child: 'a', x: 5, y: 6, hover: null};
  h.edges.renderConnection(h.layer);
  assert.equal(h.layer.children[0].attrs.class, 'connection-preview');
  assert.equal(h.layer.children[0].attrs.d, 'M 5 6 C 130 300');
});

test('renderVariableEdges 按 _variableLinks 连到卡片并支持 Alt 断开', () => {
  const node = {id: 'n', type: 'task', pins: [{param: 'template', variable: '模板', scope: 'inputs'}]};
  const h = harness([node], {
    positions: {n: {x: 100, y: 50}},
    cards: [{id: 'card_1', name: '模板', scope: 'inputs', x: 0, y: 0}],
  });
  h.state.raw._variableLinks = {'n:template': 'card_1'};
  h.edges.renderVariableEdges(h.layer);
  const hit = h.layer.children[0];
  const edge = h.layer.children[1];
  assert.equal(hit.attrs.class, 'variable-edge-hit', '细线要配一条加粗命中线');
  // 变量线按变量身份取稳定色，同一个变量的所有端点和连线共用该色号。
  assert.equal(edge.attrs.class, `variable-edge data-tone-${dataEdgeTone('inputs.模板')}`);
  assert.equal(edge.attrs.d, 'M 168 29 C 200 29, 78 158, 110 158');
  assert.equal(hit.attrs.d, edge.attrs.d, '命中线与可见线同路径');
  assert(hit.attrs.class && h.layer.children.indexOf(hit) < h.layer.children.indexOf(edge), '命中线排在前面，悬停才能点亮后面那条细线');
  hit.fire('pointerdown', {altKey: true, clientX: 100, clientY: 100});
  hit.fire('pointerup', {altKey: true, clientX: 102, clientY: 101});
  assert.deepEqual(h.calls.disconnectedPins, [['n', 'template']]);
  // 非 Alt 的点击不吃事件，仍按原来的画布交互处理。
  h.calls.disconnectedPins.length = 0;
  hit.fire('pointerdown', {altKey: false, clientX: 100, clientY: 100});
  hit.fire('pointerup', {altKey: false, clientX: 100, clientY: 100});
  assert.deepEqual(h.calls.disconnectedPins, []);
  // Alt + 拖拽（平移）从命中范围上起始时不能误删。
  h.calls.disconnectedPins.length = 0;
  hit.fire('pointerdown', {altKey: true, clientX: 100, clientY: 100});
  hit.fire('pointerup', {altKey: true, clientX: 140, clientY: 100});
  assert.deepEqual(h.calls.disconnectedPins, [], '拖拽不算点击');
});

test('节点组接口端点代理真实成员参数，不重复直连成员卡', () => {
  const member = {
    id: 'inside', type: 'task', _nodeGroupMember: true,
    pins: [{param: 'count', variable: 'count', scope: 'inputs'}],
  };
  const proxyPin = {
    param: 'group-pin:0', variable: 'count', scope: 'inputs',
    targetNodeId: 'inside', targetParam: 'count', targetIndex: 0, _targetNode: member, _nodeGroupPin: true,
  };
  const boundary = {
    id: '__node_group_interface__:g1', type: 'node_group_interface', _nodeGroupInterface: true,
    pins: [proxyPin], children: ['inside'],
  };
  const h = harness([boundary, member], {
    positions: {boundary: {x: 0, y: 0}, '__node_group_interface__:g1': {x: 0, y: 0}, inside: {x: 200, y: 260}},
    cards: [{id: 'card_count', scope: 'inputs', name: 'count', x: -240, y: 100}],
  });
  h.state.raw.inputs = {count: {type: 'integer', default: 1}};
  h.state.raw._variableLinks = {'inside:count': 'card_count'};

  h.edges.renderVariableEdges(h.layer);
  const visible = h.layer.children.filter((child) => child.attrs.class.includes('variable-edge '));
  const mappings = h.layer.children.filter((child) => child.attrs.class.includes('group-interface-edge'));
  // 两条都用标准变量线样式：变量卡 → 组接口这一条，加上组接口 → 真实成员端点那一条。
  assert.equal(visible.length, 2, '变量卡到组接口、组接口到真实成员都要画成变量线');
  assert.equal(mappings.length, 1, '组接口到真实成员端点的映射线带 group-interface-edge 语义标记');
  assert.match(mappings[0].attrs.class, /^variable-edge group-interface-edge data-tone-\d+$/, '映射线必须与普通变量线同一套数据线样式');
  assert.match(String(mappings[0].attrs.style), /--edge-tone:var\(--data-tone\)/, '映射线按身份取色，不再是固定的灰色虚线');
  const hit = h.layer.children.find((child) => child.attrs.class === 'variable-edge-hit');
  hit.fire('pointerdown', {altKey: true, clientX: 10, clientY: 10});
  hit.fire('pointerup', {altKey: true, clientX: 10, clientY: 10});
  assert.deepEqual(h.calls.disconnectedPins, [['inside', 'count']], '在组接口断线必须作用于真实成员参数');
});

test('组边界映射线不再使用虚线样式（与变量线标准一致）', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  assert.doesNotMatch(css, /\.group-interface-edge\s*\{[^}]*stroke-dasharray/, '组边界映射线不得声明虚线');
  assert.doesNotMatch(css, /\.group-interface-edge\s*\{[^}]*stroke-width/, '线宽交给 .variable-edge 的数据线标准');
  const light = fs.readFileSync(path.join(__dirname, '..', 'public/theme/editor-light.css'), 'utf8');
  assert.doesNotMatch(light, /data-theme="light"\]\s*\.group-interface-edge\s*\{[^}]*#696969/, '浅色主题里也不再有灰色映射线');
});

test('手动创建的组接口端点尚未绑定变量时也显示组内映射线', () => {
  const member = {id: 'inside', type: 'task', _nodeGroupMember: true, pins: [{param: 'count', variable: '', scope: 'inputs'}]};
  const boundary = {
    id: '__node_group_interface__:g1', type: 'node_group_interface', _nodeGroupInterface: true,
    pins: [{param: 'group-pin:0', variable: '', scope: 'inputs', targetNodeId: 'inside', targetParam: 'count', targetIndex: 0, _targetNode: member, _nodeGroupPin: true}],
    children: ['inside'],
  };
  const h = harness([boundary, member], {
    positions: {'__node_group_interface__:g1': {x: 0, y: 0}, inside: {x: 200, y: 260}},
  });
  h.edges.renderVariableEdges(h.layer);
  const mappings = h.layer.children.filter((child) => child.attrs.class.includes('group-interface-edge'));
  assert.equal(mappings.length, 1);
  // 还没有外部变量时只画这一条映射线，但样式同样是标准变量线（实线、按参数身份取色）。
  assert.match(mappings[0].attrs.class, /^variable-edge group-interface-edge data-tone-\d+$/);
  assert.equal(h.layer.children.filter((child) => child.attrs.class.includes('variable-edge ')).length, 1);
});

test('组内视图隐藏了变量卡时，只留映射线、不画悬空的变量线', () => {
  // 组边界行已经代表了这个变量，画布入口于是把它从变量卡列表里剔掉：
  // 此时映射线（边界行 → 真实成员参数）照画，指向卡片的连线不能留半截。
  const member = {id: 'inside', type: 'task', _nodeGroupMember: true, pins: [{param: 'count', variable: 'count', scope: 'inputs'}]};
  const boundary = {
    id: '__node_group_variables__:g1', type: 'node_group_variables', _nodeGroupVariables: true,
    pins: [{param: 'group-pin:0', variable: 'count', scope: 'inputs', targetNodeId: 'inside', targetParam: 'count', targetIndex: 0, _targetNode: member, _nodeGroupPin: true}],
    children: [],
  };
  const h = harness([boundary, member], {
    positions: {'__node_group_variables__:g1': {x: -240, y: 0}, inside: {x: 200, y: 260}},
    // 没有任何变量卡片（组内视图过滤掉了）
  });
  h.state.raw.inputs = {count: {type: 'integer', default: 1}};
  h.edges.renderVariableEdges(h.layer);
  const mappings = h.layer.children.filter((child) => child.attrs.class.includes('group-interface-edge'));
  const cardLines = h.layer.children.filter((child) => child.attrs.class.includes('variable-edge ')
    && !child.attrs.class.includes('group-interface-edge'));
  assert.equal(mappings.length, 1, '边界行到真实成员参数的映射线要保留');
  assert.equal(cardLines.length, 0, '卡片被隐藏时不得留下指向它的悬空连线');
  // 变量卡的端口在右边缘：头段控制点必须往右推（x1 + bend），否则长距离时线几乎退化成直斜线。
  // 起点 (10,108)、终点 (210,368)、bend = max(32, 200*0.42) = 84。
  assert.equal(mappings[0].attrs.d, 'M 10 108 C 94 108, 126 368, 210 368');
});

test('接口卡的映射线仍然从左侧出线（头段控制点往左推）', () => {
  const member = {id: 'inside', type: 'task', _nodeGroupMember: true, pins: [{param: 'count', variable: 'count', scope: 'inputs'}]};
  const boundary = {
    id: '__node_group_interface__:g1', type: 'node_group_interface', _nodeGroupInterface: true,
    pins: [{param: 'group-pin:0', variable: 'count', scope: 'inputs', targetNodeId: 'inside', targetParam: 'count', targetIndex: 0, _targetNode: member, _nodeGroupPin: true}],
    children: ['inside'],
  };
  const h = harness([boundary, member], {
    positions: {'__node_group_interface__:g1': {x: 0, y: 0}, inside: {x: 200, y: 260}},
  });
  h.state.raw.inputs = {count: {type: 'integer', default: 1}};
  h.edges.renderVariableEdges(h.layer);
  const mapping = h.layer.children.find((child) => child.attrs.class.includes('group-interface-edge'));
  // 接口卡端口在左边缘：起点 (10,108) → 头段控制点 x1 - bend = -74。
  assert.equal(mapping.attrs.d, 'M 10 108 C -74 108, 126 368, 210 368');
});

test('节点拖动时变量线局部更新到新的参数端点', () => {
  const node = {id: 'n', type: 'task', pins: [{param: 'template', variable: '模板', scope: 'inputs'}]};
  const positions = {n: {x: 100, y: 50}};
  const h = harness([node], {
    positions,
    cards: [{id: 'card_1', name: '模板', scope: 'inputs', x: 0, y: 0}],
  });
  h.state.raw._variableLinks = {'n:template': 'card_1'};
  h.edges.renderVariableEdges(h.layer);
  const before = h.layer.children[1].attrs.d;

  positions.n = {x: 300, y: 150};
  assert.equal(h.edges.patchNodeDataEdges('n'), 1);

  assert.notEqual(h.layer.children[1].attrs.d, before);
  assert.match(h.layer.children[1].attrs.d, /, 310 258$/);
  assert.equal(h.layer.children[0].attrs.d, h.layer.children[1].attrs.d);
});

test('变量线跟随变量身份色，同一个变量与它的引脚同色', () => {
  const node = {id: 'n', type: 'task', pins: [{param: 'template', variable: '模板', scope: 'inputs'}]};
  const h = harness([node], {
    positions: {n: {x: 100, y: 50}},
    cards: [{id: 'card_1', name: '模板', scope: 'inputs', x: 0, y: 0}],
  });
  h.state.raw.inputs = {模板: {type: 'string'}};
  h.state.raw._variableLinks = {'n:template': 'card_1'};

  h.edges.renderVariableEdges(h.layer);

  const edge = h.layer.children[1];
  const tone = dataEdgeTone('inputs.模板');
  assert.equal(edge.attrs.class, `variable-edge data-tone-${tone}`);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  assert.match(css, new RegExp(`\\.data-tone-${tone} \\{[^}]*--data-tone:\\s*#[0-9a-f]{6}[^}]*--edge-tone:\\s*var\\(--data-tone\\)`, 'i'));
  assert.match(css, /\.variable-edge \{[^}]*stroke:\s*var\(--edge-tone/);
  assert.match(css, /\.port-variable\.configured[^}]*fill:\s*color-mix\([^}]*var\(--data-tone/);
});

test('renderReferenceEdges 按变量上色、实线且比执行连线细', () => {
  // 同一变量（输出字段）恒定同色，不同变量尽量不同色——取两个已知不同色的字段。
  const fields = ['state', 'confidence', 'matched', 'count', 'index', 'score', 'output', '0'];
  const other = fields.find((field) => dataEdgeTone(field) !== dataEdgeTone(fields[0]));
  assert(other, '至少要有两个不同色调');
  const target = {
    id: 'use', type: 'task',
    pins: [
      {param: 'a', value: {ref: `nodes.tap.output.${fields[0]}`}},
      {param: 'b', value: {ref: `nodes.tap.output.${fields[0]}`}},
      {param: 'c', value: {ref: `nodes.tap.output.${other}`}},
    ],
  };
  const h = harness([{id: 'tap', type: 'task'}, target], {positions: {tap: {x: 0, y: 0}, use: {x: 0, y: 300}}});

  h.edges.renderReferenceEdges(h.layer);

  const classes = h.layer.children.map((child) => child.attrs.class);
  assert.equal(classes.length, 6, '每条引用线 = 可见线 + 命中线');
  const visible = classes.filter((value) => /^reference-edge data-tone-\d+$/.test(value));
  const hits = classes.filter((value) => value === 'reference-edge-hit');
  assert.equal(visible.length, 3);
  assert.equal(hits.length, 3, '细线下面要有加粗命中线');
  assert.equal(visible[0], visible[1], '同一变量的引用线同色');
  assert.notEqual(visible[0], visible[2], '不同变量的引用线不同色');

  // Alt + 左键点在命中线上即可断开（细线本身不接收事件）。
  const hitPaths = h.layer.children.filter((child) => child.attrs.class === 'reference-edge-hit');
  hitPaths[0].fire('pointerdown', {altKey: true, clientX: 10, clientY: 10});
  hitPaths[0].fire('pointerup', {altKey: true, clientX: 11, clientY: 10});
  assert.deepEqual(h.calls.disconnectedReferences, [['use', 'a']]);
  // 非 Alt 点击、以及 Alt 拖拽都不吃事件。
  h.calls.disconnectedReferences.length = 0;
  hitPaths[0].fire('pointerdown', {altKey: false, clientX: 10, clientY: 10});
  hitPaths[0].fire('pointerup', {altKey: false, clientX: 10, clientY: 10});
  hitPaths[0].fire('pointerdown', {altKey: true, clientX: 10, clientY: 10});
  hitPaths[0].fire('pointerup', {altKey: true, clientX: 60, clientY: 10});
  assert.deepEqual(h.calls.disconnectedReferences, []);

  // 线型：实线，且比执行连线细；命中线要明显更粗。
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  const base = /\.reference-edge \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const variable = /\.variable-edge \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const hit = /\.reference-edge-hit \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const wire = /\.edge-line \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const wireWidth = Number(/stroke-width:\s*([\d.]+)/.exec(wire)[1]);
  for (const [name, rule] of [['引用线', base], ['变量线', variable]]) {
    assert.doesNotMatch(rule, /stroke-dasharray/, `${name}不再是虚线`);
    assert(Number(/stroke-width:\s*([\d.]+)/.exec(rule)[1]) < wireWidth, `${name}应比主分支连线细`);
    assert.match(rule, /pointer-events:\s*none/, `${name}不接收事件，点击交给命中线`);
    assert.match(rule, /stroke:\s*var\(--edge-tone/, `${name}按来源取色`);
  }
  assert(Number(/stroke-width:\s*([\d.]+)/.exec(hit)[1]) >= 12, '命中范围要够宽才好点');
  // 变量线和引用线共用身份色（同一数据恒定同色，不同数据尽量不同色）。
  assert.equal((css.match(/^\.data-tone-\d+ \{/gm) ?? []).length, 10, '数据端点与连线要有十个稳定色调');
  // 悬停反馈：指针进入命中范围时，细线要提亮（且略加粗），否则用户看不出「可以点」。
  // 用显式颜色而不是 filter，浅色主题才能由适配器生成加深版本。
  assert.match(css, /\.reference-edge-hit:hover \+ \.reference-edge,\s*\n\.variable-edge-hit:hover \+ \.variable-edge\s*\{[^}]*stroke:\s*color-mix/, '悬停要提亮');
  assert.doesNotMatch(css, /\.(?:reference|variable)-edge(?:-hit)?:hover[^{]*\{[^}]*filter:/, '线的悬停不要用 filter（浅色主题会反过来）');
});

test('折叠组上的引用边连接可见组卡，但断开仍作用于真实成员参数', () => {
  const source = {id: 'source', type: 'task'};
  const group = {
    id: 'group', type: 'node_group', _nodeGroup: true,
    pins: [{
      param: 'group-pin:0', value: {ref: 'nodes.source.output.match'},
      targetNodeId: 'inside', targetParam: 'match', _nodeGroupPin: true,
    }],
  };
  const h = harness([source, group], {positions: {source: {x: 0, y: 0}, group: {x: 400, y: 200}}});

  h.edges.renderReferenceEdges(h.layer);

  const visible = h.layer.children.find((child) => child.attrs.class.includes('reference-edge data-tone-'));
  assert.match(visible.attrs.d, /^M 260 16 /, '引用从可见的组外来源输出口出发');
  assert.match(visible.attrs.d, /, 410 308$/, '引用落到组卡代理参数端点');
  const hit = h.layer.children.find((child) => child.attrs.class === 'reference-edge-hit');
  hit.fire('pointerdown', {altKey: true, clientX: 10, clientY: 10});
  hit.fire('pointerup', {altKey: true, clientX: 10, clientY: 10});
  assert.deepEqual(h.calls.disconnectedReferences, [['inside', 'match']]);
});

test('引用源折叠在组内时从组卡输出口连到组外参数', () => {
  const group = {id: 'group', type: 'node_group', _nodeGroup: true, pins: []};
  const target = {
    id: 'target', type: 'task',
    pins: [{param: 'match', value: {ref: 'nodes.inside.output.match'}}],
  };
  const h = harness([group, target], {
    positions: {group: {x: 0, y: 0}, target: {x: 400, y: 200}},
    referenceSourceById: (id) => id === 'inside' ? group : null,
  });

  h.edges.renderReferenceEdges(h.layer);

  const visible = h.layer.children.find((child) => child.attrs.class.includes('reference-edge data-tone-'));
  assert.match(visible.attrs.d, /^M 260 16 /, '隐藏的真实来源由组卡右侧输出口代理');
  assert.match(visible.attrs.d, /, 410 308$/);
});

test('节点拖动时引用线同时跟随输出源和参数目标', () => {
  const positions = {tap: {x: 0, y: 0}, use: {x: 500, y: 300}};
  const target = {id: 'use', type: 'task', pins: [{param: 'match', value: {ref: 'nodes.tap.output.match'}}]};
  const h = harness([{id: 'tap', type: 'task'}, target], {positions});
  h.edges.renderReferenceEdges(h.layer);
  const visible = h.layer.children[1];
  const initial = visible.attrs.d;

  positions.tap = {x: 100, y: 50};
  assert.equal(h.edges.patchNodeDataEdges('tap'), 1);
  assert.notEqual(visible.attrs.d, initial, '移动输出源后起点应更新');
  assert.match(visible.attrs.d, /^M 360 66 /);

  positions.use = {x: 700, y: 400};
  assert.equal(h.edges.patchNodeDataEdges('use'), 1);
  assert.match(visible.attrs.d, /, 710 508$/);
  assert.equal(h.layer.children[0].attrs.d, visible.attrs.d, '命中线与可见线保持重合');
});

test('renderVariableConnection 从卡片、实例输入与变量端点出发', () => {
  const card = {node: {id: 'p', type: 'task'}, index: 0, x: 100, y: 400, variables: [{name: '模板'}]};
  const h = harness([{id: 'p', type: 'task'}], {
    cards: [{id: 'card_1', name: '模板', scope: 'inputs', x: 0, y: 0}],
    runCards: [card],
  });
  h.state.variableConnect = {direction: 'from-card', cardId: 'card_1', x: 5, y: 6, hover: {x: 7, y: 8}};
  h.edges.renderVariableConnection(h.layer);
  assert.equal(h.layer.children[0].attrs.class, `variable-connection-preview data-tone-${dataEdgeTone('inputs.模板')} snapped`);
  assert.equal(h.layer.children[0].attrs.d, 'M 168 29 C 7 8');

  h.layer.children.length = 0;
  h.state.variableConnect = {direction: 'from-instance-input', nodeId: 'p', runIndex: 0, param: '模板', x: 5, y: 6, hover: null};
  h.edges.renderVariableConnection(h.layer);
  assert.match(h.layer.children[0].attrs.class, /^variable-connection-preview data-tone-\d+$/);
  assert.equal(h.layer.children[0].attrs.d, 'M 110 400 C 5 6');
});

// —— 阶段 6：连线上的校验问题 ——

test('有校验问题的连线带 edge-invalid 并把问题写在悬停说明里', () => {
  const h = harness([
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task'},
  ], {
    positions: {root: {x: 0, y: 0}, a: {x: 0, y: 300}},
    edgeIssues: (parentId, childId) => (parentId === 'root' && childId === 'a'
      ? [{message: 'Root 必须恰好连接一个子节点'}, {message: '检测到环：a'}]
      : []),
  });
  h.edges.renderEdge(h.layer, h.state.raw.nodes[0], 'a', 0);
  const group = h.layer.children[0];
  assert.match(group.attrs.class, /edge-invalid/, '问题连线带 edge-invalid');
  const title = group.children.find((child) => child.tag === 'title');
  assert.equal(title.textContent, 'Root 必须恰好连接一个子节点\n检测到环：a', '悬停能看到每条问题');

  // 没有问题的连线不带这个 class，也不多画一个 title。
  const clean = harness([
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task'},
  ], {positions: {root: {x: 0, y: 0}, a: {x: 0, y: 300}}});
  clean.edges.renderEdge(clean.layer, clean.state.raw.nodes[0], 'a', 0);
  assert.doesNotMatch(clean.layer.children[0].attrs.class, /edge-invalid/);
  assert.equal(clean.layer.children[0].children.filter((child) => child.tag === 'title').length, 0);
});
