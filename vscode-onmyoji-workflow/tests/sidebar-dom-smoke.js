'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ElementStub {
  constructor(id, command = '') {
    this.id = id;
    this.value = '';
    this.disabled = false;
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.listeners = {};
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.type = '';
    this.dataset = command ? { editorCommand: command } : {};
  }

  set innerHTML(value) { this.children = []; this._innerHTML = String(value); }
  get innerHTML() { return this._innerHTML || ''; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  fire(type, values = {}) {
    const event = { target: this, key: '', preventDefault() {}, stopPropagation() {}, ...values };
    for (const listener of this.listeners[type] || []) listener(event);
  }
}

const ids = [
  'stop', 'open-editor', 'open-log', 'open-tree', 'open-refs', 'validate',
  'run-status', 'status-text', 'node-search', 'find-node', 'add-variable', 'variable-list',
  'structure-search', 'variable-search', 'structure-tree', 'collapse-tree', 'expand-tree',
  'structure-panel', 'controls-panel',
];
const elements = Object.fromEntries(ids.map((id) => [id, new ElementStub(id)]));
elements['structure-panel'].className = 'dock-content';
elements['controls-panel'].className = 'dock-content hidden';
const editorCommands = ['workflowSettings', 'addTask', 'addSelector', 'addSequence', 'addParallel', 'addInstanceParallel', 'autoLayout', 'fitView', 'exportImage'];
const editorButtons = editorCommands.map((command) => new ElementStub(`editor-${command}`, command));
const tabs = ['structure', 'controls'].map((name) => {
  const tab = new ElementStub(`tab-${name}`);
  tab.dataset.sidebarTab = name;
  tab.className = `dock-tab${name === 'structure' ? ' active' : ''}`;
  return tab;
});
const posted = [];
const windowListeners = {};
const context = {
  acquireVsCodeApi: () => ({ postMessage: (message) => posted.push(message) }),
  document: {
    getElementById: (id) => elements[id],
    createElement: (tag) => new ElementStub(tag),
    querySelectorAll: (selector) => {
      if (selector === '[data-editor-command]') return editorButtons;
      if (selector === '[data-sidebar-tab]') return tabs;
      return [];
    },
  },
  window: {
    addEventListener: (type, listener) => { (windowListeners[type] ||= []).push(listener); },
  },
  Map,
  Set,
  Number,
  String,
};

const walk = (root, predicate, out = []) => {
  for (const child of root?.children || []) {
    if (predicate(child)) out.push(child);
    walk(child, predicate, out);
  }
  return out;
};
const dispatch = (data) => {
  for (const listener of windowListeners.message || []) listener({ data });
};

const script = fs.readFileSync(path.join(__dirname, '..', 'media', 'sidebar.js'), 'utf8');
vm.runInNewContext(script, context, { filename: 'sidebar.js' });

let ok = true;
const check = (name, condition) => {
  console.log(`${condition ? '✓' : '✗'} ${name}`);
  if (!condition) ok = false;
};

check('侧边栏初始化发送 ready', posted.some((message) => message.type === 'ready'));
check('默认显示结构树页签', tabs[0].className.includes('active') && elements['controls-panel'].className.includes('hidden'));
tabs[1].fire('click');
check('左上区域可嵌入并切换控制板页签', tabs[1].className.includes('active')
  && elements['structure-panel'].className.includes('hidden')
  && !elements['controls-panel'].className.includes('hidden'));

elements.stop.fire('click');
elements['open-editor'].fire('click');
elements['open-log'].fire('click');
elements['open-tree'].fire('click');
elements['open-refs'].fire('click');
elements.validate.fire('click');
check('控制板常用命令全部绑定', ['stopWorkflow', 'openWorkflowEditor', 'openRunLog', 'openWorkflowTree', 'openWorkflowReferences', 'runEngineValidate']
  .every((type) => posted.some((message) => message.type === type)));
for (const button of editorButtons) button.fire('click');
check('控制板编辑命令全部转发', editorCommands.every((command) => posted.some((message) => message.type === 'editorCommand' && message.command === command)));
elements['add-variable'].fire('click');
check('变量加号发送新增变量命令', posted.some((message) => message.type === 'editorCommand' && message.command === 'addVariable'));
elements['node-search'].value = '邀请';
elements['find-node'].fire('click');
elements['node-search'].value = '奖励';
elements['node-search'].fire('keydown', { key: 'Enter' });
check('控制板查找支持按钮和回车', ['邀请', '奖励'].every((value) => posted.some((message) => message.command === 'searchNodeByName' && message.value === value)));

dispatch({ type: 'state', state: 'running', detail: 'three_mumu_souls_parallel · 3 个实例' });
check('运行状态启用停止按钮', !elements.stop.disabled);
check('运行状态文字更新', elements['run-status'].className === 'status running' && elements['status-text'].textContent === 'three_mumu_souls_parallel · 3 个实例');

dispatch({
  type: 'editorState',
  root: 'root',
  selectedNode: 'invite',
  selectedVariable: 'rounds',
  nodes: [
    { id: 'root', name: '开始', type: 'root', meta: 'root', children: ['main'] },
    { id: 'main', name: '邀请队友', type: 'sequence', meta: 'sequence', children: ['capture', 'invite'] },
    { id: 'capture', name: '截取画面', type: 'task', meta: 'core.capture', children: [] },
    { id: 'invite', name: '发送邀请', type: 'task', meta: 'input.tap_match', children: [] },
  ],
  variables: [
    { name: 'rounds', type: 'integer', public: true },
    { name: 'invite_target', type: 'asset', public: false },
  ],
});

const structureRows = () => walk(elements['structure-tree'], (item) => item.className.includes('structure-row'));
check('左上结构树按 children 渲染完整层级', structureRows().length === 4);
const selectedRow = structureRows().find((item) => item.dataset.nodeId === 'invite');
check('结构树同步当前画布选中节点', selectedRow?.className.includes('selected'));
selectedRow.fire('click');
check('点击结构树节点会定位编辑器卡片', posted.some((message) => message.type === 'editorCommand' && message.command === 'focusNode' && message.value === 'invite'));
elements['collapse-tree'].fire('click');
const rootNode = walk(elements['structure-tree'], (item) => item.dataset.nodeId === 'root' && item.className.includes('structure-node'))[0];
check('结构树支持全部收起', rootNode && !rootNode.className.includes('open'));
elements['expand-tree'].fire('click');
check('结构树支持全部展开', walk(elements['structure-tree'], (item) => item.dataset.nodeId === 'root' && item.className.includes('structure-node'))[0].className.includes('open'));
elements['structure-search'].value = '发送';
elements['structure-search'].fire('input');
check('结构树搜索保留命中节点及祖先', structureRows().map((item) => item.dataset.nodeId).join(',') === 'root,main,invite');

let variableItems = elements['variable-list'].children;
check('左下变量栏显示类型和公开状态', variableItems.length === 2
  && variableItems[0].children[1].textContent === 'rounds'
  && variableItems[0].children[2].textContent === 'integer'
  && variableItems[0].children[3].textContent === '公开'
  && variableItems[1].children[3].textContent === '私有');
check('当前变量在左下栏保持选中', variableItems[0].className.includes('selected'));
variableItems[1].fire('click');
check('点击变量打开右侧单变量详情', posted.some((message) => message.type === 'editorCommand'
  && message.command === 'selectVariable' && message.value === 'invite_target'));
elements['variable-search'].value = 'rounds';
elements['variable-search'].fire('input');
variableItems = elements['variable-list'].children;
check('变量栏支持搜索过滤', variableItems.length === 1 && variableItems[0].dataset.variable === 'rounds');

if (!ok) process.exit(1);
console.log('SIDEBAR DOM SMOKE OK');
