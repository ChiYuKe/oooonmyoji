import { parseDocument } from '../shared/workflow/graph-dsl';
import { toCanvasDocument } from '../shared/workflow/graph-document';
import { nodeDisplayTitle } from '../canvas/model/node-title';
import { testProfileKey, type WorkflowTestInit, type WorkflowTestRequest, type WorkflowTestEvent, type TestExpectation, type TestCommand, type TestNodeDraft } from '../shared/workflow-testing';
import { TEST_NODE_ID, nodeTestText, validateTestNode } from '../shared/node-test';
import { actionLabel, fieldLabel, outputFieldLabel } from '../canvas/ui/labels';
import type { ActionSpec, ParameterInfo } from '../shared/contracts';
import { createIcons, Copy, FolderOpen, Minus, Pause, Play, Plus, Square, StepForward, X } from 'lucide';
import { installTestResizer } from './workflow-test-layout';

const api = window.onmyoji;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string): HTMLInputElement => $(id);
const select = (id: string): HTMLSelectElement => $(id);
const button = (id: string): HTMLButtonElement => $(id);
const area = (id: string): HTMLTextAreaElement => $(id);
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.textContent = text;
  const controlClass = tag === 'button' ? 'ui-button' : ['input', 'select', 'textarea'].includes(tag) ? 'ui-input' : '';
  element.className = [controlClass, className].filter(Boolean).join(' '); return element;
};
const pretty = (value: unknown): string => JSON.stringify(value, null, 2) ?? '—';
const stateLabel = (value: string): string => ({ succeeded: '成功', failed: '失败', cancelled: '已停止', branch_miss: '分支未命中', running: '执行中' }[value] || value);
// 工作流 uri 是 `pathToFileURL()` 出来的 file:// URL：非 ASCII 文件名在里面是百分号编码，
// 直接取最后一段会把「御魂组队_队长.owf」显示成 `%E5%BE%A1…owf`。显示前一律先解码，
// 解码失败（文件名里本来就有 `%` 号）时退回原串。
const displayFileUri = (uri: string): string => {
  const label = uri.split(/[\\/]/).pop() || '';
  try {
    return decodeURIComponent(label);
  } catch {
    return label;
  }
};
type RecordValue = Record<string, any>;
type SavedCase = Omit<WorkflowTestRequest, 'text' | 'uri' | 'instanceId' | 'images'>;
let init: WorkflowTestInit;
let graph: RecordValue;
let catalog: ActionSpec[] = [];
let selected = new Set<string>(), breakpoints = new Set<string>();
let images: string[] = [];
let overrides: Record<string, Record<string, unknown>> = {};
let editingNode = '';
let expectations: TestExpectation[] = [];
let cases: Record<string, SavedCase> = {};
let inputReaders: Record<string, () => unknown> = {};
let busy = false, paused = false, canPause = true;
let pending = false;
let steps: WorkflowTestEvent[] = [];
let selectedStep: WorkflowTestEvent | undefined;
let following = true;
let detailView = 'screen';
let labMode = true;
let labDraft: TestNodeDraft = { action: '', name: '', params: {} };
let labReaders: Record<string, () => unknown> = {};
let labDrafts: Record<string, TestNodeDraft> = {};
let adding = false;
let templateAssets: Array<{ path: string; uri: string }> = [];
let templateFolder = 'assets';
let selectedTemplate = '';
let chooseTemplate: ((path: string) => void) | undefined;
let roiTargetFields: HTMLInputElement[] = [];
let roiCaptureSize: [number, number] = [0, 0];
let roiDragStart: [number, number] | undefined;
let roiDragEnd: [number, number] | undefined;
let roiPointerId: number | undefined;
let roiReferenceResolution: [number, number] = [1920, 1080];
let roiReady = false;
let roiRequestRevision = 0;

function commitLabDraft(): TestNodeDraft {
  const params: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(labReaders)) { const value = read(); if (value !== undefined) params[name] = value; }
  labDraft = { action: labDraft.action, name: input('lab-name').value.trim(), params };
  if (labDraft.action) labDrafts[labDraft.action] = structuredClone(labDraft);
  return labDraft;
}

function renderActionOptions(): void {
  const chooser = select('lab-action'); chooser.replaceChildren();
  const query = input('action-search').value.trim().toLocaleLowerCase();
  for (const action of catalog) {
    if (action.name !== labDraft.action && query && !`${actionLabel(action.name)} ${action.name} ${action.description}`.toLocaleLowerCase().includes(query)) continue;
    const option = node('option', actionLabel(action.name)); option.value = action.name; chooser.appendChild(option);
  }
  chooser.value = labDraft.action;
}

function selectLabAction(action: string, imported?: TestNodeDraft): void {
  const spec = catalog.find(item => item.name === action);
  if (!spec) return;
  const defaults: Record<string, unknown> = {};
  for (const [name, info] of Object.entries(spec.parameters)) if (info.default !== undefined) defaults[name] = structuredClone(info.default);
  labDraft = structuredClone(imported || labDrafts[action] || { action, name: actionLabel(action), params: defaults });
  input('lab-name').value = labDraft.name; renderActionOptions(); renderLabParameters();
}

function matchReferenceOptions(): Array<{ ref: string; label: string }> {
  const options: Array<{ ref: string; label: string }> = [];
  const visit = (schema: RecordValue, ref: string, source: RecordValue, depth = 0): void => {
    if (!schema || depth > 5) return;
    if (schema.type === 'object') {
      if (!ref.endsWith('.output')) {
        const segments = ref.split('.').slice(3).map((part) => /^\d+$/.test(part) ? `第 ${Number(part) + 1} 项` : outputFieldLabel(part));
        options.push({ ref, label: `${nodeDisplayTitle(source)} · ${segments.join(' / ')}` });
      }
      for (const [key, property] of Object.entries(schema.properties || {}) as [string, RecordValue][]) visit(property, `${ref}.${key}`, source, depth + 1);
    } else if (schema.type === 'array' && schema.items?.type === 'object') {
      visit(schema.items, `${ref}.0`, source, depth + 1);
    }
  };
  for (const source of graph.nodes as RecordValue[]) {
    if (!source.action) continue;
    const spec = catalog.find((item) => item.name === source.action);
    if (spec?.outputSchema) visit(spec.outputSchema as RecordValue, `nodes.${source.id}.output`, source);
  }
  return options;
}

function renderLabParameters(): void {
  labReaders = {}; $('lab-parameters').replaceChildren();
  const spec = catalog.find(item => item.name === labDraft.action);
  $('action-description').textContent = spec?.description || '';
  for (const [name, info] of Object.entries(spec?.parameters || {})) {
    const box = node('div', '', 'lab-parameter');
    box.dataset.parameter = name;
    if (['integer', 'number', 'duration', 'boolean'].includes(info.type) && info.editor !== 'asset') box.classList.add('lab-parameter-compact');
    const label = info.display_name || spec?.card?.find(row => row.param === name)?.label || fieldLabel(name);
    if (name === 'match' && info.type === 'object') {
      const fieldLabelNode = node('label', `${label}${info.required ? ' *' : ''}`);
      const picker = node('select', '', 'ui-input');
      picker.setAttribute('aria-label', label);
      const currentRef = typeof labDraft.params[name] === 'object' && labDraft.params[name] !== null
        ? String((labDraft.params[name] as RecordValue).ref || '') : '';
      const placeholder = node('option', '选择上游识别结果…'); placeholder.value = ''; picker.appendChild(placeholder);
      const options = matchReferenceOptions();
      for (const option of options) {
        const item = node('option', option.label); item.value = option.ref; picker.appendChild(item);
      }
      if (currentRef && !options.some((option) => option.ref === currentRef)) {
        const sourceId = currentRef.split('.')[1];
        const source = (graph.nodes as RecordValue[]).find((entry) => entry.id === sourceId);
        const item = node('option', source ? `${nodeDisplayTitle(source)} · 当前匹配结果` : '原有匹配结果（来源节点已移除）');
        item.value = currentRef; picker.appendChild(item);
      }
      picker.value = currentRef;
      fieldLabelNode.appendChild(picker);
      box.append(fieldLabelNode, node('p', options.length ? '选择上游识别节点的匹配结果，点击测试时会自动传入。' : '流程中还没有可引用的识别结果，请先添加模板识别节点。', 'hint'));
      labReaders[name] = () => picker.value ? { ref: picker.value } : undefined;
      $('lab-parameters').appendChild(box);
      continue;
    }
    const control = valueControl(`${label}${info.required ? ' *' : ''}`, labDraft.params[name], info, true);
    labReaders[name] = control.read;
    box.appendChild(control.label);
    if (name.toLocaleLowerCase() === 'roi' && info.type === 'rect') {
      const pickRoi = node('button', '从画面框选', 'roi-pick-button');
      pickRoi.addEventListener('click', () => guarded(() => openRoiPicker(Array.from(control.control.querySelectorAll<HTMLInputElement>('input')))));
      const heading = node('div', '', 'roi-field-heading');
      heading.append(node('span', `${label}${info.required ? ' *' : ''}`), pickRoi);
      control.label.replaceChildren(heading, control.control);
    }
    if (info.type === 'asset' || info.editor === 'asset') {
      const field = control.control as HTMLInputElement;
      const row = node('div', '', 'asset-field'); const pick = node('button', '选择模板');
      // Move the existing input into a row without recreating its reader.
      control.label.appendChild(row); row.append(field, pick);
      const preview = node('img', '', 'template-preview'); preview.alt = '所选模板'; preview.hidden = true; box.appendChild(preview);
      let revision = 0;
      const refresh = async (): Promise<void> => {
        const token = ++revision; const path = field.value.trim();
        preview.hidden = true;
        if (!path) return;
        try { const data = await api.readAssetData([path]); if (revision === token && data[0]?.dataUrl) { preview.src = data[0].dataUrl; preview.hidden = false; } } catch { /* Typed paths remain editable when a preview is unavailable. */ }
      };
      pick.addEventListener('click', () => guarded(() => openTemplatePicker(path => { field.value = path; void refresh(); }, field.value.trim())));
      field.addEventListener('change', () => { void refresh(); }); void refresh();
    }
    if (info.description && info.required) box.appendChild(node('p', info.description, 'hint'));
    $('lab-parameters').appendChild(box);
  }
  if (!spec) $('lab-parameters').appendChild(node('p', '请选择节点动作。', 'hint'));
  button('add-to-canvas').disabled = busy || pending || adding || !spec;
}

function roiImagePoint(event: PointerEvent, clampOutside = true): [number, number] | undefined {
  const image = $<HTMLImageElement>('roi-image');
  const bounds = image.getBoundingClientRect();
  if (image.naturalWidth < 1 || bounds.width < 1 || bounds.height < 1 || !roiCaptureSize[0] || !roiCaptureSize[1]) return undefined;
  if (!clampOutside && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) return undefined;
  const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
  const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
  return [x * roiCaptureSize[0] / bounds.width, y * roiCaptureSize[1] / bounds.height];
}

function selectedRoi(): [number, number, number, number] | undefined {
  if (!roiReady || !roiDragStart || !roiDragEnd) return undefined;
  if (Math.abs(roiDragEnd[0] - roiDragStart[0]) < 2 || Math.abs(roiDragEnd[1] - roiDragStart[1]) < 2) return undefined;
  const [referenceWidth, referenceHeight] = roiReferenceResolution;
  const scaleX = referenceWidth / roiCaptureSize[0];
  const scaleY = referenceHeight / roiCaptureSize[1];
  const x = Math.max(0, Math.min(referenceWidth - 1, Math.round(Math.min(roiDragStart[0], roiDragEnd[0]) * scaleX)));
  const y = Math.max(0, Math.min(referenceHeight - 1, Math.round(Math.min(roiDragStart[1], roiDragEnd[1]) * scaleY)));
  const right = Math.min(referenceWidth, Math.round(Math.max(roiDragStart[0], roiDragEnd[0]) * scaleX));
  const bottom = Math.min(referenceHeight, Math.round(Math.max(roiDragStart[1], roiDragEnd[1]) * scaleY));
  return right > x && bottom > y ? [x, y, right - x, bottom - y] : undefined;
}

function renderRoiSelection(): void {
  const selection = $('roi-selection');
  const image = $<HTMLImageElement>('roi-image');
  const stage = $('roi-stage');
  const roi = selectedRoi();
  button('confirm-roi').disabled = roiPointerId !== undefined || !roi;
  $('roi-hint').textContent = roi ? `识别区域：${roi[0]}, ${roi[1]} · ${roi[2]} × ${roi[3]}` : '请拖动鼠标框选有效区域';
  if (!roiDragStart || !roiDragEnd) { selection.style.display = 'none'; return; }
  const imageBounds = image.getBoundingClientRect();
  const stageBounds = stage.getBoundingClientRect();
  const left = Math.min(roiDragStart[0], roiDragEnd[0]) / roiCaptureSize[0] * imageBounds.width;
  const top = Math.min(roiDragStart[1], roiDragEnd[1]) / roiCaptureSize[1] * imageBounds.height;
  const width = Math.abs(roiDragEnd[0] - roiDragStart[0]) / roiCaptureSize[0] * imageBounds.width;
  const height = Math.abs(roiDragEnd[1] - roiDragStart[1]) / roiCaptureSize[1] * imageBounds.height;
  selection.style.display = width > 0 && height > 0 ? 'block' : 'none';
  selection.style.left = `${imageBounds.left - stageBounds.left + left}px`;
  selection.style.top = `${imageBounds.top - stageBounds.top + top}px`;
  selection.style.width = `${width}px`;
  selection.style.height = `${height}px`;
}

async function openRoiPicker(fields: HTMLInputElement[]): Promise<void> {
  if (fields.length !== 4) throw new Error('识别区域坐标输入不完整');
  const instanceId = select('instance').value;
  if (!instanceId) throw new Error('请先选择运行实例');
  const resolution = Array.isArray(graph.resolution) ? graph.resolution : [1920, 1080];
  const referenceResolution: [number, number] = [Number(resolution[0]) || 1920, Number(resolution[1]) || 1080];
  const revision = ++roiRequestRevision;
  status('正在获取模拟器画面…');
  const capture = await api.captureRoi({ instanceId, referenceResolution });
  if (revision !== roiRequestRevision) return;
  roiTargetFields = fields;
  roiCaptureSize = [capture.width, capture.height];
  roiReferenceResolution = referenceResolution;
  roiPointerId = undefined; roiReady = false;
  roiDragStart = undefined; roiDragEnd = undefined;
  $<HTMLImageElement>('roi-image').src = capture.dataUrl;
  $('roi-selection').style.display = 'none';
  $('roi-loading').textContent = '正在获取模拟器画面…';
  $('roi-loading').hidden = false;
  renderRoiSelection();
  const dialog = $<HTMLDialogElement>('roi-dialog');
  if (!dialog.open) dialog.showModal();
  const image = $<HTMLImageElement>('roi-image');
  try { await image.decode(); }
  catch {
    if (revision !== roiRequestRevision) return;
    $('roi-loading').textContent = '画面加载失败，请关闭后重新框选';
    status('模拟器画面加载失败，请重新框选。', true);
    return;
  }
  if (revision !== roiRequestRevision) return;
  roiReady = true;
  $('roi-loading').hidden = true;
  renderRoiSelection();
  status('拖动画面框选识别区域。');
}

const roiStage = $('roi-stage');
roiStage.addEventListener('pointerdown', (event) => {
  if (!roiReady || event.button !== 0 || roiPointerId !== undefined) return;
  const point = roiImagePoint(event, false);
  if (!point) return;
  event.preventDefault();
  roiPointerId = event.pointerId;
  roiDragStart = point; roiDragEnd = point;
  roiStage.setPointerCapture(event.pointerId);
  renderRoiSelection();
});
roiStage.addEventListener('pointermove', (event) => {
  if (roiPointerId !== event.pointerId) return;
  roiDragEnd = roiImagePoint(event) || roiDragEnd;
  renderRoiSelection();
});
roiStage.addEventListener('pointerup', (event) => {
  if (roiPointerId !== event.pointerId) return;
  roiDragEnd = roiImagePoint(event) || roiDragEnd;
  roiPointerId = undefined;
  if (roiStage.hasPointerCapture(event.pointerId)) roiStage.releasePointerCapture(event.pointerId);
  renderRoiSelection();
});
for (const type of ['pointercancel', 'lostpointercapture']) roiStage.addEventListener(type, (event) => {
  if (roiPointerId !== (event as PointerEvent).pointerId) return;
  roiPointerId = undefined; roiDragStart = undefined; roiDragEnd = undefined;
  renderRoiSelection();
});
window.addEventListener('resize', () => { if ($<HTMLDialogElement>('roi-dialog').open) renderRoiSelection(); });

function closeRoiPicker(): void {
  ++roiRequestRevision;
  const pointerId = roiPointerId;
  roiPointerId = undefined;
  if (pointerId !== undefined && roiStage.hasPointerCapture(pointerId)) roiStage.releasePointerCapture(pointerId);
  roiReady = false;
  $<HTMLDialogElement>('roi-dialog').close();
  $<HTMLImageElement>('roi-image').removeAttribute('src');
  roiTargetFields = []; roiDragStart = undefined; roiDragEnd = undefined;
}

function applyRoiSelection(): void {
  const roi = selectedRoi();
  if (!roi || roiPointerId !== undefined || roiTargetFields.length !== 4) return;
  roi.forEach((value, index) => {
    roiTargetFields[index].value = String(value);
    roiTargetFields[index].dispatchEvent(new Event('input', { bubbles: true }));
    roiTargetFields[index].dispatchEvent(new Event('change', { bubbles: true }));
  });
  closeRoiPicker();
  status(`已框选识别区域：${roi[0]}, ${roi[1]} ${roi[2]}×${roi[3]}`);
}

function testKindChanged(): void {
  labMode = select('test-kind').value === 'node';
  $('app').classList.toggle('node-lab', labMode);
  $('node-lab').hidden = !labMode; $('workflow-config').hidden = labMode; button('add-to-canvas').hidden = !labMode;
  $('environment-title').textContent = labMode ? '3. 选择画面并测试' : '1. 选择测试环境';
  $('start-label').textContent = labMode ? '测试节点' : '开始测试';
  button('view-output').textContent = labMode ? '输出结果' : '输出与检查';
  $('empty-title').textContent = labMode ? '先调好一个节点，再放进画布' : '从一个节点开始验证';
  $('empty-message').textContent = labMode ? '选择节点动作，填写参数和模板，点击「测试节点」。满意后点击「添加到画布」，保留当前配置。' : '左侧找到节点，点击「单测」。执行画面、识别结果和错误会显示在这里。';
  if (!steps.length) runBanner('准备就绪', labMode ? '选择动作，填写参数，开始测试' : '选择范围后，点击开始测试', labMode ? '测试只运行当前节点；满意后可直接添加到画布。' : '也可以点击节点旁的「单测」，直接验证一个节点。');
}

function renderTemplates(): void {
  const list = $('template-list'); list.replaceChildren();
  const query = input('template-search').value.trim().toLocaleLowerCase('zh-CN');
  const folders = $('template-folders'); folders.replaceChildren();
  const counts = new Map<string, number>([['assets', 0]]);
  for (const asset of templateAssets) {
    const parts = asset.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const folder = parts.slice(0, index).join('/');
      counts.set(folder, (counts.get(folder) || 0) + 1);
    }
  }
  if (!counts.has(templateFolder)) templateFolder = 'assets';
  for (const [folder, count] of [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'))) {
    const item = node('button', '', `asset-folder${folder === templateFolder ? ' selected' : ''}`);
    item.style.paddingLeft = `${10 + Math.max(0, folder.split('/').length - 1) * 14}px`;
    const name = node('span', folder === 'assets' ? '全部图片' : folder.slice(folder.lastIndexOf('/') + 1), 'asset-folder-name');
    name.title = folder;
    item.append(name, node('span', String(count), 'asset-folder-count'));
    item.addEventListener('click', () => { templateFolder = folder; renderTemplates(); });
    folders.appendChild(item);
  }
  const visible = templateAssets.filter(asset => {
    const inFolder = templateFolder === 'assets' || asset.path.startsWith(`${templateFolder}/`);
    return inFolder && (!query || asset.path.toLocaleLowerCase('zh-CN').includes(query));
  });
  $('template-total').textContent = `${visible.length} / ${templateAssets.length} 张图片`;
  const selectedPath = $('template-selected-path');
  selectedPath.textContent = selectedTemplate || '未选择图片'; selectedPath.title = selectedTemplate;
  button('choose-template').disabled = !selectedTemplate;
  const applySelection = (path: string): void => {
    selectedTemplate = path;
    selectedPath.textContent = path; selectedPath.title = path;
    button('choose-template').disabled = false;
    for (const tile of Array.from(list.children) as HTMLElement[]) {
      tile.classList.toggle('selected', tile.dataset.path === path);
      tile.setAttribute('aria-pressed', String(tile.dataset.path === path));
    }
  };
  for (const asset of visible) {
    const tile = node('button', '', `asset-tile${asset.path === selectedTemplate ? ' selected' : ''}`);
    tile.dataset.path = asset.path; tile.title = asset.path; tile.setAttribute('aria-pressed', String(asset.path === selectedTemplate));
    const preview = node('span', '', 'asset-preview');
    const image = document.createElement('img'); image.src = asset.uri; image.alt = ''; image.loading = 'lazy';
    image.addEventListener('error', () => { preview.classList.add('failed'); image.remove(); preview.appendChild(node('span', '无法预览')); });
    preview.appendChild(image); tile.appendChild(preview);
    tile.append(node('span', asset.path.slice(asset.path.lastIndexOf('/') + 1), 'asset-name'), node('span', asset.path, 'asset-path'));
    tile.addEventListener('click', () => applySelection(asset.path));
    tile.addEventListener('dblclick', () => { chooseTemplate?.(asset.path); $<HTMLDialogElement>('template-dialog').close(); });
    list.appendChild(tile);
  }
  if (!visible.length) list.appendChild(node('div', query ? '没有匹配的图片' : '此文件夹中没有图片', 'asset-browser-status'));
}

async function openTemplatePicker(choose: (path: string) => void, currentPath = ''): Promise<void> {
  chooseTemplate = choose;
  templateAssets = await api.listAssets();
  selectedTemplate = currentPath;
  const slash = currentPath.replace(/\\/g, '/').lastIndexOf('/');
  templateFolder = slash > 0 ? currentPath.replace(/\\/g, '/').slice(0, slash) : 'assets';
  input('template-search').value = ''; renderTemplates(); $<HTMLDialogElement>('template-dialog').showModal();
}

function configTab(tab: string): void {
  for (const name of ['nodes', 'parameters', 'checks', 'cases']) {
    $(`panel-${name}`).hidden = name !== tab;
    button(`tab-${name}`).classList.toggle('active', name === tab);
    button(`tab-${name}`).setAttribute('aria-pressed', String(name === tab));
  }
}

function showView(view: string): void {
  detailView = view;
  for (const [name, panel] of [['screen', 'screen'], ['output', 'data'], ['params', 'input']]) {
    $(`detail-${panel}`).hidden = name !== view || !selectedStep;
    button(`view-${name}`).classList.toggle('active', name === view);
    button(`view-${name}`).setAttribute('aria-pressed', String(name === view));
  }
}

function runBanner(state: string, title: string, message: string, kind = ''): void {
  $('run-state').textContent = state; $('run-title').textContent = title; $('run-message').textContent = message;
  $('run-banner').className = `run-banner ${kind}`;
}

function status(message: string, error = false): void {
  $('status').textContent = message; $('status').classList.toggle('error', error);
}

function guarded(action: () => Promise<unknown> | unknown): void {
  void Promise.resolve().then(action).catch((error) => status(error instanceof Error ? error.message : String(error), true));
}

function setBusy(value: boolean, isPaused = false): void {
  busy = value; paused = isPaused;
  button('start').disabled = value || pending;
  button('pause').disabled = !value || isPaused || !canPause;
  button('step').disabled = !value || !isPaused;
  button('continue').disabled = !value || !isPaused;
  button('stop').disabled = !value;
  // Session configuration is a snapshot; edits apply to the next run.
  for (const id of ['load-case', 'delete-case', 'pick-images']) button(id).disabled = value;
  for (const control of $('node-list').querySelectorAll<HTMLButtonElement>('.node-run')) control.disabled = value || pending;
  button('test-node').disabled = value || pending || !editingNode;
  select('test-kind').disabled = value || pending;
  button('add-to-canvas').disabled = value || pending || adding || !labDraft.action;
}

function objectValue(id: string): Record<string, unknown> {
  const value = JSON.parse(area(id).value || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${id === 'variables' ? '变量' : '前置输出'}必须填写对象`);
  return value;
}

function readRequest(): WorkflowTestRequest {
  if (labMode) {
    const draft = validateTestNode(commitLabDraft(), catalog);
    return { ...init, text: nodeTestText(draft, graph.resolution || [1920, 1080]), nodeIds: [TEST_NODE_ID], instanceId: select('instance').value,
      mode: select('mode').value as 'live' | 'offline', images, rounds: Number(input('rounds').value),
      singleStep: false, breakpoints: [], parameterOverrides: {}, inputs: {}, variables: {}, outputs: {}, expectations: [],
    };
  }
  const inputs: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(inputReaders)) {
    const value = read(); if (value !== undefined) inputs[name] = value;
  }
  const request: WorkflowTestRequest = { ...init, nodeIds: [...selected], instanceId: select('instance').value,
    mode: select('mode').value as 'live' | 'offline', images,
    rounds: Number(input('rounds').value), singleStep: input('single-step').checked,
    breakpoints: [...breakpoints], parameterOverrides: overrides, inputs,
    variables: objectValue('variables'), outputs: objectValue('outputs'), expectations,
  };
  return request;
}

function modeChanged(): void {
  const offline = select('mode').value === 'offline';
  $('offline-options').hidden = !offline; $('instance-label').hidden = offline;
  $('mode-help').textContent = offline
    ? '每张截图重复指定次数。只运行视觉识别；截图保持固定，等待出现/消失仍使用节点的超时设置。'
    : '每轮从设备当前状态开始，会执行流程中的点击和输入。测试前请把画面准备到对应位置。';
}

function scopeHint(): void {
  const names = (graph.nodes as RecordValue[]).filter(item => selected.has(item.id)).map(item => nodeDisplayTitle(item));
  $('scope-help').textContent = names.length ? `测试：${names.slice(0, 2).join('、')}${names.length > 2 ? ` 等 ${names.length} 个节点` : ''}` : '测试整个流程';
  $('scope-help').title = '选中容器时运行它的子流程；同时选中父子节点时只执行父节点。未勾选表示整个流程。';
  button('all-nodes').classList.toggle('active', !selected.size);
  button('selected-nodes').disabled = !init.nodeIds.length;
}

function renderNodes(): void {
  const list = $('node-list'); list.replaceChildren();
  const nodes = graph.nodes as RecordValue[];
  const byId = new Map(nodes.map(item => [item.id, item]));
  const ordered: { item: RecordValue; depth: number }[] = [], visited = new Set<string>();
  const visit = (id: string, depth: number): void => {
    const item = byId.get(id); if (!item || visited.has(id)) return;
    visited.add(id); ordered.push({ item, depth });
    const children = [...(item.children || []), ...Object.values(item.ports || {}), ...(item.cases || []).map((entry: RecordValue) => entry.child), item.default_child];
    for (const child of children) if (typeof child === 'string') visit(child, depth + 1);
  };
  visit(graph.root, 0); for (const item of nodes) visit(item.id, 0);
  const query = input('node-search').value.trim().toLocaleLowerCase();
  for (const { item, depth } of ordered) {
    if (query && !`${nodeDisplayTitle(item)} ${item.id} ${item.action || ''}`.toLocaleLowerCase().includes(query)) continue;
    const row = node('div', '', 'node-row');
    row.style.setProperty('--node-depth', String(query ? 0 : Math.min(depth, 4)));
    row.classList.toggle('in-scope', selected.has(item.id));
    const test = node('input'); test.type = 'checkbox'; test.className = 'ui-checkbox'; test.checked = selected.has(item.id); test.setAttribute('aria-label', `测试 ${item.name || item.id}`);
    test.addEventListener('change', () => { if (test.checked) selected.add(item.id); else selected.delete(item.id); row.classList.toggle('in-scope', test.checked); scopeHint(); });
    const name = node('button', nodeDisplayTitle(item), 'node-name'); name.classList.toggle('active', editingNode === item.id);
    name.title = item.id;
    name.appendChild(node('small', item.action || ({ root: '流程入口', sequence: '按顺序执行', select: '选择分支', condition: '条件判断', parallel: '并行执行' } as Record<string, string>)[item.type] || item.type));
    name.addEventListener('click', () => guarded(() => { commitParameters(); editingNode = item.id; renderParameters(); renderNodes(); configTab('parameters'); }));
    const breakpoint = node('input'); breakpoint.type = 'checkbox'; breakpoint.className = 'ui-checkbox'; breakpoint.checked = breakpoints.has(item.id); breakpoint.setAttribute('aria-label', `断点 ${item.name || item.id}`);
    breakpoint.addEventListener('change', () => { if (breakpoint.checked) breakpoints.add(item.id); else breakpoints.delete(item.id); });
    const run = node('button', '单测', 'node-run'); run.disabled = busy || pending; run.setAttribute('aria-label', `单测 ${nodeDisplayTitle(item)}`);
    run.addEventListener('click', () => guarded(() => startTest(item.id)));
    row.append(test, name, breakpoint, run); list.appendChild(row);
  }
  if (!list.children.length) list.appendChild(node('p', '没有找到节点，试试其他名称或动作。', 'hint'));
  scopeHint();
}

/** Typed values use controls shaped for people; untyped objects keep a JSON fallback. */
function valueControl(labelText: string, value: unknown, definition: Partial<ParameterInfo> = {}, optional = false): { label: HTMLLabelElement; read: () => unknown; control: HTMLElement } {
  const label = node('label', labelText);
  let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const type = definition.type || (typeof value === 'object' && value !== null ? 'object' : typeof value);
  if (type === 'boolean' && (typeof value === 'boolean' || value === undefined)) {
    const dropdown = node('select');
    for (const [id, text] of [['', '使用默认值'], ['true', '是'], ['false', '否']]) { const option = node('option', text); option.value = id; dropdown.appendChild(option); }
    dropdown.value = value === undefined ? '' : String(value); control = dropdown;
  } else if (definition.enum && (value === undefined || typeof value !== 'object')) {
    const dropdown = node('select'); const empty = node('option', '使用默认值'); empty.value = ''; dropdown.appendChild(empty);
    for (const choice of definition.enum) { const option = node('option', String(choice)); option.value = JSON.stringify(choice); dropdown.appendChild(option); }
    dropdown.value = value === undefined ? '' : JSON.stringify(value); control = dropdown;
  } else if ((type === 'rect' || type === 'point') && (value === undefined || typeof value === 'object')) {
    const wrapper = node('div', '', 'coordinate-fields'); const keys = type === 'rect' ? ['X', 'Y', '宽', '高'] : ['X', 'Y'];
    const values = type === 'rect' ? value as number[] | undefined : value ? [(value as RecordValue).x, (value as RecordValue).y] : undefined;
    const fields = keys.map((key, index) => { const item = node('div', key), field = node('input'); field.type = 'number'; field.step = '1'; field.value = values?.[index] == null ? '' : String(values[index]); field.setAttribute('aria-label', `${labelText} ${key}`); item.appendChild(field); wrapper.appendChild(item); return field; });
    label.appendChild(wrapper);
    return { label, control: wrapper, read: () => {
      if (optional && fields.every(field => !field.value.trim())) return undefined;
      const numbers = fields.map(field => { if (!field.value.trim() || !Number.isInteger(Number(field.value))) throw new Error(`${labelText}需要填写整数坐标`); return Number(field.value); });
      return type === 'rect' ? numbers : { x: numbers[0], y: numbers[1] };
    } };
  } else if (type === 'array' && definition.items?.type === 'object' && definition.items.properties) {
    const minimum = definition.minItems || 0;
    const entries: RecordValue[] = Array.isArray(value) ? structuredClone(value) : Array.from({ length: minimum }, () => ({}));
    const wrapper = node('div', '', 'object-list');
    const renderEntries = (): void => {
      wrapper.replaceChildren();
      entries.forEach((entry, index) => {
        const card = node('div', '', 'object-list-card');
        const head = node('div', '', 'object-list-head');
        head.appendChild(node('strong', `${labelText} ${index + 1}`));
        if (definition.maxItems === undefined || entries.length > minimum) {
          const remove = node('button', '删除', 'array-remove'); remove.type = 'button';
          remove.addEventListener('click', () => { entries.splice(index, 1); renderEntries(); }); head.appendChild(remove);
        }
        card.appendChild(head);
        const readers: Array<[string, ParameterInfo, () => unknown]> = [];
        for (const [key, childInfo] of Object.entries(definition.items!.properties!) as [string, ParameterInfo][]) {
          const child = valueControl(childInfo.display_name || fieldLabel(key), entry[key] ?? childInfo.default, childInfo, !childInfo.required);
          card.appendChild(child.label); readers.push([key, childInfo, child.read]);
        }
        (card as HTMLElement & { readEntry?: () => RecordValue }).readEntry = () => {
          const next: RecordValue = {};
          for (const [key, childInfo, read] of readers) {
            const childValue = read();
            if (childInfo.required && (childValue === undefined || childValue === '')) throw new Error(`${labelText}第 ${index + 1} 项的「${childInfo.display_name || fieldLabel(key)}」不能为空`);
            if (childValue !== undefined) next[key] = childValue;
          }
          return next;
        };
        wrapper.appendChild(card);
      });
      if (definition.maxItems === undefined || entries.length < definition.maxItems) {
        const add = node('button', '添加一项', 'array-add'); add.type = 'button';
        add.addEventListener('click', () => { entries.push({}); renderEntries(); }); wrapper.appendChild(add);
      }
    };
    renderEntries(); label.appendChild(wrapper);
    return { label, control: wrapper, read: () => {
      if (optional && !entries.length) return undefined;
      if (definition.minItems !== undefined && entries.length < definition.minItems) throw new Error(`${labelText}至少需要 ${definition.minItems} 项`);
      if (definition.maxItems !== undefined && entries.length > definition.maxItems) throw new Error(`${labelText}最多允许 ${definition.maxItems} 项`);
      return Array.from(wrapper.querySelectorAll<HTMLElement>('.object-list-card')).map((card) => (card as HTMLElement & { readEntry?: () => RecordValue }).readEntry?.() || {});
    } };
  } else if (type === 'array' && definition.items && !['object', 'array'].includes(definition.items.type)) {
    const itemDefinition = definition.items;
    const itemType = itemDefinition.type;
    const initial = Array.isArray(value) ? value : [];
    const fixedPair = definition.minItems === 2 && definition.maxItems === 2;
    const wrapper = node('div', '', `array-editor${fixedPair ? ' array-pair' : ''}`);
    const fields: HTMLInputElement[] = [];
    const createField = (itemValue: unknown, index: number): HTMLInputElement => {
      const row = node('div', '', 'array-item');
      const caption = node('span', fixedPair && labelText.includes('间隔') ? (index === 0 ? '最短（秒）' : '最长（秒）') : `第 ${index + 1} 项`, 'array-item-label');
      const field = node('input');
      field.type = ['integer', 'number', 'duration'].includes(itemType) ? 'number' : 'text';
      field.step = itemType === 'integer' ? '1' : 'any';
      field.value = itemValue == null ? '' : String(itemValue);
      field.setAttribute('aria-label', `${labelText} ${caption.textContent}`);
      if (itemDefinition.min !== undefined) field.min = String(itemDefinition.min);
      if (itemDefinition.max !== undefined) field.max = String(itemDefinition.max);
      row.append(caption, field);
      if (!fixedPair) {
        const remove = node('button', '删除', 'array-remove'); remove.type = 'button';
        remove.setAttribute('aria-label', `删除${labelText}第 ${index + 1} 项`);
        remove.addEventListener('click', () => { const at = fields.indexOf(field); if (at >= 0) fields.splice(at, 1); row.remove(); });
        row.appendChild(remove);
      }
      wrapper.appendChild(row); fields.push(field); return field;
    };
    if (fixedPair) { createField(initial[0], 0); createField(initial[1], 1); }
    else {
      initial.forEach((item, index) => createField(item, index));
      const add = node('button', '添加一项', 'array-add'); add.type = 'button';
      add.addEventListener('click', () => createField(undefined, fields.length)); wrapper.appendChild(add);
    }
    label.appendChild(wrapper);
    return { label, control: wrapper, read: () => {
      const values = fields.map((field) => field.value.trim()).filter((item) => item !== '').map((item) => {
        if (['integer', 'number', 'duration'].includes(itemType)) {
          const number = Number(item);
          if (!Number.isFinite(number) || (itemType === 'integer' && !Number.isInteger(number))) throw new Error(`${labelText}需要填写有效数字`);
          return number;
        }
        return item;
      });
      if (optional && !values.length) return undefined;
      if (fixedPair && values.length !== 2) throw new Error(`${labelText}需要填写最短和最长两个值`);
      if (definition.minItems !== undefined && values.length < definition.minItems) throw new Error(`${labelText}至少需要 ${definition.minItems} 项`);
      if (definition.maxItems !== undefined && values.length > definition.maxItems) throw new Error(`${labelText}最多允许 ${definition.maxItems} 项`);
      if (fixedPair && Number(values[0]) > Number(values[1])) throw new Error(`${labelText}的最短值不能大于最长值`);
      return values;
    } };
  } else if (typeof value === 'object' && value !== null || ['array', 'object', 'any'].includes(type)) {
    const textarea = node('textarea'); textarea.value = value === undefined ? '' : pretty(value); textarea.spellcheck = false; control = textarea;
  } else {
    const field = node('input'); field.type = ['integer', 'number', 'duration'].includes(type) ? 'number' : 'text';
    if (field.type === 'number') field.step = type === 'integer' ? '1' : 'any';
    field.value = value === undefined ? '' : String(value); control = field;
  }
  label.appendChild(control);
  const read = (): unknown => {
    if (control.value === '' && optional) return undefined;
    if (control instanceof HTMLTextAreaElement) return JSON.parse(control.value || 'null');
    if (control instanceof HTMLSelectElement) return control.value === '' ? undefined : JSON.parse(control.value);
    if (control.type === 'number') { if (!control.value.trim() || !Number.isFinite(Number(control.value))) throw new Error(`${labelText}需要填写数字`); return Number(control.value); }
    return control.value;
  };
  return { label, read, control };
}

function renderInputs(values: Record<string, unknown> = {}): void {
  $('input-fields').replaceChildren(); inputReaders = {};
  for (const [name, definition] of Object.entries(graph.inputs || {}) as [string, ParameterInfo][]) {
    const control = valueControl(definition.display_name || name, Object.hasOwn(values, name) ? values[name] : definition.default, definition, true);
    $('input-fields').appendChild(control.label); inputReaders[name] = control.read;
  }
  if (!Object.keys(inputReaders).length) $('input-fields').appendChild(node('p', '此流程没有输入参数。', 'hint'));
}

let parameterReaders: Record<string, () => unknown> = {};
function commitParameters(): void {
  if (!editingNode || !Object.keys(parameterReaders).length) return;
  const values: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(parameterReaders)) { const value = read(); if (value !== undefined) values[name] = value; }
  overrides[editingNode] = values;
}

function renderParameters(): void {
  parameterReaders = {}; $('parameters').replaceChildren();
  const item = (graph.nodes as RecordValue[]).find((entry) => entry.id === editingNode);
  button('test-node').disabled = busy || pending || !item;
  button('reset-params').hidden = !item?.action;
  $('parameter-title').textContent = item ? `${item.name || item.id} · 只用于本次测试` : '点击上方节点名称调整参数。';
  if (!item?.action) { if (item) $('parameters').appendChild(node('p', '容器和数据节点使用编辑器中的配置。', 'hint')); return; }
  const definition = catalog.find((action) => action.name === item.action);
  const values = overrides[item.id] || item.params || {};
  const names = new Set([...Object.keys(definition?.parameters || {}), ...Object.keys(values)]);
  for (const name of names) {
    const info = definition?.parameters[name];
    const control = valueControl(info?.display_name || name, values[name], info, true);
    parameterReaders[name] = control.read;
    control.control.addEventListener('change', () => guarded(commitParameters));
    $('parameters').appendChild(control.label);
  }
}

function renderChecks(): void {
  const list = $('checks'); list.replaceChildren();
  button('tab-checks').textContent = expectations.length ? `预期 ${expectations.length}` : '预期';
  if (!expectations.length) list.appendChild(node('p', '暂未设置检查，流程执行成功就算通过。', 'hint'));
  expectations.forEach((rule, index) => {
    const box = node('div', '', 'expectation');
    const row = node('div', '', 'row');
    const path = node('input'); path.value = rule.path; path.placeholder = 'status 或 nodes.节点.output.字段'; path.setAttribute('aria-label', '检查字段');
    path.addEventListener('change', () => { rule.path = path.value; });
    const remove = node('button', '移除'); remove.addEventListener('click', () => { expectations.splice(index, 1); renderChecks(); }); row.append(path, remove);
    const operator = node('select');
    for (const [value, label] of [['equals', '等于'], ['contains', '包含'], ['count', '数量等于'], ['at_least', '至少'], ['exists', '存在']]) { const option = node('option', label); option.value = value; operator.appendChild(option); }
    operator.value = rule.operator; operator.setAttribute('aria-label', '检查方式');
    operator.addEventListener('change', () => { rule.operator = operator.value as TestExpectation['operator']; if (['count', 'at_least'].includes(rule.operator) && typeof rule.value !== 'number') rule.value = 1; renderChecks(); });
    box.append(row, operator);
    if (rule.operator !== 'exists') {
      const value = valueControl('预期值', rule.value, { type: typeof rule.value === 'number' ? 'number' : typeof rule.value === 'boolean' ? 'boolean' : typeof rule.value === 'object' ? 'object' : 'string' });
      value.control.addEventListener('change', () => guarded(() => { rule.value = value.read(); })); box.appendChild(value.label);
    }
    list.appendChild(box);
  });
}

function renderCases(): void {
  const chooser = select('cases'); chooser.replaceChildren();
  const empty = node('option', '新用例'); empty.value = ''; chooser.appendChild(empty);
  for (const name of Object.keys(cases)) { const option = node('option', name); option.value = name; chooser.appendChild(option); }
}

function applyCase(saved: SavedCase): void {
  selected = new Set(saved.nodeIds.filter((id) => graph.nodes.some((item: RecordValue) => item.id === id)));
  breakpoints = new Set(saved.breakpoints.filter((id) => graph.nodes.some((item: RecordValue) => item.id === id)));
  overrides = structuredClone(saved.parameterOverrides || {}); expectations = structuredClone(saved.expectations || []);
  input('rounds').value = String(saved.rounds); input('single-step').checked = saved.singleStep;
  select('mode').value = saved.mode; area('variables').value = pretty(saved.variables || {}); area('outputs').value = pretty(saved.outputs || {});
  renderInputs(saved.inputs); renderNodes(); renderParameters(); renderChecks(); modeChanged();
  status('已载入用例。离线测试请重新选择截图。');
}

async function initialize(value: WorkflowTestInit): Promise<void> {
  init = value; graph = toCanvasDocument(parseDocument(value.text)) as RecordValue;
  editingNode = ''; overrides = {}; expectations = []; cases = {}; images = []; steps = []; selectedStep = undefined;
  following = true; detailView = 'screen'; configTab('nodes'); input('node-search').value = '';
  $('steps-empty').hidden = false; $('follow-latest').hidden = true; $<HTMLDetailsElement>('run-summary').open = false;
  $('steps').replaceChildren(); $('round-results').replaceChildren(); $('failures').textContent = '';
  selected = new Set(init.nodeIds.filter((id) => graph.nodes.some((item: RecordValue) => item.id === id))); breakpoints = new Set();
  area('variables').value = '{}'; area('outputs').value = '{}'; input('rounds').value = '1'; input('single-step').checked = false;
  select('mode').value = 'live'; input('case-name').value = ''; $('image-list').textContent = '尚未选择截图';
  button('report').disabled = true;
  $('workflow-name').textContent = displayFileUri(value.uri) || graph.id || '当前工作流';
  $('workflow-name').title = `${graph.description || graph.id || ''}\n使用打开测试台时的编辑快照，重新打开可更新。`;
  const bootstrap = await api.bootstrap(); catalog = bootstrap.catalog;
  labDrafts = {}; labDraft = { action: '', name: '', params: {} }; input('action-search').value = '';
  const existing = select('lab-existing'); existing.replaceChildren(); const empty = node('option', '选择已有节点…'); empty.value = ''; existing.appendChild(empty);
  for (const item of graph.nodes as RecordValue[]) if (item.action) { const option = node('option', nodeDisplayTitle(item)); option.value = item.id; existing.appendChild(option); }
  const imported = (graph.nodes as RecordValue[]).find(item => init.nodeIds.length === 1 && init.nodeIds[0] === item.id && item.action);
  const action = imported?.action || catalog.find(item => item.name === 'vision.match_template')?.name || catalog[0]?.name;
  if (action) selectLabAction(action, imported ? { action, name: imported.name || actionLabel(action), params: imported.params || {} } : undefined);
  select('test-kind').value = 'node';
  select('instance').replaceChildren();
  for (const instance of bootstrap.instances) { const option = node('option', instance.displayName || instance.id); option.value = instance.id; select('instance').appendChild(option); }
  select('instance').value = init.instanceId;
  try {
    const raw = api.readLayout(testProfileKey(init.uri));
    const saved = raw ? JSON.parse(raw) : undefined;
    if (saved?.uri === init.uri && saved.cases && typeof saved.cases === 'object') cases = saved.cases;
  } catch { /* A malformed saved profile must not prevent opening a workflow. */ }
  renderCases(); renderInputs(); renderNodes(); renderParameters(); renderChecks(); modeChanged(); renderMetrics({});
  setBusy(false); showDetail(undefined); status('准备就绪。可直接单测节点，或点击开始测试运行所选范围。');
  runBanner('准备就绪', '选择范围后，点击开始测试', '也可以点击节点旁的「单测」，直接验证一个节点。');
  testKindChanged();
}

function renderMetrics(summary: RecordValue): void {
  $('summary-caption').textContent = summary.completed ? `${summary.completed} / ${summary.requested} 轮 · 通过率 ${summary.success_rate ?? '—'}%` : summary.requested ? `0 / ${summary.requested} 轮` : '测试后查看';
  const list = $('metrics'); list.replaceChildren();
  for (const [label, value] of [
    ['已完成', `${summary.completed ?? 0} / ${summary.requested ?? '—'}`],
    ['通过率', summary.success_rate == null ? '—' : `${summary.success_rate}%`],
    ['平均耗时', summary.mean_ms == null ? '—' : `${summary.mean_ms} ms`],
    ['P95 耗时', summary.p95_ms == null ? '—' : `${summary.p95_ms} ms`],
    ['最长耗时', summary.max_ms == null ? '—' : `${summary.max_ms} ms`],
  ]) { const metric = node('div', '', 'metric'); metric.append(node('small', label), node('strong', value)); list.appendChild(metric); }
  $('failures').textContent = Object.entries(summary.failures || {}).map(([name, count]) => `${name}：${count} 次未通过`).join(' · ');
}

function imageFor(id: string, emptyId: string, data: unknown): void {
  const image = $<HTMLImageElement>(id); image.hidden = typeof data !== 'string' || !data; $(emptyId).hidden = !image.hidden;
  if (typeof data === 'string' && data) image.src = `data:image/png;base64,${data}`; else image.removeAttribute('src');
}

function showDetail(event: WorkflowTestEvent | undefined): void {
  selectedStep = event;
  $('detail-empty').hidden = Boolean(event); $('detail-tabs').hidden = !event; $('detail-info').hidden = !event;
  showView(detailView);
  for (const element of $('steps').querySelectorAll('button')) element.classList.toggle('active', Number(element.dataset.index) === steps.indexOf(event!));
  const step = event?.step as RecordValue | undefined;
  $('detail-title').textContent = step ? `${step.name || step.step_id} · ${event?.type === 'paused' ? '执行前暂停' : stateLabel(step.status)}` : '节点结果';
  $('detail-info').textContent = step ? `${step.breadcrumb || step.step_id} · ${step.duration_ms == null ? event?.type === 'node_started' ? '正在执行' : '等待执行' : `${step.duration_ms} ms`}` : '点击步骤查看结果，或使用单步开始。';
  imageFor('before-image', 'before-empty', event?.type === 'paused' ? event.image : event?.before_image);
  imageFor('after-image', 'after-empty', event?.type === 'paused' ? undefined : event?.image);
  $('before-empty').textContent = event?.type === 'node_started' ? '此节点没有执行前画面' : '此步骤未记录画面';
  $('after-empty').textContent = event?.type === 'node_started' ? '执行中，结束后显示结果' : event?.type === 'paused' ? '点击下一步，执行后显示结果' : '此步骤未记录画面';
  $('detail-params').textContent = pretty(step?.params);
  $('detail-output').textContent = event?.type === 'paused' ? pretty({ variables: event.variables, outputs: event.outputs }) : pretty(step?.output);
  $('detail-error').textContent = step?.error || event?.screenshot_error || '';
  $('output-checks').replaceChildren(); $('assertion-results').replaceChildren();
  if (step && event?.type === 'step' && Object.hasOwn(step, 'output') && (step.workflow_depth || 0) === 0) {
    let count = 0;
    const addField = (value: unknown, path: string, depth = 0): void => {
      if (count >= 40 || depth > 5) return;
      count++;
      const row = node('div', '', 'output-check'); const preview = pretty(value);
      row.appendChild(node('code', `${path} = ${preview.length > 100 ? `${preview.slice(0, 100)}…` : preview}`));
      const add = node('button', '设为预期'); add.addEventListener('click', () => { expectations.push({ path, operator: 'equals', value: structuredClone(value) }); renderChecks(); configTab('checks'); status('已加入预期结果，下次测试会自动检查。'); }); row.appendChild(add); $('output-checks').appendChild(row);
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) addField(child, `${path}.${key}`, depth + 1);
    };
    addField(step.output, `nodes.${step.step_id}.output`);
  }
}

function appendStep(event: WorkflowTestEvent): void {
  const step = event.step as RecordValue;
  // A pause, start and completion represent the same invocation. Completed repeats remain separate.
  let replaced: WorkflowTestEvent | undefined;
  for (let index = steps.length - 1; index >= 0; index--) {
    const entry = steps[index], other = entry.step as RecordValue;
    if (entry.type !== 'step' && entry.round === event.round && other.step_id === step.step_id && pretty(other.workflow_path) === pretty(step.workflow_path)) {
      replaced = entry; steps[index] = event; break;
    }
  }
  if (!replaced) steps.push(event);
  if (steps.length > 300) steps.shift();
  const list = $('steps'); list.replaceChildren();
  $('steps-empty').hidden = true;
  steps.forEach((entry, index) => {
    const step = entry.step as RecordValue; const state = entry.type === 'paused' ? 'paused' : step.status;
    const entryButton = node('button', step.name || step.step_id, `step ${state === 'succeeded' ? 'passed' : state === 'failed' ? 'failed' : state}`);
    entryButton.appendChild(node('small', `第 ${entry.round || '当前'} 轮 · ${entry.type === 'paused' ? '已暂停' : stateLabel(step.status)}${step.duration_ms == null ? '' : ` · ${step.duration_ms} ms`}`));
    entryButton.dataset.index = String(index); entryButton.addEventListener('click', () => { following = false; $('follow-latest').hidden = false; showDetail(entry); }); list.appendChild(entryButton);
  });
  const container = ['root', 'sequence', 'select', 'parallel', 'condition'].includes(step.node_kind || step.node_type);
  if (event.type === 'paused' || (following && (!container || !selectedStep))) { showDetail(event); list.lastElementChild?.scrollIntoView?.({ block: 'nearest' }); }
  else showDetail(selectedStep === replaced ? event : selectedStep);
}

function eventReceived(event: WorkflowTestEvent): void {
  if (event.type === 'init') { guarded(() => initialize(event.init as WorkflowTestInit)); return; }
  if (event.type === 'started') {
    canPause = event.canPause !== false; setBusy(true);
    status(`测试已开始，共 ${event.total} 轮。${canPause ? '' : '并行流程可查看结果和停止；单步请分别测试分支。'}`);
    runBanner('执行中', '测试已开始', `共 ${event.total} 轮，步骤和画面会在下方更新。`, 'running');
  } else if (event.type === 'paused') {
    setBusy(true, true); appendStep(event); status(`已暂停在 ${(event.step as RecordValue).name || (event.step as RecordValue).step_id}，点击下一步或继续。`);
    runBanner('已暂停', (event.step as RecordValue).name || (event.step as RecordValue).step_id, '点击「下一步」执行当前节点，点击「继续」运行到下一个断点。', 'running');
  } else if (event.type === 'node_started') {
    appendStep(event);
    if (!paused) {
      const step = event.step as RecordValue;
      status(`第 ${event.round} 轮：正在执行 ${step.name || step.step_id}`);
      runBanner('执行中', step.name || step.step_id, `第 ${event.round} 轮 · ${step.breadcrumb || '正在执行，结果会自动更新'}`, 'running');
    }
  } else if (event.type === 'step') {
    appendStep(event);
  } else if (event.type === 'round') {
    renderMetrics(event.summary as RecordValue);
    const row = node('tr'); const failed = (event.checks as RecordValue[]).filter((check) => !check.passed);
    for (const text of [`${event.round}${event.image_source ? ` · ${String(event.image_source).split(/[\\/]/).pop()}` : ''}`, event.status === 'cancelled' ? '已停止' : event.passed ? '通过' : '未通过', `${event.duration_ms} ms`, event.error || event.failed_node || failed.map((check) => `${check.path}：实际 ${pretty(check.actual)}`).join('；') || '—']) row.appendChild(node('td', String(text)));
    row.children[1].className = event.passed ? 'passed' : 'failed';
    row.addEventListener('click', () => {
      for (const item of $('round-results').children) item.classList.toggle('active', item === row);
      following = false; $('follow-latest').hidden = false;
      showDetail({ type: 'round', round: event.round, step: {
        step_id: `round-${event.round}`, name: `第 ${event.round} 轮`, status: event.status,
        duration_ms: event.duration_ms, error: event.error, output: event.outputs,
      } });
      showView('output');
      for (const check of event.checks as RecordValue[]) $('assertion-results').appendChild(node('p', `${check.passed ? '✓' : '✗'} ${check.path} · 预期 ${pretty(check.value)} · 实际 ${pretty(check.actual)}${check.error ? ` · ${check.error}` : ''}`, check.passed ? 'passed' : 'failed'));
    });
    $('round-results').appendChild(row);
  } else if (event.type === 'error' || event.type === 'notice') {
    status(String(event.message), event.type === 'error');
    if (event.type === 'error') runBanner('测试出错', '无法完成测试', String(event.message), 'failed');
  } else if (event.type === 'finished') {
    setBusy(true); button('stop').disabled = true;
    button('pause').disabled = true;
    if (event.summary) renderMetrics(event.summary as RecordValue);
    const summary = event.summary as RecordValue | undefined;
    const failed = Boolean(event.error) || (summary?.success_rate != null && summary.success_rate < 100);
    if (labMode) { $('lab-feedback').classList.toggle('error', failed); $('lab-feedback').textContent = event.error ? String(event.error) : event.stopped ? '测试已停止，调整参数后可以再次测试。' : failed ? '测试未通过，请查看错误并调整参数。' : '测试完成，满意后点击「添加到画布」保留当前配置。'; }
    runBanner(event.stopped ? '已停止' : failed ? '未通过' : '已完成', event.stopped ? '测试已停止' : failed ? '测试有未通过的结果' : '测试完成', event.error ? String(event.error) : '点击步骤查看详情，修改参数后可以再次测试。', event.stopped ? '' : failed ? 'failed' : 'passed');
    if (failed) $<HTMLDetailsElement>('run-summary').open = true;
    button('report').disabled = !event.report;
    status(event.error ? `测试结束：${event.error}` : event.stopped ? '测试已停止，已完成的结果保留在报告中。' : '测试完成。点击步骤或轮次查看详情，调整参数后可再次测试。', Boolean(event.error));
  } else if (event.type === 'idle') { pending = false; setBusy(false); }
}

async function startTest(nodeId?: string): Promise<void> {
  if (busy || pending) return;
  if (!labMode) commitParameters();
  const request = readRequest();
  if (nodeId && !labMode) request.nodeIds = [nodeId];
  if (request.mode === 'offline' && !images.length) throw new Error('请先选择离线截图');
  if (request.mode === 'live' && !request.instanceId) throw new Error('请先选择运行实例');
  if (!Number.isInteger(request.rounds) || request.rounds < 1 || request.rounds > 100) throw new Error('重复次数必须为 1–100');
  if (nodeId && !labMode) { selected = new Set([nodeId]); renderNodes(); }
  pending = true; canPause = true; setBusy(true); steps = []; selectedStep = undefined; following = true; detailView = 'screen';
  if (labMode) { $('lab-feedback').classList.remove('error'); $('lab-feedback').textContent = '正在测试当前节点…'; }
  $('steps-empty').hidden = false; $('follow-latest').hidden = true; $<HTMLDetailsElement>('run-summary').open = false;
  $('failures').textContent = '';
  $('steps').replaceChildren(); $('round-results').replaceChildren(); showDetail(undefined); renderMetrics({ requested: request.rounds * (request.mode === 'offline' ? images.length : 1) }); button('report').disabled = true;
  status('正在准备测试…');
  runBanner('准备中', '正在准备测试', '连接测试环境，准备执行所选范围。', 'running');
  try { await api.workflowTestStart(request); pending = false; }
  catch (error) { pending = false; setBusy(false); runBanner('启动失败', '测试没有开始', error instanceof Error ? error.message : String(error), 'failed'); throw error; }
}
button('start').addEventListener('click', () => guarded(async () => {
  try { await startTest(); }
  catch (error) { if (labMode) { $('lab-feedback').textContent = error instanceof Error ? error.message : String(error); $('lab-feedback').classList.add('error'); } throw error; }
}));
button('test-node').addEventListener('click', () => guarded(() => startTest(editingNode)));
select('test-kind').addEventListener('change', testKindChanged);
input('action-search').addEventListener('input', renderActionOptions);
select('lab-action').addEventListener('change', () => guarded(() => { const action = select('lab-action').value; try { commitLabDraft(); selectLabAction(action); } catch (error) { select('lab-action').value = labDraft.action; throw error; } }));
select('lab-existing').addEventListener('change', () => guarded(() => {
  const item = (graph.nodes as RecordValue[]).find(item => item.id === select('lab-existing').value);
  if (item?.action) { input('action-search').value = ''; selectLabAction(item.action, { action: item.action, name: item.name || actionLabel(item.action), params: item.params || {} }); }
}));
button('lab-reset').addEventListener('click', () => { delete labDrafts[labDraft.action]; selectLabAction(labDraft.action); });
button('add-to-canvas').addEventListener('click', () => guarded(async () => {
  if (adding || busy || pending) return;
  try {
    const draft = validateTestNode(commitLabDraft(), catalog); adding = true; button('add-to-canvas').disabled = true;
    $('lab-feedback').classList.remove('error'); $('lab-feedback').textContent = '正在添加到画布…';
    const id = await api.workflowTestAddNode(draft);
    $('lab-feedback').textContent = `已添加「${draft.name || actionLabel(draft.action)}」到画布（${id}），可用 Ctrl+Z 撤销。`;
    status('节点已添加到目标画布，当前调好的参数已保留。');
  } catch (error) { $('lab-feedback').textContent = error instanceof Error ? error.message : String(error); $('lab-feedback').classList.add('error'); throw error; }
  finally { adding = false; button('add-to-canvas').disabled = busy || pending || !labDraft.action; }
}));
input('template-search').addEventListener('input', renderTemplates);
for (const id of ['close-template', 'cancel-template']) button(id).addEventListener('click', () => $<HTMLDialogElement>('template-dialog').close());
button('choose-template').addEventListener('click', () => {
  if (!selectedTemplate) return;
  chooseTemplate?.(selectedTemplate); $<HTMLDialogElement>('template-dialog').close();
});
button('import-template').addEventListener('click', () => guarded(async () => { const path = await api.workflowTestTemplate(); if (path) { chooseTemplate?.(path); $<HTMLDialogElement>('template-dialog').close(); } }));
for (const id of ['close-roi', 'cancel-roi']) button(id).addEventListener('click', closeRoiPicker);
button('confirm-roi').addEventListener('click', applyRoiSelection);
$<HTMLDialogElement>('roi-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeRoiPicker(); });

for (const command of ['pause', 'step', 'continue', 'stop'] as TestCommand[]) button(command).addEventListener('click', () => guarded(async () => {
  await api.workflowTestCommand(command);
  if (command === 'step' || command === 'continue') { setBusy(true, false); status('继续执行…'); }
  if (command === 'pause') { status('将在下一个节点执行前暂停。'); $('run-message').textContent = '已请求暂停，当前动作结束后会在下一个节点暂停。'; }
  if (command === 'stop') { button('stop').disabled = true; status('正在停止测试…'); runBanner('停止中', '正在停止测试', '等待当前动作结束，已产生的结果会保留。'); }
}));
for (const name of ['nodes', 'parameters', 'checks', 'cases']) button(`tab-${name}`).addEventListener('click', () => configTab(name));
for (const name of ['screen', 'output', 'params']) button(`view-${name}`).addEventListener('click', () => showView(name));
button('back-nodes').addEventListener('click', () => configTab('nodes'));
input('node-search').addEventListener('input', renderNodes);
button('follow-latest').addEventListener('click', () => { following = true; $('follow-latest').hidden = true; if (steps.length) showDetail(steps[steps.length - 1]); });
select('mode').addEventListener('change', modeChanged);
button('pick-images').addEventListener('click', () => guarded(async () => { const files = await api.workflowTestImages(); if (files.length) images = files; $('image-list').textContent = images.length ? `${images.length} 张：${images.map((file) => file.split(/[\\/]/).pop()).join('、')}` : '尚未选择截图'; }));
button('all-nodes').addEventListener('click', () => { selected.clear(); renderNodes(); });
button('selected-nodes').addEventListener('click', () => { selected = new Set(init.nodeIds.filter((id) => graph.nodes.some((item: RecordValue) => item.id === id))); renderNodes(); });
button('reset-params').addEventListener('click', () => { delete overrides[editingNode]; renderParameters(); });
button('add-check').addEventListener('click', () => { expectations.push({ path: 'status', operator: 'equals', value: 'succeeded' }); renderChecks(); });
button('report').addEventListener('click', () => guarded(() => api.workflowTestReport()));
function persistCases(): void { api.writeLayout(testProfileKey(init.uri), JSON.stringify({ schema: 1, uri: init.uri, cases })); }
button('save-case').addEventListener('click', () => guarded(() => {
  commitParameters();
  const name = input('case-name').value.trim(); if (!name) throw new Error('请填写用例名称');
  const { text: _text, uri: _uri, instanceId: _instance, images: _images, ...saved } = readRequest();
  cases[name] = structuredClone(saved); persistCases(); renderCases(); select('cases').value = name; status(`已保存用例“${name}”。`);
}));
button('load-case').addEventListener('click', () => guarded(() => { const name = select('cases').value; if (!cases[name]) throw new Error('请先选择已保存用例'); input('case-name').value = name; applyCase(cases[name]); }));
button('delete-case').addEventListener('click', () => guarded(() => { const name = select('cases').value; if (!cases[name]) return; delete cases[name]; persistCases(); renderCases(); status(`已删除用例“${name}”。`); }));
const imageDialog = $<HTMLDialogElement>('image-dialog');
for (const id of ['before-image', 'after-image']) $(id).addEventListener('click', () => { $<HTMLImageElement>('large-image').src = $<HTMLImageElement>(id).src; imageDialog.showModal(); });
button('close-image').addEventListener('click', () => imageDialog.close());
api.onWorkflowTestEvent(eventReceived);

const icons = { Copy, FolderOpen, Minus, Pause, Play, Plus, Square, StepForward, X };
function updateMaximized(maximized: boolean): void {
  const control = button('test-maximize');
  control.title = maximized ? '还原' : '最大化';
  control.setAttribute('aria-label', control.title);
  control.innerHTML = `<i data-lucide="${maximized ? 'copy' : 'square'}"></i>`;
  createIcons({ icons, root: control });
}
createIcons({ icons });
button('test-minimize').addEventListener('click', () => guarded(() => api.minimizeWindow()));
button('test-maximize').addEventListener('click', () => guarded(async () => updateMaximized(await api.toggleMaximizeWindow())));
button('test-close').addEventListener('click', () => guarded(() => api.closeWindow()));
const unsubscribeMaximized = api.onWindowMaximized(updateMaximized);
guarded(async () => updateMaximized(await api.isWindowMaximized()));
const layoutCleanup = [
  installTestResizer($('config-resizer'), document.querySelector<HTMLElement>('.test-workspace')!, '--test-config-width', 410, 340, 600),
  installTestResizer($('steps-resizer'), $('test-inspection'), '--test-steps-width', 230, 170, 340),
];
window.addEventListener('pagehide', () => { unsubscribeMaximized(); for (const cleanup of layoutCleanup) cleanup(); }, { once: true });
guarded(async () => initialize(await api.workflowTestInit()));
