/**
 * 卡片错误标记：校验问题按节点/参数落到卡片行上（纯映射）与节点卡片渲染契约。
 *
 * 路径约定与 `shared/workflow/validate.ts` 一致：`['nodes', <节点 id>, 'params', <参数名>, ...]`。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { issuesByNode, issueTitle, nodeIssues, paramIssues } = require('../dist-test-renderer/canvas/model/card-issues.js');

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
