// Run via npm test (builds dist-electron first).
// 重命名/移动内容时的引用重定向：这一层是「改了什么」的唯一事实来源，
// 之前没有任何用例，出现「重定向后磁盘上还是旧值」时无法判断是这里没改还是被别的路径覆盖。
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

function writeJson(root, relative, value) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), {recursive: true});
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return absolute;
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8'));
}

/** 最小项目：一个工作流 + 模板目录；引用方按需再补。 */
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-rename-'));
  fs.mkdirSync(path.join(root, 'workflows'), {recursive: true});
  fs.mkdirSync(path.join(root, 'assets', 'templates', 'rewards'), {recursive: true});
  writeJson(root, 'workflows/活动副本.json', {schema_version: 4, id: 'activity_loop', inputs: {}, nodes: []});
  fs.writeFileSync(path.join(root, 'assets', 'templates', 'x.png'), 'png');
  return root;
}

/** 用户遇到的那种引用形态：入口工作流用变量默认值 + 裸文件名指向子工作流。 */
function addBoundReference(root, relative = 'workflows/entrypoints/new_workflow.json') {
  writeJson(root, relative, {
    schema_version: 4, id: 'new_workflow',
    inputs: {子工作流: {type: 'string', default: '活动副本.json', display_name: '子工作流'}},
    nodes: [{
      id: 'capture', type: 'task', action: 'workflow.run',
      params: {inputs: {}, workflow: {ref: 'inputs.子工作流'}},
    }],
  });
}

test('重命名工作流：字面文件名、根前缀路径与变量默认值都会改写成新名字', async () => {
  const root = makeProject();
  addBoundReference(root);
  writeJson(root, 'workflows/literal.json', {
    schema_version: 4, id: 'literal',
    nodes: [{id: 'n', type: 'task', action: 'workflow.run', params: {workflow: '活动副本.json'}}],
  });
  writeJson(root, 'workflows/prefixed.json', {
    schema_version: 4, id: 'prefixed',
    nodes: [{id: 'n', type: 'task', action: 'workflow.run', params: {workflow: 'workflows/活动副本.json'}}],
  });

  const service = new ProjectService(root);
  const result = await service.renameContent({sourcePath: 'workflows/活动副本.json', newName: '周年庆活动副本.json'});

  assert.equal(fs.existsSync(path.join(root, 'workflows/周年庆活动副本.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'workflows/活动副本.json')), false);
  assert.equal(result.targetPath, 'workflows/周年庆活动副本.json');
  assert.equal(readJson(root, 'workflows/literal.json').nodes[0].params.workflow, '周年庆活动副本.json', '裸文件名引用要跟着改名');
  assert.equal(readJson(root, 'workflows/prefixed.json').nodes[0].params.workflow, 'workflows/周年庆活动副本.json', '带 workflows/ 前缀的引用要保留前缀');
  assert.equal(readJson(root, 'workflows/entrypoints/new_workflow.json').inputs.子工作流.default, '周年庆活动副本.json', '变量默认值同样是引用');

  // 明细要给出「哪个文件、改了几处」，界面层据此列出被重定向的文件。
  assert.equal(result.updatedFiles, 3);
  assert.equal(result.updatedReferences, 3);
  assert.deepEqual([...result.rewritten].sort((a, b) => a.path.localeCompare(b.path)).map((item) => item.path), [
    'workflows/entrypoints/new_workflow.json',
    'workflows/literal.json',
    'workflows/prefixed.json',
  ]);
  assert.deepEqual(result.rewritten.map((item) => item.references), [1, 1, 1]);
});

test('改写明细按引用处数降序，同一文件里的多处引用合并计数', async () => {
  const root = makeProject();
  writeJson(root, 'workflows/many.json', {
    schema_version: 4, id: 'many',
    nodes: [
      {id: 'a', type: 'task', action: 'workflow.run', params: {workflow: '活动副本.json'}},
      {id: 'b', type: 'task', action: 'workflow.run', params: {workflow: '活动副本.json'}},
      {id: 'c', type: 'task', action: 'workflow.run', params: {workflow: '别的.json'}},
    ],
  });
  writeJson(root, 'workflows/one.json', {
    schema_version: 4, id: 'one',
    nodes: [{id: 'a', type: 'task', action: 'workflow.run', params: {workflow: '活动副本.json'}}],
  });

  const service = new ProjectService(root);
  const result = await service.renameContent({sourcePath: 'workflows/活动副本.json', newName: '周年庆.json'});

  assert.deepEqual(result.rewritten, [
    {path: 'workflows/many.json', references: 2},
    {path: 'workflows/one.json', references: 1},
  ]);
  assert.equal(result.updatedReferences, 3);
  assert.equal(readJson(root, 'workflows/many.json').nodes[2].params.workflow, '别的.json', '不相干的引用不能被动到');
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
  writeJson(root, 'workflows/vision.json', {
    schema_version: 4, id: 'vision',
    nodes: [{
      id: 'n', type: 'task', action: 'vision.match_template',
      params: {template: 'assets/templates/rewards/r1.png'},
    }],
  });

  const service = new ProjectService(root);
  const result = await service.renameContent({sourcePath: 'assets/templates/rewards/r1.png', newName: 'r1b.png'});

  assert.equal(readJson(root, 'workflows/vision.json').nodes[0].params.template, 'assets/templates/rewards/r1b.png');
  const catalog = readJson(root, 'assets/templates/rewards/catalog.json');
  assert.equal(catalog.templates[0].template, 'r1b.png', 'catalog 里的相对路径要改成新文件名');
  assert.equal(catalog.templates[1].template, 'r2.png', '没被改名的条目不碰');
  assert.deepEqual(result.rewritten.map((item) => item.path).sort(), [
    'assets/templates/rewards/catalog.json',
    'workflows/vision.json',
  ]);
  assert.deepEqual(result.rewritten.map((item) => item.references), [1, 1]);
});

test('没有被引用的文件改名不产生明细，也没有多余的写盘', async () => {
  const root = makeProject();
  writeJson(root, 'workflows/围观者.json', {
    schema_version: 4, id: 'bystander',
    nodes: [{id: 'n', type: 'task', action: 'vision.match_template', params: {template: 'assets/templates/x.png'}}],
  });

  const service = new ProjectService(root);
  const result = await service.renameContent({sourcePath: 'workflows/活动副本.json', newName: '新名字.json'});

  assert.deepEqual(result.rewritten, []);
  assert.equal(result.updatedFiles, 0);
  assert.equal(result.updatedReferences, 0);
});
