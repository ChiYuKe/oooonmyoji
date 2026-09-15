const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public/shared/tooltip.js'), 'utf8');

/** 最小 DOM 桩：只覆盖 shared/tooltip.js 实际用到的接口。 */
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.attrs = {};
    this.dataset = {};
    this.children = [];
    this.style = {};
    this.offsetWidth = 120;
    this.offsetHeight = 24;
    this.textContent = '';
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }

  set className(value) {
    this.attrs.class = String(value);
    String(value).split(' ').filter(Boolean).forEach((item) => this.classList.add(item));
  }

  get className() {
    return this.attrs.class || '';
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === 'class') this.className = value;
  }

  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren() {
    this.children = [];
  }

  insertBefore(child) {
    this.children.unshift(child);
  }

  remove() {}

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  closest(selector) {
    const attribute = selector.slice(1, -1);
    return attribute in this.attrs ? this : null;
  }

  getBoundingClientRect() {
    return {left: 10, top: 20, right: 60, bottom: 40, width: 50, height: 20};
  }
}

function harness(installOptions) {
  const body = new FakeElement('body');
  const docListeners = {};
  const doc = {
    body,
    createElement: (tag) => new FakeElement(tag),
    querySelectorAll: () => [],
    addEventListener: (type, listener) => {
      docListeners[type] = listener;
    },
  };
  const windowListeners = {};
  const win = {
    parent: {postMessage: () => {}},
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener: (type, listener) => {
      windowListeners[type] = listener;
    },
  };
  const ctx = vm.createContext({
    window: win,
    document: doc,
    Element: FakeElement,
    Node: FakeElement,
    MutationObserver: class {
      observe() {}
    },
  });
  vm.runInContext(source, ctx);
  const handle = win.StudioTooltip.install(installOptions);
  return {win, doc, body, docListeners, windowListeners, handle};
}

test('嵌入模式下把提示转发给父窗口，并在移出时发送 hide', () => {
  const h = harness({bridge: 'send', embedded: 'embedded'});
  const sent = [];
  h.win.parent.postMessage = (message) => sent.push(message);
  const target = new FakeElement('button');
  target.setAttribute('data-tooltip', '开始运行');

  h.docListeners.mouseover({target});

  assert.equal(sent.length, 1);
  assert.equal(sent[0].source, 'onmyoji-tooltip');
  assert.equal(sent[0].type, 'show');
  assert.equal(sent[0].text, '开始运行');
  assert.deepEqual({...sent[0].rect}, {left: 10, top: 20, right: 60, bottom: 40, width: 50, height: 20});

  h.docListeners.mouseover({target: h.body});
  assert.equal(sent.at(-1).type, 'hide');
});

test('宿主模式接收子页面消息并渲染文本 tooltip', () => {
  const frame = new FakeElement('iframe');
  const frameWindow = {};
  frame.contentWindow = frameWindow;
  const h = harness({bridge: 'receive', embedded: 'host', receiverFrames: () => [frame]});

  h.windowListeners.message({
    data: {
      source: 'onmyoji-tooltip',
      type: 'show',
      text: '节点说明',
      rect: {left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2},
    },
    source: frameWindow,
  });

  const node = h.body.children.find((child) => child.classList.contains('app-tooltip'));
  assert.ok(node, '应创建 .app-tooltip 节点');
  assert.equal(node.textContent, '节点说明');
  assert.equal(node.classList.contains('hidden'), false);
});
