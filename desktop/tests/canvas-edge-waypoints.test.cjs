// Run via npm test (builds the renderer test output first).
// 手工折线（UE Knot）：画布旁表的增删改，以及结构边几何按折点走线。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  structuralWaypoints, addStructuralWaypoint, removeStructuralWaypoint,
  moveStructuralWaypoint, clearStructuralWaypoints, structuralPinOf, EDGE_WAYPOINTS_KEY,
} = require('../dist-test-renderer/canvas/model/edge-waypoints.js');

function document(raw = {}) {
  return {
    root: 'root',
    nodes: [
      {id: 'root', type: 'root', children: ['seq']},
      {id: 'seq', type: 'sequence', children: ['a', 'b']},
      {id: 'cond', type: 'condition', children: ['a'], ports: ['false']},
      {id: 'a', type: 'task', action: 'core.capture', params: {}},
      {id: 'b', type: 'task', action: 'core.capture', params: {}},
    ],
    ...raw,
  };
}

test('折点旁表：新增 / 读取 / 移动 / 删除，坐标贴 8 像素网格', () => {
  const raw = document();
  assert.deepEqual(structuralWaypoints(raw, 'seq', 'a'), []);
  assert.equal(EDGE_WAYPOINTS_KEY in raw, false, '没有折点时不该建旁表');

  assert.equal(addStructuralWaypoint(raw, 'seq', 'a', {x: 103, y: 197}), true);
  assert.deepEqual(structuralWaypoints(raw, 'seq', 'a'), [{x: 104, y: 200}]);
  assert.deepEqual(raw[EDGE_WAYPOINTS_KEY], [{
    from: {node: 'seq', pin: 'then.0'},
    to: {node: 'a', pin: 'in'},
    waypoints: [{x: 104, y: 200}],
  }]);

  assert.equal(addStructuralWaypoint(raw, 'seq', 'a', {x: 300, y: 400}), true);
  assert.equal(structuralWaypoints(raw, 'seq', 'a').length, 2);
  assert.equal(moveStructuralWaypoint(raw, 'seq', 'a', 1, {x: 511, y: 513}), true);
  assert.deepEqual(structuralWaypoints(raw, 'seq', 'a')[1], {x: 512, y: 512});
  assert.equal(moveStructuralWaypoint(raw, 'seq', 'a', 5, {x: 0, y: 0}), false, '下标越界不写');

  assert.equal(removeStructuralWaypoint(raw, 'seq', 'a', 0), true);
  assert.deepEqual(structuralWaypoints(raw, 'seq', 'a'), [{x: 512, y: 512}]);
  assert.equal(clearStructuralWaypoints(raw, 'seq', 'a'), true);
  assert.equal(EDGE_WAYPOINTS_KEY in raw, false, '删空后整张表也收掉');
});

test('折点身份：执行边按父节点类型取引脚，数据边不串', () => {
  assert.equal(structuralPinOf(document().nodes[1], 'a'), 'then.0');
  assert.equal(structuralPinOf(document().nodes[1], 'b'), 'then.1');
  assert.equal(structuralPinOf(document().nodes[2], 'a'), 'false', '判断节点按 ports 取口位');
  assert.equal(structuralPinOf({id: 'r', type: 'root', children: ['x']}, 'x'), 'then.0');

  // 同一对节点上的数据边折点不会被当成执行边。
  const raw = document({
    [EDGE_WAYPOINTS_KEY]: [
      {from: {node: 'a', pin: 'out.value'}, to: {node: 'b', pin: 'times'}, waypoints: [{x: 8, y: 16}]},
    ],
  });
  assert.deepEqual(structuralWaypoints(raw, 'a', 'b'), [], '数据边的折点不算执行边走线');
});
