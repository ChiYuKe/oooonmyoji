// Run via npm test (builds the renderer test output first).
// 结构树已迁到 panels/sidebar.ts：直接用编译产物 + DOM 桩验证。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSidebar } = require('../dist-test-renderer/renderer/panels/sidebar.js');
const root = path.join(__dirname, '..');

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.className = ''; this.scrollTop = 0;
    this.classList = {
      add: (name) => { if (!this.className.split(' ').includes(name)) this.className += ' ' + name; },
      remove: (name) => { this.className = this.className.split(' ').filter((item) => item !== name).join(' '); },
      toggle: (name, force) => {
        const has = this.className.split(' ').includes(name);
        const next = force === undefined ? !has : Boolean(force);
        if (next && !has) this.className += ' ' + name;
        if (!next && has) this.className = this.className.split(' ').filter((item) => item !== name).join(' ');
        return next;
      },
      contains: (name) => this.className.split(' ').includes(name),
    };
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { this.events[name] = fn; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  querySelector() { return undefined; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return {top: 0, bottom: 0}; }
  scrollIntoView() {}
  // 行内改名输入框会在 setTimeout 里聚焦并全选：桩里吞掉，别让异步活动冒到测试之外。
  focus() {}
  select() {}
}

globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createDocumentFragment: () => new Element('#fragment'),
};
globalThis.Node = Element;
globalThis.CSS = { escape: (value) => value };

test('palette groups retain each original add command exactly once', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const palette = html.slice(html.indexOf('<section id="module-palette"'), html.indexOf('<section id="module-variables"'));
  for (const command of ['addTask', 'addCondition', 'addSequence', 'addSelector', 'addParallel', 'addGenericParallel', 'addRepeatUntil', 'addBranch', 'addSwitch', 'addInstanceParallel']) assert.equal(palette.split(`data-editor-command="${command}"`).length - 1, 1);
  assert.equal((palette.match(/palette-group-heading/g) || []).length, 3);
  assert.equal((palette.match(/<small>/g) || []).length, 10);
});

test('compact tree retains metadata, selection, collapse and missing-child handling', () => {
  const structure = new Element('div');
  const commands = [];
  const sidebar = createSidebar({
    structureView: structure,
    variablesView: new Element('div'),
    icons: { dummy: [] },
    editorCommand: (...args) => commands.push(args),
    showDetailsPanel: () => {},
    registerEditorDeleteTarget: () => {},
  });
  sidebar.apply({
    nodes: [
      {id: 'root', name: '工作流', meta: 'root', type: 'root', children: ['task', 'missing']},
      {id: 'task', name: '等待挑战按钮', meta: 'vision.wait_template', type: 'task', children: []},
    ],
    variables: [],
    selectedNode: 'task',
    selectedVariable: '',
    selectedVariableScope: 'inputs',
    collapsed: new Set(['root']),
  });
  sidebar.render();

  const fragment = structure.children[0];
  const parent = fragment.children[0], children = fragment.children[1], task = children.children[0];
  assert.equal(parent.children[3].textContent, '1'); assert.equal(task.children[3].textContent, '');
  assert.equal(parent.attrs['aria-expanded'], 'false'); assert(children.className.includes('closed'));
  assert(task.className.includes('selected')); assert(task.title.includes('vision.wait_template'));
  task.events.click({target: task}); assert.deepEqual(commands, [['focusNode', 'task']]);
  parent.events.click({target: parent.children[0]});
  assert.equal(sidebar.snapshot().collapsed.has('root'), false);
});

test('值卡片在结构树上显示派生标题；F2 改的是手动显示名，清空即回到派生标题', () => {
  const structure = new Element('div');
  const commands = [];
  const sidebar = createSidebar({
    structureView: structure,
    variablesView: new Element('div'),
    icons: { dummy: [] },
    editorCommand: (...args) => commands.push(args),
    showDetailsPanel: () => {},
    registerEditorDeleteTarget: () => {},
  });
  sidebar.apply({
    nodes: [
      {id: 'break_1', name: 'Break 识别结果', explicitName: '', meta: 'break', type: 'break', children: []},
      {id: 'bool_1', name: '结界未结算', explicitName: '结界未结算', meta: 'bool_judge', type: 'bool_judge', children: []},
    ],
    variables: [],
    selectedNode: '',
    selectedVariable: '',
    selectedVariableScope: 'inputs',
    collapsed: new Set(),
  });
  sidebar.render();

  // 每个节点会同时塞一个 tree-children 容器，所以按类名挑出真正的行。
  const rows = () => structure.children[0].children.filter((child) => child.className.includes('tree-row'));
  const nameOf = (row) => row.children[2].children[0];
  // 值卡片带上来的就是派生标题（`Break 识别结果`），不再裸露 break_1。
  assert.equal(nameOf(rows()[0]).textContent, 'Break 识别结果');
  // 标题与稳定 ID 不同时，悬停提示补出 ID，写引用时照得到。
  assert.equal(rows()[0].title, 'Break 识别结果\nbreak_1\nbreak\nF2 重命名\nDelete 删除该节点');
  assert.equal(rows()[1].title, '结界未结算\nbool_1\nbool_judge\nF2 重命名\nDelete 删除该节点');

  // F2：没设过 name 的值卡片输入框为空，占位提示是派生标题；提交写的是手动显示名。
  sidebar.startNodeRename('break_1');
  const input = nameOf(rows()[0]);
  assert.equal(input.value, '');
  assert.equal(input.placeholder, 'Break 识别结果');
  input.value = '拆战斗结果';
  input.events.keydown({key: 'Enter', preventDefault() {}, stopPropagation() {}});
  assert.deepEqual(commands.at(-1), ['renameNodeName', {nodeId: 'break_1', name: '拆战斗结果'}]);

  // 已有手动名字的卡片：输入框里是那个名字，清空提交 = 删掉覆盖层回到派生标题。
  sidebar.startNodeRename('bool_1');
  const named = nameOf(rows()[1]);
  assert.equal(named.value, '结界未结算');
  named.value = '';
  named.events.keydown({key: 'Enter', preventDefault() {}, stopPropagation() {}});
  assert.deepEqual(commands.at(-1), ['renameNodeName', {nodeId: 'bool_1', name: ''}]);
});
