/**
 * 编辑器宿主：校验画布 iframe 消息并按文档路由。
 *
 * 消息在边界用 parseEditorMessage 收窄为联合类型；异步写盘与导航统一使用消息来源文档
 * （无法定位来源时回退到活动文档），避免等待期间切换文档导致结果写入错误标签。
 */
import type { OnmyojiDesktopApi, WorkflowDescriptor } from '../shared/contracts';
import type { EditorMessage } from '../shared/editor-messages';
import type { WorkflowDocumentTab } from '../shared/workspace/session';
import type { RoiPicker } from './roi-picker';
import type { Sidebar } from './panels/sidebar';
import type { InspectorSelection, Workspace } from './workspace';

export interface EditorHostDeps {
  api: OnmyojiDesktopApi;
  workspace: Workspace;
  detailsFrame: HTMLIFrameElement;
  sidebar: Sidebar;
  roiPicker: RoiPicker;
  showToast: (message: string, error?: boolean) => void;
  errorMessage: (error: unknown) => string;
  setStatus: (message: string) => void;
  showDetailsPanel: () => void;
  showRuntimePanel: () => void;
  openContentBrowserSearch: () => void;
  openReferences: (uri: string) => void;
  getSelectedInstance: () => string;
  createNewWorkflow: () => Promise<void>;
  switchWorkflow: (uri: string, resetStack?: boolean) => Promise<void>;
  ensureDocument: (uri: string) => WorkflowDocumentTab;
  openWorkflowTab: (uri: string) => Promise<void>;
  loadWorkflow: (uri: string) => Promise<void>;
  loadDocumentOnce: (uri: string) => Promise<void>;
  sendDocumentInit: (uri: string) => void;
  resolveWorkflow: (reference: string) => WorkflowDescriptor | undefined;
  selectInstance: (instanceId: string, notify?: boolean) => void;
}

export interface EditorHost {
  handleMessage(message: EditorMessage, sourceFrame: HTMLIFrameElement): Promise<void>;
}

export function createEditorHost(deps: EditorHostDeps): EditorHost {
  const {
    api, workspace, detailsFrame, sidebar, roiPicker, showToast, errorMessage, setStatus,
    showDetailsPanel, showRuntimePanel, openContentBrowserSearch, openReferences,
    getSelectedInstance, createNewWorkflow, switchWorkflow, ensureDocument, openWorkflowTab,
    loadWorkflow, loadDocumentOnce, sendDocumentInit, resolveWorkflow, selectInstance,
  } = deps;

  async function handleMessage(message: EditorMessage, sourceFrame: HTMLIFrameElement): Promise<void> {
    const raw = message as unknown as Record<string, unknown>;
    const sourceUri = workspace.frameUriForFrame(sourceFrame);
    const runtime = sourceUri ? workspace.getDocumentRuntimes().get(sourceUri) : undefined;
    const isActiveSource = Boolean(sourceUri && sourceUri === workspace.activeUri());
    // 消息来源文档：await 期间活动文档可能被切换，写盘与导航都以它为准。
    const targetUri = sourceUri ?? workspace.activeUri();
    try {
      switch (message.type) {
        case 'ready': {
          if (sourceFrame === detailsFrame) {
            const activeInit = workspace.activeRuntime()?.init;
            if (activeInit) workspace.postToFrame(detailsFrame, activeInit as unknown as Record<string, unknown>);
            return;
          }
          if (!runtime || !sourceUri) return;
          runtime.ready = true;
          if (runtime.init) {
            sendDocumentInit(sourceUri);
            return;
          }
          if (sourceUri === workspace.activeUri() || (!workspace.activeUri() && sourceUri === workspace.restoreUri())) await loadDocumentOnce(sourceUri);
          return;
        }
        case 'createVariableNode': {
          if (message.scope !== 'inputs' && message.scope !== 'variables') return;
          workspace.postToFrame(sourceFrame, { type: 'editorCommand', command: 'addVariableCard', value: { name: String(message.name ?? ''), scope: message.scope } });
          return;
        }
        case 'documentStateChanged': {
          const text = String(message.text ?? '');
          if (!text) return;
          workspace.setDocumentText(targetUri, text);
          if (runtime?.init) runtime.init.document.text = text;
          if (isActiveSource || !sourceUri) {
            workspace.setDirty(message.dirty !== false);
            workspace.scheduleAutoSave(text);
            workspace.postToFrame(detailsFrame, { type: 'replaceDocument', text, recordHistory: true });
          } else {
            workspace.setDocumentDirty(targetUri, message.dirty !== false);
          }
          return;
        }
        case 'inspectorRequested': {
          if (!isActiveSource && sourceUri) return;
          const selection = message.inspectorSelection as InspectorSelection;
          if (runtime) runtime.inspectorSelection = selection;
          showDetailsPanel();
          workspace.postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
          return;
        }
        case 'sidebarStateChanged': {
          if (!runtime || (!isActiveSource && sourceUri)) return;
          sidebar.updateFromMessage(message);
          const selection = message.inspectorSelection as InspectorSelection | undefined;
          if (selection) runtime.inspectorSelection = selection;
          if (selection && selection.kind !== 'none') {
            showDetailsPanel();
            workspace.postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
          } else if (selection?.kind === 'none') {
            workspace.postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
          }
          return;
        }
        case 'save': {
          const text = String(message.text ?? workspace.tab(targetUri)?.text ?? '');
          workspace.cancelAutoSave();
          await workspace.waitForAutoSave();
          await api.saveWorkflow(targetUri, text);
          workspace.setDocumentText(targetUri, text);
          workspace.setDocumentDirty(targetUri, false);
          if (runtime?.init) runtime.init.document.text = text;
          workspace.postToEditors({ type: 'workflowSaved' });
          setStatus('工作流已保存');
          showToast('工作流已保存');
          return;
        }
        case 'switchWorkflow': {
          if (typeof message.saveText === 'string') {
            await api.saveWorkflow(targetUri, message.saveText);
            workspace.setDocumentText(targetUri, message.saveText);
          }
          await switchWorkflow(String(message.uri ?? ''));
          return;
        }
        case 'openSubWorkflow': {
          workspace.cancelAutoSave();
          await workspace.waitForAutoSave();
          if (typeof message.saveText === 'string') {
            await api.saveWorkflow(targetUri, message.saveText);
            workspace.setDocumentText(targetUri, message.saveText);
          }
          const reference = String(message.reference ?? '').trim();
          let resolved = reference ? resolveWorkflow(reference) : undefined;
          if (!resolved && typeof message.nodeId === 'string') {
            const source = JSON.parse(workspace.tab(targetUri)?.text ?? workspace.activeText()) as { nodes?: Array<{ id?: string; action?: string; params?: { workflow?: string } }> };
            const node = source.nodes?.find((item) => item.id === message.nodeId && item.action === 'workflow.run');
            if (node?.params?.workflow) resolved = resolveWorkflow(node.params.workflow);
          }
          if (!resolved) throw new Error(`未找到子工作流：${reference || message.nodeId || ''}`);
          const parent = workspace.tab(targetUri);
          const target = ensureDocument(resolved.uri);
          workspace.setDocumentBackStack(target.uri, [...(parent?.backStack ?? []), targetUri]);
          await openWorkflowTab(resolved.uri);
          return;
        }
        case 'goBackWorkflow': {
          workspace.cancelAutoSave();
          await workspace.waitForAutoSave();
          if (typeof message.saveText === 'string') {
            await api.saveWorkflow(targetUri, message.saveText);
            workspace.setDocumentText(targetUri, message.saveText);
          }
          const previous = workspace.popDocumentBackStack(targetUri);
          if (previous) await openWorkflowTab(previous);
          return;
        }
        case 'navigateWorkflowTrail': {
          const index = Number(message.index);
          const trail = [...(workspace.tab(targetUri)?.backStack ?? []), targetUri];
          if (!Number.isInteger(index) || index < 0 || index >= trail.length - 1) return;
          workspace.cancelAutoSave();
          await workspace.waitForAutoSave();
          if (typeof message.saveText === 'string') {
            await api.saveWorkflow(targetUri, message.saveText);
            workspace.setDocumentText(targetUri, message.saveText);
          }
          const target = ensureDocument(trail[index]);
          workspace.setDocumentBackStack(target.uri, trail.slice(0, index));
          await openWorkflowTab(trail[index]);
          return;
        }
        case 'reloadRequest': {
          if (targetUri) await loadWorkflow(targetUri);
          return;
        }
        case 'runWorkflow': {
          const text = String(message.text ?? workspace.tab(targetUri)?.text ?? '');
          workspace.setDocumentText(targetUri, text);
          await api.runWorkflow({ uri: targetUri, instanceId: String(message.instanceId ?? getSelectedInstance()), text });
          showRuntimePanel();
          return;
        }
        case 'stopWorkflow': {
          await api.stopWorkflow();
          return;
        }
        case 'selectInstance': {
          selectInstance(String(message.instanceId ?? getSelectedInstance()), false);
          workspace.postToAllEditors({ type: 'instanceSelected', instanceId: getSelectedInstance() });
          return;
        }
        case 'pickRoi': {
          const referenceResolution: [number, number] = Array.isArray(message.referenceResolution)
            ? message.referenceResolution as [number, number]
            : [1920, 1080];
          const result = await api.captureRoi({ instanceId: String(message.instanceId ?? getSelectedInstance()), referenceResolution });
          roiPicker.open({
            requestId: String(message.requestId ?? ''),
            nodeId: String(message.nodeId ?? message.stepId ?? ''),
            key: String(message.key ?? ''),
            mode: message.mode === 'rect' ? 'rect' : 'asset',
            targetPath: typeof message.targetPath === 'string' ? message.targetPath : undefined,
            sourceFrame,
            referenceResolution,
            imageWidth: result.width,
            imageHeight: result.height,
            dataUrl: result.dataUrl,
          });
          return;
        }
        case 'checkTemplate': {
          const result = await api.checkTemplate({
            template: String(message.template ?? ''),
            roi: Array.isArray(message.roi) ? message.roi as [number, number, number, number] : undefined,
            threshold: Number(message.threshold ?? .85),
            maxResults: Number(message.maxResults ?? 20),
            scaleSearch: Boolean(message.scaleSearch),
            referenceResolution: Array.isArray(message.referenceResolution) ? message.referenceResolution as [number, number] : [1920, 1080],
            instanceId: String(message.instanceId ?? getSelectedInstance()),
          });
          workspace.postToFrame(sourceFrame, { type: 'templateCheckResult', requestId: message.requestId, ...result });
          return;
        }
        case 'listAssetImages': {
          workspace.postToFrame(sourceFrame, { type: 'assetImages', requestId: message.requestId, images: await api.listAssets() });
          return;
        }
        case 'requestAssetData': {
          const paths = Array.isArray(message.paths) ? message.paths.map(String) : [];
          workspace.postToFrame(sourceFrame, { type: 'assetData', requestId: message.requestId, items: await api.readAssetData(paths) });
          return;
        }
        case 'saveTemplate': {
          const savedPath = await api.saveTemplate({
            targetPath: typeof message.targetPath === 'string' ? message.targetPath : undefined,
            filename: String(message.filename ?? 'template.png'),
            dataUrl: String(message.dataUrl ?? ''),
          });
          workspace.postToFrame(sourceFrame, { type: 'templateSaved', requestId: message.requestId, nodeId: message.nodeId ?? message.stepId, key: message.key, path: savedPath });
          return;
        }
        case 'saveCanvasImage': {
          const savedPath = await api.saveCanvas({ filename: String(message.filename ?? 'workflow-layout.png'), dataUrl: String(message.dataUrl ?? '') });
          workspace.postToFrame(sourceFrame, savedPath ? { type: 'canvasImageSaved', path: savedPath } : { type: 'canvasImageCancelled' });
          return;
        }
        case 'newWorkflow': {
          await createNewWorkflow();
          return;
        }
        case 'openFile': {
          await api.openWorkflowFile(targetUri);
          return;
        }
        case 'openWorkflowPicker': {
          openContentBrowserSearch();
          return;
        }
        case 'openWorkflowTree': {
          showToast('结构树已显示在左侧');
          return;
        }
        case 'openReferences': {
          openReferences(targetUri);
          return;
        }
        case 'error': {
          throw new Error(String(message.message ?? '编辑器错误'));
        }
      }
    } catch (error) {
      const text = errorMessage(error);
      if (message.type === 'save') workspace.postToEditors({ type: 'workflowSaveFailed' });
      if (message.type === 'pickRoi' || message.type === 'saveTemplate') workspace.postToFrame(sourceFrame, { type: 'roiPickerError', requestId: raw.requestId, message: text });
      else if (message.type === 'checkTemplate') workspace.postToFrame(sourceFrame, { type: 'templateCheckError', requestId: raw.requestId, message: text });
      else if (message.type === 'listAssetImages') workspace.postToFrame(sourceFrame, { type: 'assetImagesError', requestId: raw.requestId, message: text });
      else if (message.type === 'requestAssetData') workspace.postToFrame(sourceFrame, { type: 'assetDataError', requestId: raw.requestId, message: text });
      else if (message.type === 'saveCanvasImage') workspace.postToFrame(sourceFrame, { type: 'canvasImageError', message: text });
      showToast(text, true);
      setStatus('操作失败');
    }
  }

  return { handleMessage };
}
