const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createCanvasState} = require('../dist-test-renderer/canvas/state/canvas-state.js');
const {createWorkflowModel} = require('../dist-test-renderer/canvas/model/workflow-model.js');
const {createNodeGroups} = require('../dist-test-renderer/canvas/model/node-groups.js');
const {aggregateNodeRunStatus, summarizeNodeGroupRun, presentNodeGroupRun} = require('../dist-test-renderer/canvas/model/node-group-runtime.js');
const {createCanvasCommands} = require('../dist-test-renderer/canvas/state/commands.js');

function harness(options = {}) {
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
  const focused = [];
  let refreshes = 0;
  const groups = createNodeGroups({
    state,
    nodes: model.nodes,
    nodeById: model.nodeById,
    layout: model.layout,
    mutate: (fn) => fn(),
    toast: (message, error) => toasts.push([message, Boolean(error)]),
    nodeWidth: 260,
    nodeHeight: options.nodeHeight ?? (() => 96),
    baseHeight: options.baseHeight ?? 96,
    runVariableHeight: options.runVariableHeight ?? 24,
    markDirty: options.markDirty,
    focusNode: (id) => focused.push(id),
    nodeVariablePins: options.nodeVariablePins ?? ((node) => Array.isArray(node.pins)
      ? node.pins
      : node.id === 'b' ? [{param: 'count', label: '运行次数', type: 'integer', scope: 'inputs', variable: '', configured: false}] : []),
    refreshView: () => { refreshes += 1; },
  });
  return {state, model, groups, toasts, focused, refreshes: () => refreshes};
}

test('节点组运行态由真实成员统一汇总，并保留进度与异常节点名称', () => {
  const nodes = new Map([
    ['a', {id: 'a', name: '识别页面'}],
    ['b', {id: 'b', name: '点击按钮'}],
    ['c', {id: 'c', name: '等待结果'}],
  ]);
  const run = new Map([
    ['a', {status: 'succeeded'}],
    ['b', {status: 'running'}],
  ]);
  let summary = summarizeNodeGroupRun(['a', 'b', 'c'], run, (id) => nodes.get(id));
  assert.equal(summary.status, 'running');
  assert.equal(summary.completed, 1);
  assert.equal(summary.runningNodeName, '点击按钮');
  assert.equal(presentNodeGroupRun(summary, {running: '运行中'}).detailLabel, '正在执行：点击按钮');

  run.set('b', {status: 'failed'});
  run.set('c', {status: 'not_matched'});
  summary = summarizeNodeGroupRun(['a', 'b', 'c'], run, (id) => nodes.get(id));
  assert.equal(summary.status, 'failed', '失败优先于未匹配与已完成');
  assert.equal(summary.completed, 3);
  assert.deepEqual(summary.failedNodeNames, ['点击按钮', '等待结果']);
  const view = presentNodeGroupRun(summary, {failed: '失败'});
  assert.equal(view.progressLabel, '3 个节点 · 已完成 3/3');
  assert.match(view.detailLabel, /异常 2 项/);
  assert.match(view.title, /点击按钮、等待结果/);
});

test('组卡和代理线共用状态优先级：运行中不会被旧的绿色完成态覆盖', () => {
  const run = new Map([
    ['old', {status: 'succeeded'}],
    ['current', {status: 'running'}],
    ['failed', {status: 'failed'}],
  ]);
  assert.equal(aggregateNodeRunStatus(['old', 'current'], run), 'running');
  assert.equal(aggregateNodeRunStatus(['old', 'failed'], run), 'failed');
  assert.equal(aggregateNodeRunStatus(['old'], run), 'succeeded');
});

test('节点组运行汇总不写入文档，且投影缓存不会冻结即时状态', () => {
  const h = harness();
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  const before = JSON.stringify(h.state.raw._nodeGroups);
  assert.equal(h.groups.runSummary(group.id).status, '');
  h.state.run.set('a', {status: 'running'});
  assert.equal(h.groups.runSummary(group.id).status, 'running');
  h.state.run.set('a', {status: 'succeeded'});
  h.state.run.set('b', {status: 'failed'});
  const summary = h.groups.runSummary(group.id);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.completed, 2);
  assert.equal(JSON.stringify(h.state.raw._nodeGroups), before, '运行态不得污染持久化分组数据');
});

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
  assert.deepEqual(h.groups.viewEdgeRunTargetIds('root', group.id), ['a'], '组入口代理线映射到真实入口节点');
  assert.deepEqual(h.groups.viewEdgeRunTargetIds(group.id, 'c'), ['c'], '离开组的线仍以可见真实子节点为运行目标');
});

test('组到组和多入口代理边映射全部真实目标，不把合成组 id 当运行节点', () => {
  const h = harness();
  h.state.raw.nodes.push(
    {id: 'left', type: 'sequence', children: ['right-a', 'right-b']},
    {id: 'right-a', type: 'task', children: []},
    {id: 'right-b', type: 'task', children: []},
  );
  h.state.raw._nodeGroups = {
    source_group: {name: '来源组', nodeIds: ['left'], pins: [], pinPolicy: 'explicit-v1'},
    target_group: {name: '目标组', nodeIds: ['right-a', 'right-b'], pins: [], pinPolicy: 'explicit-v1'},
  };
  h.state.docVersion += 1;
  assert.deepEqual(h.groups.viewEdgeRunTargetIds('source_group', 'target_group'), ['right-a', 'right-b']);

  // 旧文档缺少可追溯的直接边时，回退到真实入口，不能返回不会收到 step 事件的 target_group。
  h.model.nodeById('left').children = [];
  h.state.docVersion += 1;
  assert.deepEqual(h.groups.viewEdgeRunTargetIds('source_group', 'target_group'), ['right-a', 'right-b']);
});

test('打组会固化已有的跨组变量连接，只为实际连接创建必要端点', () => {
  const h = harness();
  h.model.nodeById('b').pins = [
    {param: 'count', label: '运行次数', type: 'integer', scope: 'inputs', variable: 'rounds', configured: true},
    {param: 'unused', label: '未使用参数', type: 'integer', scope: 'inputs', variable: '', configured: false},
  ];
  h.state.selected = new Set(['a', 'b']);
  assert.equal(h.groups.groupSelection(), true);

  const group = h.groups.groups()[0];
  assert.deepEqual(h.state.raw._nodeGroups[group.id].pins, [{nodeId: 'b', param: 'count'}]);
  const projected = h.groups.viewNodeById(group.id);
  assert.equal(projected._groupPins.length, 1, '已连接变量在折叠组上保留代理端点');
  assert.equal(projected._groupPins[0].variable, 'rounds');
  assert.equal(projected._groupPins[0].targetNodeId, 'b');
  assert.equal(projected._groupPins[0].targetParam, 'count');
});

test('旧组首次加载会迁移现有跨组变量连接，之后不再动态补回', () => {
  let dirty = 0;
  const h = harness({markDirty: () => { dirty += 1; }});
  h.model.nodeById('b').pins = [
    {param: 'count', label: '运行次数', type: 'integer', scope: 'inputs', variable: 'rounds', configured: true},
  ];
  h.state.raw._nodeGroups = {
    legacy_group: {name: '旧节点组', nodeIds: ['a', 'b'], pins: []},
  };

  assert.equal(h.groups.groups().length, 1);
  assert.deepEqual(h.state.raw._nodeGroups.legacy_group.pins, [{nodeId: 'b', param: 'count'}]);
  assert.equal(h.state.raw._nodeGroups.legacy_group.pinPolicy, 'explicit-v1');
  assert.equal(dirty, 1, '迁移结果会进入下一次保存');

  // 策略标记存在后，用户移除端点就不会因为连接仍在而被再次补回。
  h.state.raw._nodeGroups.legacy_group.pins = [];
  h.state.docVersion += 1;
  assert.deepEqual(h.groups.groups()[0].pins, []);
  assert.equal(dirty, 1);
});

test('打组会保留来自组外节点的输入引用，但不暴露组内引用', () => {
  const h = harness();
  h.model.nodeById('b').pins = [
    {param: 'external', value: {ref: 'nodes.c.output.value'}, scope: 'inputs', variable: ''},
    {param: 'internal', value: {ref: 'nodes.a.output.value'}, scope: 'inputs', variable: ''},
  ];
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  assert.deepEqual(h.state.raw._nodeGroups[group.id].pins, [{nodeId: 'b', param: 'external'}]);
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

test('从运行态组卡下钻会选中并聚焦真实成员，普通进入仍展示整组', () => {
  const h = harness();
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  h.state.run.set('b', {status: 'failed'});
  const summary = h.groups.runSummary(group.id);
  assert.equal(summary.failedNodeIds[0], 'b');
  assert.equal(h.groups.enterGroup(group.id, summary.failedNodeIds[0]), true);
  assert.deepEqual([...h.state.selected], ['b']);
  assert.deepEqual(h.focused, ['b']);

  h.groups.leaveGroup();
  assert.equal(h.groups.enterGroup(group.id), true);
  assert.deepEqual([...h.state.selected], []);
  assert.deepEqual(h.focused, ['b'], '普通进入不应擅自改变用户视野到某个成员');
});

test('节点组重命名同步外层组卡与组内两张接口卡，不改成员节点', () => {
  const h = harness();
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  const memberNames = h.model.nodes().map((node) => node.name);

  assert.equal(h.groups.renameGroup(group.id, '  战斗循环  '), true);
  assert.equal(h.state.raw._nodeGroups[group.id].name, '战斗循环');
  assert.equal(h.groups.viewNodeById(group.id).name, '战斗循环');
  assert.deepEqual(h.model.nodes().map((node) => node.name), memberNames, '组改名不能改运行节点');

  h.groups.enterGroup(group.id);
  const synthetic = h.groups.viewNodes().filter((node) => node._nodeGroupInterface || node._nodeGroupVariables);
  assert.deepEqual(synthetic.map((node) => node.name), ['战斗循环 接口', '战斗循环 变量']);
  assert.equal(h.groups.renameGroup(group.id, '   '), false, '空名称不覆盖原组名');
  assert.equal(h.state.raw._nodeGroups[group.id].name, '战斗循环');
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

test('打组固化已有的跨组输入引用；组卡输出口与来源代理保持不变', () => {
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
  assert.equal(projected._groupPins.length, 1, '组外来源连到组内参数时保留必要的代理端点');
  assert.equal(projected._groupPins[0].targetNodeId, 'b');
  assert.equal(projected._groupPins[0].targetParam, 'match');
  assert.equal(projected._hasReferenceOutput, true, '组内来源连到组外参数时显示组卡输出口');
  assert.equal(h.groups.viewReferenceSourceById('b').id, group.id, '折叠时隐藏来源映射到组卡');
  assert.deepEqual(h.state.raw._nodeGroups[group.id].pins, [{nodeId: 'b', param: 'match'}], '跨组输入被固化，后续连接状态变化也不会让端点消失');

  h.groups.enterGroup(group.id);
  assert.equal(h.groups.viewReferenceSourceById('b').id, 'b');
  assert.equal(h.groups.viewReferenceSourceById('root'), null, '组外来源在组内视图不伪装成成员节点');
  assert.equal(h.groups.viewNodes().find((node) => node._nodeGroupVariables)._groupPins.length, 1, '进入组后变量卡映射到原来的真实参数');
});

test('已有变量绑定在打组时固化为端点，绑定断开后端点不会消失', () => {
  const h = harness();
  // b 的参数绑了组外变量，打组必须保留这条已有连线。
  h.model.nodeById('b').pins = [{
    param: 'count', label: '运行次数', type: 'integer', scope: 'inputs', variable: 'inputs.轮次', configured: true,
  }];
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  h.groups.enterGroup(group.id);

  assert.deepEqual(h.state.raw._nodeGroups[group.id].pins, [{nodeId: 'b', param: 'count'}]);
  assert.equal(h.groups.pinCandidates(group.id).length, 0, '已为现有连接固化的端点不重复进入创建菜单');

  // 断开绑定后端点仍在：它是持久化的接口配置，不依赖连接状态。
  h.model.nodeById('b').pins[0].variable = '';
  assert.equal(h.groups.viewNodes().find((node) => node._nodeGroupVariables)._groupPins.length, 1);

  h.groups.leaveGroup();
  const collapsed = h.groups.viewNodeById(group.id);
  assert.equal(collapsed._groupPins.length, 1, '折叠组卡继续显示已固化的端点');
  assert.equal(h.groups.pinCandidates(group.id).length, 0, '已暴露的参数不再进入创建菜单');

  // 移除端点与端口右键菜单一致：只在当前组内生效。
  h.groups.enterGroup(group.id);
  assert.equal(h.groups.setPinExposed('b', 'count', false), true);
  assert.equal(h.groups.viewNodes().find((node) => node._nodeGroupVariables)._groupPins.length, 0);
});

test('删除成员原子清理组元数据：失效成员与端点移除，空组整组删除', () => {
  const h = harness();
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  h.groups.enterGroup(group.id);
  h.groups.setPinExposed('b', 'count', true);

  // 删除组内部分成员：仅清理对应成员与端点，组保留。
  h.groups.removeMembers(['b']);
  assert.deepEqual(h.state.raw._nodeGroups[group.id].nodeIds, ['a']);
  assert.deepEqual(h.state.raw._nodeGroups[group.id].pins, []);
  assert.equal(h.groups.pinExposure('b', 'count'), null, '组内不存在的成员不再有暴露状态');

  // 删除最后一个成员：整组连同布局残留一起删除。
  h.groups.removeMembers(['a']);
  assert.equal(h.state.raw._nodeGroups[group.id], undefined);
  assert.equal(h.model.layout()[group.id], undefined);
  assert.equal(h.state.nodeGroupId, '');
  assert.equal(h.groups.groups().length, 0);
});

test('deleteSelection 经 onNodesRemoved 原子清理节点组元数据', () => {
  const h = harness();
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  h.groups.enterGroup(group.id);
  h.groups.setPinExposed('b', 'count', true);
  h.groups.leaveGroup();

  const commands = createCanvasCommands({
    state: h.state,
    nodes: h.model.nodes,
    nodeById: h.model.nodeById,
    layout: h.model.layout,
    mutate: (fn) => fn(),
    clone: (value) => JSON.parse(JSON.stringify(value)),
    toast: () => {},
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    wrap: {clientWidth: 400, clientHeight: 300},
    nodeWidth: 260,
    baseHeight: 96,
    onNodesRemoved: (ids) => h.groups.removeMembers(ids),
  });

  // 删除组成员 b：成员与端点同步移除，组保留。
  h.state.selected = new Set(['b']);
  commands.deleteSelection();
  assert.deepEqual(h.state.raw._nodeGroups[group.id].nodeIds, ['a']);
  assert.deepEqual(h.state.raw._nodeGroups[group.id].pins, []);

  // 删除最后一个成员 a：整组删除。
  h.state.selected = new Set(['a']);
  commands.deleteSelection();
  assert.equal(h.state.raw._nodeGroups[group.id], undefined);
  assert.equal(h.groups.groups().length, 0);
});

test('组接口菜单统一走同一组命令：端口右键项与变量卡「＋」菜单共用', () => {
  const h = harness();
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  h.groups.enterGroup(group.id);

  assert.equal(h.groups.pinMenuEntry('c', 'count'), null, '组外节点没有组接口菜单项');
  assert.equal(h.groups.pinMenuEntry('a', 'count'), null, '成员上不存在的参数没有组接口菜单项');

  // 「＋」菜单：按成员分组列出候选（未暴露的参数），执行后候选消失。
  const menu = h.groups.candidateMenu(group.id);
  assert.equal(menu.length, 1);
  assert.equal(menu[0].label, 'b');
  assert.equal(menu[0].children.length, 1);
  assert.equal(menu[0].children[0].label, '运行次数 · integer');

  // 端口右键项：未暴露 → 「添加到组接口」；执行后变为「从组接口移除」。
  const add = h.groups.pinMenuEntry('b', 'count');
  assert.equal(add.label, '添加到组接口');
  add.run();
  assert.deepEqual(h.state.raw._nodeGroups[group.id].pins, [{nodeId: 'b', param: 'count'}]);
  assert.equal(h.groups.pinCandidates(group.id).length, 0, '添加后候选消失');
  const remove = h.groups.pinMenuEntry('b', 'count');
  assert.equal(remove.label, '从组接口移除');
  assert.equal(remove.danger, true);

  // 移除后参数重新进入候选；经「＋」菜单再添加。
  remove.run();
  const again = h.groups.candidateMenu(group.id);
  assert.equal(again[0].children.length, 1, '移除后参数重新进入候选');
  again[0].children[0].run();
  assert.equal(h.groups.pinCandidates(group.id).length, 0, '添加后候选消失');
});

test('组变量卡高度与位置由 baseHeight/runVariableHeight 计算，与渲染共用一套尺寸', () => {
  const h = harness({baseHeight: 120, runVariableHeight: 30});
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  h.groups.enterGroup(group.id);
  // 成员同排：端点行主导高度，才能暴露 runVariableHeight 的依赖。
  h.model.layout().b = {x: 300, y: 160};
  h.groups.setPinExposed('b', 'count', true);
  const variables = h.groups.viewNodes().find((node) => node._nodeGroupVariables);
  assert.equal(variables._nodeGroupHeight, 120 + 1 * 30, '端点行按 runVariableHeight 累加');

  const iface = h.groups.viewNodes().find((node) => node._nodeGroupInterface);
  assert.equal(iface._nodeGroupPosition.y, Math.round((160 - 120 - 80) / 8) * 8, '接口卡基准高度跟随 baseHeight');
});

test('组边界已经代表的变量：组内视图里不再重复画同名变量卡', () => {
  // b 的参数绑定到 inputs.计数。
  const h = harness({
    nodeVariablePins: (node) => (node.id === 'b'
      ? [{param: 'count', label: '运行次数', type: 'integer', scope: 'inputs', variable: '计数', configured: true}]
      : []),
  });
  assert.equal(h.groups.boundaryVariableRefs().size, 0, '还没进组时没有边界变量');
  h.state.selected = new Set(['a', 'b']);
  h.groups.groupSelection();
  const group = h.groups.groups()[0];
  // 打组时跨越新组边界的既有绑定会自动固化成组接口端点。
  assert.deepEqual(h.state.raw._nodeGroups[group.id].pins, [{nodeId: 'b', param: 'count'}]);
  assert.equal(h.groups.boundaryVariableRefs().size, 0, '不在组内视图时不做这层过滤');
  h.groups.enterGroup(group.id);
  assert.deepEqual([...h.groups.boundaryVariableRefs()], ['inputs.计数'], '组内视图里这个变量由边界行代表');
  assert.equal(h.groups.setPinExposed('b', 'count', false), true);
  assert.equal(h.groups.boundaryVariableRefs().size, 0, '从组接口移除后不再由边界代表');
  h.groups.leaveGroup();
  assert.equal(h.groups.boundaryVariableRefs().size, 0, '退出组后也不过滤（卡片照旧显示）');
});

test('画布入口把「组边界代表的变量」从变量卡列表里剔除（渲染/命中/连线共用同一份）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../dist-test-renderer/canvas/editor.js'), 'utf8');
  assert.match(source, /boundaryVariableRefs/, '画布入口必须用组边界代表的变量过滤卡片');
  assert.match(source, /const variableCardList = \(\) => \{/, '变量卡列表要收敛成作用域内的一份实现');
  assert.match(source, /documentVariableCardList/, '文档里的卡片列表改名保留：组内隐藏只是一层视图过滤');
});
