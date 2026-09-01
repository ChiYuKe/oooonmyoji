import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronUp,
  Columns3,
  Copy,
  Ellipsis,
  FilePlus2,
  FileJson2,
  Folder,
  FolderOpen,
  GitBranch,
  Image,
  ImageDown,
  LayoutGrid,
  List,
  ListTree,
  Maximize,
  Minus,
  MonitorUp,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Square,
  WandSparkles,
  X,
  createIcons,
} from 'lucide';
import 'dockview/dist/styles/dockview.css';
import type {
  BootstrapData,
  AssetImage,
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
  ChevronUp,
  Columns3,
  Copy,
  Ellipsis,
  FilePlus2,
  FileJson2,
  Folder,
  FolderOpen,
  GitBranch,
  Image,
  ImageDown,
  LayoutGrid,
  List,
  ListTree,
  Maximize,
  Minus,
  MonitorUp,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Square,
  WandSparkles,
  X,
};
const editorFrame = document.querySelector<HTMLIFrameElement>('#editor-frame')!;
const detailsFrame = document.querySelector<HTMLIFrameElement>('#details-frame')!;
const workflowSelect = document.querySelector<HTMLSelectElement>('#workflow-select')!;
const instanceSelect = document.querySelector<HTMLSelectElement>('#instance-select')!;
const structureView = document.querySelector<HTMLElement>('#structure-view')!;
const variablesView = document.querySelector<HTMLElement>('#variables-view')!;
const loadingMask = document.querySelector<HTMLElement>('#loading-mask')!;
const dirtyIndicator = document.querySelector<HTMLElement>('#dirty-indicator')!;
const runtimeLogFrame = document.querySelector<HTMLIFrameElement>('#runtime-log-frame')!;
const contentBrowserTree = document.querySelector<HTMLElement>('#content-browser-tree')!;
const contentBrowserItems = document.querySelector<HTMLElement>('#content-browser-items')!;
const contentBrowserBreadcrumbs = document.querySelector<HTMLElement>('#content-browser-breadcrumbs')!;
const contentBrowserSearch = document.querySelector<HTMLInputElement>('#content-browser-search')!;

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
  dirtyIndicator.classList.toggle('dirty', value);
  dirtyIndicator.title = value ? '有未保存修改' : '已保存';
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
  workflowSelect.replaceChildren(...workflows.map((file) => {
    const option = document.createElement('option');
    option.value = file.uri;
    option.textContent = `${file.name}  ·  ${file.rel.replace(/^workflows\//, '')}`;
    option.title = file.description || file.rel;
    return option;
  }));
  workflowSelect.value = currentUri;
  document.querySelector<HTMLElement>('#workflow-count')!.textContent = `${workflows.length} 个工作流`;
}

function renderInstances(instances: RuntimeInstance[], requested = selectedInstance): void {
  instanceSelect.replaceChildren(...instances.map((instance) => {
    const option = document.createElement('option');
    option.value = instance.id;
    option.textContent = instance.displayName ? `${instance.displayName} · ${instance.id}` : instance.id;
    option.title = [instance.backend, instance.adbSerial].filter(Boolean).join(' · ');
    return option;
  }));
  const ids = new Set(instances.map((instance) => instance.id));
  selectedInstance = ids.has(requested) ? requested : instances[0]?.id ?? 'mumu-0';
  instanceSelect.value = selectedInstance;
  document.querySelector<HTMLElement>('#instance-count')!.textContent = `${instances.length} 个实例`;
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

function createTreeRows(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const byId = new Map(sidebarNodes.map((node) => [node.id, node]));
  const childIds = new Set(sidebarNodes.flatMap((node) => node.children));
  const roots = sidebarNodes.filter((node) => !childIds.has(node.id));
  const visited = new Set<string>();

  const appendNode = (node: SidebarNode, depth: number): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const row = document.createElement('button');
    row.className = `tree-row${node.id === selectedNode ? ' selected' : ''}`;
    row.style.setProperty('--depth', String(depth));
    row.title = `${node.name}\n${node.meta}`;
    row.innerHTML = `<span class="tree-chevron"></span><span class="node-type-glyph ${node.type}"></span><span class="tree-label"></span>`;
    const label = row.querySelector<HTMLElement>('.tree-label')!;
    label.textContent = node.name;
    if (node.children.length > 0) row.querySelector<HTMLElement>('.tree-chevron')!.innerHTML = '<i data-lucide="chevron-down"></i>';
    row.addEventListener('click', () => {
      docking?.showPanel('details');
      editorCommand('focusNode', node.id);
    });
    fragment.appendChild(row);
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (child) appendNode(child, depth + 1);
    }
  };
  for (const root of roots) appendNode(root, 0);
  for (const node of sidebarNodes) appendNode(node, 0);
  return fragment;
}

function renderSidebar(): void {
  structureView.replaceChildren();
  if (sidebarNodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel';
    empty.textContent = '打开工作流后显示节点结构';
    structureView.appendChild(empty);
  } else {
    structureView.appendChild(createTreeRows());
  }

  variablesView.replaceChildren();
  if (sidebarVariables.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel';
    empty.textContent = '此工作流还没有变量';
    variablesView.appendChild(empty);
  } else {
    for (const variable of sidebarVariables) {
      const row = document.createElement('button');
      row.className = `variable-row${variable.name === selectedVariable ? ' selected' : ''}`;
      row.title = variable.public ? '公开变量，可由父工作流传值' : '内部变量';
      row.innerHTML = '<span class="variable-icon"></span><span class="variable-name"></span><span class="variable-flags"></span>';
      row.querySelector<HTMLElement>('.variable-name')!.textContent = variable.name;
      const flags = row.querySelector<HTMLElement>('.variable-flags')!;
      flags.innerHTML = `<span>${variable.type}</span>${variable.public ? '<span class="variable-public">PUBLIC</span>' : ''}`;
      row.addEventListener('click', () => {
        docking?.showPanel('details');
        editorCommand('selectVariable', variable.name);
      });
      variablesView.appendChild(row);
    }
  }
  createIcons({ icons: desktopIcons });
}

async function loadWorkflow(uri: string, addToBackStack = false): Promise<void> {
  if (!uri) return;
  loadingMask.classList.remove('hidden');
  try {
    if (addToBackStack && currentUri && currentUri !== uri) backStack.push(currentUri);
    const init = await api.getWorkflowInit(uri, selectedInstance, backStack.length > 0);
    currentEditorInit = init;
    currentUri = init.document.uri;
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
    document.querySelector<HTMLButtonElement>('#back-button')!.disabled = backStack.length === 0;
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
      sidebarVariables = Array.isArray(message.variables) ? message.variables as SidebarVariable[] : [];
      sidebarNodes = Array.isArray(message.nodes) ? message.nodes as SidebarNode[] : [];
      selectedVariable = typeof message.selectedVariable === 'string' ? message.selectedVariable : '';
      selectedNode = typeof message.selectedNode === 'string' ? message.selectedNode : '';
      renderSidebar();
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
    if (type === 'reloadRequest') {
      await loadWorkflow(currentUri);
      return;
    }
    if (type === 'runWorkflow') {
      const text = String(message.text ?? currentText);
      currentText = text;
      await api.runWorkflow({ uri: currentUri, instanceId: String(message.instanceId ?? selectedInstance), text });
      setDirty(false);
      docking?.showPanel('runtime');
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
      workflowSelect.focus();
      return;
    }
    if (type === 'openWorkflowTree') {
      showToast('结构树已显示在左侧');
      return;
    }
    if (type === 'openReferences') {
      showToast('子工作流引用可在结构树和节点详情中查看');
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

function closeTitlebarMenus(): void {
  document.querySelectorAll<HTMLElement>('.menu-root.open').forEach((root) => {
    root.classList.remove('open');
    root.querySelector<HTMLButtonElement>('.menu-trigger')?.setAttribute('aria-expanded', 'false');
  });
}

function updateDockMenuState(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-workbench-panel]').forEach((button) => {
    const panelId = button.dataset.workbenchPanel as WorkbenchPanelId;
    const open = panelId !== 'workflow'
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
  document.querySelectorAll<HTMLButtonElement>('[data-dock-panel]').forEach((button) => {
    button.addEventListener('click', () => docking?.togglePanel(button.dataset.dockPanel as DockPanelId));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-workbench-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const panelId = button.dataset.workbenchPanel as WorkbenchPanelId;
      if (panelId !== 'workflow') toggleSharedPanel(panelId);
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
  document.querySelector('#add-variable-button')!.addEventListener('click', () => editorCommand('addVariable'));
  document.querySelector('#new-workflow-button')!.addEventListener('click', () => void handleEditorMessage({ type: 'newWorkflow' }, editorFrame));
  document.querySelector('#run-button')!.addEventListener('click', () => desktopControl('run'));
  document.querySelector('#stop-button')!.addEventListener('click', () => desktopControl('stop'));
  document.querySelector('#save-button')!.addEventListener('click', () => desktopControl('save'));
  document.querySelector('#back-button')!.addEventListener('click', () => desktopControl('back'));
  document.querySelector('#more-button')!.addEventListener('click', () => desktopControl('more'));
  document.querySelector('#window-minimize')!.addEventListener('click', () => void api.minimizeWindow());
  document.querySelector('#window-maximize')!.addEventListener('click', async () => updateMaximizedState(await api.toggleMaximizeWindow()));
  document.querySelector('#window-close')!.addEventListener('click', () => void api.closeWindow());
  workflowSelect.addEventListener('change', () => desktopControl('switchWorkflow', workflowSelect.value));
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
    if (event.key === 'Escape') closeTitlebarMenus();
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
    contentBrowserView = window.localStorage.getItem('onmyoji-studio.content-browser-view') === 'list' ? 'list' : 'grid';
    renderWorkflowSelect(bootstrap.workflows);
    renderInstances(bootstrap.instances);
    renderSidebar();
    renderContentBrowser();
    setStatus('桌面端已连接');
    if (editorReady && bootstrap.defaultWorkflow) await loadWorkflow(bootstrap.defaultWorkflow);
    else postToEditors({ type: 'desktopPing' });
    instanceRefreshTimer = window.setInterval(() => void refreshInstances(), 5000);
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
