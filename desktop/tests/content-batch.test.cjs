const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { runContentBatch } = require('../dist-test-renderer/renderer/features/content-browser/batch.js');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { BrowserWindow: class {}, dialog: {}, shell: {} };
  return originalLoad.call(this, request, ...rest);
};
const { ProjectService } = require('../dist-electron/main/projectService.js');
Module._load = originalLoad;

test('batch runs sequentially, continues after failure and preserves per-file results', async () => {
  let running = false;
  const visited = [];
  const result = await runContentBatch(['a', 'b', 'c'], async (item) => {
    assert.equal(running, false);
    running = true;
    await Promise.resolve();
    visited.push(item);
    running = false;
    if (item === 'b') throw new Error('referenced');
    return `${item}-done`;
  });
  assert.deepEqual(visited, ['a', 'b', 'c']);
  assert.deepEqual(result.completed, [{ item: 'a', result: 'a-done' }, { item: 'c', result: 'c-done' }]);
  assert.equal(result.failed[0].item, 'b');
  assert.equal(result.failed[0].error.message, 'referenced');
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-batch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets', 'target'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'a.png'), 'image-data');
  return { root, service: new ProjectService(root) };
}

test('copy creates unique duplicates without changing original or overwriting existing files', async (t) => {
  const { root, service } = fixture(t);
  const paths = await Promise.all([1, 2, 3].map(() => service.copyContent({ sourcePath: 'assets/a.png', targetFolder: 'assets' })));
  assert.equal(new Set(paths).size, 3);
  assert.ok(paths.every((value) => value !== 'assets/a.png'));
  for (const relative of [...paths, 'assets/a.png']) assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), 'image-data');
  assert.equal(await service.copyContent({ sourcePath: 'assets/a.png', targetFolder: 'assets/target' }), 'assets/target/a.png');
});

test('copy rejects invalid roots, traversal, folders and missing source without writing files', async (t) => {
  const { root, service } = fixture(t);
  for (const request of [
    { sourcePath: 'assets/a.png', targetFolder: 'workflows' },
    { sourcePath: 'assets/a.png', targetFolder: '../escape' },
    { sourcePath: 'assets/target', targetFolder: 'assets' },
    { sourcePath: 'assets/missing.png', targetFolder: 'assets/target' },
  ]) await assert.rejects(service.copyContent(request));
  assert.deepEqual(fs.readdirSync(path.join(root, 'assets', 'target')), []);
});
