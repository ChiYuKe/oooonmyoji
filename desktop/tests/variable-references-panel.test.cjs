// Run via npm test (builds the renderer test output first).
// 「变量引用」面板：列出谁在引用某个变量，并提供跳转与直接删除两条出口。
const {test} = require('node:test');
const assert = require('node:assert/strict');

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {};
    this.className = ''; this.textContent = ''; this.title = '';
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
  addEventListener(name, fn) { this.events[name] = fn; }
  removeEventListener(name) { delete this.events[name]; }
  /** 浏览器语义：click 不带 key，键盘事件才带。 */
  fire(name) {
    this.events[name]?.(name === 'keydown'
      ? {key: 'Escape', preventDefault() {}, stopPropagation() {}}
      : {preventDefault() {}, stopPropagation() {}});
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  /** 支持 `.class` 与标签名两种选择器（面板里两种都用到了）。 */
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.tagName === selector;
  }
  querySelector(selector) {
    return this.descendants().find((node) => node.matches(selector)) || null;
  }
  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector));
  }
}

const host = new Element('section');
// 面板模块在加载时会取 document，所以桩必须在 require 之前装好。
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  querySelector: () => host,
};
const { createVariableReferences } = require('../dist-test-renderer/renderer/variable-references.js');

function harness() {
  const calls = [];
  let open = false;
  const panel = createVariableReferences({
    // 面板走共享停靠桥：默认与内容浏览器同层叠成标签组，这里只关心开关语义。
    getSharedPanels: () => ({
      surface: () => (open ? 'inner' : undefined),
      show: () => { open = true; },
      close: () => { open = false; },
    }),
    focusNode: (source, nodeId) => calls.push(['focusNode', source, nodeId]),
    selectVariable: (source, scope, name) => calls.push(['selectVariable', source, scope, name]),
    deleteVariable: (source, scope, name) => calls.push(['deleteVariable', source, scope, name]),
    showToast: (message) => calls.push(['toast', message]),
  });
  return {panel, calls, isOpen: () => open};
}

const SC = {commands: []};
const SOURCE = {frame: {id: 'canvas-frame'}, post: (command, value) => SC.commands.push([command, value])};
const DATA = {
  scope: 'inputs',
  name: '等待',
  displayName: '等待',
  entries: [
    {nodeId: 'tap', nodeName: '点击挑战按钮', param: 'timeout_seconds', ref: 'inputs.等待', label: '参数「超时」', linked: true},
    {nodeId: 'settle', nodeName: '等待结算', param: 'inputs.秒数', ref: 'inputs.等待', label: '参数「秒数」', linked: false},
    {nodeName: '', initializer: true, label: '变量由这个输入初始化'},
  ],
};

test('面板列出所有引用者，并标出哪条是画布连线', () => {
  const h = harness();
  SC.commands = [];
  h.panel.open(DATA, SOURCE);

  assert.equal(h.isOpen(), true);
  const rows = host.querySelectorAll('.variable-reference-row');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('.variable-reference-text').querySelector('strong').textContent, '点击挑战按钮');
  assert.equal(rows[0].querySelector('.variable-reference-badge').textContent, '画布连线');
  assert.equal(rows[1].querySelector('.variable-reference-badge').textContent, '参数引用');
  assert.equal(rows[2].querySelector('.variable-reference-badge').textContent, '参数引用');
  assert.equal(host.querySelector('.variable-references-heading').querySelector('small').textContent, '3 处引用 · 2 个节点');
});

test('点引用把跳转命令发回来源画布（不是当前活动画布）', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  const rowButtons = () => host.querySelectorAll('.variable-reference-row');
  rowButtons()[0].fire('click');
  rowButtons()[1].fire('click');
  // 回调收到的是打开面板时那份来源（带着它的 frame / post），跳转命令据此发回原画布。
  assert.deepEqual(h.calls, [
    ['focusNode', SOURCE, 'tap'],
    ['focusNode', SOURCE, 'settle'],
  ]);

  // 初始化输入没有节点可跳：改为选中该变量。
  rowButtons()[2].fire('click');
  assert.deepEqual(h.calls[2], ['selectVariable', SOURCE, 'inputs', '等待']);
});

test('「直接删除变量」把删除命令发回来源画布并关闭面板', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  const remove = host.querySelector('.variable-references-footer').querySelectorAll('.panel-action')
    .find((node) => node.className.includes('danger'));
  assert.equal(remove.querySelector('span').textContent, '直接删除变量');
  remove.fire('click');

  assert.deepEqual(h.calls[0], ['deleteVariable', SOURCE, 'inputs', '等待']);
  // 提示语带上了引用处数，且面板自己关掉。
  assert.match(h.calls.find(([kind]) => kind === 'toast')[1], /3 处引用/);
  assert.equal(h.isOpen(), false);
});

test('Esc 关闭面板', () => {
  const h = harness();
  SC.commands = [];
  h.panel.open(DATA, SOURCE);
  host.querySelector('.variable-references').fire('keydown');
  assert.equal(h.isOpen(), false);
});
