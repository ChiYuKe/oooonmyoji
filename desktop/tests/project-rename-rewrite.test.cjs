// Run via npm test (builds dist-electron first).
// 重命名/移动内容时的引用重定向：这一层是「改了什么」的唯一事实来源，
// 之前没有任何用例，出现「重定向后磁盘上还是旧值」时无法判断是这里没改还是被别的路径覆盖。
//
// 工作流落盘已是 `.owf` 文本（docs/workflow-dsl-v6.md）：造文档用 `emitRuntimeDocument`
// （内存 v4 运行时文档 → 文本），断言改写结果必须「读回文本 → parseDocument」——
// 写盘走的是「解析 → 改对象 → 整体重新序列化」，逐字符比对旧 JSON 文本没有意义。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// projectService 在模块顶层 require('electron')；这里只需要它的类型/工具函数，桩掉即可。
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return {BrowserWindow: class {}, dialog: {}, shell: {}};
  return originalLoad.call(this, request, ...rest);
};
const {ProjectService} = require('../dist-electron/main/projectService.js');
Module._load = originalLoad;
const { emitDocument, emitRuntimeDocument, parseDocument } = require('../dist-electron/shared/workflow/index.js');

/** `rewards/catalog.json` 这类旁表仍然是 JSON；`.owf` 只替换工作流文档。 */
function writeJson(root, relative, value) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), {recursive: true});
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return absolute;
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8'));
}

/** 内存工作流文档 → `.owf` 文本落盘。 */
function writeWorkflow(root, relative, document) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), {recursive: true});
  fs.writeFileSync(absolute, emitRuntimeDocument(document), 'utf8');
  return absolute;
}

/** 读回 `.owf` 文本并解析：引用有没有被改写只能看解析后的文档。 */
function readWorkflow(root, relative) {
  return parseDocument(fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8'), relative);
}

/** 最小可解析文档：`.owf` 要求 version / resolution / root，缺一个就整份读不出来。 */
function workflowDocument(id, overrides = {}) {
  return {
    schema_version: 4,
    version: '4.4.0',
    id,
    resolution: [1920, 1080],
    inputs: {},
    root: 'root',
    nodes: [{id: 'root', type: 'root', name: '入口'}],
    ...overrides,
  };
}

/** 最小项目：一个工作流 + 模板目录；引用方按需再补。 */
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-rename-'));
  fs.mkdirSync(path.join(root, 'workflows'), {recursive: true});
  fs.mkdirSync(path.join(root, 'assets', 'templates', 'rewards'), {recursive: true});
  writeWorkflow(root, 'workflows/活动副本.owf', workflowDocument('activity_loop'));
  fs.writeFileSync(path.join(root, 'assets', 'templates', 'x.png'), 'png');
  return root;
}

/** 用户遇到的那种引用形态：入口工作流用变量默认值 + 裸文件名指向子工作流。 */
function addBoundReference(root, relative = 'workflows/entrypoints/new_workflow.owf') {
  writeWorkflow(root, relative, workflowDocument('new_workflow', {
    root: 'capture',
    inputs: {子工作流: {type: 'string', default: '活动副本.owf', display_name: '子工作流'}},
    nodes: [{
      id: 'capture', type: 'task', action: 'workflow.run',
      params: {inputs: {}, workflow: {ref: 'inputs.子工作流'}},
    }],
  }));
}

test('重命名工作流：字面文件名、根前缀路径与变量默认值都会改写成新名字', async () => {
  const root = makeProject();
  addBoundReference(root);
  writeWorkflow(root, 'workflows/literal.owf', workflowDocument('literal', {
    root: 'n',
    nodes: [{id: 'n', type: 'task', action: 'workflow.run', params: {workflow: '活动副本.owf'}}],
  }));
  writeWorkflow(root, 'workflows/prefixed.owf', workflowDocument('prefixed', {
    root: 'n',
    nodes: [{id: 'n', type: 'task', action: 'workflow.run', params: {workflow: 'workflows/活动副本.owf'}}],
  }));

  const service = new ProjectService(root);
  const result = await service.renameContent({sourcePath: 'workflows/活动副本.owf', newName: '周年庆活动副本.owf'});

  assert.equal(fs.existsSync(path.join(root, 'workflows/周年庆活动副本.owf')), true);
  assert.equal(fs.existsSync(path.join(root, 'workflows/活动副本.owf')), false);
  assert.equal(result.targetPath, 'workflows/周年庆活动副本.owf');
  const literal = readWorkflow(root, 'workflows/literal.owf');
  assert.equal(literal.nodes[0].params.workflow, '周年庆活动副本.owf', '裸文件名引用要跟着改名');
  const prefixed = readWorkflow(root, 'workflows/prefixed.owf');
  assert.equal(prefixed.nodes[0].params.workflow, 'workflows/周年庆活动副本.owf', '带 workflows/ 前缀的引用要保留前缀');
  const bound = readWorkflow(root, 'workflows/entrypoints/new_workflow.owf');
  assert.equal(bound.inputs.子工作流.default, '周年庆活动副本.owf', '变量默认值同样是引用');

  // 结构级改写后整体重新序列化：落盘文本必须正好是规范形式（再序列化不再变化）。
  assert.equal(
    fs.readFileSync(path.join(root, 'workflows/literal.owf'), 'utf8'),
    emitDocument(literal),
    '改写后的 .owf 要是规范文本',
  );

  // 明细要给出「哪个文件、改了几处」，界面层据此列出被重定向的文件。
  assert.equal(result.updatedFiles, 3);
  assert.equal(result.updatedReferences, 3);
  assert.deepEqual([...result.rewritten].sort((a, b) => a.path.localeCompare(b.path)).map((item) => item.path), [
    'workflows/entrypoints/new_workflow.owf',
    'workflows/literal.owf',
    'workflows/prefixed.owf',
  ]);
  assert.deepEqual(result.rewritten.map((item) => item.references), [1, 1, 1]);
});

test('改写明细按引用处数降序，同一文件里的多处引用合并计数', async () => {
  const root = makeProject();
  writeWorkflow(root, 'workflows/many.owf', workflowDocument('many', {
    root: 'a',
    nodes: [
      {id: 'a', type: 'task', action: 'workflow.run', params: {workflow: '活动副本.owf'}},
      {id: 'b', type: 'task', action: 'workflow.run', params: {workflow: '活动副本.owf'}},
      {id: 'c', type: 'task', action: 'workflow.run', params: {workflow: '别的.owf'}},
    ],
  }));
  writeWorkflow(root, 'workflows/one.owf', workflowDocument('one', {
    root: 'a',
    nodes: [{id: 'a', type: 'task', action: 'workflow.run', params: {workflow: '活动副本.owf'}}],
  }));

  const service = new ProjectService(root);
  const result = await service.renameContent({sourcePath: 'workflows/活动副本.owf', newName: '周年庆.owf'});

  assert.deepEqual(result.rewritten, [
    {path: 'workflows/many.owf', references: 2},
    {path: 'workflows/one.owf', references: 1},
  ]);
  assert.equal(result.updatedReferences, 3);
  assert.equal(readWorkflow(root, 'workflows/many.owf').nodes[2].params.workflow, '别的.owf', '不相干的引用不能被动到');
});

test('重命名模板图片：工作流里的模板路径与 rewards/catalog.json 的相对 template 一起改写', async () => {
  const root = makeProject();
  writeJson(root, 'assets/templates/rewards/catalog.json', {
    templates: [
      {id: 'r1', name: '奖励一', template: 'r1.png'},
      {id: 'r2', name: '奖励二', template: 'r2.png'},
    ],
  });
  fs.writeFileSync(path.join(root, 'assets', 'templates', 'rewards', 'r1.png'), 'png');
  fs.writeFileSync(path.join(root, 'assets', 'templates', 'rewards', 'r2.png'), 'png');
  writeWorkflow(root, 'workflows/vision.owf', workflowDocument('vision', {
    root: 'n',
    nodes: [{
      id: 'n', type: 'task', action: 'vision.match_template',
      params: {template: 'assets/templates/rewards/r1.png'},
    }],
  }));

  const service = new ProjectService(root);
  const result = await service.renameContent({sourcePath: 'assets/templates/rewards/r1.png', newName: 'r1b.png'});

  const vision = readWorkflow(root, 'workflows/vision.owf');
  assert.equal(vision.nodes[0].params.template, 'assets/templates/rewards/r1b.png');
  const catalog = readJson(root, 'assets/templates/rewards/catalog.json');
  assert.equal(catalog.templates[0].template, 'r1b.png', 'catalog 里的相对路径要改成新文件名');
  assert.equal(catalog.templates[1].template, 'r2.png', '没被改名的条目不碰');
  assert.deepEqual(result.rewritten.map((item) => item.path).sort(), [
    'assets/templates/rewards/catalog.json',
    'workflows/vision.owf',
  ]);
  assert.deepEqual(result.rewritten.map((item) => item.references), [1, 1]);
});

test('没有被引用的文件改名不产生明细，也没有多余的写盘', async () => {
  const root = makeProject();
  writeWorkflow(root, 'workflows/围观者.owf', workflowDocument('bystander', {
    root: 'n',
    nodes: [{id: 'n', type: 'task', action: 'vision.match_template', params: {template: 'assets/templates/x.png'}}],
  }));

  const service = new ProjectService(root);
  const result = await service.renameContent({sourcePath: 'workflows/活动副本.owf', newName: '新名字.owf'});

  assert.deepEqual(result.rewritten, []);
  assert.equal(result.updatedFiles, 0);
  assert.equal(result.updatedReferences, 0);
});
