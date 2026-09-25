/**
 * 编辑器宿主：校验画布 iframe 消息并按文档路由。
 *
 * 消息在边界用 parseEditorMessage 收窄为联合类型；异步写盘与导航统一使用消息来源文档
 * （无法定位来源时回退到活动文档），避免等待期间切换文档导致结果写入错误标签。
 */
import type { OnmyojiDesktopApi, WorkflowDescriptor } from '../shared/contracts';
import type { EditorMessage } from '../shared/editor-messages';
import { parseCanvasClipboard } from '../shared/editor-messages';
import { parseDocument } from '../shared/workflow/graph-dsl';
import type { WorkflowDocumentTab } from '../shared/workspace/session';
import type { RoiPicker } from './roi-picker';
import type { Sidebar } from './panels/sidebar';
import type { VariableReferencesData, VariableReferencesSource } from './variable-references';
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
  /** 打开「变量引用」面板，列出谁在引用某个变量。 */
  showVariableReferences?: (data: VariableReferencesData, source: VariableReferencesSource) => void;
  /** 影响范围确认弹窗：改名等操作先亮出影响清单，返回 true 表示确认继续。 */
  showImpactConfirm?: (request: {
    title: string;
    summary: string;
    items?: Array<{ label: string; detail?: string }>;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  /** 重新读取脚本目录（工作流列表），并推送给所有画布。 */
  refreshWorkflows?: () => Promise<void>;
  /** 记录一份崩溃恢复副本（画布每次改动都会调用）。 */
  recordRecovery?: (uri: string, text: string, dirty: boolean) => void;
  /** 文档画布的 iframe：详情栏是镜像，写文档的指令要发给它。 */
  getDocumentFrame?: (uri: string) => HTMLIFrameElement | undefined;
  getSelectedInstance: () => string;
  createNewWorkflow: () => Promise<void>;
  switchWorkflow: (uri: string, resetStack?: boolean) => Promise<void>;
  ensureDocument: (uri: string) => WorkflowDocumentTab;
  openWorkflowTab: (uri: string, preserveNavigation?: boolean) => Promise<void>;
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
    showVariableReferences, showImpactConfirm, getDocumentFrame, recordRecovery,
    getSelectedInstance, createNewWorkflow, switchWorkflow, ensureDocument, openWorkflowTab,
    loadWorkflow, loadDocumentOnce, sendDocumentInit, resolveWorkflow, selectInstance, refreshWorkflows,
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
        case 'clipboardWrite': {
          // 画布复制/剪切后把内容交给壳层保管：同一窗口的所有画布共用这份剪贴板，
          // 于是卡片可以跨画布粘贴（弹出到独立窗口的面板也走同一条通道）。
          const clipboard = parseCanvasClipboard(message.clipboard);
          if (!clipboard) return;
          workspace.setCanvasClipboard(clipboard);
          workspace.postToDocumentEditors({ type: 'clipboard', clipboard });
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
          workspace.syncWorkflowDescriptor(targetUri, text);
          // 崩溃恢复副本：每次正文变化都留档（防抖在存储侧按内容去重），
          // 刷新/崩溃后还能把未保存内容捡回来；写盘成功后会清掉（见 workspace 的 onSaved）。
          recordRecovery?.(targetUri, text, message.dirty !== false);
          // 详情栏是镜像：它报上来的正文属于活动文档，同样要写进这份文档的运行时快照，
          // 否则镜像重载（移到独立窗口、Dockview 重挂）时会拿回旧正文。
          const targetRuntime = runtime ?? (targetUri ? workspace.getDocumentRuntimes().get(targetUri) : undefined);
          if (targetRuntime?.init) targetRuntime.init.document.text = text;
          if (isActiveSource || !sourceUri) {
            workspace.setDirty(message.dirty !== false);
            workspace.scheduleAutoSave(text);
            // 详情栏是**镜像**画布：它没有文档写权（保存时会被真画布覆盖），所以镜像里的
            // 编辑（换动作、改参数、改名字…）必须推给真正持有文档的那份画布，否则改完
            // 卡片还停在旧值上，真画布下一次上报又会把这份改动覆盖掉。
            const documentFrame = targetUri ? getDocumentFrame?.(targetUri) : undefined;
            if (documentFrame && documentFrame !== sourceFrame) {
              workspace.postToFrame(documentFrame, { type: 'replaceDocument', text, recordHistory: true });
            }
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
        case 'inspectorRenameRequested': {
          // 文档画布按了 F2：先同步当前选中项，再聚焦详细信息镜像里的名称输入框。
          // 节点组不是运行时节点，不能依赖镜像此前保存的普通节点选区。
          if (!isActiveSource && sourceUri) return;
          showDetailsPanel();
          if (message.inspectorSelection) {
            workspace.postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: message.inspectorSelection });
          }
          workspace.postToFrame(detailsFrame, { type: 'editorCommand', command: 'renameSelection' });
          return;
        }
        case 'variableReferencesRequested': {
          // 删被引用的变量时，详细信息面板把引用清单交过来：
          // 打开「变量引用」面板列出所有引用者，用户可跳过去断开或直接删除。
          if (!isActiveSource && sourceUri) return;
          // 详细信息是**镜像**画布：它没有文档写权（保存时会被真画布覆盖），
          // 所以后续指令一律发给这篇文档的真画布，改完再让详情栏重新同步。
          const documentFrame = (targetUri ? getDocumentFrame?.(targetUri) : undefined) ?? sourceFrame;
          showVariableReferences?.({
            scope: message.scope === 'inputs' ? 'inputs' : 'variables',
            name: String(message.name ?? ''),
            displayName: String(message.displayName ?? message.name ?? ''),
            type: typeof message.variableType === 'string' ? message.variableType : '',
            defaultText: typeof message.defaultText === 'string' ? message.defaultText : '',
            entries: Array.isArray(message.entries) ? (message.entries as VariableReferencesData['entries']) : [],
          }, {
            frame: documentFrame,
            post: (command, value) => {
              workspace.postToFrame(documentFrame, { type: 'editorCommand', command, value });
              // 详情栏的这份镜像要跟着刷新，否则面板删完了它还显示旧参数。
              if (documentFrame !== detailsFrame) {
                window.setTimeout(() => {
                  workspace.postToFrame(detailsFrame, { type: 'editorCommand', command: 'variablesChanged', value: undefined });
                }, 0);
              }
            },
          });
          return;
        }
        case 'variableRenameImpactRequested': {
          // 变量改名会改写多处引用：先亮出影响范围，确认后再回画布真正改名。
          if (!isActiveSource && sourceUri) return;
          const renameMessage = message as unknown as {
            scope?: string; oldName?: string; name?: string; count?: number; entries?: unknown[];
          };
          const oldName = String(renameMessage.oldName ?? '');
          const name = String(renameMessage.name ?? '');
          const entries = Array.isArray(renameMessage.entries) ? renameMessage.entries : [];
          const summary = oldName && name
            ? `「${oldName}」将改名为「${name}」，${Number(renameMessage.count) || entries.length} 处引用会随之显示新名字。`
            : `${Number(renameMessage.count) || 0} 处引用会随之显示新名字。`;
          const ok = await (showImpactConfirm?.({
            title: oldName && name ? `改名为「${name}」` : '确认改名',
            summary,
            items: entries.slice(0, 200).map((entry) => {
              const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
              const where = typeof record.nodeName === 'string' && record.nodeName
                ? `节点「${record.nodeName}」`
                : (typeof record.nodeId === 'string' && record.nodeId ? `节点「${record.nodeId}」` : '初始化输入');
              const target = typeof record.label === 'string' && record.label ? record.label : '参数引用';
              return {
                label: `${where} · ${target}`,
                detail: typeof record.ref === 'string' ? record.ref : '',
              };
            }),
            confirmLabel: '确认改名',
          }) ?? false);
          // 改名请求（暂存）在发起它的那份画布里：确认/取消必须回发给它——
          // 侧栏 F2 的请求来自文档画布，详情栏输入框的请求来自镜像画布，各自持有暂存状态。
          workspace.postToFrame(sourceFrame, { type: 'editorCommand', command: ok ? 'confirmRenameVariable' : 'cancelRenameVariable' });
          return;
        }
        case 'saveBlockedRequested': {
          // 保存被拦下：文档里有运行时会拒绝的错误。提醒（warning）不会走到这里。
          const saveMessage = message as unknown as {
            errors?: number; warnings?: number; entries?: unknown[];
          };
          const errors = Number(saveMessage.errors) || 0;
          const warnings = Number(saveMessage.warnings) || 0;
          const entries = Array.isArray(saveMessage.entries) ? saveMessage.entries : [];
          const more = errors > entries.length ? `（另有 ${errors - entries.length} 个未列出）` : '';
          const ok = await (showImpactConfirm?.({
            title: '保存前发现无法运行的错误',
            summary: `有 ${errors} 个错误会让运行时拒绝这份工作流${warnings ? `，另有 ${warnings} 个提醒` : ''}${more}。`,
            items: entries.map((entry) => {
              const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
              return {
                label: typeof record.label === 'string' ? record.label : '校验错误',
                detail: typeof record.detail === 'string' ? record.detail : '',
              };
            }),
            confirmLabel: `仍然保存（${errors} 个错误）`,
            cancelLabel: '返回修改',
            danger: true,
          }) ?? false);
          // 只有用户明确坚持保存才回画布写盘，否则留在编辑器里继续改。
          if (ok) workspace.postToFrame(sourceFrame, { type: 'editorCommand', command: 'forceSave' });
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
            const source = parseDocument(workspace.tab(targetUri)?.text ?? workspace.activeText()) as { nodes?: Array<{ id?: string; action?: string; params?: { workflow?: string } }> };
            const node = source.nodes?.find((item) => item.id === message.nodeId && item.action === 'workflow.run');
            if (node?.params?.workflow) resolved = resolveWorkflow(node.params.workflow);
          }
          if (!resolved) throw new Error(`未找到子工作流：${reference || message.nodeId || ''}`);
          const parent = workspace.tab(targetUri);
          const target = ensureDocument(resolved.uri);
          workspace.setDocumentBackStack(target.uri, [...(parent?.backStack ?? []), targetUri]);
          await openWorkflowTab(resolved.uri, true);
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
          if (previous) {
            workspace.setDocumentBackStack(previous, [...(workspace.tab(targetUri)?.backStack ?? [])]);
            await openWorkflowTab(previous, true);
          }
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
          await openWorkflowTab(trail[index], true);
          return;
        }
        case 'reloadRequest': {
          if (targetUri) await loadWorkflow(targetUri);
          return;
        }
        case 'refreshWorkflows': {
          // 画布要最新脚本目录：刷壳层 bootstrap（子流程引用解析用它）并把新列表推给所有画布。
          await refreshWorkflows?.();
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
          // 框选结果要送回**持有文档**的那份画布：详情栏是镜像，没有写权，
          // 把模板/区域发给它只会让卡片停在旧值上（真画布再覆盖回去）。
          const documentFrame = (targetUri ? getDocumentFrame?.(targetUri) : undefined) ?? sourceFrame;
          roiPicker.open({
            requestId: String(message.requestId ?? ''),
            nodeId: String(message.nodeId ?? message.stepId ?? ''),
            key: String(message.key ?? ''),
            pairedKey: typeof message.pairedKey === 'string' ? message.pairedKey : undefined,
            mode: message.mode === 'rect' ? 'rect' : message.mode === 'point' ? 'point' : 'asset',
            targetPath: typeof message.targetPath === 'string' ? message.targetPath : undefined,
            sourceFrame: documentFrame,
            requestFrame: sourceFrame === documentFrame ? undefined : sourceFrame,
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
