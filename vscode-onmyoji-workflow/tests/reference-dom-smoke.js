/* Minimal DOM smoke test for the workflow reference viewer webview. */
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
    this.textContent = ''; this._listeners = {}; this.checked = false; this.value = ''; this.selected = false;
  }
  set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.values].join(' '); }
  set innerHTML(_value) { this.children = []; this.textContent = ''; }
  get innerHTML() { return ''; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); }
  setAttribute(name, value) { this[name] = String(value); }
}

const ids = [
  'workflow-name', 'workflow-path', 'workflow-select', 'btn-refresh',
  'outgoing-count', 'incoming-count', 'unresolved-count',
  'outgoing-block', 'outgoing-empty', 'outgoing-list',
  'incoming-block', 'incoming-empty', 'incoming-list',
  'unresolved-block', 'unresolved-list',
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
const fire = (element, type, values = {}) => { for (const listener of element._listeners[type] || []) listener({ target: element, ...values }); };
const send = (data) => { for (const listener of windowStub._listeners.message || []) listener({ data }); };

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'reference-viewer.js'), 'utf8');
vm.runInNewContext(code, {
  document: documentStub, window: windowStub, acquireVsCodeApi: () => vscodeStub,
  setInterval: () => 1, Date, Number, String, Math, console,
}, { filename: 'reference-viewer.js' });

let passed = 0;
const check = (name, condition) => { if (!condition) throw new Error(name); passed += 1; };
check('初始化请求引用数据', posted.some((message) => message.type === 'ready'));

const files = [
  { uri: 'file:///w/souls_party_leader_round.json', name: 'souls_party_leader_round.json', rel: 'workflows/souls_party_leader_round.json' },
  { uri: 'file:///w/mumu_0_souls_party_leader.json', name: 'mumu_0_souls_party_leader.json', rel: 'workflows/mumu_0_souls_party_leader.json' },
  { uri: 'file:///w/reward_statistics.json', name: 'reward_statistics.json', rel: 'workflows/reward_statistics.json' },
];
send({
  type: 'init',
  workflows: files,
  currentUri: 'file:///w/souls_party_leader_round.json',
  currentName: 'workflows/souls_party_leader_round.json',
  outgoing: [
    { nodeId: 'reward_1', nodeName: '结算奖励', reference: 'reward_statistics.json', uri: 'file:///w/reward_statistics.json', name: 'workflows/reward_statistics.json' },
    { nodeId: 'reward_2', reference: 'reward_statistics.json', uri: 'file:///w/reward_statistics.json', name: 'workflows/reward_statistics.json' },
  ],
  incoming: [{
    source: { uri: 'file:///w/mumu_0_souls_party_leader.json', name: 'workflows/mumu_0_souls_party_leader.json' },
    entries: [
      { nodeId: 'round_1', nodeName: '进入回合', reference: 'souls_party_leader_round.json', uri: 'file:///w/mumu_0_souls_party_leader.json', name: 'workflows/mumu_0_souls_party_leader.json' },
      { nodeId: 'round_2', reference: 'souls_party_leader_round.json', uri: 'file:///w/mumu_0_souls_party_leader.json', name: 'workflows/mumu_0_souls_party_leader.json' },
    ],
  }],
  unresolved: [{ nodeId: 'broken', reference: 'missing_flow.json' }],
});

check('显示当前工作流名称与路径', elements['workflow-name'].textContent === 'souls_party_leader_round.json' && elements['workflow-path'].textContent === 'workflows/souls_party_leader_round.json');
check('下拉框列出全部工作流并选中当前', elements['workflow-select'].children.length === 3 && elements['workflow-select'].children[0].selected);
check('汇总引用与被引用数量', elements['outgoing-count'].textContent === '2' && elements['incoming-count'].textContent === '2' && elements['unresolved-count'].textContent === '1');
check('引用列表渲染每条目标与节点', elements['outgoing-list'].children.length === 2
  && elements['outgoing-list'].children[0].children[1].children[0].children[0].textContent === 'workflows/reward_statistics.json'
  && elements['outgoing-list'].children.some((row) => row.children[1].children[1].textContent.includes('reward_statistics.json')));
const postedBeforeOpen = posted.length;
fire(elements['outgoing-list'].children[0].children[2], 'click');
check('点击引用行发送打开目标工作流', posted.slice(postedBeforeOpen).some((message) => message.type === 'openWorkflow' && message.uri === 'file:///w/reward_statistics.json'));
check('反向引用按来源分组', elements['incoming-list'].children.length === 1
  && elements['incoming-list'].children[0].children[0].children[1].textContent === 'workflows/mumu_0_souls_party_leader.json'
  && elements['incoming-list'].children[0].children[1].classList.contains('ref-row'));
check('悬空引用区块展示未匹配条目', !elements['unresolved-block'].classList.contains('hidden') && elements['unresolved-list'].children.length === 1);

send({ type: 'init', workflows: files, currentUri: 'file:///w/reward_statistics.json', currentName: 'workflows/reward_statistics.json', outgoing: [], incoming: [], unresolved: [] });
check('无引用时显示空状态并隐藏悬空区块', !elements['outgoing-empty'].classList.contains('hidden')
  && !elements['incoming-empty'].classList.contains('hidden')
  && elements['unresolved-block'].classList.contains('hidden'));

const postedBeforeSwitch = posted.length;
elements['workflow-select'].value = 'file:///w/mumu_0_souls_party_leader.json';
fire(elements['workflow-select'], 'change');
check('切换选择发送 switchWorkflow', posted.slice(postedBeforeSwitch).some((message) => message.type === 'switchWorkflow' && message.uri === 'file:///w/mumu_0_souls_party_leader.json'));
fire(elements['btn-refresh'], 'click');
check('刷新按钮请求重新扫描', posted.some((message) => message.type === 'refresh'));

console.log(`REFERENCE VIEWER DOM SMOKE OK (${passed} checks)`);