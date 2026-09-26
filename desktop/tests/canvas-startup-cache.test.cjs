const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('画布问题缓存先于编辑器句柄初始化，并同时按版本与文档对象失效', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/canvas/editor.ts'), 'utf8');
  const declaration = source.indexOf('let issuesCache:');
  const returned = source.indexOf('return handle;');
  assert.ok(declaration >= 0 && declaration < returned, '首次渲染前缓存必须已经初始化');
  assert.match(source, /issuesCache\.version === version && issuesCache\.raw === state\.raw/);
  assert.match(source, /issuesListCache\.version === version && issuesListCache\.raw === state\.raw/);
});
