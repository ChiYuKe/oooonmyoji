'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ElementStub {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.disabled = false;
    this.className = '';
    this.textContent = '';
    this.listeners = {};
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  fire(type) {
    for (const listener of this.listeners[type] || []) listener({ target: this });
  }
}

const ids = ['run-party', 'stop', 'open-editor', 'open-log', 'validate', 'rounds', 'run-status', 'status-text'];
const elements = Object.fromEntries(ids.map((id) => [id, new ElementStub(id)]));
elements.rounds.value = '9999';
const posted = [];
const windowListeners = {};
const context = {
  acquireVsCodeApi: () => ({ postMessage: (message) => posted.push(message) }),
  document: { getElementById: (id) => elements[id] },
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
elements.validate.fire('click');
check('侧边栏常用命令全部绑定', ['stopWorkflow', 'openWorkflowEditor', 'openRunLog', 'runEngineValidate']
  .every((type) => posted.some((message) => message.type === type)));

for (const listener of windowListeners.message || []) {
  listener({ data: { type: 'state', state: 'running', detail: '组队御魂 · 9999 场', rounds: 9999 } });
}
check('运行状态禁用重复启动', elements['run-party'].disabled && elements.rounds.disabled && !elements.stop.disabled);
check('运行状态文字更新', elements['run-status'].className === 'status running' && elements['status-text'].textContent === '组队御魂 · 9999 场');

if (!ok) process.exit(1);
console.log('SIDEBAR DOM SMOKE OK');
