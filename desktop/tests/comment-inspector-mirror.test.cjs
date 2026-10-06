// Run via npm test (builds the renderer test output first).
//
// 注释框的「详细信息」面板其实在壳层的**镜像画布**里（`canvas.html?mode=details`）：
// 文档画布自己的 `#inspector` 在 `desktop-canvas-mode` 下是 display:none。
// 所以选中注释必须像节点一样投影出去：currentInspectorSelection → inspectorRequested
// → 壳层转发 setInspectorSelection → 镜像渲染注释面板。这里把这条链子的每一环钉住。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createEditorStatus } = require('../dist-test-renderer/canvas/state/editor-status.js');
const { createCanvasComments } = require('../dist-test-renderer/canvas/canvas/comments.js');

function fakeElement(tag = 'div') {
  const element = {
    tag, className: '', textContent: '', attributes: {}, children: [], style: {}, listeners: {},
    isConnected: true, firstChild: null,
    classList: { _s: new Set(), add(...n) { n.forEach((x) => this._s.add(x)); }, remove(...n) { n.forEach((x) => this._s.delete(x)); }, toggle() {}, contains(n) { return this._s.has(n); } },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; if (!this.firstChild) this.firstChild = child; return child; },
    insertBefore(child) { this.children.unshift(child); this.firstChild = child; return child; },
    replaceChildren() { this.children = []; this.firstChild = null; },
    remove() { this.isConnected = false; },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    fire(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); },
    querySelector(selector) { return selector === '.graph-world' ? this.world || null : null; },
  };
  return element;
}

/** 造一个「文档画布」：状态 + 注释模块 + 与 editor.ts 同形的状态投影。 */
function harness(comments) {
  const state = createCanvasState();
  state.raw = {
    schema_version: 4, id: 'demo', version: '4.0.0', resolution: [1920, 1080], root: 'root',
    nodes: [{ id: 'root', type: 'root', children: [] }],
    edges: [], inputs: {}, variables: {}, comments, _layout: { root: { x: 0, y: 0 } },
  };
  const host = fakeElement('svg');
  host.world = fakeElement('g');
  const posted = [];
  const status = createEditorStatus({ state, vscode: { postMessage: (message) => posted.push(message), setState() {} }, $: () => fakeElement() });
  const canvasComments = createCanvasComments({
    state, host,
    svgEl: (tag, attrs, parent) => {
      const element = fakeElement(tag);
      for (const [key, value] of Object.entries(attrs || {})) if (value != null) element.setAttribute(key, String(value));
      if (parent) parent.appendChild(element);
      return element;
    },
    el: (tag, className) => { const element = fakeElement(tag); element.className = className || ''; element.style = {}; return element; },
    wrap: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }), appendChild() {} },
    mutate: (fn) => fn(),
    render: () => {},
    worldPoint: () => ({ x: 0, y: 0 }),
    requestInspector: () => status.requestInspector(),
  });
  canvasComments.render();
  return { state, canvasComments, posted, status };
}

test('注释框选中：投影给详情栏镜像的选区是 {kind:comment, commentId}', () => {
  const h = harness([{ id: 'comment_1', text: '结算页分支', at: { x: 0, y: 0 } }]);
  h.canvasComments.setSelected('comment_1');
  const last = h.posted.at(-1);
  assert.deepEqual(last, { type: 'inspectorRequested', inspectorSelection: { kind: 'comment', commentId: 'comment_1' } },
    '选中注释必须 postMessage 出去，否则镜像面板一直停在「选择一个节点」');
  assert.equal(h.state.inspector, 'comment');
});

test('注释框删除：面板退回空态（投影 none），不留一条不存在的注释', () => {
  const h = harness([{ id: 'comment_1', text: '结算页分支', at: { x: 0, y: 0 } }]);
  h.canvasComments.setSelected('comment_1');
  h.posted.length = 0;
  h.canvasComments.remove('comment_1');
  assert.deepEqual(h.posted.at(-1), { type: 'inspectorRequested', inspectorSelection: { kind: 'none' } });
  assert.equal(h.state.inspector, 'node');
  assert.equal(h.state.selectedCommentId, '');
});

test('详情栏镜像：setInspectorSelection(kind=comment) 让镜像渲染注释档', () => {
  // 镜像侧走的是同一条 editorCommand（见 editor-host 转发 + editor-command-dispatch 分派）。
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/state/editor-command-dispatch.ts'), 'utf8');
  assert.match(source, /selection\.kind === 'comment'/, '镜像要认得 comment 这一档');
  assert.match(source, /state\.selectedCommentId = String\(selection\.commentId \|\| ''\)/);
  const status = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/state/editor-status.ts'), 'utf8');
  assert.match(status, /kind: 'comment', commentId: state\.selectedCommentId/, '画布侧要投影出 comment 选区');
  // 壳层把 inspectorRequested 转发给 detailsFrame（镜像 iframe）：这条链路不能被改掉。
  const host = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app/editor-host.ts'), 'utf8');
  assert.match(host, /case 'inspectorRequested'/, '壳层要处理 inspectorRequested');
  assert.match(host, /postToFrame\(detailsFrame, \{ type: 'editorCommand', command: 'setInspectorSelection'/, '要转发给详细信息镜像');
  // 可见的面板是镜像 iframe：文档画布自己的 #inspector 是隐藏的（这正是之前看不到面板的原因）。
  const frameCss = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/editor-frame.css'), 'utf8');
  assert.match(frameCss, /\.desktop-canvas-mode #inspector \{ display: none !important; \}/, '画布档隐藏自带面板');
  assert.match(frameCss, /\.desktop-details-mode #inspector \{/, '镜像档才显示面板');
});

test('整份替换：选中的注释没了就把面板退回节点档', () => {
  const h = harness([{ id: 'comment_1', text: 'x', at: { x: 0, y: 0 } }]);
  h.canvasComments.setSelected('comment_1');
  const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
  const history = createEditorHistory({
    state: h.state, cleanupReleased: () => [], clearVariableCardSelection() {}, nodeById: () => null,
    setDirty() {}, render() {},
  });
  const next = JSON.parse(JSON.stringify(h.state.raw));
  next.comments = [];
  history.replaceDocument(JSON.stringify(next));
  assert.equal(h.state.inspector, 'node', '注释没了就不该继续显示注释面板');
  assert.equal(h.state.selectedCommentId, '');
});

test('镜像编辑回推的是 .owf 文本：replaceDocument 必须认得它（否则面板里改了没反应）', () => {
  // 壳层把镜像的 documentStateChanged 正文原样 postToFrame(documentFrame, {type:'replaceDocument', text})，
  // 而那份正文是 emitRuntimeDocument 产出的 .owf 文本（state/document-text.ts）。
  // 以前 replaceDocument 只 JSON.parse，于是这些改动在真画布这一步被静默丢掉。
  const { emitRuntimeDocument } = require('../dist-test-renderer/shared/workflow/graph-dsl.js');
  const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
  const h = harness([{ id: 'comment_1', text: '结算页分支', at: { x: 40, y: 40 }, size: { w: 300, h: 220 } }]);
  const history = createEditorHistory({
    state: h.state, cleanupReleased: () => [], clearVariableCardSelection() {}, nodeById: () => null,
    setDirty() {}, render() {},
  });
  const edited = JSON.parse(JSON.stringify(h.state.raw));
  edited.comments[0].fontSize = 24;
  edited.comments[0].tint = '#c0564f';
  const text = emitRuntimeDocument(edited);
  assert.match(text, /comment comment_1/, `正文应该是 .owf 文本：${text.slice(0, 40)}`);

  history.replaceDocument(text, true);
  const applied = h.state.raw.comments[0];
  assert.equal(applied.fontSize, 24, '字号要能从镜像正文里落回真画布');
  assert.equal(applied.tint, '#c0564f', '自定义颜色同理');
  assert.equal(h.state.undo.length, 1, '回推算一条可撤销记录');
});
