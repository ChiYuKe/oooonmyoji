const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchNodes } = require('../dist-test-renderer/canvas/interactions/node-search.js');
const nodes = [
  { id: 'a', name: '等待按钮', action: 'vision.wait_template', params: { threshold: .88, timeout: 30, template: 'assets/挑战.png', roi: [1,2,3,4] } },
  { id: 'b', name: '点击', action: 'input.tap_match', params: { match: { ref: 'nodes.a.output.matches.3' }, timeout: { ref: 'variables.等待时间' } } },
];
test('搜索覆盖名称、动作中文名、数值、素材路径和嵌套引用，支持范围筛选', () => {
  assert.equal(searchNodes(nodes, '等待按钮', 'name')[0].nodeId, 'a');
  assert.equal(searchNodes(nodes, '等待模板', 'action', { action: () => '等待模板' })[0].scope, 'action');
  assert.deepEqual(searchNodes(nodes, 'timeout 30', 'params').map((row) => row.nodeId), ['a']);
  assert.equal(searchNodes(nodes, '挑战.png', 'params')[0].param, 'template');
  assert.equal(searchNodes(nodes, 'matches.3', 'refs')[0].param, 'match');
  assert.equal(searchNodes(nodes, '等待时间', 'refs')[0].nodeId, 'b');
  assert.equal(searchNodes(nodes, '等待时间', 'params').length, 0);
  assert.equal(searchNodes([...nodes,nodes[0]], '挑战').length, 1);
  assert.equal(searchNodes(nodes, '   ').length, 0);
});
test('纯数据卡片与实例输入同样可搜索', () => {
  assert.equal(searchNodes([{ id: 'judge', expression: { eq: [{ ref: 'variables.x' }, 10] } }], 'variables.x', 'refs')[0].field, 'expression.eq.0');
  assert.equal(searchNodes([{ id: 'parallel', runs: [{ inputs: { count: 30 } }] }], 'count 30', 'params')[0].field, 'runs.0.inputs.count');
});
