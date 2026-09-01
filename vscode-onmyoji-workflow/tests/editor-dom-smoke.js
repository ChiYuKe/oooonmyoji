/* Minimal DOM smoke test for the Behavior Tree v3 webview. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
  constructor() { this._s = new Set(); }
  add(...values) { values.forEach((value) => this._s.add(value)); }
  remove(...values) { values.forEach((value) => this._s.delete(value)); }
  toggle(value, force) { const add = force === undefined ? !this._s.has(value) : force; if (add) this._s.add(value); else this._s.delete(value); return add; }
  contains(value) { return this._s.has(value); }
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {};
    this.classList = new FakeClassList(); this.style = {}; this.textContent = ''; this._listeners = {}; this.parentNode = null; this.id = '';
    this.value = ''; this.checked = false; this.selected = false; this.disabled = false; this.type = '';
  }
  get className() { return [...this.classList._s].join(' '); }
  set className(value) { this.classList._s = new Set(String(value).split(/\s+/).filter(Boolean)); }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = value; }
  getAttribute(key) { return this.attrs[key]; }
  set innerHTML(value) { this.children = []; this._html = String(value); }
  get innerHTML() { return this._html || ''; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 900, bottom: 640, width: 900, height: 640 }; }
  get clientWidth() { return 900; }
  get clientHeight() { return 640; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  focus() {}
  select() {}
  getContext() { return { drawImage() {} }; }
  toDataURL(type = 'image/png') { return `data:${type};base64,QUJD`; }
  querySelectorAll(selector) {
    const match = /^image\.node-preview-image$/.exec(String(selector));
    if (!match) return [];
    return walk(this, (item) => item.tagName === 'IMAGE' && item.classList.contains('node-preview-image'));
  }
}

const els = {};
function walk(root, predicate, out = []) {
  for (const child of root && root.children || []) { if (predicate(child)) out.push(child); walk(child, predicate, out); }
  return out;
}
function findById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) { const found = findById(child, id); if (found) return found; }
  return null;
}
const body = new FakeEl('body');
const documentStub = {
  body,
  getElementById(id) { return els[id] || findById(body, id) || (els[id] = new FakeEl(id === 'graph' || id === 'minimap' ? 'svg' : id === 'instance-select' ? 'select' : 'div')); },
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (namespace, tag) => new FakeEl(tag),
  createTextNode: (text) => { const node = new FakeEl('#text'); node.textContent = String(text); return node; },
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  querySelectorAll(selector) { return selector === '.context-menu' ? walk(body, (item) => item.classList.contains('context-menu')) : []; },
  _listeners: {},
};
const windowStub = {
  innerWidth: 900, innerHeight: 640, _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
};
let saved = '';
const posted = [];
const vscodeStub = {
  postMessage(message) { posted.push(message); if (message.type === 'save') saved = message.text; },
  getState: () => ({}), setState() {},
};

const code = fs.readFileSync(path.join(__dirname, '..', 'media', 'workflow-editor.js'), 'utf8');
vm.runInNewContext(code, { document: documentStub, window: windowStub, acquireVsCodeApi: () => vscodeStub, setTimeout, clearTimeout, console }, { filename: 'workflow-editor.js' });

const workflow = {
  schema_version: 3,
  id: 'demo', version: '3.0.0', description: '编辑器 DOM 测试主流程', resolution: [1920, 1080], root: 'root',
  limits: { timeout_seconds: 60, max_steps: 100 },
  blackboard: { template: { type: 'asset', default: 'assets/templates/start/yys_tubiao.png' } },
  nodes: [
    { id: 'root', type: 'root', children: ['main'] },
    { id: 'main', type: 'sequence', children: ['capture', 'selector'] },
    { id: 'capture', type: 'task', action: 'core.capture', params: {} },
    { id: 'selector', type: 'selector', children: ['find', 'fallback'] },
    { id: 'find', type: 'task', name: 'Find Target', action: 'vision.match_template', params: {}, decorators: [{ type: 'timeout', seconds: 10 }] },
    { id: 'fallback', type: 'task', name: 'Target Fallback', action: 'core.log', params: { message: 'not found' } },
  ],
};
const matchOutputSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' },
      confidence: { type: 'number' }, reference: { type: 'array', items: { type: 'number' } },
      center: { type: 'array', items: { type: 'integer' } }, template: { type: 'string' }, threshold: { type: 'number' },
    },
  },
};
const catalog = [
  { name: 'core.capture', version: '1.0.0', description: '截屏', parameters: {}, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object', properties: { width: { type: 'integer' } } }, outputFields: ['width'], retrySafe: true },
  { name: 'vision.match_template', version: '1.0.0', description: '匹配', parameters: { template: { type: 'asset', required: true, description: '模板图路径', minLength: 1, maxLength: 200 }, roi: { type: 'rect' }, threshold: { type: 'number', default: 0.85, min: 0, max: 1 }, max_results: { type: 'integer', default: 20, min: 1 }, scale_search: { type: 'boolean', default: false } }, inputSchema: { type: 'object', properties: { template: { type: 'string' }, roi: { type: 'array' }, threshold: { type: 'number' }, max_results: { type: 'integer' }, scale_search: { type: 'boolean' } }, required: ['template'], additionalProperties: false }, outputSchema: matchOutputSchema, outputFields: [], retrySafe: true },
  { name: 'input.tap_match', version: '1.0.0', description: '点击匹配', parameters: { match: { type: 'object', required: true } }, inputSchema: { type: 'object', properties: { match: { type: 'object' } }, required: ['match'], additionalProperties: false }, outputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } } }, outputFields: ['x', 'y'], retrySafe: false },
  { name: 'core.log', version: '1.0.0', description: '日志', parameters: { message: { type: 'string', required: true } }, inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false }, outputSchema: { type: 'object' }, outputFields: [], retrySafe: true },
  { name: 'workflow.run', version: '1.0.0', description: '同步运行另一个工作流', parameters: { workflow: { type: 'string', required: true }, inputs: { type: 'object' } }, inputSchema: { type: 'object', properties: { workflow: { type: 'string' }, inputs: { type: 'object' } }, required: ['workflow'], additionalProperties: false }, outputSchema: { type: 'object' }, outputFields: [], retrySafe: false },
];

for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'init', document: { name: 'demo.json', uri: 'file:///demo.json', text: JSON.stringify(workflow) }, workflows: [
  { uri: 'file:///demo.json', name: 'demo.json', rel: 'workflows/demo.json', description: '编辑器 DOM 测试主流程' },
  { uri: 'file:///souls.json', name: 'souls.json', rel: 'workflows/souls.json', description: '御魂主流程' },
  { uri: 'file:///task_in_souls.json', name: 'task_in_souls.json', rel: 'workflows/_souls/task_in_souls.json', description: '进入御魂挑战界面并等待卡片出现' },
], assetsBaseUri: 'webview://assets/', catalog, refs: { blackboard: ['blackboard.template'], nodes: ['nodes.capture.output.width'] }, issues: [], instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }, { id: 'mumu-1', backend: 'mumu', displayName: 'second' }], selectedInstance: 'mumu-0' } });

const graph = els.graph;
const hasClass = (item, name) => item.classList.contains(name) || String(item.attrs.class || '').split(/\s+/).includes(name);
const allGraph = (predicate) => walk(graph, predicate);
const nodeGroup = (id) => allGraph((item) => item.tagName === 'G' && hasClass(item, 'node')).find((item) => item.dataset.id === id);
const edgeGroup = (parent, child) => allGraph((item) => item.tagName === 'G' && hasClass(item, 'edge')).find((item) => item.dataset.parent === parent && item.dataset.child === child);
const within = (root, predicate) => walk(root, predicate);
const fire = (target, type, values = {}) => { const event = Object.assign({ button: 0, clientX: 100, clientY: 100, pointerId: 1, shiftKey: false, altKey: false, ctrlKey: false, target, preventDefault() {}, stopPropagation() {} }, values); for (const fn of target._listeners[type] || []) fn(event); };
const fireWindow = (type, values = {}) => { const event = Object.assign({ key: '', button: 0, clientX: 100, clientY: 100, target: body, preventDefault() {}, stopPropagation() {} }, values); for (const fn of windowStub._listeners[type] || []) fn(event); };
const fireDocument = (type, values = {}) => { const event = Object.assign({ clientX: 100, clientY: 100, target: body, preventDefault() {}, stopPropagation() {} }, values); for (const fn of documentStub._listeners[type] || []) fn(event); };
const sendEditorCommand = (command, value) => { for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'editorCommand', command, value } }); };
const save = () => { fire(els['btn-save'], 'click'); return JSON.parse(saved); };
const inspectorItems = (predicate) => walk(els['inspector-body'], predicate);
const selectNode = (id) => fire(within(nodeGroup(id), (item) => hasClass(item, 'node-box'))[0], 'mousedown');
const portPoint = (id, kind) => {
  const editor = windowStub.__btEditor;
  const raw = editor.snapshot();
  const node = raw.nodes.find((item) => item.id === id);
  const pos = raw._layout[id];
  const height = 96 + (Array.isArray(node.decorators) ? node.decorators.length * 22 : 0);
  return {
    clientX: editor.state.panX + (pos.x + 130) * editor.state.zoom,
    clientY: editor.state.panY + (pos.y + (kind === 'output' ? height : 0)) * editor.state.zoom,
    pointerId: 1,
  };
};

let ok = true;
const check = (name, condition) => { console.log((condition ? '✓ ' : '✗ ') + name); if (!condition) ok = false; };

check('初始化发送 ready', posted.some((message) => message.type === 'ready'));
check('工具栏显示配置中的两个实例', els['instance-select'].children.length === 2 && els['instance-select'].value === 'mumu-0');
check('工作流下拉框列出全部工作流并选中当前', els['workflow-select'].children.length === 3 && els['workflow-select'].value === 'file:///demo.json');
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runtimeInstances', instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }, { id: 'mumu-1', backend: 'mumu', displayName: 'second' }, { id: 'mumu-2', backend: 'mumu', displayName: 'third' }], selectedInstance: 'mumu-0' } });
check('自动发现刷新可追加第三个原生实例', els['instance-select'].children.length === 3 && els['instance-select'].children[2].textContent === 'mumu-2 · third (mumu)');
els['instance-select'].value = 'mumu-1'; fire(els['instance-select'], 'change');
check('实例选择写回扩展工作区状态', posted.some((message) => message.type === 'selectInstance' && message.instanceId === 'mumu-1'));
fire(els['btn-run'], 'click');
check('运行使用工具栏所选实例', posted.some((message) => message.type === 'runWorkflow' && message.instanceId === 'mumu-1'));
fire(els['btn-stop'], 'click');
check('停止按钮发送停止工作流消息', posted.some((message) => message.type === 'stopWorkflow'));
check('渲染 6 张 Behavior Tree 卡片', allGraph((item) => item.tagName === 'G' && hasClass(item, 'node')).length === 6);
check('渲染 Root/Sequence/Selector/Task 类型', ['type-root', 'type-sequence', 'type-selector', 'type-task'].every((name) => allGraph((item) => hasClass(item, name)).length > 0));
check('父子边来自 children（5 条）', allGraph((item) => item.tagName === 'G' && hasClass(item, 'edge')).length === 5);
check('非 Root 都有单输入引脚', allGraph((item) => hasClass(item, 'port-in')).length === 5);
check('复合节点有输出引脚', allGraph((item) => hasClass(item, 'port-out')).length === 3);
check('装饰器嵌入卡片', within(nodeGroup('find'), (item) => hasClass(item, 'decorator-label')).some((item) => String(item.textContent).includes('Time Limit')));

check('未选择内容时默认隐藏详情栏', els.inspector.classList.contains('hidden') && !els['editor-main'].classList.contains('inspector-open'));

sendEditorCommand('workflowSettings');
check('打开工作流设置时显示详情栏', !els.inspector.classList.contains('hidden') && els['editor-main'].classList.contains('inspector-open'));
const workflowDescriptionInput = inspectorItems((item) => item.tagName === 'TEXTAREA' && hasClass(item, 'workflow-description-input'))[0];
check('工作流设置显示顶层描述', !!workflowDescriptionInput && workflowDescriptionInput.value === '编辑器 DOM 测试主流程');
workflowDescriptionInput.value = '更新后的工作流用途说明'; fire(workflowDescriptionInput, 'change');
check('工作流设置把描述写回 JSON', save().description === '更新后的工作流用途说明');
fire(graph, 'mousedown', { target: graph, clientX: 850, clientY: 600 });
fire(graph, 'mouseup', { target: graph, clientX: 850, clientY: 600 });
check('工作流设置打开时点击画布也会收起详情栏', els.inspector.classList.contains('hidden'));

sendEditorCommand('searchNodeByName', 'target');
check('按 name 搜索会选中并居中首张卡片', windowStub.__btEditor.state.selected.has('find')
  && windowStub.__btEditor.state.nodeSearch.ids.length === 2
  && els.toast.textContent.includes('1/2'));
sendEditorCommand('searchNodeByName', 'TARGET');
check('重复搜索不区分大小写并循环到下一张', windowStub.__btEditor.state.selected.has('fallback') && els.toast.textContent.includes('2/2'));
sendEditorCommand('searchNodeByName', 'selector');
check('卡片搜索不使用节点 id', els.toast.textContent.includes('没有找到') && windowStub.__btEditor.state.nodeSearch.ids.length === 0);
sendEditorCommand('focusNode', 'find');
check('聚焦命令选中结构树/引用查看器定位的节点', windowStub.__btEditor.state.selected.has('find')
  && hasClass(nodeGroup('find'), 'selected'));

selectNode('find');
check('选择单个节点时显示详情栏', !els.inspector.classList.contains('hidden') && els['editor-main'].classList.contains('inspector-open'));
const templateInput = inspectorItems((item) => item.tagName === 'INPUT' && item.placeholder === 'assets/templates/...')[0];
check('空参数的必填模板仍渲染输入框', !!templateInput && templateInput.value === '');
check('只渲染必填参数不会改写工作流', Object.keys(save().nodes.find((node) => node.id === 'find').params).length === 0);
const captureTemplateButton = inspectorItems((item) => item.tagName === 'BUTTON' && item.textContent === '截取')[0];
check('模板参数提供截取按钮', !!captureTemplateButton);
fire(captureTemplateButton, 'click');
check('模板截取使用工具栏所选实例', posted.some((message) => message.type === 'pickRoi' && message.instanceId === 'mumu-1'));
const browseTemplateButton = inspectorItems((item) => item.tagName === 'BUTTON' && item.textContent === '浏览')[0];
check('模板参数提供 assets 浏览按钮', !!browseTemplateButton);
fire(browseTemplateButton, 'click');
const assetRequest = [...posted].reverse().find((message) => message.type === 'listAssetImages');
check('浏览按钮请求资源图片列表', !!assetRequest);
for (const fn of windowStub._listeners.message || []) fn({ data: {
  type: 'assetImages', requestId: assetRequest.requestId, images: [
    { path: 'assets/templates/start/yys_tubiao.png', uri: 'webview://assets/templates/start/yys_tubiao.png' },
    { path: 'assets/templates/souls/party/invite-button.png', uri: 'webview://assets/templates/souls/party/invite-button.png' },
    { path: 'assets/icons/status.jpg', uri: 'webview://assets/icons/status.jpg' },
  ],
} });
const assetOverlay = findById(body, 'asset-browser');
const assetTiles = () => within(assetOverlay, (item) => hasClass(item, 'asset-tile'));
check('资源弹窗显示真实图片缩略图', assetTiles().length === 3 && within(assetTiles()[0], (item) => item.tagName === 'IMG').length === 1);
check('资源弹窗按多级文件夹分组', within(assetOverlay, (item) => hasClass(item, 'asset-folder')).some((item) => item.textContent === '' && within(item, (child) => child.textContent === 'party').length === 1));
const inviteTile = () => assetTiles().find((item) => item.dataset.path.includes('invite-button'));
fire(inviteTile(), 'contextmenu', { clientX: 420, clientY: 280 });
const recaptureMenu = walk(body, (item) => item.classList.contains('context-menu')).pop();
const recaptureButton = within(recaptureMenu, (item) => item.tagName === 'BUTTON' && item.textContent === '重新截取')[0];
check('模板缩略图右键菜单提供重新截取', !!recaptureButton);
fire(recaptureButton, 'click');
const recaptureRequest = [...posted].reverse().find((message) => message.type === 'pickRoi');
check('重新截取沿用当前实例和原模板路径', recaptureRequest.instanceId === 'mumu-1'
  && recaptureRequest.targetPath === 'assets/templates/souls/party/invite-button.png'
  && windowStub.__btEditor.state.roi.targetPath === recaptureRequest.targetPath);
check('选择 ROI 时暂时隐藏资源弹窗', assetOverlay.classList.contains('hidden'));
for (const fn of windowStub._listeners.message || []) fn({ data: {
  type: 'roiPickerImage', requestId: recaptureRequest.requestId,
  dataUrl: 'data:image/png;base64,QUJD', width: 1920, height: 1080, referenceResolution: [1920, 1080],
} });
const roiOverlay = findById(body, 'roi-picker');
const roiStage = within(roiOverlay, (item) => hasClass(item, 'roi-stage'))[0];
fire(roiStage, 'mousedown', { clientX: 100, clientY: 100 });
fireDocument('mousemove', { clientX: 260, clientY: 220 });
fireDocument('mouseup', { clientX: 260, clientY: 220 });
fire(within(roiOverlay, (item) => item.tagName === 'BUTTON' && item.textContent === '确认')[0], 'click');
const overwriteRequest = [...posted].reverse().find((message) => message.type === 'saveTemplate');
check('ROI 确认覆盖原模板而不是创建新文件', overwriteRequest.targetPath === 'assets/templates/souls/party/invite-button.png'
  && overwriteRequest.dataUrl.startsWith('data:image/png;base64,'));
for (const fn of windowStub._listeners.message || []) fn({ data: {
  type: 'templateSaved', requestId: overwriteRequest.requestId, nodeId: 'find', key: 'template', path: overwriteRequest.targetPath,
} });
check('覆盖完成后恢复资源弹窗并刷新缩略图', !assetOverlay.classList.contains('hidden')
  && els.toast.textContent === '模板已重新截取'
  && within(inviteTile(), (item) => item.tagName === 'IMG' && String(item.src).includes('?v=')).length === 1);
fire(inviteTile(), 'click');
const chooseAssetButton = within(assetOverlay, (item) => item.tagName === 'BUTTON' && item.textContent === '选择')[0];
fire(chooseAssetButton, 'click');
check('选中缩略图写回 Action 参数', save().nodes.find((node) => node.id === 'find').params.template === 'assets/templates/souls/party/invite-button.png');
const cardTemplate = within(nodeGroup('find'), (item) => hasClass(item, 'template-thumb'))[0];
check('模板匹配卡片显示所选模板缩略图', !!cardTemplate
  && cardTemplate.attrs.href === 'webview://assets/templates/souls/party/invite-button.png'
  && cardTemplate.attrs['data-template-path'] === 'assets/templates/souls/party/invite-button.png');
const checkTemplateButton = inspectorItems((item) => item.tagName === 'BUTTON' && item.textContent === '检查')[0];
check('匹配阈值提供即时检查按钮', !!checkTemplateButton);
fire(checkTemplateButton, 'click');
const templateCheckRequest = [...posted].reverse().find((message) => message.type === 'checkTemplate');
check('即时检查使用当前节点参数和实例', !!templateCheckRequest
  && templateCheckRequest.template === 'assets/templates/souls/party/invite-button.png'
  && templateCheckRequest.threshold === 0.85
  && templateCheckRequest.maxResults === 20
  && templateCheckRequest.instanceId === 'mumu-1');
for (const fn of windowStub._listeners.message || []) fn({ data: {
  type: 'templateCheckResult', requestId: templateCheckRequest.requestId,
  dataUrl: 'data:image/png;base64,QUJD', width: 1920, height: 1080,
  roi: [200, 100, 900, 600],
  matches: [{ x: 480, y: 260, width: 195, height: 90, confidence: 0.991 }],
} });
const templateCheckOverlay = findById(body, 'template-check');
check('检查弹窗绘制 ROI 和匹配置信度',
  within(templateCheckOverlay, (item) => hasClass(item, 'template-check-roi')).length === 1
  && within(templateCheckOverlay, (item) => hasClass(item, 'template-check-match')).length === 1
  && within(templateCheckOverlay, (item) => item.textContent === '1  0.991').length === 1);
fire(within(templateCheckOverlay, (item) => item.tagName === 'BUTTON' && item.attrs['aria-label'] === '关闭')[0], 'click');
check('模板匹配渲染完整参数组', inspectorItems((item) => hasClass(item, 'parameter-block')).length === 5);
templateInput.value = 'assets/templates/other.png'; fire(templateInput, 'change');
check('参数栏写回 Action 参数', save().nodes.find((node) => node.id === 'find').params.template === 'assets/templates/other.png');
const templateParameterBlock = inspectorItems((item) => hasClass(item, 'parameter-block')).find((block) => within(block, (item) => item.tagName === 'SPAN' && item.textContent === 'template *').length === 1);
const parameterPublicToggle = () => within(templateParameterBlock, (item) => item.tagName === 'LABEL' && hasClass(item, 'parameter-public'))[0];
check('Action 参数标题显示公开选项', !!parameterPublicToggle()
  && within(parameterPublicToggle(), (item) => item.tagName === 'SPAN' && item.textContent === '公开').length === 1);
const exposeTemplate = within(parameterPublicToggle(), (item) => item.tagName === 'INPUT' && item.type === 'checkbox')[0];
exposeTemplate.checked = true; fire(exposeTemplate, 'change');
let promoted = save();
check('勾选公开会把参数提升为公开工作流变量并保留当前值为默认值', promoted.blackboard.find_template.public === true
  && promoted.blackboard.find_template.default === 'assets/templates/other.png'
  && promoted.nodes.find((node) => node.id === 'find').params.template.ref === 'blackboard.find_template');
check('参数提升会保留类型说明并把长度约束转换为工作流字段', promoted.blackboard.find_template.type === 'asset'
  && promoted.blackboard.find_template.description === '模板图路径'
  && promoted.blackboard.find_template.min_length === 1
  && promoted.blackboard.find_template.max_length === 200);
check('参数名冲突时使用节点 ID 生成唯一变量名', !promoted.blackboard.template.public
  && !!promoted.blackboard.find_template);
const privateTemplate = inspectorItems((item) => item.tagName === 'LABEL' && hasClass(item, 'parameter-public'))
  .find((label) => label.title.includes('find_template'));
const hideTemplate = within(privateTemplate, (item) => item.tagName === 'INPUT' && item.type === 'checkbox')[0];
hideTemplate.checked = false; fire(hideTemplate, 'change');
promoted = save();
check('取消公开只隐藏变量并保持节点引用', promoted.blackboard.find_template.public === false
  && promoted.nodes.find((node) => node.id === 'find').params.template.ref === 'blackboard.find_template');
const showTemplateAgain = inspectorItems((item) => item.tagName === 'LABEL' && hasClass(item, 'parameter-public'))
  .map((label) => ({ label, checkbox: within(label, (item) => item.tagName === 'INPUT' && item.type === 'checkbox')[0] }))
  .find((item) => item.checkbox && item.checkbox.checked === false && within(item.label.parentNode.parentNode, (child) => child.tagName === 'SPAN' && child.textContent === 'template *').length === 1);
showTemplateAgain.checkbox.checked = true; fire(showTemplateAgain.checkbox, 'change');
check('已绑定私有变量可直接重新公开', save().blackboard.find_template.public === true);

const decoratorAdd = inspectorItems((item) => item.tagName === 'SELECT' && hasClass(item, 'decorator-add'))[0];
decoratorAdd.value = 'retry'; fire(decoratorAdd, 'change');
check('详情栏添加 Retry 装饰器', save().nodes.find((node) => node.id === 'find').decorators.some((item) => item.type === 'retry' && item.attempts === 2));
const doOnceAdd = inspectorItems((item) => item.tagName === 'SELECT' && hasClass(item, 'decorator-add'))[0];
doOnceAdd.value = 'do_once'; fire(doOnceAdd, 'change');
check('详情栏添加 Do Once 装饰器', save().nodes.find((node) => node.id === 'find').decorators.some((item) => item.type === 'do_once'));
const doOnceBox = inspectorItems((item) => item.tagName === 'INPUT' && item.type === 'checkbox').pop();
if (doOnceBox) { doOnceBox.checked = true; fire(doOnceBox, 'change'); }
check('Do Once 勾选失败重置并写回工作流', doOnceBox !== undefined && save().nodes.find((node) => node.id === 'find').decorators.some((item) => item.type === 'do_once' && item.reset_on_failure === true));
fire(graph, 'mousedown', { target: graph, clientX: 850, clientY: 600 });
fire(graph, 'mouseup', { target: graph, clientX: 850, clientY: 600 });
check('点击画布空白处会收起详情栏', els.inspector.classList.contains('hidden') && !els['editor-main'].classList.contains('inspector-open'));

// Output -> input reparents capture from Sequence to Selector.
const selectorOut = within(nodeGroup('selector'), (item) => hasClass(item, 'port-out'))[0];
fire(selectorOut, 'pointerdown');
fire(graph, 'pointermove', portPoint('capture', 'input'));
fire(graph, 'pointerup', portPoint('capture', 'input'));
let raw = save();
check('新连接替换目标旧父级', !raw.nodes.find((node) => node.id === 'main').children.includes('capture') && raw.nodes.find((node) => node.id === 'selector').children.includes('capture'));

// Input -> output supports the UE-style reverse drag direction.
const captureInReverse = within(nodeGroup('capture'), (item) => hasClass(item, 'port-in'))[0];
fire(captureInReverse, 'pointerdown');
fire(graph, 'pointermove', portPoint('main', 'output'));
fire(graph, 'pointerup', portPoint('main', 'output'));
raw = save();
check('输入引脚可反向拖到输出引脚', raw.nodes.find((node) => node.id === 'main').children.includes('capture') && !raw.nodes.find((node) => node.id === 'selector').children.includes('capture'));

// Real SVG rerenders replace the hovered input before mouseup; the window fallback must commit it.
const selectorOutFallback = within(nodeGroup('selector'), (item) => hasClass(item, 'port-out'))[0];
fire(selectorOutFallback, 'pointerdown');
windowStub.__btEditor.state.connect.hover = 'capture';
fire(graph, 'pointerup', { clientX: -10000, clientY: -10000, pointerId: 1 });
raw = save();
check('全局 mouseup 可在 SVG 重绘后完成连接', !raw.nodes.find((node) => node.id === 'main').children.includes('capture') && raw.nodes.find((node) => node.id === 'selector').children.includes('capture'));

// Select the selector->capture edge and delete it.
const edge = allGraph((item) => item.tagName === 'G' && hasClass(item, 'edge')).find((item) => item.dataset.parent === 'selector' && item.dataset.child === 'capture');
fire(within(edge, (item) => hasClass(item, 'edge-hit'))[0], 'mousedown');
fireWindow('keydown', { key: 'Delete' });
raw = save();
check('Delete 断开选中连线', !raw.nodes.find((node) => node.id === 'selector').children.includes('capture'));
fireWindow('keydown', { key: 'z', ctrlKey: true });
check('Ctrl+Z 恢复断开的连接', save().nodes.find((node) => node.id === 'selector').children.includes('capture'));

// Drag one card and persist _layout.
const before = windowStub.__btEditor.snapshot()._layout.find;
const box = within(nodeGroup('find'), (item) => hasClass(item, 'node-box'))[0];
fire(box, 'mousedown', { clientX: 200, clientY: 220 });
fireWindow('mousemove', { clientX: 320, clientY: 310 });
fireWindow('mouseup', { clientX: 320, clientY: 310 });
const after = save()._layout.find;
check('拖动卡片持久化 _layout', before.x !== after.x || before.y !== after.y);

const oldZoom = windowStub.__btEditor.state.zoom;
fire(graph, 'wheel', { deltaY: -100, clientX: 400, clientY: 300 });
check('滚轮以光标为中心缩放视口', windowStub.__btEditor.state.zoom > oldZoom);
sendEditorCommand('autoLayout');
check('自动布局保持 Root 在子节点上方', save()._layout.root.y < save()._layout.main.y);

windowStub.__btEditor.state.raw.blackboard.rounds = { type: 'integer', public: true, default: 9999, enum: [1, 9999] };
sendEditorCommand('selectVariable', 'rounds');
check('左侧变量命令打开右侧单变量详情', els['inspector-title'].textContent === '变量 · rounds'
  && inspectorItems((item) => hasClass(item, 'variable-list')).length === 0
  && inspectorItems((item) => String(item.textContent).includes('黑板')).length === 0);
const variableDetails = () => inspectorItems((item) => hasClass(item, 'variable-details'))[0];
const roundsDefault = within(variableDetails(), (item) => item.tagName === 'SELECT'
    && within(item, (option) => option.tagName === 'OPTION' && option.textContent === '1').length === 1
    && within(item, (option) => option.tagName === 'OPTION' && option.textContent === '9999').length === 1)[0];
check('选中变量后只显示当前变量详情', !!roundsDefault && roundsDefault.value === '9999'
  && within(variableDetails(), (item) => hasClass(item, 'definition-enum-row')).length === 2
  && inspectorItems((item) => hasClass(item, 'variable-details')).length === 1);
roundsDefault.value = '1'; fire(roundsDefault, 'change');
check('枚举下拉框直接写回变量默认值', save().blackboard.rounds.default === 1);
sendEditorCommand('selectVariable', 'template');
const browseVariableAsset = within(variableDetails(), (item) => item.tagName === 'BUTTON' && item.textContent === '浏览')[0];
check('asset 变量详情提供模板浏览选项', !!browseVariableAsset);
fire(browseVariableAsset, 'click');
const variableAssetRequest = [...posted].reverse().find((message) => message.type === 'listAssetImages');
for (const fn of windowStub._listeners.message || []) fn({ data: {
  type: 'assetImages', requestId: variableAssetRequest.requestId,
  images: [{ path: 'assets/templates/variable-target.png', uri: 'webview://assets/templates/variable-target.png' }],
} });
const variableAssetOverlay = findById(body, 'asset-browser');
const variableAssetTile = within(variableAssetOverlay, (item) => hasClass(item, 'asset-tile'))[0];
fire(variableAssetTile, 'click');
fire(within(variableAssetOverlay, (item) => item.tagName === 'BUTTON' && item.textContent === '选择')[0], 'click');
check('模板浏览结果直接写回变量默认值', save().blackboard.template.default === 'assets/templates/variable-target.png');
sendEditorCommand('addVariable');
check('新增变量自动选中并创建为私有 string', !!save().blackboard.new_variable_1
  && save().blackboard.new_variable_1.type === 'string'
  && save().blackboard.new_variable_1.public === false
  && windowStub.__btEditor.state.selectedVariable === 'new_variable_1');
check('画布结构和变量变化同步给左侧停靠栏', posted.some((message) => message.type === 'sidebarStateChanged'
  && message.selectedVariable === 'new_variable_1'
  && message.root === 'root'
  && message.nodes.some((node) => node.id === 'root' && Array.isArray(node.children))
  && message.variables.some((variable) => variable.name === 'new_variable_1' && variable.type === 'string' && variable.public === false)));
sendEditorCommand('selectVariable', 'find_template');
const deleteReferencedVariable = inspectorItems((item) => item.tagName === 'BUTTON' && item.title === '删除变量')[0];
fire(deleteReferencedVariable, 'click');
check('被节点引用的变量不能直接删除', !!save().blackboard.find_template
  && els.toast.textContent.includes('正在被 1 处引用'));

const editor = windowStub.__btEditor;
const current = editor.state.raw;
current.nodes.push(
  { id: 'match_source', type: 'task', action: 'vision.match_template', params: { template: 'assets/templates/start/yys_tubiao.png' } },
  { id: 'tap_match', type: 'task', action: 'input.tap_match', params: { match: { ref: 'nodes.match_source.output.0' } } },
);
current.nodes.find((node) => node.id === 'main').children.unshift('match_source', 'tap_match');
current._layout.match_source = { x: 0, y: 420 };
current._layout.tap_match = { x: 300, y: 420 };
editor.render();
selectNode('tap_match');
const matchRefSelect = inspectorItems((item) => item.tagName === 'SELECT' && hasClass(item, 'full'))[0];
const matchRefValues = matchRefSelect ? matchRefSelect.children.map((item) => item.value) : [];
check('匹配对象引用只列出前置模板匹配的 output.0', !!matchRefSelect
  && matchRefValues.includes('nodes.match_source.output.0')
  && !matchRefValues.some((value) => value.startsWith('nodes.tap_match.'))
  && !matchRefValues.includes('nodes.match_source.output.0.x'));

for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runEvent', event: { type: 'step', step_id: 'find', step: { status: 'running', action: 'vision.match_template', workflow_id: 'demo' } } } });
check('运行中的节点让入线显示流动状态', hasClass(edgeGroup('selector', 'find'), 'run-running')
  && within(edgeGroup('selector', 'find'), (item) => hasClass(item, 'edge-flow')).length === 1);
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runEvent', event: { type: 'step', step_id: 'find', step: { status: 'succeeded', action: 'vision.match_template', workflow_id: 'demo', duration_ms: 12 }, thumbnail: 'QUJD' } } });
check('模板命中显示已匹配状态', hasClass(nodeGroup('find'), 'run-matched') && within(nodeGroup('find'), (item) => hasClass(item, 'run-label') && item.textContent === '已匹配').length === 1);
check('模板命中让入线显示成功状态', hasClass(edgeGroup('selector', 'find'), 'run-matched'));
check('运行事件渲染缩略图', within(nodeGroup('find'), (item) => hasClass(item, 'step-thumb')).length === 1);
check('运行截图替代模板缩略图', within(nodeGroup('find'), (item) => hasClass(item, 'template-thumb')).length === 0);
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runEvent', event: { type: 'step', step_id: 'find', step: { status: 'failed', action: 'vision.match_template', workflow_id: 'child_workflow', error_category: 'not_matched' } } } });
check('子工作流同名节点不会覆盖主流程卡片和线条', hasClass(nodeGroup('find'), 'run-matched') && hasClass(edgeGroup('selector', 'find'), 'run-matched'));
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runEvent', event: { type: 'step', step_id: 'find', step: { status: 'failed', action: 'vision.match_template', workflow_id: 'demo', error_category: 'not_matched', error: 'template not matched' } } } });
check('模板零命中显示未匹配状态', hasClass(nodeGroup('find'), 'run-not_matched') && within(nodeGroup('find'), (item) => item.textContent === '未匹配').length === 1);
check('模板零命中让入线显示未匹配状态', hasClass(edgeGroup('selector', 'find'), 'run-not_matched'));
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runEvent', event: { type: 'step', step_id: 'find', step: { status: 'branch_miss', original_status: 'failed', recovered_by: 'selector', workflow_id: 'demo', error_category: 'not_matched' } } } });
check('后续分支启动后节点显示分支跳过', hasClass(nodeGroup('find'), 'run-branch_miss') && within(nodeGroup('find'), (item) => hasClass(item, 'run-label') && item.textContent === '分支跳过').length === 1);
check('后续分支启动后入线显示分支跳过', hasClass(edgeGroup('selector', 'find'), 'run-branch_miss'));
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runEvent', event: { type: 'step', step_id: 'fallback', step: { status: 'failed', action: 'core.log', workflow_id: 'demo' } } } });
check('失败节点让入线显示失败状态', hasClass(edgeGroup('selector', 'fallback'), 'run-failed'));
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'runEvent', event: { type: 'step', step_id: 'fallback', step: { status: 'branch_miss', action: 'core.log', workflow_id: 'demo' } } } });
check('分支跳过让入线显示跳过状态', hasClass(edgeGroup('selector', 'fallback'), 'run-branch_miss'));

selectNode('fallback');
fireWindow('keydown', { key: 'Delete' });
raw = save();
check('删除节点会清理父 children', !raw.nodes.some((node) => node.id === 'fallback') && !raw.nodes.find((node) => node.id === 'selector').children.includes('fallback'));

// 子流程节点：workflow.run 卡片显示 ⇢ 标记，双击/右键可进入子工作流视图。
const subEditor = windowStub.__btEditor;
const subState = subEditor.state;
subState.raw.nodes.push({ id: 'run_child', type: 'task', action: 'workflow.run', params: { workflow: 'souls.json' } });
subState.raw._layout.run_child = { x: 620, y: 420 };
subState.dirty = false;
subEditor.render();
subState.selected = new Set(['run_child']);
check('子流程卡片显示 ⇢ 引用', within(nodeGroup('run_child'), (item) => hasClass(item, 'node-subtitle') && String(item.textContent).includes('⇢ souls.json')).length === 1);
const postedBeforeSubOpen = posted.length;
const subBox = () => within(nodeGroup('run_child'), (item) => hasClass(item, 'node-box'))[0];
// 原生 dblclick 会被 mousedown 后的 render() 重建 DOM 破坏，实际用两次按下计时检测双击
fire(subBox(), 'mousedown', { clientX: 700, clientY: 460 });
fire(subBox(), 'mousedown', { clientX: 700, clientY: 460 });
check('双击子流程卡片发送 openSubWorkflow', posted.slice(postedBeforeSubOpen).some((message) => message.type === 'openSubWorkflow' && message.nodeId === 'run_child' && message.saveText === undefined));
fire(within(nodeGroup('run_child'), (item) => hasClass(item, 'node-box'))[0], 'contextmenu');
const subMenuBody = walk(body, (item) => item.classList.contains('context-menu')).pop();
check('子流程卡片右键菜单包含进入子工作流选项', subMenuBody
  && within(subMenuBody, (item) => item.tagName === 'BUTTON' && String(item.textContent).includes('进入子工作流视图')).length > 0);
// 脏状态：双击先弹确认菜单而非直接发送。
subState.dirty = true;
const postedBeforeDirty = posted.length;
fire(subBox(), 'mousedown', { clientX: 700, clientY: 460 });
fire(subBox(), 'mousedown', { clientX: 700, clientY: 460 });
check('脏状态双击先弹确认菜单', posted.slice(postedBeforeDirty).every((message) => message.type !== 'openSubWorkflow')
  && walk(body, (item) => item.classList.contains('context-menu')).length > 0);
subState.dirty = false;

selectNode('run_child');
const browseWorkflowButton = inspectorItems((item) => item.tagName === 'BUTTON' && item.textContent === '浏览')[0];
check('workflow.run 参数提供工作流浏览按钮', !!browseWorkflowButton && browseWorkflowButton.title.includes('workflows'));
fire(browseWorkflowButton, 'click');
const workflowOverlay = findById(body, 'workflow-browser');
const workflowFiles = () => within(workflowOverlay, (item) => hasClass(item, 'workflow-file'));
check('工作流弹窗排除当前脚本并列出其他脚本', !workflowOverlay.classList.contains('hidden')
  && workflowFiles().length === 2
  && !workflowFiles().some((item) => item.dataset.reference === 'demo.json'));
check('工作流弹窗按 workflows 子目录分组', within(workflowOverlay, (item) => hasClass(item, 'workflow-folder-name') && item.textContent === '_souls').length === 1);
check('工作流弹窗显示脚本描述', within(workflowOverlay, (item) => hasClass(item, 'workflow-file-description') && item.textContent === '进入御魂挑战界面并等待卡片出现').length === 1);
const workflowSearch = within(workflowOverlay, (item) => hasClass(item, 'workflow-search'))[0];
workflowSearch.value = '等待卡片'; fire(workflowSearch, 'input');
check('工作流弹窗支持按描述搜索', workflowFiles().length === 1 && workflowFiles()[0].dataset.reference === '_souls/task_in_souls.json');
fire(workflowFiles()[0], 'click');
const chooseWorkflowButton = within(workflowOverlay, (item) => item.tagName === 'BUTTON' && item.textContent === '选择')[0];
fire(chooseWorkflowButton, 'click');
check('选择脚本写回 workflows 下的可移植相对路径', save().nodes.find((node) => node.id === 'run_child').params.workflow === '_souls/task_in_souls.json'
  && workflowOverlay.classList.contains('hidden'));

// 复制/剪切/粘贴：选中子树复制，粘贴生成新 ID 并重映射引用与布局。
const clipboardEditor = windowStub.__btEditor;
selectNode('main');
fireWindow('keydown', { key: 'c', ctrlKey: true });
raw = save();
const mainChildrenBefore = raw.nodes.find((node) => node.id === 'main').children.slice();
check('复制后剪贴板保存子树', Array.isArray(clipboardEditor.state.clipboard)
  && clipboardEditor.state.clipboard.some((node) => node.id === 'main')
  && clipboardEditor.state.clipboard.some((node) => node.id === 'find'));
const clipLayout = clipboardEditor.state.clipboardLayout;
const clipXs = Object.values(clipLayout).map((p) => p.x);
const clipYs = Object.values(clipLayout).map((p) => p.y);
const clipMinX = Math.min(...clipXs);
const clipMinY = Math.min(...clipYs);
// 把鼠标放到画布某个世界坐标，再粘贴，验证整组左上角落在鼠标处。
clipboardEditor.state.mouse = { x: 460, y: 300 };
fireWindow('keydown', { key: 'v', ctrlKey: true });
raw = save();
const pastedMain = raw.nodes.find((node) => node.id === 'main_1');
check('粘贴生成新 ID 的子树根', !!pastedMain);
check('粘贴保留内部 children 并重映射', pastedMain
  && JSON.stringify(pastedMain.children) === JSON.stringify(mainChildrenBefore.map((id) => id === 'main' ? id : `${id}_1`)));
check('粘贴重映射 nodes ref 到新 ID', raw.nodes.find((node) => node.id === 'tap_match_1')
  && raw.nodes.find((node) => node.id === 'tap_match_1').params.match.ref === 'nodes.match_source_1.output.0');
check('粘贴从鼠标位置出现（整组左上角对齐鼠标）', raw._layout.main_1
  && raw._layout.main_1.x === clipLayout.main.x + (460 - clipMinX)
  && raw._layout.main_1.y === clipLayout.main.y + (300 - clipMinY));
check('粘贴后选中新节点', clipboardEditor.state.selected.has('main_1'));

// 剪切：移除选中子树并保留到剪贴板，粘贴可恢复。
selectNode('main');
fireWindow('keydown', { key: 'x', ctrlKey: true });
raw = save();
check('剪切移除选中子树', !raw.nodes.some((node) => node.id === 'main') && !raw.nodes.some((node) => node.id === 'selector'));
check('剪切清理父引用', !raw.nodes.find((node) => node.id === 'root').children.includes('main'));
fireWindow('keydown', { key: 'v', ctrlKey: true });
raw = save();
check('剪切后粘贴恢复子树', raw.nodes.some((node) => node.id === 'main_2') && raw.nodes.some((node) => node.id === 'selector_2'));
check('多次粘贴 ID 递增不冲突', raw.nodes.filter((node) => node.id === 'main_1' || node.id === 'main_2').length === 2);
// 撤销粘贴后回到剪切后的状态（子树不在）。
fireWindow('keydown', { key: 'z', ctrlKey: true });
raw = save();
check('撤销粘贴回到剪切后状态', !raw.nodes.some((node) => node.id === 'main_2') && !raw.nodes.some((node) => node.id === 'main'));

// 工作流切换：干净状态直接发送，脏状态弹出确认菜单。
els['workflow-select'].value = 'file:///souls.json'; fire(els['workflow-select'], 'change');
check('切换工作流发送 switchWorkflow（干净状态无保存文本）', posted.some((message) => message.type === 'switchWorkflow' && message.uri === 'file:///souls.json' && message.saveText === undefined));
// 模拟扩展完成切换后回发的 init（重置 docUri/dirty）。
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'init', document: { name: 'souls.json', uri: 'file:///souls.json', text: JSON.stringify(workflow) }, workflows: [
  { uri: 'file:///demo.json', name: 'demo.json', rel: 'workflows/demo.json' },
  { uri: 'file:///souls.json', name: 'souls.json', rel: 'workflows/souls.json' },
], catalog, refs: { blackboard: ['blackboard.template'], nodes: ['nodes.capture.output.width'] }, issues: [], instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }, { id: 'mumu-1', backend: 'mumu', displayName: 'second' }], selectedInstance: 'mumu-0' } });
sendEditorCommand('addTask');
const postedBeforeSwitch = posted.filter((message) => message.type === 'switchWorkflow').length;
els['workflow-select'].value = 'file:///demo.json'; fire(els['workflow-select'], 'change');
check('脏状态切换先弹确认菜单而非直接发送', posted.filter((message) => message.type === 'switchWorkflow').length === postedBeforeSwitch
  && walk(body, (item) => item.classList.contains('context-menu')).length > 0);
const discardButton = within(walk(body, (item) => item.classList.contains('context-menu'))[0], (item) => item.tagName === 'BUTTON' && item.textContent === '放弃修改并切换')[0];
fire(discardButton, 'click');
check('放弃修改切换发送无 saveText 的 switchWorkflow', posted.some((message) => message.type === 'switchWorkflow' && message.uri === 'file:///demo.json' && message.saveText === undefined));
els['workflow-select'].value = 'file:///souls.json'; fire(els['workflow-select'], 'change');
const saveAndSwitchButton = within(walk(body, (item) => item.classList.contains('context-menu'))[0], (item) => item.tagName === 'BUTTON' && item.textContent === '保存并切换')[0];
fire(saveAndSwitchButton, 'click');
check('保存并切换附带当前工作流文本', posted.some((message) => message.type === 'switchWorkflow' && message.uri === 'file:///souls.json' && typeof message.saveText === 'string' && message.saveText.includes('"id": "demo"')));

// 返回上一级：init 带 canGoBack 时显示返回按钮，点击发送 goBackWorkflow，脏状态先确认。
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'init', document: { name: 'demo.json', uri: 'file:///demo.json', text: JSON.stringify(workflow) }, workflows: [
  { uri: 'file:///demo.json', name: 'demo.json', rel: 'workflows/demo.json' },
  { uri: 'file:///souls.json', name: 'souls.json', rel: 'workflows/souls.json' },
], canGoBack: false, catalog, refs: { blackboard: ['blackboard.template'], nodes: ['nodes.capture.output.width'] }, issues: [], instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }, { id: 'mumu-1', backend: 'mumu', displayName: 'second' }], selectedInstance: 'mumu-0' } });
check('无上级时不显示返回按钮', els['btn-back'].classList.contains('hidden'));
for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'init', document: { name: 'souls.json', uri: 'file:///souls.json', text: JSON.stringify(workflow) }, workflows: [
  { uri: 'file:///demo.json', name: 'demo.json', rel: 'workflows/demo.json' },
  { uri: 'file:///souls.json', name: 'souls.json', rel: 'workflows/souls.json' },
], canGoBack: true, catalog, refs: { blackboard: ['blackboard.template'], nodes: ['nodes.capture.output.width'] }, issues: [], instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }, { id: 'mumu-1', backend: 'mumu', displayName: 'second' }], selectedInstance: 'mumu-0' } });
check('有上级时显示返回按钮', !els['btn-back'].classList.contains('hidden'));
const postedBeforeBack = posted.length;
fire(els['btn-back'], 'click');
check('点击返回按钮发送 goBackWorkflow（干净状态无保存文本）', posted.slice(postedBeforeBack).some((message) => message.type === 'goBackWorkflow' && message.saveText === undefined));
// 脏状态：返回先弹确认菜单。
sendEditorCommand('addTask');
const postedBeforeDirtyBack = posted.length;
fire(els['btn-back'], 'click');
check('脏状态返回先弹确认菜单', posted.slice(postedBeforeDirtyBack).every((message) => message.type !== 'goBackWorkflow')
  && walk(body, (item) => item.classList.contains('context-menu')).length > 0);

(async () => {
  const editor = windowStub.__btEditor;
  // 先清空前面 init 遗留的 0ms fitView 定时器，随后手动摆一个“用户调整过”的视口。
  await new Promise((resolve) => setTimeout(resolve, 5));
  editor.state.zoom = 1.7; editor.state.panX = 123; editor.state.panY = 456;
  // 同一文档重新 init（保存后的外部变更同步）：视口必须保持不变。
  for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'init', document: { name: 'souls.json', uri: 'file:///souls.json', text: JSON.stringify(workflow) }, workflows: [
    { uri: 'file:///demo.json', name: 'demo.json', rel: 'workflows/demo.json' },
    { uri: 'file:///souls.json', name: 'souls.json', rel: 'workflows/souls.json' },
  ], canGoBack: true, catalog, refs: { blackboard: ['blackboard.template'], nodes: ['nodes.capture.output.width'] }, issues: [], instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }, { id: 'mumu-1', backend: 'mumu', displayName: 'second' }], selectedInstance: 'mumu-0' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  check('同一文档重新初始化保留当前视口', editor.state.zoom === 1.7 && editor.state.panX === 123 && editor.state.panY === 456);
  // 切换文档：视口重新适配。
  for (const fn of windowStub._listeners.message || []) fn({ data: { type: 'init', document: { name: 'demo.json', uri: 'file:///demo.json', text: JSON.stringify(workflow) }, workflows: [
    { uri: 'file:///demo.json', name: 'demo.json', rel: 'workflows/demo.json' },
    { uri: 'file:///souls.json', name: 'souls.json', rel: 'workflows/souls.json' },
  ], canGoBack: true, catalog, refs: { blackboard: ['blackboard.template'], nodes: ['nodes.capture.output.width'] }, issues: [], instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }, { id: 'mumu-1', backend: 'mumu', displayName: 'second' }], selectedInstance: 'mumu-0' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  check('切换文档后重新适配视口', editor.state.zoom !== 1.7);

  const childDescriptor = {
    uri: 'file:///child.json', name: 'child.json', rel: 'workflows/entrypoints/child.json', id: 'child',
    variables: [
      { name: 'rounds', public: true, definition: { type: 'integer', public: true, default: 9999 } },
      { name: 'secret', public: false, definition: { type: 'string', public: false, default: 'internal' } },
    ],
  };

  // 普通 workflow.run 与 Instance Parallel 使用同一套公开变量卡片。
  const subworkflowParent = {
    schema_version: 3,
    id: 'subworkflow_parent', version: '3.0.0', resolution: [1920, 1080], root: 'root',
    blackboard: { parent_rounds: { type: 'integer', default: 1 } },
    nodes: [
      { id: 'root', type: 'root', children: ['run_child'] },
      { id: 'run_child', type: 'task', action: 'workflow.run', params: { workflow: 'entrypoints/child.json', inputs: { rounds: 3, secret: 'stale' } } },
    ],
  };
  for (const fn of windowStub._listeners.message || []) fn({ data: {
    type: 'init',
    document: { name: 'subworkflow_parent.json', uri: 'file:///subworkflow_parent.json', text: JSON.stringify(subworkflowParent) },
    workflows: [
      { uri: 'file:///subworkflow_parent.json', name: 'subworkflow_parent.json', rel: 'workflows/entrypoints/subworkflow_parent.json', id: 'subworkflow_parent', variables: [] },
      childDescriptor,
      { uri: 'file:///other.json', name: 'other.json', rel: 'workflows/entrypoints/other.json', id: 'other', variables: [] },
    ],
    catalog, refs: { blackboard: ['blackboard.parent_rounds'], nodes: [] }, issues: [],
    instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }], selectedInstance: 'mumu-0',
  } });
  check('workflow.run 卡片直接显示公开变量及当前传值', within(nodeGroup('run_child'), (item) => item.textContent === 'rounds').length === 1
    && within(nodeGroup('run_child'), (item) => item.textContent === '3').length === 1
    && within(nodeGroup('run_child'), (item) => item.textContent === 'secret').length === 0);
  selectNode('run_child');
  check('workflow.run 详情只为公开变量渲染变量卡片', inspectorItems((item) => hasClass(item, 'run-variable-block')).length === 1
    && inspectorItems((item) => hasClass(item, 'private-input-warning') && String(item.textContent).includes('secret')).length === 1);
  check('workflow.run 不再显示 inputs 通用 JSON 文本框', inspectorItems((item) => item.tagName === 'TEXTAREA' && hasClass(item, 'json-value')).length === 0);
  const literalRounds = inspectorItems((item) => item.tagName === 'INPUT' && item.type === 'number' && item.value === '3')[0];
  literalRounds.value = '7'; fire(literalRounds, 'change');
  check('workflow.run 公开变量可以直接传常量', save().nodes.find((node) => node.id === 'run_child').params.inputs.rounds === 7);
  const childBindingMode = inspectorItems((item) => item.tagName === 'SELECT'
    && within(item, (child) => child.tagName === 'OPTION' && child.textContent === '绑定父变量').length === 1)[0];
  childBindingMode.value = 'binding'; fire(childBindingMode, 'change');
  check('workflow.run 公开变量可以绑定父工作流变量', save().nodes.find((node) => node.id === 'run_child').params.inputs.rounds.ref === 'blackboard.parent_rounds');
  const childWorkflowInput = inspectorItems((item) => item.tagName === 'INPUT' && item.placeholder === '_folder/workflow.json')[0];
  childWorkflowInput.value = 'entrypoints/other.json'; fire(childWorkflowInput, 'change');
  check('workflow.run 切换子流程会清空旧公开变量传值', Object.keys(save().nodes.find((node) => node.id === 'run_child').params.inputs).length === 0);

  // Instance Parallel 展开为子工作流卡片，并只暴露子工作流声明为 public 的变量。
  const orchestrationWorkflow = {
    schema_version: 3,
    id: 'orchestration', version: '3.0.0', resolution: [1920, 1080], root: 'root',
    blackboard: { parent_rounds: { type: 'integer', default: 1 } },
    nodes: [
      { id: 'root', type: 'root', children: ['parallel'] },
      {
        id: 'parallel', type: 'instance_parallel', wait_for: 'all', cancel_on_failure: true,
        runs: [{ instance: 'mumu-0', workflow: 'entrypoints/child.json', inputs: {} }],
      },
    ],
  };
  for (const fn of windowStub._listeners.message || []) fn({ data: {
    type: 'init',
    document: { name: 'orchestration.json', uri: 'file:///orchestration.json', text: JSON.stringify(orchestrationWorkflow) },
    workflows: [
      { uri: 'file:///orchestration.json', name: 'orchestration.json', rel: 'workflows/entrypoints/orchestration.json', id: 'orchestration', variables: [] },
      childDescriptor,
    ],
    catalog, refs: { blackboard: ['blackboard.parent_rounds'], nodes: [] }, issues: [],
    instances: [{ id: 'mumu-0', backend: 'mumu', displayName: 'primary' }], selectedInstance: 'mumu-0',
  } });
  const runCards = () => allGraph((item) => item.tagName === 'G' && hasClass(item, 'instance-run-card'));
  check('每个实例运行项渲染一张子工作流卡片', runCards().length === orchestrationWorkflow.nodes[1].runs.length);
  check('每张子工作流卡片都有连接线', allGraph((item) => item.tagName === 'G' && hasClass(item, 'instance-run-edge')).length === orchestrationWorkflow.nodes[1].runs.length);
  check('子工作流卡片只显示公开变量', within(runCards()[0], (item) => item.textContent === 'rounds').length === 1
    && within(runCards()[0], (item) => item.textContent === 'secret').length === 0);

  const firstRunBody = () => within(runCards()[0], (item) => hasClass(item, 'instance-run-card-box'))[0];
  fire(firstRunBody(), 'mousedown', { clientX: 160, clientY: 180 });
  check('点击子工作流卡片打开该运行项详情', !!editor.state.selectedRun
    && editor.state.selectedRun.nodeId === 'parallel'
    && inspectorItems((item) => item.textContent === '公开变量').length === 1);
  fire(firstRunBody(), 'mousedown', { clientX: 160, clientY: 180 });
  check('双击子工作流卡片按引用打开工作流', posted.some((message) => message.type === 'openSubWorkflow'
    && message.reference === 'entrypoints/child.json'));

  const bindingMode = inspectorItems((item) => item.tagName === 'SELECT'
    && within(item, (child) => child.tagName === 'OPTION' && child.textContent === '绑定父变量').length === 1)[0];
  bindingMode.value = 'binding'; fire(bindingMode, 'change');
  check('公开变量可以绑定父工作流同类型变量', save().nodes.find((node) => node.id === 'parallel').runs[0].inputs.rounds.ref === 'blackboard.parent_rounds');
  fireWindow('keydown', { key: 'Delete' });
  check('Delete 只删除当前子工作流运行项', save().nodes.find((node) => node.id === 'parallel').runs.length === 0
    && editor.snapshot().nodes.length === 2);

  // 完整画布导出：模板缩略图收集 + data URL 内嵌（配合扩展端 requestAssetData）。
  const svgNS = 'http://www.w3.org/2000/svg';
  const fakeGraph = documentStub.createElementNS(svgNS, 'svg');
  const makeThumb = (href, templatePath) => {
    const image = documentStub.createElementNS(svgNS, 'image');
    image.setAttribute('class', 'node-preview-image');
    image.setAttribute('href', href);
    if (templatePath) image.setAttribute('data-template-path', templatePath);
    return image;
  };
  fakeGraph.appendChild(makeThumb('file:///webview/assets/templates/a.png', 'assets/templates/a.png'));
  fakeGraph.appendChild(makeThumb('data:image/png;base64,QUJD', ''));
  fakeGraph.appendChild(makeThumb('file:///webview/assets/templates/b.png', ''));
  check('导出收集模板路径并跳过截图与无路径图', JSON.stringify(editor.collectExportTemplatePaths(fakeGraph)) === JSON.stringify(['assets/templates/a.png']));
  const beforePost = posted.length;
  editor.applyInlineThumbnails(fakeGraph, new Map([['assets/templates/a.png', 'data:image/png;base64,AAEK']]));
  const thumbs = fakeGraph.querySelectorAll('image.node-preview-image');
  check('导出内嵌 data URL 且未命中项保持原 href', thumbs[0].getAttribute('href') === 'data:image/png;base64,AAEK'
    && thumbs[1].getAttribute('href') === 'data:image/png;base64,QUJD'
    && thumbs[2].getAttribute('href') === 'file:///webview/assets/templates/b.png'
    && posted.length === beforePost);
  console.log(ok ? 'DOM SMOKE OK' : 'DOM SMOKE FAILED');
  process.exit(ok ? 0 : 1);
})();
