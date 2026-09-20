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
  isSharedDockPanelId,
  setDocumentPanelDirty,
  type DockPanelId,
  type DockingController,
  type SharedDockPanelId,
  type SharedPanelDockBridge,
  type WorkbenchFrameController,
  type WorkbenchPanelId,
} from './docking';
import { createReferenceViewer } from './reference-viewer';
import { createVariableReferences } from './variable-references';
import { contentName, createContentBrowser, relativeToProject, type ContentBrowser, type ContentBrowserItem } from './content-browser';
import { createOverview } from './overview';
import { createRuntimeLog } from './runtime-log';
import { createDeleteShortcuts } from './delete-shortcuts';
import { createRenameShortcuts } from './rename-shortcuts';
import { createDocumentLifecycle } from './document-lifecycle';
import { createSettingsPanel } from './settings-panel';
import type { WorkflowDocumentTab } from '../shared/workspace/session';
import { createWorkspace, type DocumentRuntime } from './workspace';
import { createRoiPicker } from './roi-picker';
import { createSidebar } from './panels/sidebar';
import { createEditorHost } from './editor-host';
import { createInstancePicker, instanceLabel } from './instance-picker';
import { createTitlebarMenus } from './titlebar-menus';
import { parseEditorMessage } from '../shared/editor-messages';
import {
  readRuntimeEdgePreview,
  writeRuntimeEdgePreview,
} from '../shared/runtime-edge-preview';
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
  syncDocumentTabs: () => lifecycle.syncDocumentTabs(),
});
let toastTimer: number | undefined;
let docking: DockingController | undefined;
let workbenchFrame: WorkbenchFrameController | undefined;
let sharedPanelDockBridge: SharedPanelDockBridge | undefined;
let runtimeBusy = false;
let visionTestOpening = false;
let liveViewOpening = false;

/**
 * 删除快捷键：登记目标的状态与解析在独立模块里，各面板只负责登记
 * （overview/contentBrowser/roiPicker 在后续构造，经惰性箭头在调用期取得）。
 */
const deleteShortcuts = createDeleteShortcuts({
  matchesShortcut: (event, id) => window.StudioShortcuts?.matchesById(event, id) ?? false,
  overview: {
    isSelected: (rel) => overview.isSelected(rel),
    isRunning: () => overview.isRunning(),
    updateSelection: (rel, checked) => overview.updateSelection(rel, checked),
    selectQueueRow: (rel) => overview.selectQueueRow(rel),
  },
  roiPicker: { isOpen: () => roiPicker.isOpen() },
  contentBrowser: {
    resolveDeleteTarget: (path) => contentBrowser.resolveDeleteTarget(path),
    isRootFolder: (path) => contentBrowser.isRootFolder(path),
    deleteItem: (item) => contentBrowser.deleteItem(item as ContentBrowserItem),
    isNameDialogOpen: () => contentBrowser.isNameDialogOpen(),
  },
  workspace,
  showToast,
});
const { handleDeleteShortcut, performDeleteTarget, resetDeleteTargetOnPointerDown } = deleteShortcuts;

/**
 * 重命名快捷键（F2）：复用删除快捷键登记的最近点选目标。
 * 内容条目在网格里原地改名；结构树/变量列表在选中的那一行原地改名；
 * 画布选区交给详细信息镜像聚焦名称输入框。
 */
const renameShortcuts = createRenameShortcuts({
  matchesShortcut: (event, id) => window.StudioShortcuts?.matchesById(event, id) ?? false,
  getDeleteTarget: () => deleteShortcuts.getDeleteTarget(),
  roiPicker: { isOpen: () => roiPicker.isOpen() },
  contentBrowser: {
    resolveRenameTarget: (path) => contentBrowser.resolveRenameTarget(path),
    isRootFolder: (path) => contentBrowser.isRootFolder(path),
    renameItem: (item) => void contentBrowser.renameItem(item as ContentBrowserItem),
    isNameDialogOpen: () => contentBrowser.isNameDialogOpen(),
  },
  panels: {
    renameNode: (nodeId) => sidebar.startNodeRename(nodeId),
    renameVariable: (name, scope) => sidebar.startVariableRename(name, scope),
  },
  workspace,
  showToast,
});
const { handleRenameShortcut } = renameShortcuts;

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
  getDeleteTarget: () => {
    const target = deleteShortcuts.getDeleteTarget();
    return target?.kind === 'queue' ? target : undefined;
  },
  setDeleteTarget: (target) => deleteShortcuts.setDeleteTarget(target),
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
  getClosingDocuments: () => lifecycle.closingDocumentUris(),
  workflowDescriptorForPath: workspace.workflowDescriptorForPath,
  relocateDocument: (oldUri, newUri) => lifecycle.relocateDocument(oldUri, newUri),
  syncDocumentTabs: () => lifecycle.syncDocumentTabs(),
  displayFileUri: workspace.displayFileUri,
  renderWorkflowSelect,
  openWorkflowInNewTab: (uri) => lifecycle.openWorkflowInNewTab(uri),
  openWorkflowTab: (uri) => lifecycle.openWorkflowTab(uri),
  loadWorkflow: (uri) => lifecycle.loadWorkflow(uri),
  reloadRewrittenDocuments: async (paths) => {
    // 主进程只回项目相对路径；这里映射到打开中的文档（URI）再交给生命周期强制读盘，
    // 并把因未保存修改而跳过的文件按项目路径回报给调用方提示用户。
    const relativeOf = (uri: string): string => relativeToProject(workspace.displayFileUri(uri)).replace(/\\/g, '/');
    const wanted = new Map(paths.map((path) => [path.replace(/\\/g, '/').toLowerCase(), path]));
    const uris = workspace.tabs()
      .map((tab) => tab.uri)
      .filter((uri) => wanted.has(relativeOf(uri).toLowerCase()));
    const skipped = await lifecycle.reloadDocuments(uris);
    return skipped.map((uri) => relativeOf(uri)).filter(Boolean);
  },
  setDeleteTarget: (target) => deleteShortcuts.setDeleteTarget(target),
});


/**
 * 设置面板：内容视图、实例自动刷新、启动行为与 Debug 截图的读写都收在独立模块里。
 */
const settings = createSettingsPanel({
  api,
  contentBrowser,
  showToast,
  showPanel: () => { workbenchFrame?.show('settings'); },
  refreshInstances: () => void refreshInstances(),
});

const runtimeLog = createRuntimeLog({ frame: runtimeLogFrame });
runtimeLogFrame.addEventListener('load', () => runtimeLog.markReady());
if (runtimeLogFrame.contentDocument?.readyState === 'complete') window.queueMicrotask(() => runtimeLog.markReady());

function desktopControl(command: string, value?: unknown): void {
  if (command === 'switchWorkflow') {
    void lifecycle.switchWorkflow(String(value ?? ''));
    return;
  }
  workspace.postToEditor({ type: 'desktopControl', command, value });
}

async function createNewWorkflow(): Promise<void> {
  const uri = await api.createWorkflow();
  if (!uri) return;
  if (bootstrap) bootstrap.workflows = (await api.bootstrap()).workflows;
  overview.reconcileSelection();
  overview.render();
  await lifecycle.openWorkflowTab(uri);
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

const variableReferences = createVariableReferences({
  getSharedPanels: () => sharedPanelDockBridge,
  focusNode: (source, nodeId) => source.post('focusNode', nodeId),
  selectVariable: (source, scope, name) => source.post('selectVariable', { scope, name }),
  deleteVariable: (source, scope, name) => source.post('deleteVariable', { scope, name }),
  showToast,
});

const sidebar = createSidebar({
  structureView,
  variablesView,
  icons: desktopIcons,
  editorCommand: (command, value) => workspace.editorCommand(command, value),
  showDetailsPanel: () => { docking?.showPanel('details'); },
  registerEditorDeleteTarget: (target) => deleteShortcuts.setDeleteTarget({ kind: 'editor', ...target }),
});

/**
 * 文档生命周期：标签/面板的打开、激活、关闭与对账都集中在这里，
 * 入口只负责把各面板句柄与可变状态注入进去。
 */
const lifecycle = createDocumentLifecycle({
  api,
  workspace,
  getDocking: () => docking,
  getWorkbenchFrame: () => workbenchFrame,
  getBootstrap: () => bootstrap,
  getSelectedInstance: () => selectedInstance,
  setSelectedInstance: (value) => { selectedInstance = value; },
  sidebar,
  overview,
  contentBrowser,
  loadingMask,
  detailsFrame,
  renderWorkflowSelect,
  renderInstances,
  setStatus,
  showToast,
  errorMessage,
  setDocumentPanelDirty,
  resetSharedPanelSurfaces: () => sharedPanelDockBridge?.resetSurfaces(),
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
  showVariableReferences: (data, source) => variableReferences.open(data, source),
  getDocumentFrame: (uri) => workspace.getDocumentRuntimes().get(uri)?.frame,
  getSelectedInstance: () => selectedInstance,
  createNewWorkflow,
  switchWorkflow: (uri, resetStack) => lifecycle.switchWorkflow(uri, resetStack),
  ensureDocument: (uri) => lifecycle.ensureDocument(uri),
  openWorkflowTab: (uri) => lifecycle.openWorkflowTab(uri),
  loadWorkflow: (uri) => lifecycle.loadWorkflow(uri),
  loadDocumentOnce: (uri) => lifecycle.loadDocumentOnce(uri),
  sendDocumentInit: (uri) => lifecycle.sendDocumentInit(uri),
  resolveWorkflow,
  selectInstance: selectRuntimeInstance,
  refreshWorkflows: async () => {
    // 画布打开子工作流选择器时会要一次最新目录：同步壳层 bootstrap 与各画布的列表。
    bootstrap = await api.bootstrap();
    workspace.postToAllEditors({ type: 'workflows', workflows: bootstrap.workflows });
  },
});

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

let runtimeEdgePreviewEnabled = readRuntimeEdgePreview(window.localStorage);
const titlebarMenus = createTitlebarMenus((type) => {
  if (type === 'toggleRuntimeEdgePreview') {
    runtimeEdgePreviewEnabled = !runtimeEdgePreviewEnabled;
    writeRuntimeEdgePreview(window.localStorage, runtimeEdgePreviewEnabled);
    workspace.postToAllEditors({
      type: 'desktopControl',
      command: 'setRuntimeEdgePreview',
      value: runtimeEdgePreviewEnabled,
    });
    showToast(`运行连线预览已${runtimeEdgePreviewEnabled ? '开启' : '关闭'}`);
    return;
  }
  const frame = workspace.activeRuntime()?.frame;
  if (!frame) return;
  const parsed = parseEditorMessage({ type });
  if (parsed) void editorHost.handleMessage(parsed, frame);
}, { runtimeEdgePreviewEnabled: () => runtimeEdgePreviewEnabled });
const closeTitlebarMenus = titlebarMenus.close;
function updateDockMenuState(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-workbench-panel]').forEach((button) => {
    const panelId = button.dataset.workbenchPanel as WorkbenchPanelId;
    // 共享面板可以停在两层中的任意一层（例如内容浏览器被拖到外层），两层都要看。
    const open = isSharedDockPanelId(panelId)
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

/**
 * 打开独立窗口的实时视觉监视：显示正在运行的工作流每一步“眼中的画面”
 * （模板匹配框 / ROI / OCR / 点击轨迹 / 当前节点状态）。
 */
async function openLiveView(): Promise<void> {
  if (liveViewOpening) return;
  if (!selectedInstance) {
    showToast('未检测到运行实例，请先启动 MuMu 模拟器', true);
    return;
  }
  liveViewOpening = true;
  try {
    await api.openLiveView(selectedInstance);
  } catch (error) {
    showToast(`打开实时视觉监视失败：${errorMessage(error)}`, true);
  } finally {
    liveViewOpening = false;
  }
}

/** 用系统默认程序打开项目 README 使用说明。 */
async function openHelpReadme(): Promise<void> {  try {
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
      if (button.dataset.appCommand === 'settings') settings.openSettingsPanel();
      if (button.dataset.appCommand === 'visionTest') void openVisionTest();
      if (button.dataset.appCommand === 'liveView') void openLiveView();
      if (button.dataset.appCommand === 'help') void openHelpReadme();
      if (button.dataset.appCommand === 'about') openAboutPage();
    });
  });
  settings.bind();
  document.querySelectorAll<HTMLButtonElement>('[data-dock-panel]').forEach((button) => {
    button.addEventListener('click', () => docking?.togglePanel(button.dataset.dockPanel as DockPanelId));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-workbench-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const panelId = button.dataset.workbenchPanel as WorkbenchPanelId;
      if (panelId === 'settings') {
        if (workbenchFrame?.isOpen('settings')) workbenchFrame.toggle('settings');
        else settings.openSettingsPanel();
      }
      else if (panelId === 'referenceViewer') {
        if (workbenchFrame?.isOpen('referenceViewer')) referenceViewer.close();
        else if (workspace.activeUri()) {
          const relative = relativeToProject(workspace.displayFileUri(workspace.activeUri()));
          if (relative) referenceViewer.open(relative, document);
        }
      }
      else if (panelId === 'variableReferences') {
        // 面板内容跟着用户当前关心的变量走：没有目标就什么都不显示，直接切换开关。
        if (sharedPanelDockBridge?.surface('variableReferences')) variableReferences.close();
        else showToast('这个面板跟着变量走：在变量详情里删除一个被引用的变量时，它会列出所有引用者', true);
      } else if (isSharedDockPanelId(panelId)) {
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
      if (button.dataset.layoutCommand === 'reset') lifecycle.resetDockLayout();
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
    if (handleRenameShortcut(event)) return;
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
      if (sidebar.isRenaming()) {
        event.preventDefault();
        sidebar.cancelRename();
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
  // 独立窗口把删除/重命名键与指针事件转回来，复用同一套目标逻辑。
  if (event.data?.source === 'dockview-popout' && event.data.type === 'shellShortcut') {
    // 转发事件只被目标解析消费（读取 key / 调用 preventDefault），不读 defaultPrevented。
    const forwarded = {
      key: String(event.data.key ?? ''),
      target: null,
      preventDefault() {},
    } as KeyboardEvent;
    if (!handleRenameShortcut(forwarded)) performDeleteTarget(forwarded);
    return;
  }
  if (event.data?.source === 'dockview-popout' && event.data.type === 'shellContextReset') {
    deleteShortcuts.setDeleteTarget(undefined);
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
    onCloseRequested: (uri) => void lifecycle.closeWorkflowTab(uri),
  });
  // 文档面板的激活统一走 Dockview 事件，标签点击与程序化切面板都不会漏。
  docking.dockviewApi.onDidActivePanelChange((event) => {
    if (!lifecycle.isDocumentsReady() || lifecycle.isRemovingDocument() || lifecycle.hasClosingDocuments()) return;
    const uri = event.panel ? documentUriForPanelId(event.panel.api.id) : undefined;
    if (uri) void lifecycle.activateWorkflowTab(uri);
  });
  docking.onDidRemoveDocument((uri) => void lifecycle.handleDocumentRemoved(uri));
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
    settings.readSettings();
    renderWorkflowSelect(bootstrap.workflows);
    renderInstances(bootstrap.instances);
    overview.reconcileSelection(true);
    overview.reconcileConfigurations(true);
    overview.render();
    sidebar.render();
    contentBrowser.render();
    document.querySelector<HTMLElement>('#settings-project-root')!.textContent = bootstrap.projectRoot;
    setStatus('桌面端已连接');
    const session = settings.restoreSessionOnStart() ? workspace.readWorkflowSession() : undefined;
    if (session) {
      workspace.applyWorkflowSession(session);
      // 上次退出时的未保存内容先落盘，避免恢复后标记变干净却丢失改动。
      void workspace.flushRestoredEdits();
    }
    lifecycle.reconcileDocumentPanels();
    lifecycle.setDocumentsReady();
    if (session) {
      docking.ensureLayout();
      await lifecycle.activateWorkflowTab(session.activeUri, true);
      workspace.setRestoreUri('');
      showToast(`已恢复上次的 ${session.tabs.length} 个画布`);
    } else {
      const fallback = settings.loadDefaultWorkflowOnStart() ? bootstrap.defaultWorkflow : undefined;
      if (fallback) await lifecycle.openWorkflowTab(fallback);
      else lifecycle.ensureFallbackDocument();
      docking.ensureLayout();
    }
    settings.restartInstanceRefresh();
  } catch (error) {
    loadingMask.classList.add('hidden');
    showToast(errorMessage(error), true);
    setStatus('初始化失败');
  }
}

window.addEventListener('beforeunload', () => {
  workspace.persistWorkflowSessionNow();
  workspace.cancelAutoSave();
  settings.dispose();
  lifecycle.suppressRemovals();
  sharedPanelDockBridge?.dispose();
  docking?.dispose();
  workbenchFrame?.dispose();
});

void start();
