import {
  ArrowLeft,
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  CircleDot,
  CirclePlus,
  Columns3,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FilePlus2,
  FileJson2,
  Flag,
  Folder,
  FolderOpen,
  FolderPlus,
  FoldVertical,
  GitBranch,
  GitFork,
  Hash,
  Image,
  ImageDown,
  LayoutGrid,
  Link2,
  List,
  ListTree,
  Maximize,
  Minus,
  MonitorUp,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Route,
  Save,
  Search,
  Settings2,
  Sigma,
  SlidersHorizontal,
  Scan,
  Square,
  Split,
  Trash2,
  ToggleLeft,
  Type,
  UnfoldVertical,
  WandSparkles,
  Waypoints,
  Workflow,
  X,
  createIcons,
  createElement,
} from 'lucide';
import 'dockview/dist/styles/dockview.css';
import type {
  BootstrapData,
  AssetImage,
  ParameterInfo,
  RuntimeInstance,
  RuntimeStateEvent,
  WorkflowDescriptor,
  WorkflowEditorInit,
} from '../shared/contracts';
import {
  createDockingWorkspace,
  createWorkbenchFrame,
  connectSharedPanelDocking,
  documentUriForPanelId,
  setDocumentPanelDirty,
  type DockPanelId,
  type DockingController,
  type SharedDockPanelId,
  type SharedPanelDockBridge,
  type WorkbenchFrameController,
  type WorkbenchPanelId,
} from './docking';
import { createReferenceViewer } from './reference-viewer';
import { contentName, createContentBrowser, relativeToProject, type ContentBrowser } from './content-browser';
import { createOverview, overviewInputDisplayName } from './overview';
import { createRuntimeLog } from './runtime-log';
import { parseWorkflowSession, reconcileWorkflowSession, serializeWorkflowSession, type WorkflowDocumentTab, type WorkflowSession } from './workflow-session';
import { createRoiPicker } from './roi-picker';
import './styles.css';

interface SidebarNode {
  id: string;
  name: string;
  type: string;
  meta: string;
  children: string[];
}

interface SidebarVariable {
  name: string;
  displayName?: string;
  group?: string;
  type: string;
  scope: 'inputs' | 'variables';
  public?: boolean;
  onCard?: boolean;
}

interface EditorEnvelope {
  source?: string;
  frameId?: string;
  message?: Record<string, unknown>;
  state?: { dirty?: boolean };
  /** 独立窗口转发的壳层快捷键与指针事件。 */
  type?: 'shellShortcut' | 'shellContextReset';
  key?: string;
}

interface RuntimeLogEnvelope {
  source?: string;
  message?: { type?: string };
}

interface InspectorSelection {
  kind: 'none' | 'node' | 'run' | 'edge' | 'variables' | 'workflow';
  nodeId?: string;
  index?: number;
  parent?: string;
  child?: string;
  name?: string;
  scope?: 'inputs' | 'variables';
}



/** 一个工作流文档对应的画布运行时：各自的 iframe、初始化和侧栏状态。 */
interface DocumentRuntime {
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

/** 持久化的画布会话：启动时用于恢复上次打开的工作流与未保存内容。 */


/**
 * 桌面壳层的删除键目标：由各面板的点击处理器登记，新的一次点击会先作废上一次登记。
 * editor 表示“结构树/变量列表里选中的东西”，交给画布执行删除。
 */
type DeleteTarget =
  | { kind: 'content'; path: string }
  | { kind: 'queue'; rel: string }
  | { kind: 'editor' };

const api = window.onmyoji;
const desktopIcons = {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  CirclePlus,
  Columns3,
  Copy,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FileJson2,
  Flag,
  Folder,
  FolderOpen,
  FolderPlus,
  FoldVertical,
  GitBranch,
  GitFork,
  Image,
  ImageDown,
  LayoutGrid,
  Link2,
  List,
  ListTree,
  Maximize,
  Minus,
  MonitorUp,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Route,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Split,
  Trash2,
  UnfoldVertical,
  WandSparkles,
  Waypoints,
  Workflow,
  X,
};

/** 将浏览器原生 title 提示迁移为工作台统一的自定义 tooltip（宿主侧，接收子页面消息）。 */
function installCustomTooltips(): void {
  window.StudioTooltip?.install({
    bridge: 'receive',
    assetPreview: true,
    ariaLabelTags: /^(BUTTON|INPUT|SELECT)$/,
    trimText: true,
    repositionOnResize: true,
    hideOnScroll: true,
    receiverFrames: () => [
      ...[...documentRuntimes.values()].map((runtime) => runtime.frame),
      detailsFrame,
      runtimeLogFrame,
    ],
  });
}


const detailsFrame = document.querySelector<HTMLIFrameElement>('#details-frame')!;
const instancePicker = document.querySelector<HTMLDivElement>('#instance-picker')!;
const instanceSelect = document.querySelector<HTMLButtonElement>('#instance-select')!;
const instanceSelectLabel = document.querySelector<HTMLElement>('#instance-select-label')!;
const instanceMenu = document.querySelector<HTMLDivElement>('#instance-menu')!;
const structureView = document.querySelector<HTMLElement>('#structure-view')!;
const variablesView = document.querySelector<HTMLElement>('#variables-view')!;
const loadingMask = document.querySelector<HTMLElement>('#loading-mask')!;
const runtimeLogFrame = document.querySelector<HTMLIFrameElement>('#runtime-log-frame')!;
const settingsContentView = document.querySelector<HTMLSelectElement>('#settings-content-view')!;
const settingsAutoRefresh = document.querySelector<HTMLInputElement>('#settings-auto-refresh')!;
const settingsDefaultWorkflow = document.querySelector<HTMLInputElement>('#settings-default-workflow')!;
const settingsRestoreSession = document.querySelector<HTMLInputElement>('#settings-restore-session')!;
const settingsDebugEnabled = document.querySelector<HTMLInputElement>('#settings-debug-enabled')!;
const settingsDebugAnnotate = document.querySelector<HTMLInputElement>('#settings-debug-annotate')!;
const roiPickerModal = document.querySelector<HTMLElement>('#roi-picker-modal')!;
const roiPickerTitle = document.querySelector<HTMLElement>('#roi-picker-title')!;
const roiPickerSubtitle = document.querySelector<HTMLElement>('#roi-picker-subtitle')!;
const roiPickerStage = document.querySelector<HTMLElement>('#roi-picker-stage')!;
const roiPickerImage = document.querySelector<HTMLImageElement>('#roi-picker-image')!;
const roiPickerSelection = document.querySelector<HTMLElement>('#roi-picker-selection')!;
const roiPickerHint = document.querySelector<HTMLElement>('#roi-picker-hint')!;
const roiPickerCancel = document.querySelector<HTMLButtonElement>('#roi-picker-cancel')!;
const roiPickerConfirm = document.querySelector<HTMLButtonElement>('#roi-picker-confirm')!;
const roiPickerClose = document.querySelector<HTMLButtonElement>('#roi-picker-close')!;

let bootstrap: BootstrapData | undefined;
let currentUri = '';
let currentText = '';
let selectedInstance = '';
let runtimeInstances: RuntimeInstance[] = [];
let backStack: string[] = [];
let editorReady = false;
let currentEditorInit: WorkflowEditorInit | undefined;
let dirty = false;
/** 已打开文档画布注册表：uri → 独立 iframe 与画布状态。 */
const documentRuntimes = new Map<string, DocumentRuntime>();
const documentFrameUris = new WeakMap<HTMLIFrameElement, string>();
/** 正在由壳层主动关闭的文档，避免 onDidRemoveDocument 重复走保存流程。 */
const closingDocuments = new Set<string>();
/** 会话恢复完成前忽略 Dockview 的激活事件，避免加载到错误的文档。 */
let documentsReady = false;
/** 关闭文档期间抑制激活事件，避免邻居面板抢先把 currentUri 切走。 */
let removingDocument = false;
/** 布局重置/会话对账时批量移除面板，不应触发保存与标签删除。 */
let suppressDocumentRemoval = false;
const AUTO_SAVE_DELAY_MS = 700;
let autoSaveTimer: number | undefined;
let autoSaveInFlight = false;
let autoSavePromise: Promise<void> | undefined;
let autoSaveRevision = 0;
let autoSavePending: { uri: string; text: string; revision: number } | undefined;
let sidebarNodes: SidebarNode[] = [];
let sidebarVariables: SidebarVariable[] = [];
let selectedNode = '';
let selectedVariable = '';
let selectedVariableScope: 'inputs' | 'variables' = 'inputs';
/** 结构树手动收起的分支节点 ID：重渲染（如切换选中节点）时保持折叠状态。 */
let collapsedTreeNodes = new Set<string>();
let toastTimer: number | undefined;
let instanceRefreshTimer: number | undefined;
let docking: DockingController | undefined;
let workbenchFrame: WorkbenchFrameController | undefined;
let sharedPanelDockBridge: SharedPanelDockBridge | undefined;
let workflowTabs: WorkflowDocumentTab[] = [];
/** 最近一次被点选的删除目标（内容项、队列行或画布选区）；Delete/Backspace 只作用于它。 */
let deleteTarget: DeleteTarget | undefined;
let autoRefreshInstances = true;
let loadDefaultWorkflowOnStart = true;
let restoreSessionOnStart = true;
/** 编辑器就绪前暂存的待恢复画布 URI。 */
let restoreWorkflowUri = '';
let workflowSessionTimer: number | undefined;
let moreMenu: { menu: HTMLElement; dismiss: (event: Event) => void; keyHandler: (event: KeyboardEvent) => void } | undefined;
let runtimeBusy = false;
let visionTestOpening = false;

let contentBrowser!: ContentBrowser;
const overview = createOverview({
  api,
  createIcons,
  desktopIcons,
  showToast,
  errorMessage,
  desktopControl,
  instanceLabel,
  renderWorkflowSelect,
  renderInstances,
  renderContentBrowser: () => contentBrowser.render(),
  selectRuntimeInstance,
  getBootstrap: () => bootstrap,
  setBootstrap: (value) => { bootstrap = value; },
  isRuntimeBusy: () => runtimeBusy,
  getSelectedInstance: () => selectedInstance,
  getRuntimeInstances: () => runtimeInstances,
  getCurrentUri: () => currentUri,
  getCurrentText: () => currentText,
  getWorkbenchFrame: () => workbenchFrame,
  getDocking: () => docking,
  getSharedPanelDockBridge: () => sharedPanelDockBridge,
  getDeleteTarget: () => (deleteTarget?.kind === 'queue' ? deleteTarget : undefined),
  setDeleteTarget: (target) => { deleteTarget = target; },
});

contentBrowser = createContentBrowser({
  api,
  createIcons,
  desktopIcons,
  createElement,
  showToast,
  errorMessage,
  getBootstrap: () => bootstrap,
  setBootstrap: (value) => { bootstrap = value; },
  getCurrentUri: () => currentUri,
  isDirty: () => dirty,
  getWorkflowTabs: () => workflowTabs,
  getOverview: () => overview,
  getReferenceViewer: () => referenceViewer,
  getDocking: () => docking,
  getDocumentRuntimes: () => documentRuntimes as Map<string, unknown>,
  getClosingDocuments: () => closingDocuments,
  workflowDescriptorForPath,
  relocateDocument,
  syncDocumentTabs,
  displayFileUri,
  renderWorkflowSelect,
  openWorkflowInNewTab,
  openWorkflowTab,
  loadWorkflow,
  setDeleteTarget: (target) => { deleteTarget = target; },
});

const WORKFLOW_SESSION_KEY = 'onmyoji-studio.workflow-session.v1';

function activeRuntime(): DocumentRuntime | undefined {
  return documentRuntimes.get(currentUri);
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

const runtimeLog = createRuntimeLog({ frame: runtimeLogFrame });
runtimeLogFrame.addEventListener('load', () => runtimeLog.markReady());
if (runtimeLogFrame.contentDocument?.readyState === 'complete') window.queueMicrotask(() => runtimeLog.markReady());

function editorCommand(command: string, value?: unknown): void {
  postToEditor({ type: 'editorCommand', command, value });
}

function desktopControl(command: string, value?: unknown): void {
  if (command === 'switchWorkflow') {
    void switchWorkflow(String(value ?? ''));
    return;
  }
  postToEditor({ type: 'desktopControl', command, value });
}

/** 顶栏选择或子流程跳转：打开/聚焦对应文档面板，并把导航栈重置为该文档自己的记录。 */
async function switchWorkflow(uri: string, resetStack = true): Promise<void> {
  if (!uri) return;
  workbenchFrame?.show('workflow');
  cancelAutoSave();
  await waitForAutoSave();
  const tab = workflowTabs.find((item) => item.uri === uri);
  if (tab && resetStack) tab.backStack = [];
  await openWorkflowTab(uri);
}

async function createNewWorkflow(): Promise<void> {
  const uri = await api.createWorkflow();
  if (!uri) return;
  if (bootstrap) bootstrap.workflows = (await api.bootstrap()).workflows;
  overview.reconcileSelection();
  overview.render();
  await openWorkflowTab(uri);
}

function matchesShortcut(event: KeyboardEvent, id: string): boolean {
  return window.StudioShortcuts?.matchesById(event, id) ?? false;
}

/** 用当前配置刷新标题栏菜单里展示的快捷键提示。 */
function refreshShortcutLabels(): void {
  const shortcuts = window.StudioShortcuts;
  if (!shortcuts) return;
  document.querySelectorAll<HTMLElement>('[data-shortcut]').forEach((element) => {
    const slot = element.querySelector('kbd');
    if (!slot) return;
    const binding = shortcuts.get(element.dataset.shortcut ?? '');
    slot.textContent = binding ? shortcuts.format(binding) : '';
  });
}

function setStatus(message: string): void {
  document.querySelector<HTMLElement>('#status-message')!.textContent = message;
}

function showToast(message: string, error = false): void {
  const toast = document.querySelector<HTMLElement>('#app-toast')!;
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.remove('hidden');
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 3600);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const roiPicker = createRoiPicker({
  modal: roiPickerModal,
  title: roiPickerTitle,
  subtitle: roiPickerSubtitle,
  stage: roiPickerStage,
  image: roiPickerImage,
  selection: roiPickerSelection,
  hint: roiPickerHint,
  cancelButton: roiPickerCancel,
  confirmButton: roiPickerConfirm,
  closeButton: roiPickerClose,
  postToFrame,
  showToast,
  errorMessage,
  saveTemplate: (request) => api.saveTemplate(request),
});

function setDirty(value: boolean): void {
  dirty = value;
  const activeTab = workflowTabs.find((tab) => tab.uri === currentUri);
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
  if (!currentUri || !text) return;
  const revision = ++autoSaveRevision;
  autoSavePending = { uri: currentUri, text, revision };
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
  if (!pending || pending.uri !== currentUri) return;

  autoSaveInFlight = true;
  const uri = pending.uri;
  try {
    setStatus('正在自动保存…');
    await api.saveWorkflow(uri, pending.text);
    if (uri === currentUri && pending.revision === autoSaveRevision) {
      currentText = pending.text;
      if (currentEditorInit) currentEditorInit.document.text = pending.text;
      setDirty(false);
      postToEditors({ type: 'workflowSaved' });
      setStatus('工作流已自动保存');
    }
  } catch (error) {
    if (uri === currentUri && pending.revision === autoSaveRevision) {
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
  const descriptor = bootstrap?.workflows.find((item) => item.uri === uri);
  if (descriptor) return (descriptor.id || descriptor.name).replace(/\.json$/i, '');
  const file = displayFileUri(uri).split(/[\\/]/).pop() || uri;
  return file.replace(/\.json$/i, '') || '工作流';
}

function workflowDescriptorForPath(relativePath: string): WorkflowDescriptor | undefined {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^workflows\//i, '').toLowerCase();
  return bootstrap?.workflows.find((workflow) => workflowReference(workflow).toLowerCase() === normalized);
}

function rememberCurrentWorkflowTab(): void {
  if (!currentUri) return;
  const tab = workflowTabs.find((item) => item.uri === currentUri);
  if (!tab) return;
  tab.text = currentText;
  tab.dirty = dirty;
  tab.backStack = [...backStack];
}

function readWorkflowSession(): WorkflowSession | undefined {
  const known = bootstrap?.workflows.map((workflow) => workflow.uri) ?? [];
  return reconcileWorkflowSession(parseWorkflowSession(window.onmyoji.readLayout(WORKFLOW_SESSION_KEY)), known);
}

function applyWorkflowSession(session: WorkflowSession): void {
  workflowTabs = session.tabs.map((tab) => ({
    uri: tab.uri,
    text: tab.text,
    dirty: tab.dirty,
    backStack: [...tab.backStack],
  }));
  restoreWorkflowUri = session.activeUri;
}

/** 把上次退出时的未保存内容先写盘，避免恢复后标记变干净却丢失改动。 */
async function flushRestoredEdits(): Promise<void> {
  for (const tab of workflowTabs) {
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
  if (workflowTabs.length === 0) return;
  rememberCurrentWorkflowTab();
  try {
    window.onmyoji.writeLayout(WORKFLOW_SESSION_KEY, serializeWorkflowSession(workflowTabs, currentUri || restoreWorkflowUri));
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

/** 工作流文件被重命名或移动后，把文档面板从旧 URI 迁到新 URI。 */
function relocateDocument(oldUri: string, newUri: string): void {
  if (!docking || !oldUri || oldUri === newUri) return;
  const wasActive = oldUri === currentUri;
  if (docking.isDocumentOpen(oldUri)) {
    closingDocuments.add(oldUri);
    docking.closeDocument(oldUri);
    closingDocuments.delete(oldUri);
  }
  documentRuntimes.delete(oldUri);
  if (!docking.isDocumentOpen(newUri)) docking.openDocument(newUri, workflowTabName(newUri));
  if (wasActive) currentUri = newUri;
  syncDocumentTabs();
}

/** 恢复布局后：关掉不再存在的文档面板，并为会话里的文档补齐面板。 */
function reconcileDocumentPanels(): void {
  if (!docking) return;
  const known = new Set(workflowTabs.map((tab) => tab.uri));
  for (const uri of docking.documentUris()) {
    if (known.has(uri)) continue;
    closingDocuments.add(uri);
    docking.closeDocument(uri);
    closingDocuments.delete(uri);
    documentRuntimes.delete(uri);
  }
  for (const tab of workflowTabs) {
    if (!docking.isDocumentOpen(tab.uri)) docking.openDocument(tab.uri, workflowTabName(tab.uri));
  }
  syncDocumentTabs();
}

/** 没有任何可打开的默认工作流时，至少保证有一个画布。 */
function ensureFallbackDocument(): void {
  if (workflowTabs.length > 0) return;
  const first = bootstrap?.workflows[0];
  if (first) void openWorkflowTab(first.uri);
}

/** 恢复默认布局：批量重建面板时抑制移除回调，随后按当前标签重新同步。 */
function resetDockLayout(): void {
  suppressDocumentRemoval = true;
  try {
    docking?.resetLayout();
    workbenchFrame?.resetLayout();
    sharedPanelDockBridge?.resetSurfaces();
  } finally {
    suppressDocumentRemoval = false;
  }
  syncDocumentTabs();
}

/** 把 workflowTabs 的未保存状态同步到原生 Dockview 标签。 */
function syncDocumentTabs(): void {
  for (const tab of workflowTabs) {
    const runtime = documentRuntimes.get(tab.uri);
    if (!runtime) continue;
    setDocumentPanelDirty(runtime.panelId, tab.dirty);
    docking?.dockviewApi.getPanel(runtime.panelId)?.api.setTitle(workflowTabName(tab.uri));
  }
  scheduleWorkflowSessionPersist();
}

/** 把当前激活画布的选中项/折叠状态写回运行时，切换文档时原样恢复。 */
function rememberActiveRuntimeState(): void {
  const runtime = activeRuntime();
  if (!runtime) return;
  runtime.sidebarNodes = sidebarNodes;
  runtime.sidebarVariables = sidebarVariables;
  runtime.selectedNode = selectedNode;
  runtime.selectedVariable = selectedVariable;
  runtime.selectedVariableScope = selectedVariableScope;
  runtime.collapsedTreeNodes = collapsedTreeNodes;
}

/** 把运行时的画布状态恢复到壳层全局，重新驱动结构树与详细信息。 */
function applyDocumentState(uri: string, tab: WorkflowDocumentTab, runtime: DocumentRuntime): void {
  currentUri = uri;
  currentText = tab.text;
  currentEditorInit = runtime.init;
  backStack = [...tab.backStack];
  editorReady = runtime.ready;
  sidebarNodes = runtime.sidebarNodes;
  sidebarVariables = runtime.sidebarVariables;
  selectedNode = runtime.selectedNode;
  selectedVariable = runtime.selectedVariable;
  selectedVariableScope = runtime.selectedVariableScope;
  collapsedTreeNodes = runtime.collapsedTreeNodes;
  if (runtime.init) {
    selectedInstance = runtime.init.selectedInstance;
    runtime.init.workflowTrail = workflowTrail();
    renderWorkflowSelect(runtime.init.workflows);
    renderInstances(runtime.init.instances, runtime.init.selectedInstance);
    postToFrame(detailsFrame, runtime.init as unknown as Record<string, unknown>);
  }
  document.querySelector<HTMLElement>('#document-path')!.textContent = displayFileUri(uri);
  setDirty(tab.dirty);
  overview.render();
  renderSidebar();
  if (runtime.inspectorSelection) {
    postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: runtime.inspectorSelection });
  }
  syncDocumentTabs();
}

/** 画布握手完成后下发它自己的初始化数据；同一文档的多个面板互不影响。 */
function sendDocumentInit(uri: string): void {
  const runtime = documentRuntimes.get(uri);
  if (!runtime?.ready || !runtime.init) return;
  if (uri === currentUri) runtime.init.workflowTrail = workflowTrail();
  postToFrame(runtime.frame, runtime.init as unknown as Record<string, unknown>);
  if (uri === currentUri) postToFrame(detailsFrame, runtime.init as unknown as Record<string, unknown>);
}

function displayFileUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    return decodeURIComponent(parsed.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1');
  } catch {
    return uri;
  }
}

function workflowTrail(): Array<{ uri: string; name: string }> {
  const uris = [...backStack, currentUri].filter(Boolean);
  return uris.map((uri) => {
    const descriptor = bootstrap?.workflows.find((item) => item.uri === uri);
    const file = displayFileUri(uri).split(/[\\/]/).pop() || '';
    return { uri, name: descriptor?.id || descriptor?.name?.replace(/\.json$/i, '') || file.replace(/\.json$/i, '') || '工作流' };
  });
}

function resolveWorkflow(reference: string): WorkflowDescriptor | undefined {
  if (!bootstrap) return undefined;
  const normalized = reference.trim().replace(/\\/g, '/').replace(/^workflows\//i, '');
  const withExtension = normalized.toLowerCase().endsWith('.json') ? normalized : `${normalized}.json`;
  return bootstrap.workflows.find((file) => {
    const candidate = workflowReference(file);
    return file.id === normalized || candidate === normalized || candidate === withExtension
      || candidate.endsWith(`/${normalized}`) || candidate.endsWith(`/${withExtension}`);
  });
}

function renderWorkflowSelect(workflows: WorkflowDescriptor[]): void {
  document.querySelector<HTMLElement>('#workflow-count')!.textContent = `${workflows.length} 个工作流`;
}

function openWorkflowInNewTab(uri: string): void {
  workbenchFrame?.show('workflow');
  void openWorkflowTab(uri);
}

function instanceLabel(instance: RuntimeInstance): string {
  return instance.displayName
    || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
}

function instanceLabelById(instanceId: string): string {
  const instance = runtimeInstances.find((item) => item.id === instanceId);
  return instance ? instanceLabel(instance) : instanceId;
}

function closeInstancePicker(restoreFocus = false): void {
  if (instanceMenu.hidden) return;
  instanceMenu.hidden = true;
  instancePicker.classList.remove('open');
  instanceSelect.setAttribute('aria-expanded', 'false');
  if (restoreFocus) instanceSelect.focus();
}

function positionInstanceMenu(): void {
  const triggerRect = instanceSelect.getBoundingClientRect();
  const menuWidth = Math.max(triggerRect.width, instanceMenu.offsetWidth, 92);
  const left = Math.min(
    Math.max(8, triggerRect.left),
    Math.max(8, window.innerWidth - menuWidth - 8),
  );
  instanceMenu.style.left = `${Math.round(left)}px`;
  instanceMenu.style.top = `${Math.round(triggerRect.bottom + 4)}px`;
  instanceMenu.style.minWidth = `${Math.round(triggerRect.width)}px`;
}

function updateInstancePicker(): void {
  const selected = runtimeInstances.find((instance) => instance.id === selectedInstance);
  instanceSelectLabel.textContent = selected ? instanceLabel(selected) : '未检测到运行实例';
  instanceSelect.disabled = runtimeInstances.length === 0;
  instanceSelect.setAttribute('aria-label', selected ? `运行实例：${instanceLabel(selected)}` : '运行实例');
  instanceMenu.querySelectorAll<HTMLButtonElement>('[data-instance-id]').forEach((option) => {
    const isSelected = option.dataset.instanceId === selectedInstance;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-selected', String(isSelected));
  });
}

function selectRuntimeInstance(instanceId: string, notify = true): void {
  if (!runtimeInstances.some((instance) => instance.id === instanceId)) return;
  selectedInstance = instanceId;
  updateInstancePicker();
  overview.renderInstances();
  closeInstancePicker();
  if (notify) desktopControl('selectInstance', selectedInstance);
}

function toggleInstancePicker(): void {
  if (instanceSelect.disabled) return;
  if (!instanceMenu.hidden) {
    closeInstancePicker();
    return;
  }
  // Keep the popup outside the toolbar's layout and stacking context. Dockview
  // reparents the workbench module while tabs change; a menu inside that module
  // can otherwise invalidate the toolbar paint layer when it receives focus.
  if (instanceMenu.parentElement !== document.body) document.body.appendChild(instanceMenu);
  instanceMenu.hidden = false;
  instancePicker.classList.add('open');
  instanceSelect.setAttribute('aria-expanded', 'true');
  positionInstanceMenu();
  instanceMenu.querySelector<HTMLButtonElement>(`[data-instance-id="${CSS.escape(selectedInstance)}"]`)?.focus();
}

function renderInstances(instances: RuntimeInstance[], requested = selectedInstance): void {
  runtimeInstances = instances;
  const options = instances.map((instance) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'instance-option';
    option.dataset.instanceId = instance.id;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    const label = document.createElement('span');
    label.className = 'instance-option-label';
    label.textContent = instanceLabel(instance);
    const check = document.createElement('span');
    check.className = 'instance-option-check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    option.append(label, check);
    option.addEventListener('click', () => selectRuntimeInstance(instance.id));
    return option;
  });
  const ids = new Set(instances.map((instance) => instance.id));
  selectedInstance = ids.has(requested) ? requested : instances[0]?.id ?? '';
  instanceMenu.replaceChildren(...options);
  closeInstancePicker();
  updateInstancePicker();
  overview.renderInstances();
  document.querySelector<HTMLElement>('#instance-count')!.textContent = instances.length > 0
    ? `${instances.length} 个实例`
    : '未检测到实例';
}

const referenceViewer = createReferenceViewer({
  getWorkbenchFrame: () => workbenchFrame,
  getReferenceGraph: (path) => api.getReferenceGraph(path),
  contentName,
  showToast,
  errorMessage,
});
function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * 把登记的路径解析成当前内容浏览器里的条目。
 * 用路径而不是条目对象，重命名/移动后仍能命中最新数据；找不到时回退到当前选中项。
 */
function performDeleteTarget(origin?: KeyboardEvent): boolean {
  const target = deleteTarget;
  if (!target) return false;
  if (target.kind === 'editor') {
    origin?.preventDefault();
    editorCommand('deleteSelection');
    return true;
  }
  if (target.kind === 'queue') {
    if (!overview.isSelected(target.rel)) {
      deleteTarget = undefined;
      return false;
    }
    if (overview.isRunning()) {
      showToast('队列运行中，无法移出脚本', true);
      return true;
    }
    origin?.preventDefault();
    deleteTarget = undefined;
    overview.selectQueueRow('');
    overview.updateSelection(target.rel, false);
    return true;
  }
  const item = contentBrowser.resolveDeleteTarget(target.path);
  if (!item) {
    deleteTarget = undefined;
    return false;
  }
  if (item.kind === 'folder' && (!item.path || contentBrowser.isRootFolder(item.path))) {
    showToast('项目根目录不能删除', true);
    return true;
  }
  origin?.preventDefault();
  deleteTarget = undefined;
  void contentBrowser.deleteItem(item);
  return true;
}

/** 桌面壳层的删除快捷键；没有登记目标时不拦截按键。 */
function handleDeleteShortcut(event: KeyboardEvent): boolean {
  if (!window.StudioShortcuts?.matchesById(event, 'global.delete')) return false;
  if (event.defaultPrevented) return false;
  if (isTextEditingTarget(event.target)) return false;
  if (roiPicker.isOpen() || contentBrowser.isNameDialogOpen()) return false;
  return performDeleteTarget(event);
}

/** 新的点击先作废上一次的删除目标，再由具体行/项的点击处理器重新登记。 */
function resetDeleteTargetOnPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  deleteTarget = undefined;
}

type IconComponent = typeof Box;

/** 结构树节点类型 → Lucide 图标与语义色（保持低饱和，遵循设计规则）。 */
const treeNodeGlyphs: Record<string, { icon: IconComponent; className: string }> = {
  root: { icon: Flag, className: 'type-root' },
  sequence: { icon: ListTree, className: 'type-sequence' },
  selector: { icon: GitBranch, className: 'type-selector' },
  simple_parallel: { icon: Columns3, className: 'type-parallel' },
  instance_parallel: { icon: MonitorUp, className: 'type-instance-parallel' },
  task: { icon: Workflow, className: 'type-task' },
};
const treeNodeFallbackGlyph = { icon: CircleDot, className: 'type-default' };

/** 工作流变量类型 → 图标；颜色由类型 class 统一控制。 */
const variableTypeGlyphs: Record<string, { icon: IconComponent; className: string }> = {
  string: { icon: Type, className: 'type-string' },
  number: { icon: Sigma, className: 'type-number' },
  integer: { icon: Hash, className: 'type-integer' },
  boolean: { icon: ToggleLeft, className: 'type-boolean' },
  rect: { icon: Scan, className: 'type-rect' },
  asset: { icon: Image, className: 'type-asset' },
  path: { icon: Folder, className: 'type-path' },
  array: { icon: List, className: 'type-array' },
  object: { icon: Braces, className: 'type-object' },
  any: { icon: CircleHelp, className: 'type-any' },
};
const variableTypeFallbackGlyph = { icon: CircleHelp, className: 'type-any' };
const variableTypeLabels: Record<string, string> = {
  string: '文本', number: '数值', integer: '整数', boolean: '布尔', rect: '区域',
  asset: '资源', path: '路径', array: '列表', object: '对象', any: '任意',
};

/** 内联创建 Lucide SVG，供动态树行使用（data-lucide + createIcons 无法覆盖局部更新）。 */
function createTreeIcon(icon: IconComponent, className: string): SVGSVGElement {
  return createElement(icon, { width: '14', height: '14', 'aria-hidden': 'true', class: className }) as SVGSVGElement;
}

function createTreeRows(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const byId = new Map(sidebarNodes.map((node) => [node.id, node]));
  const childIds = new Set(sidebarNodes.flatMap((node) => node.children));
  const roots = sidebarNodes.filter((node) => !childIds.has(node.id));
  const visited = new Set<string>();

  const appendNode = (node: SidebarNode, depth: number, container: ParentNode & { append: (parent: Node) => void }): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const glyph = treeNodeGlyphs[node.type] ?? treeNodeFallbackGlyph;
    const hasChildren = node.children.some((childId) => byId.has(childId));
    const branchOpen = hasChildren && !collapsedTreeNodes.has(node.id);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `tree-row${node.id === selectedNode ? ' selected' : ''}`;
    row.title = `${node.name}\n${node.meta}\nDelete 删除该节点`;
    row.dataset.nodeId = node.id;
    if (hasChildren) row.setAttribute('aria-expanded', String(branchOpen));

    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron';
    if (hasChildren) chevron.appendChild(createTreeIcon(ChevronRight, 'chevron-closed'));

    const icon = document.createElement('span');
    icon.className = `node-type-glyph ${glyph.className}`;
    icon.appendChild(createTreeIcon(glyph.icon, 'glyph-svg'));

    const label = document.createElement('span');
    label.className = 'tree-label';

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;

    const meta = document.createElement('span');
    meta.className = 'tree-meta';
    meta.textContent = node.meta;

    const children = document.createElement('div');
    children.className = 'tree-children';

    label.append(name, meta);
    row.append(chevron, icon, label);
    const count = document.createElement('span');
    count.className = 'tree-child-count';
    const childCount = node.children.filter((childId) => byId.has(childId)).length;
    count.textContent = childCount ? String(childCount) : '';
    if (childCount) count.title = `${childCount} 个直接子节点`;
    row.appendChild(count);
    row.addEventListener('click', (event) => {
      if (hasChildren && event.target instanceof Node && chevron.contains(event.target)) {
        toggleTreeNode(node.id, row, children);
        return;
      }
      docking?.showPanel('details');
      editorCommand('focusNode', node.id);
      // 结构树选中即等价于画布选中：Delete 交由画布执行删除。
      deleteTarget = { kind: 'editor' };
    });
    container.append(row, children);
    if (hasChildren) {
      if (branchOpen) row.classList.add('open');
      else children.classList.add('closed');
      for (const childId of node.children) {
        const child = byId.get(childId);
        if (child) appendNode(child, depth + 1, children);
      }
    }
  };
  for (const root of roots) appendNode(root, 0, fragment);
  for (const node of sidebarNodes) appendNode(node, 0, fragment);
  return fragment;
}

/** 展开/收起单个结构树分支（状态记录在 collapsedTreeNodes，重渲染后保持）。 */
function toggleTreeNode(nodeId: string, row: HTMLButtonElement, children: HTMLElement): void {
  const open = row.classList.toggle('open');
  children.classList.toggle('closed', !open);
  if (open) collapsedTreeNodes.delete(nodeId);
  else collapsedTreeNodes.add(nodeId);
  row.setAttribute('aria-expanded', String(open));
}

function setAllTreeBranches(open: boolean): void {
  collapsedTreeNodes = open ? new Set() : new Set(collectAllBranchNodeIds());
  structureView.querySelectorAll<HTMLButtonElement>('.tree-row').forEach((row) => {
    if (!hasTreeChildren(row)) return;
    row.classList.toggle('open', open);
    row.setAttribute('aria-expanded', String(open));
  });
  structureView.querySelectorAll<HTMLElement>('.tree-children').forEach((children) => {
    children.classList.toggle('closed', !open);
  });
}

function collectAllBranchNodeIds(): Set<string> {
  return new Set(sidebarNodes.filter((node) => node.children.length > 0).map((node) => node.id));
}

function hasTreeChildren(row: HTMLButtonElement): boolean {
  return Boolean(row.nextElementSibling?.classList.contains('tree-children')
    && row.nextElementSibling.childElementCount > 0);
}

/** 结构树内容指纹：id、子级、名称、类型、meta 都没变时无需重建 DOM。 */
function treeSignature(): string {
  return sidebarNodes.map((node) => `${node.id}\u0001${node.type}\u0001${node.name}\u0001${node.meta}\u0002${node.children.join('\u0003')}`).join('\u0004');
}

/** 仅更新结构树选中行（含祖先），不重建 DOM，保持滚动位置与展开状态。 */
function syncTreeSelection(previousNode: string): void {
  if (previousNode === selectedNode) return;
  const view = structureView;
  if (previousNode) {
    const previousRow = view.querySelector<HTMLButtonElement>(`.tree-row[data-node-id="${CSS.escape(previousNode)}"]`);
    if (previousRow) previousRow.classList.remove('selected');
  }
  if (!selectedNode) return;
  const nextRow = view.querySelector<HTMLButtonElement>(`.tree-row[data-node-id="${CSS.escape(selectedNode)}"]`);
  if (!nextRow) return;
  nextRow.classList.add('selected');
  // 保证选中的行自身可见：仅展开其祖先链，不动其他手动折叠的分支。
  for (let parent = nextRow.parentElement; parent && parent !== view; parent = parent.parentElement) {
    if (parent.classList.contains('tree-children') && parent.classList.contains('closed')) {
      parent.classList.remove('closed');
      const branchRow = parent.previousElementSibling as HTMLElement | null;
      branchRow?.classList.add('open');
      if (branchRow?.dataset.nodeId) collapsedTreeNodes.delete(branchRow.dataset.nodeId);
    }
  }
  const rowRect = nextRow.getBoundingClientRect();
  const viewRect = view.getBoundingClientRect();
  if (rowRect.bottom < viewRect.top || rowRect.top > viewRect.bottom) {
    nextRow.scrollIntoView({ block: 'nearest' });
  }
}

/** 仅更新变量列表选中行，避免整体重建导致滚动跳动。 */
function syncVariableSelection(previousVariable: string, previousScope: 'inputs' | 'variables'): void {
  if (previousVariable === selectedVariable && previousScope === selectedVariableScope) return;
  const previousRow = variablesView.querySelector<HTMLButtonElement>(`.variable-row[data-variable-scope="${previousScope}"][data-variable-name="${CSS.escape(previousVariable)}"]`);
  if (previousRow) { previousRow.classList.remove('selected'); previousRow.setAttribute('aria-pressed', 'false'); }
  const nextRow = variablesView.querySelector<HTMLButtonElement>(`.variable-row[data-variable-scope="${selectedVariableScope}"][data-variable-name="${CSS.escape(selectedVariable)}"]`);
  nextRow?.classList.add('selected');
  nextRow?.setAttribute('aria-pressed', 'true');
}

/** 输入与状态列表内容指纹。 */
function variableSignature(): string {
  return sidebarVariables.map((variable) => `${variable.scope}\u0001${variable.name}\u0001${variable.type}\u0001${variable.displayName || ''}\u0001${variable.group || ''}\u0001${variable.public ? '1' : '0'}\u0001${variable.onCard ? '1' : '0'}`).join('\u0004');
}

function renderVariables(): void {
  const keepScroll = variablesView.scrollTop;
  const groupView = variablesView as HTMLElement & { collapsedGroups?: Set<string> };
  const collapsed = groupView.collapsedGroups ||= new Set<string>();
  variablesView.replaceChildren();
  if (sidebarVariables.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'variable-group-empty';
    empty.textContent = '暂无变量 · 点击上方「＋ 变量」添加';
    variablesView.appendChild(empty);
  }
  const groups = new Map<string, SidebarVariable[]>();
  for (const variable of sidebarVariables) {
    const group = variable.group || '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(variable);
  }
  for (const [group, members] of groups) {
    const groupKey = group;
    if (group || groups.size > 1) {
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'variable-category-toggle';
      toggle.textContent = `${collapsed.has(groupKey) ? '▸' : '▾'} ${group || '未分组'} · ${members.length}`;
      toggle.setAttribute('aria-expanded', String(!collapsed.has(groupKey)));
      toggle.addEventListener('click', () => {
        if (collapsed.has(groupKey)) collapsed.delete(groupKey); else collapsed.add(groupKey);
        renderVariables();
      });
      variablesView.appendChild(toggle);
    }
    for (const variable of members) {
    const scope = variable.scope;
    const row = document.createElement('button');
    row.type = 'button';
    row.hidden = collapsed.has(groupKey);
    row.className = `variable-row scope-${scope}${variable.name === selectedVariable && scope === selectedVariableScope ? ' selected' : ''}`;
    row.setAttribute('aria-pressed', String(variable.name === selectedVariable && scope === selectedVariableScope));
    row.title = `${variable.displayName || overviewInputDisplayName(variable.name)} (${variable.name})\n类型：${variable.type}\n${variable.public ? '公开：引用此流程的节点可见' : '私有：仅流程内部使用'}${variable.onCard ? '\n已连接：画布上已有端口引用它' : ''}\n拖到画布可创建引用卡片\nDelete 删除该变量`;
    row.dataset.variableName = variable.name;
    row.dataset.variableScope = scope;
    row.innerHTML = '<span class="variable-icon"></span><span class="variable-name"></span><span class="variable-flags"></span>';
    const variableGlyph = variableTypeGlyphs[variable.type.toLowerCase()] ?? variableTypeFallbackGlyph;
    const icon = row.querySelector<HTMLElement>('.variable-icon')!;
    icon.classList.add(variableGlyph.className);
    icon.appendChild(createTreeIcon(variableGlyph.icon, 'variable-icon-svg'));
    const nameNode = row.querySelector<HTMLElement>('.variable-name')!;
    nameNode.textContent = variable.displayName || overviewInputDisplayName(variable.name);
    if (variable.onCard) {
      // 变量已经连在某个节点卡片端口上：在名字后标出“已连接”，避免看起来像是没用上。
      const onCard = document.createElement('span');
      onCard.className = 'variable-on-card';
      onCard.textContent = '已连接';
      onCard.title = '画布上的节点端口已经引用该变量';
      nameNode.appendChild(onCard);
    }
    const flags = row.querySelector<HTMLElement>('.variable-flags')!;
    flags.textContent = variableTypeLabels[variable.type.toLowerCase()] ?? variable.type;
    flags.title = variable.type;
    const eye = document.createElement('span');
    eye.className = `variable-eye${variable.public ? '' : ' off'}`;
    eye.setAttribute('aria-hidden', 'true');
    eye.appendChild(createTreeIcon(variable.public ? Eye : EyeOff, 'variable-eye-svg'));
    if (scope === 'variables') {
      eye.classList.add('toggle');
      eye.title = variable.public
        ? '公开：父流程可设置它的初始值（点击取消公开）'
        : '私有：仅流程内部使用（点击公开并生成初始值输入）';
      eye.addEventListener('click', (event) => {
        event.stopPropagation();
        editorCommand('setVariablePublic', { name: variable.name, scope, public: !variable.public });
      });
    } else {
      eye.classList.add('fixed');
      eye.title = '工作流输入默认公开，父流程可直接传值';
    }
    row.appendChild(eye);
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      transfer.setData('application/x-onmyoji-variable', JSON.stringify({ name: variable.name, scope }));
      transfer.effectAllowed = 'copy';
    });
    row.addEventListener('click', () => {
      docking?.showPanel('details');
      editorCommand('selectVariable', { name: variable.name, scope });
      // 变量行选中即等价于画布选中该变量：Delete 交由画布执行删除。
      deleteTarget = { kind: 'editor' };
    });
    variablesView.appendChild(row);
    }
  }
  variablesView.scrollTop = keepScroll;
}

function renderSidebar(): void {
  const keepScroll = structureView.scrollTop;
  structureView.replaceChildren();
  if (sidebarNodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel';
    empty.textContent = '打开工作流后显示节点结构';
    structureView.appendChild(empty);
  } else {
    structureView.appendChild(createTreeRows());
  }
  structureView.scrollTop = keepScroll;
  renderVariables();
  createIcons({ icons: desktopIcons, root: structureView });
}

/** 确保工作流文档存在标签与 Dockview 面板，新面板默认成为激活项。 */
function ensureDocument(uri: string): WorkflowDocumentTab {
  let tab = workflowTabs.find((item) => item.uri === uri);
  if (!tab) {
    tab = { uri, text: '', dirty: false, backStack: [] };
    workflowTabs.push(tab);
  }
  if (docking && !docking.isDocumentOpen(uri)) docking.openDocument(uri, workflowTabName(uri));
  syncDocumentTabs();
  return tab;
}

async function loadWorkflow(uri: string): Promise<void> {
  if (!uri) return;
  const tab = ensureDocument(uri);
  rememberCurrentWorkflowTab();
  rememberActiveRuntimeState();
  cancelAutoSave();
  await waitForAutoSave();
  backStack = [...tab.backStack];
  loadingMask.classList.remove('hidden');
  try {
    const init = await api.getWorkflowInit(uri, selectedInstance, backStack.length > 0);
    const documentText = tab.text || init.document.text;
    init.document.text = documentText;
    if (init.document.uri !== currentUri) collapsedTreeNodes = new Set();
    currentUri = init.document.uri;
    currentText = documentText;
    currentEditorInit = init;
    tab.backStack = [...backStack];
    selectedInstance = init.selectedInstance;
    if (bootstrap) {
      bootstrap.workflows = init.workflows;
      bootstrap.instances = init.instances;
    }
    const runtime = documentRuntimes.get(uri);
    if (runtime) {
      runtime.init = init;
      runtime.sidebarNodes = [];
      runtime.sidebarVariables = [];
      runtime.selectedNode = '';
      runtime.selectedVariable = '';
      runtime.collapsedTreeNodes = collapsedTreeNodes;
      runtime.inspectorSelection = undefined;
    }
    editorReady = runtime?.ready ?? false;
    sidebarNodes = [];
    sidebarVariables = [];
    selectedNode = '';
    selectedVariable = '';
    renderWorkflowSelect(init.workflows);
    renderInstances(init.instances, init.selectedInstance);
    overview.reconcileSelection();
    overview.render();
    contentBrowser.render();
    document.querySelector<HTMLElement>('#document-path')!.textContent = displayFileUri(init.document.uri);
    setDirty(tab.dirty);
    renderSidebar();
    postToFrame(detailsFrame, init as unknown as Record<string, unknown>);
    sendDocumentInit(uri);
    setStatus(init.issues.length > 0 ? `${init.issues.length} 个校验问题` : '工作流已载入');
  } catch (error) {
    showToast(errorMessage(error), true);
    setStatus('载入失败');
  } finally {
    loadingMask.classList.add('hidden');
  }
}

const documentLoads = new Map<string, Promise<void>>();

/** 同一文档的加载只跑一次，标签激活与显式打开共享同一个 Promise。 */
function loadDocumentOnce(uri: string): Promise<void> {
  const pending = documentLoads.get(uri);
  if (pending) return pending;
  const load = loadWorkflow(uri).finally(() => documentLoads.delete(uri));
  documentLoads.set(uri, load);
  return load;
}

let activatingUri: string | undefined;

async function activateWorkflowTab(uri: string): Promise<void> {
  if (!uri) return;
  const tab = workflowTabs.find((item) => item.uri === uri);
  if (!tab) return;
  if (uri === currentUri) {
    syncDocumentTabs();
    return;
  }
  if (activatingUri === uri) return;
  activatingUri = uri;
  try {
    docking?.focusDocument(uri);
    rememberCurrentWorkflowTab();
    rememberActiveRuntimeState();
    cancelAutoSave();
    await waitForAutoSave();
    const runtime = documentRuntimes.get(uri);
    if (runtime?.init) {
      applyDocumentState(uri, tab, runtime);
      sendDocumentInit(uri);
      return;
    }
    await loadDocumentOnce(uri);
  } finally {
    activatingUri = undefined;
  }
}

async function openWorkflowTab(uri: string): Promise<void> {
  if (!uri) return;
  ensureDocument(uri);
  docking?.focusDocument(uri);
  await activateWorkflowTab(uri);
}

/** Dockview 面板被移除（关闭按钮、右键菜单或快捷键）后的收尾：保存、清状态、补默认画布。 */
async function handleDocumentRemoved(uri: string): Promise<void> {
  closingDocuments.delete(uri);
  if (suppressDocumentRemoval) {
    documentRuntimes.delete(uri);
    return;
  }
  removingDocument = true;
  try {
    const tab = workflowTabs.find((item) => item.uri === uri);
    if (!tab) {
      unregisterDocumentFrame(documentRuntimes.get(uri)?.panelId ?? '');
      documentRuntimes.delete(uri);
      return;
    }
    const index = workflowTabs.indexOf(tab);
    const wasActive = uri === currentUri;
    // 关闭的是当前文档时先把全局最新内容写回它自己的记录，避免受邻居激活影响。
    if (wasActive) rememberCurrentWorkflowTab();
    try {
      if (tab.dirty && tab.text) {
        await api.saveWorkflow(uri, tab.text);
        tab.dirty = false;
      }
    } catch (error) {
      showToast(`关闭工作流失败：${errorMessage(error)}`, true);
    }
    documentRuntimes.delete(uri);
    workflowTabs.splice(index, 1);
    removingDocument = false;
    if (workflowTabs.length === 0) {
      const fallback = bootstrap?.defaultWorkflow;
      if (fallback) await openWorkflowTab(fallback);
      else syncDocumentTabs();
      return;
    }
    if (wasActive) await activateWorkflowTab(workflowTabs[Math.min(index, workflowTabs.length - 1)].uri);
    else syncDocumentTabs();
  } finally {
    removingDocument = false;
  }
}

async function closeWorkflowTab(uri: string): Promise<void> {
  if (workflowTabs.length <= 1) {
    showToast('至少保留一个工作流画布');
    return;
  }
  if (!workflowTabs.some((tab) => tab.uri === uri)) return;
  closingDocuments.add(uri);
  docking?.closeDocument(uri);
  if (closingDocuments.has(uri)) {
    // 面板没有同步触发移除（例如还未渲染），退回到手动收尾。
    closingDocuments.delete(uri);
    await handleDocumentRemoved(uri);
  }
}

async function refreshInstances(): Promise<void> {
  try {
    const instances = await api.listInstances();
    renderInstances(instances, selectedInstance);
    overview.render();
    postToAllEditors({ type: 'runtimeInstances', instances, selectedInstance });
  } catch {
    // Device discovery is best effort while the user edits offline.
  }
}

async function handleEditorMessage(message: Record<string, unknown>, sourceFrame: HTMLIFrameElement): Promise<void> {
  const type = String(message.type ?? '');
  const sourceUri = documentFrameUris.get(sourceFrame);
  const runtime = sourceUri ? documentRuntimes.get(sourceUri) : undefined;
  const isActiveSource = Boolean(sourceUri && sourceUri === currentUri);
  try {
    if (type === 'ready') {
      if (sourceFrame === detailsFrame) {
        if (currentEditorInit) postToFrame(detailsFrame, currentEditorInit as unknown as Record<string, unknown>);
        return;
      }
      if (!runtime || !sourceUri) return;
      runtime.ready = true;
      if (runtime.init) {
        sendDocumentInit(sourceUri);
        return;
      }
      if (sourceUri === currentUri || (!currentUri && sourceUri === restoreWorkflowUri)) await loadDocumentOnce(sourceUri);
      return;
    }
    if (type === 'createVariableNode') {
      if (message.scope !== 'inputs' && message.scope !== 'variables') return;
      postToFrame(sourceFrame, { type: 'editorCommand', command: 'addVariableCard', value: { name: String(message.name || ''), scope: message.scope } });
      return;
    }
    if (type === 'documentStateChanged') {
      const text = String(message.text ?? '');
      if (!text) return;
      const tab = workflowTabs.find((item) => item.uri === (sourceUri ?? currentUri));
      if (tab) tab.text = text;
      if (runtime?.init) runtime.init.document.text = text;
      if (isActiveSource || !sourceUri) {
        currentText = text;
        if (currentEditorInit) currentEditorInit.document.text = text;
        setDirty(message.dirty !== false);
        scheduleAutoSave(text);
        postToFrame(detailsFrame, { type: 'replaceDocument', text, recordHistory: true });
      } else if (tab) {
        tab.dirty = message.dirty !== false;
        syncDocumentTabs();
      }
      return;
    }
    if (type === 'inspectorRequested') {
      if (!isActiveSource && sourceUri) return;
      const selection = message.inspectorSelection as unknown as InspectorSelection;
      if (runtime) runtime.inspectorSelection = selection;
      docking?.showPanel('details');
      postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
      return;
    }
    if (type === 'sidebarStateChanged') {
      if (!runtime || (!isActiveSource && sourceUri)) return;
      const previousTreeSignature = treeSignature();
      const previousVariableSignature = variableSignature();
      const previousSelectedNode = selectedNode;
      const previousSelectedVariable = selectedVariable;
      const previousSelectedVariableScope = selectedVariableScope;
      sidebarVariables = Array.isArray(message.variables) ? message.variables as SidebarVariable[] : [];
      sidebarNodes = Array.isArray(message.nodes) ? message.nodes as SidebarNode[] : [];
      selectedVariable = typeof message.selectedVariable === 'string' ? message.selectedVariable : '';
      selectedVariableScope = message.selectedVariableScope === 'variables' ? 'variables' : 'inputs';
      selectedNode = typeof message.selectedNode === 'string' ? message.selectedNode : '';
      const selection = message.inspectorSelection as unknown as InspectorSelection | undefined;
      if (selection) runtime.inspectorSelection = selection;
      const treeUnchanged = sidebarNodes.length > 0 && treeSignature() === previousTreeSignature;
      const variablesUnchanged = variableSignature() === previousVariableSignature;
      if (treeUnchanged && variablesUnchanged) {
        // 结构与变量都没变（如仅在画布上切换选中节点）：只更新选中行，不重建树，
        // 展开状态、折叠状态与滚动位置都原样保留。
        syncTreeSelection(previousSelectedNode);
        syncVariableSelection(previousSelectedVariable, previousSelectedVariableScope);
      } else if (treeUnchanged) {
        // 结构没变但变量列表变了：仅重建变量列表。
        renderVariables();
      } else {
        renderSidebar();
      }
      if (selection && selection.kind !== 'none') {
        docking?.showPanel('details');
        postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
      } else if (selection?.kind === 'none') {
        postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
      }
      return;
    }
    if (type === 'save') {
      const targetUri = sourceUri ?? currentUri;
      const tab = workflowTabs.find((item) => item.uri === targetUri);
      const text = String(message.text ?? tab?.text ?? '');
      cancelAutoSave();
      await waitForAutoSave();
      await api.saveWorkflow(targetUri, text);
      if (tab) {
        tab.text = text;
        tab.dirty = false;
      }
      if (runtime?.init) runtime.init.document.text = text;
      if (targetUri === currentUri) {
        currentText = text;
        if (currentEditorInit) currentEditorInit.document.text = text;
        setDirty(false);
      } else {
        syncDocumentTabs();
      }
      postToEditors({ type: 'workflowSaved' });
      setStatus('工作流已保存');
      showToast('工作流已保存');
      return;
    }
    if (type === 'switchWorkflow') {
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      await switchWorkflow(String(message.uri ?? ''));
      return;
    }
    if (type === 'openSubWorkflow') {
      cancelAutoSave();
      await waitForAutoSave();
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      const reference = String(message.reference ?? '').trim();
      let resolved = reference ? resolveWorkflow(reference) : undefined;
      if (!resolved && typeof message.nodeId === 'string') {
        const source = JSON.parse(currentText) as { nodes?: Array<{ id?: string; action?: string; params?: { workflow?: string } }> };
        const node = source.nodes?.find((item) => item.id === message.nodeId && item.action === 'workflow.run');
        if (node?.params?.workflow) resolved = resolveWorkflow(node.params.workflow);
      }
      if (!resolved) throw new Error(`未找到子工作流：${reference || message.nodeId || ''}`);
      const parent = workflowTabs.find((item) => item.uri === currentUri);
      const target = ensureDocument(resolved.uri);
      target.backStack = [...(parent?.backStack ?? []), currentUri];
      await openWorkflowTab(resolved.uri);
      return;
    }
    if (type === 'goBackWorkflow') {
      cancelAutoSave();
      await waitForAutoSave();
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      const previous = backStack.pop();
      if (previous) await openWorkflowTab(previous);
      return;
    }
    if (type === 'navigateWorkflowTrail') {
      const index = Number(message.index);
      const trail = [...backStack, currentUri];
      if (!Number.isInteger(index) || index < 0 || index >= trail.length - 1) return;
      cancelAutoSave();
      await waitForAutoSave();
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      const target = ensureDocument(trail[index]);
      target.backStack = trail.slice(0, index);
      await openWorkflowTab(trail[index]);
      return;
    }
    if (type === 'reloadRequest') {
      if (currentUri) await loadWorkflow(currentUri);
      return;
    }
    if (type === 'runWorkflow') {
      const text = String(message.text ?? currentText);
      currentText = text;
      await api.runWorkflow({ uri: currentUri, instanceId: String(message.instanceId ?? selectedInstance), text });
      if (sharedPanelDockBridge) sharedPanelDockBridge.show('runtime');
      else docking?.showPanel('runtime');
      return;
    }
    if (type === 'stopWorkflow') {
      await api.stopWorkflow();
      return;
    }
    if (type === 'selectInstance') {
      selectRuntimeInstance(String(message.instanceId ?? selectedInstance), false);
      postToAllEditors({ type: 'instanceSelected', instanceId: selectedInstance });
      return;
    }
    if (type === 'pickRoi') {
      const referenceResolution: [number, number] = Array.isArray(message.referenceResolution)
        ? message.referenceResolution as [number, number]
        : [1920, 1080];
      const result = await api.captureRoi({ instanceId: String(message.instanceId ?? selectedInstance), referenceResolution });
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
    if (type === 'checkTemplate') {
      const result = await api.checkTemplate({
        template: String(message.template ?? ''),
        roi: Array.isArray(message.roi) ? message.roi as [number, number, number, number] : undefined,
        threshold: Number(message.threshold ?? .85),
        maxResults: Number(message.maxResults ?? 20),
        scaleSearch: Boolean(message.scaleSearch),
        referenceResolution: Array.isArray(message.referenceResolution) ? message.referenceResolution as [number, number] : [1920, 1080],
        instanceId: String(message.instanceId ?? selectedInstance),
      });
      postToFrame(sourceFrame, { type: 'templateCheckResult', requestId: message.requestId, ...result });
      return;
    }
    if (type === 'listAssetImages') {
      postToFrame(sourceFrame, { type: 'assetImages', requestId: message.requestId, images: await api.listAssets() });
      return;
    }
    if (type === 'requestAssetData') {
      const paths = Array.isArray(message.paths) ? message.paths.map(String) : [];
      postToFrame(sourceFrame, { type: 'assetData', requestId: message.requestId, items: await api.readAssetData(paths) });
      return;
    }
    if (type === 'saveTemplate') {
      const savedPath = await api.saveTemplate({
        targetPath: typeof message.targetPath === 'string' ? message.targetPath : undefined,
        filename: String(message.filename ?? 'template.png'),
        dataUrl: String(message.dataUrl ?? ''),
      });
      postToFrame(sourceFrame, { type: 'templateSaved', requestId: message.requestId, nodeId: message.nodeId ?? message.stepId, key: message.key, path: savedPath });
      return;
    }
    if (type === 'saveCanvasImage') {
      const savedPath = await api.saveCanvas({ filename: String(message.filename ?? 'workflow-layout.png'), dataUrl: String(message.dataUrl ?? '') });
      postToFrame(sourceFrame, savedPath ? { type: 'canvasImageSaved', path: savedPath } : { type: 'canvasImageCancelled' });
      return;
    }
    if (type === 'newWorkflow') {
      await createNewWorkflow();
      return;
    }
    if (type === 'openFile') {
      await api.openWorkflowFile(currentUri);
      return;
    }
    if (type === 'openWorkflowPicker') {
      sharedPanelDockBridge?.show('contentBrowser');
      window.setTimeout(() => contentBrowser.focusSearch(), 0);
      return;
    }
    if (type === 'openWorkflowTree') {
      showToast('结构树已显示在左侧');
      return;
    }
    if (type === 'openReferences') {
      if (!currentUri) {
        showToast('请先打开一个工作流再查看引用', true);
        return;
      }
      const relative = relativeToProject(displayFileUri(currentUri));
      if (relative) referenceViewer.open(relative, document);
      else showToast('无法定位当前工作流的项目路径', true);
      return;
    }
    if (type === 'error') throw new Error(String(message.message ?? '编辑器错误'));
  } catch (error) {
    const text = errorMessage(error);
    if (type === 'save') postToEditors({ type: 'workflowSaveFailed' });
    if (type === 'pickRoi' || type === 'saveTemplate') postToFrame(sourceFrame, { type: 'roiPickerError', requestId: message.requestId, message: text });
    else if (type === 'checkTemplate') postToFrame(sourceFrame, { type: 'templateCheckError', requestId: message.requestId, message: text });
    else if (type === 'listAssetImages') postToFrame(sourceFrame, { type: 'assetImagesError', requestId: message.requestId, message: text });
    else if (type === 'requestAssetData') postToFrame(sourceFrame, { type: 'assetDataError', requestId: message.requestId, message: text });
    else if (type === 'saveCanvasImage') postToFrame(sourceFrame, { type: 'canvasImageError', message: text });
    showToast(text, true);
    setStatus('操作失败');
  }
}

function decodePathLabel(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function updateRuntimeState(event: RuntimeStateEvent): void {
  runtimeBusy = event.state === 'running' || event.state === 'stopping';
  if (event.state === 'running') {
    const workflow = decodePathLabel(String(event.workflow || currentUri).replace(/\\/g, '/').split('/').pop() || '工作流');
    runtimeLog.beginRun({
      workflow,
      instance: event.sources?.length ? `${event.sources.length} 个实例` : instanceLabelById(event.instance || selectedInstance),
      startedAt: event.startedAt ?? Date.now(),
      status: 'running',
      sources: event.sources,
    });
  } else if (event.state === 'succeeded' || event.state === 'failed' || event.state === 'idle') {
    runtimeLog.finishRun({
      code: event.exitCode ?? (event.state === 'failed' ? -1 : 0),
      signal: null,
      stopped: event.state === 'idle',
    });
  }
  document.querySelector<HTMLButtonElement>('#run-button')!.disabled = runtimeBusy || Boolean(overview.isRunning());
  document.querySelector<HTMLButtonElement>('#stop-button')!.disabled = !runtimeBusy && !overview.isRunning();
  overview.handleRuntimeState(event);
  overview.render();
  setStatus(event.label);
}

function updateMaximizedState(maximized: boolean): void {
  const button = document.querySelector<HTMLButtonElement>('#window-maximize')!;
  const menuButton = document.querySelector<HTMLButtonElement>('#menu-window-maximize')!;
  button.title = maximized ? '还原' : '最大化';
  button.setAttribute('aria-label', maximized ? '还原' : '最大化');
  button.classList.toggle('maximized', maximized);
  button.innerHTML = `<i data-lucide="${maximized ? 'copy' : 'square'}"></i>`;
  menuButton.firstElementChild!.textContent = maximized ? '还原' : '最大化';
  createIcons({ icons: desktopIcons, root: button });
}

function closeMoreMenu(): void {
  if (!moreMenu) return;
  document.removeEventListener('pointerdown', moreMenu.dismiss, true);
  document.removeEventListener('keydown', moreMenu.keyHandler, true);
  window.removeEventListener('resize', closeMoreMenu);
  window.removeEventListener('scroll', closeMoreMenu, true);
  moreMenu.menu.remove();
  moreMenu = undefined;
  document.querySelector<HTMLButtonElement>('#more-button')?.setAttribute('aria-expanded', 'false');
}

function showMoreMenu(button: HTMLButtonElement): void {
  closeMoreMenu();
  const menu = document.createElement('div');
  menu.className = 'desktop-more-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '更多操作');

  const actions: Array<{ label: string; type: string } | 'separator'> = [
    { label: '新建工作流', type: 'newWorkflow' },
    { label: '选择其他工作流…', type: 'openWorkflowPicker' },
    { label: '打开 JSON', type: 'openFile' },
    'separator',
    { label: '在结构树窗口查看', type: 'openWorkflowTree' },
    'separator',
    { label: '查看引用', type: 'openReferences' },
    'separator',
    { label: '重新加载', type: 'reloadRequest' },
  ];
  for (const action of actions) {
    if (action === 'separator') {
      const separator = document.createElement('div');
      separator.className = 'desktop-more-separator';
      separator.setAttribute('role', 'separator');
      menu.appendChild(separator);
      continue;
    }
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.setAttribute('role', 'menuitem');
    entry.textContent = action.label;
    entry.addEventListener('click', () => {
      closeMoreMenu();
      const frame = activeRuntime()?.frame;
      if (frame) void handleEditorMessage({ type: action.type }, frame);
    });
    menu.appendChild(entry);
  }

  document.body.appendChild(menu);
  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const left = Math.min(
    Math.max(margin, buttonRect.right - menuRect.width),
    Math.max(margin, viewportWidth - menuRect.width - margin),
  );
  const top = Math.min(
    Math.max(margin, buttonRect.bottom + 4),
    Math.max(margin, viewportHeight - menuRect.height - margin),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const dismiss = (event: Event): void => {
    if (menu.contains(event.target as Node) || event.target === button) return;
    closeMoreMenu();
  };
  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeMoreMenu();
  };
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', keyHandler, true);
  window.addEventListener('resize', closeMoreMenu);
  window.addEventListener('scroll', closeMoreMenu, true);
  moreMenu = { menu, dismiss, keyHandler };
  button.setAttribute('aria-expanded', 'true');
}

function closeTitlebarMenus(): void {
  document.querySelectorAll<HTMLElement>('.menu-root.open').forEach((root) => {
    root.classList.remove('open');
    root.querySelector<HTMLButtonElement>('.menu-trigger')?.setAttribute('aria-expanded', 'false');
  });
  closeMoreMenu();
}

function updateDockMenuState(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-workbench-panel]').forEach((button) => {
    const panelId = button.dataset.workbenchPanel as WorkbenchPanelId;
    const shared = panelId === 'contentBrowser' || panelId === 'runtime';
    const open = shared
      ? Boolean(workbenchFrame?.isOpen(panelId) || docking?.isOpen(panelId))
      : workbenchFrame?.isOpen(panelId) ?? false;
    button.setAttribute('aria-checked', String(open));
    button.classList.toggle('checked', open);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-dock-panel]').forEach((button) => {
    const panelId = button.dataset.dockPanel as DockPanelId;
    const open = docking?.isOpen(panelId) ?? false;
    button.setAttribute('aria-checked', String(open));
    button.classList.toggle('checked', open);
  });
}

function toggleSharedPanel(panelId: SharedDockPanelId): void {
  sharedPanelDockBridge?.toggle(panelId);
}

function popoutActivePanel(): void {
  const outerPanel = workbenchFrame?.activePanelId();
  if (outerPanel && outerPanel !== 'workflow') workbenchFrame?.popout(outerPanel);
  else docking?.popoutActivePanel();
}

async function refreshDebugSettings(): Promise<void> {
  const settings = await api.getDebugSettings();
  settingsDebugEnabled.checked = settings.enabled;
  settingsDebugAnnotate.checked = settings.annotateScreenshots;
  settingsDebugAnnotate.disabled = !settings.enabled;
}

function openSettingsPanel(): void {
  settingsContentView.value = contentBrowser.getView();
  settingsAutoRefresh.checked = autoRefreshInstances;
  settingsDefaultWorkflow.checked = loadDefaultWorkflowOnStart;
  settingsRestoreSession.checked = restoreSessionOnStart;
  void refreshDebugSettings().catch((error) => showToast(`读取 Debug 设置失败：${String(error)}`));
  workbenchFrame?.show('settings');
}

/** 打开独立窗口的模拟器画面测试工具（实时画面 / 模板匹配 / ROI / 点击位置测试）。 */
async function openVisionTest(): Promise<void> {
  if (visionTestOpening) return;
  if (!selectedInstance) {
    showToast('未检测到运行实例，请先启动 MuMu 模拟器', true);
    return;
  }
  visionTestOpening = true;
  try {
    await api.openVisionTest(selectedInstance);
  } catch (error) {
    showToast(`打开画面测试工具失败：${errorMessage(error)}`, true);
  } finally {
    visionTestOpening = false;
  }
}

/** 用系统默认程序打开项目 README 使用说明。 */
async function openHelpReadme(): Promise<void> {
  try {
    await api.openReadme();
  } catch (error) {
    showToast(`打开使用说明失败：${errorMessage(error)}`, true);
  }
}

/** 在设置面板中打开“关于”页。 */
function openAboutPage(): void {
  workbenchFrame?.show('settings');
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>('#settings-tab-about')?.click();
  }, 0);
}

function readSettings(): void {
  autoRefreshInstances = window.localStorage.getItem('onmyoji-studio.settings.auto-refresh') !== 'false';
  loadDefaultWorkflowOnStart = window.localStorage.getItem('onmyoji-studio.settings.default-workflow') !== 'false';
  restoreSessionOnStart = window.localStorage.getItem('onmyoji-studio.settings.restore-session') !== 'false';
}

function restartInstanceRefresh(): void {
  if (instanceRefreshTimer !== undefined) {
    window.clearInterval(instanceRefreshTimer);
    instanceRefreshTimer = undefined;
  }
  if (autoRefreshInstances) {
    instanceRefreshTimer = window.setInterval(() => void refreshInstances(), 5000);
  }
}

function bindUi(): void {
  roiPicker.bind();
  document.querySelectorAll<HTMLElement>('[data-editor-command]').forEach((button) => {
    button.addEventListener('click', () => {
      const command = button.dataset.editorCommand ?? '';
      if (command === 'workflowSettings') {
        docking?.showPanel('details');
        // 工作流设置属于详细信息面板自己的 inspector 状态，不能只发给画布 iframe。
        postToFrame(detailsFrame, { type: 'editorCommand', command });
      }
      editorCommand(command);
    });
  });
  document.querySelectorAll<HTMLElement>('[data-desktop-command]').forEach((button) => {
    button.addEventListener('click', () => desktopControl(button.dataset.desktopCommand ?? ''));
  });
  document.querySelectorAll<HTMLElement>('[data-app-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.appCommand === 'settings') openSettingsPanel();
      if (button.dataset.appCommand === 'visionTest') void openVisionTest();
      if (button.dataset.appCommand === 'help') void openHelpReadme();
      if (button.dataset.appCommand === 'about') openAboutPage();
    });
  });
  settingsContentView.addEventListener('change', () => contentBrowser.setView(settingsContentView.value === 'list' ? 'list' : 'grid'));
  settingsAutoRefresh.addEventListener('change', () => {
    autoRefreshInstances = settingsAutoRefresh.checked;
    window.localStorage.setItem('onmyoji-studio.settings.auto-refresh', String(autoRefreshInstances));
    restartInstanceRefresh();
  });
  settingsDefaultWorkflow.addEventListener('change', () => {
    loadDefaultWorkflowOnStart = settingsDefaultWorkflow.checked;
    window.localStorage.setItem('onmyoji-studio.settings.default-workflow', String(loadDefaultWorkflowOnStart));
  });
  settingsRestoreSession.addEventListener('change', () => {
    restoreSessionOnStart = settingsRestoreSession.checked;
    window.localStorage.setItem('onmyoji-studio.settings.restore-session', String(restoreSessionOnStart));
  });
  const saveDebugSettings = async (): Promise<void> => {
    settingsDebugEnabled.disabled = true;
    settingsDebugAnnotate.disabled = true;
    try {
      const settings = await api.updateDebugSettings({
        enabled: settingsDebugEnabled.checked,
        annotateScreenshots: settingsDebugAnnotate.checked,
      });
      settingsDebugEnabled.checked = settings.enabled;
      settingsDebugAnnotate.checked = settings.annotateScreenshots;
      showToast(settings.enabled ? 'Debug 逐步截图已开启，下次运行生效' : 'Debug 逐步截图已关闭');
    } catch (error) {
      showToast(`保存 Debug 设置失败：${String(error)}`);
      await refreshDebugSettings().catch(() => undefined);
    } finally {
      settingsDebugEnabled.disabled = false;
      settingsDebugAnnotate.disabled = !settingsDebugEnabled.checked;
    }
  };
  settingsDebugEnabled.addEventListener('change', () => void saveDebugSettings());
  settingsDebugAnnotate.addEventListener('change', () => void saveDebugSettings());
  document.querySelectorAll<HTMLButtonElement>('[data-dock-panel]').forEach((button) => {
    button.addEventListener('click', () => docking?.togglePanel(button.dataset.dockPanel as DockPanelId));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-workbench-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const panelId = button.dataset.workbenchPanel as WorkbenchPanelId;
      if (panelId === 'settings') {
        if (workbenchFrame?.isOpen('settings')) workbenchFrame.toggle('settings');
        else openSettingsPanel();
      }
      else if (panelId === 'referenceViewer') {
        if (workbenchFrame?.isOpen('referenceViewer')) referenceViewer.close();
        else if (currentUri) {
          const relative = relativeToProject(displayFileUri(currentUri));
          if (relative) referenceViewer.open(relative, document);
        }
      } else if (panelId === 'contentBrowser' || panelId === 'runtime') {
        toggleSharedPanel(panelId);
      } else if (panelId !== 'workflow') {
        workbenchFrame?.toggle(panelId);
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-dock-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.dockCommand === 'popoutActive') popoutActivePanel();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-layout-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.layoutCommand === 'reset') resetDockLayout();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.menu-trigger').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const root = trigger.closest<HTMLElement>('.menu-root')!;
      const shouldOpen = !root.classList.contains('open');
      closeTitlebarMenus();
      root.classList.toggle('open', shouldOpen);
      trigger.setAttribute('aria-expanded', String(shouldOpen));
    });
    trigger.closest<HTMLElement>('.menu-root')!.addEventListener('mouseenter', () => {
      if (!document.querySelector('.menu-root.open')) return;
      closeTitlebarMenus();
      const root = trigger.closest<HTMLElement>('.menu-root')!;
      root.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    });
  });
  document.querySelectorAll<HTMLElement>('.titlebar-dropdown').forEach((menu) => {
    menu.addEventListener('click', () => closeTitlebarMenus());
  });
  document.querySelectorAll<HTMLElement>('[data-window-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.windowCommand === 'minimize') void api.minimizeWindow();
      if (button.dataset.windowCommand === 'toggleMaximize') void api.toggleMaximizeWindow().then(updateMaximizedState);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-left-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-left-tab]').forEach((item) => item.classList.toggle('active', item === tab));
      structureView.classList.toggle('hidden', tab.dataset.leftTab !== 'structure');
      document.querySelector<HTMLElement>('#palette-view')!.classList.toggle('hidden', tab.dataset.leftTab !== 'palette');
    });
  });
  document.querySelector('#structure-expand-all')!.addEventListener('click', () => setAllTreeBranches(true));
  document.querySelector('#structure-collapse-all')!.addEventListener('click', () => setAllTreeBranches(false));
  document.querySelector('#add-variable-button')!.addEventListener('click', () => editorCommand('addVariable', 'variables'));
  document.querySelector('#new-workflow-button')!.addEventListener('click', () => void createNewWorkflow());
  document.querySelector('#run-button')!.addEventListener('click', () => desktopControl('run'));
  document.querySelector('#stop-button')!.addEventListener('click', () => {
    if (overview.isRunning()) void overview.stop();
    else desktopControl('stop');
  });
  document.querySelector('#save-button')!.addEventListener('click', () => desktopControl('save'));
  document.querySelector<HTMLButtonElement>('#more-button')!.addEventListener('click', (event) => {
    event.stopPropagation();
    const button = event.currentTarget as HTMLButtonElement;
    if (moreMenu) closeMoreMenu();
    else showMoreMenu(button);
  });
  document.querySelector('#window-minimize')!.addEventListener('click', () => void api.minimizeWindow());
  document.querySelector('#window-maximize')!.addEventListener('click', async () => updateMaximizedState(await api.toggleMaximizeWindow()));
  document.querySelector('#window-close')!.addEventListener('click', () => void api.closeWindow());
  instanceSelect.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleInstancePicker();
  });
  instanceSelect.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeInstancePicker(true);
    } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleInstancePicker();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (!instancePicker.contains(target) && !instanceMenu.contains(target)) closeInstancePicker();
  }, true);
  window.addEventListener('resize', () => closeInstancePicker());
  window.addEventListener('scroll', () => closeInstancePicker(), true);
  overview.bind();
  contentBrowser.bind();
  document.addEventListener('click', closeTitlebarMenus);
  document.addEventListener('pointerdown', resetDeleteTargetOnPointerDown, true);
  document.addEventListener('keydown', (event) => {
    if (handleDeleteShortcut(event)) return;
    if (event.key === 'Escape') {
      if (roiPicker.isOpen()) {
        event.preventDefault();
        roiPicker.cancel();
        return;
      }
      if (contentBrowser.isNameDialogOpen()) {
        event.preventDefault();
        contentBrowser.cancelNameDialog();
        return;
      }
      if (overview.isConfigurationOpen()) overview.closeConfiguration();
      closeTitlebarMenus();
      closeInstancePicker(true);
    }
    if (matchesShortcut(event, 'global.popout')) {
      event.preventDefault();
      popoutActivePanel();
    }
  });
  window.addEventListener('blur', () => {
    closeTitlebarMenus();
    closeInstancePicker();
  });
}

window.addEventListener('message', (event: MessageEvent<EditorEnvelope>) => {
  const runtimeEnvelope = event.data as RuntimeLogEnvelope;
  if (event.source === runtimeLogFrame.contentWindow && runtimeEnvelope.source === 'desktop-run-log') {
    const type = runtimeEnvelope.message?.type;
    if (type === 'ready') {
      runtimeLog.markReady();
    } else if (type === 'stopWorkflow') {
      void api.stopWorkflow();
    } else if (type === 'clear') {
      runtimeLog.clear();
    }
    return;
  }

  // 面板被拖动到独立窗口后，DOM 仍在，但主窗口 document 收不到键盘事件；
  // 独立窗口把删除键与指针事件转回来，复用同一套删除目标逻辑。
  if (event.data?.source === 'dockview-popout' && event.data.type === 'shellShortcut') {
    performDeleteTarget();
    return;
  }
  if (event.data?.source === 'dockview-popout' && event.data.type === 'shellContextReset') {
    deleteTarget = undefined;
    return;
  }

  const frameById = (id: string | undefined): HTMLIFrameElement | undefined => {
    if (!id) return undefined;
    if (id === detailsFrame.id) return detailsFrame;
    for (const runtime of documentRuntimes.values()) if (runtime.frame.id === id) return runtime.frame;
    return undefined;
  };
  const sourceFrame = event.data?.source === 'dockview-popout'
    ? frameById(event.data.frameId)
    : [...documentRuntimes.values()].map((runtime) => runtime.frame).find((frame) => frame.contentWindow === event.source)
      ?? (event.source === detailsFrame.contentWindow ? detailsFrame : undefined);
  if (!sourceFrame) return;
  if ((event.data?.source === 'legacy-editor' || event.data?.source === 'dockview-popout') && event.data.message) {
    void handleEditorMessage(event.data.message, sourceFrame);
  }
  if (event.data?.source === 'legacy-editor-state' || event.data?.source === 'dockview-popout' && event.data.state) {
    const frameDirty = Boolean(event.data.state?.dirty);
    const frameUri = documentFrameUris.get(sourceFrame);
    if (frameUri) {
      const tab = workflowTabs.find((item) => item.uri === frameUri);
      if (tab && tab.dirty !== frameDirty) {
        tab.dirty = frameDirty;
        syncDocumentTabs();
      }
      if (frameUri === currentUri) setDirty(frameDirty);
    }
  }
});

async function start(): Promise<void> {
  const showPopoutFailure = (): void => showToast('无法打开独立模块窗口', true);
  installCustomTooltips();
  workbenchFrame = createWorkbenchFrame(updateDockMenuState, showPopoutFailure);
  docking = createDockingWorkspace(updateDockMenuState, showPopoutFailure, {
    onFrameCreated: (panelId, uri, frame) => registerDocumentFrame(panelId, uri, frame),
    onFrameDisposed: (panelId) => unregisterDocumentFrame(panelId),
    onCloseRequested: (uri) => void closeWorkflowTab(uri),
  });
  // 文档面板的激活统一走 Dockview 事件，标签点击与程序化切面板都不会漏。
  docking.dockviewApi.onDidActivePanelChange((event) => {
    if (!documentsReady || removingDocument || closingDocuments.size > 0) return;
    const uri = event.panel ? documentUriForPanelId(event.panel.api.id) : undefined;
    if (uri) void activateWorkflowTab(uri);
  });
  docking.onDidRemoveDocument((uri) => void handleDocumentRemoved(uri));
  contentBrowser.bindWorkflowDropTarget(document.querySelector<HTMLElement>('#dock-workspace')!);
  sharedPanelDockBridge = connectSharedPanelDocking(docking, workbenchFrame, updateDockMenuState);
  updateDockMenuState();
  createIcons({ icons: desktopIcons });
  bindUi();
  refreshShortcutLabels();
  window.StudioShortcuts?.subscribe(refreshShortcutLabels);
  api.onRuntimeOutput((event) => runtimeLog.appendOutput(event));
  api.onRuntimeState(updateRuntimeState);
  api.onRunEvent((event) => {
    runtimeLog.appendRunEvent(event);
    postToAllEditors({ type: 'runEvent', event });
  });
  api.onWindowMaximized(updateMaximizedState);
  updateMaximizedState(await api.isWindowMaximized());
  try {
    const [bootstrapData, assets, folders] = await Promise.all([api.bootstrap(), api.listAssets(), api.listContentFolders()]);
    bootstrap = bootstrapData;
    contentBrowser.setCatalog(assets, folders);
    readSettings();
    renderWorkflowSelect(bootstrap.workflows);
    renderInstances(bootstrap.instances);
    overview.reconcileSelection(true);
    overview.reconcileConfigurations(true);
    overview.render();
    renderSidebar();
    contentBrowser.render();
    document.querySelector<HTMLElement>('#settings-project-root')!.textContent = bootstrap.projectRoot;
    setStatus('桌面端已连接');
    const session = restoreSessionOnStart ? readWorkflowSession() : undefined;
    if (session) {
      applyWorkflowSession(session);
      // 上次退出时的未保存内容先落盘，避免恢复后标记变干净却丢失改动。
      void flushRestoredEdits();
    }
    reconcileDocumentPanels();
    documentsReady = true;
    if (session) {
      docking.ensureLayout();
      await activateWorkflowTab(session.activeUri);
      restoreWorkflowUri = '';
      showToast(`已恢复上次的 ${session.tabs.length} 个画布`);
    } else {
      const fallback = loadDefaultWorkflowOnStart ? bootstrap.defaultWorkflow : undefined;
      if (fallback) await openWorkflowTab(fallback);
      else ensureFallbackDocument();
      docking.ensureLayout();
    }
    restartInstanceRefresh();
  } catch (error) {
    loadingMask.classList.add('hidden');
    showToast(errorMessage(error), true);
    setStatus('初始化失败');
  }
}

window.addEventListener('beforeunload', () => {
  persistWorkflowSessionNow();
  clearAutoSaveTimer();
  if (instanceRefreshTimer !== undefined) window.clearInterval(instanceRefreshTimer);
  suppressDocumentRemoval = true;
  sharedPanelDockBridge?.dispose();
  docking?.dispose();
  workbenchFrame?.dispose();
});

void start();
