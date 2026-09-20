// Run via npm test.
// 详情栏（镜像画布）里的编辑必须落到真正持有文档的那份画布上：镜像没有文档写权，
// 只在本地改的话卡片会停在旧值上，真画布下一次上报又会把这份改动覆盖掉。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createEditorHost} = require('../dist-test-renderer/renderer/editor-host.js');

function harness() {
  const posts = [];
  const detailsFrame = { id: 'details-frame' };
  const documentFrame = { id: 'workflow:file:///w.json' };
  const runtime = { frame: documentFrame, init: { document: { text: '{}' } } };
  const workspace = {
    frameUriForFrame: (frame) => (frame === documentFrame ? 'file:///w.json' : undefined),
    activeUri: () => 'file:///w.json',
    getDocumentRuntimes: () => new Map([['file:///w.json', runtime]]),
    setDocumentText: (uri, text) => posts.push(['text', uri, text]),
    syncWorkflowDescriptor: (uri, text) => posts.push(['descriptor', uri, text]),
    setDirty: (value) => posts.push(['dirty', value]),
    setDocumentDirty: (uri, value) => posts.push(['documentDirty', uri, value]),
    scheduleAutoSave: (text) => posts.push(['autosave', text]),
    postToFrame: (frame, payload) => posts.push(['post', frame === documentFrame ? 'document' : 'details', payload]),
    postToEditors: () => {},
    postToAllEditors: () => {},
  };
  const host = createEditorHost({
    api: {}, workspace, detailsFrame, sidebar: {}, roiPicker: {},
    showToast: () => {}, errorMessage: (error) => String(error), setStatus: () => {},
    showDetailsPanel: () => {}, showRuntimePanel: () => {}, openContentBrowserSearch: () => {},
    openReferences: () => {}, getDocumentFrame: (uri) => (uri === 'file:///w.json' ? documentFrame : undefined),
    getSelectedInstance: () => '', createNewWorkflow: async () => {}, switchWorkflow: async () => {},
    ensureDocument: () => {}, openWorkflowTab: async () => {}, loadWorkflow: async () => {},
    loadDocumentOnce: async () => {}, sendDocumentInit: () => {}, resolveWorkflow: () => undefined,
    selectInstance: () => {},
  });
  return { host, posts, detailsFrame, documentFrame, runtime };
}

const changed = (text) => ({ type: 'documentStateChanged', text, dirty: true });
const postsTo = (posts, target) => posts
  .filter(([kind, name]) => kind === 'post' && name === target)
  .map(([, , payload]) => payload);

test('详情栏换动作/改参数：改动推给持有文档的画布', async () => {
  const h = harness();
  await h.host.handleMessage(changed('{"nodes":[{"id":"tap","action":"vision.wait_template"}]}\n'), h.detailsFrame);

  const toDocument = postsTo(h.posts, 'document');
  assert.equal(toDocument.length, 1, '镜像里的编辑必须发给文档画布');
  assert.equal(toDocument[0].type, 'replaceDocument');
  assert.match(toDocument[0].text, /vision\.wait_template/);
  assert.equal(toDocument[0].recordHistory, true, '要记进画布历史，画布上 Ctrl+Z 才能撤销');
  // 镜像自己也收一份（内容相同即为空操作），两边渲染保持一致。
  assert.equal(postsTo(h.posts, 'details')[0].type, 'replaceDocument');
  // 活动文档的运行时快照也要跟上，镜像重载时不会拿回旧正文。
  assert.match(h.runtime.init.document.text, /vision\.wait_template/);
  // 仍然算一次真实编辑：脏标记 + 自动保存，且写的是活动文档。
  assert.deepEqual(
    h.posts.filter(([kind]) => kind !== 'post').map(([kind, value]) => [kind, value]),
    [
      ['text', 'file:///w.json'],
      ['descriptor', 'file:///w.json'],
      ['dirty', true],
      ['autosave', '{"nodes":[{"id":"tap","action":"vision.wait_template"}]}\n'],
    ],
  );
});

test('文档画布自己的编辑不回推给自己', async () => {
  const h = harness();
  await h.host.handleMessage(changed('{"nodes":[]}\n'), h.documentFrame);
  assert.deepEqual(postsTo(h.posts, 'document'), [], '来源就是文档画布时不要再推一次');
  assert.equal(postsTo(h.posts, 'details').length, 1);
});
