// Run via npm test (builds the renderer test output first).
// 注释框模块：纯对象 fake 驱动（与 canvas-viewport 等用例同一套做法），
// 覆盖新建 / 渲染 / 命中 / 删除 / 改文字提交这几条不依赖真实 DOM 的路径。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createCanvasComments } = require('../dist-test-renderer/canvas/canvas/comments.js');

function fakeElement(tag = 'g') {
  const element = {
    tag,
    attributes: {},
    children: [],
    listeners: {},
    isConnected: true,
    firstChild: null,
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; if (!this.firstChild) this.firstChild = child; return child; },
    insertBefore(child, before) {
      const index = this.children.indexOf(before);
      this.children.splice(index < 0 ? 0 : index, 0, child);
      child.parent = this;
      if (this.firstChild === before || !this.firstChild) this.firstChild = child;
      return child;
    },
    replaceChildren() { this.children = []; this.firstChild = null; },
    remove() { this.isConnected = false; },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    fire(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); },
    querySelector(selector) { return selector === '.graph-world' ? this.world || null : null; },
  };
  return element;
}

function harness(raw) {
  const state = createCanvasState();
  state.raw = raw;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  const host = fakeElement('svg');
  const world = fakeElement('g');
  host.world = world;
  const calls = {mutated: 0, rendered: 0, dragged: []};
  const wrap = {getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300})};
  const comments = createCanvasComments({
    state,
    host,
    svgEl: (tag, attrs, parent) => {
      const element = fakeElement(tag);
      for (const [key, value] of Object.entries(attrs || {})) {
        if (value !== undefined && value !== null) element.setAttribute(key, String(value));
      }
      if (parent) parent.appendChild(element);
      return element;
    },
    el: (tag, className) => {
      const element = fakeElement(tag);
      element.className = className;
      element.appendChild = (child) => { element.input = child; return child; };
      return element;
    },
    wrap,
    mutate: (fn) => { calls.mutated += 1; fn(); },
    render: () => { calls.rendered += 1; },
    worldPoint: (event) => ({x: event.worldX || 0, y: event.worldY || 0}),
    startCommentDrag: (event, comment, mode) => calls.dragged.push({id: comment.id, mode}),
  });
  return {state, host, world, comments, calls};
}

test('注释框：新建后进文档、渲染到自己的图层、能命中与删除', () => {
  const h = harness({nodes: [], edges: []});
  h.comments.render();
  const layer = h.world.children.find((child) => child.attributes.class === 'comments');
  assert.ok(layer, '注释图层应该挂在 .graph-world 的最前面');
  assert.equal(h.world.children[0], layer, '注释框画在连线与卡片之下');

  const created = h.comments.create(1000, 640);
  assert.equal(created.id, 'comment_1');
  assert.equal(created.text, '注释');
  assert.deepEqual(created.at, {x: 1000, y: 640});
  assert.deepEqual(created.size, {w: 360, h: 200});
  assert.equal(h.state.raw.comments.length, 1);
  assert.equal(h.calls.mutated, 1, '新建必须走 mutate（一条历史）');

  assert.deepEqual(h.comments.hitTest(1100, 700), created, '框内命中');
  assert.equal(h.comments.hitTest(10, 10), null, '框外不命中');

  h.comments.rename(created.id, '结算页分支');
  assert.equal(h.state.raw.comments[0].text, '结算页分支');

  h.comments.remove(created.id);
  assert.deepEqual(h.state.raw.comments, []);
  assert.equal(h.comments.hitTest(1100, 700), null);
});

test('注释框：同一个框连点两次新建时取下一个 id，尺寸与坐标贴 8 像素网格', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}}]});
  const created = h.comments.create(1003, 647);
  assert.equal(created.id, 'comment_2');
  assert.deepEqual(created.at, {x: 1000, y: 648});
});

test('注释框：拖拽走 pointer 模块（移动 / 改尺寸两种模式）', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}, size: {w: 360, h: 200}}]});
  h.comments.render();
  const box = h.world.children[0].children[0];
  const titleBar = box.children.find((child) => child.attributes.class === 'comment-title-bar');
  const resize = box.children.find((child) => child.attributes.class === 'comment-resize');
  assert.ok(titleBar && resize, '标题栏与改尺寸把手都要画出来');

  const stop = () => {};
  // 真实 DOM 里事件从子元素冒泡到卡片组，监听器挂在组上；fake 里显式把 target 指过去。
  box.fire('pointerdown', {button: 0, preventDefault: stop, stopPropagation: stop, target: titleBar, worldX: 10, worldY: 10});
  assert.deepEqual(h.calls.dragged, [{id: 'comment_1', mode: 'move'}]);
  box.fire('pointerdown', {button: 0, preventDefault: stop, stopPropagation: stop, target: resize, worldX: 10, worldY: 10});
  assert.deepEqual(h.calls.dragged, [{id: 'comment_1', mode: 'move'}, {id: 'comment_1', mode: 'resize'}]);

  // 标题栏右侧的 × 直接删掉这个框。
  const removeButton = titleBar.children.find((child) => child.attributes.class === 'comment-remove');
  box.fire('pointerdown', {button: 0, preventDefault: stop, stopPropagation: stop, target: removeButton});
  assert.deepEqual(h.state.raw.comments, []);
});
