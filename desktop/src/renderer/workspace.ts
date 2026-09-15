/**
 * 文档工作区核心（阶段 1+2）：消息路由、文档运行时注册表、自动保存与会话持久化。
 *
 * 主窗口通过 createWorkspace(deps) 注入实时状态读写器与共享操作；
 * 「活动文档镜像」状态（currentUri/currentText/dirty/workflowTabs 等）仍由 main 持有，
 * 这里只搬函数，避免大面积改写调用点。
 */
import type { BootstrapData, WorkflowEditorInit, WorkflowDescriptor } from '../shared/contracts';
import { parseWorkflowSession, reconcileWorkflowSession, serializeWorkflowSession, type WorkflowDocumentTab, type WorkflowSession } from './workflow-session';

export interface SidebarNode {
  id: string;
  name: string;
  type: string;
  meta: string;
  children: string[];
}

export interface SidebarVariable {
  name: string;
  displayName?: string;
  group?: string;
  type: string;
  scope: 'inputs' | 'variables';
  public?: boolean;
  onCard?: boolean;
}

export interface InspectorSelection {
  kind: 'none' | 'node' | 'run' | 'edge' | 'variables' | 'workflow';
  nodeId?: string;
  index?: number;
  parent?: string;
  child?: string;
  name?: string;
  scope?: 'inputs' | 'variables';
}

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
  getCurrentUri: () => string;
  getCurrentText: () => string;
  setCurrentText: (text: string) => void;
  isDirty: () => boolean;
  setDirtyFlag: (dirty: boolean) => void;
  getWorkflowTabs: () => WorkflowDocumentTab[];
  setWorkflowTabs: (tabs: WorkflowDocumentTab[]) => void;
  getCurrentEditorInit: () => WorkflowEditorInit | undefined;
  getBackStack: () => string[];
  getRestoreUri: () => string;
  setRestoreUri: (uri: string) => void;
  getBootstrap: () => BootstrapData | undefined;
  showToast: (message: string, error?: boolean) => void;
  errorMessage: (error: unknown) => string;
  setStatus: (message: string) => void;
  syncDocumentTabs: () => void;
}

export interface Workspace {
  getDocumentRuntimes(): Map<string, DocumentRuntime>;
  activeRuntime(): DocumentRuntime | undefined;
  runtimeForUri(uri: string): DocumentRuntime | undefined;
  runtimeForFrame(frame: HTMLIFrameElement): DocumentRuntime | undefined;
  frameUriForFrame(frame: HTMLIFrameElement): string | undefined;
  postToFrame(frame: HTMLIFrameElement, payload: Record<string, unknown>): void;
  postToEditor(payload: Record<string, unknown>): void;
  postToEditors(payload: Record<string, unknown>): void;
  postToAllEditors(payload: Record<string, unknown>): void;
  editorCommand(command: string, value?: unknown): void;
  registerDocumentFrame(panelId: string, uri: string, frame: HTMLIFrameElement): void;
  unregisterDocumentFrame(panelId: string): void;
  displayFileUri(uri: string): string;
  // 自动保存
  setDirty(value: boolean): void;
  clearAutoSaveTimer(): void;
  cancelAutoSave(): void;
  scheduleAutoSave(text: string): void;
  waitForAutoSave(): Promise<void>;
  flushAutoSave(): Promise<void>;
  // 会话
  workflowReference(file: WorkflowDescriptor): string;
  workflowTabName(uri: string): string;
  workflowDescriptorForPath(relativePath: string): WorkflowDescriptor | undefined;
  rememberCurrentWorkflowTab(): void;
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
    detailsFrame, api, getCurrentUri, getCurrentText, setCurrentText, isDirty, setDirtyFlag,
    getWorkflowTabs, setWorkflowTabs, getCurrentEditorInit, getBackStack, getRestoreUri, setRestoreUri,
    getBootstrap, showToast, errorMessage, setStatus, syncDocumentTabs,
  } = deps;

  const documentRuntimes = new Map<string, DocumentRuntime>();
  const documentFrameUris = new WeakMap<HTMLIFrameElement, string>();

  let autoSaveTimer: number | undefined;
  let autoSaveInFlight = false;
  let autoSavePromise: Promise<void> | undefined;
  let autoSaveRevision = 0;
  let autoSavePending: { uri: string; text: string; revision: number } | undefined;
  let workflowSessionTimer: number | undefined;

  function activeRuntime(): DocumentRuntime | undefined {
    return documentRuntimes.get(getCurrentUri());
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
    setDirtyFlag(value);
    const activeTab = getWorkflowTabs().find((tab) => tab.uri === getCurrentUri());
    if (activeTab) activeTab.dirty = value;
    syncDocumentTabs();
  }

  function clearAutoSaveTimer(): void {
    if (autoSaveTimer !== undefined) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = undefined;
    }
  }

  function cancelAutoSave(): void {
    clearAutoSaveTimer();
    autoSavePending = undefined;
    autoSaveRevision += 1;
  }

  /** 文档变化后延迟写盘，连续拖拽或输入只保存最后一次内容。 */
  function scheduleAutoSave(text: string): void {
    if (!getCurrentUri() || !text) return;
    const revision = ++autoSaveRevision;
    autoSavePending = { uri: getCurrentUri(), text, revision };
    clearAutoSaveTimer();
    autoSaveTimer = window.setTimeout(runAutoSave, AUTO_SAVE_DELAY_MS);
  }

  function runAutoSave(): void {
    autoSaveTimer = undefined;
    if (autoSaveInFlight) return;
    const promise = flushAutoSave();
    autoSavePromise = promise;
    void promise.finally(() => {
      if (autoSavePromise === promise) autoSavePromise = undefined;
    });
  }

  async function waitForAutoSave(): Promise<void> {
    if (autoSavePromise) await autoSavePromise;
  }

  async function flushAutoSave(): Promise<void> {
    if (autoSaveInFlight) return;
    const pending = autoSavePending;
    autoSavePending = undefined;
    if (!pending || pending.uri !== getCurrentUri()) return;

    autoSaveInFlight = true;
    const uri = pending.uri;
    try {
      setStatus('正在自动保存…');
      await api.saveWorkflow(uri, pending.text);
      if (uri === getCurrentUri() && pending.revision === autoSaveRevision) {
        setCurrentText(pending.text);
        const init = getCurrentEditorInit();
        if (init) init.document.text = pending.text;
        setDirty(false);
        postToEditors({ type: 'workflowSaved' });
        setStatus('工作流已自动保存');
      }
    } catch (error) {
      if (uri === getCurrentUri() && pending.revision === autoSaveRevision) {
        setDirty(true);
        postToEditors({ type: 'workflowSaveFailed' });
        showToast(`自动保存失败：${errorMessage(error)}`, true);
        setStatus('自动保存失败');
      }
    } finally {
      autoSaveInFlight = false;
      if (autoSavePending && autoSaveTimer === undefined) {
        autoSaveTimer = window.setTimeout(runAutoSave, AUTO_SAVE_DELAY_MS);
      }
    }
  }

  function workflowReference(file: WorkflowDescriptor): string {
    return file.rel.replace(/\\/g, '/').replace(/^workflows\//i, '');
  }

  function workflowTabName(uri: string): string {
    const descriptor = getBootstrap()?.workflows.find((item) => item.uri === uri);
    if (descriptor) return (descriptor.id || descriptor.name).replace(/\.json$/i, '');
    const file = displayFileUri(uri).split(/[\\/]/).pop() || uri;
    return file.replace(/\.json$/i, '') || '工作流';
  }

  function workflowDescriptorForPath(relativePath: string): WorkflowDescriptor | undefined {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^workflows\//i, '').toLowerCase();
    return getBootstrap()?.workflows.find((workflow) => workflowReference(workflow).toLowerCase() === normalized);
  }

  function rememberCurrentWorkflowTab(): void {
    const uri = getCurrentUri();
    if (!uri) return;
    const tab = getWorkflowTabs().find((item) => item.uri === uri);
    if (!tab) return;
    tab.text = getCurrentText();
    tab.dirty = isDirty();
    tab.backStack = [...getBackStack()];
  }

  function readWorkflowSession(): WorkflowSession | undefined {
    const known = getBootstrap()?.workflows.map((workflow) => workflow.uri) ?? [];
    return reconcileWorkflowSession(parseWorkflowSession(window.onmyoji.readLayout(WORKFLOW_SESSION_KEY)), known);
  }

  function applyWorkflowSession(session: WorkflowSession): void {
    setWorkflowTabs(session.tabs.map((tab) => ({
      uri: tab.uri,
      text: tab.text,
      dirty: tab.dirty,
      backStack: [...tab.backStack],
    })));
    setRestoreUri(session.activeUri);
  }

  /** 把上次退出时的未保存内容先写盘，避免恢复后标记变干净却丢失改动。 */
  async function flushRestoredEdits(): Promise<void> {
    for (const tab of getWorkflowTabs()) {
      if (!tab.dirty || !tab.text) continue;
      try {
        await api.saveWorkflow(tab.uri, tab.text);
        tab.dirty = false;
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
    if (getWorkflowTabs().length === 0) return;
    rememberCurrentWorkflowTab();
    try {
      window.onmyoji.writeLayout(WORKFLOW_SESSION_KEY, serializeWorkflowSession(getWorkflowTabs(), getCurrentUri() || getRestoreUri()));
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
    getDocumentRuntimes: () => documentRuntimes,
    activeRuntime,
    runtimeForUri,
    runtimeForFrame,
    frameUriForFrame: (frame) => documentFrameUris.get(frame),
    postToFrame,
    postToEditor,
    postToEditors,
    postToAllEditors,
    editorCommand,
    registerDocumentFrame,
    unregisterDocumentFrame,
    displayFileUri,
    setDirty,
    clearAutoSaveTimer,
    cancelAutoSave,
    scheduleAutoSave,
    waitForAutoSave,
    flushAutoSave,
    workflowReference,
    workflowTabName,
    workflowDescriptorForPath,
    rememberCurrentWorkflowTab,
    readWorkflowSession,
    applyWorkflowSession,
    flushRestoredEdits,
    persistWorkflowSessionNow,
    scheduleWorkflowSessionPersist,
  };
}
