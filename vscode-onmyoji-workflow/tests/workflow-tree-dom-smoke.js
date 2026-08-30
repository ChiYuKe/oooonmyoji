/* Minimal DOM smoke test for the standalone workflow tree webview. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) { const add = force === undefined ? !this.values.has(value) : force; if (add) this.values.add(value); else this.values.delete(value); return add; }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.classList = new ClassList(); this.dataset = {};
    this.textContent = ''; this._listeners = {}; this.value = ''; this.selected = false; this.style = {};
  }
  get className() { return [...this.classList.values].join(' '); }
  set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  set innerHTML(_value) { this.children = []; this.textContent = ''; }
  get innerHTML() { return ''; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); }
  setAttribute(name, value) { this[name] = String(value); }
}

const ids = [
  'workflow-name', 'workflow-path', 'workflow-select', 'btn-collapse', 'btn-expand', 'btn-refresh',
  'empty-state', 'tree',
];
const elements = Object.fromEntries(ids.map((id) => [id, new Element(id === 'workflow-select' ? 'select' : 'div')]));
const body = new Element('body');
const documentStub = {
  body,
  getElementById: (id) => elements[id],
  createElement: (tag) => new Element(tag),
};
const windowStub = { _listeners: {}, addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); } };
const posted = [];
const vscodeStub = { postMessage(message) { posted.push(message); } };
const fire = (element, type, values = {}) => { const event = Object.assign({ target: element, stopPropagation() {}, preventDefault() {} }, values); for (const listener of element._listeners[type] || []) listener(event); };
const send = (data) => { for (const listener of windowStub._listeners.message || []) listener({ data }); };
const walk = (root, predicate, out = []) => { for (const child of root && root.children || []) { if (predicate(child)) out.push(child); walk(child, predicate, out); } return out; };
const within = (root, predicate) => walk(root, predicate);

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'workflow-tree.js'), 'utf8');
vm.runInNewContext(code, {
  document: documentStub, window: windowStub, acquireVsCodeApi: () => vscodeStub,
  setInterval: () => 1, Date, Number, String, Math, console,
}, { filename: 'workflow-tree.js' });

let passed = 0;
const check = (name, condition) => { if (!condition) throw new Error(name); passed += 1; };
check('初始化请求结构数据', posted.some((message) => message.type === 'ready'));

const files = [
  { uri: 'file:///w/leader.json', name: 'leader.json', rel: 'workflows/leader.json' },
  { uri: 'file:///w/round.json', name: 'round.json', rel: 'workflows/round.json' },
];
send({
  type: 'init',
  workflows: files,
  currentUri: 'file:///w/leader.json',
  currentName: 'workflows/leader.json',
  nodes: [{
    id: 'root', name: 'root', type: 'root', meta: 'root',
    children: [{
      id: 'main', name: '主流程', type: 'sequence', meta: 'sequence',
      children: [
        { id: 'capture', name: 'capture', type: 'task', meta: 'core.capture', children: [] },
        { id: 'round', name: '进入回合', type: 'task', meta: '⇢ round.json', children: [] },
        { id: 'choice', name: 'choice', type: 'selector', meta: 'selector', children: [
          { id: 'ok', name: 'ok', type: 'task', meta: 'vision.match_template', children: [] },
        ] },
      ],
    }],
  }],
});

const treeRows = () => walk(elements.tree, (item) => item.classList.contains('tree-row'));
const treeLi = (id) => walk(elements.tree, (item) => item.tagName === 'LI' && item.dataset.nodeId === id)[0];
check('显示当前工作流名称', elements['workflow-name'].textContent === 'leader.json' && elements['workflow-path'].textContent === 'workflows/leader.json');
check('下拉框列出工作流并选中当前', elements['workflow-select'].children.length === 2 && elements['workflow-select'].children[0].selected);
check('树渲染全部节点行', treeRows().length === 6);
check('默认全部展开', treeLi('main').classList.contains('open') && treeLi('choice').classList.contains('open'));
check('分支显示折叠三角且叶子没有', treeLi('root').classList.contains('branch') && !treeLi('capture').classList.contains('branch'));
check('任务行显示 Action 与子流程引用', withinRow(treeLi('capture'), 'core.capture') && withinRow(treeLi('round'), '⇢ round.json'));
function withinRow(li, text) { return walk(li, (item) => item.textContent === text).length > 0; }

fire(within(treeLi('main'), (item) => item.classList.contains('tree-caret'))[0], 'click');
check('折叠三角收起子树', !treeLi('main').classList.contains('open'));
fire(within(treeLi('main'), (item) => item.classList.contains('tree-caret'))[0], 'click');
check('折叠三角再次点击展开', treeLi('main').classList.contains('open'));

const postedBeforeFocus = posted.length;
fire(within(treeLi('round'), (item) => item.classList.contains('tree-row'))[0], 'click');
check('点击节点请求编辑器定位', posted.slice(postedBeforeFocus).some((message) => message.type === 'focusNode' && message.uri === 'file:///w/leader.json' && message.nodeId === 'round'));

fire(elements['btn-collapse'], 'click');
check('收起全部折叠所有分支', !treeLi('main').classList.contains('open') && !treeLi('choice').classList.contains('open'));
fire(elements['btn-expand'], 'click');
check('展开全部展开所有分支', treeLi('main').classList.contains('open') && treeLi('choice').classList.contains('open'));

const postedBeforeSwitch = posted.length;
elements['workflow-select'].value = 'file:///w/round.json';
fire(elements['workflow-select'], 'change');
check('切换工作流发送 switchWorkflow', posted.slice(postedBeforeSwitch).some((message) => message.type === 'switchWorkflow' && message.uri === 'file:///w/round.json'));
fire(elements['btn-refresh'], 'click');
check('刷新按钮请求重新读取', posted.some((message) => message.type === 'refresh'));

send({ type: 'init', workflows: files, currentUri: '', currentName: '', nodes: [] });
check('无工作流时显示空状态', !elements['empty-state'].classList.contains('hidden'));

console.log(`WORKFLOW TREE DOM SMOKE OK (${passed} checks)`);