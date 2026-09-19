/**
 * 变量连线对账：参数里连着的变量必须有对应的 `_variableLinks` 连线项。
 * 缺项会让「谁连着谁」的说明、断开与清理各说各话（同一个绑定两种描述）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { reconcileVariableLinks, variableCardIdForLink } = require('../dist-test-renderer/canvas/model/variable-links.js');

function doc(links, extraNodes = []) {
  return {
    schema_version: 4, id: 'w', root: 'r', inputs: {}, variables: { 时长: { type: 'number', default: 1 } },
    _variableCards: { card_1: { name: '时长', scope: 'variables', x: 0, y: 0 }, card_9: { name: '时长', scope: 'variables', x: 0, y: 0 } },
    _variableLinks: links,
    nodes: [
      { id: 'r', type: 'root', children: ['tap'] },
      { id: 'tap', type: 'task', action: 'core.sleep', params: { seconds: { ref: 'variables.时长' } } },
      ...extraNodes,
    ],
  };
}

test('reconcileVariableLinks 补上缺失的连线项', () => {
  const raw = doc({});
  assert.equal(reconcileVariableLinks(raw), 1);
  // 同名多卡时取第一个，和渲染时画的线一致。
  assert.equal(raw._variableLinks['tap:seconds'], 'card_1');
  assert.equal(variableCardIdForLink(raw, 'tap', 'seconds'), 'card_1');
  // 幂等：再跑一次没有改动。
  assert.equal(reconcileVariableLinks(raw), 0);
});

test('reconcileVariableLinks 修掉指向已删卡片的连线项', () => {
  const raw = doc({ 'tap:seconds': 'card_404' });
  assert.equal(reconcileVariableLinks(raw), 1);
  assert.equal(raw._variableLinks['tap:seconds'], 'card_1');
});

test('reconcileVariableLinks 不动已经正确的连线项', () => {
  const raw = doc({ 'tap:seconds': 'card_1' });
  assert.equal(reconcileVariableLinks(raw), 0);
  assert.equal(raw._variableLinks['tap:seconds'], 'card_1');
  // 指向另一张**还活着**的同名卡片：可能是刻意选的重复卡片，保持不动。
  const picked = doc({ 'tap:seconds': 'card_9' });
  assert.equal(reconcileVariableLinks(picked), 0);
  assert.equal(picked._variableLinks['tap:seconds'], 'card_9');
});

test('reconcileVariableLinks 管实例运行的输入，且不碰非变量引用', () => {
  const raw = doc({}, [
    { id: 'run', type: 'instance_parallel', runs: [{ instance: 'i', workflow: 'w.json', inputs: { 等待: { ref: 'variables.时长' } } }] },
    { id: 'ref', type: 'task', action: 'core.log', params: { message: { ref: 'nodes.tap.output.state' } } },
    { id: 'mixed', type: 'task', action: 'core.log', params: { message: { ref: 'variables.时长', note: 'x' } } },
  ]);
  assert.equal(reconcileVariableLinks(raw), 2);
  assert.equal(raw._variableLinks['run:runs.0.inputs.等待'], 'card_1');
  assert.equal(raw._variableLinks['tap:seconds'], 'card_1');
  // 节点输出引用与「引用 + 别的字段」的对象都不是变量连线，不该写连线项。
  assert.equal('ref:message' in raw._variableLinks, false);
  assert.equal('mixed:message' in raw._variableLinks, false);
});

test('reconcileVariableLinks 没有卡片/变量时什么都不写，也不抛', () => {
  const noCards = doc({});
  delete noCards._variableCards;
  assert.equal(reconcileVariableLinks(noCards), 0);
  assert.deepEqual(noCards._variableLinks, {});
  const gone = doc({});
  gone.variables = {};
  assert.equal(reconcileVariableLinks(gone), 0);
  assert.deepEqual(gone._variableLinks, {});
  // 坏输入容错。
  assert.equal(reconcileVariableLinks(null), 0);
  assert.equal(reconcileVariableLinks('nope'), 0);
  assert.equal(reconcileVariableLinks({ nodes: 'nope' }), 0);
  assert.equal(variableCardIdForLink(null, 'tap', 'seconds'), '');
  assert.equal(variableCardIdForLink({ _variableLinks: { 'tap:seconds': 3 } }, 'tap', 'seconds'), '');
});
