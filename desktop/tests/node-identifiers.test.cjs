const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isStandardNodeId, nextNodeId, normalizeNodeIdentifiers, remapNodeIdentifiers} = require('../dist-test-renderer/shared/workflow/node-identifiers.js');

test('standard node IDs use full type names, positive indices and unique values', () => {
  for (const id of ['root_1', 'task_25', 'bool_judge_1', 'simple_parallel_2', 'node_group_1']) assert.equal(isStandardNodeId(id), true);
  for (const id of ['task', 'Task_1', 'task_0', 'task_01', 'task_-1', 'task_1.2', '任务_1', 'bool_1', 'wait_for_party_1']) assert.equal(isStandardNodeId(id), false);
  assert.equal(nextNodeId('bool_judge', ['bool_judge_1', 'bool_judge_2']), 'bool_judge_3');
  assert.equal(nextNodeId('未知类型', []), 'node_1');
});

test('migration remaps whole outputs, nested fields and metadata without changing literal data', () => {
  const raw = {
    root: 'entry', nodes: [
      {id: 'entry', type: 'root', children: ['route']},
      {id: 'route', type: 'switch', children: ['source', 'target'], cases: [{value: 'source', child: 'source'}], default_child: 'target'},
      {id: 'source', type: 'task', params: {message: 'nodes.source.output', path: 'assets/source.png'}},
      {id: 'target', type: 'task', params: {whole: {ref: 'nodes.source.output'}, field: {ref: 'nodes.source.output.value'}, variable: {ref: 'inputs.source'}}},
      {id: 'task_1', type: 'task'},
    ],
    _layout: {source: {x: 1, y: 2}, 'legacy-group': {x: 3, y: 4}, '__node_group_interface__:legacy-group': {x: 5, y: 6}},
    _layoutLocks: ['source', 'legacy-group'],
    _nodeGroups: {'legacy-group': {nodeIds: ['source', 'target'], pins: [{nodeId: 'target', param: 'whole'}]}},
    _variableLinks: {'target:whole': 'card_1'},
    _edgeWaypoints: [{from: {node: 'source', pin: 'out'}, to: {node: 'target', pin: 'whole'}, waypoints: [{x: 3, y: 4}]}],
  };
  const before = structuredClone(raw);
  const mapping = normalizeNodeIdentifiers(raw);
  assert.equal(mapping.get('source'), 'task_2', 'reserve already standard IDs first');
  assert.equal(raw.nodes[3].params.whole.ref, 'nodes.task_2.output');
  assert.equal(raw.nodes[3].params.field.ref, 'nodes.task_2.output.value');
  assert.equal(raw.nodes[2].params.message, 'nodes.source.output');
  assert.equal(raw.nodes[1].cases[0].value, 'source');
  assert.equal(raw._nodeGroups.node_group_1.pins[0].nodeId, 'task_3');
  assert.deepEqual(raw._layout.task_2, {x: 1, y: 2});
  assert.equal(normalizeNodeIdentifiers(raw).size, 0);
  raw.nodes[2].name = '改名'; raw.nodes[2].type = 'sequence';
  assert.equal(normalizeNodeIdentifiers(raw).size, 0, 'display name/type changes preserve stable identity');
  delete raw.nodes[2].name; raw.nodes[2].type = 'task';
  remapNodeIdentifiers(raw, new Map([...mapping].map(([oldId, id]) => [id, oldId])));
  assert.deepEqual(raw, before);
});

test('graph migration preserves derived variable IDs and updates edge endpoints and group pins', () => {
  const raw = {root: 'entry', nodes: [{id: 'entry', type: 'root'}, {id: 'old', type: 'task'}, {id: 'var__inputs__轮次', type: 'variable', scope: 'inputs', name: '轮次'}],
    groups: [{id: 'group', nodeIds: ['old'], pins: [{nodeId: 'old', param: 'value'}]}],
    edges: [{from: {node: 'var__inputs__轮次', pin: 'out'}, to: {node: 'old', pin: 'value'}}]};
  const before = structuredClone(raw), mapping = normalizeNodeIdentifiers(raw);
  assert.equal(raw.nodes[2].id, 'var__inputs__轮次');
  assert.equal(raw.edges[0].to.node, 'task_1');
  assert.equal(raw.groups[0].pins[0].nodeId, 'task_1');
  remapNodeIdentifiers(raw, new Map([...mapping].map(([oldId, id]) => [id, oldId])));
  assert.deepEqual(raw, before);
});

test('missing or duplicate identities refuse migration before touching data', () => {
  for (const nodes of [[{id: 'same', type: 'root'}, {id: 'same', type: 'task'}], [{type: 'task'}]]) {
    const raw = {nodes}, before = structuredClone(raw);
    assert.throws(() => normalizeNodeIdentifiers(raw), /缺失或重复/);
    assert.deepEqual(raw, before);
  }
});
