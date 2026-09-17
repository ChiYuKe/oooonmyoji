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
  for (const command of ['addTask', 'addSequence', 'addSelector', 'addParallel', 'addGenericParallel', 'addRepeatUntil', 'addBranch', 'addSwitch', 'addInstanceParallel']) assert.equal(palette.split(`data-editor-command="${command}"`).length - 1, 1);
  assert.equal((palette.match(/palette-group-heading/g) || []).length, 3);
  assert.equal((palette.match(/<small>/g) || []).length, 9);
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
