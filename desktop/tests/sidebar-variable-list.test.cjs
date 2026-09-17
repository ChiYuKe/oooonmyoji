// Run via npm test (builds the renderer test output first).
// 变量列表推送已迁到 src/canvas/model/sidebar-state.ts：直接实例化编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createSidebarState } = require('../dist-test-renderer/canvas/model/sidebar-state.js');

// 变量列表（桌面端左下角）由编辑器 postSidebarState 推送，这里直接跑生产实现。
function harness(raw, nodeCardRefs = []) {
  const messages = [];
  const controller = createSidebarState({
    state: { raw, inspector: 'none', selectedVariable: '', selectedVariableScope: 'inputs', selected: new Set() },
    collectNodeCardVariableRefs: () => new Set(nodeCardRefs),
    nodes: () => (Array.isArray(raw.nodes) ? raw.nodes : []).map((node, index) => ({ id: node.id || `node_${index}`, ...node })),
    currentInspectorSelection: () => ({ kind: 'none' }),
    vscode: { postMessage: (message) => messages.push(message) },
  });
  controller.postSidebarState();
  return { messages };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('变量列表包含已经连到节点卡片上的变量，并标记 onCard', () => {
  const {messages} = harness({
    inputs: { 超时: { type: 'number', display_name: '超时' }, 未使用: { type: 'string' } },
    variables: { 轮数: { type: 'integer' } },
  }, ['inputs.超时', 'variables.轮数']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'sidebarStateChanged');
  assert.deepEqual(plain(messages[0].variables.map((item) => `${item.scope}.${item.name}`)), ['inputs.超时', 'inputs.未使用', 'variables.轮数']);
  const onCard = {};
  for (const item of messages[0].variables) onCard[`${item.scope}.${item.name}`] = item.onCard === true;
  assert.deepEqual(plain(onCard), { 'inputs.超时': true, 'inputs.未使用': false, 'variables.轮数': true });
  assert.deepEqual(plain(messages[0].variables[0]), { name: '超时', displayName: '超时', group: '', type: 'number', scope: 'inputs', public: true, onCard: true });
});

test('没有连线的变量不会被标记为已连接', () => {
  const {messages} = harness({ inputs: { a: { type: 'integer' } } }, []);
  assert.deepEqual(plain(messages[0].variables.map((item) => item.onCard)), [false]);
});

test('自动生成的初始值输入仍然不出现在变量列表里', () => {
  const {messages} = harness({
    inputs: { 次数: { type: 'integer' }, '次数 · 初始值': { type: 'integer', _autoPublished: true } },
    variables: {},
  }, []);
  assert.deepEqual(plain(messages[0].variables.map((item) => item.name)), ['次数']);
});
