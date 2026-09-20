/**
 * 画布消息桥：截取/框选的结果要在**持有文档**的那份画布上落值。
 *
 * 详情栏是镜像画布（没有写权），框选却常常是在它上面点的：结果按消息里的
 * nodeId/key 落值，而不是只认本地 `state.roi`——否则镜像改了、真画布的卡片
 * 还停在旧参数上，随后的 replaceDocument 又把镜像改回去。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createCanvasMessages } = require('../dist-test-renderer/canvas/shell/messages.js');

function harness(options = {}) {
  const applied = [];
  const toasts = [];
  const dirties = [];
  const state = {
    raw: options.raw || {
      schema_version: 4, id: 'w', root: 'r', inputs: {}, variables: {},
      nodes: [{ id: 'r', type: 'root', children: ['t'] }, { id: 't', type: 'task', action: 'core.sleep', params: {} }],
    },
    roi: options.roi || null,
    assetPaths: new Set(),
    assetBrowser: options.assetBrowser || null,
    workflows: options.workflows || [],
  };
  const overlay = { classList: { add() {}, remove() {}, toggle() {} } };
  const deps = {
    state,
    $: () => overlay,
    mutate: (fn) => fn(),
    nodeById: (id) => (state.raw.nodes || []).find((node) => node.id === id) || null,
    normalizeRaw: (raw) => raw,
    clearVariableCardSelection() {}, setDirty(value) { dirties.push(value); }, render() {}, fitView() {}, ensureLayout() {},
    renderInstancePicker() {}, renderWorkflowPicker() {}, renderWorkflowBreadcrumb() {}, renderInspector() {},
    renderAssetBrowser() {}, closeAssetBrowser() {}, renderTemplateCheck() {},
    restoreAssetBrowserAfterRoi: () => applied.push('restoreAssetBrowser'),
    openRoiPicker() {}, requestAssetInventory() {},
    normalizedAssetPath: (value) => String(value || '').replace(/\\/g, '/'),
    handleRunEvent() {}, setExportBusy() {}, replaceDocument() {}, executeEditorCommand() {},
    toast: (message, error) => toasts.push([message, Boolean(error)]),
  };
  const messages = createCanvasMessages(deps);
  return { state, messages, applied, toasts, dirties };
}

test('templateSaved 没有本地 ROI 请求时按 nodeId/key 落值（详情栏镜像里点的截取）', () => {
  const { state, messages, toasts } = harness();
  messages.handleMessage({ type: 'templateSaved', requestId: 'r1', nodeId: 't', key: 'template', path: 'assets/templates/t.png' });
  const node = state.raw.nodes.find((item) => item.id === 't');
  assert.equal(node.params.template, 'assets/templates/t.png', '值落到文档里的节点上');
  assert.equal(state.assetPaths.has('assets/templates/t.png'), true, '新模板路径计入素材清单');
  assert.deepEqual(toasts, [['模板已保存', false]]);
});

test('roiPickerResult 没有本地 ROI 请求时按 nodeId/key 落值', () => {
  const { state, messages } = harness();
  messages.handleMessage({ type: 'roiPickerResult', requestId: 'r1', nodeId: 't', key: 'roi', roi: [10, 20, 30, 40] });
  assert.deepEqual(state.raw.nodes.find((item) => item.id === 't').params.roi, [10, 20, 30, 40]);
});

test('本地请求（自己发起的框选）仍然走请求里的 applyValue 并清掉浮层状态', () => {
  const applied = [];
  const { state, messages } = harness({
    roi: { requestId: 'r9', nodeId: 't', key: 'template', targetPath: 'assets/a.png', applyValue: (value) => applied.push(value) },
  });
  messages.handleMessage({ type: 'templateSaved', requestId: 'r9', nodeId: 't', key: 'template', path: 'assets/a.png' });
  assert.deepEqual(applied, ['assets/a.png'], '用请求里的 applyValue');
  assert.equal(state.roi, null, '收尾后清掉 ROI 状态');
  // 没有 nodeId/key 的陌生消息不该乱写参数。
  const lonely = harness();
  lonely.messages.handleMessage({ type: 'templateSaved', requestId: 'zz', path: 'assets/b.png' });
  assert.deepEqual(lonely.state.raw.nodes.find((item) => item.id === 't').params, {});
});

test('roiPickerResult 拒绝非法矩形，不写坏值', () => {
  const { state, messages } = harness();
  messages.handleMessage({ type: 'roiPickerResult', requestId: 'r1', nodeId: 't', key: 'roi', roi: [1, 2, 3] });
  messages.handleMessage({ type: 'roiPickerResult', requestId: 'r1', nodeId: 't', key: 'roi', roi: [1, 2, 3, 'x'] });
  assert.deepEqual(state.raw.nodes.find((item) => item.id === 't').params, {});
});

test('子工作流取消公开输入后清理父节点对应的传参与连线', () => {
  const uri = 'file:///project/workflows/child.json';
  const raw = {
    schema_version: 4, id: 'parent', inputs: {}, variables: {},
    nodes: [{id: 'run', type: 'task', action: 'workflow.run', params: {
      workflow: 'child.json',
      inputs: {运行轮数: {ref: 'inputs.rounds'}, 保留未知项: 7},
    }}],
    _variableLinks: {'run:inputs.运行轮数': 'card_1', 'run:inputs.保留未知项': 'card_2'},
  };
  const before = [{uri, rel: 'workflows/child.json', inputs: [{name: '运行轮数', definition: {type: 'integer'}}]}];
  const h = harness({raw, workflows: before});

  h.messages.handleMessage({type: 'workflows', workflows: [{uri, rel: 'workflows/child.json'}]});

  assert.deepEqual(raw.nodes[0].params.inputs, {保留未知项: 7});
  assert.equal(raw._variableLinks['run:inputs.运行轮数'], undefined);
  assert.equal(raw._variableLinks['run:inputs.保留未知项'], 'card_2', '不是刚取消公开的未知项不能误删');
  assert.equal(h.dirties.at(-1), true);
});
