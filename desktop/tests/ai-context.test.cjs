const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { aiWorkflowContext, aiTemplatePath, aiCreationContext } = require('../dist-electron/shared/ai-context.js');
const { readAiImage } = require('../dist-electron/main/ai-images.js');

test('context follows execution and data links, respects each direction limit and hides credentials', () => {
  const raw = { schema_version: 4, nodes: [
    { id: 'before', type: 'task', name: '进入战斗', children: ['wait'], params: { template: 'assets/templates/start.png' } },
    { id: 'wait', type: 'task', name: '等待', action: 'vision.wait_template', children: ['after'], params: { template: 'assets/templates/ready.png', secret: 'hidden-key', source: { ref: 'nodes.before.output.found' } } },
    { id: 'after', type: 'task', name: '点击准备', children: ['last'], params: { template: 'assets/templates/ready.png' } },
    { id: 'last', type: 'task' }, { id: 'unrelated', type: 'task', name: '无关节点', params: { template: 'assets/templates/private.png' } },
  ] };
  const before = JSON.stringify(raw);
  const bundle = aiWorkflowContext(raw, raw.nodes[1], [{ name: 'vision.wait_template', description: '等待匹配', source: '/private/action.py' }], 1);
  assert.deepEqual(bundle.upstream.map(n => n.id), ['before']); assert.deepEqual(bundle.downstream.map(n => n.id), ['after']);
  assert.deepEqual(bundle.templates, [{ path: 'assets/templates/ready.png', nodeIds: ['wait', 'after'] }, { path: 'assets/templates/start.png', nodeIds: ['before'] }]);
  assert.ok(!bundle.context.includes('hidden-key')); assert.ok(!bundle.context.includes('unrelated')); assert.ok(!bundle.context.includes('/private/action.py'));
  assert.ok(JSON.parse(bundle.context).connections.some(edge => edge.relation === 'data-dependency'));
  assert.equal(JSON.stringify(raw), before);
  assert.equal(aiWorkflowContext(raw, raw.nodes[1], [], 0).upstream.length, 0);
});

test('sequence siblings, branching and cycles provide bounded local context', () => {
  const raw = { nodes: [
    { id: 'seq', type: 'sequence', children: ['a', 'b', 'c'] }, { id: 'a', type: 'task' }, { id: 'b', type: 'task' }, { id: 'c', type: 'branch', children: ['d', 'e'] },
    { id: 'd', type: 'task', children: ['b'] }, { id: 'e', type: 'task' },
  ] };
  const bundle = aiWorkflowContext(raw, raw.nodes[2], [], 5);
  assert.equal(bundle.upstream[0].id, 'a'); assert.equal(bundle.downstream[0].id, 'c');
  assert.deepEqual(bundle.downstream.map(n => n.id), ['c', 'd', 'e']);
  assert.ok(!bundle.upstream.some(n => n.id === 'b'));
  assert.ok(JSON.parse(bundle.context).connections.some(edge => edge.relation === 'sequence-order'));
});

test('nested template lists and referenced defaults attach at most six unique images', () => {
  const node = { id: 'wait', type: 'task', params: { templates: Array.from({ length: 8 }, (_, i) => `assets/templates/${i}.png`), fromInput: { ref: 'inputs.target' } } };
  const bundle = aiWorkflowContext({ nodes: [node], inputs: { target: { default: 'assets/templates/input.png' }, private: { default: 'hidden-password' } } }, node, []);
  assert.equal(bundle.templates.length, 6); assert.equal(bundle.omittedTemplateCount, 3); assert.ok(!bundle.context.includes('hidden-password'));
  node.params = { template: { ref: 'inputs.target' } };
  assert.equal(aiWorkflowContext({ nodes: [node], inputs: { target: { default: 'assets/templates/input.png' } } }, node, []).templates[0].path, 'assets/templates/input.png');
  assert.equal(aiTemplatePath('assets/../private.png'), undefined); assert.equal(aiTemplatePath('https://example.com/x.png'), undefined);
  assert.equal(aiTemplatePath('assets\\templates\\target.png'), 'assets/templates/target.png');
});

test('a task at a nested sequence exit finds the next outer step', () => {
  const leaf = { id: 'leaf', type: 'task' };
  const raw = { nodes: [{ id: 'outer', type: 'sequence', children: ['inner', 'next'] }, { id: 'inner', type: 'sequence', children: ['leaf'] }, leaf, { id: 'next', type: 'task' }] };
  assert.equal(aiWorkflowContext(raw, leaf, [], 1).downstream[0].id, 'next');
});

test('node creation uses dragged source, reverse target and data endpoint rather than incidental selection', () => {
  const raw = { nodes: [{ id: 'source', type: 'branch', children: [] }, { id: 'target', type: 'task' }, { id: 'selected', type: 'task' }] };
  const after = aiCreationContext(raw, [], { connection: { parent: 'source', slot: 'false', oldChild: 'target' } }, 'selected');
  assert.equal(after.anchor.id, 'source'); assert.equal(after.direction, 'after');
  assert.equal(JSON.parse(after.context).creation.branchSlot, 'false'); assert.equal(JSON.parse(after.context).creation.previousTarget, 'target');
  assert.equal(aiCreationContext(raw, [], { connection: { direction: 'from-input', child: 'target' } }, 'selected').direction, 'before');
  const data = aiCreationContext(raw, [], { reference: { nodeId: 'target', field: 'matches.0' } });
  assert.equal(data.direction, 'data-consumer'); assert.equal(JSON.parse(data.context).creation.outputField, 'matches.0');
  assert.equal(aiCreationContext(raw, [], {}, 'selected').anchor.id, 'selected');
  assert.equal(JSON.parse(aiCreationContext(raw, [], {}).context).selected, null);
  assert.throws(() => aiCreationContext(raw, [], { connection: { parent: 'removed' } }, 'selected'), /已删除/);
});

test('image reads reject missing, oversized, traversal and junction escapes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoflow-ai-images-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'project'); fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/target.png'), 'image-fixture');
  assert.equal((await readAiImage(root, 'assets/target.png')).toString(), 'image-fixture');
  for (const relative of ['assets/../target.png', 'ai-settings.json', 'assets/missing.png']) await assert.rejects(readAiImage(root, relative), /无效|无法读取/);
  fs.writeFileSync(path.join(root, 'assets/large.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
  await assert.rejects(readAiImage(root, 'assets/large.png'), /无法读取/);
  const outside = path.join(dir, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'private.png'), 'private-fixture');
  fs.symlinkSync(outside, path.join(root, 'assets/link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readAiImage(root, 'assets/link/private.png'), /无法读取/);
});
