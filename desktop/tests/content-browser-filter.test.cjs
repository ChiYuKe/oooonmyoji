const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/renderer/content-browser.ts'), 'utf8');

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `未找到 ${name}`);
  const end = source.indexOf('\n}\n', start);
  assert(end > start, `未闭合 ${name}`);
  return source.slice(start, end + 3);
}

/** 复现内容浏览器的递归类型过滤：类型列在“最上层”也会收集深层资产。 */
function harness(folder) {
  const ctx = vm.createContext({
    contentBrowserFolder: folder,
    contentName: (value) => String(value).split('/').pop(),
    contentFolders: () => ['', 'assets', 'assets/templates', 'assets/templates/realm', 'workflows'],
    contentBrowserWorkflowItems: () => [{kind: 'workflow', path: 'workflows/a.json', name: 'a.json'}],
    contentBrowserAssetItems: () => [
      {kind: 'asset', path: 'assets/templates/x.png', name: 'x.png'},
      {kind: 'asset', path: 'assets/other.png', name: 'other.png'},
    ],
  });
  vm.runInContext(stripTypeScriptTypes([extract('isUnderContentFolder'), extract('contentBrowserRecursiveItems')].join('\n')), ctx);
  return ctx;
}

test('类型过滤按目录递归收集，根目录能覆盖深层资产', () => {
  const atRoot = harness('');
  assert.deepEqual(Array.from(atRoot.contentBrowserRecursiveItems('asset'), (item) => item.path), ['assets/templates/x.png', 'assets/other.png']);
  assert.deepEqual(Array.from(atRoot.contentBrowserRecursiveItems('folder'), (item) => item.path), ['assets', 'assets/templates', 'assets/templates/realm', 'workflows']);
  assert.deepEqual(Array.from(atRoot.contentBrowserRecursiveItems('workflow'), (item) => item.path), ['workflows/a.json']);

  const inTemplates = harness('assets/templates');
  assert.deepEqual(Array.from(inTemplates.contentBrowserRecursiveItems('asset'), (item) => item.path), ['assets/templates/x.png']);
  assert.deepEqual(Array.from(inTemplates.contentBrowserRecursiveItems('folder'), (item) => item.path), ['assets/templates/realm']);
});

test('目录归属按完整路径段判断，避免前缀误伤', () => {
  const ctx = harness('');
  assert.equal(ctx.isUnderContentFolder('assets/templates/x.png', 'assets'), true);
  assert.equal(ctx.isUnderContentFolder('assets', 'assets'), true);
  assert.equal(ctx.isUnderContentFolder('assetsX/x.png', 'assets'), false);
  assert.equal(ctx.isUnderContentFolder('anything/at/all', ''), true);
});
