// Run via npm test (builds the renderer test output first).
// 子工作流选择弹层：详情栏是窄 iframe，弹层必须移植到顶层文档的 <dialog> + shadow root，
// 不然会被挤在详情栏里（素材浏览器就是这么做的）。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createWorkflowBrowser} = require('../dist-test-renderer/canvas/interactions/workflow-browser.js');

class FakeElement {
  constructor(tag, owner) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = owner;
    this.children = [];
    this.dataset = {};
    this.events = {};
    this.style = {
      values: {},
      setProperty: (name, value) => { this.style.values[name] = value; },
      getPropertyValue: (name) => this.style.values[name] ?? '',
      set cssText(value) { this._cssText = value; },
      get cssText() { return this._cssText ?? ''; },
    };
    this.shadowRoot = null;
    this.open = false;
    this.isConnected = true;
  }
  /** classList 直接读写 className，测试里断言的是真实类名。 */
  get classList() {
    const names = () => String(this.className ?? '').split(/\s+/).filter(Boolean);
    return {
      add: (...list) => { this.className = [...new Set([...names(), ...list])].join(' '); },
      remove: (...list) => { this.className = names().filter((name) => !list.includes(name)).join(' '); },
      contains: (name) => names().includes(name),
      toggle: (name, force) => {
        const want = force === undefined ? !names().includes(name) : Boolean(force);
        if (want) this.classList.add(name); else this.classList.remove(name);
      },
    };
  }
  setAttribute(name, value) { this.attrs = { ...(this.attrs ?? {}), [name]: value }; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  remove() {
    const parent = this.parentNode;
    if (parent?.children) parent.children = parent.children.filter((child) => child !== this);
    this.removed = true;
    this.isConnected = false;
    this.parentNode = null;
  }
  attachShadow() { this.shadowRoot = new FakeElement('#shadow-root', this.ownerDocument); return this.shadowRoot; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const byClass = selector.startsWith('.');
    const wanted = byClass ? selector.slice(1) : selector.toUpperCase();
    const found = [];
    const walk = (node) => {
      for (const child of node.children ?? []) {
        const matched = byClass
          ? String(child.className ?? '').split(' ').includes(wanted)
          : child.tagName === wanted;
        if (matched) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  set className(value) { this._className = value; }
  get className() { return this._className ?? ''; }
  set innerHTML(_value) { this.children = []; }
  fire(name, extra = {}) { for (const fn of this.events[name] ?? []) fn({preventDefault() {}, stopPropagation() {}, ...extra}); }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  focus() { this.focused = true; }
}

function makeDocument(label) {
  const doc = {
    label,
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    activeElement: null,
    baseURI: 'http://localhost/canvas.html',
    createElement: (tag) => new FakeElement(tag, doc),
  };
  return doc;
}

function makeHarness(options = {}) {
  const canvasDocument = makeDocument('canvas');
  const topDocument = makeDocument('top');
  const overlay = new FakeElement('div', canvasDocument);
  overlay.className = 'overlay hidden';
  const originalParent = new FakeElement('section', canvasDocument);
  originalParent.appendChild(overlay);
  const events = [];
  global.document = canvasDocument;
  global.window = {top: options.standalone ? undefined : {document: topDocument}};
  global.getComputedStyle = (element) => ({getPropertyValue: (name) => `computed(${name})`});
  // el() 模拟画布文档上的创建助手。
  const el = (tag, className, text) => {
    const node = canvasDocument.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const node = {id: 'task_1', action: 'workflow.run', params: {workflow: ''}};
  const refreshes = [];
  const state = {
      docUri: 'file:///w/current.json',
      workflows: options.workflows ?? [
        {uri: 'file:///w/current.json', name: 'current.json', rel: 'workflows/current.json'},
        {uri: 'file:///w/other.json', name: 'other.json', rel: 'workflows/other.json', description: '另一个脚本'},
      ],
  };
  const browser = createWorkflowBrowser({
    state,
    $: (id) => (id === 'workflow-browser' ? overlay : new FakeElement('div', canvasDocument)),
    el,
    nodeById: (id) => (id === node.id ? node : undefined),
    mutate: (fn) => fn(),
    toast: (message, error) => events.push(['toast', message, Boolean(error)]),
    requestWorkflows: () => refreshes.push('requested'),
  });
  return {browser, overlay, originalParent, canvasDocument, topDocument, node, state, events, refreshes};
}

test('弹层移植到顶层文档的 dialog + shadow root，不再挤在详情栏里', () => {
  const h = makeHarness();

  h.browser.openWorkflowBrowser('task_1', 'workflow', '');

  assert.equal(h.overlay.classList.contains('hidden'), false);
  const host = h.topDocument.body.children[0];
  assert(host, 'dialog 要挂到顶层文档');
  assert.equal(host.tagName, 'DIALOG');
  assert.equal(host.open, true, '以模态方式打开');
  const shadow = host.children[0].shadowRoot;
  assert(shadow, '内容放在 shadow root 里');
  const links = shadow.children.filter((child) => child.tagName === 'LINK').map((child) => child.href);
  assert.deepEqual(links, [
    'http://localhost/legacy/workflow-editor.css',
    'http://localhost/legacy/workflow-browser.css',
  ], '基础样式 + 弹层专用样式都要带过去');
  assert.equal(shadow.children.at(-1), h.overlay, '弹层本体在 shadow root 里');
  assert.equal(h.overlay.parentNode, shadow);
  assert.equal(host.style.values['--panel'], 'computed(--panel)', '主题变量同步到 dialog 上（shadow 里继承不到 :root）');
  assert(h.overlay.querySelector('.workflow-browser-dialog'), '要渲染出对话框');

  // 关闭：弹层回到原来的父节点、dialog 移除、节点值不变。
  h.browser.closeWorkflowBrowser();
  assert.equal(h.overlay.parentNode, h.originalParent);
  assert.equal(h.overlay.classList.contains('hidden'), true);
  assert.equal(host.removed, true);
  assert.equal(h.topDocument.body.children.length, 0);
});

test('选择脚本后写回节点参数并关闭弹层', () => {
  const h = makeHarness();
  h.browser.openWorkflowBrowser('task_1', 'workflow', '');

  // 打开时向壳层要一次最新目录。
  assert.deepEqual(h.refreshes, ['requested']);

  // 当前文档也在列表里（否则子文件夹里的脚本会显得「没显示出来」），标成当前脚本且不能选。
  const items = h.overlay.querySelectorAll('.workflow-file');
  assert.equal(items.length, 2);
  const current = items.find((item) => item.dataset.reference === 'current.json');
  assert(current, '当前脚本要显示出来');
  assert.equal(current.classList.contains('current'), true);
  assert(current.querySelector('.workflow-file-current').textContent, '当前脚本');
  const confirm = h.overlay.querySelectorAll('button').find((button) => button.textContent === '选择');
  assert.equal(confirm.disabled, true, '没选之前不能确认');

  // 选当前脚本：给提示，不写回、不关闭。
  current.fire('click');
  confirm.fire('click');
  assert.deepEqual(h.events.at(-1), ['toast', '当前工作流不能作为自己的子工作流', true]);
  assert.equal(h.node.params.workflow, '');
  assert.equal(h.overlay.classList.contains('hidden'), false);

  // 选别的脚本：照常写回。
  const other = items.find((item) => item.dataset.reference === 'other.json');
  assert(other);
  other.fire('click');
  assert.equal(h.overlay.querySelector('.workflow-selected-path').textContent, 'other.json');
  assert.equal(confirm.disabled, false);

  confirm.fire('click');
  assert.equal(h.node.params.workflow, 'other.json');
  assert.deepEqual(h.events.at(-1), ['toast', '已选择子工作流', false]);
  assert.equal(h.overlay.classList.contains('hidden'), true);
  assert.equal(h.topDocument.body.children.length, 0, '选择后 dialog 也要收掉');
});

test('工作流变量可通过回调复用同一个浏览器', () => {
  const h = makeHarness();
  const selected = [];
  h.browser.openWorkflowBrowser('', 'flow', '', (reference) => selected.push(reference));
  const other = h.overlay.querySelectorAll('.workflow-file').find((item) => item.dataset.reference === 'other.json');
  other.events.dblclick[0]();
  assert.deepEqual(selected, ['other.json']);
  assert.equal(h.state.workflowBrowser, null);
  assert.deepEqual(h.events.at(-1), ['toast', '已选择工作流', false]);
});

test('子文件夹里的脚本按文件夹分组，不会被漏掉', () => {
  const h = makeHarness({workflows: [
    {uri: 'file:///w/current.json', name: 'current.json', rel: 'workflows/current.json'},
    {uri: 'file:///w/deep.json', name: 'deep.json', rel: 'workflows/entrypoints/deep.json', description: '嵌套脚本'},
  ]});
  h.browser.openWorkflowBrowser('task_1', 'workflow', '');

  const folders = h.overlay.querySelectorAll('.workflow-folder');
  assert.deepEqual(folders.map((button) => button.children[0].textContent), ['全部脚本', 'entrypoints']);
  assert.deepEqual(folders.map((button) => button.children[1].textContent), ['2', '1']);

  // 切到子文件夹：只剩嵌套脚本。
  folders[1].fire('click');
  const visible = h.overlay.querySelectorAll('.workflow-file').map((item) => item.dataset.reference);
  assert.deepEqual(visible, ['entrypoints/deep.json']);
});

test('没有顶层文档（独立画布页）时回退到本文档，不影响功能', () => {
  const h = makeHarness({standalone: true});

  h.browser.openWorkflowBrowser('task_1', 'workflow', '');

  const host = h.canvasDocument.body.children[0];
  assert.equal(host.tagName, 'DIALOG');
  assert.equal(host.open, true);
  assert.equal(host.children[0].shadowRoot.children.at(-1), h.overlay);
  h.browser.closeWorkflowBrowser();
  assert.equal(h.overlay.parentNode, h.originalParent);
});
