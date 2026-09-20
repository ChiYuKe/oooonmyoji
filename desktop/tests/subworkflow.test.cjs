const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createSubworkflowHelpers} = require('../dist-test-renderer/canvas/model/subworkflow.js');

function helpers(raw) {
  return createSubworkflowHelpers({
    state: {raw, dirty: false},
    vscode: {postMessage: () => {}},
    nodeById: id => raw.nodes.find(node => node.id === id),
    $: () => ({getBoundingClientRect: () => ({left: 0, bottom: 0})}),
    showMenu: () => {},
    compactValue: String,
  });
}

test('子工作流引用可沿 workflow 类型变量读取默认脚本', () => {
  const raw = {
    inputs: {公开流程: {type: 'workflow', default: 'entrypoints/public.json'}},
    variables: {
      子工作流: {type: 'workflow', default: 'entrypoints/child.json'},
      普通文本: {type: 'string', default: 'entrypoints/not-a-workflow.json'},
    },
    nodes: [{id: 'run', type: 'task', action: 'workflow.run', params: {workflow: {ref: 'variables.子工作流'}}}],
  };
  const h = helpers(raw);

  assert.equal(h.resolveWorkflowRef(' entrypoints/direct.json '), 'entrypoints/direct.json');
  assert.equal(h.resolveWorkflowRef({ref: 'inputs.公开流程'}), 'entrypoints/public.json');
  assert.equal(h.subWorkflowRef(raw.nodes[0]), 'entrypoints/child.json');
  assert.equal(h.resolveWorkflowRef({ref: 'variables.普通文本'}), '');
  assert.equal(h.resolveWorkflowRef({ref: 'nodes.other.output'}), '');
});
