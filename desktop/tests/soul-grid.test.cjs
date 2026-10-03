const test = require('node:test');
const assert = require('node:assert/strict');
const { soulGridRange } = require('../dist-test-renderer/renderer/soul-grid.js');

test('window covers the viewport and keeps row-aligned buffering without a total limit', () => {
  for (const total of [6180, 12000]) {
    for (const columns of [3, 5, 11]) {
      for (const top of [0, 1800, 36000]) {
        const range = soulGridRange(total, columns, 158, top, 720);
        assert.equal(range.start % columns, 0);
        assert.ok(range.start <= Math.floor(top / 158) * columns);
        assert.ok(range.end >= Math.min(total, Math.ceil((top + 720) / 158) * columns));
        assert.ok(range.end - range.start <= columns * 12);
        assert.equal(range.rows, Math.ceil(total / columns));
      }
    }
  }
});

test('last partial row and empty inventory are reachable', () => {
  const end = soulGridRange(6180, 11, 158, 558 * 158, 720);
  assert.equal(end.end, 6180); assert.equal(end.rows, 562);
  assert.deepEqual(soulGridRange(0, 3, 158, 0, 720), { start: 0, end: 0, rows: 0 });
  const shrinking = soulGridRange(2, 3, 158, 30000, 720);
  assert.equal(shrinking.start, 0); assert.equal(shrinking.end, 2);
});
