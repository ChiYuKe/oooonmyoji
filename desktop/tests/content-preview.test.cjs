// Run via npm test (builds dist-electron first).
// 引用查看器悬停浮窗的内容来源：这一层决定「什么能预览、预览成什么」，
// 之前没有用例，出现「图片不显示 / 浮窗能读项目外的文件」时无法判断是渲染层还是这里。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// projectService 在模块顶层 require('electron')；这里只需要它的方法，桩掉即可。
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return {BrowserWindow: class {}, dialog: {}, shell: {}};
  return originalLoad.call(this, request, ...rest);
};
const {ProjectService} = require('../dist-electron/main/projectService.js');
Module._load = originalLoad;

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-preview-'));
  fs.mkdirSync(path.join(root, 'workflows'), {recursive: true});
  fs.mkdirSync(path.join(root, 'assets', 'templates', 'rewards'), {recursive: true});
  fs.writeFileSync(path.join(root, 'workflows', '活动副本.owf'), 'workflow activity_loop\n  version: 4.4.0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'assets', 'templates', 'jg-template.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(root, 'assets', 'templates', 'rewards', 'catalog.json'), '{"templates":[]}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'README.md'), '# 项目根目录\n', 'utf8');
  fs.writeFileSync(path.join(root, 'assets', 'templates', 'raw.bin'), 'binary', 'utf8');
  return root;
}

test('模板图片回可直接加载的资源 URL', async () => {
  const root = makeProject();
  const preview = await new ProjectService(root).readContentPreview('assets/templates/jg-template.png');
  assert.equal(preview.kind, 'image');
  assert.equal(preview.path, 'assets/templates/jg-template.png');
  assert.equal(preview.uri, 'onmyoji-resource://project/assets/templates/jg-template.png');
});

test('工作流与 rewards 目录回文本，反斜杠路径同样认得', async () => {
  const root = makeProject();
  const service = new ProjectService(root);
  const workflow = await service.readContentPreview('workflows/活动副本.owf');
  assert.equal(workflow.kind, 'text');
  assert.match(workflow.text, /^workflow activity_loop/);
  assert.equal(workflow.truncated, false);
  const catalog = await service.readContentPreview('assets\\templates\\rewards\\catalog.json');
  assert.equal(catalog.kind, 'text');
  assert.equal(catalog.path, 'assets/templates/rewards/catalog.json');
  assert.equal(catalog.text, '{"templates":[]}\n');
});

test('项目外的路径与不支持的类型一律拒绝，不给浮窗留任意文件读取的口子', async () => {
  const root = makeProject();
  const service = new ProjectService(root);
  assert.deepEqual(await service.readContentPreview('../secret.owf'), {kind: 'missing', path: '../secret.owf', message: '内容不在项目内'});
  assert.equal((await service.readContentPreview('README.md')).message, '暂不支持预览此文件');
  assert.equal((await service.readContentPreview('assets/templates/raw.bin')).message, '暂不支持预览此类型');
  assert.equal((await service.readContentPreview('workflows/不存在.owf')).message, '文件不存在');
  assert.equal((await service.readContentPreview('workflows')).message, '不是可预览的文件');
});

test('超长文本只回前 256 KB 并标记截断，且不切断多字节字符', async () => {
  const root = makeProject();
  const service = new ProjectService(root);
  // UTF-8 下每个汉字 3 字节：262144 字节的边界落在字符中间，读回必须是完整字符。
  fs.writeFileSync(path.join(root, 'assets', 'templates', 'big.json'), '中'.repeat(120000), 'utf8');
  const preview = await service.readContentPreview('assets/templates/big.json');
  assert.equal(preview.kind, 'text');
  assert.equal(preview.truncated, true);
  assert.equal(preview.text.length, 87381);
  assert.equal(preview.text.includes('\uFFFD'), false, '截断不能留下半个字符');
  assert.match(preview.text, /^中+$/);
});
