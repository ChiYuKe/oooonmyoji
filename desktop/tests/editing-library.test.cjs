const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ProjectEditingLibrary } = require('../dist-electron/main/core/editingLibrary.js');
const { literalPresetParams, changeEditingLibrary, emptyEditingLibrary } = require('../dist-electron/shared/editing-library.js');

test('项目预设在重启后保留，连续写入不会丢失收藏、最近使用或改名', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onmyoji-editing-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = new ProjectEditingLibrary(root);
  const preset = { id: 'wait-image', name: '常用识别', action: 'vision.wait_template', params: { threshold: .85 }, favorite: false };
  assert.deepEqual(await library.list(), emptyEditingLibrary());
  await Promise.all([
    library.update({ op: 'save', preset }),
    library.update({ op: 'favorite', id: 'action:vision.wait_template' }),
    library.update({ op: 'use', id: 'preset:wait-image' }),
    library.update({ op: 'favorite', id: 'preset:wait-image' }),
  ]);
  let state = await new ProjectEditingLibrary(root).list();
  assert.equal(state.presets[0].favorite, true);
  assert.deepEqual(state.favoriteActions, ['vision.wait_template']);
  assert.deepEqual(state.recent, ['preset:wait-image']);
  await library.update({ op: 'save', preset: { ...state.presets[0], name: '快速识别' } });
  state = await library.list(); assert.equal(state.presets[0].name, '快速识别');
  await assert.rejects(library.update({ op: 'save', preset: { ...preset, params: { match: { ref: 'nodes.old.output' } } } }), /引用/);
  assert.equal((await library.list()).presets[0].name, '快速识别');
  await library.update({ op: 'remove', id: preset.id });
  state = await library.list(); assert.deepEqual(state.presets, []); assert.deepEqual(state.recent, []);
});

test('共享预设排除嵌套引用，最近使用去重且最多保留 20 项', () => {
  const params = { threshold: .8, list: [{ ref: 'variables.name' }], settings: { ref: 'nodes.old.output' }, roi: [0, 0, 100, 100] };
  assert.deepEqual(literalPresetParams(params), { threshold: .8, roi: [0, 0, 100, 100] });
  let library = emptyEditingLibrary();
  for (let index = 0; index < 25; index++) library = changeEditingLibrary(library, { op: 'use', id: `action:action${index}` });
  library = changeEditingLibrary(library, { op: 'use', id: 'action:action10' });
  assert.equal(library.recent.length, 20); assert.equal(library.recent[0], 'action:action10'); assert.equal(new Set(library.recent).size, 20);
  assert.throws(() => changeEditingLibrary(library, { op: 'save', preset: { id: '../outside', name: 'x', action: 'a', params: {} } }), /无效/);
});
