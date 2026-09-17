const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstancePicker } = require('../dist-test-renderer/renderer/instance-picker.js');

class ElementStub {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.hidden = true;
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((child) => child !== node);
      node.parentElement = this;
      this.children.push(node);
    }
  }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  fire(name, event = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener({ target: this, stopPropagation() {}, preventDefault() {}, ...event });
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  querySelectorAll(selector) { return selector === '[data-instance-id]' ? this.children : []; }
  querySelector(selector) {
    const id = selector.match(/data-instance-id="([^"]*)"/)?.[1];
    return this.children.find((child) => child.dataset.instanceId === id) ?? null;
  }
  getBoundingClientRect() { return { left: 12, right: 112, bottom: 40, width: 100 }; }
  focus() { this.focused = true; }
}

test('instance picker renders selection, moves its popup, and restores focus on Escape', () => {
  const oldGlobals = { document: global.document, window: global.window, CSS: global.CSS };
  const body = new ElementStub();
  const doc = new ElementStub();
  doc.body = body;
  doc.createElement = () => new ElementStub();
  global.document = doc;
  global.window = Object.assign(new ElementStub(), { innerWidth: 500 });
  global.CSS = { escape: (value) => value };
  try {
    const picker = new ElementStub();
    const trigger = new ElementStub();
    const triggerLabel = new ElementStub();
    const menu = new ElementStub();
    picker.append(menu);
    const selected = [];
    const controller = createInstancePicker({ picker, trigger, triggerLabel, menu }, (id) => selected.push(id));
    const instances = [
      { id: 'one', displayName: '主实例' },
      { id: 'two', backend: 'mumu', mumuIndex: 2 },
    ];
    controller.render(instances, 'two');
    controller.install(() => 'two');
    assert.equal(triggerLabel.textContent, 'MuMu 2');
    assert.equal(menu.children[1].attributes['aria-selected'], 'true');

    trigger.fire('click');
    assert.equal(menu.parentElement, body);
    assert.equal(menu.hidden, false);
    assert.equal(menu.children[1].focused, true);
    menu.children[0].fire('click');
    assert.deepEqual(selected, ['one']);

    trigger.fire('keydown', { key: 'Escape' });
    assert.equal(menu.hidden, true);
    assert.equal(trigger.focused, true);
  } finally {
    Object.assign(global, oldGlobals);
  }
});
