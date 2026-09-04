import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Columns3,
  Copy,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FileJson2,
  Flag,
  Folder,
  FolderOpen,
  FoldVertical,
  GitBranch,
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
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Square,
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
  ReferenceGraph,
  ReferenceItem,
  ReferenceNode,
  RuntimeInstance,
  RuntimeOutputEvent,
  RuntimeStateEvent,
  WorkflowDescriptor,
  WorkflowEditorInit,
} from '../shared/contracts';
import {
  createDockingWorkspace,
  createWorkbenchFrame,
  connectSharedPanelDocking,
  type DockPanelId,
  type DockingController,
  type SharedDockPanelId,
  type SharedPanelDockBridge,
  type WorkbenchFrameController,
  type WorkbenchPanelId,
} from './docking';
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
  type: string;
  public: boolean;
}

interface EditorEnvelope {
  source?: string;
  frameId?: string;
  message?: Record<string, unknown>;
  state?: { dirty?: boolean };
}

interface RuntimeLogDescriptor {
  workflow: string;
  instance: string;
  startedAt: number;
  status: string;
  sources?: RuntimeStateEvent['sources'];
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
}

type ContentBrowserView = 'grid' | 'list';
type ContentBrowserItemKind = 'folder' | 'workflow' | 'asset';

interface ContentBrowserItem {
  kind: ContentBrowserItemKind;
  path: string;
  name: string;
  workflow?: WorkflowDescriptor;
  asset?: AssetImage;
}

const api = window.onmyoji;
const desktopIcons = {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  Columns3,
  Copy,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FileJson2,
  Flag,
  Folder,
  FolderOpen,
  FoldVertical,
  GitBranch,
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
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Square,
  UnfoldVertical,
  WandSparkles,
  Waypoints,
  Workflow,
  X,
};
const editorFrame = document.querySelector<HTMLIFrameElement>('#editor-frame')!;
const detailsFrame = document.querySelector<HTMLIFrameElement>('#details-frame')!;
const instanceSelect = document.querySelector<HTMLSelectElement>('#instance-select')!;
const structureView = document.querySelector<HTMLElement>('#structure-view')!;
const variablesView = document.querySelector<HTMLElement>('#variables-view')!;
const loadingMask = document.querySelector<HTMLElement>('#loading-mask')!;
const runtimeLogFrame = document.querySelector<HTMLIFrameElement>('#runtime-log-frame')!;
const contentBrowserTree = document.querySelector<HTMLElement>('#content-browser-tree')!;
const contentBrowserItems = document.querySelector<HTMLElement>('#content-browser-items')!;
const contentBrowserBreadcrumbs = document.querySelector<HTMLElement>('#content-browser-breadcrumbs')!;
const contentBrowserSearch = document.querySelector<HTMLInputElement>('#content-browser-search')!;
const settingsContentView = document.querySelector<HTMLSelectElement>('#settings-content-view')!;
const settingsAutoRefresh = document.querySelector<HTMLInputElement>('#settings-auto-refresh')!;
const settingsDefaultWorkflow = document.querySelector<HTMLInputElement>('#settings-default-workflow')!;
const settingsDebugEnabled = document.querySelector<HTMLInputElement>('#settings-debug-enabled')!;
const settingsDebugAnnotate = document.querySelector<HTMLInputElement>('#settings-debug-annotate')!;

let bootstrap: BootstrapData | undefined;
let currentUri = '';
let currentText = '';
let selectedInstance = '';
let backStack: string[] = [];
let editorReady = false;
let currentEditorInit: WorkflowEditorInit | undefined;
let dirty = false;
let sidebarNodes: SidebarNode[] = [];
let sidebarVariables: SidebarVariable[] = [];
let selectedNode = '';
let selectedVariable = '';
/** 结构树手动收起的分支节点 ID：重渲染（如切换选中节点）时保持折叠状态。 */
let collapsedTreeNodes = new Set<string>();
let toastTimer: number | undefined;
let instanceRefreshTimer: number | undefined;
let docking: DockingController | undefined;
let workbenchFrame: WorkbenchFrameController | undefined;
let sharedPanelDockBridge: SharedPanelDockBridge | undefined;
let contentAssets: AssetImage[] = [];
let contentBrowserFolder = '';
let contentBrowserQuery = '';
let contentBrowserView: ContentBrowserView = 'grid';
let selectedContentPath = '';
let runtimeLogReady = false;
let runtimeLogDescriptor: RuntimeLogDescriptor | undefined;
let runtimeLogEvents: Record<string, unknown>[] = [];
let runtimeEngineOutput = '';
let runtimeProcessResult: { code: number | null; signal: string | null; stopped: boolean } | undefined;
let autoRefreshInstances = true;
let loadDefaultWorkflowOnStart = true;
let moreMenu: { menu: HTMLElement; dismiss: (event: Event) => void; keyHandler: (event: KeyboardEvent) => void } | undefined;

function postToEditor(payload: Record<string, unknown>): void {
  postToFrame(editorFrame, payload);
}

function postToFrame(frame: HTMLIFrameElement, payload: Record<string, unknown>): void {
  frame.contentWindow?.postMessage({ source: 'desktop-shell', payload }, '*');
}

function postToEditors(payload: Record<string, unknown>): void {
  postToFrame(editorFrame, payload);
  postToFrame(detailsFrame, payload);
}

function postToRuntimeLog(payload: Record<string, unknown>): void {
  if (runtimeLogReady) runtimeLogFrame.contentWindow?.postMessage(payload, '*');
}

function sendRuntimeLogInit(): void {
  postToRuntimeLog({
    type: 'init',
    descriptor: runtimeLogDescriptor ?? null,
    events: runtimeLogEvents,
    engineOutput: runtimeEngineOutput,
    processResult: runtimeProcessResult,
  });
}

function clearRuntimeLog(): void {
  runtimeLogDescriptor = undefined;
  runtimeLogEvents = [];
  runtimeEngineOutput = '';
  runtimeProcessResult = undefined;
  postToRuntimeLog({ type: 'cleared' });
}

function markRuntimeLogReady(): void {
  runtimeLogReady = true;
  sendRuntimeLogInit();
}

runtimeLogFrame.addEventListener('load', markRuntimeLogReady);
if (runtimeLogFrame.contentDocument?.readyState === 'complete') window.queueMicrotask(markRuntimeLogReady);

function editorCommand(command: string, value?: unknown): void {
  postToEditor({ type: 'editorCommand', command, value });
}

function desktopControl(command: string, value?: unknown): void {
  postToEditor({ type: 'desktopControl', command, value });
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

function setDirty(value: boolean): void {
  dirty = value;
}

function workflowReference(file: WorkflowDescriptor): string {
  return file.rel.replace(/\\/g, '/').replace(/^workflows\//i, '');
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

function renderInstances(instances: RuntimeInstance[], requested = selectedInstance): void {
  const options = instances.map((instance) => {
    const option = document.createElement('option');
    option.value = instance.id;
    // 选中态高亮和行间距由内部行元素承担：Chromium 会把 option 自身的 margin/border 强制清零
    const row = document.createElement('span');
    row.className = 'select-row';
    row.textContent = instance.displayName
      || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
    option.appendChild(row);
    option.title = [instance.displayName, instance.id, instance.backend, instance.adbSerial].filter(Boolean).join(' · ');
    return option;
  });
  if (options.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.disabled = true;
    option.textContent = '未检测到运行实例';
    options.push(option);
  }
  instanceSelect.replaceChildren(...options);
  const ids = new Set(instances.map((instance) => instance.id));
  selectedInstance = ids.has(requested) ? requested : instances[0]?.id ?? '';
  instanceSelect.value = selectedInstance;
  document.querySelector<HTMLElement>('#instance-count')!.textContent = instances.length > 0
    ? `${instances.length} 个实例`
    : '未检测到实例';
}

function contentParent(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function contentName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function contentFolders(): string[] {
  const folders = new Set<string>(['']);
  const paths = [
    ...(bootstrap?.workflows.map((workflow) => workflow.rel.replace(/\\/g, '/')) ?? []),
    ...contentAssets.map((asset) => asset.path.replace(/\\/g, '/')),
  ];
  for (const itemPath of paths) {
    const parts = itemPath.split('/');
    parts.pop();
    let folder = '';
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      folders.add(folder);
    }
  }
  return [...folders];
}

function contentBrowserEntries(): ContentBrowserItem[] {
  const query = contentBrowserQuery.trim().toLocaleLowerCase('zh-CN');
  const workflows: ContentBrowserItem[] = (bootstrap?.workflows ?? []).map((workflow) => ({
    kind: 'workflow',
    path: workflow.rel.replace(/\\/g, '/'),
    name: workflow.name,
    workflow,
  }));
  const assets: ContentBrowserItem[] = contentAssets.map((asset) => ({
    kind: 'asset',
    path: asset.path.replace(/\\/g, '/'),
    name: contentName(asset.path),
    asset,
  }));
  if (query) {
    return [...workflows, ...assets].filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase('zh-CN').includes(query));
  }
  const folders: ContentBrowserItem[] = contentFolders()
    .filter((folder) => folder && contentParent(folder) === contentBrowserFolder)
    .map((folder) => ({ kind: 'folder', path: folder, name: contentName(folder) }));
  return [
    ...folders,
    ...workflows.filter((item) => contentParent(item.path) === contentBrowserFolder),
    ...assets.filter((item) => contentParent(item.path) === contentBrowserFolder),
  ].sort((left, right) => {
    const order: Record<ContentBrowserItemKind, number> = { folder: 0, workflow: 1, asset: 2 };
    return order[left.kind] - order[right.kind] || left.name.localeCompare(right.name, 'zh-CN');
  });
}

function navigateContentBrowser(folder: string): void {
  contentBrowserFolder = folder;
  contentBrowserQuery = '';
  contentBrowserSearch.value = '';
  selectedContentPath = '';
  renderContentBrowser();
}

function selectContentItem(button: HTMLButtonElement, item: ContentBrowserItem): void {
  selectedContentPath = item.path;
  contentBrowserItems.querySelectorAll('.content-item.selected').forEach((element) => element.classList.remove('selected'));
  button.classList.add('selected');
  document.querySelector<HTMLElement>('#content-browser-selection')!.textContent = item.path;
}

function createContentItem(item: ContentBrowserItem): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `content-item ${item.kind}${item.workflow?.uri === currentUri ? ' current' : ''}${item.path === selectedContentPath ? ' selected' : ''}`;
  button.type = 'button';
  button.title = item.path;
  button.setAttribute('role', 'listitem');

  const preview = document.createElement('span');
  preview.className = 'content-item-preview';
  if (item.kind === 'asset' && item.asset) {
    const image = document.createElement('img');
    image.src = item.asset.uri;
    image.alt = '';
    image.loading = 'lazy';
    preview.appendChild(image);
  } else {
    preview.innerHTML = `<i data-lucide="${item.kind === 'folder' ? 'folder' : 'file-json-2'}"></i>`;
  }
  const label = document.createElement('span');
  label.className = 'content-item-name';
  label.textContent = item.name;
  const path = document.createElement('span');
  path.className = 'content-item-path';
  path.textContent = contentBrowserQuery ? item.path : item.kind === 'folder' ? '文件夹' : item.kind === 'workflow' ? '工作流' : '模板图片';
  button.append(preview, label, path);
  button.addEventListener('click', () => selectContentItem(button, item));
  button.addEventListener('dblclick', () => {
    if (item.kind === 'folder') navigateContentBrowser(item.path);
    else if (item.workflow) desktopControl('switchWorkflow', item.workflow.uri);
    else if (item.asset) void api.openContentItem(item.asset.path).catch((error) => showToast(errorMessage(error), true));
  });
  if (item.kind !== 'folder') {
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      selectContentItem(button, item);
      showContentContextMenu(event, item, button);
    });
  }
  return button;
}

function renderContentBrowserTree(): void {
  contentBrowserTree.replaceChildren();
  const folders = contentFolders();
  const appendFolder = (folder: string, depth: number): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `content-folder-row${folder === contentBrowserFolder ? ' selected' : ''}`;
    button.style.setProperty('--depth', String(depth));
    button.innerHTML = `<i data-lucide="${folder === contentBrowserFolder ? 'folder-open' : 'folder'}"></i><span></span>`;
    button.querySelector('span')!.textContent = folder ? contentName(folder) : '项目内容';
    button.title = folder || '项目内容';
    button.addEventListener('click', () => navigateContentBrowser(folder));
    contentBrowserTree.appendChild(button);
    for (const child of folders.filter((candidate) => candidate && contentParent(candidate) === folder).sort((left, right) => left.localeCompare(right, 'zh-CN'))) {
      appendFolder(child, depth + 1);
    }
  };
  appendFolder('', 0);
}

function renderContentBrowserBreadcrumbs(): void {
  contentBrowserBreadcrumbs.replaceChildren();
  const folders = contentBrowserFolder ? contentBrowserFolder.split('/') : [];
  const paths = ['', ...folders.map((_, index) => folders.slice(0, index + 1).join('/'))];
  for (const path of paths) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'content-crumb';
    button.textContent = path ? contentName(path) : '项目内容';
    button.title = path || '项目内容';
    button.addEventListener('click', () => navigateContentBrowser(path));
    contentBrowserBreadcrumbs.appendChild(button);
  }
}

function renderContentBrowser(): void {
  const folders = new Set(contentFolders());
  if (!folders.has(contentBrowserFolder)) contentBrowserFolder = '';
  renderContentBrowserTree();
  renderContentBrowserBreadcrumbs();
  const entries = contentBrowserEntries();
  contentBrowserItems.className = `content-browser-items ${contentBrowserView}`;
  contentBrowserItems.replaceChildren(...entries.map(createContentItem));
  document.querySelector<HTMLElement>('#content-browser-empty')!.classList.toggle('hidden', entries.length > 0);
  document.querySelector<HTMLElement>('#content-browser-summary')!.textContent = `${entries.length} 项`;
  document.querySelector<HTMLElement>('#content-browser-selection')!.textContent = selectedContentPath;
  document.querySelector<HTMLButtonElement>('#content-browser-up')!.disabled = contentBrowserFolder === '';
  document.querySelectorAll<HTMLButtonElement>('[data-content-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.contentView === contentBrowserView);
  });
  createIcons({ icons: desktopIcons });
}

async function refreshContentBrowser(): Promise<void> {
  const refreshButton = document.querySelector<HTMLButtonElement>('#content-browser-refresh')!;
  refreshButton.disabled = true;
  refreshButton.classList.add('refreshing');
  try {
    const [assets, data] = await Promise.all([api.listAssets(), api.bootstrap()]);
    contentAssets = assets;
    if (bootstrap) {
      bootstrap.workflows = data.workflows;
      bootstrap.catalog = data.catalog;
    } else {
      bootstrap = data;
    }
    renderWorkflowSelect(data.workflows);
    renderContentBrowser();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('refreshing');
  }
}

/* ---------- 内容浏览器右键菜单 + 引用查看器 ---------- */

let contentContextMenu: { owner: Document; menu: HTMLElement; dismiss: (event: Event) => void; keyHandler: (event: KeyboardEvent) => void } | undefined;
let referenceViewerDocument: Document | undefined;
let referenceViewerPanel: HTMLElement | undefined;
let referenceViewerBody: HTMLElement | undefined;
let referenceViewerTrailEl: HTMLElement | undefined;
let referenceViewerKeyHandler: ((event: KeyboardEvent) => void) | undefined;
let referenceTrail: string[] = [];
let referenceViewerToken = 0;
let referenceViewerGraph: ReferenceGraph | undefined;
let referenceViewerCanvas: HTMLElement | undefined;
let referenceViewerZoom = 1;
let referenceViewerQuery = '';
let referenceViewerPan = { x: 0, y: 0 };
let referenceViewerResizeObserver: ResizeObserver | undefined;
let referenceViewerLocationDisposable: { dispose(): void } | undefined;

/** 把绝对路径转成项目相对路径（正斜杠）；不在项目内时原样返回。 */
function relativeToProject(absolutePath: string): string {
  const root = bootstrap?.projectRoot ?? '';
  const absolute = absolutePath.replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedRoot) return absolute;
  if (absolute.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return absolute.slice(normalizedRoot.length + 1);
  }
  if (absolute.toLowerCase() === normalizedRoot.toLowerCase()) return '';
  return absolute;
}

function closeContentContextMenu(): void {
  if (!contentContextMenu) return;
  const { owner, menu, dismiss, keyHandler } = contentContextMenu;
  owner.removeEventListener('pointerdown', dismiss, true);
  owner.removeEventListener('keydown', keyHandler, true);
  menu.remove();
  contentContextMenu = undefined;
}

function showContentContextMenu(event: MouseEvent, item: ContentBrowserItem, button: HTMLButtonElement): void {
  closeContentContextMenu();
  const doc = button.ownerDocument;
  const menu = doc.createElement('div');
  menu.className = 'content-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '内容操作');

  const addEntry = (label: string, icon: IconComponent, action: () => void): void => {
    const entry = doc.createElement('button');
    entry.type = 'button';
    entry.setAttribute('role', 'menuitem');
    entry.appendChild(createElement(icon, { width: '13', height: '13', 'aria-hidden': 'true' }));
    entry.appendChild(doc.createTextNode(label));
    entry.addEventListener('click', () => {
      closeContentContextMenu();
      action();
    });
    menu.appendChild(entry);
  };

  addEntry('引用查看器', Network, () => openReferenceViewer(item.path, doc));
  const separator = doc.createElement('div');
  separator.className = 'content-context-separator';
  menu.appendChild(separator);
  if (item.workflow) {
    addEntry('在编辑器中打开', FileJson2, () => desktopControl('switchWorkflow', item.workflow!.uri));
  } else if (item.asset) {
    addEntry('打开图片', Image, () => void api.openContentItem(item.asset!.path).catch((error) => showToast(errorMessage(error), true)));
  }

  doc.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const viewportWidth = doc.documentElement.clientWidth;
  const viewportHeight = doc.documentElement.clientHeight;
  menu.style.left = `${Math.max(4, Math.min(event.clientX, viewportWidth - rect.width - 6))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, viewportHeight - rect.height - 6))}px`;

  const dismiss = (pointerEvent: Event): void => {
    if (menu.contains(pointerEvent.target as Node)) return;
    closeContentContextMenu();
  };
  const keyHandler = (keyEvent: KeyboardEvent): void => {
    if (keyEvent.key === 'Escape') closeContentContextMenu();
  };
  doc.addEventListener('pointerdown', dismiss, true);
  doc.addEventListener('keydown', keyHandler, true);
  contentContextMenu = { owner: doc, menu, dismiss, keyHandler };
}

function closeReferenceViewer(): void {
  referenceViewerToken += 1;
  if (referenceViewerPanel && referenceViewerKeyHandler) {
    referenceViewerPanel.removeEventListener('keydown', referenceViewerKeyHandler, true);
  }
  workbenchFrame?.dockviewApi.getPanel('referenceViewer')?.api.close();
  referenceViewerPanel?.remove();
  referenceViewerResizeObserver?.disconnect();
  referenceViewerLocationDisposable?.dispose();
  referenceViewerPanel = undefined;
  referenceViewerBody = undefined;
  referenceViewerTrailEl = undefined;
  referenceViewerKeyHandler = undefined;
  referenceViewerDocument = undefined;
  referenceViewerGraph = undefined;
  referenceViewerCanvas = undefined;
  referenceViewerZoom = 1;
  referenceViewerQuery = '';
  referenceViewerPan = { x: 0, y: 0 };
  referenceViewerResizeObserver = undefined;
  referenceViewerLocationDisposable = undefined;
  referenceTrail = [];
}

function referenceKindIcon(kind: ReferenceNode['kind']): SVGSVGElement {
  const icon = kind === 'workflow' ? FileJson2 : kind === 'asset' ? Image : kind === 'catalog' ? Box : Waypoints;
  return createElement(icon, { width: '15', height: '15', 'aria-hidden': 'true' }) as SVGSVGElement;
}

function referenceKindLabel(kind: ReferenceNode['kind']): string {
  if (kind === 'workflow') return '工作流';
  if (kind === 'asset') return '模板图片';
  if (kind === 'catalog') return '奖励目录';
  return '其他';
}

function renderReferenceTrail(doc: Document): void {
  if (!referenceViewerTrailEl) return;
  const backButton = doc.querySelector<HTMLButtonElement>('.reference-viewer-nav button');
  if (backButton) backButton.disabled = referenceTrail.length <= 1;
  referenceViewerTrailEl.replaceChildren();
  referenceTrail.forEach((path, index) => {
    const crumb = doc.createElement('button');
    crumb.type = 'button';
    crumb.className = `reference-trail-crumb${index === referenceTrail.length - 1 ? ' current' : ''}`;
    crumb.textContent = contentName(path);
    crumb.title = path;
    crumb.addEventListener('click', () => {
      referenceTrail = referenceTrail.slice(0, index + 1);
      void renderReferenceViewer();
    });
    referenceViewerTrailEl!.appendChild(crumb);
    if (index < referenceTrail.length - 1) {
      const sep = doc.createElement('span');
      sep.className = 'reference-trail-sep';
      sep.textContent = '/';
      referenceViewerTrailEl!.appendChild(sep);
    }
  });
}

function referenceNodeMatches(node: ReferenceNode, query: string): boolean {
  if (!query) return true;
  const haystack = `${node.name} ${node.path} ${node.workflowId ?? ''}`.toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function appendReferenceNode(doc: Document, layer: HTMLElement, item: ReferenceItem | undefined, node: ReferenceNode, side: 'target' | 'incoming' | 'outgoing', x: number, y: number, width: number): void {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `reference-graph-node ${side} kind-${node.kind}${node.exists ? '' : ' missing'}`;
  button.style.left = `${x}px`;
  button.style.top = `${y}px`;
  button.style.width = `${width}px`;
  button.setAttribute('aria-label', `${referenceKindLabel(node.kind)} ${node.name}`);
  if (side !== 'target') {
    button.title = '点击查看该内容的引用';
    button.addEventListener('click', () => navigateReferenceViewer(node.path));
  }
  const icon = doc.createElement('span');
  icon.className = 'reference-graph-node-icon';
  icon.appendChild(referenceKindIcon(node.kind));
  const text = doc.createElement('span');
  text.className = 'reference-graph-node-text';
  const name = doc.createElement('strong');
  name.textContent = node.name;
  const pathEl = doc.createElement('small');
  pathEl.textContent = node.path;
  text.append(name, pathEl);
  if (item && item.contexts.length) {
    const count = doc.createElement('em');
    count.textContent = `${item.contexts.length} 处引用`;
    text.appendChild(count);
  }
  button.append(icon, text);
  layer.appendChild(button);
}

function renderReferenceGraph(doc: Document, graph: ReferenceGraph): void {
  const canvas = referenceViewerCanvas;
  if (!canvas) return;
  const zoomControls = canvas.querySelector<HTMLElement>('.reference-zoom-controls');
  canvas.replaceChildren();
  const edges = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edges.classList.add('reference-graph-edges');
  edges.setAttribute('aria-hidden', 'true');
  const layer = doc.createElement('div');
  layer.className = 'reference-graph-nodes';
  canvas.append(edges, layer);
  const width = Math.max(canvas.clientWidth, 320);
  const height = Math.max(canvas.clientHeight, 440);
  const hasBothSides = graph.referencedBy.length > 0 && graph.references.length > 0;
  const nodeWidth = hasBothSides
    ? Math.min(188, Math.max(108, (width - 80) / 3))
    : Math.min(188, Math.max(142, (width - 64) / 2));
  const nodeHeight = 70;
  const filteredIncoming = graph.referencedBy.filter((item) => referenceNodeMatches(item.target, referenceViewerQuery));
  const filteredOutgoing = graph.references.filter((item) => referenceNodeMatches(item.target, referenceViewerQuery));
  const centerX = hasBothSides
    ? width / 2 - nodeWidth / 2
    : filteredIncoming.length > 0
      ? width * .7 - nodeWidth / 2
      : filteredOutgoing.length > 0
        ? width * .3 - nodeWidth / 2
        : width / 2 - nodeWidth / 2;
  const centerY = height / 2 - nodeHeight / 2;
  const sideMargin = width >= 720 ? 70 : 18;
  const incomingX = sideMargin;
  const outgoingX = width - nodeWidth - sideMargin;
  const placeY = (index: number, total: number): number => Math.max(26, height / 2 - (total - 1) * 48 + index * 96 - nodeHeight / 2);
  const paths: string[] = [];
  filteredIncoming.forEach((item, index) => {
    const y = placeY(index, filteredIncoming.length);
    appendReferenceNode(doc, layer, item, item.target, 'incoming', incomingX, y, nodeWidth);
    const sy = y + nodeHeight / 2;
    paths.push(`M ${incomingX + nodeWidth} ${sy} C ${incomingX + nodeWidth + 80} ${sy}, ${centerX - 80} ${centerY + nodeHeight / 2}, ${centerX} ${centerY + nodeHeight / 2}`);
  });
  filteredOutgoing.forEach((item, index) => {
    const y = placeY(index, filteredOutgoing.length);
    appendReferenceNode(doc, layer, item, item.target, 'outgoing', outgoingX, y, nodeWidth);
    const sy = y + nodeHeight / 2;
    paths.push(`M ${centerX + nodeWidth} ${centerY + nodeHeight / 2} C ${centerX + nodeWidth + 80} ${centerY + nodeHeight / 2}, ${outgoingX - 80} ${sy}, ${outgoingX} ${sy}`);
  });
  appendReferenceNode(doc, layer, undefined, graph.target, 'target', centerX, centerY, nodeWidth);
  edges.setAttribute('viewBox', `0 0 ${width} ${height}`);
  edges.setAttribute('preserveAspectRatio', 'none');
  for (const pathData of paths) {
    const edge = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    edge.setAttribute('d', pathData);
    edge.classList.add('reference-graph-edge');
    edges.appendChild(edge);
  }
  if (zoomControls) canvas.appendChild(zoomControls);
  canvas.style.setProperty('--reference-zoom', String(referenceViewerZoom));
  canvas.style.setProperty('--reference-pan-x', `${referenceViewerPan.x}px`);
  canvas.style.setProperty('--reference-pan-y', `${referenceViewerPan.y}px`);
}

function observeReferenceCanvas(): void {
  const canvas = referenceViewerCanvas;
  if (!canvas) return;
  referenceViewerResizeObserver?.disconnect();
  const ownerWindow = canvas.ownerDocument.defaultView;
  const ResizeObserverCtor = ownerWindow?.ResizeObserver;
  if (!ownerWindow || !ResizeObserverCtor) return;
  let frameId: number | undefined;
  referenceViewerResizeObserver = new ResizeObserverCtor(() => {
    if (frameId !== undefined) ownerWindow.cancelAnimationFrame(frameId);
    frameId = ownerWindow.requestAnimationFrame(() => {
      frameId = undefined;
      const graph = referenceViewerGraph;
      if (graph && referenceViewerCanvas === canvas) renderReferenceGraph(canvas.ownerDocument, graph);
    });
  });
  referenceViewerResizeObserver.observe(canvas);
}

function createReferenceControl(doc: Document, label: string, value: string, type: 'number' | 'checkbox' = 'number'): HTMLElement {
  const row = doc.createElement('label');
  row.className = 'reference-filter-row';
  row.appendChild(doc.createTextNode(label));
  const input = doc.createElement('input');
  input.type = type;
  if (type === 'checkbox') input.checked = true;
  else { input.value = value; input.min = '1'; input.max = '20'; }
  row.appendChild(input);
  return row;
}

async function renderReferenceViewer(): Promise<void> {
  const doc = referenceViewerDocument;
  const body = referenceViewerBody;
  if (!doc || !body || referenceTrail.length === 0) return;
  const current = referenceTrail[referenceTrail.length - 1];
  const token = ++referenceViewerToken;

  renderReferenceTrail(doc);
  body.replaceChildren();
  const loading = doc.createElement('div');
  loading.className = 'reference-loading';
  const spinner = doc.createElement('span');
  spinner.className = 'loading-spinner';
  loading.append(spinner, doc.createTextNode('正在分析引用…'));
  body.appendChild(loading);

  let graph: ReferenceGraph;
  try {
    graph = await api.getReferenceGraph(current);
  } catch (error) {
    if (referenceViewerDocument !== doc || referenceViewerToken !== token || referenceTrail[referenceTrail.length - 1] !== current) return;
    body.replaceChildren();
    const failure = doc.createElement('div');
    failure.className = 'reference-section-empty';
    failure.textContent = `引用分析失败：${errorMessage(error)}`;
    body.appendChild(failure);
    showToast(errorMessage(error), true);
    return;
  }
  if (referenceViewerDocument !== doc || referenceViewerToken !== token || referenceTrail[referenceTrail.length - 1] !== current) return;

  referenceViewerGraph = graph;
  body.replaceChildren();
  const workspace = doc.createElement('div');
  workspace.className = 'reference-workspace';
  const sidebar = doc.createElement('aside');
  sidebar.className = 'reference-sidebar';
  const search = doc.createElement('label');
  search.className = 'reference-search';
  search.appendChild(createElement(Search, { width: '15', height: '15', 'aria-hidden': 'true' }));
  const searchInput = doc.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索...';
  searchInput.value = referenceViewerQuery;
  searchInput.addEventListener('input', () => { referenceViewerQuery = searchInput.value.trim(); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  search.appendChild(searchInput);
  sidebar.appendChild(search);
  sidebar.appendChild(createReferenceControl(doc, '搜索引用者深度', '1'));
  sidebar.appendChild(createReferenceControl(doc, '搜索依赖性深度', '1'));
  sidebar.appendChild(createReferenceControl(doc, '搜索宽度限制', '20', 'checkbox'));
  const filter = doc.createElement('label');
  filter.className = 'reference-filter-row';
  filter.appendChild(doc.createTextNode('集过滤器'));
  const select = doc.createElement('select');
  select.innerHTML = '<option>None</option><option>工作流</option><option>模板图片</option><option>奖励目录</option>';
  filter.appendChild(select);
  sidebar.appendChild(filter);
  const summary = doc.createElement('div');
  summary.className = 'reference-sidebar-summary';
  summary.innerHTML = `<strong>${graph.target.name}</strong><span>${graph.target.path}</span><span>${graph.referencedBy.length} 个引用者 · ${graph.references.length} 个依赖</span>`;
  sidebar.appendChild(summary);
  const canvas = doc.createElement('div');
  canvas.className = 'reference-graph-canvas';
  referenceViewerCanvas = canvas;
  let dragOrigin: { x: number; y: number; panX: number; panY: number } | undefined;
  canvas.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragOrigin = { x: event.clientX, y: event.clientY, panX: referenceViewerPan.x, panY: referenceViewerPan.y };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragOrigin) return;
    referenceViewerPan = { x: dragOrigin.panX + event.clientX - dragOrigin.x, y: dragOrigin.panY + event.clientY - dragOrigin.y };
    canvas.style.setProperty('--reference-pan-x', `${referenceViewerPan.x}px`);
    canvas.style.setProperty('--reference-pan-y', `${referenceViewerPan.y}px`);
  });
  const stopGraphDrag = (event: PointerEvent): void => {
    if (!dragOrigin) return;
    dragOrigin = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', stopGraphDrag);
  canvas.addEventListener('pointercancel', stopGraphDrag);
  const zoom = doc.createElement('div');
  zoom.className = 'reference-zoom-controls';
  const zoomOut = doc.createElement('button');
  zoomOut.type = 'button'; zoomOut.title = '缩小'; zoomOut.appendChild(createElement(Minus, { width: '14', height: '14', 'aria-hidden': 'true' }));
  zoomOut.addEventListener('click', () => { referenceViewerZoom = Math.max(.6, referenceViewerZoom - .1); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  const zoomIn = doc.createElement('button');
  zoomIn.type = 'button'; zoomIn.title = '放大'; zoomIn.appendChild(createElement(Plus, { width: '14', height: '14', 'aria-hidden': 'true' }));
  zoomIn.addEventListener('click', () => { referenceViewerZoom = Math.min(1.6, referenceViewerZoom + .1); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  zoom.append(zoomOut, zoomIn);
  canvas.appendChild(zoom);
  workspace.append(sidebar, canvas);
  body.appendChild(workspace);
  observeReferenceCanvas();
  window.requestAnimationFrame(() => renderReferenceGraph(doc, graph));
}

function openReferenceViewer(path: string, _sourceDocument: Document): void {
  closeReferenceViewer();
  const doc = document;
  referenceViewerDocument = doc;
  referenceTrail = [path];

  workbenchFrame?.show('referenceViewer');
  const host = doc.querySelector<HTMLElement>('#module-reference-viewer');
  if (!host) return;

  const panel = doc.createElement('div');
  panel.className = 'reference-viewer';
  panel.tabIndex = -1;

  const header = doc.createElement('div');
  header.className = 'reference-viewer-header';
  const trailEl = doc.createElement('div');
  trailEl.className = 'reference-viewer-trail';
  const nav = doc.createElement('div');
  nav.className = 'reference-viewer-nav';
  const backButton = doc.createElement('button');
  backButton.type = 'button'; backButton.className = 'panel-action'; backButton.title = '后退';
  backButton.disabled = true;
  backButton.appendChild(createElement(ArrowLeft, { width: '14', height: '14', 'aria-hidden': 'true' }));
  backButton.addEventListener('click', () => { if (referenceTrail.length > 1) { referenceTrail.pop(); void renderReferenceViewer(); } });
  nav.appendChild(backButton);
  const refreshButton = doc.createElement('button');
  refreshButton.type = 'button'; refreshButton.className = 'panel-action'; refreshButton.title = '刷新';
  refreshButton.appendChild(createElement(RefreshCw, { width: '14', height: '14', 'aria-hidden': 'true' }));
  refreshButton.addEventListener('click', () => void renderReferenceViewer());
  nav.appendChild(refreshButton);
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'panel-action';
  closeButton.title = '关闭 (Esc)';
  closeButton.setAttribute('aria-label', '关闭');
  closeButton.appendChild(createElement(X, { width: '14', height: '14', 'aria-hidden': 'true' }));
  closeButton.addEventListener('click', closeReferenceViewer);
  header.append(nav, trailEl, closeButton);

  const body = doc.createElement('div');
  body.className = 'reference-viewer-body';

  const footer = doc.createElement('div');
  footer.className = 'reference-viewer-footer';
  footer.textContent = '拖动画布可浏览引用关系 · 点击节点逐层跳转 · Esc 关闭';

  panel.append(header, body, footer);
  host.replaceChildren(panel);

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeReferenceViewer();
  };
  panel.addEventListener('keydown', keyHandler, true);

  referenceViewerPanel = panel;
  referenceViewerBody = body;
  referenceViewerTrailEl = trailEl;
  referenceViewerKeyHandler = keyHandler;

  const dockPanel = workbenchFrame?.dockviewApi.getPanel('referenceViewer');
  referenceViewerLocationDisposable = dockPanel?.api.onDidLocationChange(() => {
    window.setTimeout(() => {
      const ownerDocument = referenceViewerPanel?.ownerDocument;
      if (dockPanel.api.location.type === 'popout' && ownerDocument && ownerDocument !== document) {
        ownerDocument.title = '引用查看器 - Onmyoji Studio';
        const popoutTitle = ownerDocument.querySelector<HTMLElement>('.popout-title');
        if (popoutTitle) popoutTitle.textContent = '引用查看器';
      }
      observeReferenceCanvas();
      if (referenceViewerGraph && referenceViewerCanvas) renderReferenceGraph(referenceViewerCanvas.ownerDocument, referenceViewerGraph);
    }, 0);
  });

  void renderReferenceViewer();
  window.setTimeout(() => workbenchFrame?.popout('referenceViewer'), 0);
}

/** 跳转到引用图中的另一个节点（层层跳转）。 */
function navigateReferenceViewer(path: string): void {
  referenceTrail.push(path);
  referenceViewerQuery = '';
  referenceViewerPan = { x: 0, y: 0 };
  void renderReferenceViewer();
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
    row.title = `${node.name}\n${node.meta}`;
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
    row.addEventListener('click', (event) => {
      if (hasChildren && event.target instanceof Node && chevron.contains(event.target)) {
        toggleTreeNode(node.id, row, children);
        return;
      }
      docking?.showPanel('details');
      editorCommand('focusNode', node.id);
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
function syncVariableSelection(previousVariable: string): void {
  if (previousVariable === selectedVariable) return;
  const previousRow = variablesView.querySelector<HTMLButtonElement>(`.variable-row[data-variable-name="${CSS.escape(previousVariable)}"]`);
  if (previousRow) previousRow.classList.remove('selected');
  const nextRow = variablesView.querySelector<HTMLButtonElement>(`.variable-row[data-variable-name="${CSS.escape(selectedVariable)}"]`);
  nextRow?.classList.add('selected');
}

/** 变量列表内容指纹：名称、类型、public 标记有变化时需要重建列表。 */
function variableSignature(): string {
  return sidebarVariables.map((variable) => `${variable.name}\u0001${variable.type}\u0001${variable.public ? 1 : 0}`).join('\u0004');
}

function renderVariables(): void {
  variablesView.replaceChildren();
  if (sidebarVariables.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel';
    empty.textContent = '此工作流还没有变量';
    variablesView.appendChild(empty);
    return;
  }
  for (const variable of sidebarVariables) {
    const row = document.createElement('button');
    row.className = `variable-row${variable.name === selectedVariable ? ' selected' : ''}`;
    row.title = `${variable.public ? '公开变量，可由父工作流传值' : '内部变量'}\n拖到画布可创建变量卡片`;
    row.dataset.variableName = variable.name;
    row.innerHTML = '<span class="variable-icon"></span><span class="variable-name"></span><span class="variable-flags"></span>';
    row.querySelector<HTMLElement>('.variable-name')!.textContent = variable.name;
    const flags = row.querySelector<HTMLElement>('.variable-flags')!;
    flags.innerHTML = `<span>${variable.type}</span>${variable.public ? '<span class="variable-public">PUBLIC</span>' : ''}`;
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      transfer.setData('application/x-onmyoji-variable', variable.name);
      transfer.effectAllowed = 'copy';
    });
    row.addEventListener('click', () => {
      docking?.showPanel('details');
      editorCommand('selectVariable', variable.name);
    });
    variablesView.appendChild(row);
  }
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
  createIcons({ icons: desktopIcons });
}

async function loadWorkflow(uri: string, addToBackStack = false): Promise<void> {
  if (!uri) return;
  loadingMask.classList.remove('hidden');
  try {
    if (addToBackStack && currentUri && currentUri !== uri) backStack.push(currentUri);
    const init = await api.getWorkflowInit(uri, selectedInstance, backStack.length > 0);
    currentEditorInit = init;
    if (init.document.uri !== currentUri) collapsedTreeNodes = new Set();
    currentUri = init.document.uri;
    init.workflowTrail = workflowTrail();
    currentText = init.document.text;
    selectedInstance = init.selectedInstance;
    if (bootstrap) {
      bootstrap.workflows = init.workflows;
      bootstrap.instances = init.instances;
    }
    renderWorkflowSelect(init.workflows);
    renderInstances(init.instances, init.selectedInstance);
    renderContentBrowser();
    document.querySelector<HTMLElement>('#document-path')!.textContent = displayFileUri(init.document.uri);
    setDirty(false);
    postToEditors(init as unknown as Record<string, unknown>);
    setStatus(init.issues.length > 0 ? `${init.issues.length} 个校验问题` : '工作流已载入');
  } catch (error) {
    showToast(errorMessage(error), true);
    setStatus('载入失败');
  } finally {
    loadingMask.classList.add('hidden');
  }
}

async function refreshInstances(): Promise<void> {
  try {
    const instances = await api.listInstances();
    renderInstances(instances, selectedInstance);
    postToEditors({ type: 'runtimeInstances', instances, selectedInstance });
  } catch {
    // Device discovery is best effort while the user edits offline.
  }
}

async function handleEditorMessage(message: Record<string, unknown>, sourceFrame: HTMLIFrameElement): Promise<void> {
  const type = String(message.type ?? '');
  try {
    if (type === 'ready') {
      if (sourceFrame === editorFrame) editorReady = true;
      if (currentEditorInit) postToFrame(sourceFrame, currentEditorInit as unknown as Record<string, unknown>);
      else if (sourceFrame === editorFrame && bootstrap?.defaultWorkflow) await loadWorkflow(currentUri || bootstrap.defaultWorkflow);
      return;
    }
    if (type === 'documentStateChanged') {
      const text = String(message.text ?? '');
      if (!text) return;
      currentText = text;
      if (currentEditorInit) currentEditorInit.document.text = text;
      setDirty(message.dirty !== false);
      const targetFrame = sourceFrame === editorFrame ? detailsFrame : editorFrame;
      postToFrame(targetFrame, { type: 'replaceDocument', text, recordHistory: true });
      return;
    }
    if (type === 'inspectorRequested') {
      if (sourceFrame !== editorFrame) return;
      const selection = message.inspectorSelection as unknown as InspectorSelection;
      docking?.showPanel('details');
      postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
      return;
    }
    if (type === 'sidebarStateChanged') {
      if (sourceFrame !== editorFrame) return;
      const previousTreeSignature = treeSignature();
      const previousVariableSignature = variableSignature();
      const previousSelectedNode = selectedNode;
      const previousSelectedVariable = selectedVariable;
      sidebarVariables = Array.isArray(message.variables) ? message.variables as SidebarVariable[] : [];
      sidebarNodes = Array.isArray(message.nodes) ? message.nodes as SidebarNode[] : [];
      selectedVariable = typeof message.selectedVariable === 'string' ? message.selectedVariable : '';
      selectedNode = typeof message.selectedNode === 'string' ? message.selectedNode : '';
      const treeUnchanged = sidebarNodes.length > 0 && treeSignature() === previousTreeSignature;
      const variablesUnchanged = variableSignature() === previousVariableSignature;
      if (treeUnchanged && variablesUnchanged) {
        // 结构与变量都没变（如仅在画布上切换选中节点）：只更新选中行，不重建树，
        // 展开状态、折叠状态与滚动位置都原样保留。
        syncTreeSelection(previousSelectedNode);
        syncVariableSelection(previousSelectedVariable);
      } else if (treeUnchanged) {
        // 结构没变但变量列表变了：仅重建变量列表。
        renderVariables();
        createIcons({ icons: desktopIcons });
      } else {
        renderSidebar();
      }
      const selection = message.inspectorSelection as unknown as InspectorSelection | undefined;
      if (selection && selection.kind !== 'none') {
        docking?.showPanel('details');
        postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
      }
      return;
    }
    if (type === 'save') {
      const text = String(message.text ?? '');
      await api.saveWorkflow(currentUri, text);
      currentText = text;
      if (currentEditorInit) currentEditorInit.document.text = text;
      setDirty(false);
      setStatus('工作流已保存');
      showToast('工作流已保存');
      return;
    }
    if (type === 'switchWorkflow') {
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      backStack = [];
      await loadWorkflow(String(message.uri ?? ''));
      return;
    }
    if (type === 'openSubWorkflow') {
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
      await loadWorkflow(resolved.uri, true);
      return;
    }
    if (type === 'goBackWorkflow') {
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      const previous = backStack.pop();
      if (previous) await loadWorkflow(previous);
      return;
    }
    if (type === 'navigateWorkflowTrail') {
      const index = Number(message.index);
      const trail = [...backStack, currentUri];
      if (!Number.isInteger(index) || index < 0 || index >= trail.length - 1) return;
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      backStack = trail.slice(0, index);
      await loadWorkflow(trail[index]);
      return;
    }
    if (type === 'reloadRequest') {
      await loadWorkflow(currentUri);
      return;
    }
    if (type === 'runWorkflow') {
      const text = String(message.text ?? currentText);
      currentText = text;
      await api.runWorkflow({ uri: currentUri, instanceId: String(message.instanceId ?? selectedInstance), text });
      setDirty(false);
      if (sharedPanelDockBridge) sharedPanelDockBridge.show('runtime');
      else docking?.showPanel('runtime');
      return;
    }
    if (type === 'stopWorkflow') {
      await api.stopWorkflow();
      return;
    }
    if (type === 'selectInstance') {
      selectedInstance = String(message.instanceId ?? selectedInstance);
      instanceSelect.value = selectedInstance;
      postToEditors({ type: 'instanceSelected', instanceId: selectedInstance });
      return;
    }
    if (type === 'pickRoi') {
      const referenceResolution: [number, number] = Array.isArray(message.referenceResolution)
        ? message.referenceResolution as [number, number]
        : [1920, 1080];
      const result = await api.captureRoi({ instanceId: String(message.instanceId ?? selectedInstance), referenceResolution });
      postToFrame(sourceFrame, { type: 'roiPickerImage', requestId: message.requestId, nodeId: message.nodeId ?? message.stepId, key: message.key, ...result, referenceResolution });
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
      const uri = await api.createWorkflow();
      if (uri) {
        bootstrap!.workflows = (await api.bootstrap()).workflows;
        backStack = [];
        await loadWorkflow(uri);
      }
      return;
    }
    if (type === 'openFile') {
      await api.openWorkflowFile(currentUri);
      return;
    }
    if (type === 'openWorkflowPicker') {
      sharedPanelDockBridge?.show('contentBrowser');
      window.setTimeout(() => contentBrowserSearch.focus(), 0);
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
      if (relative) openReferenceViewer(relative, document);
      else showToast('无法定位当前工作流的项目路径', true);
      return;
    }
    if (type === 'error') throw new Error(String(message.message ?? '编辑器错误'));
  } catch (error) {
    const text = errorMessage(error);
    if (type === 'pickRoi' || type === 'saveTemplate') postToFrame(sourceFrame, { type: 'roiPickerError', requestId: message.requestId, message: text });
    else if (type === 'checkTemplate') postToFrame(sourceFrame, { type: 'templateCheckError', requestId: message.requestId, message: text });
    else if (type === 'listAssetImages') postToFrame(sourceFrame, { type: 'assetImagesError', requestId: message.requestId, message: text });
    else if (type === 'requestAssetData') postToFrame(sourceFrame, { type: 'assetDataError', requestId: message.requestId, message: text });
    else if (type === 'saveCanvasImage') postToFrame(sourceFrame, { type: 'canvasImageError', message: text });
    showToast(text, true);
    setStatus('操作失败');
  }
}

function appendOutput(event: RuntimeOutputEvent): void {
  runtimeEngineOutput += event.text;
  if (runtimeEngineOutput.length > 300_000) runtimeEngineOutput = runtimeEngineOutput.slice(-300_000);
  postToRuntimeLog({ type: 'engineOutput', chunk: event.text, stream: event.stream });
}

function updateRuntimeState(event: RuntimeStateEvent): void {
  if (event.state === 'running') {
    const workflow = String(event.workflow || currentUri).replace(/\\/g, '/').split('/').pop() || '工作流';
    runtimeLogDescriptor = {
      workflow,
      instance: event.sources?.length ? `${event.sources.length} 个实例` : event.instance || selectedInstance,
      startedAt: event.startedAt ?? Date.now(),
      status: 'running',
      sources: event.sources,
    };
    runtimeLogEvents = [];
    runtimeEngineOutput = '';
    runtimeProcessResult = undefined;
    sendRuntimeLogInit();
  } else if (event.state === 'succeeded' || event.state === 'failed' || event.state === 'idle') {
    runtimeProcessResult = {
      code: event.exitCode ?? (event.state === 'failed' ? -1 : 0),
      signal: null,
      stopped: event.state === 'idle',
    };
    postToRuntimeLog({ type: 'processFinished', ...runtimeProcessResult });
  }
  const running = event.state === 'running' || event.state === 'stopping';
  document.querySelector<HTMLButtonElement>('#run-button')!.disabled = running;
  document.querySelector<HTMLButtonElement>('#stop-button')!.disabled = !running;
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
  createIcons({ icons: desktopIcons });
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
      void handleEditorMessage({ type: action.type }, editorFrame);
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
  settingsContentView.value = contentBrowserView;
  settingsAutoRefresh.checked = autoRefreshInstances;
  settingsDefaultWorkflow.checked = loadDefaultWorkflowOnStart;
  void refreshDebugSettings().catch((error) => showToast(`读取 Debug 设置失败：${String(error)}`));
  workbenchFrame?.show('settings');
  window.setTimeout(() => workbenchFrame?.popout('settings'), 0);
}

function readSettings(): void {
  autoRefreshInstances = window.localStorage.getItem('onmyoji-studio.settings.auto-refresh') !== 'false';
  loadDefaultWorkflowOnStart = window.localStorage.getItem('onmyoji-studio.settings.default-workflow') !== 'false';
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
  document.querySelectorAll<HTMLElement>('[data-editor-command]').forEach((button) => {
    button.addEventListener('click', () => {
      const command = button.dataset.editorCommand ?? '';
      if (command === 'workflowSettings') docking?.showPanel('details');
      editorCommand(command);
    });
  });
  document.querySelectorAll<HTMLElement>('[data-desktop-command]').forEach((button) => {
    button.addEventListener('click', () => desktopControl(button.dataset.desktopCommand ?? ''));
  });
  document.querySelectorAll<HTMLElement>('[data-app-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.appCommand === 'settings') openSettingsPanel();
    });
  });
  settingsContentView.addEventListener('change', () => {
    contentBrowserView = settingsContentView.value === 'list' ? 'list' : 'grid';
    window.localStorage.setItem('onmyoji-studio.content-browser-view', contentBrowserView);
    renderContentBrowser();
  });
  settingsAutoRefresh.addEventListener('change', () => {
    autoRefreshInstances = settingsAutoRefresh.checked;
    window.localStorage.setItem('onmyoji-studio.settings.auto-refresh', String(autoRefreshInstances));
    restartInstanceRefresh();
  });
  settingsDefaultWorkflow.addEventListener('change', () => {
    loadDefaultWorkflowOnStart = settingsDefaultWorkflow.checked;
    window.localStorage.setItem('onmyoji-studio.settings.default-workflow', String(loadDefaultWorkflowOnStart));
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
        if (workbenchFrame?.isOpen('referenceViewer')) closeReferenceViewer();
        else if (currentUri) {
          const relative = relativeToProject(displayFileUri(currentUri));
          if (relative) openReferenceViewer(relative, document);
        }
      } else if (panelId !== 'workflow') toggleSharedPanel(panelId);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-dock-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.dockCommand === 'popoutActive') popoutActivePanel();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-layout-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.layoutCommand === 'reset') docking?.resetLayout();
      if (button.dataset.layoutCommand === 'reset') workbenchFrame?.resetLayout();
      if (button.dataset.layoutCommand === 'reset') sharedPanelDockBridge?.resetSurfaces();
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
  document.querySelector('#add-variable-button')!.addEventListener('click', () => editorCommand('addVariable'));
  document.querySelector('#new-workflow-button')!.addEventListener('click', () => void handleEditorMessage({ type: 'newWorkflow' }, editorFrame));
  document.querySelector('#run-button')!.addEventListener('click', () => desktopControl('run'));
  document.querySelector('#stop-button')!.addEventListener('click', () => desktopControl('stop'));
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
  instanceSelect.addEventListener('change', () => desktopControl('selectInstance', instanceSelect.value));
  document.querySelector('#content-browser-up')!.addEventListener('click', () => navigateContentBrowser(contentParent(contentBrowserFolder)));
  document.querySelector('#content-browser-refresh')!.addEventListener('click', () => void refreshContentBrowser());
  contentBrowserSearch.addEventListener('input', () => {
    contentBrowserQuery = contentBrowserSearch.value;
    selectedContentPath = '';
    renderContentBrowser();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-content-view]').forEach((button) => {
    button.addEventListener('click', () => {
      contentBrowserView = button.dataset.contentView === 'list' ? 'list' : 'grid';
      window.localStorage.setItem('onmyoji-studio.content-browser-view', contentBrowserView);
      renderContentBrowser();
    });
  });
  document.addEventListener('click', closeTitlebarMenus);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeTitlebarMenus();
    }
    if (event.shiftKey && event.key === 'F6') {
      event.preventDefault();
      popoutActivePanel();
    }
  });
  window.addEventListener('blur', closeTitlebarMenus);
}

window.addEventListener('message', (event: MessageEvent<EditorEnvelope>) => {
  const runtimeEnvelope = event.data as RuntimeLogEnvelope;
  if (event.source === runtimeLogFrame.contentWindow && runtimeEnvelope.source === 'desktop-run-log') {
    const type = runtimeEnvelope.message?.type;
    if (type === 'ready') {
      runtimeLogReady = true;
      sendRuntimeLogInit();
    } else if (type === 'stopWorkflow') {
      void api.stopWorkflow();
    } else if (type === 'clear') {
      clearRuntimeLog();
    }
    return;
  }

  const sourceFrame = event.data?.source === 'dockview-popout'
    ? event.data.frameId === editorFrame.id
      ? editorFrame
      : event.data.frameId === detailsFrame.id
        ? detailsFrame
        : undefined
    : event.source === editorFrame.contentWindow
      ? editorFrame
      : event.source === detailsFrame.contentWindow
        ? detailsFrame
        : undefined;
  if (!sourceFrame) return;
  if ((event.data?.source === 'legacy-editor' || event.data?.source === 'dockview-popout') && event.data.message) {
    void handleEditorMessage(event.data.message, sourceFrame);
  }
  if (event.data?.source === 'legacy-editor-state' || event.data?.source === 'dockview-popout' && event.data.state) {
    const frameDirty = Boolean(event.data.state?.dirty);
    if (sourceFrame === editorFrame || frameDirty) setDirty(frameDirty);
  }
});

async function start(): Promise<void> {
  const showPopoutFailure = (): void => showToast('无法打开独立模块窗口', true);
  workbenchFrame = createWorkbenchFrame(updateDockMenuState, showPopoutFailure);
  docking = createDockingWorkspace(updateDockMenuState, showPopoutFailure);
  sharedPanelDockBridge = connectSharedPanelDocking(docking, workbenchFrame, updateDockMenuState);
  updateDockMenuState();
  createIcons({ icons: desktopIcons });
  bindUi();
  api.onRuntimeOutput(appendOutput);
  api.onRuntimeState(updateRuntimeState);
  api.onRunEvent((event) => {
    runtimeLogEvents.push(event);
    if (runtimeLogEvents.length > 5000) runtimeLogEvents = runtimeLogEvents.slice(-5000);
    postToRuntimeLog({ type: 'runEvent', event });
    postToEditors({ type: 'runEvent', event });
  });
  api.onWindowMaximized(updateMaximizedState);
  updateMaximizedState(await api.isWindowMaximized());
  try {
    const [bootstrapData, assets] = await Promise.all([api.bootstrap(), api.listAssets()]);
    bootstrap = bootstrapData;
    contentAssets = assets;
    readSettings();
    contentBrowserView = window.localStorage.getItem('onmyoji-studio.content-browser-view') === 'list' ? 'list' : 'grid';
    renderWorkflowSelect(bootstrap.workflows);
    renderInstances(bootstrap.instances);
    renderSidebar();
    renderContentBrowser();
    document.querySelector<HTMLElement>('#settings-project-root')!.textContent = bootstrap.projectRoot;
    setStatus('桌面端已连接');
    if (loadDefaultWorkflowOnStart && editorReady && bootstrap.defaultWorkflow) await loadWorkflow(bootstrap.defaultWorkflow);
    else postToEditors({ type: 'desktopPing' });
    restartInstanceRefresh();
  } catch (error) {
    loadingMask.classList.add('hidden');
    showToast(errorMessage(error), true);
    setStatus('初始化失败');
  }
}

window.addEventListener('beforeunload', () => {
  if (instanceRefreshTimer !== undefined) window.clearInterval(instanceRefreshTimer);
  sharedPanelDockBridge?.dispose();
  docking?.dispose();
  workbenchFrame?.dispose();
});

void start();
