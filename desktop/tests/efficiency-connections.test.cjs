const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasCommands } = require('../dist-test-renderer/canvas/state/commands.js');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');

test('拖线创建预检使用当前节点组，已有节点仍遵守实际组边界', () => {
  const state = createCanvasState();
  state.raw = { nodes: [{ id: 'entry', type: 'group_entry', children: [] }, { id: 'seq', type: 'sequence', children: [] }, { id: 'outside', type: 'task', action: 'capture', params: {} }], _nodeGroups: { group: { nodeIds: ['entry', 'seq'] } } };
  const nodes = () => state.raw.nodes, byId = (id) => nodes().find((item) => item.id === id);
  const commands = createCanvasCommands({ state, nodes, nodeById: byId, layout: () => ({}), mutate: (fn) => fn(), clone: (value) => structuredClone(value), toast() {}, worldPoint: (point) => point, wrap: { clientWidth: 100, clientHeight: 100 }, nodeWidth: 260, baseHeight: 96 });
  const task = commands.buildNode('task');
  assert.equal(commands.canConnectNodes(byId('seq'), task, null, 'group'), null);
  assert.match(commands.canConnectNodes(byId('seq'), task), /跨折叠图/);
  assert.equal(commands.canConnectNodes(byId('entry'), task, null, 'group'), null);
  assert.match(commands.canConnectNodes(byId('entry'), task), /本折叠图/);
  assert.match(commands.canConnectNodes(byId('seq'), byId('outside'), null, 'group'), /跨折叠图/);
  const parent = commands.buildNode('sequence');
  assert.equal(commands.canConnectNodes(parent, byId('seq'), null, 'group'), null);
  assert.match(commands.canConnectNodes(task, byId('seq'), null, 'group'), /没有子节点输出/);
});
