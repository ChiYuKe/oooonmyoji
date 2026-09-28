const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bindContentMarquee } = require('../dist-test-renderer/renderer/content-browser/marquee.js');

function emitter(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, props = {}) {
      const event = { button: 0, isPrimary: true, pointerId: 1, clientX: 5, clientY: 5, target: { closest: () => null }, preventDefault() {}, stopPropagation() {}, ...props };
      for (const fn of [...(listeners.get(type) || [])]) fn(event);
    },
  }, extra);
}

function harness(initial = []) {
  let selected = new Set(initial);
  let capture = false;
  let frame;
  const overlays = new Set();
  const win = emitter({ requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() { frame = undefined; } });
  const doc = emitter({ defaultView: win, createElement() { return { style: {}, setAttribute() {}, remove() { overlays.delete(this); } }; } });
  const container = emitter({
    ownerDocument: doc, clientLeft: 0, clientTop: 0, clientWidth: 200, clientHeight: 200, scrollTop: 0, scrollLeft: 0,
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    appendChild(element) { overlays.add(element); },
    setPointerCapture() { capture = true; }, hasPointerCapture() { return capture; }, releasePointerCapture() { capture = false; },
    querySelectorAll() { return [
      { dataset: { contentPath: 'a' }, getBoundingClientRect: () => ({ left: 20 - container.scrollLeft, top: 20 - container.scrollTop, width: 40, height: 40 }) },
      { dataset: { contentPath: 'b' }, getBoundingClientRect: () => ({ left: 80 - container.scrollLeft, top: 20 - container.scrollTop, width: 40, height: 40 }) },
      { dataset: { contentPath: 'c' }, getBoundingClientRect: () => ({ left: 20 - container.scrollLeft, top: 210 - container.scrollTop, width: 40, height: 40 }) },
    ]; },
  });
  const cancel = bindContentMarquee(container, () => selected, (paths) => { selected = paths; }, () => true);
  return { container, doc, win, cancel, overlays, selection: () => [...selected].sort(), frame: () => frame?.(), captured: () => capture };
}

test('blank-space drag selects intersecting items in either direction and releases capture', () => {
  for (const reverse of [false, true]) {
    const h = harness(['c']);
    h.container.fire('pointerdown', { clientX: reverse ? 130 : 5, clientY: reverse ? 70 : 5 });
    h.container.fire('pointermove', { clientX: reverse ? 5 : 130, clientY: reverse ? 5 : 70 });
    assert.deepEqual(h.selection(), ['a', 'b']);
    assert.equal(h.overlays.size, 1);
    h.container.fire('pointerup', { clientX: reverse ? 5 : 130, clientY: reverse ? 5 : 70 });
    assert.equal(h.overlays.size, 0);
    assert.equal(h.captured(), false);
  }
});

test('modifier drag preserves earlier selection; shrinking excludes items no longer hit', () => {
  for (const modifier of ['ctrlKey', 'shiftKey', 'metaKey']) {
    const h = harness(['c']);
    h.container.fire('pointerdown', { [modifier]: true });
    h.container.fire('pointermove', { clientX: 130, clientY: 70 });
    assert.deepEqual(h.selection(), ['a', 'b', 'c']);
    h.container.fire('pointermove', { clientX: 70, clientY: 70 });
    assert.deepEqual(h.selection(), ['a', 'c']);
    h.cancel();
    assert.deepEqual(h.selection(), ['c']);
  }
});

test('Escape, blur, pointer cancellation and rerender cancel restore original selection', () => {
  for (const cancel of [h => h.doc.fire('keydown', { key: 'Escape' }), h => h.win.fire('blur'), h => h.container.fire('pointercancel'), h => h.cancel()]) {
    const h = harness(['c']);
    h.container.fire('pointerdown');
    h.container.fire('pointermove', { clientX: 130, clientY: 70 });
    cancel(h);
    assert.deepEqual(h.selection(), ['c']);
    assert.equal(h.overlays.size, 0);
    h.frame();
    assert.deepEqual(h.selection(), ['c']);
  }
});

test('scroll offsets and edge autoscroll are included in hit testing', () => {
  const h = harness();
  h.container.scrollTop = 150;
  h.container.fire('pointerdown');
  h.container.fire('pointermove', { clientX: 70, clientY: 110 });
  assert.deepEqual(h.selection(), ['c']);
  h.container.fire('pointermove', { clientX: 70, clientY: 199 });
  h.frame();
  assert.ok(h.container.scrollTop > 150);
  assert.deepEqual(h.selection(), ['c']);
  h.cancel();
});

test('item drags, right button and scrollbar do not start marquee; blank click clears selection', () => {
  const h = harness(['a']);
  for (const props of [{ target: { closest: () => ({}) } }, { button: 2 }, { clientX: 201 }]) {
    h.container.fire('pointerdown', props);
    assert.equal(h.captured(), false);
    assert.deepEqual(h.selection(), ['a']);
  }
  h.container.fire('pointerdown');
  h.container.fire('pointerup');
  assert.deepEqual(h.selection(), []);
});
