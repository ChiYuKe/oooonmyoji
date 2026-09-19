// Run via npm test (builds the renderer test output first).
// 文档生命周期：启动恢复会话时 activeUri 已经被设成活动文档，
// 若因此跳过加载，首屏画布就是空白，必须手动切一次标签才显示。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createDocumentLifecycle} = require('../dist-test-renderer/renderer/document-lifecycle.js');

const ACTIVE = 'file:///w/activity_loop.json';
const OTHER = 'file:///w/new.workflow.json';

function makeRuntime(uri, options = {}) {
  return {
    panelId: `workflow:${uri}`,
    frame: {id: `workflow:${uri}`, contentDocument: {readyState: options.readyState ?? 'complete'}},
    ready: Boolean(options.ready),
    init: options.init,
    sidebarNodes: [],
    sidebarVariables: [],
    selectedNode: '',
    selectedVariable: '',
    selectedVariableScope: 'inputs',
    collapsedTreeNodes: new Set(),
  };
}

/** 桩工作区：只实现生命周期实际调用的部分，文档文本与运行时快照都可控。 */
function harness(options = {}) {
  const activeUri = options.activeUri ?? ACTIVE;
  const tabs = new Map([
    [ACTIVE, {uri: ACTIVE, text: options.activeText ?? '', dirty: false, backStack: []}],
    [OTHER, {uri: OTHER, text: '', dirty: false, backStack: []}],
  ]);
  const runtimes = new Map([
    [ACTIVE, makeRuntime(ACTIVE, {ready: options.activeReady, readyState: options.activeReadyState, init: options.activeInit})],
    [OTHER, makeRuntime(OTHER, {ready: options.otherReady, init: options.otherInit})],
  ]);
  const detailsFrame = {id: 'details-frame'};
  const calls = {loads: [], posts: [], status: [], toasts: [], tabSyncs: 0, details: 0, panelDirty: [], cancels: [], dirtyFlags: []};
  const diskText = options.diskText ?? {};
  const workspace = {
    tab: (uri) => tabs.get(uri),
    tabs: () => [...tabs.values()],
    activeUri: () => activeUri,
    ensureDocument: (uri) => {
      if (!tabs.has(uri)) tabs.set(uri, {uri, text: '', dirty: false, backStack: []});
      return tabs.get(uri);
    },
    getDocumentRuntimes: () => runtimes,
    activeRuntime: () => runtimes.get(activeUri),
    cancelAutoSave: (uri) => calls.cancels.push(uri ?? activeUri),
    waitForAutoSave: async () => {},
    setDocumentText: (uri, text) => { tabs.get(uri).text = text; },
    setActiveDocument: () => {},
    displayFileUri: (uri) => uri,
    setDirty: () => {},
    postToFrame: (frame, payload) => { if (frame === detailsFrame) calls.details += 1; else calls.posts.push([frame.id, payload]); },
    scheduleWorkflowSessionPersist: () => { calls.tabSyncs += 1; },
    setDocumentDirty: (uri, dirty) => { const tab = tabs.get(uri); if (tab) tab.dirty = dirty; calls.dirtyFlags.push([uri, dirty]); },
    removeDocument: () => {},
    renameDocument: () => {},
    unregisterDocumentFrame: () => {},
    workflowTabName: (uri) => uri,
    activeBackStack: () => [],
    restoreUri: () => '',
  };
  const lifecycle = createDocumentLifecycle({
    api: {
      getWorkflowInit: async (uri) => {
        calls.loads.push(uri);
        return {
          document: {uri, text: diskText[uri] ?? `{"nodes":["${uri}"]}`},
          workflows: [], instances: [], selectedInstance: '', issues: [],
        };
      },
      saveWorkflow: async () => {},
    },
    workspace,
    getDocking: () => undefined,
    getWorkbenchFrame: () => undefined,
    getBootstrap: () => undefined,
    getSelectedInstance: () => '',
    setSelectedInstance: () => {},
    sidebar: {
      snapshot: () => ({nodes: [], variables: [], selectedNode: '', selectedVariable: '', selectedVariableScope: 'inputs', collapsed: new Set()}),
      apply: () => {},
      resetCollapsed: () => {},
      resetViews: () => {},
      render: () => {},
    },
    overview: {reconcileSelection: () => {}, render: () => {}},
    contentBrowser: {render: () => {}},
    loadingMask: {classList: {add: () => {}, remove: () => {}}},
    detailsFrame,
    renderWorkflowSelect: () => {},
    renderInstances: () => {},
    setStatus: (message) => calls.status.push(message),
    showToast: (message) => calls.toasts.push(message),
    errorMessage: (error) => String(error),
    setDocumentPanelDirty: (panelId, dirty) => calls.panelDirty.push([panelId, dirty]),
    resetSharedPanelSurfaces: () => {},
  });
  return {
    lifecycle, runtimes, calls,
    setTabText: (uri, text) => { tabs.get(uri).text = text; },
    setTabDirty: (uri, dirty) => { tabs.get(uri).dirty = dirty; },
    tabText: (uri) => tabs.get(uri).text,
  };
}

global.document = {querySelector: () => ({textContent: ''})};

test('启动恢复会话：活动文档还没加载过时要真的加载它', async () => {
  const h = harness({activeReadyState: 'complete'});
  assert.equal(h.runtimes.get(ACTIVE).init, undefined);

  await h.lifecycle.activateWorkflowTab(ACTIVE);

  assert.deepEqual(h.calls.loads, [ACTIVE], '不能因为「已经是活动文档」就跳过加载');
  assert.ok(h.runtimes.get(ACTIVE).init, '运行时应当拿到初始化数据');
  assert.deepEqual(h.calls.posts.map(([id]) => id), [`workflow:${ACTIVE}`], '初始化要下发到该文档的画布');
  assert.deepEqual(h.calls.status, ['工作流已载入']);
  assert.deepEqual(h.calls.toasts, []);
});

test('已经加载过的活动文档只同步标签，不重复拉取', async () => {
  const h = harness({activeInit: {document: {uri: ACTIVE, text: '{}'}, workflows: [], instances: [], selectedInstance: '', issues: []}});

  await h.lifecycle.activateWorkflowTab(ACTIVE);

  assert.deepEqual(h.calls.loads, []);
  assert.equal(h.calls.tabSyncs, 1);
  assert.deepEqual(h.calls.posts, []);
});

test('非活动文档照常加载', async () => {
  const h = harness({});

  await h.lifecycle.activateWorkflowTab(OTHER);

  assert.deepEqual(h.calls.loads, [OTHER]);
  assert.ok(h.runtimes.get(OTHER).init);
});

test('画布 iframe 已加载完成但页内 ready 丢失时，初始化仍会补发', async () => {
  const init = {document: {uri: ACTIVE, text: '{}'}, workflows: [], instances: [], selectedInstance: '', issues: []};
  const ready = harness({activeInit: init, activeReady: false, activeReadyState: 'complete'});

  ready.lifecycle.sendDocumentInit(ACTIVE);

  assert.deepEqual(ready.calls.posts.map(([id]) => id), [`workflow:${ACTIVE}`]);
  assert.equal(ready.runtimes.get(ACTIVE).ready, true, '补发后视为已就绪');
});

test('画布还没加载完就先不下发，等 ready 消息再发', async () => {
  const init = {document: {uri: ACTIVE, text: '{}'}, workflows: [], instances: [], selectedInstance: '', issues: []};
  const pending = harness({activeInit: init, activeReady: false, activeReadyState: 'loading'});

  pending.lifecycle.sendDocumentInit(ACTIVE);
  assert.deepEqual(pending.calls.posts, [], '未加载完的下发会丢消息，先不发');

  // 画布随后握手：ready 置位后同一次调用就会下发。
  pending.runtimes.get(ACTIVE).frame.contentDocument.readyState = 'complete';
  pending.lifecycle.sendDocumentInit(ACTIVE);
  assert.deepEqual(pending.calls.posts.map(([id]) => id), [`workflow:${ACTIVE}`]);
});

test('磁盘引用被改写后，打开中的文档重新读盘而不是沿用内存副本', async () => {
  // 复现：内容浏览器重命名/移动会改写磁盘上的引用，但内存里的旧正文如果被继续沿用，
  // 下一次自动保存就会把旧引用写回磁盘，把刚做的重定向覆盖掉。
  const stale = '{"nodes":[{"params":{"workflow":"活动副本.json"}}]}';
  const fresh = '{"nodes":[{"params":{"workflow":"周年庆活动副本.json"}}]}';
  const h = harness({activeInit: {document: {uri: ACTIVE, text: stale}, workflows: [], instances: [], selectedInstance: '', issues: []}, diskText: {[ACTIVE]: fresh}});
  h.setTabText(ACTIVE, stale);

  const skipped = await h.lifecycle.reloadDocuments([ACTIVE]);

  assert.deepEqual(skipped, [], '干净的文档不该被跳过');
  assert.ok(h.calls.cancels.includes(ACTIVE), '要先取消该文档排队中的旧内容写盘');
  assert.deepEqual(h.calls.loads, [ACTIVE], '必须重新读盘');
  assert.equal(h.tabText(ACTIVE), fresh, '内存正文要换成磁盘正文');
  const posted = h.calls.posts.find(([id]) => id === `workflow:${ACTIVE}`);
  assert.ok(posted, '新的文档内容要下发回画布');
  assert.equal(posted[1].document.text, fresh, '画布拿到的必须是磁盘上的新引用');
  assert.equal(h.runtimes.get(ACTIVE).init.document.text, fresh);
});

test('有未保存修改的文档不被重载并如实回报，避免覆盖用户改动', async () => {
  const h = harness({diskText: {[OTHER]: '{"disk":true}'}});
  h.setTabText(OTHER, '{"memory":true}');
  h.setTabDirty(OTHER, true);

  const skipped = await h.lifecycle.reloadDocuments([OTHER]);

  assert.deepEqual(skipped, [OTHER], '要回报给调用方去提示用户');
  assert.deepEqual(h.calls.loads, [], '脏文档不能读盘覆盖');
  assert.equal(h.tabText(OTHER), '{"memory":true}', '用户改动原样保留');
  assert.deepEqual(h.calls.posts, []);
});

test('没有打开的文档（或未保存改动的活动文档）不会被无谓读盘', async () => {
  const h = harness({});

  assert.deepEqual(await h.lifecycle.reloadDocuments(['file:///w/not-open.json']), []);
  assert.deepEqual(h.calls.loads, []);
});
