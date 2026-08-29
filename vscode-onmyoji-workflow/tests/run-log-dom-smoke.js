/* Minimal DOM smoke test for the dedicated run log webview. */
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
    this.tagName = tag.toUpperCase(); this.children = []; this.classList = new ClassList(); this.dataset = {};
    this.textContent = ''; this._listeners = {}; this.checked = false; this.scrollTop = 0; this.src = ''; this.alt = '';
  }
  set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.values].join(' '); }
  set innerHTML(_value) { this.children = []; this.textContent = ''; }
  get innerHTML() { return ''; }
  get scrollHeight() { return this.children.length * 60 + this.textContent.length; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); }
}

const ids = [
  'workflow-name', 'run-meta', 'status-label', 'elapsed', 'completed-count', 'failed-count', 'current-step',
  'tab-steps', 'tab-engine', 'auto-scroll', 'btn-stop', 'btn-clear', 'steps-view', 'engine-view', 'empty-state',
  'step-list', 'engine-output', 'lightbox', 'lightbox-close', 'lightbox-image',
];
const elements = Object.fromEntries(ids.map((id) => [id, new Element(id === 'auto-scroll' ? 'input' : 'div')]));
elements['auto-scroll'].checked = true;
const filters = ['tasks', 'all', 'failed'].map((name) => { const item = new Element('button'); item.dataset.filter = name; return item; });
const body = new Element('body');
const documentStub = {
  body,
  getElementById: (id) => elements[id],
  createElement: (tag) => new Element(tag),
  querySelectorAll: (selector) => selector === '#filters button' ? filters : [],
};
const windowStub = { _listeners: {}, addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); } };
const posted = [];
const vscodeStub = { postMessage(message) { posted.push(message); } };
const fire = (element, type, values = {}) => { for (const listener of element._listeners[type] || []) listener({ target: element, ...values }); };
const send = (data) => { for (const listener of windowStub._listeners.message || []) listener({ data }); };

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'run-log.js'), 'utf8');
vm.runInNewContext(code, {
  document: documentStub, window: windowStub, acquireVsCodeApi: () => vscodeStub,
  setInterval: () => 1, Date, Number, String, Math, console,
}, { filename: 'run-log.js' });

let passed = 0;
const check = (name, condition) => { if (!condition) throw new Error(name); passed += 1; };
check('初始化请求日志数据', posted.some((message) => message.type === 'ready'));

send({
  type: 'init',
  descriptor: { workflow: 'mumu_1_souls_loop.json', instance: 'mumu-1', startedAt: Date.now(), status: 'starting' },
  engineOutput: '\u001b[31mengine line\u001b[0m\n',
  events: [
    { type: 'run_started', run_id: 'run-1', instance_id: 'mumu-1', status: 'running', ts: 100 },
    { type: 'step', step_id: 'root', ts: 100.1, step: { status: 'running', execution_index: 0, node_kind: 'root' } },
    { type: 'step', step_id: 'tap_ready', ts: 100.2, step: { status: 'running', execution_index: 1, node_kind: 'task', action: 'input.tap_match' } },
    { type: 'step', step_id: 'tap_ready', ts: 100.3, step: { status: 'succeeded', execution_index: 1, node_kind: 'task', action: 'input.tap_match', duration_ms: 123.4 } },
  ],
});

check('显示工作流与实例', elements['workflow-name'].textContent === 'mumu_1_souls_loop.json' && elements['run-meta'].textContent.includes('mumu-1'));
check('默认只显示 Task 时间线', elements['step-list'].children.length === 1 && elements['step-list'].children[0].dataset.stepId === 'tap_ready');
check('汇总成功任务数量', elements['completed-count'].textContent === '1');
check('引擎输出移除 ANSI 控制码', elements['engine-output'].textContent === 'engine line\n');

send({ type: 'runEvent', event: { type: 'step', step_id: 'wait_victory', ts: 101, step: { status: 'running', execution_index: 2, node_kind: 'task', action: 'vision.wait_template' } } });
send({ type: 'runEvent', event: { type: 'step', step_id: 'wait_victory', ts: 102, step: { status: 'failed', execution_index: 2, node_kind: 'task', action: 'vision.wait_template', duration_ms: 1000, error: 'timeout' } } });
fire(filters[2], 'click');
check('失败筛选只保留失败节点', elements['step-list'].children.length === 1 && elements['step-list'].children[0].dataset.stepId === 'wait_victory');
check('失败计数与错误详情更新', elements['failed-count'].textContent === '1' && elements['step-list'].children[0].children[1].children.some((child) => child.textContent === 'timeout'));

fire(elements['btn-stop'], 'click');
fire(elements['btn-clear'], 'click');
check('停止与清空命令可用', posted.some((message) => message.type === 'stopWorkflow') && posted.some((message) => message.type === 'clear'));

console.log(`RUN LOG DOM SMOKE OK (${passed} checks)`);

