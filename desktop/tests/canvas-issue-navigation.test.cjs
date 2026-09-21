// Run via npm test (builds the renderer test output first).
// 阶段 6：问题导航与折叠组问题汇总（纯函数）。
// - 问题目标按文档顺序排列，同一节点先错误后提醒；
// - children 路径还原成可导航的那条连线；
// - 折叠组汇总只数组员的问题，第一个目标优先错误。
const {test} = require('node:test');
const assert = require('node:assert/strict');

const { issueTargets, groupIssueSummary } = require('../dist-test-renderer/canvas/model/issue-navigation.js');

const doc = () => ({
  root: 'root',
  nodes: [
    {id: 'root', type: 'root', children: ['seq']},
    {id: 'seq', type: 'sequence', children: ['a', 'b']},
    {id: 'a', type: 'task', action: 'core.log', params: {}},
    {id: 'b', type: 'task', action: 'core.log', params: {}},
  ],
});

test('issueTargets 按文档顺序排列，同一节点先错误后提醒', () => {
  const targets = issueTargets(doc(), [
    { path: ['nodes', 'b'], message: 'b 的提醒', severity: 'warning' },
    { path: ['inputs', '阈值'], message: '工作流级错误', severity: 'error' },
    { path: ['nodes', 'a', 'params', 'text'], message: 'a 的参数错误', severity: 'error' },
    { path: ['nodes', 'b'], message: 'b 的错误', severity: 'error' },
  ]);
  assert.deepEqual(targets.map((target) => target.message), [
    'a 的参数错误',      // 节点 a 在文档里靠前
    'b 的错误',          // 同一节点：错误在前
    'b 的提醒',
    '工作流级错误',      // 解析不到节点：排在最后
  ]);
  assert.deepEqual(targets.map((target) => target.severity), ['error', 'error', 'warning', 'error']);
  assert.equal(targets[0].nodeId, 'a');
  assert.equal(targets[0].param, 'text', '参数路径解析出端点名（定位时闪那一行）');
});

test('issueTargets 把 children 路径还原成可导航的连线', () => {
  const targets = issueTargets(doc(), [
    { path: ['nodes', 'seq', 'children', 1], message: '未知子节点：b', severity: 'error', code: 'unknown-child' },
    { path: ['nodes', 'seq', 'children', 9], message: '下标越界', severity: 'error' },
  ]);
  assert.equal(targets[0].edgeParent, 'seq');
  assert.equal(targets[0].edgeChild, 'b');
  assert.equal(targets[0].nodeId, 'seq', '同时保留父节点，方便选中它');
  assert.equal(targets[1].edgeChild, '', '下标越界时没有连线可定位');
});

test('issueTargets 用下标还原缺 id 的节点，并对坏输入保持稳定', () => {
  const raw = {root: 'r', nodes: [{id: 'r', type: 'root', children: []}, {type: 'task'}]};
  const targets = issueTargets(raw, [
    { path: ['nodes', 1, 'params', 'x'], message: '第二个节点缺 id', severity: 'error' },
  ]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].param, 'x');
  assert.deepEqual(issueTargets(null, null), []);
  assert.deepEqual(issueTargets(doc(), [null, 3, {}]).filter((target) => target.message), []);
});

test('groupIssueSummary 只数组员的问题，first 优先错误且按文档顺序', () => {
  const raw = doc();
  raw._nodeGroups = {
    grp: {id: 'grp', name: '组', nodeIds: ['b', 'a'], pins: [], pinPolicy: 'explicit-v1'},
  };
  const byNode = new Map([
    ['a', { node: [{message: 'a 错误'}], params: new Map([['x', [{message: 'a 参数错误'}]]]) }],
    ['b', { node: [], params: new Map() }],
    ['outside', { node: [{message: '组外不参与'}], params: new Map() }],
  ]);
  const warnings = new Map([['b', [{message: 'b 提醒'}, {message: 'b 提醒 2'}]]]);
  const summary = groupIssueSummary(raw, 'grp', ['b', 'a'], byNode, warnings);
  assert.equal(summary.errors, 2, '节点级 + 参数级都计入');
  assert.equal(summary.warnings, 2);
  assert.equal(summary.first, 'a', '优先错误，且 a 在文档里靠前');
});

test('groupIssueSummary 只有提醒时 first 指向提醒节点；空组没有任何统计', () => {
  const raw = doc();
  const warnings = new Map([['b', [{message: '提醒'}]]]);
  const summary = groupIssueSummary(raw, 'grp', ['b'], new Map(), warnings);
  assert.deepEqual(summary, { errors: 0, warnings: 1, first: 'b' });
  assert.deepEqual(groupIssueSummary(raw, 'missing', [], new Map(), new Map()), { errors: 0, warnings: 0, first: '' });
});
