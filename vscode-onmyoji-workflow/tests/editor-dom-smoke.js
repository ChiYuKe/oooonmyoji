/* 一次性 DOM 冒烟测试：用最小 DOM 桩加载 workflow-editor.js，
 * 注入 init 消息触发渲染，检查蓝图节点/引脚/连线结构，
 * 并模拟 UE 风格交互：引脚连线、点线选中删除、右键菜单添加节点、Delete 删除节点。
 * 状态断言通过点击「保存」按钮截获序列化 JSON 快照完成。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
  constructor() { this._s = new Set(); }
  add(...c) { c.forEach((x) => this._s.add(x)); }
  remove(...c) { c.forEach((x) => this._s.delete(x)); }
  toggle(c, force) { if (force === undefined ? !this._s.has(c) : force) this._s.add(c); else this._s.delete(c); }
  contains(c) { return this._s.has(c); }
}
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = {};
    this.textContent = '';
    this._listeners = {};
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  set innerHTML(v) { this.children = []; this._html = String(v); }
  get innerHTML() { return this._html || ''; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; this.children.push(c); return c; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 640 }; }
  get clientWidth() { return 900; }
  get clientHeight() { return 640; }
  scrollLeft = 0;
  scrollTop = 0;
  remove() {}
  focus() {}
  querySelector() { return null; }
}
const els = {};
const documentStub = {
  getElementById: (id) => (els[id] || (els[id] = new FakeEl('div'))),
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (ns, tag) => new FakeEl(tag),
  body: new FakeEl('div'),
  querySelector: () => null,
};
const winHandlers = {};
const windowStub = {
  innerWidth: 900,
  innerHeight: 640,
  addEventListener: (t, fn) => { (winHandlers[t] = winHandlers[t] || []).push(fn); },
  removeEventListener: () => {},
};
let saved = null;
const posted = [];
const vscodeStub = {
  postMessage: (m) => { posted.push(m); if (m && m.type === 'save') saved = m.text; },
  getState: () => ({}),
  setState: () => {},
};

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'workflow-editor.js'), 'utf8');
vm.runInNewContext(code, {
  document: documentStub,
  window: windowStub,
  acquireVsCodeApi: () => vscodeStub,
  clearTimeout, setTimeout, console,
}, { filename: 'workflow-editor.js' });

const workflow = {
  schema_version: 1,
  id: 'demo',
  version: '1.0.0',
  reference_resolution: [1920, 1080],
  entry: 'cap',
  limits: { timeout_seconds: 60, max_steps: 20 },
  inputs_schema: { type: 'object', properties: {} },
  steps: [
    { id: 'cap', action: 'core.capture', on_success: 'find' },
    { id: 'find', action: 'vision.match_template', with: { template: 'assets/templates/start/omg_icon.png', threshold: 0.85 }, when: { exists: { $ref: 'steps.cap.output.0' } }, on_failure: '$failure' },
    { id: 'tap', action: 'input.tap_match' },
  ],
};
const catalog = [
  { name: 'core.capture', description: '截屏', inputSchema: { type: 'object', properties: {} } },
  { name: 'vision.match_template', description: '匹配', inputSchema: { type: 'object', required: ['template'], properties: {
    template: { type: 'string' }, threshold: { type: 'number' },
    roi: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 },
  } } },
  { name: 'input.tap_match', description: '点击', inputSchema: { type: 'object', properties: {} } },
  { name: 'workflow.run', description: '运行工作流', inputSchema: { type: 'object', required: ['workflow'], properties: {
    workflow: { type: 'string' }, inputs: { type: 'object' },
  } } },
];
for (const fn of winHandlers['message'] || []) {
  fn({ data: { type: 'init', document: { name: 'demo.json', uri: 'x', text: JSON.stringify(workflow, null, 2) }, catalog, refs: { inputs: ['inputs.template'], steps: ['steps.cap.output.0'] }, issues: [] } });
}

// ---- 通用工具 ----
const svg = els['graph'];
const hasClass = (el, cls) => String(el.attrs.class || '').split(/\s+/).includes(cls);
const walk = (el, pred, out) => { for (const c of el.children || []) { if (pred(c)) out.push(c); walk(c, pred, out); } return out; };
const all = (pred) => walk(svg, pred, []);
const nodeById = (id) => all((el) => hasClass(el, 'node')).find((g) => g.dataset.id === id);

function fire(el, type, ev) { for (const fn of el._listeners[type] || []) fn(ev); }
function fireWin(type, ev) { for (const fn of winHandlers[type] || []) fn(ev); }
function ev(x) {
  return Object.assign({ button: 0, clientX: 0, clientY: 0, shiftKey: false, altKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {} }, x);
}
/** 点击「保存到 JSON」按钮，截获序列化快照。 */
function snapshot() {
  fire(els['btn-save'], 'click', ev({}));
  return JSON.parse(saved);
}
const inspectorAll = (pred) => walk(els['inspector-body'], pred, []);
const hasAnyClass = (el, cls) => hasClass(el, cls) || String(el.className || '').split(/\s+/).includes(cls);
function selectInspectorStep(id) {
  const node = nodeById(id);
  fire(node, 'mousedown', ev({ clientX: 110, clientY: 110 }));
  fireWin('mouseup', ev({ clientX: 110, clientY: 110 }));
}
// 世界坐标 → 屏幕坐标 = world + pan(20,20)，zoom=1

// ---- 结构检查 ----
const stepNodes = all((el) => hasClass(el, 'kind-step') || hasClass(el, 'kind-entry'));
const termNodes = all((el) => hasClass(el, 'kind-terminal'));
const inPins = all((el) => hasClass(el, 'port-in')).length;
const outPins = all((el) => hasClass(el, 'port-out')).length;
const pinLabels = all((el) => hasClass(el, 'pin-label')).length;
const edges = all((el) => hasClass(el, 'edge') && el.tagName === 'G');
const failureEdges = edges.filter((el) => hasClass(el, 'on_failure'));
const skipEdges = edges.filter((el) => hasClass(el, 'on_skip'));
const fallLabels = all((el) => hasClass(el, 'edge-label')).length;
const hasGrid = all((el) => hasClass(el, 'grid-bg')).length > 0;
const entryBadge = all((el) => hasClass(el, 'entry-badge')).length;
const seqBadges = all((el) => hasClass(el, 'node-seq')).length;
const defaultFailureHints = all((el) => hasClass(el, 'node-default') && el.textContent === '失败 → 终止').length;
const defaultSkipHints = all((el) => hasClass(el, 'node-default') && el.textContent === '跳过 → 下一步').length;
console.log(JSON.stringify({
  stepNodes: stepNodes.length, terminalNodes: termNodes.length, inputPins: inPins,
  outputPins: outPins, pinLabels, edges: edges.length, fallthroughLabels: fallLabels,
  grid: hasGrid, entryBadge, seqBadges, defaultFailureHints, defaultSkipHints,
}, null, 2));
const structureOk =
  stepNodes.length === 3 && termNodes.length === 3 && inPins === 6 && outPins === 9 &&
  pinLabels === 9 && edges.length >= 4 && fallLabels >= 2 && hasGrid && entryBadge === 1 &&
  seqBadges === 3 && defaultFailureHints === 2 && defaultSkipHints === 1 &&
  failureEdges.length === 1 && skipEdges.length === 0;

// ---- 曲线检查：垂直距离不应把相邻节点之间的连线拉成大幅回摆 ----
const capToFind = edges.find((el) => hasClass(el, 'on_success') && !hasClass(el, 'fallthrough'));
const capToFindPath = capToFind && capToFind.children.find((el) => el.tagName === 'PATH');
const capToFindNumbers = capToFindPath ? String(capToFindPath.attrs.d || '').match(/-?\d+(?:\.\d+)?/g).map(Number) : [];
const curveOk = capToFindNumbers.length === 8 &&
  Math.abs(capToFindNumbers[2] - capToFindNumbers[0]) <= 140 &&
  Math.abs(capToFindNumbers[6] - capToFindNumbers[4]) <= 140;
console.log('curve tension bounded:', curveOk);

// ---- 参数编辑器：字符串、固定数组、引用切换 ----
selectInspectorStep('find');
const templateInput = inspectorAll((el) => el.tagName === 'INPUT' && el.type === 'text' && String(el.value).includes('assets/templates/start/omg_icon.png'))[0];
templateInput.value = 'assets/templates/other/icon.png';
fire(templateInput, 'change', ev({}));
const stringSnapshot = snapshot();
const parameterStringSaved = stringSnapshot.steps.find((s) => s.id === 'find').with.template === 'assets/templates/other/icon.png';

const roiPickButton = inspectorAll((el) => hasAnyClass(el, 'roi-pick-button') && el.title === '从 MuMu 截图框选 ROI')[0];
fire(roiPickButton, 'click', ev({}));
const cancelledRoiRequest = posted.filter((message) => message && message.type === 'pickRoi').slice(-1)[0];
for (const fn of winHandlers['message'] || []) {
  fn({ data: { type: 'roiPickerCancelled', requestId: cancelledRoiRequest && cancelledRoiRequest.requestId } });
}
const roiPickButtonAfterCancel = inspectorAll((el) => hasAnyClass(el, 'roi-pick-button') && el.title === '从 MuMu 截图框选 ROI')[0];
fire(roiPickButtonAfterCancel, 'click', ev({}));
const roiRequest = posted.filter((message) => message && message.type === 'pickRoi').slice(-1)[0];
const roiRequestOk = !!roiRequest && roiRequest.stepId === 'find' &&
  JSON.stringify(roiRequest.referenceResolution) === JSON.stringify([1920, 1080]);
for (const fn of winHandlers['message'] || []) {
  fn({ data: {
    type: 'roiPickerImage',
    requestId: roiRequest && roiRequest.requestId,
    stepId: 'find',
    key: 'roi',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 1000,
    height: 500,
    referenceResolution: [1920, 1080],
  } });
}
const roiPickerOverlay = els['roi-picker'];
const roiPickerStage = walk(roiPickerOverlay, (el) => hasAnyClass(el, 'roi-picker-stage'), [])[0];
const roiPickerImage = walk(roiPickerStage, (el) => el.tagName === 'IMG', [])[0];
const roiPickerConfirm = walk(roiPickerOverlay, (el) => el.tagName === 'BUTTON' && el.textContent === '确认选择', [])[0];
const roiPickerEmbedded = !!roiPickerStage && !!roiPickerImage && !!roiPickerConfirm &&
  !roiPickerOverlay.classList.contains('hidden') && roiPickerImage.src === 'data:image/png;base64,AAAA';
fire(roiPickerStage, 'mousedown', ev({ clientX: 90, clientY: 64 }));
fireWin('mousemove', ev({ clientX: 270, clientY: 192 }));
fireWin('mouseup', ev({ clientX: 270, clientY: 192 }));
const roiSelection = walk(roiPickerOverlay, (el) => hasAnyClass(el, 'roi-picker-selection'), [])[0];
const roiSelectionDrawn = !!roiSelection && !roiSelection.classList.contains('hidden') &&
  roiPickerConfirm.disabled === false;
fire(roiPickerConfirm, 'click', ev({}));
const pickedRoiSnapshot = snapshot();
const pickedRoi = pickedRoiSnapshot.steps.find((s) => s.id === 'find').with.roi;
const roiPickerSaved = Array.isArray(pickedRoi) && pickedRoi.join(',') === '192,108,384,216';

const roiEditor = inspectorAll((el) => hasAnyClass(el, 'array-editor'))[0];
const roiInputs = walk(roiEditor, (el) => el.tagName === 'INPUT', []);
['1', '2', '300', '180'].forEach((value, index) => {
  roiInputs[index].value = value;
  fire(roiInputs[index], 'change', ev({}));
});
const arraySnapshot = snapshot();
const arrayValue = arraySnapshot.steps.find((s) => s.id === 'find').with.roi;
const arraySaved = Array.isArray(arrayValue) && arrayValue.join(',') === '1,2,300,180';

const templateRefButton = inspectorAll((el) => hasAnyClass(el, 'param-icon-button') && el.title === '引用已有值')[0];
fire(templateRefButton, 'click', ev({}));
const templateRef = inspectorAll((el) => hasAnyClass(el, 'param-ref-select'))[0];
templateRef.value = 'steps.cap.output.0';
fire(templateRef, 'change', ev({}));
const referenceSnapshot = snapshot();
const referenceSaved = referenceSnapshot.steps.find((s) => s.id === 'find').with.template.$ref === 'steps.cap.output.0';
console.log('parameter editor string/embedded roi picker/array/ref:', parameterStringSaved, roiRequestOk, roiPickerEmbedded, roiSelectionDrawn, roiPickerSaved, arraySaved, referenceSaved);

// ---- 交互 1：从 cap 的「跳过」引脚拖到 tap 的输入引脚连线 ----
const capNode = nodeById('cap');
const skipPin = walk(capNode, (el) => hasClass(el, 'port-out-skip'), []).find((el) => el.tagName === 'CIRCLE');
fire(skipPin, 'mousedown', ev({ clientX: 40 + 280 + 20, clientY: 40 + 98 + 20 })); // cap 跳过引脚 (320,138)
fireWin('mousemove', ev({ clientX: 200, clientY: 400 }));
// 磁吸断言：进入 tap 输入引脚命中区后（非正中心），橡皮筋吸附到引脚中心 (40,562)
fireWin('mousemove', ev({ clientX: 40 + 20 + 4, clientY: 512 + 50 + 20 + 3 }));
const connectEdge = all((el) => hasClass(el, 'edge') && hasClass(el, 'connect')).find((el) => el.tagName === 'G');
const snappedClass = !!connectEdge && hasClass(connectEdge, 'snapped');
const snapPath = connectEdge ? connectEdge.children.find((c) => c.tagName === 'PATH') : null;
const snapOk = !!snapPath && String(snapPath.attrs.d || '').endsWith(' 40 562');
console.log('interaction[1b] snap-to-pin:', snappedClass, snapOk);
fireWin('mousemove', ev({ clientX: 40 + 20, clientY: 512 + 50 + 20 })); // tap 输入引脚 (40,562)
fireWin('mouseup', ev({ clientX: 40 + 20, clientY: 512 + 50 + 20 }));
const s1 = snapshot();
const connected = s1.steps[0].on_skip === 'tap';
console.log('interaction[1] pin-connect cap.on_skip -> tap:', connected);

// ---- 交互 2：点击该连线选中，按 Delete 删除 ----
const skipEdge = all((el) => hasClass(el, 'edge') && hasClass(el, 'on_skip') && !hasClass(el, 'fallthrough')).find((el) => el.tagName === 'G');
fire(skipEdge, 'mousedown', ev({ clientX: 200, clientY: 300 }));
fireWin('keydown', ev({ key: 'Delete', target: documentStub.body }));
const s2 = snapshot();
const wireDeleted = s2.steps[0].on_skip === undefined;
console.log('interaction[2] wire select + Delete:', wireDeleted);

// ---- 交互 3：右键单击空白 → 面板菜单 → 点击添加步骤 ----
fire(svg, 'mousedown', ev({ button: 2, clientX: 300, clientY: 300 }));
fireWin('mouseup', ev({ button: 2, clientX: 300, clientY: 300 }));
const menu = walk(els['canvas-wrap'], (el) => String(el.className || '').includes('palette-menu'), [])[0];
const menuShown = !!menu;
if (menuShown) {
  const addBtn = menu.children.find((c) => c.tagName === 'BUTTON' && c.textContent.includes('core.capture'));
  fire(addBtn, 'click', ev({}));
}
const s3 = snapshot();
const menuAdded = menuShown && s3.steps.length === 4 && s3.steps.some((st) => st.id === 'step_1');
console.log('interaction[3] right-click palette add step:', menuShown, '-> steps:', s3.steps.length);

// ---- 交互 4：点击 cap 节点（选中），按 Delete 删除该步骤 ----
fire(capNode, 'mousedown', ev({ clientX: 110, clientY: 110 }));
fireWin('mouseup', ev({ clientX: 110, clientY: 110 }));
fireWin('keydown', ev({ key: 'Delete', target: documentStub.body }));
const s4 = snapshot();
const findAfterDelete = s4.steps.find((st) => st.id === 'find');
const nodeDeleted = s4.steps.length === 3 && s4.entry === 'find' && !s4.steps.some((st) => st.id === 'cap') && !findAfterDelete.when;
console.log('interaction[4] node select + Delete:', nodeDeleted);

// ---- 交互 5：运行事件 → 卡片缩略图 + 点击查看大图 + Esc 关闭 ----
const postEvent = (event) => { for (const fn of winHandlers['message'] || []) fn({ data: { type: 'runEvent', event } }); };
postEvent({ type: 'run_started', run_id: 'r1', status: 'running' });
postEvent({ type: 'step', run_id: 'r1', step_id: 'find', step: { status: 'running', action: 'vision.match_template' } });
const findRunning = nodeById('find');
const runningText = walk(findRunning, (el) => hasClass(el, 'node-duration') && el.textContent === '运行中…', [])[0];
const runningShown = !!runningText;
console.log('interaction[5a] running indicator:', runningShown);
postEvent({
  type: 'step',
  run_id: 'r1',
  step_id: 'find',
  step: { status: 'succeeded', action: 'vision.match_template', duration_ms: 123 },
  thumbnail: 'QUJD',
  screenshot: 'file:///x/find.png',
});
const runNode = nodeById('find');
const durTextEl = walk(runNode, (el) => hasClass(el, 'node-duration'), []).find((el) => el.textContent.includes('123'));
const durationShown = !!durTextEl && durTextEl.textContent.includes('ms');
console.log('interaction[5c] duration on card:', durationShown);
const thumbEl = walk(runNode, (el) => hasClass(el, 'step-thumb'), [])[0];
const statusClassApplied = String(runNode.attrs.class || '').split(/\s+/).includes('run-succeeded');
const thumbShown = !!thumbEl && String(thumbEl.attrs.href || '').startsWith('data:image/png;base64,QUJD');
let previewShown = false;
let previewHidden = false;
if (thumbEl) {
  fire(thumbEl, 'mousemove', ev({ clientX: 50, clientY: 60 }));
  const preview = els['thumb-preview'];
  previewShown = !!preview && !preview.classList.contains('hidden') &&
    preview.children[0] && preview.children[0].src === 'file:///x/find.png';
  fire(thumbEl, 'mouseleave', ev({}));
  previewHidden = !!preview && preview.classList.contains('hidden');
}
console.log('interaction[5b] hover preview:', previewShown, previewHidden);
if (thumbEl) fire(thumbEl, 'mousedown', ev({ clientX: 30, clientY: 80 }));
const lb = els['lightbox'];
const boxOpen = !!lb && !lb.classList.contains('hidden');
const lbImgSrc = boxOpen && lb.children[0] && lb.children[0].children[1] ? lb.children[0].children[1].src : null;
const lbTitle = boxOpen && lb.children[0] && lb.children[0].children[0] ? lb.children[0].children[0].textContent : '';
const lightboxShown = boxOpen && lbImgSrc === 'file:///x/find.png' && lbTitle.includes('123ms');
fireWin('keydown', ev({ key: 'Escape', target: documentStub.body }));
const lightboxClosed = !!lb && lb.classList.contains('hidden');
console.log('interaction[5] run thumbnail + lightbox:', statusClassApplied, thumbShown, lightboxShown, lightboxClosed);

// ---- 交互 6：runReplay 重放（模拟扩展回放上次运行） ----
for (const fn of winHandlers['message'] || []) {
  fn({
    data: {
      type: 'runReplay',
      events: [
        { type: 'run_started', run_id: 'r2', status: 'running' },
        { type: 'step', run_id: 'r2', step_id: 'tap', step: { status: 'succeeded', action: 'input.tap_match' }, thumbnail: 'UkVQ' },
        { type: 'run_finished', run_id: 'r2', status: 'succeeded' },
      ],
    },
  });
}
const tapAfterReplay = nodeById('tap');
const replayThumb = walk(tapAfterReplay, (el) => hasClass(el, 'step-thumb'), [])[0];
const replayApplied = !!replayThumb && String(replayThumb.attrs.href || '').startsWith('data:image/png;base64,UkVQ');
console.log('interaction[6] runReplay thumbnail:', replayApplied);

// ---- 交互 7：节点拖动 → 布局写入原脚本（_layout）→ 重开恢复 ----
// cap 已被删除，tap 是当前第 2 个步骤，自动布局位置 (40,276)；拖 (100,100) 后吸附到 12px 网格 → (144,372)
fire(tapAfterReplay, 'mousedown', ev({ clientX: 40 + 20, clientY: 276 + 20 }));
fireWin('mousemove', ev({ clientX: 40 + 20 + 100, clientY: 276 + 20 + 100 }));
fireWin('mouseup', ev({ clientX: 40 + 20 + 100, clientY: 276 + 20 + 100 }));
const s7 = snapshot();
const layoutWritten = !!s7._layout && !!s7._layout.tap &&
  s7._layout.tap.x === 144 && s7._layout.tap.y === 372;
console.log('interaction[7] layout written into workflow JSON (_layout):', layoutWritten);
// 模拟重开面板：带 _layout 的 JSON 重新加载 → 卡片恢复位置
for (const fn of winHandlers['message'] || []) {
  fn({ data: { type: 'init', document: { name: 'demo.json', uri: 'x', text: JSON.stringify(s7, null, 2) }, catalog, refs: { inputs: ['inputs.template'], steps: ['steps.cap.output.0'] }, issues: [] } });
}
const tapAfterLoad = nodeById('tap');
const restored = !!tapAfterLoad && String(tapAfterLoad.attrs.transform || '').includes('translate(144,372)');
console.log('interaction[7] layout restored after reopen:', restored);

// ---- 参数编辑器：workflow.run 的 inputs 对象字段增删 ----
selectInspectorStep('tap');
const tapAction = inspectorAll((el) => hasAnyClass(el, 'action-select'))[0];
tapAction.value = 'workflow.run';
fire(tapAction, 'change', ev({}));
const workflowInput = inspectorAll((el) => el.tagName === 'INPUT' && el.type === 'text' && el.placeholder === '例如 workflows/demo.json')[0];
workflowInput.value = 'workflows/sub.json';
fire(workflowInput, 'change', ev({}));
const inputsEditor = inspectorAll((el) => hasAnyClass(el, 'object-editor'))[0];
const addInputField = walk(inputsEditor, (el) => hasAnyClass(el, 'object-add'), [])[0];
fire(addInputField, 'click', ev({}));
let inputRow = walk(inputsEditor, (el) => hasAnyClass(el, 'object-row'), [])[0];
const inputKey = inputRow.children.find((el) => hasAnyClass(el, 'object-key'));
inputKey.value = 'ok';
fire(inputKey, 'change', ev({}));
const inputMode = inputRow.children.find((el) => hasAnyClass(el, 'object-mode'));
inputMode.value = 'boolean';
fire(inputMode, 'change', ev({}));
const inputValue = inputRow.children[2].children[0];
inputValue.value = 'true';
fire(inputValue, 'change', ev({}));
const objectSnapshot = snapshot();
const runStep = objectSnapshot.steps.find((s) => s.id === 'tap');
const objectAdded = runStep.action === 'workflow.run' && runStep.with.workflow === 'workflows/sub.json' && runStep.with.inputs.ok === true;
const removeInputField = inputRow.children.find((el) => hasAnyClass(el, 'icon-button'));
fire(removeInputField, 'click', ev({}));
const objectDeleteSnapshot = snapshot();
const objectDeleted = objectDeleteSnapshot.steps.find((s) => s.id === 'tap').with.inputs === undefined;
console.log('parameter editor object add/delete:', objectAdded, objectDeleted);

// ---- ROI 选择器：inputs.roi 引用保持不变，只更新输入默认值 ----
const refWorkflow = JSON.parse(JSON.stringify(s7));
refWorkflow.inputs_schema.properties.roi = {
  type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4, default: [0, 0, 1920, 1080],
};
const refFind = refWorkflow.steps.find((step) => step.id === 'find');
refFind.with = { ...(refFind.with || {}), roi: { $ref: 'inputs.roi' } };
for (const fn of winHandlers['message'] || []) {
  fn({ data: { type: 'init', document: { name: 'demo.json', uri: 'x', text: JSON.stringify(refWorkflow, null, 2) }, catalog, refs: { inputs: ['inputs.roi'], steps: [] }, issues: [] } });
}
selectInspectorStep('find');
const refRoiPicker = inspectorAll((el) => hasAnyClass(el, 'roi-pick-button'))[0];
fire(refRoiPicker, 'click', ev({}));
const refRoiRequest = posted.filter((message) => message && message.type === 'pickRoi').slice(-1)[0];
for (const fn of winHandlers['message'] || []) {
  fn({ data: { type: 'roiSelected', requestId: refRoiRequest && refRoiRequest.requestId, stepId: 'find', key: 'roi', roi: [20, 30, 400, 200] } });
}
const refRoiSnapshot = snapshot();
const refRoiStep = refRoiSnapshot.steps.find((step) => step.id === 'find');
const refRoiKept = refRoiStep.with.roi.$ref === 'inputs.roi' &&
  refRoiSnapshot.inputs_schema.properties.roi.default.join(',') === '20,30,400,200';
console.log('ROI picker preserves inputs.roi reference:', refRoiKept);

const ok = structureOk && connected && snappedClass && snapOk && wireDeleted && menuAdded && nodeDeleted &&
  curveOk &&
  parameterStringSaved && roiRequestOk && roiPickerEmbedded && roiSelectionDrawn && roiPickerSaved && arraySaved && referenceSaved &&
  runningShown && durationShown && statusClassApplied && thumbShown && previewShown && previewHidden &&
  lightboxShown && lightboxClosed && replayApplied && layoutWritten && restored &&
  parameterStringSaved && arraySaved && referenceSaved && objectAdded && objectDeleted && refRoiKept;
console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1);
