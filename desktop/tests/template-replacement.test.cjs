const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParameterControls } = require('../dist-test-renderer/canvas/inspector/parameter-controls.js');
const { createAssetBrowser } = require('../dist-test-renderer/canvas/interactions/asset-browser.js');
const { createAssetActions } = require('../dist-test-renderer/canvas/interactions/asset-actions.js');
const { createEditorHost } = require('../dist-test-renderer/renderer/editor-host.js');
const { createRoiPicker } = require('../dist-test-renderer/renderer/roi-picker.js');

function element(tag, className = '', textContent = '') {
  return { tag, className, textContent, children: [], events: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
    appendChild(child) { this.children.push(child); }, addEventListener(type, fn) { this.events[type] = fn; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
  };
}

test('replacement button forwards current input path through asset browser to screenshot request', () => {
  const messages = [];
  const state = { raw: { resolution: [1920, 1080] }, instanceId: 'mumu', roi: null };
  const actions = createAssetActions({ state, vscode: { postMessage: message => messages.push(message) } });
  const browser = createAssetBrowser({ state, requestRoi: actions.requestRoi, toast: message => assert.fail(message) });
  const controls = createParameterControls({ state, el: element, UI: { ICON_SVG: {} },
    textInput: value => Object.assign(element('input'), { value }),
    assetPathStatus: () => 'available', bindAssetPreview() {}, appendMissingAssetAction() {},
    requestTemplateReplacement: browser.requestTemplateReplacement,
  });
  const node = { id: 'wait_floor_from_map', params: { template: 'assets/old.png' } };
  for (const control of [
    controls.literalControl(node, 'template', { type: 'asset' }, 'assets/old.png'),
    controls.scalarValueControl({ type: 'asset' }, 'assets/old.png', () => {}, { node, key: 'template' }),
  ]) {
    control.children[0].value = 'assets/templates/souls/party/floor-team-button.png';
    control.children.find(child => child.textContent === '替换').events.click();
    assert.equal(messages.at(-1).type, 'pickRoi');
    assert.equal(messages.at(-1).targetPath, control.children[0].value);
    assert.equal(messages.at(-1).nodeId, node.id);
  }
});

test('host shows capture dialog before waiting and falls back to selected instance for empty mirror instance', async () => {
  const events = [];
  let resolveCapture;
  const capture = new Promise(resolve => { resolveCapture = resolve; });
  const frame = {};
  const host = createEditorHost({
    api: { captureRoi(request) { events.push(['capture', request]); return capture; } },
    workspace: { frameUriForFrame: () => undefined, activeUri: () => 'workflow', getDocumentRuntimes: () => new Map() },
    roiPicker: { open: request => events.push(['open', request]), completeCapture: (...args) => events.push(['complete', ...args]) },
    getDocumentFrame: () => frame, getSelectedInstance: () => 'selected-instance',
    errorMessage: String, showToast: message => assert.fail(message),
  });
  const pending = host.handleMessage({ type: 'pickRoi', requestId: 'r', instanceId: '', targetPath: 'assets/a.png' }, {});
  assert.deepEqual(events.map(event => event[0]), ['open', 'capture']);
  assert.equal(events[0][1].sourceFrame, frame);
  assert.equal(events[0][1].dataUrl, '');
  assert.equal(events[1][1].instanceId, 'selected-instance');
  resolveCapture({ dataUrl: 'data:image/png;base64,x', width: 100, height: 100 });
  await pending;
  assert.equal(events.at(-1)[0], 'complete');
});

test('cancelled or superseded capture cannot reopen or overwrite the current picker', () => {
  global.window = { requestAnimationFrame: fn => fn() };
  const nodes = Object.fromEntries(['modal', 'title', 'subtitle', 'stage', 'image', 'selection', 'hint', 'cancelButton', 'confirmButton', 'closeButton'].map(name => [name, element(name)]));
  const replies = [];
  const picker = createRoiPicker({ ...nodes, postToFrame: (...args) => replies.push(args), showToast() {}, errorMessage: String });
  const request = { requestId: 'first', mode: 'asset', sourceFrame: {}, referenceResolution: [100, 100], dataUrl: '', imageWidth: 0, imageHeight: 0 };
  picker.open(request);
  assert.equal(nodes.confirmButton.disabled, true);
  assert.match(nodes.hint.textContent, /正在获取/);
  picker.cancel();
  picker.completeCapture('first', { dataUrl: 'old', width: 100, height: 100 });
  assert.equal(picker.isOpen(), false);
  picker.open({ ...request, requestId: 'second' });
  picker.completeCapture('first', { dataUrl: 'old', width: 100, height: 100 });
  picker.failCapture('first');
  assert.equal(picker.isOpen(), true);
  assert.equal(nodes.confirmButton.disabled, true);
  picker.completeCapture('second', { dataUrl: 'new', width: 100, height: 100 });
  assert.equal(nodes.image.src, 'new');
  assert.equal(nodes.confirmButton.disabled, false);
  picker.failCapture('second');
  assert.equal(picker.isOpen(), false);
});

test('capture failure closes loading dialog and reports the error to the requester and user', async () => {
  const events = [];
  const frame = {};
  const host = createEditorHost({
    api: { captureRoi: async () => { throw new Error('模拟器未连接'); } },
    workspace: { frameUriForFrame: () => undefined, activeUri: () => 'workflow',
      postToFrame: (source, message) => events.push(['reply', source, message]) },
    roiPicker: { open() {}, failCapture: id => events.push(['close', id]) },
    getSelectedInstance: () => 'mumu', errorMessage: error => error.message,
    showToast: (message, error) => events.push(['toast', message, error]), setStatus() {},
  });
  await host.handleMessage({ type: 'pickRoi', requestId: 'failed' }, frame);
  assert.deepEqual(events[0], ['close', 'failed']);
  assert.equal(events[1][1], frame);
  assert.equal(events[1][2].type, 'roiPickerError');
  assert.deepEqual(events[2], ['toast', '模拟器未连接', true]);
});
