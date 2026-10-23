const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {contentDeleteConfirmRequest} = require('../dist-test-renderer/renderer/features/content-browser/delete-confirm.js');
const {buildReferenceGraph} = require('../dist-electron/main/core/references.js');
const {emitDocument} = require('../dist-electron/shared/workflow/graph-dsl.js');
const {workflowTemplate} = require('../dist-electron/main/core/workflowTemplate.js');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return {BrowserWindow: class {}, dialog: {}, shell: {}};
  return originalLoad.call(this, request, ...rest);
};
const {ProjectService} = require('../dist-electron/main/projectService.js');
Module._load = originalLoad;

const node = (name, kind = 'workflow', exists = true) => ({name, path: `${kind === 'workflow' ? 'workflows' : 'assets'}/${name}`, kind, exists});
const reference = (target, label = '调用子流程') => ({target, contexts: [{kind: 'workflow.run', label, reference: target.path}]});

test('删除确认分别列出双向引用、路径、引用位置和缺失依赖', () => {
  const target = node('main.owf');
  const request = contentDeleteConfirmRequest([target], [{target,
    references: [reference(node('button.png', 'asset')), reference(node('missing.owf', 'workflow', false))],
    referencedBy: [reference(node('parent.owf'), '进入活动')],
  }]);
  assert.equal(request.sections.length, 2);
  assert.match(request.sections[0].title, /引用的内容（2）/);
  assert.equal(request.sections[0].items[1].label, 'missing.owf（文件不存在）');
  assert.match(request.sections[0].items[0].detail, /assets\/button.png/);
  assert.match(request.sections[1].title, /被以下内容引用（1）/);
  assert.match(request.sections[1].items[0].detail, /进入活动/);
  assert.match(request.summary, /暂不能删除/);
});

test('无引用时明确显示空状态，批量删除按各文件分组', () => {
  const targets = [node('a.owf'), node('b.owf')];
  const request = contentDeleteConfirmRequest(targets, targets.map(target => ({target, references: [], referencedBy: []})));
  assert.equal(request.sections.length, 4);
  assert.match(request.sections[0].title, /a.owf/);
  assert.match(request.sections[2].title, /b.owf/);
  assert.equal(request.sections[0].emptyText, '未引用其他内容');
  assert.equal(request.sections[1].emptyText, '未被其他内容引用');
  assert.match(request.summary, /所引用的文件会保留/);
});

test('引用分析覆盖运行、顺序、选择、多实例和模板，并在两个方向一致', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-delete-refs-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'workflows'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'button.png'), 'fixture');
  const write = (id, extra = {}) => fs.writeFileSync(path.join(root, 'workflows', `${id}.owf`), emitDocument({...workflowTemplate(id), ...(extra.nodes ? {edges: []} : {}), ...extra}));
  write('child');
  write('target', {nodes: [
    {id: 'root_1', type: 'root'},
    {id: 'task_1', type: 'task', name: '调用子流程', action: 'workflow.run', params: {workflow: 'child.owf'}},
    {id: 'task_2', type: 'task', name: '识别按钮', action: 'vision.wait_template', params: {template: 'assets/button.png'}},
    {id: 'task_3', type: 'task', name: '等待任意模板', action: 'vision.wait_any', params: {templates: ['assets/list.png']}},
  ]});
  for (const action of ['workflow.run', 'workflow.sequence', 'workflow.select']) {
    write(action.replace('.', '_'), {nodes: [{id: 'root_1', type: 'root'}, {
      id: 'task_1', type: 'task', name: `通过 ${action} 调用`, action,
      params: action === 'workflow.run' ? {workflow: 'target.owf'} : {workflows: ['target.owf']},
    }]});
  }
  write('parallel', {nodes: [{id: 'root_1', type: 'root'}, {id: 'instance_parallel_1', type: 'instance_parallel', runs: [{instance: 'one', workflow: 'target.owf', inputs: {}}]}]});
  const graph = await buildReferenceGraph(root, 'workflows/target.owf');
  assert.deepEqual(graph.references.map(item => item.target.path).sort(), ['assets/button.png', 'assets/list.png', 'workflows/child.owf']);
  assert.equal(graph.referencedBy.length, 4);
  assert.deepEqual(graph.referencedBy.flatMap(item => item.contexts.map(context => context.kind)).sort(),
    ['instance_parallel', 'workflow.run', 'workflow.select', 'workflow.sequence']);
  for (const action of ['workflow.sequence', 'workflow.select']) {
    const outgoing = await buildReferenceGraph(root, `workflows/${action.replace('.', '_')}.owf`);
    assert.equal(outgoing.references[0].target.path, 'workflows/target.owf');
  }
  const service = new ProjectService(root);
  await assert.rejects(service.deleteContent('workflows/target.owf'), /仍被 4 项引用/);
  assert.equal(fs.existsSync(path.join(root, 'workflows', 'target.owf')), true);
  for (const item of graph.referencedBy) await service.deleteContent(item.target.path);
  await service.deleteContent('workflows/target.owf');
  assert.equal(fs.existsSync(path.join(root, 'workflows', 'target.owf')), false);
  assert.equal(fs.existsSync(path.join(root, 'workflows', 'child.owf')), true);
  assert.equal(fs.existsSync(path.join(root, 'assets', 'button.png')), true);
});
