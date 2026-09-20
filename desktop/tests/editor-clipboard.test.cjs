// Run via npm test.
// 跨画布复制粘贴：剪贴板归壳层保管，复制后广播给所有「持有文档」的画布，
// 新画布握手时补发；详情栏镜像没有写权，不该拿到剪贴板。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createEditorHost} = require('../dist-test-renderer/renderer/editor-host.js');

function payload(id = 'a') {
  return {version: 1, sourceUri: 'file:///w/a.json', nodes: [{id}], layout: {[id]: {x: 1, y: 2}}, variables: [], cards: []};
}

function harness() {
  const posts = [];
  const detailsFrame = {id: 'details-frame'};
  const documentFrame = {id: 'workflow:file:///w.json'};
  const otherFrame = {id: 'workflow:file:///w2.json'};
  const runtimes = new Map([
    ['file:///w.json', {frame: documentFrame, init: {document: {text: '{}'}}}],
    ['file:///w2.json', {frame: otherFrame, init: {document: {text: '{}'}}}],
  ]);
  const stored = [];
  const workspace = {
    frameUriForFrame: (frame) => [...runtimes.entries()].find(([, runtime]) => runtime.frame === frame)?.[0],
    activeUri: () => 'file:///w.json',
    getDocumentRuntimes: () => runtimes,
    setCanvasClipboard: (value) => stored.push(value),
    postToFrame: (frame, message) => posts.push(['frame', frame.id, message]),
    postToDocumentEditors: (message) => posts.push(['documents', message]),
    postToEditors: () => {},
    postToAllEditors: () => {},
  };
  const host = createEditorHost({
    api: {}, workspace, detailsFrame, sidebar: {}, roiPicker: {},
    showToast: () => {}, errorMessage: (error) => String(error), setStatus: () => {},
    showDetailsPanel: () => {}, showRuntimePanel: () => {}, openContentBrowserSearch: () => {},
    openReferences: () => {}, getDocumentFrame: () => documentFrame,
    getSelectedInstance: () => '', createNewWorkflow: async () => {}, switchWorkflow: async () => {},
    ensureDocument: () => {}, openWorkflowTab: async () => {}, loadWorkflow: async () => {},
    loadDocumentOnce: async () => {}, sendDocumentInit: () => {}, resolveWorkflow: () => undefined,
    selectInstance: () => {},
  });
  return {host, posts, stored, documentFrame, detailsFrame};
}

test('复制后壳层保管剪贴板并广播给所有文档画布（含弹出面板）', async () => {
  const h = harness();
  const clipboard = payload();

  await h.host.handleMessage({type: 'clipboardWrite', clipboard}, h.documentFrame);

  assert.deepEqual(h.stored, [clipboard], '壳层保存一份，其他画布后续粘贴都用它');
  const broadcasts = h.posts.filter(([kind]) => kind === 'documents');
  assert.equal(broadcasts.length, 1);
  assert.deepEqual(broadcasts[0][1], {type: 'clipboard', clipboard});
  assert.deepEqual(h.posts.filter(([kind, id]) => kind === 'frame' && id === h.detailsFrame.id), [],
    '详情栏是镜像，没有写权，不下发剪贴板');
});

test('畸形的剪贴板被忽略：不覆盖已有内容、也不广播', async () => {
  const h = harness();
  await h.host.handleMessage({type: 'clipboardWrite', clipboard: {version: 9, nodes: [{id: 'a'}]}}, h.documentFrame);
  await h.host.handleMessage({type: 'clipboardWrite', clipboard: 'nope'}, h.documentFrame);

  assert.deepEqual(h.stored, []);
  assert.deepEqual(h.posts.filter(([kind]) => kind === 'documents'), []);
});
