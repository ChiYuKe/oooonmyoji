/**
 * 详情面板分派：值卡片（布尔判断 / 拆分）的内容在卡片上就地编辑，
 * 选中它们不应打开详情面板（面板停在「选择一个节点」的空态）。
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createInspectorPanel} = require('../dist-test-renderer/canvas/inspector/panel.js');

function stubElement(tag = 'div') {
  const node = {
    tag, className: '', textContent: '', innerHTML: '', hidden: false, style: {}, dataset: {}, attrs: {},
    children: [], parent: null,
    classList: {
      _set: new Set(),
      add(...names) { names.forEach((name) => this._set.add(name)); },
      remove(...names) { names.forEach((name) => this._set.delete(name)); },
      toggle(name, force) { const on = force === undefined ? !this._set.has(name) : Boolean(force); if (on) this._set.add(name); else this._set.delete(name); return on; },
      contains(name) { return this._set.has(name); },
    },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    prepend(child) { this.children.unshift(child); return child; },
    after() {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return node;
}

function harness(selectedNode, overrides = {}) {
  const elements = new Map();
  for (const id of ['inspector', 'editor-main', 'inspector-title', 'inspector-empty', 'inspector-body']) elements.set(id, stubElement());
  const rendered = [];
  const state = Object.assign({
    raw: { nodes: [selectedNode] },
    selected: new Set([selectedNode.id]),
    inspector: 'node',
    selectedRun: null,
    selectedEdge: null,
  }, overrides);
  const panel = createInspectorPanel({
    state,
    UI: {
      closeDropdowns() {},
      sectionHeader: (options) => { const node = stubElement('h3'); node.className = options?.className || ''; node.textContent = options?.title || ''; return node; },
      input: (options) => { const node = stubElement('input'); node.value = options?.value ?? ''; node.onChange = options?.onChange; return node; },
      dropdown: (options) => { const node = stubElement('select'); node.value = options?.value ?? ''; node.className = options?.className || ''; return node; },
      segmented: (options) => { const node = stubElement('div'); node.value = options?.value ?? ''; return node; },
      checkbox: (options) => { const node = stubElement('input'); node.checked = Boolean(options?.checked); return node; },
      button: (options) => { const node = stubElement('button'); node.textContent = options?.label || ''; return node; },
    },
    $: (id) => elements.get(id),
    el: (tag, className, text) => { const node = stubElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; },
    nodeById: (id) => (id === selectedNode.id ? selectedNode : null),
    hideAssetPathPreview() {},
    types: ['task', 'sequence', 'break', 'bool_judge'], typeNames: {}, typeLabels: {},
    renameNodeGroup() {}, changeNodeType() {}, mutate(fn) { fn(); }, deleteSelection() {},
    renderers: {
      renderTaskInspector() { rendered.push('task'); },
      renderCompositeInspector() { rendered.push('composite'); },
      renderDecorators() {},
      renderWorkflowInspector() { rendered.push('workflow'); },
      renderVariablesInspector() { rendered.push('variables'); },
      renderInstanceRunInspector() { rendered.push('run'); },
      renderEdgeInspector() { rendered.push('edge'); },
      renderCommentInspector() { rendered.push('comment'); },
    },
  });
  return { panel, elements, rendered };
}

test('值卡片选中时不打开详情面板', () => {
  for (const type of ['break', 'bool_judge']) {
    const h = harness({ id: `card_${type}`, type });
    h.panel.renderInspector();
    assert.equal(h.elements.get('inspector').classList.contains('hidden'), true, `${type} 不该打开详情面板`);
    assert.equal(h.elements.get('editor-main').classList.contains('inspector-open'), false, `${type} 不该挤开画布`);
    assert.equal(h.elements.get('inspector-empty').textContent, '选择一个节点');
    assert.deepEqual(h.rendered, [], `${type} 不该走任何详情渲染器`);
  }
});

test('普通节点照旧打开详情面板', () => {
  const sequenceNode = { id: 'seq', type: 'sequence', children: [] };
  const sequence = harness(sequenceNode);
  sequence.panel.renderInspector();
  assert.equal(sequence.elements.get('inspector').classList.contains('hidden'), false);
  assert.deepEqual(sequence.rendered, ['composite']);
  assert.equal(sequence.elements.get('inspector-title').textContent, '顺序');
  const basics = sequence.elements.get('inspector-body').children.find(node => node.className === 'node-basics');
  assert.equal(basics.children.some(row => row.children[0].textContent === 'ID'), false);
  const nameInput = basics.children[0].children[1];
  assert.equal(nameInput.placeholder, '顺序');
  nameInput.onChange('挑战循环');
  assert.equal(sequenceNode.name, '挑战循环');
  assert.equal(sequenceNode.id, 'seq');

  const task = harness({ id: 't1', type: 'task', action: 'core.sleep', params: {} });
  task.panel.renderInspector();
  assert.deepEqual(task.rendered, ['task']);
});

test('工作流 / 变量这些面板不受值卡片影响', () => {
  const h = harness({ id: 'card', type: 'break' }, { inspector: 'workflow' });
  h.panel.renderInspector();
  assert.equal(h.elements.get('inspector').classList.contains('hidden'), false, '工作流面板照旧打开');
  assert.deepEqual(h.rendered, ['workflow']);

  const variables = harness({ id: 'card', type: 'bool_judge' }, { inspector: 'variables' });
  variables.panel.renderInspector();
  assert.equal(variables.elements.get('inspector').classList.contains('hidden'), false, '变量面板照旧打开');
  assert.deepEqual(variables.rendered, ['variables']);
});

test('选中注释框时打开详情面板并走注释渲染器（注释不是节点）', () => {
  const h = harness({ id: 'task_1', type: 'task' }, { inspector: 'comment', selectedCommentId: 'comment_1' });
  h.panel.renderInspector();
  assert.equal(h.elements.get('inspector').classList.contains('hidden'), false, '注释框也要能打开面板');
  assert.equal(h.elements.get('editor-main').classList.contains('inspector-open'), true);
  assert.deepEqual(h.rendered, ['comment'], '注释档不该去渲染节点详情');

  // 面板切回节点档：注释渲染器不再被调用。
  const back = harness({ id: 'task_1', type: 'task' }, { inspector: 'node', selectedCommentId: 'comment_1' });
  back.panel.renderInspector();
  assert.deepEqual(back.rendered, ['task']);
});
