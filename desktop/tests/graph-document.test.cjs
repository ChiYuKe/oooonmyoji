// Run via npm test (builds the desktop output first).
// 图文档 ⇄ 画布编辑形态：与 tests/test_graph_document.py 共用
// tests/fixtures/graph-rules/cases.json，保证两端把同一份图转成同样的形态。
// 磁盘格式是 `.owf` 文本（`docs/workflow-dsl-v6.md`），落盘出口是 `emitRuntimeDocument`。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  GRAPH_SCHEMA_VERSION,
  emitDocument,
  emitRuntimeDocument,
  graphDocumentIssues,
  isGraphDocument,
  parseDocument,
  toCanvasDocument,
  toGraphDocument,
  validateWorkflow,
} = require('../dist-electron/shared/workflow/index.js');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'graph-rules', 'cases.json'), 'utf8'),
);
const catalog = {
  byName: (name) => {
    const spec = fixture.actions[name];
    if (!spec) return undefined;
    return {
      inputSchema: spec.input_schema,
      outputSchema: spec.output_schema,
      parameters: {},
      retrySafe: Boolean(spec.retry_safe),
    };
  },
  names: () => Object.keys(fixture.actions),
};

const edgeKey = (edge) => `${edge.from.node}:${edge.from.pin}->${edge.to.node}`;

test('识别节点图文档', () => {
  assert.equal(isGraphDocument({ schema_version: 6 }), true);
  assert.equal(isGraphDocument({ schema_version: 4 }), false);
  assert.equal(isGraphDocument(null), false);
  assert.equal(GRAPH_SCHEMA_VERSION, 6);
});

for (const item of fixture.cases) {
  test(`共享图样例：${item.name}`, () => {
    if (!item.valid) {
      const codes = new Set(graphDocumentIssues(item.graph).map((issue) => issue.code));
      for (const code of item.desktop_codes ?? []) {
        assert.ok(codes.has(code), `缺少诊断 ${code}：${JSON.stringify([...codes])}`);
      }
      return;
    }
    assert.deepEqual(graphDocumentIssues(item.graph), []);
    const canvas = toCanvasDocument(item.graph);
    assert.equal(canvas.schema_version, 4, '画布内部形态仍是 v4 字段');
    const byId = new Map(canvas.nodes.map((node) => [node.id, node]));
    for (const [nodeId, expected] of Object.entries(item.expect_nodes ?? {})) {
      const node = byId.get(nodeId);
      assert.ok(node, `缺少节点 ${nodeId}`);
      for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(node[key] ?? [], value, `${nodeId}.${key}`);
      }
    }
    for (const [nodeId, expected] of Object.entries(item.expect_bindings ?? {})) {
      const node = byId.get(nodeId);
      assert.ok(node, `缺少节点 ${nodeId}`);
      for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(node[key], value, `${nodeId}.${key}`);
      }
    }
    for (const [nodeId, at] of Object.entries(item.expect_layout ?? {})) {
      assert.deepEqual(canvas._layout[nodeId], at, `_layout.${nodeId}`);
    }
    if (item.expect_locks) assert.deepEqual(canvas._layoutLocks ?? [], item.expect_locks);
    // 编译/转换之后的文档必须是运行时校验能接受的：两端共用这份样例的意义就在这里。
    assert.deepEqual(validateWorkflow(item.graph, catalog), []);
  });
}

test('编辑形态转回图文档：坐标进节点、执行边进 edges', () => {
  const document = toGraphDocument({
    schema_version: 4,
    id: 'demo',
    version: '4.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', children: ['seq'] },
      { id: 'seq', type: 'sequence', children: ['a', 'judge'] },
      { id: 'a', type: 'task', action: 'test.echo', params: {} },
      { id: 'judge', type: 'condition', expression: true, children: ['yes'], ports: ['true'] },
      { id: 'yes', type: 'task', action: 'test.echo', params: {} },
      { id: 'card', type: 'bool_judge', expression: true },
    ],
    _layout: { root: { x: 10, y: 20 }, seq: { x: 10, y: 140 } },
    _layoutLocks: ['seq'],
    _variableCards: { card_1: { name: 'v1', scope: 'variables', x: 0, y: 0 } },
  });

  assert.equal(document.schema_version, 6);
  assert.deepEqual(document.nodes.find((node) => node.id === 'root').at, { x: 10, y: 20 });
  assert.equal(document.nodes.find((node) => node.id === 'seq').locked, true);
  assert.equal('children' in document.nodes.find((node) => node.id === 'seq'), false);
  assert.equal('_layout' in document, false);
  assert.equal('_layoutLocks' in document, false);
  // 变量卡也进了图：变成变量节点，不再是下划线旁表。
  assert.equal('_variableCards' in document, false);
  const variable = document.nodes.find((node) => node.type === 'variable');
  assert.deepEqual(variable, { id: 'var__variables__v1', type: 'variable', scope: 'variables', name: 'v1', at: { x: 0, y: 0 } });
  assert.deepEqual(
    document.edges.map(edgeKey).sort(),
    [
      'judge:true->yes',
      'root:then.0->seq',
      'seq:then.0->a',
      'seq:then.1->judge',
    ].sort(),
  );
  // 值卡片没有执行边。
  assert.equal(document.edges.some((edge) => edge.from.node === 'card'), false);

  // 再读回来：编辑形态完全一致（坐标、锁、children、ports 都复原）。
  const back = toCanvasDocument(document);
  assert.deepEqual(back.nodes.find((node) => node.id === 'seq').children, ['a', 'judge']);
  assert.deepEqual(back.nodes.find((node) => node.id === 'judge').ports, ['true']);
  assert.deepEqual(back._layout.root, { x: 10, y: 20 });
  assert.deepEqual(back._layoutLocks, ['seq']);
});

test('图文档往返稳定：图 → 编辑形态 → 图', () => {
  for (const item of fixture.cases.filter((entry) => entry.valid)) {
    const again = toGraphDocument(toCanvasDocument(item.graph));
    assert.equal(again.schema_version, 6);
    assert.deepEqual(
      again.edges.map(edgeKey).sort(),
      item.graph.edges.map(edgeKey).sort(),
      `${item.name} 的边应当保持不变`,
    );
    for (const node of item.graph.nodes) {
      const rebuilt = again.nodes.find((entry) => entry.id === node.id);
      assert.deepEqual(rebuilt.at, node.at, `${item.name}:${node.id} 的坐标`);
    }
  }
});

test('自定义节点类型：画布按基类工作，写回时还原成 x- 类型', () => {
  const document = {
    schema_version: 6,
    id: 'custom',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodeTypes: {
      'x-tap_settlement': {
        base: 'task',
        action: 'test.echo',
        params: { verify_gone: true, verify_timeout_seconds: 10 },
        title: '点掉结算页',
      },
    },
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'seq', type: 'sequence', at: { x: 0, y: 100 } },
      { id: 'tap_settle', type: 'x-tap_settlement', params: { verify_timeout_seconds: 3 }, at: { x: 0, y: 200 } },
    ],
    edges: [
      { from: { node: 'root', pin: 'then.0' }, to: { node: 'seq', pin: 'in' } },
      { from: { node: 'seq', pin: 'then.0' }, to: { node: 'tap_settle', pin: 'in' } },
    ],
  };
  const canvas = toCanvasDocument(document);
  const node = canvas.nodes.find((item) => item.id === 'tap_settle');
  // 画布看到的是内置基类 + 合并后的载荷（预设参数与节点覆盖都到位）。
  assert.equal(node.type, 'task');
  assert.equal(node.action, 'test.echo');
  assert.equal(node.name, '点掉结算页');
  assert.deepEqual(node.params, { verify_gone: true, verify_timeout_seconds: 3 });
  assert.equal(node._nodeType, 'x-tap_settlement');

  // 写回图文档：类型还原，内部标记不落盘，nodeTypes 定义原样保留。
  const back = toGraphDocument(canvas);
  const restored = back.nodes.find((item) => item.id === 'tap_settle');
  assert.equal(restored.type, 'x-tap_settlement');
  assert.equal('_nodeType' in restored, false);
  assert.equal(back.nodeTypes['x-tap_settlement'].base, 'task');
  assert.deepEqual(back.edges.map(edgeKey).sort(), document.edges.map(edgeKey).sort());
});

test('自定义类型定义的问题逐条报出来', () => {
  const base = (nodeTypes, nodes) => ({
    schema_version: 6,
    id: 'types',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodeTypes,
    nodes: [{ id: 'root', type: 'root', at: { x: 0, y: 0 } }, ...nodes],
    edges: [],
  });
  const codes = (document) => new Set(graphDocumentIssues(document).map((item) => item.code));
  assert.ok(codes(base({ my_task: { base: 'task' } }, [])).has('graph-type-name'));
  assert.ok(codes(base({ 'x-task': { base: 'nope' } }, [])).has('graph-type-base'));
  assert.ok(codes(base({ 'x-task': { base: 'sequence', children: ['a'] } }, [])).has('graph-type-structure'));
  assert.ok(codes(base({}, [{ id: 'mystery', type: 'x-mystery', at: { x: 0, y: 0 } }])).has('graph-unknown-type'));
  assert.deepEqual(graphDocumentIssues(base({ 'x-task': { base: 'task' } }, [])), []);
});

test('变量节点：图 → 编辑形态重建变量卡与连线，写回后下划线旁表消失', () => {
  const document = {
    schema_version: 6,
    id: 'variables',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: { 模板: { type: 'asset', default: 'a.png' } },
    variables: {},
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'tap', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 100 } },
      { id: 'var__inputs__模板', type: 'variable', scope: 'inputs', name: '模板', at: { x: -200, y: 100 } },
    ],
    edges: [
      { from: { node: 'root', pin: 'then.0' }, to: { node: 'tap', pin: 'in' } },
      { from: { node: 'var__inputs__模板', pin: 'out' }, to: { node: 'tap', pin: 'value' } },
    ],
  };
  const canvas = toCanvasDocument(document);
  // 变量节点不是画布节点，而是变量卡。
  assert.equal(canvas.nodes.some((node) => node.type === 'variable'), false);
  assert.deepEqual(canvas._variableCards['var__inputs__模板'], { name: '模板', scope: 'inputs', x: -200, y: 100 });
  assert.deepEqual(canvas.nodes.find((node) => node.id === 'tap').params.value, { ref: 'inputs.模板' });
  assert.equal(canvas._variableLinks['tap:value'], 'var__inputs__模板');

  const back = toGraphDocument(canvas);
  assert.equal('_variableCards' in back, false, '变量卡不该再以旁表落盘');
  assert.equal('_variableLinks' in back, false, '变量连线不该再以旁表落盘');
  const variable = back.nodes.find((node) => node.type === 'variable');
  assert.deepEqual(variable, { id: 'var__inputs__模板', type: 'variable', scope: 'inputs', name: '模板', at: { x: -200, y: 100 } });
  assert.deepEqual(back.edges.map(edgeKey).sort(), document.edges.map(edgeKey).sort());
  // 再读一遍：稳定（不会反复改 id 或丢坐标）。
  assert.deepEqual(toGraphDocument(toCanvasDocument(back)), back);
});

test('变量卡与内联变量引用都折成变量节点与边', () => {
  const canvas = {
    schema_version: 4,
    id: 'canvas_variables',
    root: 'root',
    inputs: { 模板: { type: 'asset' } },
    variables: {},
    nodes: [
      { id: 'root', type: 'root', children: ['tap'] },
      { id: 'tap', type: 'task', action: 'test.echo', params: { value: { ref: 'inputs.模板' } } },
    ],
    _layout: { root: { x: 0, y: 0 } },
    _variableCards: { card_1: { name: '模板', scope: 'inputs', x: -200, y: 40 } },
    _variableLinks: { 'tap:value': 'card_1' },
  };
  const document = toGraphDocument(canvas);
  assert.equal('_variableCards' in document, false);
  assert.equal('_variableLinks' in document, false);
  // id 由 (作用域, 键) 推导，所以卡片 id 变了也不影响文件的稳定性。
  const variable = document.nodes.find((node) => node.type === 'variable');
  assert.equal(variable.id, 'var__inputs__模板');
  assert.deepEqual(variable.at, { x: -200, y: 40 });
  assert.equal('value' in document.nodes.find((node) => node.id === 'tap').params, false, '内联引用被摘走了');
  assert.deepEqual(
    document.edges.map(edgeKey).sort(),
    ['root:then.0->tap', 'var__inputs__模板:out->tap'],
  );
});

test('变量节点的问题逐条报出来', () => {
  const base = (nodes, edges) => ({
    schema_version: 6, id: 'v', version: '5.0.0', resolution: [100, 100], root: 'root',
    inputs: {}, variables: {}, nodes: [{ id: 'root', type: 'root', at: { x: 0, y: 0 } }, ...nodes], edges,
  });
  const codes = (document) => new Set(graphDocumentIssues(document).map((item) => item.code));
  assert.ok(codes(base([{ id: 'bad', type: 'variable', name: '模板', at: { x: 0, y: 0 } }], [])).has('graph-variable-scope'));
  assert.ok(codes(base([{ id: 'bad', type: 'variable', scope: 'inputs', at: { x: 0, y: 0 } }], [])).has('graph-variable-name'));
  assert.ok(codes(base(
    [{ id: 'produce', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 0 } },
     { id: 'v1', type: 'variable', scope: 'inputs', name: '模板', at: { x: 0, y: 0 } }],
    [{ from: { node: 'produce', pin: 'out.value' }, to: { node: 'v1', pin: 'out' } }],
  )).has('graph-variable-target'));
  assert.ok(codes(base(
    [{ id: 't', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 0 } },
     { id: 'v1', type: 'variable', scope: 'inputs', name: '模板', at: { x: 0, y: 0 } }],
    [{ from: { node: 'v1', pin: 'then.0' }, to: { node: 't', pin: 'in' } }],
  )).has('graph-variable-exec-pin'));
  assert.deepEqual(graphDocumentIssues(base([{ id: 'v1', type: 'variable', scope: 'inputs', name: '模板', at: { x: 0, y: 0 } }], [])), []);
});

test('节点组：文档里的 groups 回到画布旁表，写回时再搬回 groups', () => {
  const document = {
    schema_version: 6,
    id: 'groups',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    groups: [
      {
        id: 'node_group_1',
        name: '收尾',
        nodeIds: ['a', 'b'],
        pins: [{ nodeId: 'b', param: 'value' }],
        pinPolicy: 'explicit-v1',
        at: { x: 996, y: 1040 },
        interfaceAt: { x: 830, y: 0 },
        variablesAt: { x: -448, y: 376 },
      },
    ],
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'seq', type: 'sequence', at: { x: 0, y: 100 } },
      { id: 'a', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 200 } },
      { id: 'b', type: 'task', action: 'test.echo', params: {}, at: { x: 200, y: 200 } },
    ],
    edges: [
      { from: { node: 'root', pin: 'then.0' }, to: { node: 'seq', pin: 'in' } },
      { from: { node: 'seq', pin: 'then.0' }, to: { node: 'a', pin: 'in' } },
      { from: { node: 'seq', pin: 'then.1' }, to: { node: 'b', pin: 'in' } },
    ],
  };
  const canvas = toCanvasDocument(document);
  assert.equal('groups' in canvas, false, '画布文档用 _nodeGroups，不再有 groups');
  assert.deepEqual(canvas._nodeGroups.node_group_1, {
    name: '收尾',
    nodeIds: ['a', 'b'],
    pins: [{ nodeId: 'b', param: 'value' }],
    pinPolicy: 'explicit-v1',
  });
  // 组卡、组接口卡、组变量卡的位置都回到 `_layout`（它们不是节点）。
  assert.deepEqual(canvas._layout.node_group_1, { x: 996, y: 1040 });
  assert.deepEqual(canvas._layout['__node_group_interface__:node_group_1'], { x: 830, y: 0 });
  assert.deepEqual(canvas._layout['__node_group_variables__:node_group_1'], { x: -448, y: 376 });

  const back = toGraphDocument(canvas);
  assert.equal('_nodeGroups' in back, false, '节点组不该再以旁表落盘');
  assert.deepEqual(back.groups, document.groups);
  // 再读一遍稳定。
  assert.deepEqual(toGraphDocument(toCanvasDocument(back)), back);
});

test('节点组的问题逐条报出来', () => {
  const base = (groups, nodes) => ({
    schema_version: 6, id: 'g', version: '5.0.0', resolution: [100, 100], root: 'root',
    inputs: {}, variables: {},
    groups,
    nodes: [{ id: 'root', type: 'root', at: { x: 0, y: 0 } }, ...nodes],
    edges: [],
  });
  const codes = (document) => new Set(graphDocumentIssues(document).map((item) => item.code));
  const task = (id) => ({ id, type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 0 } });
  assert.ok(codes(base([{ id: 'g1', nodeIds: ['ghost'] }], [])).has('graph-group-unknown-member'));
  assert.ok(codes(base([{ id: 'g1', nodeIds: ['a'], pins: [{ nodeId: 'b', param: 'value' }] }], [task('a'), task('b')])).has('graph-group-pin-outside'));
  assert.ok(codes(base([{ id: 'g1', nodeIds: ['a'] }, { id: 'g1', nodeIds: ['a'] }], [task('a')])).has('graph-group-duplicate'));
  assert.ok(codes(base([{ id: 'g1', nodeIds: [] }], [])).has('graph-group-members'));
  assert.deepEqual(graphDocumentIssues(base([{ id: 'g1', nodeIds: ['a'] }], [task('a')])), []);
});

test('注释框：文档里校验、进出画布都原样带着', () => {
  const document = {
    schema_version: 6,
    id: 'comments',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    comments: [
      { id: 'comment_1', text: '结算页分支', at: { x: 1040, y: 640 }, size: { w: 420, h: 260 }, tint: 'warning' },
      { id: 'comment_2', text: '入口', at: { x: 0, y: -120 } },
    ],
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'run', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 100 } },
    ],
    edges: [{ from: { node: 'root', pin: 'then.0' }, to: { node: 'run', pin: 'in' } }],
  };
  // 注释框不是节点、也不是旁表：画布文档里就是同一个 `comments` 数组。
  const canvas = toCanvasDocument(document);
  assert.deepEqual(canvas.comments, document.comments);
  const back = toGraphDocument(canvas);
  assert.deepEqual(back.comments, document.comments);
  assert.deepEqual(graphDocumentIssues(document), []);
});

test('注释框的问题逐条报出来', () => {
  const base = (comments) => ({
    schema_version: 6, id: 'c', version: '5.0.0', resolution: [100, 100], root: 'root',
    inputs: {}, variables: {}, comments,
    nodes: [{ id: 'root', type: 'root', at: { x: 0, y: 0 } }], edges: [],
  });
  const codes = (document) => new Set(graphDocumentIssues(document).map((item) => item.code));
  assert.ok(codes(base([{ id: 'c1', text: 'a', at: { x: 0, y: 0 } }, { id: 'c1', text: 'b', at: { x: 0, y: 0 } }])).has('graph-comment-duplicate'));
  assert.ok(codes(base([{ id: 'c1', text: 'a' }])).has('graph-comment-position'));
  assert.ok(codes(base([{ id: 'c1', text: 3, at: { x: 0, y: 0 } }])).has('graph-comment-text'));
  assert.ok(codes(base([{ id: 'c1', text: 'a', at: { x: 0, y: 0 }, size: { w: 0, h: 10 } }])).has('graph-comment-size'));
  assert.deepEqual(graphDocumentIssues(base([{ id: 'c1', text: 'a', at: { x: 0, y: 0 } }])), []);
});

test('手工折线：边上带的 waypoints 在画布往返里不丢', () => {
  const document = {
    schema_version: 6,
    id: 'waypoints',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'a', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 100 } },
      { id: 'b', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 200 } },
    ],
    edges: [
      { from: { node: 'root', pin: 'then.0' }, to: { node: 'a', pin: 'in' }, waypoints: [{ x: 100, y: 80 }, { x: 120, y: 180 }] },
      { from: { node: 'a', pin: 'out.value' }, to: { node: 'b', pin: 'x' }, waypoints: [{ x: 40, y: 160 }] },
      { from: { node: 'root', pin: 'then.1' }, to: { node: 'b', pin: 'in' } },
    ],
  };
  const canvas = toCanvasDocument(document);
  // 画布的边是现推出来的，所以折点先寄存在编辑期旁表里。
  assert.deepEqual(canvas._edgeWaypoints, [
    { from: { node: 'root', pin: 'then.0' }, to: { node: 'a', pin: 'in' }, waypoints: [{ x: 100, y: 80 }, { x: 120, y: 180 }] },
    { from: { node: 'a', pin: 'out.value' }, to: { node: 'b', pin: 'x' }, waypoints: [{ x: 40, y: 160 }] },
  ]);
  const back = toGraphDocument(canvas);
  assert.equal('_edgeWaypoints' in back, false, '折点表不该落盘');
  const routed = back.edges.filter((edge) => edge.waypoints);
  assert.equal(routed.length, 2);
  assert.deepEqual(
    routed.map((edge) => edgeKey(edge)).sort(),
    ['a:out.value->b', 'root:then.0->a'],
  );
  const exec = routed.find((edge) => edge.from.pin === 'then.0');
  assert.deepEqual(exec.waypoints, [{ x: 100, y: 80 }, { x: 120, y: 180 }], '折点顺序与坐标原样保留');
  // 没有折点的边不写 waypoints；再往返一次稳定。
  assert.equal(back.edges.find((edge) => edge.from.pin === 'then.1').waypoints, undefined);
  assert.deepEqual(toGraphDocument(toCanvasDocument(back)), back);
});

test('手工折线：then 是 then.0 的别名，别名写法不会丢折点', () => {
  const document = {
    schema_version: 6,
    id: 'alias',
    version: '5.0.0',
    resolution: [100, 100],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'a', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 100 } },
    ],
    edges: [{ from: { node: 'root', pin: 'then' }, to: { node: 'a', pin: 'in' }, waypoints: [{ x: 24, y: 40 }] }],
  };
  const back = toGraphDocument(toCanvasDocument(document));
  assert.deepEqual(back.edges[0], { from: { node: 'root', pin: 'then.0' }, to: { node: 'a', pin: 'in' }, waypoints: [{ x: 24, y: 40 }] });
});

test('手工折线的问题逐条报出来', () => {
  const base = (edges) => ({
    schema_version: 6, id: 'w', version: '5.0.0', resolution: [100, 100], root: 'root',
    inputs: {}, variables: {},
    nodes: [{ id: 'root', type: 'root', at: { x: 0, y: 0 } }, { id: 'a', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 100 } }],
    edges,
  });
  const codes = (document) => new Set(graphDocumentIssues(document).map((item) => item.code));
  assert.ok(codes(base([{ from: { node: 'root', pin: 'then.0' }, to: { node: 'a', pin: 'in' }, waypoints: [{ x: 1 }] }])).has('graph-waypoint-position'));
  assert.deepEqual(graphDocumentIssues(base([{ from: { node: 'root', pin: 'then.0' }, to: { node: 'a', pin: 'in' }, waypoints: [{ x: 1, y: 2 }] }])), []);
});

test('变量节点的坐标进 _variableCards，不进 _layout（否则每次打开都报坐标残留）', () => {
  const document = {
    schema_version: 6,
    id: 'variable_layout',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: { 模板: { type: 'asset', default: 'a.png' } },
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'tap', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 100 } },
      { id: 'var__variables__模板', type: 'variable', scope: 'variables', name: '模板', at: { x: -184, y: 200 } },
    ],
    edges: [
      { from: { node: 'root', pin: 'then.0' }, to: { node: 'tap', pin: 'in' } },
      { from: { node: 'var__variables__模板', pin: 'out' }, to: { node: 'tap', pin: 'value' } },
    ],
  };
  const canvas = toCanvasDocument(document);
  assert.deepEqual(canvas._layout['var__variables__模板'], undefined, '变量节点不该占 _layout');
  assert.deepEqual(canvas._layout.tap, { x: 0, y: 100 });
  // 变量卡的位置照样带上：坐标只是换了地方存。
  assert.deepEqual(canvas._variableCards['var__variables__模板'], { name: '模板', scope: 'variables', x: -184, y: 200 });
  // 体检：没有「指向不存在节点的残留坐标」。
  const { inspectLayout } = require('../dist-test-renderer/canvas/model/document-health.js');
  const health = inspectLayout(canvas);
  assert.deepEqual(health.orphan, []);
  assert.equal(health.needsPrune, false);
  // 写回图文档也不丢：变量节点的 at 从变量卡回到节点上。
  const back = toGraphDocument(canvas);
  assert.deepEqual(back.nodes.find((node) => node.type === 'variable').at, { x: -184, y: 200 });
});

test('两个方向的转换都不许改动调用方手里的文档', () => {
  const canvas = {
    schema_version: 4,
    id: 'demo',
    root: 'root',
    nodes: [
      { id: 'root', type: 'root', children: ['seq'] },
      { id: 'seq', type: 'sequence', children: ['produce', 'consume'] },
      { id: 'produce', type: 'task', action: 'test.echo', params: {} },
      { id: 'consume', type: 'task', action: 'test.echo', params: { value: { ref: 'nodes.produce.output.value' } } },
    ],
    _layout: { root: { x: 0, y: 0 } },
  };
  const canvasSnapshot = JSON.stringify(canvas);
  const document = toGraphDocument(canvas);
  assert.equal(JSON.stringify(canvas), canvasSnapshot, '转图文档时改动了画布文档');
  assert.deepEqual(canvas.nodes[3].params.value, { ref: 'nodes.produce.output.value' }, '内联引用被就地摘掉了');
  const consumed = document.edges.find((edge) => edge.from.pin === 'out.value');
  assert.deepEqual(consumed, { from: { node: 'produce', pin: 'out.value' }, to: { node: 'consume', pin: 'value' } });

  // 反向：图 → 编辑形态时同样不许改图文档（数据边会往载荷里写引用）。
  const graphSnapshot = JSON.stringify(document);
  const back = toCanvasDocument(document);
  assert.equal(JSON.stringify(document), graphSnapshot, '读入画布时改动了图文档');
  assert.deepEqual(back.nodes.find((node) => node.id === 'consume').params.value, {
    ref: 'nodes.produce.output.value',
  });
});

test('落盘只有一条出口：编辑形态 → `.owf` 文本', () => {
  const canvas = {
    schema_version: 4,
    id: 'demo',
    version: '1.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', children: ['capture'] },
      { id: 'capture', type: 'task', action: 'core.capture', params: {} },
    ],
    _layout: { root: { x: 1, y: 2 } },
  };
  const text = emitRuntimeDocument(canvas);
  assert.equal(text.startsWith('workflow demo\n'), true);
  assert.equal(text.includes('at: [1, 2]'), true);
  assert.equal(text.endsWith('\n'), true);

  const parsed = parseDocument(text);
  assert.equal(parsed.schema_version, 6);
  assert.deepEqual(parsed.nodes[0].at, { x: 1, y: 2 });
  assert.deepEqual(parsed.edges, [{ from: { node: 'root', pin: 'then.0' }, to: { node: 'capture', pin: 'in' } }]);
  // 规范形式是不动点：写出去再读回来再写，逐字相同
  assert.equal(emitDocument(parsed), text);
});

test('校验器接受 v5 文档，并禁止把值卡片接进执行流', () => {
  const base = (extraNodes, extraEdges) => ({
    schema_version: 6,
    id: 'accept',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'run', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 100 } },
      ...extraNodes,
    ],
    edges: [
      { from: { node: 'root', pin: 'then.0' }, to: { node: 'run', pin: 'in' } },
      ...extraEdges,
    ],
  });
  assert.deepEqual(validateWorkflow(base([], []), catalog), []);

  // 值卡片独立摆放：没有执行父级也不算错（它按需求值）。
  const withCard = base(
    [{ id: 'judge', type: 'bool_judge', expression: { eq: [1, 1] }, at: { x: 300, y: 300 } }],
    [],
  );
  assert.deepEqual(validateWorkflow(withCard, catalog), []);
});

test('主进程解析也认 v5：引用建议依赖的 children 顺序必须推出来', () => {
  const { parseWorkflow } = require('../dist-electron/shared/workflow/index.js');
  const document = {
    schema_version: 6,
    id: 'parse',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'seq', type: 'sequence', at: { x: 0, y: 100 } },
      { id: 'first', type: 'task', action: 'test.echo', params: {}, at: { x: 0, y: 200 } },
      { id: 'second', type: 'task', action: 'test.echo', params: {}, at: { x: 200, y: 200 } },
    ],
    edges: [
      { from: { node: 'root', pin: 'then.0' }, to: { node: 'seq', pin: 'in' } },
      { from: { node: 'seq', pin: 'then.1' }, to: { node: 'second', pin: 'in' } },
      { from: { node: 'seq', pin: 'then.0' }, to: { node: 'first', pin: 'in' } },
    ],
  };
  const info = parseWorkflow(document);
  assert.equal(info.id, 'parse');
  assert.deepEqual(info.nodes.find((node) => node.id === 'seq').children, ['first', 'second']);
  // 解析结果里的 raw 也是编辑形态：`_layout` 带着坐标，节点上没有 `at`。
  assert.deepEqual(info.raw._layout.seq, { x: 0, y: 100 });
  assert.equal('at' in info.raw.nodes.find((node) => node.id === 'seq'), false);
});

test('实例并行项在两种格式下都能识别（运行宿主靠它决定投递到哪些实例）', () => {
  const { instanceParallelRuns } = require('../dist-electron/shared/workflow/index.js');
  const runs = [
    { instance: 'mumu-0', workflow: '活动副本.json', inputs: {} },
    { instance: 'mumu-1', workflow: '活动副本.json', inputs: {} },
  ];
  const tree = {
    schema_version: 4,
    id: 'run_accounts',
    version: '4.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', children: ['run_all'] },
      { id: 'run_all', type: 'instance_parallel', runs, wait_for: 'all' },
    ],
  };
  const graph = {
    schema_version: 6,
    id: 'run_accounts',
    version: '5.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'run_all', type: 'instance_parallel', runs, wait_for: 'all', at: { x: 0, y: 100 } },
    ],
    edges: [{ from: { node: 'root', pin: 'then.0' }, to: { node: 'run_all', pin: 'in' } }],
  };
  assert.deepEqual(instanceParallelRuns(tree).map((run) => run.instance), ['mumu-0', 'mumu-1']);
  assert.deepEqual(instanceParallelRuns(graph).map((run) => run.instance), ['mumu-0', 'mumu-1']);
  assert.deepEqual(instanceParallelRuns({ schema_version: 6, root: 'root', nodes: [] }), []);
});
