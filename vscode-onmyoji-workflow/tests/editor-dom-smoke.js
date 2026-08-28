/* Minimal DOM smoke test for the Behavior Tree v3 webview. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
  constructor() { this._s = new Set(); }
  add(...values) { values.forEach((value) => this._s.add(value)); }
  remove(...values) { values.forEach((value) => this._s.delete(value)); }
  toggle(value, force) { const add = force === undefined ? !this._s.has(value) : force; if (add) this._s.add(value); else this._s.delete(value); return add; }
  contains(value) { return this._s.has(value); }
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {};
    this.classList = new FakeClassList(); this.style = {}; this.textContent = ''; this._listeners = {}; this.parentNode = null; this.id = '';
    this.value = ''; this.checked = false; this.selected = false; this.disabled = false; this.type = '';
  }
  get className() { return [...this.classList._s].join(' '); }
  set className(value) { this.classList._s = new Set(String(value).split(/\s+/).filter(Boolean)); }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = value; }
  getAttribute(key) { return this.attrs[key]; }
  set innerHTML(value) { this.children = []; this._html = String(value); }
  get innerHTML() { return this._html || ''; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 900, bottom: 640, width: 900, height: 640 }; }
  get clientWidth() { return 900; }
  get clientHeight() { return 640; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  focus() {}
  select() {}
}

const els = {};
function walk(root, predicate, out = []) {
  for (const child of root && root.children || []) { if (predicate(child)) out.push(child); walk(child, predicate, out); }
  return out;
}
function findById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) { const found = findById(child, id); if (found) return found; }
  return null;
}
const body = new FakeEl('body');
const documentStub = {
  body,
  getElementById(id) { return els[id] || findById(body, id) || (els[id] = new FakeEl(id === 'graph' || id === 'minimap' ? 'svg' : 'div')); },
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (namespace, tag) => new FakeEl(tag),
  createTextNode: (text) => { const node = new FakeEl('#text'); node.textContent = String(text); return node; },
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  querySelectorAll(selector) { return selector === '.context-menu' ? walk(body, (item) => item.classList.contains('context-menu')) : []; },
  _listeners: {},
};
const windowStub = {
  innerWidth: 900, innerHeight: 640, _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
};
let saved = '';
const posted = [];
const vscodeStub = {
  postMessage(message) { posted.push(message); if (message.type === 'save') saved = message.text; },
  getState: () => ({}), setState() {},
};

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'workflow-editor.js'), 'utf8');
vm.runInNewContext(code, { document: documentStub, window: windowStub, acquireVsCodeApi: () => vscodeStub, setTimeout, clearTimeout, console }, { filename: 'workflow-editor.js' });

const workflow = {
  schema_version: 3,
  id: 'demo', version: '3.0.0', resolution: [1920, 1080], root: 'root',
  limits: { timeout_seconds: 60, max_steps: 100 },
  blackboard: { template: { type: 'asset', default: 'assets/templates/start/yys_tubiao.png' } },
  nodes: [
    { id: 'root', type: 'root', children: ['main'] },
    { id: 'main', type: 'sequence', children: ['capture', 'selector'] },
    { id: 'capture', type: 'task', action: 'core.capture', params: {} },
    { id: 'selector', type: 'selector', children: ['find', 'fallback'] },
    { id: 'find', type: 'task', action: 'vision.match_template', params: {}, decorators: [{ type: 'timeout', seconds: 10 }] },
    { id: 'fallback', type: 'task', action: 'core.log', params: { message: 'not found' } },
  ],
};
const catalog = [
  { name: 'core.capture', version: '1.0.0', description: '截屏', parameters: {}, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object', properties: { width: { type: 'integer' } } }, outputFields: ['width'], retrySafe: true },
  { name: 'vision.match_template', version: '1.0.0', description: '匹配', parameters: { template: { type: 'asset', required: true }, roi: { type: 'rect' }, threshold: { type: 'number', default: 0.85, min: 0, max: 1 }, max_results: { type: 'integer', default: 20, min: 1 }, scale_search: { type: 'boolean', default: false } }, inputSchema: { type: 'object', properties: { template: { type: 'string' }, roi: { type: 'array' }, threshold: { type: 'number' }, max_results: { type: 'integer' }, scale_search: { type: 'boolean' } }, required: ['template'], additionalProperties: false }, outputSchema: { type: 'array' }, outputFields: [], retrySafe: true },
  { name: 'core.log', version: '1.0.0', description: '日志', parameters: { message: { type: 'string', required: true } }, inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false }, outputSchema: { type: 'object' }, outputFields: [], retrySafe: true },
];

for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'init', document: { name: 'demo.json', uri: 'file:///demo.json', text: JSON.stringify(workflow) }, catalog, refs: { blackboard: ['blackboard.template'], nodes: ['nodes.capture.output.width'] }, issues: [] } });

const graph = els.graph;
const hasClass = (item, name) => item.classList.contains(name) || String(item.attrs.class || '').split(/\s+/).includes(name);
const allGraph = (predicate) => walk(graph, predicate);
const nodeGroup = (id) => allGraph((item) => item.tagName === 'G' && hasClass(item, 'node')).find((item) => item.dataset.id === id);
const within = (root, predicate) => walk(root, predicate);
const fire = (target, type, values = {}) => { const event = Object.assign({ button: 0, clientX: 100, clientY: 100, pointerId: 1, shiftKey: false, altKey: false, ctrlKey: false, target, preventDefault() {}, stopPropagation() {} }, values); for (const fn of target._listeners[type] || []) fn(event); };
const fireWindow = (type, values = {}) => { const event = Object.assign({ key: '', button: 0, clientX: 100, clientY: 100, target: body, preventDefault() {}, stopPropagation() {} }, values); for (const fn of windowStub._listeners[type] || []) fn(event); };
const save = () => { fire(els['btn-save'], 'click'); return JSON.parse(saved); };
const inspectorItems = (predicate) => walk(els['inspector-body'], predicate);
const selectNode = (id) => fire(within(nodeGroup(id), (item) => hasClass(item, 'node-box'))[0], 'mousedown');
const portPoint = (id, kind) => {
  const editor = windowStub.__btEditor;
  const raw = editor.snapshot();
  const node = raw.nodes.find((item) => item.id === id);
  const pos = raw._layout[id];
  const height = 96 + (Array.isArray(node.decorators) ? node.decorators.length * 22 : 0);
  return {
    clientX: editor.state.panX + (pos.x + 130) * editor.state.zoom,
    clientY: editor.state.panY + (pos.y + (kind === 'output' ? height : 0)) * editor.state.zoom,
    pointerId: 1,
  };
};

let ok = true;
const check = (name, condition) => { console.log((condition ? '✓ ' : '✗ ') + name); if (!condition) ok = false; };

check('初始化发送 ready', posted.some((message) => message.type === 'ready'));
check('渲染 6 张 Behavior Tree 卡片', allGraph((item) => item.tagName === 'G' && hasClass(item, 'node')).length === 6);
check('渲染 Root/Sequence/Selector/Task 类型', ['type-root', 'type-sequence', 'type-selector', 'type-task'].every((name) => allGraph((item) => hasClass(item, name)).length > 0));
check('父子边来自 children（5 条）', allGraph((item) => item.tagName === 'G' && hasClass(item, 'edge')).length === 5);
check('非 Root 都有单输入引脚', allGraph((item) => hasClass(item, 'port-in')).length === 5);
check('复合节点有输出引脚', allGraph((item) => hasClass(item, 'port-out')).length === 3);
check('装饰器嵌入卡片', within(nodeGroup('find'), (item) => hasClass(item, 'decorator-label')).some((item) => String(item.textContent).includes('Time Limit')));

selectNode('find');
const templateInput = inspectorItems((item) => item.tagName === 'INPUT' && item.placeholder === 'assets/templates/...')[0];
check('空参数的必填模板仍渲染输入框', !!templateInput && templateInput.value === '');
check('模板参数提供截取按钮', inspectorItems((item) => item.tagName === 'BUTTON' && item.textContent === '截取').length === 1);
check('模板匹配渲染完整参数组', inspectorItems((item) => hasClass(item, 'parameter-block')).length === 5);
check('只渲染必填参数不会改写工作流', Object.keys(save().nodes.find((node) => node.id === 'find').params).length === 0);
templateInput.value = 'assets/templates/other.png'; fire(templateInput, 'change');
check('参数栏写回 Action 参数', save().nodes.find((node) => node.id === 'find').params.template === 'assets/templates/other.png');

const decoratorAdd = inspectorItems((item) => item.tagName === 'SELECT' && hasClass(item, 'decorator-add'))[0];
decoratorAdd.value = 'retry'; fire(decoratorAdd, 'change');
check('详情栏添加 Retry 装饰器', save().nodes.find((node) => node.id === 'find').decorators.some((item) => item.type === 'retry' && item.attempts === 2));

// Output -> input reparents capture from Sequence to Selector.
const selectorOut = within(nodeGroup('selector'), (item) => hasClass(item, 'port-out'))[0];
fire(selectorOut, 'pointerdown');
fire(graph, 'pointermove', portPoint('capture', 'input'));
fire(graph, 'pointerup', portPoint('capture', 'input'));
let raw = save();
check('新连接替换目标旧父级', !raw.nodes.find((node) => node.id === 'main').children.includes('capture') && raw.nodes.find((node) => node.id === 'selector').children.includes('capture'));

// Input -> output supports the UE-style reverse drag direction.
const captureInReverse = within(nodeGroup('capture'), (item) => hasClass(item, 'port-in'))[0];
fire(captureInReverse, 'pointerdown');
fire(graph, 'pointermove', portPoint('main', 'output'));
fire(graph, 'pointerup', portPoint('main', 'output'));
raw = save();
check('输入引脚可反向拖到输出引脚', raw.nodes.find((node) => node.id === 'main').children.includes('capture') && !raw.nodes.find((node) => node.id === 'selector').children.includes('capture'));

// Real SVG rerenders replace the hovered input before mouseup; the window fallback must commit it.
const selectorOutFallback = within(nodeGroup('selector'), (item) => hasClass(item, 'port-out'))[0];
fire(selectorOutFallback, 'pointerdown');
windowStub.__btEditor.state.connect.hover = 'capture';
fire(graph, 'pointerup', { clientX: -10000, clientY: -10000, pointerId: 1 });
raw = save();
check('全局 mouseup 可在 SVG 重绘后完成连接', !raw.nodes.find((node) => node.id === 'main').children.includes('capture') && raw.nodes.find((node) => node.id === 'selector').children.includes('capture'));

// Select the selector->capture edge and delete it.
const edge = allGraph((item) => item.tagName === 'G' && hasClass(item, 'edge')).find((item) => item.dataset.parent === 'selector' && item.dataset.child === 'capture');
fire(within(edge, (item) => hasClass(item, 'edge-hit'))[0], 'mousedown');
fireWindow('keydown', { key: 'Delete' });
raw = save();
check('Delete 断开选中连线', !raw.nodes.find((node) => node.id === 'selector').children.includes('capture'));
fireWindow('keydown', { key: 'z', ctrlKey: true });
check('Ctrl+Z 恢复断开的连接', save().nodes.find((node) => node.id === 'selector').children.includes('capture'));

// Drag one card and persist _layout.
const before = windowStub.__btEditor.snapshot()._layout.find;
const box = within(nodeGroup('find'), (item) => hasClass(item, 'node-box'))[0];
fire(box, 'mousedown', { clientX: 200, clientY: 220 });
fireWindow('mousemove', { clientX: 320, clientY: 310 });
fireWindow('mouseup', { clientX: 320, clientY: 310 });
const after = save()._layout.find;
check('拖动卡片持久化 _layout', before.x !== after.x || before.y !== after.y);

const oldZoom = windowStub.__btEditor.state.zoom;
fire(graph, 'wheel', { deltaY: -100, clientX: 400, clientY: 300 });
check('滚轮以光标为中心缩放视口', windowStub.__btEditor.state.zoom > oldZoom);
fire(els['btn-layout'], 'click');
check('自动布局保持 Root 在子节点上方', save()._layout.root.y < save()._layout.main.y);

fire(els['btn-blackboard'], 'click');
const addKey = inspectorItems((item) => item.tagName === 'BUTTON' && String(item.textContent).includes('添加键'))[0];
fire(addKey, 'click');
check('黑板栏新增类型化键', !!save().blackboard.key_1 && save().blackboard.key_1.type === 'string');

for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runEvent', event: { type: 'step', step_id: 'find', step: { status: 'succeeded', duration_ms: 12 }, thumbnail: 'QUJD' } } });
check('运行事件更新卡片状态', hasClass(nodeGroup('find'), 'run-succeeded'));
check('运行事件渲染缩略图', within(nodeGroup('find'), (item) => hasClass(item, 'step-thumb')).length === 1);

selectNode('fallback');
fireWindow('keydown', { key: 'Delete' });
raw = save();
check('删除节点会清理父 children', !raw.nodes.some((node) => node.id === 'fallback') && !raw.nodes.find((node) => node.id === 'selector').children.includes('fallback'));

console.log(ok ? 'DOM SMOKE OK' : 'DOM SMOKE FAILED');
process.exit(ok ? 0 : 1);
