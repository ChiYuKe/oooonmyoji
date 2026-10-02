const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installTeamBuilderResizer } = require('../dist-test-renderer/renderer/team-builder-layout.js');

function harness(stored = null) {
  const events = new Map(), classes = new Set(), attributes = {}, captures = new Set(), writes = [];
  let total = 1000, applied, resize, disconnected = false;
  const container = {
    getBoundingClientRect: () => ({ width: total }),
    style: { setProperty: (_, value) => { applied = parseFloat(value); } },
  };
  const handle = {
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    setAttribute: (key, value) => { attributes[key] = value; },
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: (name, listener) => { if (events.get(name) === listener) events.delete(name); },
  };
  const previousObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe() {} disconnect() { disconnected = true; }
  };
  const dispose = installTeamBuilderResizer(container, handle, { readLayout: () => stored, writeLayout: (key, value) => writes.push([key, value]) });
  global.ResizeObserver = previousObserver;
  return {
    fire: (name, extra = {}) => events.get(name)?.({ button: 0, pointerId: 1, clientX: 0, preventDefault() {}, stopPropagation() {}, ...extra }),
    resize: value => { total = value; resize(); }, dispose,
    get width() { return applied; }, get disconnected() { return disconnected; },
    writes, classes, captures, attributes, events,
  };
}

test('dragging the divider changes width, ignores other pointers and saves once on release', () => {
  const h = harness();
  assert.equal(h.width, 150);
  h.fire('pointerdown', { button: 2 }); assert.equal(h.captures.size, 0);
  h.fire('pointerdown', { clientX: 150 }); assert(h.captures.has(1));
  h.fire('pointermove', { pointerId: 2, clientX: 400 }); assert.equal(h.width, 150);
  h.fire('pointermove', { clientX: 400 }); assert.equal(h.width, 400);
  assert.equal(h.writes.length, 0);
  h.fire('pointerup'); h.fire('lostpointercapture');
  assert.equal(h.captures.size, 0); assert.equal(h.classes.size, 0);
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0][1], '400');
  h.dispose();
});

test('hidden and smaller panels retain the preferred width for reopening or docking elsewhere', () => {
  const h = harness('400');
  h.resize(0); assert.equal(h.width, 400);
  h.resize(320); assert.equal(h.width, 155);
  assert.equal(h.attributes['aria-valuemax'], '155');
  h.resize(1000); assert.equal(h.width, 400);
  h.fire('pointerdown', { clientX: 400 });
  h.fire('pointermove', { clientX: -1000 }); assert.equal(h.width, 120);
  h.fire('pointermove', { clientX: 5000 }); assert.equal(h.width, 835);
  h.fire('pointercancel'); assert.equal(h.captures.size, 0);
  h.dispose();
});

test('keyboard resizing and reset work; disposal releases an unfinished drag', () => {
  const h = harness('broken');
  assert.equal(h.width, 150);
  h.fire('keydown', { key: 'ArrowRight' }); assert.equal(h.width, 166);
  h.fire('keydown', { key: 'ArrowLeft', shiftKey: true }); assert.equal(h.width, 134);
  h.fire('dblclick'); assert.equal(h.width, 150); assert.equal(h.writes.at(-1)[1], null);
  h.resize(2000); assert.equal(h.width, 300);
  h.fire('pointerdown'); h.dispose();
  assert.equal(h.events.size, 0); assert.equal(h.captures.size, 0); assert(h.disconnected);
});
