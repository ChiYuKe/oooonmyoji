const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
const popout = fs.readFileSync(path.join(root, 'src/renderer/popout.ts'), 'utf8');
const {createRenameShortcuts} = require('../dist-test-renderer/renderer/rename-shortcuts.js');

/** 与 delete-shortcuts 测试一致：实例化编译产物里的真实模块，不打开桌面窗口。 */
function shellHarness(options = {}) {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.editable = false;
    }
    closest(selector) {
      return this.editable && selector.includes('input') ? this : null;
    }
  }
  // isTextEditingTarget 走 `target instanceof Element`：Node 没有 DOM 全局，测试注入桩。
  const previousElement = globalThis.Element;
  globalThis.Element = Element;
  const calls = {renamed: [], commands: [], toasts: [], nodes: [], variables: []};
  const ctrl = createRenameShortcuts({
    matchesShortcut: (event) => event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey,
    getDeleteTarget: () => options.deleteTarget,
    roiPicker: {isOpen: () => Boolean(options.roiPickerState)},
    contentBrowser: {
      resolveRenameTarget: (path) => (options.entries ?? []).find((entry) => entry.path === path)
        ?? ((options.folders ?? []).includes(path) ? {kind: 'folder', path, name: path} : undefined),
      isRootFolder: (folder) => folder === 'assets' || folder === 'workflows',
      renameItem: (item) => calls.renamed.push(item),
      isNameDialogOpen: () => Boolean(options.contentNameDialogState),
    },
    panels: {
      renameNode: (nodeId) => calls.nodes.push(nodeId),
      renameVariable: (name, scope) => calls.variables.push([name, scope]),
    },
    workspace: {editorCommand: (...args) => calls.commands.push(args)},
    showToast: (message, error) => calls.toasts.push([message, Boolean(error)]),
  });
  return {ctrl, calls, Element, restore() {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }};
}

function keyEvent(key, extra = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...extra,
  };
}

const workflowItem = {kind: 'workflow', path: 'workflows/a.json', name: 'a'};

test('F2 快速重命名内容浏览器里点选的条目', () => {
  const h = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem]});
  const event = keyEvent('F2');
  assert.equal(h.ctrl.handleRenameShortcut(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.calls.renamed, [workflowItem]);
});

test('F2 在结构树行内改名：按节点 id 交给面板原地编辑', () => {
  const h = shellHarness({deleteTarget: {kind: 'editor', nodeId: 'n1'}});
  const event = keyEvent('F2');
  assert.equal(h.ctrl.handleRenameShortcut(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.calls.nodes, ['n1']);
  assert.equal(h.calls.variables.length, 0);
});

test('F2 在变量行内改名：按变量名与作用域交给面板原地编辑', () => {
  const h = shellHarness({deleteTarget: {kind: 'editor', variable: {name: '运行轮数', scope: 'inputs'}}});
  const event = keyEvent('F2');
  assert.equal(h.ctrl.handleRenameShortcut(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.calls.variables, [['运行轮数', 'inputs']]);
  assert.equal(h.calls.nodes.length, 0);
});

test('F2 只有画布选区（无面板行）时仍交给详情栏镜像', () => {
  const h = shellHarness({deleteTarget: {kind: 'editor'}});
  const event = keyEvent('F2');
  assert.equal(h.ctrl.handleRenameShortcut(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.calls.commands, [['renameSelection']]);
});

test('项目根目录按 F2 只提示不弹重命名', () => {
  for (const rootFolder of ['assets', 'workflows']) {
    const h = shellHarness({deleteTarget: {kind: 'content', path: rootFolder}, folders: [rootFolder]});
    assert.equal(h.ctrl.handleRenameShortcut(keyEvent('F2')), true);
    assert.equal(h.calls.renamed.length, 0);
    assert.deepEqual(h.calls.toasts, [['项目根目录不能重命名', true]]);
  }
});

test('没有登记目标或目标已失效时不拦截 F2', () => {
  const empty = shellHarness({});
  const event = keyEvent('F2');
  assert.equal(empty.ctrl.handleRenameShortcut(event), false);
  assert.equal(event.defaultPrevented, false);

  const stale = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/gone.json'}, entries: [workflowItem]});
  assert.equal(stale.ctrl.handleRenameShortcut(keyEvent('F2')), false);
  assert.equal(stale.calls.renamed.length, 0);

  // 队列行没有重命名通道：不吃键。
  const queue = shellHarness({deleteTarget: {kind: 'queue', rel: 'workflows/a.json'}});
  assert.equal(queue.ctrl.handleRenameShortcut(keyEvent('F2')), false);
  assert.equal(queue.calls.commands.length, 0);
});

test('输入控件、弹层与名称对话框打开时不抢占 F2', () => {
  const editable = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem]});
  const input = new editable.Element('input');
  input.editable = true;
  assert.equal(editable.ctrl.handleRenameShortcut(keyEvent('F2', {target: input})), false);
  assert.equal(editable.calls.renamed.length, 0);

  const modal = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem], contentNameDialogState: {resolve() {}}});
  assert.equal(modal.ctrl.handleRenameShortcut(keyEvent('F2')), false);

  const picker = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem], roiPickerState: {busy: false}});
  assert.equal(picker.ctrl.handleRenameShortcut(keyEvent('F2')), false);

  const modified = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem]});
  assert.equal(modified.ctrl.handleRenameShortcut(keyEvent('F2', {ctrlKey: true})), false);
  assert.equal(modified.calls.renamed.length, 0);
});

test('F2 重命名经画布命令聚焦节点名称输入框', () => {
  const focused = [];
  const rendered = [];
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {selected: new Set(['n1']), selectedEdge: null, selectedRun: null, inspector: '', raw: {}},
    nodeById: (id) => id === 'n1' ? {id: 'n1', name: '旧名'} : undefined,
    renderInspector: () => { rendered.push(1); },
  });
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => id === 'inspector-node-name' ? {focus: () => focused.push('focus'), select: () => focused.push('select')} : null,
  };
  try {
    dispatch.executeEditorCommand('renameSelection');
    assert.deepEqual(rendered, [1]);
    assert.deepEqual(focused, ['focus', 'select']);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  // 多选或目标丢失时不动作。
  const multi = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {selected: new Set(['n1', 'n2']), raw: {}},
    nodeById: () => ({}),
    renderInspector: () => { rendered.push(2); },
  });
  multi.executeEditorCommand('renameSelection');
  assert.deepEqual(rendered, [1]);
});

test('F2 选中变量时聚焦详情栏的「变量命名」输入框', () => {
  const focusedIds = [];
  const rendered = [];
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {
      selected: new Set(), selectedEdge: null, selectedRun: null,
      inspector: 'variables', selectedVariable: '运行轮数', selectedVariableScope: 'inputs', raw: {},
    },
    nodeById: () => undefined,
    renderInspector: () => { rendered.push(1); },
  });
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => {
      focusedIds.push(id);
      return {focus() {}, select() {}};
    },
  };
  try {
    dispatch.executeEditorCommand('renameSelection');
    assert.deepEqual(rendered, [1], '变量选中要重绘详情栏');
    assert.deepEqual(focusedIds, ['inspector-variable-name']);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  // 同一个命令入口必须同时覆盖变量与节点两个目标。
  const inspectorSource = fs.readFileSync(path.join(__dirname, '../dist-test-renderer/canvas/inspector/variable-inspectors.js'), 'utf8');
  assert.match(inspectorSource, /inspector-variable-name/);
  const sidebarSource = fs.readFileSync(path.join(root, 'src/renderer/panels/sidebar.ts'), 'utf8');
  assert.match(sidebarSource, /F2 重命名/, '变量行与结构树行都要在提示里标出 F2');
});

test('文档画布的 F2 把聚焦请求转给详细信息镜像', () => {
  const requested = [];
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {selected: new Set(['n1']), selectedEdge: null, selectedRun: null, inspector: 'node', raw: {}},
    nodeById: () => ({}),
    requestInspectorRename: (selection) => { requested.push(selection); },
  });
  const selection = {kind: 'node', nodeId: 'node_group_1'};
  dispatch.executeEditorCommand('requestRenameSelection', selection);
  assert.deepEqual(requested, [selection], '文档画布把当前组选择一并交给详情镜像');
});

test('详情镜像能用投影解析器选中节点组并聚焦同一个名称输入框', () => {
  const focused = [];
  const rendered = [];
  const group = {id: 'node_group_1', name: '节点组 1', _nodeGroup: true};
  const state = {selected: new Set(), selectedEdge: null, selectedRun: null, inspector: '', raw: {}};
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state,
    nodeById: () => undefined,
    selectionNodeById: (id) => id === group.id ? group : undefined,
    clearVariableCardSelection: () => {},
    render: () => { rendered.push('render'); },
    renderInspector: () => { rendered.push('inspector'); },
  });
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => id === 'inspector-node-name' ? {focus: () => focused.push('focus'), select: () => focused.push('select')} : null,
  };
  try {
    dispatch.executeEditorCommand('setInspectorSelection', {kind: 'node', nodeId: group.id});
    assert.deepEqual([...state.selected], [group.id]);
    dispatch.executeEditorCommand('renameSelection');
    assert.deepEqual(focused, ['focus', 'select']);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.deepEqual(rendered, ['render', 'inspector']);
});

test('行内改名命令：节点改显示名、变量走详情栏同一个改名实现', () => {
  const renamed = [];
  let mutated = 0;
  const node = {id: 'n1', name: '旧名'};
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {selected: new Set(), raw: {}},
    nodeById: (id) => (id === 'n1' ? node : undefined),
    mutate: (fn) => { mutated += 1; fn(); },
    renameVariable: (...args) => renamed.push(args),
  });
  dispatch.executeEditorCommand('renameNodeName', {nodeId: 'n1', name: '  新名  '});
  assert.equal(node.name, '新名', '两侧空白要裁掉');
  dispatch.executeEditorCommand('renameNodeName', {nodeId: 'n1', name: '   '});
  assert.equal('name' in node, false, '清空即删除显示名，回落到 id');
  assert.equal(mutated, 2);

  dispatch.executeEditorCommand('renameVariable', {scope: 'inputs', oldName: '运行轮数', name: ' 轮数 '});
  assert.deepEqual(renamed, [['inputs', '运行轮数', '轮数']]);
  renamed.length = 0;
  dispatch.executeEditorCommand('renameVariable', {scope: 'inputs', oldName: '', name: '轮数'});
  assert.deepEqual(renamed, [], '缺原名/新名时不动作');
});

test('查看变量引用命令保留变量作用域与稳定名称', () => {
  const calls = [];
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {selected: new Set(), raw: {}},
    showVariableReferences: (...args) => calls.push(args),
  });
  dispatch.executeEditorCommand('showVariableReferences', {scope: 'inputs', name: '公开输入'});
  dispatch.executeEditorCommand('showVariableReferences', {scope: 'variables', name: 'v_stable'});
  assert.deepEqual(calls, [['inputs', '公开输入'], ['variables', 'v_stable']]);
});

test('定位命令带参数端点：面板载荷传 param，搜索/结构树裸 id 仍兼容', () => {
  const focused = [];
  const state = {selected: new Set(), selectedEdge: null, selectedRun: null, inspector: 'node', raw: {}};
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state,
    nodeById: (id) => (id === 'tap' ? {id: 'tap'} : undefined),
    focusNode: (...args) => focused.push(args),
  });
  dispatch.executeEditorCommand('focusNode', {nodeId: 'tap', param: 'timeout_seconds'});
  dispatch.executeEditorCommand('focusNode', 'tap');
  assert.deepEqual(focused, [['tap', 'timeout_seconds'], ['tap', '']], '面板载荷带参数名，裸 id 的 param 为空');
  assert.deepEqual([...state.selected], ['tap'], '定位同时选中该节点');
});

test('断开引用命令：单条与批量分别回发，作用域与条目原样交给实现', () => {
  const single = [], batch = [];
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {selected: new Set(), raw: {}},
    disconnectVariableReference: (entry) => single.push(entry),
    disconnectAllVariableReferences: (...args) => batch.push(args),
  });
  const entry = {nodeId: 'tap', param: 'timeout_seconds', ref: 'inputs.等待'};
  dispatch.executeEditorCommand('disconnectVariableReference', {entry});
  dispatch.executeEditorCommand('disconnectAllVariableReferences', {scope: 'inputs', name: '等待'});
  assert.deepEqual(single, [entry]);
  assert.deepEqual(batch, [['inputs', '等待']]);
});

test('改名影响范围：确认/取消命令转发到暂存实现', () => {
  const confirmed = [], cancelled = [];
  const dispatch = require('../dist-test-renderer/canvas/state/editor-command-dispatch.js').createEditorCommandDispatch({
    state: {selected: new Set(), raw: {}},
    confirmPendingRename: () => confirmed.push(1),
    cancelPendingRename: () => cancelled.push(1),
  });
  dispatch.executeEditorCommand('confirmRenameVariable');
  dispatch.executeEditorCommand('cancelRenameVariable');
  assert.deepEqual(confirmed, [1]);
  assert.deepEqual(cancelled, [1]);
});

test('内容浏览器重命名走行内编辑，不再弹命名对话框', () => {
  const cb = fs.readFileSync(path.join(root, 'src/renderer/content-browser.ts'), 'utf8');
  assert.match(cb, /function commitContentRenameDraft/);
  assert.match(cb, /contentRenameDraft = \{ item, name: item\.name, busy: false \};/);
  // F2 与右键菜单共用 renameItem → renameContentItem：入口里不再打开 requestContentName 弹窗。
  const renameEntry = cb.slice(cb.indexOf('async function renameContentItem'), cb.indexOf('function cancelContentRenameDraft'));
  assert.doesNotMatch(renameEntry, /requestContentName/);
});

test('壳层、独立窗口与画布共用同一个 F2 重命名入口', () => {
  const shortcuts = fs.readFileSync(path.join(root, 'public/shortcuts/shortcuts.js'), 'utf8');
  assert.match(shortcuts, /global\.rename.*defaultBinding: 'f2'/);
  assert.match(shortcuts, /editor\.rename.*defaultBinding: 'f2'/);
  const inputBridgeSource = fs.readFileSync(path.join(__dirname, '../dist-test-renderer/canvas/interactions/input-bridge.js'), 'utf8');
  assert.match(inputBridgeSource, /matchesShortcut\(event, 'editor\.rename'\)/);
  const dispatchSource = fs.readFileSync(path.join(__dirname, '../dist-test-renderer/canvas/state/editor-command-dispatch.js'), 'utf8');
  assert.match(dispatchSource, /command === 'renameSelection'\)/);
  assert.match(dispatchSource, /command === 'requestRenameSelection'\)/);
  assert.match(inputBridgeSource, /requestRenameSelection/);
  assert.match(inputBridgeSource, /openNodeNameEditor/, '所有节点卡 F2 先由画布内标题输入框接管');
  assert.match(inputBridgeSource, /_nodeGroupId/, '组内接口卡与变量卡的 F2 要归一到所属组');
  // 文档画布按 F2 时，宿主把聚焦请求转给详细信息镜像（可见的输入框在它那边）。
  const host = fs.readFileSync(path.join(root, 'src/renderer/editor-host.ts'), 'utf8');
  assert.match(host, /case 'inspectorRenameRequested'/);
  assert.match(host, /command: 'setInspectorSelection'/, '聚焦前先把节点组选区同步给详情镜像');
  assert.match(host, /command: 'renameSelection' \}/);
  const messages = fs.readFileSync(path.join(root, 'src/shared/editor-messages.ts'), 'utf8');
  assert.match(messages, /'inspectorRenameRequested'/);
  // 侧栏行内改名：变量行与结构树行都在原地换输入框。
  const sidebarSource = fs.readFileSync(path.join(root, 'src/renderer/panels/sidebar.ts'), 'utf8');
  assert.match(sidebarSource, /startVariableRename/);
  assert.match(sidebarSource, /startNodeRename/);
  assert.match(sidebarSource, /row-name-edit/);
  assert.match(sidebarSource, /registerEditorDeleteTarget\(\{ variable: \{ name: variable\.name, scope \} \}\)/);
  assert.match(sidebarSource, /registerEditorDeleteTarget\(\{ nodeId: node\.id \}\)/);
  const styles = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  assert.match(styles, /\.row-name-edit \{/);
  assert.match(sidebarSource, /inline-rename-input row-name-edit/);
  const contentBrowserSource = fs.readFileSync(path.join(root, 'src/renderer/content-browser.ts'), 'utf8');
  assert.match(contentBrowserSource, /inline-rename-input content-item-name-edit/);
  assert.match(styles, /\.inline-rename-input::selection \{/);
  const panelSource = fs.readFileSync(path.join(__dirname, '../dist-test-renderer/canvas/inspector/panel.js'), 'utf8');
  assert.match(panelSource, /inspector-node-name/);
  assert.match(panelSource, /node\._nodeGroup/);
  assert.match(panelSource, /renameNodeGroup/);
  assert.match(shell, /createRenameShortcuts\(/);
  assert.match(shell, /if \(handleRenameShortcut\(event\)\) return;/);
  assert.match(shell, /event\.data\.type === 'shellShortcut'/);
  assert.match(popout, /matchesById\(event, 'global\.rename'\)/);
  assert.match(popout, /sendToOpener\(\{ type: 'shellShortcut', key: event\.key \}\)/);
});
