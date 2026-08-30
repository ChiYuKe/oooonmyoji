/* Minimal DOM smoke test for the card-link workflow reference viewer webview. */
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
    this.attrs = {}; this.offsetWidth = 0; this.offsetHeight = 0;
  }
  get className() { return [...this.classList.values].join(' '); }
  set className(value) { this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  set innerHTML(_value) { this.children = []; this.textContent = ''; }
  get innerHTML() { return ''; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'class') this.className = value; }
  getAttribute(name) { return this.attrs[name]; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 }; }
}

const ids = [
  'workflow-name', 'workflow-path', 'workflow-select', 'btn-refresh',
  'outgoing-count', 'outgoing-total', 'incoming-count', 'incoming-total', 'unresolved-count',
  'graph', 'empty-state', 'tooltip',
];
const elements = Object.fromEntries(ids.map((id) => [id, new Element(id === 'workflow-select' ? 'select' : id === 'graph' ? 'svg' : 'div')]));
// 与真实 HTML 初始状态一致：空状态与提示浮层默认隐藏。
elements['empty-state'].className = 'hidden';
elements['tooltip'].className = 'hidden';
const body = new Element('body');
const documentStub = {
  body,
  getElementById: (id) => elements[id],
  createElement: (tag) => new Element(tag),
  createElementNS: (namespace, tag) => new Element(tag),
};
const windowStub = { _listeners: {}, addEventListener(type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); } };
const posted = [];
const vscodeStub = { postMessage(message) { posted.push(message); } };
const fire = (element, type, values = {}) => {
  const event = Object.assign({ target: element, clientX: 100, clientY: 100, stopPropagation() {} }, values);
  for (const listener of element._listeners[type] || []) listener(event);
};
const send = (data) => { for (const listener of windowStub._listeners.message || []) listener({ data }); };

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'reference-viewer.js'), 'utf8');
vm.runInNewContext(code, {
  document: documentStub, window: windowStub, acquireVsCodeApi: () => vscodeStub,
  setTimeout, clearTimeout, Date, Number, String, Math, console,
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

const graph = elements.graph;
const cards = graph.children.find((item) => item.classList.contains('ref-cards'));
const links = graph.children.find((item) => item.classList.contains('ref-links'));
check('画布包含箭头定义与连线层', graph.children.length >= 2 && Boolean(links) && Boolean(cards));
check('渲染中心/出边/入边三张卡片', cards.children.length === 3
  && cards.children.find((item) => item.getAttribute('data-kind') === 'center')
  && cards.children.find((item) => item.getAttribute('data-kind') === 'out')
  && cards.children.find((item) => item.getAttribute('data-kind') === 'in'));
const centerCard = cards.children.find((item) => item.getAttribute('data-kind') === 'center');
const outCard = cards.children.find((item) => item.getAttribute('data-kind') === 'out');
const inCard = cards.children.find((item) => item.getAttribute('data-kind') === 'in');
check('中心卡指向当前脚本', centerCard.getAttribute('data-uri') === 'file:///w/souls_party_leader_round.json');
check('出边卡合并多处引用并标数量', outCard.getAttribute('data-uri') === 'file:///w/reward_statistics.json'
  && outCard.children.find((item) => item.tagName === 'TEXT' && item.classList.contains('card-count')).textContent === '×2'
  && outCard.children.some((item) => item.textContent === '引用 2 处'));
check('入边卡显示来源与引用数', inCard.getAttribute('data-uri') === 'file:///w/mumu_0_souls_party_leader.json'
  && inCard.children.some((item) => item.textContent === '被引用 2 处'));
check('连线方向正确（出边指向目标、入边指向中心）', links.children.length === 2
  && links.children.some((item) => item.getAttribute('data-kind') === 'out' && item.getAttribute('data-to') === 'file:///w/reward_statistics.json')
  && links.children.some((item) => item.getAttribute('data-kind') === 'in' && item.getAttribute('data-from') === 'file:///w/mumu_0_souls_party_leader.json'));
check('汇总按脚本计数', elements['outgoing-count'].textContent === '1' && elements['outgoing-total'].textContent === '共 2 处'
  && elements['incoming-count'].textContent === '1' && elements['incoming-total'].textContent === '共 2 处'
  && elements['unresolved-count'].textContent === '1');

fire(outCard, 'mousemove', { clientX: 200, clientY: 200 });
check('悬停卡片显示引用来源提示', !elements['tooltip'].classList.contains('hidden')
  && elements['tooltip'].children.some((item) => item.textContent === '结算奖励 (reward_1) → reward_statistics.json'));

const postedBeforeSwitch = posted.length;
elements['workflow-select'].value = 'file:///w/mumu_0_souls_party_leader.json';
fire(elements['workflow-select'], 'change');
check('切换选择发送 switchWorkflow', posted.slice(postedBeforeSwitch).some((message) => message.type === 'switchWorkflow' && message.uri === 'file:///w/mumu_0_souls_party_leader.json'));
fire(elements['btn-refresh'], 'click');
check('刷新按钮请求重新扫描', posted.some((message) => message.type === 'refresh'));

send({ type: 'init', workflows: files, currentUri: '', currentName: '', outgoing: [], incoming: [], unresolved: [] });
check('无引用时显示空状态', !elements['empty-state'].classList.contains('hidden'));

(async () => {
  send({ type: 'init', workflows: files, currentUri: 'file:///w/souls_party_leader_round.json', currentName: 'workflows/souls_party_leader_round.json', outgoing: [], incoming: [], unresolved: [] });
  const cardsAfter = graph.children.find((item) => item.classList.contains('ref-cards'));
  const single = cardsAfter.children.find((item) => item.getAttribute('data-kind') === 'center');
  const beforeCenter = posted.length;
  fire(single, 'click', { clientX: 100, clientY: 100 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('点击中心卡不发送切换', posted.slice(beforeCenter).every((message) => message.type !== 'switchWorkflow'));

  send({ type: 'init', workflows: files, currentUri: 'file:///w/souls_party_leader_round.json', currentName: 'workflows/souls_party_leader_round.json', outgoing: [{ nodeId: 'r1', reference: 'reward_statistics.json', uri: 'file:///w/reward_statistics.json', name: 'workflows/reward_statistics.json' }], incoming: [], unresolved: [] });
  const graphWithLink = graph.children.find((item) => item.classList.contains('ref-cards'));
  const clickable = graphWithLink.children.find((item) => item.getAttribute('data-kind') === 'out');
  const beforeClick = posted.length;
  fire(clickable, 'click', { clientX: 100, clientY: 100 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('单击出边卡延迟切换工作流', posted.slice(beforeClick).some((message) => message.type === 'switchWorkflow' && message.uri === 'file:///w/reward_statistics.json'));

  const beforeDouble = posted.length;
  fire(clickable, 'click', { clientX: 100, clientY: 100 });
  fire(clickable, 'click', { clientX: 100, clientY: 100 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  check('双击卡片发送打开工作流', posted.slice(beforeDouble).some((message) => message.type === 'openWorkflow' && message.uri === 'file:///w/reward_statistics.json'));

  console.log(`REFERENCE VIEWER DOM SMOKE OK (${passed} checks)`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });