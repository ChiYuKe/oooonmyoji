const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
const popout = fs.readFileSync(path.join(root, 'src/renderer/popout.ts'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'public/legacy/workflow-editor.js'), 'utf8');
const overviewSrc = fs.readFileSync(path.join(root, 'src/renderer/overview.ts'), 'utf8');

/** 与其它渲染层测试一致：切片执行生产代码，不打开桌面窗口，也不操控鼠标键盘。 */
function sliceBetween(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert(start >= 0 && end > start, `无法定位代码片段：${from}`);
  return source.slice(start, end);
}

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
  const calls = {deleted: [], queue: [], queueRows: [], commands: [], toasts: []};
  const ctx = vm.createContext({
    Element,
    window: {
      StudioShortcuts: {
        matchesById: (event) => (event.key === 'Delete' || event.key === 'Backspace')
          && !event.ctrlKey && !event.metaKey && !event.altKey,
      },
    },
    deleteTarget: options.deleteTarget,
    overview: {
      isSelected: (rel) => (options.overviewSelection ?? []).includes(rel),
      isRunning: () => Boolean(options.overviewRun?.active),
      updateSelection: (rel, checked) => calls.queue.push([rel, checked]),
      selectQueueRow: (rel) => calls.queueRows.push(rel),
    },
    roiPicker: {isOpen: () => Boolean(options.roiPickerState)},
    contentBrowser: {
      resolveDeleteTarget: (path) => (options.entries ?? []).find((entry) => entry.path === path)
        ?? ((options.folders ?? []).includes(path) ? {kind: 'folder', path, name: path} : undefined),
      isRootFolder: (folder) => folder === 'assets' || folder === 'workflows',
      deleteItem: (item) => calls.deleted.push(item),
      isNameDialogOpen: () => Boolean(options.contentNameDialogState),
    },
    editorCommand: (...args) => calls.commands.push(args),
    showToast: (message, error) => calls.toasts.push([message, Boolean(error)]),
  });
  vm.runInContext(stripTypeScriptTypes(sliceBetween(shell, 'function isTextEditingTarget(', 'function resetDeleteTargetOnPointerDown(')), ctx);
  return {ctx, calls, Element};
}

function keyEvent(key, extra = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...extra,
  };
}

const workflowItem = {kind: 'workflow', path: 'workflows/a.json', name: 'a'};

test('Delete 与 Backspace 都能删除内容浏览器里选中的条目', () => {
  for (const key of ['Delete', 'Backspace']) {
    const h = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem]});
    const event = keyEvent(key);
    assert.equal(h.ctx.handleDeleteShortcut(event), true, key);
    assert.equal(event.defaultPrevented, true, key);
    assert.deepEqual(h.calls.deleted, [workflowItem], key);
    assert.equal(h.ctx.deleteTarget, undefined, `${key} 之后不应保留过期目标`);
  }
});

test('输入控件与修饰键不抢占原生删除语义', () => {
  const editable = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem]});
  const input = new editable.Element('input');
  input.editable = true;
  assert.equal(editable.ctx.handleDeleteShortcut(keyEvent('Delete', {target: input})), false);
  assert.equal(editable.calls.deleted.length, 0);

  const modified = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem]});
  assert.equal(modified.ctx.handleDeleteShortcut(keyEvent('Delete', {ctrlKey: true})), false);
  assert.equal(modified.ctx.handleDeleteShortcut(keyEvent('Backspace', {altKey: true})), false);
  assert.equal(modified.calls.deleted.length, 0);

  const modal = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem], contentNameDialogState: {resolve() {}}});
  assert.equal(modal.ctx.handleDeleteShortcut(keyEvent('Delete')), false);
  const picker = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/a.json'}, entries: [workflowItem], roiPickerState: {busy: false}});
  assert.equal(picker.ctx.handleDeleteShortcut(keyEvent('Delete')), false);
});

test('目录树与面包屑里的文件夹可以删除，项目根目录被拦截', () => {
  const folder = shellHarness({deleteTarget: {kind: 'content', path: 'assets/templates'}, folders: ['', 'assets', 'assets/templates']});
  assert.equal(folder.ctx.handleDeleteShortcut(keyEvent('Delete')), true);
  assert.deepEqual(folder.calls.deleted, [{kind: 'folder', path: 'assets/templates', name: 'assets/templates'}]);

  for (const rootFolder of ['assets', 'workflows']) {
    const protectedRoot = shellHarness({deleteTarget: {kind: 'content', path: rootFolder}, folders: [rootFolder]});
    assert.equal(protectedRoot.ctx.handleDeleteShortcut(keyEvent('Delete')), true);
    assert.equal(protectedRoot.calls.deleted.length, 0);
    assert.deepEqual(protectedRoot.calls.toasts, [['项目根目录不能删除', true]]);
  }
});

test('执行队列行按 Delete 移出队列，运行中只提示不改队列', () => {
  const idle = shellHarness({deleteTarget: {kind: 'queue', rel: 'workflows/a.json'}, overviewSelection: ['workflows/a.json']});
  const event = keyEvent('Delete');
  assert.equal(idle.ctx.handleDeleteShortcut(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(idle.calls.queue, [['workflows/a.json', false]]);
  assert.deepEqual(idle.calls.queueRows, ['']);
  assert.equal(idle.ctx.deleteTarget, undefined);

  const running = shellHarness({
    deleteTarget: {kind: 'queue', rel: 'workflows/a.json'},
    overviewSelection: ['workflows/a.json'],
    overviewRun: {active: true},
  });
  assert.equal(running.ctx.handleDeleteShortcut(keyEvent('Delete')), true);
  assert.equal(running.calls.queue.length, 0);
  assert.deepEqual(running.calls.toasts, [['队列运行中，无法移出脚本', true]]);
});

test('结构树与变量列表的选中项经画布删除', () => {
  const h = shellHarness({deleteTarget: {kind: 'editor'}});
  const event = keyEvent('Delete');
  assert.equal(h.ctx.handleDeleteShortcut(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.calls.commands, [['deleteSelection']]);
});

test('没有登记目标或目标已失效时不吃按键', () => {
  const empty = shellHarness({});
  const event = keyEvent('Delete');
  assert.equal(empty.ctx.handleDeleteShortcut(event), false);
  assert.equal(event.defaultPrevented, false);

  const stale = shellHarness({deleteTarget: {kind: 'content', path: 'workflows/gone.json'}, selectedContentPath: ''});
  assert.equal(stale.ctx.handleDeleteShortcut(keyEvent('Delete')), false);
  assert.equal(stale.calls.deleted.length, 0);
  assert.equal(stale.ctx.deleteTarget, undefined);

  const staleQueue = shellHarness({deleteTarget: {kind: 'queue', rel: 'workflows/gone.json'}, overviewSelection: []});
  assert.equal(staleQueue.ctx.handleDeleteShortcut(keyEvent('Backspace')), false);
  assert.equal(staleQueue.calls.queue.length, 0);
});

test('画布删除入口覆盖实例运行项、变量与节点/连线', () => {
  const harness = (options) => {
    const calls = {runs: [], cards: [], variables: [], selections: 0, renders: 0};
    const ctx = vm.createContext({
      state: {selectedRun: null, inspector: 'node', selectedVariable: '', selectedVariableScope: 'inputs', selectedVariableCardId: '', ...options.state},
      nodeById: () => options.node,
      removeInstanceRun: (node, index) => calls.runs.push([node.id, index]),
      removeVariableCard: (id) => calls.cards.push(id),
      removeVariable: (scope, name) => calls.variables.push([scope, name]),
      deleteSelection: () => { calls.selections += 1; },
      render: () => { calls.renders += 1; },
    });
    vm.runInContext(sliceBetween(editor, 'function deleteCurrentSelection() {', 'function executeEditorCommand'), ctx);
    return {ctx, calls};
  };

  const run = harness({node: {id: 'n1', runs: [{}, {}]}, state: {selectedRun: {nodeId: 'n1', index: 1}}});
  run.ctx.deleteCurrentSelection();
  assert.deepEqual(run.calls.runs, [['n1', 1]]);
  assert.equal(run.calls.selections, 0);

  const staleRun = harness({node: undefined, state: {selectedRun: {nodeId: 'gone', index: 0}}});
  staleRun.ctx.deleteCurrentSelection();
  assert.equal(staleRun.calls.selections, 0);
  assert.equal(staleRun.calls.runs.length, 0);
  assert.equal(staleRun.calls.renders, 1);

  const variable = harness({state: {inspector: 'variables', selectedVariable: 'goal', selectedVariableScope: 'variables'}});
  variable.ctx.deleteCurrentSelection();
  assert.deepEqual(variable.calls.variables, [['variables', 'goal']]);
  assert.equal(variable.calls.selections, 0);

  const input = harness({state: {inspector: 'variables', selectedVariable: 'count', selectedVariableScope: 'inputs'}});
  input.ctx.deleteCurrentSelection();
  assert.deepEqual(input.calls.variables, [['inputs', 'count']]);

  const card = harness({state: {inspector: 'variables', selectedVariable: 'repeat_count', selectedVariableScope: 'variables', selectedVariableCardId: 'variable-card-1'}});
  card.ctx.deleteCurrentSelection();
  assert.deepEqual(card.calls.cards, ['variable-card-1']);
  assert.equal(card.calls.variables.length, 0);

  const nodeWithStaleCard = harness({state: {inspector: 'node', selectedVariableCardId: 'variable-card-2'}});
  nodeWithStaleCard.ctx.deleteCurrentSelection();
  assert.equal(nodeWithStaleCard.calls.cards.length, 0);
  assert.equal(nodeWithStaleCard.calls.selections, 1);

  const node = harness({state: {inspector: 'node'}});
  node.ctx.deleteCurrentSelection();
  assert.equal(node.calls.selections, 1);
});

test('画布、标题栏命令与独立窗口共用同一个删除入口', () => {
  const h = vm.createContext({
    window: {
      StudioShortcuts: {
        matchesById: (event, id) => id === 'editor.delete' && (event.key === 'Delete' || event.key === 'Backspace'),
      },
    },
  });
  vm.runInContext(sliceBetween(editor, 'function matchesShortcut(event, id) {', "window.addEventListener('keydown'"), h);
  assert.equal(h.matchesShortcut({key: 'Delete'}, 'editor.delete'), true);
  assert.equal(h.matchesShortcut({key: 'Backspace'}, 'editor.delete'), true);
  assert.equal(h.matchesShortcut({key: 'x'}, 'editor.delete'), false);
  assert.match(editor, /if \(!editing && matchesShortcut\(event, 'editor\.delete'\)\) \{/);
  assert.match(editor, /command === 'deleteSelection'\) deleteCurrentSelection\(\)/);
  assert.match(shell, /if \(handleDeleteShortcut\(event\)\) return;/);
  assert.match(shell, /document\.addEventListener\('pointerdown', resetDeleteTargetOnPointerDown, true\)/);
  assert.match(overviewSrc, /setDeleteTarget\(\{ kind: 'queue', rel \}\);/);
  assert.match(shell, /deleteTarget = \{ kind: 'editor' \};/);
  assert.match(popout, /sendToOpener\(\{ type: 'shellShortcut', key: event\.key \}\)/);
  assert.match(shell, /event\.data\.type === 'shellShortcut'/);
});

test('队列选中态有深色与浅色语义样式', () => {
  const styles = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  const theme = fs.readFileSync(path.join(root, 'public/theme/theme.css'), 'utf8');
  assert.match(styles, /\.overview-queue-row\.selected \{ background: #[0-9a-f]{6}; \}/);
  assert.match(theme, /:root\[data-theme="light"\] :is\([^)]*\.overview-queue-row\.selected[^)]*\)/);
  assert.match(overviewSrc, /rel === selectedQueueRel \? 'selected' : ''/);
});
