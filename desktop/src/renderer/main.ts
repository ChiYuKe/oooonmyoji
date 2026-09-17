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
import { createOverview } from './overview';
import { createRuntimeLog } from './runtime-log';
import type { WorkflowDocumentTab } from '../shared/workspace/session';
import { createWorkspace, type DocumentRuntime } from './workspace';
import { createRoiPicker } from './roi-picker';
import { createSidebar } from './panels/sidebar';
import { createEditorHost } from './editor-host';
import { createInstancePicker, instanceLabel } from './instance-picker';
import { createTitlebarMenus } from './titlebar-menus';
import { parseEditorMessage } from '../shared/editor-messages';
import './styles.css';

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
      ...[...workspace.getDocumentRuntimes().values()].map((runtime) => runtime.frame),
      detailsFrame,
      runtimeLogFrame,
    ],
  });
}


const detailsFrame = document.querySelector<HTMLIFrameElement>('#details-frame')!;
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
let selectedInstance = '';
let runtimeInstances: RuntimeInstance[] = [];
/** 已打开文档画布注册表：uri → 独立 iframe 与画布状态。 */
const workspace = createWorkspace({
  detailsFrame,
  api,
  getBootstrap: () => bootstrap,
  showToast,
  errorMessage,
  setStatus,
  syncDocumentTabs,
});
/** 正在由壳层主动关闭的文档，避免 onDidRemoveDocument 重复走保存流程。 */
const closingDocuments = new Set<string>();
/** 会话恢复完成前忽略 Dockview 的激活事件，避免加载到错误的文档。 */
let documentsReady = false;
/** 关闭文档期间抑制激活事件，避免邻居面板抢先把 currentUri 切走。 */
let removingDocument = false;
/** 布局重置/会话对账时批量移除面板，不应触发保存与标签删除。 */
let suppressDocumentRemoval = false;
let toastTimer: number | undefined;
let instanceRefreshTimer: number | undefined;
let docking: DockingController | undefined;
let workbenchFrame: WorkbenchFrameController | undefined;
let sharedPanelDockBridge: SharedPanelDockBridge | undefined;
/** 最近一次被点选的删除目标（内容项、队列行或画布选区）；Delete/Backspace 只作用于它。 */
let deleteTarget: DeleteTarget | undefined;
let autoRefreshInstances = true;
let loadDefaultWorkflowOnStart = true;
let restoreSessionOnStart = true;
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
  getCurrentUri: () => workspace.activeUri(),
  getCurrentText: () => workspace.activeText(),
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
  getCurrentUri: () => workspace.activeUri(),
  isDirty: () => workspace.isDirty(),
  getWorkflowTabs: () => workspace.tabs(),
  renameWorkflowTab: (oldUri, newUri) => workspace.renameDocument(oldUri, newUri),
  removeWorkflowTab: (uri) => { workspace.removeDocument(uri); },
  getOverview: () => overview,
  getReferenceViewer: () => referenceViewer,
  getDocking: () => docking,
  getDocumentRuntimes: () => workspace.getDocumentRuntimes() as Map<string, unknown>,
  getClosingDocuments: () => closingDocuments,
  workflowDescriptorForPath: workspace.workflowDescriptorForPath,
  relocateDocument,
  syncDocumentTabs,
  displayFileUri: workspace.displayFileUri,
  renderWorkflowSelect,
  openWorkflowInNewTab,
  openWorkflowTab,
  loadWorkflow,
  setDeleteTarget: (target) => { deleteTarget = target; },
});


const runtimeLog = createRuntimeLog({ frame: runtimeLogFrame });
runtimeLogFrame.addEventListener('load', () => runtimeLog.markReady());
if (runtimeLogFrame.contentDocument?.readyState === 'complete') window.queueMicrotask(() => runtimeLog.markReady());

function desktopControl(command: string, value?: unknown): void {
  if (command === 'switchWorkflow') {
    void switchWorkflow(String(value ?? ''));
    return;
  }
  workspace.postToEditor({ type: 'desktopControl', command, value });
}

/** 顶栏选择或子流程跳转：打开/聚焦对应文档面板，并把导航栈重置为该文档自己的记录。 */
async function switchWorkflow(uri: string, resetStack = true): Promise<void> {
  if (!uri) return;
  workbenchFrame?.show('workflow');
  workspace.cancelAutoSave();
  await workspace.waitForAutoSave();
  if (resetStack && workspace.tab(uri)) workspace.setDocumentBackStack(uri, []);
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
  postToFrame: workspace.postToFrame,
  showToast,
  errorMessage,
  saveTemplate: (request) => api.saveTemplate(request),
});

function relocateDocument(oldUri: string, newUri: string): void {
  if (!docking || !oldUri || oldUri === newUri) return;
  if (docking.isDocumentOpen(oldUri)) {
    closingDocuments.add(oldUri);
    docking.closeDocument(oldUri);
    closingDocuments.delete(oldUri);
  }
  workspace.getDocumentRuntimes().delete(oldUri);
  workspace.renameDocument(oldUri, newUri);
  if (!docking.isDocumentOpen(newUri)) docking.openDocument(newUri, workspace.workflowTabName(newUri));
  syncDocumentTabs();
}

/** 恢复布局后：关掉不再存在的文档面板，并为会话里的文档补齐面板。 */
function reconcileDocumentPanels(): void {
  if (!docking) return;
  const known = new Set(workspace.tabs().map((tab) => tab.uri));
  for (const uri of docking.documentUris()) {
    if (known.has(uri)) continue;
    closingDocuments.add(uri);
    docking.closeDocument(uri);
    closingDocuments.delete(uri);
    workspace.getDocumentRuntimes().delete(uri);
  }
  for (const tab of workspace.tabs()) {
    if (!docking.isDocumentOpen(tab.uri)) docking.openDocument(tab.uri, workspace.workflowTabName(tab.uri));
  }
  syncDocumentTabs();
}

/** 没有任何可打开的默认工作流时，至少保证有一个画布。 */
function ensureFallbackDocument(): void {
  if (workspace.tabs().length > 0) return;
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

/** 把未保存状态同步到原生 Dockview 标签。 */
function syncDocumentTabs(): void {
  for (const tab of workspace.tabs()) {
    const runtime = workspace.getDocumentRuntimes().get(tab.uri);
    if (!runtime) continue;
    setDocumentPanelDirty(runtime.panelId, tab.dirty);
    docking?.dockviewApi.getPanel(runtime.panelId)?.api.setTitle(workspace.workflowTabName(tab.uri));
  }
  workspace.scheduleWorkflowSessionPersist();
}

/** 把当前激活画布的选中项/折叠状态写回运行时，切换文档时原样恢复。 */
function rememberActiveRuntimeState(): void {
  const runtime = workspace.activeRuntime();
  if (!runtime) return;
  const view = sidebar.snapshot();
  runtime.sidebarNodes = view.nodes;
  runtime.sidebarVariables = view.variables;
  runtime.selectedNode = view.selectedNode;
  runtime.selectedVariable = view.selectedVariable;
  runtime.selectedVariableScope = view.selectedVariableScope;
  runtime.collapsedTreeNodes = view.collapsed;
}

/** 把运行时的画布状态恢复到左侧面板，重新驱动结构树与详细信息。 */
function applyDocumentState(uri: string, tab: WorkflowDocumentTab, runtime: DocumentRuntime): void {
  workspace.setActiveDocument(uri);
  sidebar.apply({
    nodes: runtime.sidebarNodes,
    variables: runtime.sidebarVariables,
    selectedNode: runtime.selectedNode,
    selectedVariable: runtime.selectedVariable,
    selectedVariableScope: runtime.selectedVariableScope,
    collapsed: runtime.collapsedTreeNodes,
  });
  if (runtime.init) {
    selectedInstance = runtime.init.selectedInstance;
    runtime.init.workflowTrail = workflowTrail();
    renderWorkflowSelect(runtime.init.workflows);
    renderInstances(runtime.init.instances, runtime.init.selectedInstance);
    workspace.postToFrame(detailsFrame, runtime.init as unknown as Record<string, unknown>);
  }
  document.querySelector<HTMLElement>('#document-path')!.textContent = workspace.displayFileUri(uri);
  workspace.setDirty(tab.dirty);
  overview.render();
  sidebar.render();
  if (runtime.inspectorSelection) {
    workspace.postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: runtime.inspectorSelection });
  }
  syncDocumentTabs();
}

/** 画布握手完成后下发它自己的初始化数据；同一文档的多个面板互不影响。 */
function sendDocumentInit(uri: string): void {
  const runtime = workspace.getDocumentRuntimes().get(uri);
  if (!runtime?.ready || !runtime.init) return;
  if (uri === workspace.activeUri()) runtime.init.workflowTrail = workflowTrail();
  workspace.postToFrame(runtime.frame, runtime.init as unknown as Record<string, unknown>);
  if (uri === workspace.activeUri()) workspace.postToFrame(detailsFrame, runtime.init as unknown as Record<string, unknown>);
}

function workflowTrail(): Array<{ uri: string; name: string }> {
  const uris = [...workspace.activeBackStack(), workspace.activeUri()].filter(Boolean);
  return uris.map((uri) => {
    const descriptor = bootstrap?.workflows.find((item) => item.uri === uri);
    const file = workspace.displayFileUri(uri).split(/[\\/]/).pop() || '';
    return { uri, name: descriptor?.id || descriptor?.name?.replace(/\.json$/i, '') || file.replace(/\.json$/i, '') || '工作流' };
  });
}

function resolveWorkflow(reference: string): WorkflowDescriptor | undefined {
  if (!bootstrap) return undefined;
  const normalized = reference.trim().replace(/\\/g, '/').replace(/^workflows\//i, '');
  const withExtension = normalized.toLowerCase().endsWith('.json') ? normalized : `${normalized}.json`;
  return bootstrap.workflows.find((file) => {
    const candidate = workspace.workflowReference(file);
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

function instanceLabelById(instanceId: string): string {
  const instance = runtimeInstances.find((item) => item.id === instanceId);
  return instance ? instanceLabel(instance) : instanceId;
}

const instancePicker = createInstancePicker({
  picker: document.querySelector<HTMLDivElement>('#instance-picker')!,
  trigger: document.querySelector<HTMLButtonElement>('#instance-select')!,
  triggerLabel: document.querySelector<HTMLElement>('#instance-select-label')!,
  menu: document.querySelector<HTMLDivElement>('#instance-menu')!,
}, (instanceId) => selectRuntimeInstance(instanceId));
const closeInstancePicker = instancePicker.close;

function selectRuntimeInstance(instanceId: string, notify = true): void {
  if (!runtimeInstances.some((instance) => instance.id === instanceId)) return;
  selectedInstance = instanceId;
  instancePicker.update(runtimeInstances, selectedInstance);
  overview.renderInstances();
  closeInstancePicker();
  if (notify) desktopControl('selectInstance', selectedInstance);
}

function renderInstances(instances: RuntimeInstance[], requested = selectedInstance): void {
  runtimeInstances = instances;
  const ids = new Set(instances.map((instance) => instance.id));
  selectedInstance = ids.has(requested) ? requested : instances[0]?.id ?? '';
  instancePicker.render(instances, selectedInstance);
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

const sidebar = createSidebar({
  structureView,
  variablesView,
  icons: desktopIcons,
  editorCommand: (command, value) => workspace.editorCommand(command, value),
  showDetailsPanel: () => { docking?.showPanel('details'); },
  registerEditorDeleteTarget: () => { deleteTarget = { kind: 'editor' }; },
});

const editorHost = createEditorHost({
  api,
  workspace,
  detailsFrame,
  sidebar,
  roiPicker,
  showToast,
  errorMessage,
  setStatus,
  showDetailsPanel: () => { docking?.showPanel('details'); },
  showRuntimePanel: () => {
    if (sharedPanelDockBridge) sharedPanelDockBridge.show('runtime');
    else docking?.showPanel('runtime');
  },
  openContentBrowserSearch: () => {
    sharedPanelDockBridge?.show('contentBrowser');
    window.setTimeout(() => contentBrowser.focusSearch(), 0);
  },
  openReferences: (uri) => {
    if (!uri) {
      showToast('请先打开一个工作流再查看引用', true);
      return;
    }
    const relative = relativeToProject(workspace.displayFileUri(uri));
    if (relative) referenceViewer.open(relative, document);
    else showToast('无法定位当前工作流的项目路径', true);
  },
  getSelectedInstance: () => selectedInstance,
  createNewWorkflow,
  switchWorkflow,
  ensureDocument,
  openWorkflowTab,
  loadWorkflow,
  loadDocumentOnce,
  sendDocumentInit,
  resolveWorkflow,
  selectInstance: selectRuntimeInstance,
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
    workspace.editorCommand('deleteSelection');
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

/** 确保工作流文档存在标签与 Dockview 面板，新面板默认成为激活项。 */
function ensureDocument(uri: string): WorkflowDocumentTab {
  const tab = workspace.ensureDocument(uri);
  if (docking && !docking.isDocumentOpen(uri)) docking.openDocument(uri, workspace.workflowTabName(uri));
  syncDocumentTabs();
  return tab;
}

async function loadWorkflow(uri: string): Promise<void> {
  if (!uri) return;
  const tab = ensureDocument(uri);
  rememberActiveRuntimeState();
  workspace.cancelAutoSave();
  await workspace.waitForAutoSave();
  loadingMask.classList.remove('hidden');
  try {
    const init = await api.getWorkflowInit(uri, selectedInstance, tab.backStack.length > 0);
    const documentText = tab.text || init.document.text;
    init.document.text = documentText;
    if (init.document.uri !== workspace.activeUri()) sidebar.resetCollapsed();
    workspace.setDocumentText(uri, documentText);
    workspace.setActiveDocument(init.document.uri);
    selectedInstance = init.selectedInstance;
    if (bootstrap) {
      bootstrap.workflows = init.workflows;
      bootstrap.instances = init.instances;
    }
    sidebar.resetViews();
    const runtime = workspace.getDocumentRuntimes().get(uri);
    if (runtime) {
      runtime.init = init;
      runtime.sidebarNodes = [];
      runtime.sidebarVariables = [];
      runtime.selectedNode = '';
      runtime.selectedVariable = '';
      runtime.collapsedTreeNodes = sidebar.snapshot().collapsed;
      runtime.inspectorSelection = undefined;
    }
    renderWorkflowSelect(init.workflows);
    renderInstances(init.instances, init.selectedInstance);
    overview.reconcileSelection();
    overview.render();
    contentBrowser.render();
    document.querySelector<HTMLElement>('#document-path')!.textContent = workspace.displayFileUri(init.document.uri);
    workspace.setDirty(tab.dirty);
    sidebar.render();
    workspace.postToFrame(detailsFrame, init as unknown as Record<string, unknown>);
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
  const tab = workspace.tab(uri);
  if (!tab) return;
  if (uri === workspace.activeUri()) {
    syncDocumentTabs();
    return;
  }
  if (activatingUri === uri) return;
  activatingUri = uri;
  try {
    docking?.focusDocument(uri);
    rememberActiveRuntimeState();
    workspace.cancelAutoSave();
    await workspace.waitForAutoSave();
    const runtime = workspace.getDocumentRuntimes().get(uri);
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
    workspace.getDocumentRuntimes().delete(uri);
    return;
  }
  removingDocument = true;
  try {
    const tab = workspace.tab(uri);
    if (!tab) {
      workspace.unregisterDocumentFrame(workspace.getDocumentRuntimes().get(uri)?.panelId ?? '');
      workspace.getDocumentRuntimes().delete(uri);
      return;
    }
    const index = workspace.tabs().indexOf(tab);
    const wasActive = uri === workspace.activeUri();
    try {
      if (tab.dirty && tab.text) {
        await api.saveWorkflow(uri, tab.text);
        workspace.setDocumentDirty(uri, false);
      }
    } catch (error) {
      showToast(`关闭工作流失败：${errorMessage(error)}`, true);
    }
    workspace.getDocumentRuntimes().delete(uri);
    workspace.removeDocument(uri);
    removingDocument = false;
    if (workspace.tabs().length === 0) {
      const fallback = bootstrap?.defaultWorkflow;
      if (fallback) await openWorkflowTab(fallback);
      else syncDocumentTabs();
      return;
    }
    if (wasActive) await activateWorkflowTab(workspace.tabs()[Math.min(index, workspace.tabs().length - 1)].uri);
    else syncDocumentTabs();
  } finally {
    removingDocument = false;
  }
}

async function closeWorkflowTab(uri: string): Promise<void> {
  if (workspace.tabs().length <= 1) {
    showToast('至少保留一个工作流画布');
    return;
  }
  if (!workspace.tab(uri)) return;
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
    workspace.postToAllEditors({ type: 'runtimeInstances', instances, selectedInstance });
  } catch {
    // Device discovery is best effort while the user edits offline.
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
    const workflow = decodePathLabel(String(event.workflow || workspace.activeUri()).replace(/\\/g, '/').split('/').pop() || '工作流');
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

const titlebarMenus = createTitlebarMenus((type) => {
  const frame = workspace.activeRuntime()?.frame;
  if (!frame) return;
  const parsed = parseEditorMessage({ type });
  if (parsed) void editorHost.handleMessage(parsed, frame);
});
const closeTitlebarMenus = titlebarMenus.close;
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
        workspace.postToFrame(detailsFrame, { type: 'editorCommand', command });
      }
      workspace.editorCommand(command);
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
        else if (workspace.activeUri()) {
          const relative = relativeToProject(workspace.displayFileUri(workspace.activeUri()));
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
  document.querySelector('#structure-expand-all')!.addEventListener('click', () => sidebar.setAllBranches(true));
  document.querySelector('#structure-collapse-all')!.addEventListener('click', () => sidebar.setAllBranches(false));
  document.querySelector('#add-variable-button')!.addEventListener('click', () => workspace.editorCommand('addVariable', 'variables'));
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
    titlebarMenus.toggleMore(button);
  });
  document.querySelector('#window-minimize')!.addEventListener('click', () => void api.minimizeWindow());
  document.querySelector('#window-maximize')!.addEventListener('click', async () => updateMaximizedState(await api.toggleMaximizeWindow()));
  document.querySelector('#window-close')!.addEventListener('click', () => void api.closeWindow());
  instancePicker.install(() => selectedInstance);
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
    for (const runtime of workspace.getDocumentRuntimes().values()) if (runtime.frame.id === id) return runtime.frame;
    return undefined;
  };
  const sourceFrame = event.data?.source === 'dockview-popout'
    ? frameById(event.data.frameId)
    : [...workspace.getDocumentRuntimes().values()].map((runtime) => runtime.frame).find((frame) => frame.contentWindow === event.source)
      ?? (event.source === detailsFrame.contentWindow ? detailsFrame : undefined);
  if (!sourceFrame) return;
  if ((event.data?.source === 'legacy-editor' || event.data?.source === 'dockview-popout') && event.data.message) {
    const parsed = parseEditorMessage(event.data.message);
    if (parsed) void editorHost.handleMessage(parsed, sourceFrame);
  }
  if (event.data?.source === 'legacy-editor-state' || event.data?.source === 'dockview-popout' && event.data.state) {
    const frameDirty = Boolean(event.data.state?.dirty);
    const frameUri = workspace.frameUriForFrame(sourceFrame);
    if (frameUri) {
      workspace.setDocumentDirty(frameUri, frameDirty);
      if (frameUri === workspace.activeUri()) workspace.setDirty(frameDirty);
    }
  }
});

async function start(): Promise<void> {
  const showPopoutFailure = (): void => showToast('无法打开独立模块窗口', true);
  installCustomTooltips();
  workbenchFrame = createWorkbenchFrame(updateDockMenuState, showPopoutFailure);
  docking = createDockingWorkspace(updateDockMenuState, showPopoutFailure, {
    onFrameCreated: (panelId, uri, frame) => workspace.registerDocumentFrame(panelId, uri, frame),
    onFrameDisposed: (panelId) => workspace.unregisterDocumentFrame(panelId),
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
    workspace.postToAllEditors({ type: 'runEvent', event });
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
    sidebar.render();
    contentBrowser.render();
    document.querySelector<HTMLElement>('#settings-project-root')!.textContent = bootstrap.projectRoot;
    setStatus('桌面端已连接');
    const session = restoreSessionOnStart ? workspace.readWorkflowSession() : undefined;
    if (session) {
      workspace.applyWorkflowSession(session);
      // 上次退出时的未保存内容先落盘，避免恢复后标记变干净却丢失改动。
      void workspace.flushRestoredEdits();
    }
    reconcileDocumentPanels();
    documentsReady = true;
    if (session) {
      docking.ensureLayout();
      await activateWorkflowTab(session.activeUri);
      workspace.setRestoreUri('');
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
  workspace.persistWorkflowSessionNow();
  workspace.cancelAutoSave();
  if (instanceRefreshTimer !== undefined) window.clearInterval(instanceRefreshTimer);
  suppressDocumentRemoval = true;
  sharedPanelDockBridge?.dispose();
  docking?.dispose();
  workbenchFrame?.dispose();
});

void start();
