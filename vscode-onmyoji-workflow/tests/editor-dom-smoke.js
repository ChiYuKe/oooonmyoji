/* 一次性 DOM 冒烟测试：用最小 DOM 桩加载 workflow-editor.js，
 * 注入 init 消息触发渲染，检查蓝图节点/引脚/连线结构是否生成。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
  constructor() { this._s = new Set(); }
  add(...c) { c.forEach((x) => this._s.add(x)); }
  remove(...c) { c.forEach((x) => this._s.delete(x)); }
  toggle(c, force) { if (force === undefined ? !this._s.has(c) : force) this._s.add(c); else this._s.delete(c); }
  contains(c) { return this._s.has(c); }
}
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = {};
    this.textContent = '';
    this._listeners = {};
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; this.children.push(c); return c; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 640 }; }
  get clientWidth() { return 900; }
  get clientHeight() { return 640; }
  scrollLeft = 0;
  scrollTop = 0;
  remove() {}
  focus() {}
  querySelector() { return null; }
  append() {}
}
const els = {};
const documentStub = {
  getElementById: (id) => (els[id] || (els[id] = new FakeEl('div'))),
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (ns, tag) => new FakeEl(tag),
  body: new FakeEl('body'),
  querySelector: () => null,
};
const messageHandlers = [];
const windowStub = {
  addEventListener: (t, fn) => { if (t === 'message') messageHandlers.push(fn); },
  removeEventListener: () => {},
};
const vscodeStub = { postMessage: () => {}, getState: () => ({}), setState: () => {} };

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'workflow-editor.js'), 'utf8');
vm.runInNewContext(code, {
  document: documentStub,
  window: windowStub,
  acquireVsCodeApi: () => vscodeStub,
  clearTimeout, setTimeout, console,
  NS: 'http://www.w3.org/2000/svg', // unused by script but harmless
}, { filename: 'workflow-editor.js' });

// 工作流样例（带显式/默认连线和终态）
const workflow = {
  schema_version: 1,
  id: 'demo',
  version: '1.0.0',
  reference_resolution: [1920, 1080],
  entry: 'cap',
  limits: { timeout_seconds: 60, max_steps: 20 },
  inputs_schema: { type: 'object', properties: {} },
  steps: [
    { id: 'cap', action: 'core.capture', on_success: 'find' },
    { id: 'find', action: 'vision.match_template', with: { template: 'assets/templates/start/omg_icon.png', threshold: 0.85 }, on_failure: '$failure' },
    { id: 'tap', action: 'input.tap_match' },
  ],
};
const catalog = [
  { name: 'core.capture', description: '截屏', inputSchema: { type: 'object', properties: {} } },
  { name: 'vision.match_template', description: '匹配', inputSchema: { type: 'object', required: ['template'], properties: { template: { type: 'string' }, threshold: { type: 'number' } } } },
  { name: 'input.tap_match', description: '点击', inputSchema: { type: 'object', properties: {} } },
];
for (const fn of messageHandlers) {
  fn({ data: { type: 'init', document: { name: 'demo.json', uri: 'x', text: JSON.stringify(workflow, null, 2) }, catalog, refs: { inputs: ['inputs.template'], steps: ['steps.cap.output.0'] }, issues: [] } });
}

// ---- 检查渲染结构 ----
const svg = els['graph'];
const countBy = (pred) => {
  let n = 0;
  (function walk(el) { for (const c of el.children || []) { if (pred(c)) n++; walk(c); } })(svg);
  return n;
};
const hasClass = (el, cls) => String(el.attrs.class || '').split(/\s+/).includes(cls);

const nodeGroups = [];
(function walk(el) { for (const c of el.children || []) { if (hasClass(c, 'node')) nodeGroups.push(c); walk(c); } })(svg);

const stepNodes = nodeGroups.filter((g) => hasClass(g, 'kind-step') || hasClass(g, 'kind-entry'));
const termNodes = nodeGroups.filter((g) => hasClass(g, 'kind-terminal'));
const inPins = countBy((el) => hasClass(el, 'port-in'));
const outPins = countBy((el) => hasClass(el, 'port-out'));
const pinLabels = countBy((el) => hasClass(el, 'pin-label'));
const edges = countBy((el) => hasClass(el, 'edge') && el.tagName === 'G');
const fallLabels = countBy((el) => hasClass(el, 'edge-label'));
const hasGrid = countBy((el) => hasClass(el, 'grid-bg')) > 0;
const entryBadge = countBy((el) => hasClass(el, 'entry-badge'));

const results = {
  stepNodes: stepNodes.length,
  terminalNodes: termNodes.length,
  inputPins: inPins,
  outputPins: outPins,
  pinLabels: pinLabels,
  edges: edges,
  fallthroughLabels: fallLabels,
  grid: hasGrid,
  entryBadge: entryBadge,
};
console.log(JSON.stringify(results, null, 2));

const ok =
  stepNodes.length === 3 &&
  termNodes.length === 3 &&
  inPins === 6 &&
  outPins === 9 &&
  pinLabels === 9 &&
  edges >= 4 &&
  fallLabels >= 2 &&
  hasGrid &&
  entryBadge === 1;
console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1);