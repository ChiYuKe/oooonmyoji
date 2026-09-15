const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const editorPath = path.join(__dirname, '../public/legacy/workflow-editor.js');

function extractFunction(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `找不到函数 ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 未闭合`);
}

function harness() {
  const source = fs.readFileSync(editorPath, 'utf8');
  let context;
  context = vm.createContext({
    state: { raw: { _inputParams: {} }, catalog: [] },
    catalogByName: (name) => context.state.catalog.find((item) => item.name === name),
    workflowNodeInputs: () => [],
    variableTypeOf: () => 'any',
    fieldLabel: (name) => ({ message: '提示信息', fields: '字段列表' }[name] || name),
  });
  vm.runInContext(extractFunction(source, 'inputParameterNames'), context);
  vm.runInContext(extractFunction(source, 'nodeVariablePins'), context);
  context.state.catalog = [{
    name: 'core.log',
    parameters: {
      message: { type: 'string', required: true },
      fields: { type: 'object' },
    },
  }];
  return context;
}

test('任务必填参数自动生成变量端口', () => {
  const context = harness();
  const node = { id: 'task_1', type: 'task', action: 'core.log', params: { message: '你好' } };
  assert.deepEqual(Array.from(context.inputParameterNames(node)), ['message']);
  assert.deepEqual(Array.from(context.nodeVariablePins(node), ({ param, label, type }) => ({ param, label, type })), [
    { param: 'message', label: '提示信息', type: 'string' },
  ]);
});

test('必填参数即使尚未填写也保留端口，可选参数只在配置后出现', () => {
  const context = harness();
  const empty = { id: 'task_2', type: 'task', action: 'core.log', params: {} };
  assert.deepEqual(Array.from(context.inputParameterNames(empty)), ['message']);

  const withOptional = { id: 'task_3', type: 'task', action: 'core.log', params: { fields: {} } };
  assert.deepEqual(Array.from(context.inputParameterNames(withOptional)), ['message', 'fields']);
});

test('旧版输入端点元数据仍然可以恢复端口', () => {
  const context = harness();
  context.state.raw._inputParams.task_legacy = { fields: true };
  const node = { id: 'task_legacy', type: 'task', action: 'core.log', params: {} };
  assert.deepEqual(Array.from(context.inputParameterNames(node)), ['message', 'fields']);
});

test('非任务节点不生成任务参数端口', () => {
  const context = harness();
  assert.deepEqual(Array.from(context.nodeVariablePins({ id: 'sequence_1', type: 'sequence', action: 'core.log', params: {} })), []);
});
