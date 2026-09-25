/**
 * 值卡片浮动编辑器：贴着卡片打开、按最新节点重建内容、点外面/Esc 收起。
 * 画布是纯 SVG，浮层是固定定位的 HTML；这里用最小 DOM 替身驱动真实分支。
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {harness: fieldHarness} = require('./helpers/composite-harness.cjs');

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.style = { setProperty: () => {} };
    this.events = {};
    this.attrs = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
  }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
  contains(target) { return target === this || this.children.some((child) => child === target || (typeof child.contains === 'function' && child.contains(target))); }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.events[type] = (this.events[type] || []).filter((item) => item !== fn); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  querySelector(selector) {
    const name = selector.replace(/^\./, '');
    for (const child of this.children) {
      if (String(child.className || '').split(' ').includes(name)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
  querySelectorAll() { return []; }
}

/** 按类名在整棵子树里找元素（断言用）。 */
function byClass(root, name) {
  const found = [];
  const walk = (node) => {
    if (String(node.className || '').split(' ').includes(name)) found.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return found;
}

function harness(nodes, extra = {}) {
  const body = new FakeNode('body');
  const documentListeners = {};
  const windowListeners = {};
  globalThis.document = {
    body,
    addEventListener: (type, fn) => { (documentListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { documentListeners[type] = (documentListeners[type] || []).filter((item) => item !== fn); },
  };
  globalThis.window = {
    addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { windowListeners[type] = (windowListeners[type] || []).filter((item) => item !== fn); },
  };
  const { createValueCardEditor } = require('../dist-test-renderer/canvas/interactions/value-card-editor.js');
  const fields = fieldHarness().deps;
  const mutations = [];
  const editor = createValueCardEditor({
    state: { zoom: 1, panX: 0, panY: 0 },
    wrap: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 900 }) },
    el: (tag, className, text) => { const node = new FakeNode(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; },
    mutate: (fn) => { mutations.push(1); fn(); },
    nodeById: (id) => nodes.find((node) => node.id === id) || null,
    position: (node) => node._pos || { x: 40, y: 60 },
    nodeWidth: 260,
    fields,
    renderDecorators: (target) => { const row = new FakeNode('div'); row.className = 'decorator-section'; target.appendChild(row); },
    ...extra,
  });
  return { editor, body, documentListeners, windowListeners, mutations, nodes };
}

test('布尔判断卡片进阶编辑器：嵌套条件控件 + 装饰器，点外面收起', () => {
  const nodes = [{ id: 'bool_1', type: 'bool_judge', name: '结界未结算', expression: { eq: [1, 1] } }];
  const h = harness(nodes);
  assert.equal(h.editor.open('bool_1'), true);
  assert.equal(h.editor.isOpen(), true);

  const shell = h.body.children[0];
  assert.equal(shell.className, 'value-card-editor');
  assert.equal(byClass(shell, 'value-card-editor-title')[0].textContent, '结界未结算');
  assert.equal(byClass(shell, 'value-card-editor-kind')[0].textContent, '布尔判断');
  assert.equal(byClass(shell, 'condition-control').length, 1);
  assert.equal(byClass(shell, 'field-hint')[0].textContent, '输出引用：nodes.bool_1.output.value');
  assert.equal(byClass(shell, 'decorator-section').length, 1, '装饰器跟着一起搬进浮层');
  // 定位：贴卡片（屏幕坐标），宽度固定。
  assert.match(shell.style.left, /^\d+px$/);
  assert.equal(shell.style.width, '300px');

  // 点浮层外面收起；点里面不动。
  h.documentListeners.pointerdown[0]({ target: shell.children[1] });
  assert.equal(h.editor.isOpen(), true);
  h.documentListeners.pointerdown[0]({ target: new FakeNode('div') });
  assert.equal(h.editor.isOpen(), false);
  assert.equal(shell.removed, true);
});

test('拆分卡片进阶编辑器：来源只回读，字段列表可增删，Esc 收起', () => {
  const nodes = [{ id: 'split_1', type: 'break', name: '拆分页面', ref: { ref: 'nodes.a.output' }, fields: { 位置: '0.point' } }];
  const h = harness(nodes);
  h.editor.open('split_1');
  const shell = h.body.children[0];
  assert.equal(byClass(shell, 'value-card-editor-kind')[0].textContent, '拆分');
  assert.equal(byClass(shell, 'section-header')[0].textContent, '拆分字段（1 项）');
  // UE 里结构体走节点菜单：这里只有回读提示，没有来源输入框。
  assert.equal(byClass(shell, 'field-hint')[0].textContent, '拆分来源：nodes.a.output（右键卡片可更改）');
  assert.equal(byClass(shell, 'value-card-editor-body')[0].children.filter((child) => child.tag === 'label').length, 0, '没有名称输入行');

  h.documentListeners.keydown[0]({ key: 'Escape', stopPropagation() {} });
  assert.equal(h.editor.isOpen(), false);
});

test('浮层标题跟着卡片显示名走：手动 name 优先，没设过时用类型派生标题', () => {
  const named = [{ id: 'bool_1', type: 'bool_judge', name: '结界未结算', expression: { eq: [1, 1] } }];
  const h1 = harness(named, { displayTitle: (node) => node.name || '等于' });
  h1.editor.open('bool_1');
  assert.equal(byClass(h1.body.children[0], 'value-card-editor-title')[0].textContent, '结界未结算');

  // 没设 name 的值卡片：浮层顶栏跟卡片一样显示派生标题，不是裸节点 ID。
  const unnamed = [{ id: 'break_1', type: 'break', ref: { ref: 'nodes.classify.output' } }];
  const h2 = harness(unnamed, { displayTitle: (node) => (node.type === 'break' ? 'Break 识别结果' : node.id) });
  h2.editor.open('break_1');
  const shell = h2.body.children[0];
  assert.equal(byClass(shell, 'value-card-editor-title')[0].textContent, 'Break 识别结果');
  assert.equal(byClass(shell, 'value-card-editor-kind')[0].textContent, '拆分');

  // 没有注入标题解析器时退回 `name || id`，行为与旧版一致。
  const h3 = harness([{ id: 'break_9', type: 'break', ref: { ref: 'nodes.a.output' } }]);
  h3.editor.open('break_9');
  assert.equal(byClass(h3.body.children[0], 'value-card-editor-title')[0].textContent, 'break_9');
});

test('文档改动后浮层按最新节点重建；节点被删掉时自动收起', () => {
  const nodes = [{ id: 'split_2', type: 'break', fields: { 位置: '0.point' } }];
  const h = harness(nodes);
  h.editor.open('split_2');
  const shell = h.body.children[0];
  assert.equal(byClass(shell, 'section-header')[0].textContent, '拆分字段（1 项）');

  // 直接改文档后再打开（等价于外部改动）：内容按最新状态重建。
  nodes[0].fields = { 位置: '0.point', 分数: '1.score' };
  h.editor.close();
  h.editor.open('split_2');
  const reopened = h.body.children[0];
  assert.equal(byClass(reopened, 'section-header')[0].textContent, '拆分字段（2 项）');

  // 节点消失（换文档/删除）后 refresh 自动收起，且不会对着空节点定位。
  nodes.length = 0;
  h.editor.refresh();
  assert.equal(h.editor.isOpen(), false);
  assert.equal(reopened.removed, true);
});
