const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createNodeNameEditor} = require('../dist-test-renderer/canvas/interactions/node-name-editor.js');

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.style = {};
    this.events = {};
    this.attrs = {};
    this.className = '';
    this.value = '';
  }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function harness(extra = {}) {
  const body = new FakeNode('body');
  const documentListeners = {};
  const windowListeners = {};
  const timers = [];
  globalThis.document = {
    body,
    activeElement: null,
    createElement: (tag) => new FakeNode(tag),
    addEventListener: (type, fn) => { (documentListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { documentListeners[type] = (documentListeners[type] || []).filter((item) => item !== fn); },
  };
  globalThis.window = {
    addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { windowListeners[type] = (windowListeners[type] || []).filter((item) => item !== fn); },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
  };
  const state = {zoom: 1, panX: 0, panY: 0};
  const positions = new Map();
  const renamed = [];
  const nodesRenamed = [];
  const editor = createNodeNameEditor({
    state,
    wrap: {getBoundingClientRect: () => ({left: 10, top: 20})},
    el: (tag, className) => { const node = new FakeNode(tag); node.className = className || ''; return node; },
    position: (node) => positions.get(node.id) || {x: 0, y: 0},
    renameGroup: (id, name) => { renamed.push([id, name]); return true; },
    renameNode: (id, name) => { nodesRenamed.push([id, name]); return true; },
    nodeWidth: 260,
    ...extra,
  });
  return {editor, state, positions, renamed, nodesRenamed, body, timers};
}

function key(input, value) {
  let prevented = false;
  input.events.keydown[0]({key: value, isComposing: false, stopPropagation() {}, preventDefault() { prevented = true; }});
  return prevented;
}

test('F2 标题编辑器覆盖组卡标题，Enter 直接提交组名', () => {
  const h = harness();
  const group = {id: 'node_group_1', name: '节点组 1', _nodeGroup: true};
  h.positions.set(group.id, {x: 100, y: 200});
  assert.equal(h.editor.open(group), true);
  assert.equal(h.editor.isOpen(), true);
  const shell = h.body.children[0];
  const input = shell.children[0];
  assert.equal(shell.className, 'inline-node-name-editor');
  assert.equal(input.className, 'inline-node-name-input', '标题编辑器不继承面板表单的 ui-input 外观');
  assert.equal(input.value, '节点组 1');
  assert.equal(input.focused, true);
  assert.equal(input.selected, true);
  assert.equal(shell.style.left, '146px');
  assert.equal(shell.style.top, '224px');

  input.value = '  战斗循环  ';
  assert.equal(key(input, 'Enter'), true);
  assert.deepEqual(h.renamed, [['node_group_1', '战斗循环']]);
  assert.equal(h.editor.isOpen(), false);
  assert.equal(h.body.children.length, 0);
});

test('组内合成卡编辑所属组名，Esc 取消；缩放平移时继续贴合标题', () => {
  const h = harness();
  const variables = {
    id: '__node_group_variables__:node_group_1', name: '节点组 1 变量',
    _nodeGroupVariables: true, _nodeGroupId: 'node_group_1',
  };
  h.positions.set(variables.id, {x: 40, y: 80});
  assert.equal(h.editor.open(variables), true);
  const shell = h.body.children[0];
  const input = shell.children[0];
  assert.equal(input.value, '节点组 1', '合成卡后缀不进入组名输入框');

  h.state.zoom = 2;
  h.state.panX = 30;
  h.state.panY = -10;
  h.editor.refresh();
  assert.equal(shell.style.left, '192px');
  assert.equal(shell.style.top, '178px');

  input.value = '不应保存';
  assert.equal(key(input, 'Escape'), true);
  assert.deepEqual(h.renamed, []);
  assert.equal(h.editor.isOpen(), false);
});

test('普通节点同样在卡片标题上编辑显示名，空名称回退到稳定 ID', () => {
  const h = harness();
  const task = {id: 'task_1', name: '点击挑战按钮', type: 'task'};
  h.positions.set(task.id, {x: 24, y: 48});
  assert.equal(h.editor.open(task), true);
  let input = h.body.children[0].children[0];
  assert.equal(input.value, '点击挑战按钮');
  input.value = '点击准备按钮';
  key(input, 'Enter');
  assert.deepEqual(h.nodesRenamed, [['task_1', '点击准备按钮']]);

  // 没设过显示名的节点：输入框是空的，标题由卡片按「名称 || 稳定 ID」回退，占位提示给出它。
  const unnamed = {id: 'sequence_1', type: 'sequence'};
  assert.equal(h.editor.open(unnamed), true);
  input = h.body.children[0].children[0];
  assert.equal(input.value, '', '输入框只放手动设过的显示名');
  assert.equal(input.placeholder, 'sequence_1');
  input.value = '';
  key(input, 'Enter');
  assert.deepEqual(h.nodesRenamed, [['task_1', '点击准备按钮']], '空提交没改变显示名就不发命令');
});

test('值卡片：输入框只放覆盖名，占位提示给出 UE 风格派生标题，清空即回到派生标题', () => {
  const h = harness({derivedTitle: (node) => (node.type === 'break' ? 'Break 识别结果' : node.id)});
  const card = {id: 'break_1', type: 'break'};
  assert.equal(h.editor.open(card), true);
  const input = h.body.children[0].children[0];
  assert.equal(input.value, '', '没设过 name 的值卡片不把派生标题塞进输入框');
  assert.equal(input.placeholder, 'Break 识别结果');
  input.value = '拆战斗结果';
  key(input, 'Enter');
  assert.deepEqual(h.nodesRenamed, [['break_1', '拆战斗结果']]);

  // 手动设过名字后，输入框里就是那个名字；清空提交 = 删掉覆盖层，卡片回到派生标题。
  const named = {id: 'break_2', type: 'break', name: '拆战斗结果'};
  assert.equal(h.editor.open(named), true);
  const second = h.body.children[0].children[0];
  assert.equal(second.value, '拆战斗结果');
  second.value = '';
  key(second, 'Enter');
  assert.deepEqual(h.nodesRenamed.at(-1), ['break_2', '']);
});
