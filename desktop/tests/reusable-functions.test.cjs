const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const original = Module._load;
Module._load = function (name, ...args) { return name === 'electron' ? { dialog: {}, shell: {}, BrowserWindow: class {} } : original.call(this, name, ...args); };
const { ProjectService } = require('../dist-electron/main/projectService.js');
Module._load = original;
const { loadActionCatalog } = require('../dist-electron/main/core/catalog.js');
const { planReusableFunction } = require('../dist-test-renderer/canvas/model/reusable-function.js');
const { createReusableFunctions } = require('../dist-test-renderer/canvas/interactions/reusable-functions.js');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
const { createCanvasWorkflowModel } = require('../dist-test-renderer/canvas/model/canvas-workflow-model.js');
const { functionOutputSchema } = require('../dist-electron/shared/workflow/function-outputs.js');
const { parseWorkflow } = require('../dist-electron/shared/workflow/parse.js');
const { emitRuntimeDocument, parseDocument } = require('../dist-electron/shared/workflow/graph-dsl.js');
const { toCanvasDocument } = require('../dist-electron/shared/workflow/graph-document.js');
const projectRoot = path.resolve(__dirname, '../..');
const catalog = loadActionCatalog(projectRoot);

function source() {
  return { schema_version: 4, id: 'parent', version: '1.0.0', resolution: [1920, 1080], root: 'root_1',
    inputs: { text: { type: 'string', default: 'hello', display_name: '文字' } }, variables: {},
    nodes: [
      { id: 'root_1', type: 'root', children: ['sequence_1'] },
      { id: 'sequence_1', type: 'sequence', children: ['task_1', 'sequence_2', 'task_4'] },
      { id: 'task_1', type: 'task', action: 'core.capture', params: {} },
      { id: 'sequence_2', type: 'sequence', name: '生成日志', children: ['task_2', 'task_3'] },
      { id: 'task_2', type: 'task', name: '内部日志', action: 'core.log', params: { message: { ref: 'inputs.text' }, fields: { width: { ref: 'nodes.task_1.output.width' } } } },
      { id: 'task_3', type: 'task', action: 'core.assert', params: { value: { ref: 'nodes.bool_judge_1.output.value' } } },
      { id: 'task_4', type: 'task', action: 'core.log', params: { message: { ref: 'nodes.task_2.output.message' }, fields: { literal: 'nodes.task_2.output.message', checked: { ref: 'nodes.task_3.output.asserted' } } } },
      { id: 'bool_judge_1', type: 'bool_judge', expression: { eq: [{ ref: 'nodes.task_1.output.width' }, 1920] } },
    ], _layout: { sequence_2: { x: 320, y: 240 }, task_2: { x: 320, y: 480 } },
  };
}
const extract = (raw = source(), entry = 'sequence_2') => planReusableFunction(raw, entry, '公共日志', 'public_log', 'functions/log.owf', catalog);

test('封装整个子树并自动接好输入、输出和纯数据依赖，原文档不被改动', () => {
  const raw = source(), before = structuredClone(raw), plan = extract(raw);
  assert.deepEqual(raw, before);
  assert.equal(plan.nodeCount, 4);
  const call = plan.parent.nodes.find(node => node.id === 'sequence_2');
  assert.equal(call.action, 'workflow.run');
  assert.equal(call.params.inputs.text.ref, 'inputs.text');
  assert.equal(plan.child.inputs.text.default, 'hello');
  assert.equal(plan.child.inputs.text.display_name, '文字');
  assert.equal(plan.child.inputs['输入_2'].type, 'integer');
  assert.equal(plan.inputs.filter(input => input.source === 'nodes.task_1.output.width').length, 1, '重复来源只生成一个输入');
  assert.deepEqual(plan.parent._layout.sequence_2, { x: 320, y: 240 });
  assert.ok(!plan.parent.nodes.some(node => node.id === 'bool_judge_1'));
  const after = plan.parent.nodes.find(node => node.id === 'task_4');
  assert.equal(after.params.message.ref, 'nodes.sequence_2.output.output.task_2.message');
  assert.equal(after.params.fields.checked.ref, 'nodes.sequence_2.output.output.task_3.asserted');
  assert.equal(after.params.fields.literal, 'nodes.task_2.output.message');
  for (const document of [plan.parent, plan.child]) {
    const roundTrip = toCanvasDocument(parseDocument(emitRuntimeDocument(document)));
    assert.equal(roundTrip.id, document.id);
    assert.equal(roundTrip.nodes.length, document.nodes.length);
  }
});

test('外部仍使用的数据卡保留在原流程，并改接功能输出', () => {
  const raw = source();
  raw.nodes.find(node => node.id === 'bool_judge_1').expression = { eq: [{ ref: 'nodes.task_2.output.message' }, 'hello'] };
  raw.nodes.find(node => node.id === 'task_4').params.fields.value = { ref: 'nodes.bool_judge_1.output.value' };
  const plan = extract(raw);
  const parentData = plan.parent.nodes.find(node => node.id === 'bool_judge_1');
  assert.equal(parentData.expression.eq[0].ref, 'nodes.sequence_2.output.output.task_2.message');
  assert.equal(plan.child.nodes.find(node => node.id === 'bool_judge_1').expression.eq[0].ref, 'nodes.task_2.output.message');
});

test('局部变量和重复留在功能内部，一次执行状态保留在调用节点上', () => {
  const raw = source();
  raw.variables.local = { type: 'string', default: 'local', owner: 'sequence_2', initial_from: 'text' };
  raw.nodes.find(node => node.id === 'task_2').params.message = { ref: 'variables.local' };
  raw.nodes.find(node => node.id === 'sequence_2').decorators = [{ type: 'repeat', count: 2 }, { type: 'do_once', reset_on_failure: true }];
  const plan = extract(raw);
  assert.equal(plan.child.variables.local.owner, 'sequence_2');
  assert.equal(plan.child.variables.local.initial_from, 'text');
  assert.equal(plan.parent.variables.local, undefined);
  assert.equal(plan.child.nodes.find(node => node.id === 'sequence_2').decorators[0].type, 'repeat');
  assert.equal(plan.parent.nodes.find(node => node.id === 'sequence_2').decorators[0].type, 'do_once');
});

test('拒绝会改变跨调用状态或循环上下文的封装，保留源文档', () => {
  const raw = source();
  raw.nodes.find(node => node.id === 'task_2').decorators = [{ type: 'do_once' }];
  assert.throws(() => extract(raw), /跨调用保存状态/);
  const other = source();
  other.nodes.find(node => node.id === 'task_2').params.fields.index = { ref: 'runtime.repeat.index' };
  assert.throws(() => extract(other), /循环上下文/);
  assert.throws(() => extract(source(), 'root_1'), /功能入口/);
});

test('可复用节点列出源功能的具体输出字段，中文标签与类型保持一致', () => {
  const plan = extract(), call = plan.parent.nodes.find(node => node.id === 'sequence_2');
  const schema = functionOutputSchema(parseWorkflow(plan.child), catalog);
  const state = { raw: plan.parent, workflows: [{ rel: 'functions/log.owf', outputSchema: schema }] };
  const model = createCanvasWorkflowModel({ state, Model: {}, VariableSystem: {}, nodes: () => state.raw.nodes,
    catalogByName: name => catalog.byName(name), workflowReference: file => file.rel,
    fieldLabel: field => field, workflowNodeInputs: () => [], variableCards: () => ({}),
  });
  const field = model.nodeOutputFields(call).find(field => field.field === 'output.task_2.message');
  assert.ok(field);
  assert.equal(field.schema.type, 'string');
  assert.match(field.label, /内部日志/);
  assert.equal(field.ref, 'nodes.sequence_2.output.output.task_2.message');
});

function uiHarness(t) {
  const previous = global.document;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.value = ''; }
    append(...children) { this.children.push(...children); }
    setAttribute() {}
    addEventListener(name, handler) { this.events[name] = handler; }
    remove() {}
    focus() {}
    select() {}
  }
  const body = new Element('body');
  global.document = { body, createElement: tag => new Element(tag), querySelector: () => null, activeElement: null };
  t.after(() => { global.document = previous; });
  const state = createCanvasState();
  state.raw = source(); state.docUri = 'file:///parent.owf'; state.catalog = catalog.all();
  const messages = [], toasts = [];
  let receive;
  const history = createEditorHistory({ state, cleanupReleased: () => [], clearVariableCardSelection() {}, nodeById: id => state.raw.nodes.find(node => node.id === id), normalizeRaw: raw => raw, setDirty() {}, render() {} });
  const actions = createReusableFunctions({ state, bridge: { subscribe(fn) { receive = fn; }, post(message) { messages.push(message); } }, mutate: history.mutate, toast: message => toasts.push(message) });
  const collect = element => [element, ...element.children.flatMap(collect)];
  actions.extract('sequence_2');
  const elements = collect(body);
  elements.find(element => element.tagName === 'button' && element.textContent === '创建功能并替换').events.click();
  return { state, messages, toasts, history, receive: message => receive(message) };
}

test('收到创建成功后才替换，Ctrl+Z 能恢复整个源流程', t => {
  const ui = uiHarness(t), before = structuredClone(ui.state.raw);
  const request = ui.messages[0];
  assert.equal(request.type, 'createReusableFunction');
  assert.deepEqual(ui.state.raw, before);
  ui.receive({ type: 'reusableFunctionCreated', requestId: 'another-request' });
  assert.deepEqual(ui.state.raw, before);
  ui.receive({ type: 'reusableFunctionCreated', requestId: request.requestId });
  assert.equal(ui.state.raw.nodes.find(node => node.id === 'sequence_2').action, 'workflow.run');
  ui.history.undo();
  assert.deepEqual(ui.state.raw, before);
});

test('创建期间改动源流程或创建失败，都保留当前编辑内容', t => {
  const ui = uiHarness(t), request = ui.messages[0];
  ui.state.raw.description = '等待期间的新修改';
  ui.receive({ type: 'reusableFunctionCreated', requestId: request.requestId });
  assert.equal(ui.state.raw.description, '等待期间的新修改');
  assert.equal(ui.state.raw.nodes.find(node => node.id === 'sequence_2').type, 'sequence');
  assert.match(ui.toasts.at(-1), /发生变化/);
});

test('文件创建失败不会替换原流程', t => {
  const ui = uiHarness(t), before = structuredClone(ui.state.raw), request = ui.messages[0];
  ui.receive({ type: 'reusableFunctionCreated', requestId: request.requestId, error: '同名功能已存在' });
  assert.deepEqual(ui.state.raw, before);
  assert.equal(ui.toasts.at(-1), '同名功能已存在');
});

function temporaryProject(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-functions-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'workflows'));
  fs.mkdirSync(path.join(directory, 'src/oooonmyoji/actions'), { recursive: true });
  const manifestDir = path.join(directory, 'src/oooonmyoji/actions/manifests');
  fs.mkdirSync(manifestDir);
  for (const file of fs.readdirSync(path.join(projectRoot, 'src/oooonmyoji/actions/manifests'))) fs.writeFileSync(path.join(manifestDir, file), fs.readFileSync(path.join(projectRoot, 'src/oooonmyoji/actions/manifests', file)));
  return directory;
}

test('功能文件独立保存、同名不覆盖、目录反射最新输入和输出', async t => {
  const directory = temporaryProject(t), service = new ProjectService(directory), plan = extract();
  const text = emitRuntimeDocument(plan.child);
  const uri = await service.createReusableFunction('公共日志', text);
  assert.match(uri, /functions/);
  await assert.rejects(service.createReusableFunction('公共日志', text), /同名功能/);
  await assert.rejects(service.createReusableFunction('../outside', text), /名称无效/);
  await assert.rejects(service.createReusableFunction('CON', text), /名称无效/);
  await assert.rejects(service.createReusableFunction('broken', 'invalid'), /./);
  const descriptors = await service.listWorkflows();
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].reusable, true);
  assert.equal(descriptors[0].outputSchema.properties.task_2.properties.message.type, 'string');
  assert.equal(descriptors[0].outputSchema.properties.task_2.title, '内部日志');
  assert.equal(descriptors[0].inputs.find(input => input.name === 'text').definition.default, 'hello');
  plan.child.nodes.find(node => node.id === 'task_2').name = '更新后的日志';
  await service.saveWorkflow(uri, emitRuntimeDocument(plan.child));
  assert.equal((await service.listWorkflows())[0].outputSchema.properties.task_2.title, '更新后的日志');
});

test('封装后的 .owf 通过 Python 校验并实际调用，执行结果与封装前一致', t => {
  const python = path.join(projectRoot, '.venv/Scripts/python.exe');
  if (!fs.existsSync(python)) { t.skip('项目 Python 环境未安装'); return; }
  const directory = temporaryProject(t), plan = extract();
  fs.mkdirSync(path.join(directory, 'workflows/functions'));
  for (const [file, document] of [['before.owf', source()], ['after.owf', plan.parent], ['functions/log.owf', plan.child]]) fs.writeFileSync(path.join(directory, 'workflows', file), emitRuntimeDocument(document));
  const forced = source();
  forced.nodes.find(node => node.id === 'sequence_2').decorators = [{ type: 'repeat', count: 3 }, { type: 'force_success' }];
  forced.nodes.find(node => node.id === 'task_3').params.value = false;
  delete forced.nodes.find(node => node.id === 'task_4').params.fields.checked;
  const forcedPlan = planReusableFunction(forced, 'sequence_2', '失败后收尾', 'forced_log', 'functions/forced.owf', catalog);
  for (const [file, document] of [['before_forced.owf', forced], ['after_forced.owf', forcedPlan.parent], ['functions/forced.owf', forcedPlan.child]]) fs.writeFileSync(path.join(directory, 'workflows', file), emitRuntimeDocument(document));
  const script = `
import sys, json
from pathlib import Path
from types import SimpleNamespace
from src.oooonmyoji.actions.registry import build_action_registry
from src.oooonmyoji.workflows.loader import WorkflowLoader
from src.oooonmyoji.workflows.engine import WorkflowEngine
registry = build_action_registry(Path('plugins/actions'))
loader = WorkflowLoader(Path(sys.argv[1]) / 'workflows', registry, project_root=Path.cwd())
class Context:
    def __init__(self): self.logs = []
    def check_cancelled(self): pass
    def capture(self): return SimpleNamespace(width=1920, height=1080)
    def log(self, message, **fields): self.logs.append([message, fields])
    def run_subworkflow(self, reference, inputs):
        result = WorkflowEngine(loader.load(reference), registry, self, inputs).run()
        return result.status.value, result.output, result.error, result.error_category
for pair in [('before.owf', 'after.owf'), ('before_forced.owf', 'after_forced.owf')]:
    results = []
    for file in pair:
        context = Context()
        result = WorkflowEngine(loader.load(file), registry, context, {'text': 'custom'}).run()
        assert result.status.value == 'succeeded', (file, result.error)
        results.append(context.logs)
    assert results[0] == results[1], (pair, results)
    assert len(results[1]) == 2, results
    assert results[1][-1][0] == 'custom'
print('execution contracts preserved')
`;
  const result = spawnSync(python, ['-c', script, directory], { cwd: projectRoot, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
