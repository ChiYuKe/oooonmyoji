/**
 * 画布消息桥：桌面壳层 → 画布的全部消息处理（初始化、运行事件、ROI/模板、素材、保存状态）。
 * 原 `workflow-editor.js` 的 window.message 处理体。
 *
 * 只更新状态并调用已迁移的渲染/命令模块；注册监听由入口负责。
 */
import type { CanvasState } from '../state/canvas-state';
import { parseCanvasClipboard } from '../../shared/editor-messages';

export interface CanvasMessagesDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  $(id: string): HTMLElement;
  mutate(fn: () => void): void;
  nodeById(id: string): any;
  normalizeRaw(raw: any): any;
  clearVariableCardSelection(): void;
  setDirty(value?: boolean): void;
  render(): void;
  fitView(): void;
  ensureLayout(): void;
  renderInstancePicker(...args: any[]): any;
  renderWorkflowPicker(...args: any[]): any;
  renderWorkflowBreadcrumb(...args: any[]): any;
  renderWorkflowBrowser?(...args: any[]): any;
  resolveWorkflowRef?(value: any): string;
  renderInspector(): void;
  renderAssetBrowser(...args: any[]): any;
  closeAssetBrowser(...args: any[]): any;
  renderTemplateCheck(...args: any[]): any;
  restoreAssetBrowserAfterRoi(...args: any[]): any;
  openRoiPicker(message: any): void;
  requestAssetInventory(): void;
  normalizedAssetPath(value: any): string;
  handleRunEvent(event: any): void;
  patchRunEdgeStates?(nodeId?: string): number;
  setExportBusy(busy: boolean): void;
  replaceDocument(text: string, recordHistory: boolean): void;
  executeEditorCommand(command: string, value?: any): any;
  toast(message: string, isError?: boolean): void;
}

export function createCanvasMessages(deps: CanvasMessagesDeps) {
  const {
    state, $, mutate, nodeById, normalizeRaw, clearVariableCardSelection, setDirty, render, fitView, ensureLayout,
    renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, renderInspector, renderAssetBrowser,
    renderWorkflowBrowser,
    closeAssetBrowser, renderTemplateCheck, restoreAssetBrowserAfterRoi, openRoiPicker, requestAssetInventory,
    normalizedAssetPath, handleRunEvent, patchRunEdgeStates, setExportBusy, replaceDocument, executeEditorCommand, toast,
  } = deps;
  const resolveWorkflowRef = deps.resolveWorkflowRef || ((value: any) => typeof value === 'string' ? value.trim() : '');

  function workflowDescriptor(reference: string, workflows: any[]): any {
    const normalized = String(reference || '').trim().replace(/\\/g, '/').replace(/^workflows\//i, '');
    if (!normalized) return null;
    const withExtension = normalized.toLowerCase().endsWith('.json') ? normalized : `${normalized}.json`;
    return workflows.find((item: any) => {
      const relative = String(item?.rel || '').replace(/\\/g, '/').replace(/^workflows\//i, '');
      return item?.id === normalized || relative === normalized || relative === withExtension
        || relative.endsWith(`/${normalized}`) || relative.endsWith(`/${withExtension}`);
    }) || null;
  }

  function workflowInputNames(descriptor: any): Set<string> {
    return new Set((Array.isArray(descriptor?.inputs) ? descriptor.inputs : [])
      .map((item: any) => typeof item?.name === 'string' ? item.name : '')
      .filter(Boolean));
  }

  /** 清掉子工作流已经取消公开、但父节点里仍残留的传参与连线。 */
  function pruneRemovedWorkflowInputs(previous: any[], next: any[], onlyLinked = false): boolean {
    const removals: Array<{ node: any; names: string[] }> = [];
    for (const node of state.raw?.nodes || []) {
      if (node?.type !== 'task' || node.action !== 'workflow.run' || !node.params?.inputs || typeof node.params.inputs !== 'object') continue;
      const reference = resolveWorkflowRef(node.params.workflow);
      const before = workflowDescriptor(reference, previous);
      const after = before
        ? next.find((item: any) => item?.uri === before.uri)
        : workflowDescriptor(reference, next);
      if (!after) continue;
      const afterNames = workflowInputNames(after);
      const beforeNames = before ? workflowInputNames(before) : null;
      const names = Object.keys(node.params.inputs).filter((name) => {
        if (afterNames.has(name)) return false;
        const link = state.raw?._variableLinks?.[`${node.id}:inputs.${name}`];
        if (onlyLinked) return Boolean(link);
        return Boolean(beforeNames?.has(name));
      });
      if (names.length) removals.push({ node, names });
    }
    if (!removals.length) return false;
    for (const { node, names } of removals) {
      for (const name of names) {
        delete node.params.inputs[name];
        if (state.raw._variableLinks) delete state.raw._variableLinks[`${node.id}:inputs.${name}`];
      }
    }
    return true;
  }
  function handleMessage(message: any): void {

  if (message.type === 'init') {
    let raw = null;
    try { raw = JSON.parse(message.document.text); } catch { raw = null; }
    // 同一文档的重复初始化（如保存后的外部变更同步）保留当前视口；
    // 只有切换/重新打开其他工作流时才重新适配。
    const sameDocument = Boolean(message.document && message.document.uri && message.document.uri === state.docUri);
    if (!sameDocument) { state.variableSnapshots = {}; state.variableValues = null; state.nodeGroupId = ''; }
    state.raw = normalizeRaw(raw); state.catalog = Array.isArray(message.catalog) ? message.catalog : [];
    state.assetsBaseUri = typeof message.assetsBaseUri === 'string' ? message.assetsBaseUri.replace(/\/?$/, '/') : '';
    state.refs = message.refs || { inputs: [], variables: [], nodes: [] }; state.issues = message.issues || [];
    state.docVersion = (state.docVersion || 0) + 1;
    state.workflows = Array.isArray(message.workflows) ? message.workflows.filter((item: any) => item && typeof item.uri === 'string') : [];
    // 兼容已经保存过的旧残留：有画布连线记录、但子工作流已不再声明的输入可以安全收敛。
    const prunedWorkflowInputs = pruneRemovedWorkflowInputs([], state.workflows, true);
    state.docUri = message.document.uri || '';
    state.documentName = message.document.name || '';
    state.workflowTrail = Array.isArray(message.workflowTrail) ? message.workflowTrail : [];
    state.instances = Array.isArray(message.instances) ? message.instances.filter((item: any) => item && typeof item.id === 'string' && item.id) : [];
    state.instanceId = typeof message.selectedInstance === 'string' ? message.selectedInstance : '';
    state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; state.selectedVariable = ''; clearVariableCardSelection(); state.undo = []; state.redo = []; state.run.clear(); state.paramLiteralCache = {}; state.inspector = 'node'; state.nodeSearch = { query: '', ids: [], index: -1 };
    $('btn-back').classList.toggle('hidden', !message.canGoBack);
    renderWorkflowPicker(); renderWorkflowBreadcrumb(); renderInstancePicker(); ensureLayout(); setDirty(prunedWorkflowInputs); render();
    requestAssetInventory();
    setTimeout(() => { if (!sameDocument) fitView(); }, 0);
  } else if (message.type === 'workflows') {
    // 脚本目录在别处变了（新建工作流、外部改动）：就地换掉列表并刷新选择器，不重载文档。
    const previousWorkflows = state.workflows;
    const nextWorkflows = Array.isArray(message.workflows) ? message.workflows.filter((item: any) => item && typeof item.uri === 'string') : state.workflows;
    state.workflows = nextWorkflows;
    const prunedWorkflowInputs = pruneRemovedWorkflowInputs(previousWorkflows, nextWorkflows);
    renderWorkflowPicker();
    if (state.workflowBrowser) renderWorkflowBrowser?.();
    // 子工作流的公开输入可能刚在另一个画布中增删；节点卡片与详情栏必须立即重算。
    if (prunedWorkflowInputs) setDirty(true);
    render();
  } else if (message.type === 'workflowTrail') {
    state.workflowTrail = Array.isArray(message.workflowTrail) ? message.workflowTrail : [];
    $('btn-back').classList.toggle('hidden', !message.canGoBack);
    renderWorkflowBreadcrumb();
  } else if (message.type === 'clipboard') {
    // 画布剪贴板由壳层保管：复制后广播，新画布握手时补发；跨画布粘贴靠它。
    state.clipboard = parseCanvasClipboard(message.clipboard) ?? null;
  } else if (message.type === 'runEvent') handleRunEvent(message.event);
  else if (message.type === 'runtimeInstances') {
    state.instances = Array.isArray(message.instances) ? message.instances.filter((item: any) => item && typeof item.id === 'string' && item.id) : [];
    state.instanceId = typeof message.selectedInstance === 'string' ? message.selectedInstance : state.instanceId;
    state.variableValues = state.variableSnapshots?.[state.instanceId || 'default'] || null;
    renderInstancePicker();
  }
  else if (message.type === 'runReplay') {
    state.run.clear();
    patchRunEdgeStates?.();
    (message.events || []).forEach(handleRunEvent);
  }
  else if (message.type === 'roiPickerImage') openRoiPicker(message);
  else if (message.type === 'roiPickerCancelled' || message.type === 'roiPickerError') {
    const request = state.roi;
    const overlay = $('roi-picker'); if (overlay) overlay.classList.add('hidden');
    state.roi = null;
    if (request && request.returnToAssetBrowser) restoreAssetBrowserAfterRoi();
    if (message.message) toast(message.message, true);
  }
  else if (message.type === 'roiPickerResult' && (state.roi && state.roi.requestId === message.requestId || message.nodeId)) {
    // 请求可能来自**另一个**画布：详情栏是镜像，框选是在那里点的，
    // 但值必须落到真正持有文档的那份画布上（镜像没有写权）。
    // 所以这里按消息里的 nodeId/key 落值，本地 state.roi 只用来收浮层。
    const request = state.roi && state.roi.requestId === message.requestId ? state.roi : null;
    const roi = Array.isArray(message.roi) ? message.roi.map(Number) : [];
    if (roi.length !== 4 || roi.some((item: any) => !Number.isFinite(item))) return;
    const nodeId = request ? request.nodeId : message.nodeId;
    const key = request ? request.key : message.key;
    const node = nodeById(nodeId);
    if (typeof request?.applyValue === 'function') mutate(() => request.applyValue(roi));
    else if (!node || typeof key !== 'string' || !key) return;
    else mutate(() => { node.params[key] = roi; });
    if (request) {
      state.roi = null;
      const overlay = $('roi-picker'); if (overlay) overlay.classList.add('hidden');
    }
    toast('区域已更新');
  }
  else if (message.type === 'templateSaved' && (state.roi && state.roi.requestId === message.requestId || message.nodeId)) {
    const request = state.roi && state.roi.requestId === message.requestId ? state.roi : null;
    const browser = request && request.returnToAssetBrowser ? state.assetBrowser : null;
    if (typeof message.path === 'string') {
    if (!state.assetPaths) state.assetPaths = new Set();
    state.assetPaths.add(normalizedAssetPath(message.path));
    }
    if (typeof request?.applyValue === 'function') mutate(() => request.applyValue(message.path));
    else if (browser && typeof browser.applyValue === 'function') mutate(() => browser.applyValue(message.path));
    else {
    // 没有本地请求（值来自别的画布，例如详情栏镜像里点的「截取」）时，
    // 按消息里的 nodeId/key 落到这篇文档上。
    const nodeId = request ? request.nodeId : message.nodeId;
    const key = request ? request.key : message.key;
    const node = nodeById(nodeId);
    if (typeof key === 'string' && key) mutate(() => { if (node) node.params[key] = message.path; });
    }
    if (request) {
    state.roi = null;
    if (request.returnToAssetBrowser && state.assetBrowser) {
    state.assetBrowser.selectedPath = message.path;
    state.assetBrowser.cacheBust = Date.now();
    restoreAssetBrowserAfterRoi();
    }
    }
    toast(request && request.targetPath ? '模板已重新截取' : '模板已保存');
  }
  else if (message.type === 'assetImages' && state.assetInventoryRequestId === message.requestId) {
    state.assetInventoryRequestId = '';
    state.assetPaths = new Set((Array.isArray(message.images) ? message.images : [])
    .map((item: any) => normalizedAssetPath(item && item.path))
    .filter(Boolean));
    renderInspector();
  }
  else if (message.type === 'assetImages' && state.assetBrowser && state.assetBrowser.requestId === message.requestId) {
    state.assetBrowser.images = Array.isArray(message.images) ? message.images.filter((item: any) => item && typeof item.path === 'string' && typeof item.uri === 'string') : [];
    renderAssetBrowser();
  }
  else if (message.type === 'assetImagesError' && state.assetBrowser && state.assetBrowser.requestId === message.requestId) { closeAssetBrowser(); toast(message.message || '读取 assets 图片失败', true); }
  else if (message.type === 'templateCheckResult' && state.templateCheck && state.templateCheck.requestId === message.requestId) {
    const matches = Array.isArray(message.matches) ? message.matches.filter((item: any) => item && [item.x, item.y, item.width, item.height, item.confidence].every(Number.isFinite)) : [];
    state.templateCheck.status = 'success';
    state.templateCheck.result = { dataUrl: message.dataUrl, width: message.width, height: message.height, roi: message.roi, matches };
    renderTemplateCheck();
  }
  else if (message.type === 'templateCheckError' && state.templateCheck && state.templateCheck.requestId === message.requestId) { state.templateCheck.status = 'error'; state.templateCheck.error = message.message || '模板检查失败'; renderTemplateCheck(); }
  else if (message.type === 'canvasImageSaved') { setExportBusy(false); toast('完整画布图片已保存'); }
  else if (message.type === 'canvasImageCancelled') { setExportBusy(false); }
  else if (message.type === 'canvasImageError') { setExportBusy(false); toast(message.message || '保存完整画布图片失败', true); }
  else if (message.type === 'instanceSelected') { state.instanceId = String(message.instanceId || ''); state.variableValues = state.variableSnapshots?.[state.instanceId || 'default'] || null; render(); }
  else if (message.type === 'workflowSaved') setDirty(false);
  else if (message.type === 'workflowSaveFailed') setDirty(true);
  else if (message.type === 'externalChange') { const banner = $('external-banner'); banner.textContent = '文件已在外部修改'; banner.classList.remove('hidden'); }
  else if (message.type === 'replaceDocument') replaceDocument(String(message.text || ''), message.recordHistory === true);
  else if (message.type === 'editorCommand') executeEditorCommand(String(message.command || ''), message.value);
  }
  return { handleMessage };
}
