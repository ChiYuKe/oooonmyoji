const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createCanvasState} = require('../dist-test-renderer/canvas/state/canvas-state.js');
const {createWorkflowModel} = require('../dist-test-renderer/canvas/model/workflow-model.js');
const {createNodeGroups} = require('../dist-test-renderer/canvas/model/node-groups.js');

function harness() {
  const state = createCanvasState();
  state.raw = {
    root: 'root',
    nodes: [
      {id: 'root', type: 'root', children: ['a']},
      {id: 'a', type: 'sequence', children: ['b']},
      {id: 'b', type: 'sequence', children: ['c']},
      {id: 'c', type: 'task', action: 'core.capture', params: {}},
    ],
    _layout: {
      root: {x: 100, y: 0}, a: {x: 0, y: 160}, b: {x: 300, y: 320}, c: {x: 300, y: 480},
    },
  };
  const model = createWorkflowModel(state);
  const toasts = [];
  let refreshes = 0;
  const groups = createNodeGroups({
    state,
    nodes: model.nodes,
    nodeById: model.nodeById,
    layout: model.layout,
    mutate: (fn) => fn(),
    toast: (message, error) => toasts.push([message, Boolean(error)]),
    nodeWidth: 260,
    nodeHeight: () => 96,
    nodeVariablePins: (node) => Array.isArray(node.pins)
      ? node.pins
      : node.id === 'b' ? [{param: 'count', label: '运行次数', type: 'integer', scope: 'inputs', variable: '', configured: false}] : [],
    refreshView: () => { refreshes += 1; },
  });
  return {state, model, groups, toasts, refreshes: () => refreshes};
}

test('打组只折叠编辑器视图，不改运行节点与真实 children', () => {
  const h = harness();
  assert.strictEqual(h.groups.viewNodes(), h.model.nodes(), '没有分组时必须零克隆走原节点数组');
  assert.strictEqual(h.groups.viewNodeById('a'), h.model.nodeById('a'));
  h.state.selected = new Set(['a', 'b']);
  assert.equal(h.groups.groupSelection(), true);
  const group = h.groups.groups()[0];
  assert.deepEqual(group.nodeIds, ['a', 'b']);
  assert.deepEqual(h.model.nodeById('root').children, ['a'], '真实运行边保持不变');
  assert.deepEqual(h.model.nodeById('a').children, ['b'], '组内真实边保持不变');

  const outer = h.groups.viewNodes();
  assert.deepEqual(new Set(outer.map((node) => node.id)), new Set(['root', 'c', group.id]));
  assert.deepEqual(outer.find((node) => node.id === 'root').children, [group.id], '进入组的边折叠到组卡');
  assert.deepEqual(outer.find((node) => node.id === group.id).children, ['c'], '离开组的边从组卡连出');
  assert.equal(outer.find((node) => node.id === group.id)._nodeCount, 2);
  assert.equal(outer.find((node) => node.id === group.id)._groupPins.length, 0, '新建节点组不自动暴露成员变量端点');
  assert.deepEqual(h.groups.adjacentEdges(group.id).map((edge) => [edge.parent.id, edge.childId]), [
    ['root', group.id],
    [group.id, 'c'],
  ], '组卡拖动时能同时找到进入与离开组的两侧折叠线');
});

test('双击进入语义对应的组内投影只显示成员，返回后恢复组卡', () => {
  const h = harness();
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  assert.equal(h.groups.enterGroup(group.id), true);
  const inside = h.groups.viewNodes();
  const boundary = inside[0];
  assert.equal(boundary._nodeGroupInterface, true, '组内顶部生成编辑器专用接口卡');
  assert.deepEqual(boundary.children, ['a'], '接口卡连到组内执行入口');
  assert.equal(boundary._groupPins.length, 0, '组接口初始为空');
  assert.equal(inside[1]._nodeGroupVariables, true, '即使尚无端点也显示可创建变量的组变量卡');
  assert.equal(h.groups.pinCandidates(group.id).length, 1, '变量卡可以从尚未公开的成员参数创建接口变量');
  assert.equal(h.groups.pinExposure('b', 'count'), false);
  assert.equal(h.groups.setPinExposed('b', 'count', true), true);
  const exposedBoundary = h.groups.viewNodes().find((node) => node._nodeGroupVariables);
  assert.ok(exposedBoundary, '暴露数据端点后在组内左侧生成变量卡');
  assert.equal(exposedBoundary._groupPins.length, 1);
  assert.equal(exposedBoundary._groupPins[0].targetNodeId, 'b');
  assert.equal(exposedBoundary._groupPins[0].targetParam, 'count', '变量卡端点代理真实成员参数');
  assert.ok(exposedBoundary._nodeGroupPosition.x < h.model.layout().a.x, '变量卡位于全部成员左侧');
  assert.ok(exposedBoundary._nodeGroupHeight >= 96 + 24, '变量卡高度覆盖端点行');
  assert.equal(h.groups.pinExposure('b', 'count'), true);
  assert.equal(h.groups.pinCandidates(group.id).length, 0, '已存在的接口变量不重复列入创建菜单');
  assert.equal(h.groups.setPinExposed('b', 'count', false), true);
  assert.equal(h.groups.viewNodes().find((node) => node._nodeGroupVariables)._groupPins.length, 0, '移除最后一个端点后保留空变量卡用于继续创建');
  assert.deepEqual(inside.filter((node) => node._nodeGroupMember).map((node) => node.id), ['a', 'b']);
  assert.deepEqual(inside.find((node) => node.id === 'a').children, ['b']);
  assert.deepEqual(inside.find((node) => node.id === 'b').children, [], '跨出组外的边在组内隐藏');
  assert.equal(h.groups.leaveGroup(), true);
  assert.equal(h.state.nodeGroupId, '');
  assert.deepEqual([...h.state.selected], [group.id]);
});

test('解散组保留全部节点，组内新建节点会自动加入当前组', () => {
  const h = harness();
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  h.groups.enterGroup(group.id);
  h.state.raw.nodes.push({id: 'new_task', type: 'task', action: 'core.capture', params: {}});
  h.groups.addToCurrentGroup(['new_task']);
  assert.ok(h.groups.currentGroup().nodeIds.includes('new_task'));
  h.model.layout()[`__node_group_interface__:${group.id}`] = {x: 40, y: 80};
  h.model.layout()[`__node_group_variables__:${group.id}`] = {x: -300, y: 160};
  assert.equal(h.groups.ungroup(group.id), true);
  assert.equal(h.groups.groups().length, 0);
  assert.ok(h.model.nodeById('a'));
  assert.ok(h.model.nodeById('b'));
  assert.ok(h.model.nodeById('new_task'));
  assert.equal(h.model.layout()[`__node_group_interface__:${group.id}`], undefined);
  assert.equal(h.model.layout()[`__node_group_variables__:${group.id}`], undefined);
});

test('少于两个节点或包含已打组节点时拒绝重复打组', () => {
  const h = harness();
  h.state.selected = new Set(['a']);
  assert.equal(h.groups.groupSelection(), false);
  h.state.selected = new Set(['a', 'b']);
  assert.equal(h.groups.groupSelection(), true);
  h.state.selected = new Set(['a', 'c']);
  assert.equal(h.groups.groupSelection(), false);
  assert.match(h.toasts.at(-1)[0], /至少选择两个/);
});

test('跨组数据引用自动投影到组边界，隐藏的组内引用源由组卡代理', () => {
  const h = harness();
  h.model.nodeById('b').pins = [{
    param: 'match', label: '匹配结果', type: 'object', scope: 'inputs', variable: '', configured: true,
    value: {ref: 'nodes.root.output.match'},
  }];
  h.model.nodeById('c').pins = [{
    param: 'source', label: '来源', type: 'object', scope: 'inputs', variable: '', configured: true,
    value: {ref: 'nodes.b.output.match'},
  }];
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();

  const group = h.groups.groups()[0];
  const projected = h.groups.viewNodeById(group.id);
  assert.equal(projected._groupPins.length, 1, '组外来源连到组内参数时自动生成视图端点');
  assert.equal(projected._groupPins[0].targetNodeId, 'b');
  assert.equal(projected._groupPins[0].targetParam, 'match');
  assert.equal(projected._hasReferenceOutput, true, '组内来源连到组外参数时显示组卡输出口');
  assert.equal(h.groups.viewReferenceSourceById('b').id, group.id, '折叠时隐藏来源映射到组卡');
  assert.equal(h.state.raw._nodeGroups[group.id].pins.length, 0, '自动端点不写回用户显式接口配置');

  h.groups.enterGroup(group.id);
  assert.equal(h.groups.viewReferenceSourceById('b').id, 'b');
  assert.equal(h.groups.viewReferenceSourceById('root'), null, '组外来源在组内视图不伪装成成员节点');
  assert.equal(h.groups.viewNodes().find((node) => node._nodeGroupVariables)._groupPins.length, 1, '进入组后由左侧变量卡映射到真实成员参数');
});
