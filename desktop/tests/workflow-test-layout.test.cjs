const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installTestResizer } = require('../dist-test-renderer/renderer/tools/workflow-test/layout.js');

function fixture() {
  const listeners = new Map();
  const handle = {
    attributes: {}, classes: new Set(), captures: new Set(),
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setAttribute(key, value) { this.attributes[key] = value; },
    setPointerCapture(id) { this.captures.add(id); },
    hasPointerCapture(id) { return this.captures.has(id); },
    releasePointerCapture(id) { this.captures.delete(id); },
  };
  handle.classList = { add: key => handle.classes.add(key), remove: key => handle.classes.delete(key) };
  let resize, available = 1200;
  const properties = {};
  const container = {
    ownerDocument: { defaultView: { addEventListener: (_, fn) => resize = fn, removeEventListener: () => resize = undefined } },
    getBoundingClientRect: () => ({ width: available }), style: { setProperty: (key, value) => properties[key] = value },
  };
  return { handle, container, properties, listeners,
    fire: (type, event) => listeners.get(type)?.({preventDefault() {}, ...event}),
    shrink: width => { available = width; resize?.(); },
  };
}

test('workspace splitter clamps drag and resize so node results remain visible', () => {
  const f = fixture();
  const dispose = installTestResizer(f.handle, f.container, '--width', 340, 280, 600);
  f.fire('pointerdown', {button: 0, pointerId: 7, clientX: 340});
  f.fire('pointermove', {pointerId: 9, clientX: 900});
  assert.equal(f.properties['--width'], '340px', 'unrelated pointer is ignored');
  f.fire('pointermove', {pointerId: 7, clientX: 950});
  assert.equal(f.properties['--width'], '600px');
  f.shrink(820);
  assert.equal(f.properties['--width'], '460px');
  assert.equal(f.handle.attributes['aria-valuemax'], '460');
  f.fire('pointercancel', {pointerId: 7});
  assert.equal(f.handle.classes.has('dragging'), false);
  assert.equal(f.handle.captures.size, 0);
  f.fire('pointermove', {pointerId: 7, clientX: 0});
  assert.equal(f.properties['--width'], '460px');
  dispose();
  assert.equal(f.listeners.size, 0);
});

test('splitters support keyboard adjustment and restoring their default width', () => {
  const f = fixture();
  installTestResizer(f.handle, f.container, '--width', 210, 150, 340);
  f.fire('keydown', {key:'ArrowRight'});
  assert.equal(f.properties['--width'], '226px');
  for (let i = 0; i < 20; i++) f.fire('keydown', {key:'ArrowLeft'});
  assert.equal(f.properties['--width'], '150px');
  f.fire('keydown', {key:'Home'});
  assert.equal(f.properties['--width'], '210px');
});
