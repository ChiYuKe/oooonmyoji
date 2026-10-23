const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fileURLToPath} = require('node:url');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return {BrowserWindow: class {}, dialog: {
    showSaveDialog: () => { throw new Error('新建工作流不应打开保存窗口'); },
  }, shell: {}};
  return originalLoad.call(this, request, ...rest);
};
const {ProjectService} = require('../dist-electron/main/projectService.js');
const {parseDocument} = require('../dist-electron/shared/workflow/graph-dsl.js');
Module._load = originalLoad;

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-create-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return new ProjectService(root);
}

test('新建工作流默认保存在 entrypoints，并写入可打开的模板', async (t) => {
  const service = project(t);
  const uri = await service.createWorkflow();
  assert.equal(fileURLToPath(uri), path.join(service.workflowRoot, 'entrypoints', 'new_workflow.owf'));
  const workflow = parseDocument(fs.readFileSync(fileURLToPath(uri), 'utf8'));
  assert.equal(workflow.id, 'new_workflow');
  assert.equal(workflow.schema_version, 6);
  assert.equal(workflow.nodes.length, 2);
});

test('在右键目录中直接创建文件并返回 URI', async (t) => {
  const service = project(t);
  const directory = path.join(service.workflowRoot, 'generated', '活动');
  const file = path.join(directory, 'new_workflow.owf');
  assert.equal(fileURLToPath(await service.createWorkflow('workflows\\generated\\活动')), file);
  assert.equal(parseDocument(fs.readFileSync(file, 'utf8')).schema_version, 6);
});

test('同名工作流自动递增编号，保留已有文件', async (t) => {
  const service = project(t);
  const directory = path.join(service.workflowRoot, 'generated');
  fs.mkdirSync(directory, {recursive: true});
  const file = path.join(directory, 'new_workflow.owf');
  fs.writeFileSync(file, 'existing workflow');
  for (const index of [2, 3]) {
    const created = fileURLToPath(await service.createWorkflow('workflows/generated'));
    assert.equal(created, path.join(directory, `new_workflow_${index}.owf`));
    assert.equal(parseDocument(fs.readFileSync(created, 'utf8')).id, `new_workflow_${index}`);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), 'existing workflow');
});

test('并发创建工作流各自分配文件，且同名目录也会被跳过', async (t) => {
  const service = project(t);
  const directory = path.join(service.workflowRoot, 'entrypoints');
  fs.mkdirSync(path.join(directory, 'new_workflow.owf'), {recursive: true});
  const uris = await Promise.all(Array.from({length: 4}, () => service.createWorkflow()));
  assert.equal(new Set(uris).size, 4);
  assert.deepEqual(uris.map(uri => path.basename(fileURLToPath(uri))).sort(),
    [2, 3, 4, 5].map(index => `new_workflow_${index}.owf`));
  for (const uri of uris) {
    const file = fileURLToPath(uri);
    assert.equal(parseDocument(fs.readFileSync(file, 'utf8')).id, path.basename(file, '.owf'));
  }
});

test('创建位置必须位于 workflows 内', async (t) => {
  const service = project(t);
  for (const folder of ['assets', '../outside', 'workflows/../../outside', null, {}]) {
    await assert.rejects(service.createWorkflow(folder));
  }
  assert.equal(fs.existsSync(path.join(service.projectRoot, 'assets')), false);
  assert.equal(fs.existsSync(service.workflowRoot), false);
});
