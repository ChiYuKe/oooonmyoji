// Run via npm test (builds the renderer test output first).
// 阶段 5：布局与导航命令分派 —— 自动排列范围、锁定位置、画布前进/后退、按状态/类型临时隐藏。
// 这里直接跑生产分派实现，断言「命令 → 依赖调用」这一层接线。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dispatchModule = () => require('../dist-test-renderer/canvas/state/editor-command-dispatch.js');

function dispatchWith(overrides = {}) {
  const calls = [];
  const dispatch = dispatchModule().createEditorCommandDispatch({
    state: {selected: new Set(), raw: {}, filterStatus: null, filterTypes: null},
    mutate: (fn) => fn(),
    nodes: () => [],
    nodeById: () => undefined,
    undo: () => {}, redo: () => {}, fitView: () => {}, autoLayout: () => {},
    copySelection: () => {}, cutSelection: () => {}, pasteClipboard: () => {}, deleteSelection: () => {},
    addNode: () => {}, render: () => {}, focusNode: () => {}, searchNodeByName: () => {},
    exportFullCanvasImage: () => {}, addVariable: () => {}, deleteVariable: () => {},
    showVariableReferences: () => {}, disconnectVariableReference: () => {},
    disconnectAllVariableReferences: () => {}, clearVariableCardSelection: () => {},
    deleteCurrentSelection: () => {}, renderInspector: () => {}, requestInspectorRename: () => {},
    renameVariable: () => {}, confirmPendingRename: () => {}, cancelPendingRename: () => {},
    addVariableCardCommand: () => {}, VariableSystem: {}, convertInputToVariable: () => {},
    previewArrange: (scope) => calls.push(['previewArrange', scope]),
    confirmArrangePreview: () => calls.push(['confirmArrangePreview']),
    cancelArrangePreview: () => calls.push(['cancelArrangePreview']),
    toggleNodeLock: (id) => calls.push(['toggleNodeLock', id]),
    viewportBack: () => { calls.push(['viewportBack']); return true; },
    viewportForward: () => { calls.push(['viewportForward']); return true; },
    toggleNodeFilter: (kind, value) => calls.push(['toggleNodeFilter', kind, value]),
    clearNodeFilter: () => calls.push(['clearNodeFilter']),
    ...overrides,
  });
  return {dispatch, calls};
}

test('自动排列范围命令：全部/选中/当前组各自分派，未知范围回落到全部', () => {
  const {dispatch, calls} = dispatchWith();
  dispatch.executeEditorCommand('previewArrange', 'all');
  dispatch.executeEditorCommand('previewArrange', 'selected');
  dispatch.executeEditorCommand('previewArrange', 'group');
  dispatch.executeEditorCommand('previewArrange', 'nonsense');
  dispatch.executeEditorCommand('previewArrange');
  assert.deepEqual(calls, [
    ['previewArrange', 'all'],
    ['previewArrange', 'selected'],
    ['previewArrange', 'group'],
    ['previewArrange', 'all'],
    ['previewArrange', 'all'],
  ]);
});

test('排列预览的确认与取消分别转发', () => {
  const {dispatch, calls} = dispatchWith();
  dispatch.executeEditorCommand('confirmArrangePreview');
  dispatch.executeEditorCommand('cancelArrangePreview');
  assert.deepEqual(calls, [['confirmArrangePreview'], ['cancelArrangePreview']]);
});

test('锁定位置命令：支持 {nodeId} 载荷与裸 id', () => {
  const {dispatch, calls} = dispatchWith();
  dispatch.executeEditorCommand('toggleNodeLock', {nodeId: 'a'});
  dispatch.executeEditorCommand('toggleNodeLock', 'b');
  assert.deepEqual(calls, [['toggleNodeLock', 'a'], ['toggleNodeLock', 'b']]);
});

test('画布前进/后退命令转发到视口历史', () => {
  const {dispatch, calls} = dispatchWith();
  dispatch.executeEditorCommand('viewportBack');
  dispatch.executeEditorCommand('viewportForward');
  assert.deepEqual(calls, [['viewportBack'], ['viewportForward']]);
});

test('按状态/类型临时隐藏命令：kind 归一、空值不动作，清除单独一条', () => {
  const {dispatch, calls} = dispatchWith();
  dispatch.executeEditorCommand('toggleNodeFilter', {kind: 'status', value: 'failed'});
  dispatch.executeEditorCommand('toggleNodeFilter', {kind: 'type', value: 'task'});
  dispatch.executeEditorCommand('toggleNodeFilter', {kind: 'weird', value: 'running'});
  dispatch.executeEditorCommand('toggleNodeFilter', {kind: 'status', value: ''});
  dispatch.executeEditorCommand('clearNodeFilter');
  assert.deepEqual(calls, [
    ['toggleNodeFilter', 'status', 'failed'],
    ['toggleNodeFilter', 'type', 'task'],
    ['toggleNodeFilter', 'status', 'running'],
    ['clearNodeFilter'],
  ]);
});

test('画布入口把阶段 5 的命令都接上真实实现', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/editor.ts'), 'utf8');
  assert.match(editor, /previewArrange: \(scope\) => previewAutoLayout\(scope\)/);
  assert.match(editor, /confirmArrangePreview: \(\) => confirmArrangePreview\(\)/);
  assert.match(editor, /cancelArrangePreview: \(\) => cancelArrangePreview\(\)/);
  assert.match(editor, /toggleNodeLock: \(id\) => toggleNodeLockCommand\(id\)/);
  assert.match(editor, /viewportBack: \(\) => viewportBack\(\)/);
  assert.match(editor, /viewportForward: \(\) => viewportForward\(\)/);
  assert.match(editor, /toggleNodeFilter: \(kind, value\) => toggleNodeFilterValue\(kind, value\)/);
  assert.match(editor, /clearNodeFilter: \(\) => clearNodeFilter\(\)/);
  // 预览确认必须包一次 mutate（一次排列 = 一条历史）。
  assert.match(editor, /mutate\(\(\) => applyLayoutPositions\(positions\)\)/);
});

test('画布工具条与预览条：按钮、提示与样式都在', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/canvas.html'), 'utf8');
  for (const id of ['btn-viewport-back', 'btn-viewport-forward', 'btn-arrange', 'btn-filter', 'arrange-preview-bar', 'btn-arrange-apply', 'btn-arrange-cancel']) {
    assert.match(html, new RegExp(`id="${id}"`), `画布页面要有 #${id}`);
  }
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/editor.ts'), 'utf8');
  assert.match(editor, /function bindViewportTools\(\)/);
  assert.match(editor, /排列全部（预览）/);
  assert.match(editor, /排列选中（预览）/);
  assert.match(editor, /排列当前组（预览）/);
  assert.match(editor, /按状态隐藏/);
  assert.match(editor, /按类型隐藏/);
  assert.match(editor, /清除全部隐藏/);
  assert.match(editor, /updateArrangePreviewBar\(\)/);
  assert.match(editor, /updateViewportHistoryButtons\(\)/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  assert.match(css, /#arrange-preview-bar \{/);
  assert.match(css, /\.arrange-preview-box \{/);
  assert.match(css, /\.node\.node-filtered \{ display: none; \}/);
  assert.match(css, /\.wires > g\.edge-filtered \{ display: none; \}/);
  assert.match(css, /\.mini-node\.run-running \{/);
  assert.match(css, /\.mini-node\.run-failed \{/);
  assert.match(css, /\.mini-node\.mini-search-target \{/);
});
