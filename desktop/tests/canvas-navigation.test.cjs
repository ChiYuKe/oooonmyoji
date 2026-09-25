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
  // 排列只保留「全部」一种范围：右键菜单一项，视口 ⤢ 也直接进预览，不再有范围子菜单。
  assert.match(editor, /自动排列（先预览）/);
  assert.doesNotMatch(editor, /排列全部（预览）/);
  assert.doesNotMatch(editor, /排列选中（预览）/);
  assert.doesNotMatch(editor, /排列当前组（预览）/);
  assert.match(editor, /arrange\.addEventListener\('click', \(\) => previewAutoLayout\('all'\)\)/);
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

test('排列预览的确认条显眼：文案说明 + 反色实心「应用排列」+ Enter/Esc 快捷键', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/canvas.html'), 'utf8');
  // 以前只有一个小灰「应用」，用户找不到出口；现在文案里直说「点它才写入」，按钮也带上了键位。
  assert.match(html, /id="arrange-preview-hint"/);
  assert.match(html, /应用排列 \(Enter\)/);
  assert.match(html, /取消 \(Esc\)/);
  // 「取消」曾经挂着 .icon-button（width/min-width: 28px、padding: 0），文字被压成竖排的
  // 「取 / 消 / (Esc)」；现在按钮类名与样式都必须保证单行。
  assert.doesNotMatch(html, /id="btn-arrange-cancel"[^>]*icon-button/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  assert.match(css, /#arrange-preview-bar button \{ flex: 0 0 auto; white-space: nowrap;/);
  // 反色实心 + 呼吸光晕（prefers-reduced-motion 下关掉动画）。
  assert.match(css, /#btn-arrange-apply \{[\s\S]*?background: var\(--ui-text, #dedede\);[\s\S]*?animation: arrange-apply-pulse/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #btn-arrange-apply \{ animation: none; \} \}/);
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/interactions/input-bridge.ts'), 'utf8');
  assert.match(bridge, /if \(!editing && state\.arrangePreview\) \{/);
  assert.match(bridge, /matchesShortcut\(event, 'editor\.arrangeApply'\)/);
  assert.match(bridge, /matchesShortcut\(event, 'editor\.arrangeCancel'\)/);
  assert.match(bridge, /executeEditorCommand\('confirmArrangePreview'\)/);
  assert.match(bridge, /executeEditorCommand\('cancelArrangePreview'\)/);
  const shortcuts = fs.readFileSync(path.join(__dirname, '..', 'public/shortcuts/shortcuts.js'), 'utf8');
  assert.match(shortcuts, /\{ id: 'editor\.arrangeApply', group: 'editor', label: '应用排列预览', defaultBinding: 'enter' \}/);
  assert.match(shortcuts, /\{ id: 'editor\.arrangeCancel', group: 'editor', label: '取消排列预览', defaultBinding: 'escape' \}/);
});

test('工具条与工具菜单的「自动排列」也走同一条预览命令', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/index.html'), 'utf8');
  // 以前工具条是「直接排 + fitView」、右键菜单是预览，两条路行为不一致；现在统一成预览。
  assert.equal(html.split('data-editor-command="previewArrange"').length - 1, 2);
  assert.equal(html.includes('data-editor-command="autoLayout"'), false);
});
