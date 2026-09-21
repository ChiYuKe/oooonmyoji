/**
 * 卡片错误标记：校验问题按节点/参数落到卡片行上（纯映射）与节点卡片渲染契约。
 *
 * 路径约定与 `shared/workflow/validate.ts` 一致：`['nodes', <节点 id>, 'params', <参数名>, ...]`。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { issuesByNode, issueTitle, issuesByEdge, nodeIssues, paramIssues, splitBySeverity, warningsByNode } = require('../dist-test-renderer/canvas/model/card-issues.js');

test('issuesByNode 只认节点 id，并按参数分组', () => {
  const byNode = issuesByNode([
    { path: ['nodes', 'task_1', 'params', 'timeout_seconds'], message: '缺少超时', severity: 'error', code: 'invalid-params' },
    { path: ['nodes', 'task_1', 'params', 'match', 'x'], message: 'match.x 类型不对', severity: 'error', code: 'invalid-params' },
    { path: ['nodes', 'task_1'], message: '节点级错误', severity: 'error', code: 'invalid-task' },
    { path: ['nodes', 'task_2', 'params', 'text'], message: '另一个节点', severity: 'error', code: 'invalid-params' },
    // 非错误、以及解析不出节点 id 的问题都不落到卡片上。
    { path: ['nodes', 'task_2', 'params', 'text'], message: '只是警告', severity: 'warning' },
    { path: ['inputs', '阈值'], message: '工作流级问题', severity: 'error' },
    { path: [], message: 'JSON 解析失败', severity: 'error' },
    { path: ['nodes', 3, 'params', 'x'], message: '没有 id 的节点', severity: 'error' },
  ]);
  assert.deepEqual([...byNode.keys()], ['task_1', 'task_2']);
  const first = nodeIssues(byNode, 'task_1');
  assert.deepEqual(first.node.map((item) => item.message), ['节点级错误']);
  assert.deepEqual([...first.params.keys()], ['timeout_seconds', 'match']);
  assert.deepEqual(paramIssues(first, 'timeout_seconds').map((item) => item.message), ['缺少超时']);
  // 嵌套路径（match.x）归到顶层参数 match 上。
  assert.deepEqual(paramIssues(first, 'match').map((item) => item.message), ['match.x 类型不对']);
  assert.deepEqual(paramIssues(first, 'missing'), []);
  assert.deepEqual(paramIssues(first, undefined), []);
  // 另一个节点互不串味；未知节点得到空结构。
  assert.deepEqual(paramIssues(nodeIssues(byNode, 'task_2'), 'text').map((item) => item.message), ['另一个节点']);
  assert.deepEqual(nodeIssues(byNode, 'task_9'), { node: [], params: new Map() });
  assert.deepEqual(nodeIssues(byNode, undefined), { node: [], params: new Map() });
  // 容错：坏输入不抛。
  assert.equal(issuesByNode(null).size, 0);
  assert.equal(issuesByNode('nope').size, 0);
  assert.equal(issuesByNode([null, 3, {}]).size, 0);
});

test('issueTitle 把多条错误拼成悬停提示', () => {
  assert.equal(issueTitle([{ message: 'a' }, { message: 'b' }]), 'a\nb');
  assert.equal(issueTitle([{ message: '' }, { message: 'b' }]), 'b');
  assert.equal(issueTitle([]), '');
  assert.equal(issueTitle(null), '');
});

// —— 阶段 6：错误标到连线上、按严重度拆分、节点提醒 ——

const doc = () => ({
  root: 'root',
  nodes: [
    {id: 'root', type: 'root', children: ['seq']},
    {id: 'seq', type: 'sequence', children: ['a', 'missing', 'b']},
    {id: 'a', type: 'task', action: 'core.log', params: {}},
    {id: 'b', type: 'task', action: 'core.log', params: {}},
  ],
});

test('issuesByEdge：children 路径落到那条边上，结构问题标到相邻的每条边', () => {
  const byEdge = issuesByEdge([
    // 第 1 个子节点不存在：没有边可标（问题已经落到父卡上），不进映射。
    { path: ['nodes', 'seq', 'children', 1], message: '未知子节点：missing', severity: 'error', code: 'unknown-child' },
    // 第 2 个子节点 b 的边：这条边本身的问题直接标上去。
    { path: ['nodes', 'seq', 'children', 2], message: '子节点重复', severity: 'error', code: 'duplicate-child' },
    // 结构问题（成环）：牵涉到的节点相邻的每条边都要标出来（b 只有入边）。
    { path: ['nodes', 'b'], message: '检测到环：b', severity: 'error', code: 'cycle' },
    // 与连线无关的问题不进映射。
    { path: ['nodes', 'a', 'params', 'text'], message: '参数错误', severity: 'error', code: 'invalid-params' },
    { path: ['inputs', '阈值'], message: '工作流级', severity: 'error', code: 'invalid-inputs' },
  ], doc());
  assert.deepEqual([...byEdge.keys()], ['seq\u0000b'], '只有 b 那条边有问题');
  assert.deepEqual(byEdge.get('seq\u0000b').map((item) => item.code), ['duplicate-child', 'cycle']);
  // 容错。
  assert.equal(issuesByEdge(null, doc()).size, 0);
  assert.equal(issuesByEdge([{ path: ['nodes', 'seq', 'children', 0] }], null).size, 0);
});

test('issuesByEdge：父节点数量不对时，进出它的每条边都标红', () => {
  const byEdge = issuesByEdge([
    { path: ['nodes', 'seq'], message: '节点 seq 必须恰好有一个父节点', severity: 'error', code: 'parent-count' },
  ], doc());
  assert.deepEqual([...byEdge.keys()].sort(), ['root\u0000seq', 'seq\u0000a', 'seq\u0000b']);
  for (const list of byEdge.values()) assert.equal(list[0].code, 'parent-count');
});

test('splitBySeverity 分开错误与提醒：保存策略只拦错误', () => {
  const { errors, warnings } = splitBySeverity([
    { message: '硬错误', severity: 'error' },
    { message: '提醒', severity: 'warning' },
    { message: '提示', severity: 'info' },
    { message: '没写严重度' },
  ]);
  assert.deepEqual(errors.map((item) => item.message), ['硬错误', '没写严重度']);
  assert.deepEqual(warnings.map((item) => item.message), ['提醒', '提示']);
  assert.deepEqual(splitBySeverity(null), { errors: [], warnings: [] });
});

test('warningsByNode 只收提醒，供卡片画琥珀点', () => {
  const byNode = warningsByNode([
    { path: ['nodes', 'a', 'decorators'], message: '不可安全重试', severity: 'warning', code: 'unsafe-retry' },
    { path: ['nodes', 'a'], message: '硬错误', severity: 'error', code: 'invalid-task' },
    { path: ['nodes', 'b', 'params', 'x'], message: '参数提醒', severity: 'warning' },
    { path: ['inputs', '阈值'], message: '工作流级提醒', severity: 'warning' },
  ]);
  assert.deepEqual([...byNode.keys()], ['a', 'b']);
  assert.deepEqual(byNode.get('a').map((item) => item.code), ['unsafe-retry']);
  assert.deepEqual(byNode.get('b').map((item) => item.message), ['参数提醒']);
});

test('不可安全重试是提醒而不是错误：Python 不检查它，工作流照常能跑', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/shared/workflow/validate.ts'), 'utf8');
  assert.match(source, /'unsafe-retry', 'warning'/, 'unsafe-retry 归到 warning');
  const { validateWorkflow } = require('../dist-electron/shared/workflow/index.js');
  const raw = {
    schema_version: 4, id: 'demo', version: '4.0.0', resolution: [1920, 1080], root: 'root',
    inputs: {}, variables: {},
    nodes: [
      { id: 'root', type: 'root', children: ['task_1'] },
      { id: 'task_1', type: 'task', action: 'input.tap', params: {}, decorators: [{ type: 'retry', attempts: 3 }] },
    ],
  };
  const catalog = {
    byName: () => ({ inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, parameters: {}, retrySafe: false }),
    names: () => ['input.tap'],
  };
  const issues = validateWorkflow(raw, catalog);
  const retry = issues.find((item) => item.code === 'unsafe-retry');
  assert.ok(retry, '仍然会提示不可安全重试');
  assert.equal(retry.severity, 'warning');
  // 只有提醒时 splitBySeverity 认为是「可以保存」。
  const { errors } = splitBySeverity(issues);
  assert.equal(errors.length, 0, '没有会阻止保存的错误');
});
