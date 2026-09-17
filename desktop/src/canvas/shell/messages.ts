/**
 * 画布消息桥：桌面壳层 → 画布的全部消息处理（初始化、运行事件、ROI/模板、素材、保存状态）。
 * 原 `workflow-editor.js` 的 window.message 处理体。
 *
 * 只更新状态并调用已迁移的渲染/命令模块；注册监听由入口负责。
 */
import type { CanvasState } from '../state/canvas-state';

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
  renderInspector(): void;
  renderAssetBrowser(...args: any[]): any;
  closeAssetBrowser(...args: any[]): any;
  renderTemplateCheck(...args: any[]): any;
  restoreAssetBrowserAfterRoi(...args: any[]): any;
  openRoiPicker(message: any): void;
  requestAssetInventory(): void;
  normalizedAssetPath(value: any): string;
  handleRunEvent(event: any): void;
  setExportBusy(busy: boolean): void;
  replaceDocument(text: string, recordHistory: boolean): void;
  executeEditorCommand(command: string, value?: any): any;
  toast(message: string, isError?: boolean): void;
}

export function createCanvasMessages(deps: CanvasMessagesDeps) {
  const {
    state, $, mutate, nodeById, normalizeRaw, clearVariableCardSelection, setDirty, render, fitView, ensureLayout,
    renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, renderInspector, renderAssetBrowser,
    closeAssetBrowser, renderTemplateCheck, restoreAssetBrowserAfterRoi, openRoiPicker, requestAssetInventory,
    normalizedAssetPath, handleRunEvent, setExportBusy, replaceDocument, executeEditorCommand, toast,
  } = deps;
  function handleMessage(message: any): void {

  if (message.type === 'init') {
    let raw = null;
    try { raw = JSON.parse(message.document.text); } catch { raw = null; }
    // 同一文档的重复初始化（如保存后的外部变更同步）保留当前视口；
    // 只有切换/重新打开其他工作流时才重新适配。
    const sameDocument = Boolean(message.document && message.document.uri && message.document.uri === state.docUri);
    if (!sameDocument) { state.variableSnapshots = {}; state.variableValues = null; }
    state.raw = normalizeRaw(raw); state.catalog = Array.isArray(message.catalog) ? message.catalog : [];
    state.assetsBaseUri = typeof message.assetsBaseUri === 'string' ? message.assetsBaseUri.replace(/\/?$/, '/') : '';
    state.refs = message.refs || { inputs: [], variables: [], nodes: [] }; state.issues = message.issues || [];
    state.workflows = Array.isArray(message.workflows) ? message.workflows.filter((item: any) => item && typeof item.uri === 'string') : [];
    state.docUri = message.document.uri || '';
    state.documentName = message.document.name || '';
    state.workflowTrail = Array.isArray(message.workflowTrail) ? message.workflowTrail : [];
    state.instances = Array.isArray(message.instances) ? message.instances.filter((item: any) => item && typeof item.id === 'string' && item.id) : [];
    state.instanceId = typeof message.selectedInstance === 'string' ? message.selectedInstance : '';
    state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; state.selectedVariable = ''; clearVariableCardSelection(); state.undo = []; state.redo = []; state.run.clear(); state.paramLiteralCache = {}; state.inspector = 'node'; state.nodeSearch = { query: '', ids: [], index: -1 };
    $('btn-back').classList.toggle('hidden', !message.canGoBack);
    renderWorkflowPicker(); renderWorkflowBreadcrumb(); renderInstancePicker(); ensureLayout(); setDirty(false); render();
    requestAssetInventory();
    setTimeout(() => { if (!sameDocument) fitView(); }, 0);
  } else if (message.type === 'runEvent') handleRunEvent(message.event);
  else if (message.type === 'runtimeInstances') {
    state.instances = Array.isArray(message.instances) ? message.instances.filter((item: any) => item && typeof item.id === 'string' && item.id) : [];
    state.instanceId = typeof message.selectedInstance === 'string' ? message.selectedInstance : state.instanceId;
    state.variableValues = state.variableSnapshots?.[state.instanceId || 'default'] || null;
    renderInstancePicker();
  }
  else if (message.type === 'runReplay') { state.run.clear(); (message.events || []).forEach(handleRunEvent); }
  else if (message.type === 'roiPickerImage') openRoiPicker(message);
  else if (message.type === 'roiPickerCancelled' || message.type === 'roiPickerError') {
    const request = state.roi;
    const overlay = $('roi-picker'); if (overlay) overlay.classList.add('hidden');
    state.roi = null;
    if (request && request.returnToAssetBrowser) restoreAssetBrowserAfterRoi();
    if (message.message) toast(message.message, true);
  }
  else if (message.type === 'roiPickerResult' && state.roi && state.roi.requestId === message.requestId) {
    const request = state.roi;
    const roi = Array.isArray(message.roi) ? message.roi.map(Number) : [];
    if (roi.length !== 4 || roi.some((item: any) => !Number.isFinite(item))) return;
    const node = nodeById(request.nodeId);
    if (typeof request.applyValue === 'function') mutate(() => request.applyValue(roi));
    else if (node) mutate(() => { node.params[request.key] = roi; });
    state.roi = null;
    const overlay = $('roi-picker'); if (overlay) overlay.classList.add('hidden');
    toast('区域已更新');
  }
  else if (message.type === 'templateSaved' && state.roi && state.roi.requestId === message.requestId) {
    const request = state.roi;
    const browser = request.returnToAssetBrowser ? state.assetBrowser : null;
    if (typeof message.path === 'string') {
    if (!state.assetPaths) state.assetPaths = new Set();
    state.assetPaths.add(normalizedAssetPath(message.path));
    }
    if (typeof request.applyValue === 'function') mutate(() => request.applyValue(message.path));
    else if (browser && typeof browser.applyValue === 'function') mutate(() => browser.applyValue(message.path));
    else {
    const node = nodeById(message.nodeId); if (node) mutate(() => { node.params[message.key] = message.path; });
    }
    state.roi = null;
    if (request.returnToAssetBrowser && state.assetBrowser) {
    state.assetBrowser.selectedPath = message.path;
    state.assetBrowser.cacheBust = Date.now();
    restoreAssetBrowserAfterRoi();
    }
    toast(request.targetPath ? '模板已重新截取' : '模板已保存');
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