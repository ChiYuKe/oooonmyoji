/**
 * 文档工作区：文档列表、活动文档、保存状态与会话数据的唯一归属。
 *
 * 壳层通过状态访问器读写文档，通过命令式方法修改（setText/setDirty/...），
 * 画布 iframe 只接收消息，不再由入口维护一套镜像状态。
 */
import type { BootstrapData, ParameterInfo, WorkflowEditorInit, WorkflowDescriptor } from '../shared/contracts';
import type { InspectorSelection, SidebarNode, SidebarVariable } from '../shared/editor-messages';
import type { CanvasClipboardPayload } from '../shared/editor-messages';
import { createAutoSaveQueue } from '../shared/workspace/autosave';
import { createDocumentStore } from '../shared/workspace/documents';
import { parseWorkflowSession, reconcileWorkflowSession, serializeWorkflowSession, type WorkflowDocumentTab, type WorkflowSession } from '../shared/workspace/session';
import { parseDocument } from '../shared/workflow/graph-dsl';

export type { InspectorSelection, SidebarNode, SidebarVariable } from '../shared/editor-messages';

/** 一个工作流文档对应的画布运行时：各自的 iframe、初始化和侧栏状态。 */
export interface DocumentRuntime {
  panelId: string;
  frame: HTMLIFrameElement;
  ready: boolean;
  init?: WorkflowEditorInit;
  sidebarNodes: SidebarNode[];
  sidebarVariables: SidebarVariable[];
  selectedNode: string;
  selectedVariable: string;
  selectedVariableScope: 'inputs' | 'variables';
  collapsedTreeNodes: Set<string>;
  inspectorSelection?: InspectorSelection;
}

export interface WorkspaceDeps {
  detailsFrame: HTMLIFrameElement;
  api: {
    saveWorkflow(uri: string, text: string): Promise<void>;
  };
  getBootstrap: () => BootstrapData | undefined;
  showToast: (message: string, error?: boolean) => void;
  errorMessage: (error: unknown) => string;
  setStatus: (message: string) => void;
  syncDocumentTabs: () => void;
  /** 文档成功写盘后回调（清掉崩溃恢复副本用）。 */
  onDocumentSaved?: (uri: string) => void;
}

export interface Workspace {
  // 文档状态
  tabs(): readonly WorkflowDocumentTab[];
  tab(uri: string): WorkflowDocumentTab | undefined;
  activeUri(): string;
  activeTab(): WorkflowDocumentTab | undefined;
  activeText(): string;
  isDirty(): boolean;
  activeBackStack(): string[];
  ensureDocument(uri: string): WorkflowDocumentTab;
  removeDocument(uri: string): boolean;
  renameDocument(oldUri: string, newUri: string): void;
  setActiveDocument(uri: string): void;
  setDocumentText(uri: string, text: string): void;
  setDocumentDirty(uri: string, dirty: boolean): void;
  setDocumentBackStack(uri: string, stack: string[]): void;
  setActiveBackStack(stack: string[]): void;
  pushActiveBackStack(uri: string): void;
  popActiveBackStack(): string | undefined;
  popDocumentBackStack(uri: string): string | undefined;
  // 画布运行时注册表与消息
  getDocumentRuntimes(): Map<string, DocumentRuntime>;
  activeRuntime(): DocumentRuntime | undefined;
  runtimeForUri(uri: string): DocumentRuntime | undefined;
  runtimeForFrame(frame: HTMLIFrameElement): DocumentRuntime | undefined;
  frameUriForFrame(frame: HTMLIFrameElement): string | undefined;
  postToFrame(frame: HTMLIFrameElement, payload: Record<string, unknown>): void;
  postToEditor(payload: Record<string, unknown>): void;
  postToEditors(payload: Record<string, unknown>): void;
  postToAllEditors(payload: Record<string, unknown>): void;
  /** 广播到持有文档的画布（详情栏镜像除外）。 */
  postToDocumentEditors(payload: Record<string, unknown>): void;
  /** 画布剪贴板：一台窗口一份，所有画布共用。 */
  canvasClipboard(): CanvasClipboardPayload | undefined;
  setCanvasClipboard(payload: CanvasClipboardPayload | undefined): void;
  editorCommand(command: string, value?: unknown): void;
  registerDocumentFrame(panelId: string, uri: string, frame: HTMLIFrameElement): void;
  unregisterDocumentFrame(panelId: string): void;
  displayFileUri(uri: string): string;
  // 自动保存
  setDirty(value: boolean): void;
  /** 取消排队中的自动保存；省略 uri 时作用于活动文档。 */
  cancelAutoSave(uri?: string): void;
  scheduleAutoSave(text: string): void;
  waitForAutoSave(): Promise<void>;
  flushAutoSave(): Promise<void>;
  // 会话
  workflowReference(file: WorkflowDescriptor): string;
  workflowTabName(uri: string): string;
  workflowDescriptorForPath(relativePath: string): WorkflowDescriptor | undefined;
  /** 用当前编辑正文刷新工作流摘要，并同步给所有已打开画布。 */
  syncWorkflowDescriptor(uri: string, text: string): void;
  restoreUri(): string;
  setRestoreUri(uri: string): void;
  readWorkflowSession(): WorkflowSession | undefined;
  applyWorkflowSession(session: WorkflowSession): void;
  flushRestoredEdits(): Promise<void>;
  persistWorkflowSessionNow(): void;
  scheduleWorkflowSessionPersist(): void;
}

const WORKFLOW_SESSION_KEY = 'onmyoji-studio.workflow-session.v1';
const AUTO_SAVE_DELAY_MS = 700;

export function createWorkspace(deps: WorkspaceDeps): Workspace {
  const {
    detailsFrame, api, getBootstrap, showToast, errorMessage, setStatus, syncDocumentTabs,
  } = deps;

  const store = createDocumentStore();
  const documentRuntimes = new Map<string, DocumentRuntime>();
  const documentFrameUris = new WeakMap<HTMLIFrameElement, string>();
  let restoreWorkflowUri = '';
  let workflowSessionTimer: number | undefined;
  /** 画布剪贴板（本窗口一份）：跨画布粘贴的唯一来源。 */
  let canvasClipboardPayload: CanvasClipboardPayload | undefined;

  const autoSave = createAutoSaveQueue({
    delayMs: AUTO_SAVE_DELAY_MS,
    setTimer: (handler, delay) => window.setTimeout(handler, delay),
    clearTimer: (id) => window.clearTimeout(id),
    save: (uri, text) => api.saveWorkflow(uri, text),
    onSaved: (uri, text) => {
      store.setText(uri, text);
      store.setDirty(uri, false);
      const runtime = documentRuntimes.get(uri);
      if (runtime?.init) runtime.init.document.text = text;
      // 内容已经落盘：崩溃恢复副本没有意义了，清掉避免下次打开弹「要不要恢复」。
      deps.onDocumentSaved?.(uri);
      if (uri === store.activeUri()) {
        postToEditors({ type: 'workflowSaved' });
        setStatus('工作流已自动保存');
      } else {
        syncDocumentTabs();
      }
    },
    onFailed: (uri, error) => {
      store.setDirty(uri, true);
      if (uri === store.activeUri()) {
        postToEditors({ type: 'workflowSaveFailed' });
        showToast(`自动保存失败：${errorMessage(error)}`, true);
        setStatus('自动保存失败');
      } else {
        syncDocumentTabs();
      }
    },
  });

  function activeRuntime(): DocumentRuntime | undefined {
    return documentRuntimes.get(store.activeUri());
  }

  function runtimeForUri(uri: string): DocumentRuntime | undefined {
    return documentRuntimes.get(uri);
  }

  function runtimeForFrame(frame: HTMLIFrameElement): DocumentRuntime | undefined {
    const uri = documentFrameUris.get(frame);
    return uri ? documentRuntimes.get(uri) : undefined;
  }

  function postToFrame(frame: HTMLIFrameElement, payload: Record<string, unknown>): void {
    frame.contentWindow?.postMessage({ source: 'desktop-shell', payload }, '*');
  }

  function postToEditor(payload: Record<string, unknown>): void {
    const frame = activeRuntime()?.frame;
    if (frame) postToFrame(frame, payload);
  }

  function postToEditors(payload: Record<string, unknown>): void {
    const frame = activeRuntime()?.frame;
    if (frame) postToFrame(frame, payload);
    postToFrame(detailsFrame, payload);
  }

  /** 广播到所有画布（实例列表、运行事件、连通性探测等）。 */
  function postToAllEditors(payload: Record<string, unknown>): void {
    for (const runtime of documentRuntimes.values()) postToFrame(runtime.frame, payload);
    postToFrame(detailsFrame, payload);
  }

  /** 广播到「持有文档」的画布，不含详情栏镜像：镜像没有写权，拿到剪贴板只会误导。 */
  function postToDocumentEditors(payload: Record<string, unknown>): void {
    for (const runtime of documentRuntimes.values()) postToFrame(runtime.frame, payload);
  }

  /** 画布剪贴板：一台窗口一份，所有画布共用，所以卡片能跨画布（含弹出面板）粘贴。 */
  function canvasClipboard(): CanvasClipboardPayload | undefined {
    return canvasClipboardPayload;
  }

  function setCanvasClipboard(payload: CanvasClipboardPayload | undefined): void {
    canvasClipboardPayload = payload;
  }

  function editorCommand(command: string, value?: unknown): void {
    postToEditor({ type: 'editorCommand', command, value });
  }

  /** Dockview 为文档面板创建独立画布时登记运行时，供消息路由与状态恢复使用。 */
  function registerDocumentFrame(panelId: string, uri: string, frame: HTMLIFrameElement): void {
    const existing = documentRuntimes.get(uri);
    if (existing && existing.frame === frame) {
      existing.panelId = panelId;
      return;
    }
    documentRuntimes.set(uri, {
      panelId,
      frame,
      ready: false,
      sidebarNodes: [],
      sidebarVariables: [],
      selectedNode: '',
      selectedVariable: '',
      selectedVariableScope: 'inputs',
      collapsedTreeNodes: new Set(),
    });
    documentFrameUris.set(frame, uri);
  }

  function unregisterDocumentFrame(panelId: string): void {
    for (const [uri, runtime] of documentRuntimes) {
      if (runtime.panelId !== panelId) continue;
      documentRuntimes.delete(uri);
      documentFrameUris.delete(runtime.frame);
      return;
    }
  }

  function displayFileUri(uri: string): string {
    try {
      const parsed = new URL(uri);
      return decodeURIComponent(parsed.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1');
    } catch {
      return uri;
    }
  }

  function setDirty(value: boolean): void {
    store.setDirty(store.activeUri(), value);
    syncDocumentTabs();
  }

  function setDocumentDirty(uri: string, value: boolean): void {
    store.setDirty(uri, value);
    syncDocumentTabs();
  }

  function scheduleAutoSave(text: string): void {
    autoSave.schedule(store.activeUri(), text);
  }

  function cancelAutoSave(uri?: string): void {
    autoSave.cancel(uri ?? store.activeUri());
  }

  function waitForAutoSave(): Promise<void> {
    return autoSave.wait();
  }

  function flushAutoSave(): Promise<void> {
    return autoSave.flush(store.activeUri());
  }

  function workflowReference(file: WorkflowDescriptor): string {
    return file.rel.replace(/\\/g, '/').replace(/^workflows\//i, '');
  }

  function workflowTabName(uri: string): string {
    const descriptor = getBootstrap()?.workflows.find((item) => item.uri === uri);
    if (descriptor) return (descriptor.id || descriptor.name).replace(/\.(?:owf|json)$/i, '');
    const file = displayFileUri(uri).split(/[\\/]/).pop() || uri;
    return file.replace(/\.(?:owf|json)$/i, '') || '工作流';
  }

  function workflowDescriptorForPath(relativePath: string): WorkflowDescriptor | undefined {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^workflows\//i, '').toLowerCase();
    return getBootstrap()?.workflows.find((workflow) => workflowReference(workflow).toLowerCase() === normalized);
  }

  function syncWorkflowDescriptor(uri: string, text: string): void {
    const bootstrap = getBootstrap();
    const index = bootstrap?.workflows.findIndex((workflow) => workflow.uri === uri) ?? -1;
    if (!bootstrap || index < 0) return;
    let document: Record<string, unknown>;
    try {
      const parsed = parseDocument(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      document = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const current = bootstrap.workflows[index];
    const inputRecord = document.inputs && typeof document.inputs === 'object' && !Array.isArray(document.inputs)
      ? document.inputs as Record<string, unknown>
      : {};
    const inputs = Object.entries(inputRecord)
      .filter(([, definition]) => Boolean(definition) && typeof definition === 'object' && !Array.isArray(definition))
      .map(([name, definition]) => ({ name, definition: definition as ParameterInfo }));
    const { id: _oldId, description: _oldDescription, inputs: _oldInputs, ...base } = current;
    const id = typeof document.id === 'string' ? document.id.trim() : '';
    const description = typeof document.description === 'string' ? document.description.trim() : '';
    const next: WorkflowDescriptor = {
      ...base,
      ...(id ? { id } : {}),
      ...(description ? { description } : {}),
      ...(inputs.length ? { inputs } : {}),
    };
    if (JSON.stringify([current.id, current.description, current.inputs]) === JSON.stringify([next.id, next.description, next.inputs])) return;
    bootstrap.workflows = bootstrap.workflows.map((workflow, workflowIndex) => workflowIndex === index ? next : workflow);
    for (const runtime of documentRuntimes.values()) {
      if (runtime.init) runtime.init.workflows = bootstrap.workflows;
    }
    postToAllEditors({ type: 'workflows', workflows: bootstrap.workflows });
  }

  function readWorkflowSession(): WorkflowSession | undefined {
    const known = getBootstrap()?.workflows.map((workflow) => workflow.uri) ?? [];
    return reconcileWorkflowSession(parseWorkflowSession(window.onmyoji.readLayout(WORKFLOW_SESSION_KEY)), known);
  }

  function applyWorkflowSession(session: WorkflowSession): void {
    store.replaceAll(session.tabs, session.activeUri);
    restoreWorkflowUri = session.activeUri;
  }

  /** 把上次退出时的未保存内容先写盘，避免恢复后标记变干净却丢失改动。 */
  async function flushRestoredEdits(): Promise<void> {
    for (const tab of store.tabs()) {
      if (!tab.dirty || !tab.text) continue;
      try {
        await api.saveWorkflow(tab.uri, tab.text);
        store.setDirty(tab.uri, false);
      } catch {
        // 写盘失败时保留脏标记，下一次会话仍会带上这段内容。
      }
    }
  }

  function persistWorkflowSessionNow(): void {
    if (workflowSessionTimer !== undefined) {
      window.clearTimeout(workflowSessionTimer);
      workflowSessionTimer = undefined;
    }
    if (store.tabs().length === 0) return;
    try {
      window.onmyoji.writeLayout(WORKFLOW_SESSION_KEY, serializeWorkflowSession(store.tabs(), store.activeUri() || restoreWorkflowUri));
    } catch {
      // 会话持久化尽力而为，不能影响编辑。
    }
  }

  function scheduleWorkflowSessionPersist(): void {
    if (workflowSessionTimer !== undefined) window.clearTimeout(workflowSessionTimer);
    workflowSessionTimer = window.setTimeout(() => {
      workflowSessionTimer = undefined;
      persistWorkflowSessionNow();
    }, 250);
  }

  return {
    tabs: store.tabs,
    tab: store.tab,
    activeUri: store.activeUri,
    activeTab: store.activeTab,
    activeText: store.activeText,
    isDirty: store.isDirty,
    activeBackStack: store.activeBackStack,
    ensureDocument: store.ensure,
    removeDocument: store.remove,
    renameDocument: store.rename,
    setActiveDocument: store.setActive,
    setDocumentText: store.setText,
    setDocumentDirty,
    setDocumentBackStack: store.setBackStack,
    setActiveBackStack: store.setActiveBackStack,
    pushActiveBackStack: store.pushActiveBackStack,
    popActiveBackStack: store.popActiveBackStack,
    popDocumentBackStack: store.popBackStack,
    getDocumentRuntimes: () => documentRuntimes,
    activeRuntime,
    runtimeForUri,
    runtimeForFrame,
    frameUriForFrame: (frame) => documentFrameUris.get(frame),
    postToFrame,
    postToEditor,
    postToEditors,
    postToAllEditors,
    postToDocumentEditors,
    canvasClipboard,
    setCanvasClipboard,
    editorCommand,
    registerDocumentFrame,
    unregisterDocumentFrame,
    displayFileUri,
    setDirty,
    cancelAutoSave,
    scheduleAutoSave,
    waitForAutoSave,
    flushAutoSave,
    workflowReference,
    workflowTabName,
    workflowDescriptorForPath,
    syncWorkflowDescriptor,
    restoreUri: () => restoreWorkflowUri,
    setRestoreUri: (uri) => { restoreWorkflowUri = uri; },
    readWorkflowSession,
    applyWorkflowSession,
    flushRestoredEdits,
    persistWorkflowSessionNow,
    scheduleWorkflowSessionPersist,
  };
}
