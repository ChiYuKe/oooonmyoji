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
    this.listeners = {};
    this.dataset = command ? { editorCommand: command } : {};
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  fire(type, values = {}) {
    for (const listener of this.listeners[type] || []) listener({ target: this, preventDefault() {}, ...values });
  }
}

const ids = ['run-party', 'stop', 'open-editor', 'open-log', 'open-refs', 'validate', 'rounds', 'run-status', 'status-text', 'node-search', 'find-node'];
const elements = Object.fromEntries(ids.map((id) => [id, new ElementStub(id)]));
const editorCommands = ['workflowSettings', 'blackboard', 'addTask', 'addSelector', 'addSequence', 'addParallel', 'autoLayout', 'fitView', 'exportImage'];
const editorButtons = editorCommands.map((command) => new ElementStub(`editor-${command}`, command));
elements.rounds.value = '9999';
const posted = [];
const windowListeners = {};
const context = {
  acquireVsCodeApi: () => ({ postMessage: (message) => posted.push(message) }),
  document: {
    getElementById: (id) => elements[id],
    querySelectorAll: (selector) => selector === '[data-editor-command]' ? editorButtons : [],
  },
  window: {
    addEventListener: (type, listener) => { (windowListeners[type] ||= []).push(listener); },
  },
  Number,
  String,
};

const script = fs.readFileSync(path.join(__dirname, '..', 'media', 'sidebar.js'), 'utf8');
vm.runInNewContext(script, context, { filename: 'sidebar.js' });

let ok = true;
const check = (name, condition) => {
  console.log(`${condition ? '✓' : '✗'} ${name}`);
  if (!condition) ok = false;
};

check('侧边栏初始化发送 ready', posted.some((message) => message.type === 'ready'));
elements.rounds.value = '1';
elements['run-party'].fire('click');
check('组队按钮发送所选场数', posted.some((message) => message.type === 'runPartySouls' && message.rounds === 1));
elements.stop.fire('click');
elements['open-editor'].fire('click');
elements['open-log'].fire('click');
elements['open-refs'].fire('click');
elements.validate.fire('click');
check('侧边栏常用命令全部绑定', ['stopWorkflow', 'openWorkflowEditor', 'openRunLog', 'openWorkflowReferences', 'runEngineValidate']
  .every((type) => posted.some((message) => message.type === type)));
for (const button of editorButtons) button.fire('click');
check('侧边栏编辑命令全部转发', editorCommands.every((command) => posted.some((message) => message.type === 'editorCommand' && message.command === command)));
elements['node-search'].value = '邀请';
elements['find-node'].fire('click');
check('查找按钮按 name 转发关键词', posted.some((message) => message.type === 'editorCommand' && message.command === 'searchNodeByName' && message.value === '邀请'));
elements['node-search'].value = '奖励';
elements['node-search'].fire('keydown', { key: 'Enter' });
check('卡片查找支持回车提交', posted.some((message) => message.type === 'editorCommand' && message.command === 'searchNodeByName' && message.value === '奖励'));

for (const listener of windowListeners.message || []) {
  listener({ data: { type: 'state', state: 'running', detail: '组队御魂 · 9999 场', rounds: 9999 } });
}
check('运行状态禁用重复启动', elements['run-party'].disabled && elements.rounds.disabled && !elements.stop.disabled);
check('运行状态文字更新', elements['run-status'].className === 'status running' && elements['status-text'].textContent === '组队御魂 · 9999 场');

if (!ok) process.exit(1);
console.log('SIDEBAR DOM SMOKE OK');
