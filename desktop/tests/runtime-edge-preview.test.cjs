const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  RUNTIME_EDGE_PREVIEW_STORAGE_KEY,
  readRuntimeEdgePreview,
  writeRuntimeEdgePreview,
} = require('../dist-test-renderer/shared/runtime-edge-preview.js');

test('运行连线预览默认开启，并能记住关闭状态', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readRuntimeEdgePreview(storage), true);
  writeRuntimeEdgePreview(storage, false);
  assert.equal(values.get(RUNTIME_EDGE_PREVIEW_STORAGE_KEY), 'false');
  assert.equal(readRuntimeEdgePreview(storage), false);
});

test('存储不可用时保持默认开启且不阻断编辑器', () => {
  const storage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  assert.equal(readRuntimeEdgePreview(storage), true);
  assert.doesNotThrow(() => writeRuntimeEdgePreview(storage, false));
});
