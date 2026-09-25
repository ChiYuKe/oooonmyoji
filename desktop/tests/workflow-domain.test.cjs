// Run via npm test (builds the desktop renderer/electron output first).
// 共享工作流领域模块：直接用编译产物做行为测试，不截取源码、不依赖文件布局。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseWorkflow,
  validateWorkflow,
  availableOutputNodeIds,
  possiblyAvailableOutputNodeIds,
  collectRefSuggestions,
  collectWorkflowRunReferences,
  matchWorkflowReference,
  resolveWorkflowReference,
  buildTreeNode,
} = require('../dist-electron/shared/workflow/index.js');

function workflow() {
  return {
    schema_version: 4, id: 'demo', version: '4.0.0', resolution: [1920, 1080], root: 'root',
    inputs: { target: { type: 'asset' } },
    variables: { count: { type: 'integer', default: 0 } },
    nodes: [
      { id: 'root', type: 'root', children: ['seq'] },
      { id: 'seq', type: 'sequence', children: ['first', 'second'] },
      { id: 'first', type: 'task', action: 'vision.capture', params: {} },
      { id: 'second', type: 'task', action: 'input.tap', params: {} },
    ],
  };
}

const captureSpec = {
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object', properties: { dataUrl: { type: 'string' }, width: { type: 'integer' } } },
  parameters: {},
  retrySafe: true,
};
const tapSpec = {
  inputSchema: { type: 'object', properties: { x: { type: 'integer' } } },
  outputSchema: { type: 'object' },
  parameters: {},
  retrySafe: false,
};
const catalog = {
  byName: (name) => ({ 'vision.capture': captureSpec, 'input.tap': tapSpec })[name],
  names: () => ['vision.capture', 'input.tap'],
};

test('图分析按顺序推导可用输出，不把自身算作前置输出', () => {
  const info = parseWorkflow(workflow());
  assert.deepEqual([...availableOutputNodeIds(info, 'second')], ['first']);
  assert.deepEqual([...availableOutputNodeIds(info, 'first')], []);
});

test('selector 之前的兄弟输出只作为可能存在，exists 检查可用', () => {
  const raw = workflow();
  raw.nodes[1] = { id: 'seq', type: 'selector', children: ['first', 'second'] };
  const info = parseWorkflow(raw);
  assert.deepEqual([...availableOutputNodeIds(info, 'second')], []);
  assert.deepEqual([...possiblyAvailableOutputNodeIds(info, 'second')], ['first']);
});

test('引用建议按期望类型过滤，并受目标节点可用性限制', () => {
  const info = parseWorkflow(workflow());
  const suggestions = collectRefSuggestions(info, catalog, 'second', { type: 'string' });
  assert.deepEqual(suggestions.inputs, ['inputs.target']);
  assert.deepEqual(suggestions.nodes, ['nodes.first.output.dataUrl']);
  assert.equal(suggestions.nodes.includes('nodes.second.output'), false);
});

test('语义校验接受合法工作流并指出不可用引用', () => {
  const raw = workflow();
  assert.deepEqual(validateWorkflow(raw, catalog), []);
  raw.nodes[3].params = { x: { ref: 'nodes.second.output.value' } };
  const issues = validateWorkflow(raw, catalog);
  assert.ok(issues.some((item) => item.code === 'unavailable-ref'), JSON.stringify(issues));
});

test('子工作流引用匹配与收集走同一份领域规则', async () => {
  const files = [{ uri: 'file:///project/workflows/demo.owf', name: 'demo.owf', rel: 'workflows/demo.owf', id: 'demo' }];
  assert.equal(matchWorkflowReference('demo', files), files[0].uri);
  assert.equal(matchWorkflowReference('workflows/demo.owf', files), files[0].uri);
  // 旧文档里写的 `.json` 引用按同一口径命中 `.owf` 文件（解析期也认这个后缀）。
  assert.equal(matchWorkflowReference('demo.json', files), files[0].uri);
  assert.equal(matchWorkflowReference('missing', files), undefined);
  const raw = workflow();
  raw.nodes[2] = { id: 'run', type: 'task', action: 'workflow.run', name: '入口', params: { workflow: 'demo' } };
  assert.deepEqual(collectWorkflowRunReferences(raw), [{ nodeId: 'run', nodeName: '入口', reference: 'demo' }]);
  const documentText = 'workflow demo\n  version: 1.0.0\n  resolution: [100, 100]\n  root: root\n';
  const byId = (uri) => Promise.resolve(uri === files[0].uri ? documentText : 'workflow other\n  version: 1.0.0\n  resolution: [100, 100]\n  root: root\n');
  const noNames = [{ uri: 'file:///project/workflows/other.owf', name: 'other.owf', rel: 'workflows/other.owf' }];
  assert.equal(await resolveWorkflowReference('demo', noNames.concat(files), byId), files[0].uri);
});

test('结构树从前端负载角度还原节点层级', () => {
  const tree = buildTreeNode(workflow());
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 'root');
  assert.equal(tree[0].children[0].id, 'seq');
  assert.deepEqual(tree[0].children[0].children.map((node) => node.id), ['first', 'second']);
  assert.equal(tree[0].children[0].meta, 'sequence');
});
