/**
 * 内容浏览器：工作流 / 资源文件的树、网格、右键菜单、命名弹窗与拖放。
 * 状态由本模块持有，通过 createContentBrowser 注入实时状态与共享操作。
 * 注意：部分测试按函数名切片执行，故函数保持顶层声明。
 */
import { Box, Copy, FileJson2, FolderOpen, FolderPlus, Image, Network, Pencil, RefreshCw, Trash2 } from 'lucide';
import type { createElement, createIcons } from 'lucide';
import type {
  AssetImage,
  BootstrapData,
  OnmyojiDesktopApi,
  WorkflowDescriptor,
} from '../shared/contracts';
import type { DockingController } from './docking';

interface WorkflowDocumentTab {
  uri: string;
  text: string;
  dirty: boolean;
  backStack: string[];
}

type IconComponent = typeof Box;

export interface ContentOverviewPort {
  reconcileSelection(loadPersisted?: boolean): void;
  reconcileConfigurations(loadPersisted?: boolean): void;
  render(): void;
}

export interface ContentReferenceViewerPort {
  open(path: string, sourceDocument: Document): void;
}

type ContentBrowserView = 'grid' | 'list';
type ContentBrowserItemKind = 'folder' | 'workflow' | 'asset';
type ContentBrowserFilter = 'all' | ContentBrowserItemKind;

interface ContentBrowserItem {
  kind: ContentBrowserItemKind;
  path: string;
  name: string;
  workflow?: WorkflowDescriptor;
  asset?: AssetImage;
}

interface ContentNameDialogState {
  resolve: (value: string | null) => void;
}

interface ContentFolderDraft {
  parentPath: string;
  name: string;
  busy: boolean;
}

const contentBrowserTree = document.querySelector<HTMLElement>('#content-browser-tree')!;
const contentBrowserItems = document.querySelector<HTMLElement>('#content-browser-items')!;
const contentBrowserBreadcrumbs = document.querySelector<HTMLElement>('#content-browser-breadcrumbs')!;
const contentBrowserSearch = document.querySelector<HTMLInputElement>('#content-browser-search')!;
const contentBrowserFilters = document.querySelector<HTMLElement>('#content-browser-filters')!;
const contentBrowserFolderSearch = document.querySelector<HTMLInputElement>('#content-browser-folder-search')!;
const contentNameModal = document.querySelector<HTMLElement>('#content-name-modal')!;
const contentNameTitle = document.querySelector<HTMLElement>('#content-name-title')!;
const contentNameInput = document.querySelector<HTMLInputElement>('#content-name-input')!;
const contentNameSubmit = document.querySelector<HTMLButtonElement>('#content-name-submit')!;
const contentNameCancel = document.querySelector<HTMLButtonElement>('#content-name-cancel')!;
const contentNameClose = document.querySelector<HTMLButtonElement>('#content-name-close')!;

let contentAssets: AssetImage[] = [];
let contentFolderPaths: string[] = [];
let contentBrowserFolder = '';
let contentBrowserQuery = '';
let contentBrowserView: ContentBrowserView = 'grid';
let contentBrowserFilter: ContentBrowserFilter = 'all';
let contentBrowserFolderQuery = '';
/** 结构树手动收起的目录；重渲染时保持折叠状态。 */
let collapsedContentFolders = new Set<string>();
let contentFolderDraft: ContentFolderDraft | undefined;
let selectedContentPath = '';
let contentNameDialogState: ContentNameDialogState | undefined;


/* ---------- 依赖端口：由 createContentBrowser 注入 ---------- */
type IconSet = NonNullable<Parameters<typeof createIcons>[0]>['icons'];
type ContentDeleteTarget = { kind: 'content'; path: string };

let api!: OnmyojiDesktopApi;
let createIconsRef!: typeof createIcons;
let desktopIconsRef!: IconSet;
let createElementRef!: typeof createElement;
let showToast!: (message: string, error?: boolean) => void;
let errorMessage!: (error: unknown) => string;
let getBootstrap!: () => BootstrapData | undefined;
let setBootstrap!: (value: BootstrapData) => void;
let getCurrentUri!: () => string;
let isDirty!: () => boolean;
let getWorkflowTabs!: () => WorkflowDocumentTab[];
let getOverview!: () => ContentOverviewPort;
let getReferenceViewer!: () => ContentReferenceViewerPort;
let getDocking!: () => DockingController | undefined;
let getDocumentRuntimes!: () => Map<string, unknown>;
let getClosingDocuments!: () => Set<string>;
let workflowDescriptorForPath!: (path: string) => WorkflowDescriptor | undefined;
let relocateDocument!: (oldUri: string, newUri: string) => void;
let syncDocumentTabs!: () => void;
let displayFileUri!: (uri: string) => string;
let renderWorkflowSelect!: (workflows: WorkflowDescriptor[]) => void;
let openWorkflowInNewTab!: (uri: string) => void;
let openWorkflowTab!: (uri: string) => Promise<void>;
let loadWorkflow!: (uri: string) => Promise<void>;
let setDeleteTarget!: (target: ContentDeleteTarget | undefined) => void;

function contentParent(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function contentName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function contentFolders(): string[] {
  const folders = new Set<string>(['']);
  contentFolderPaths.forEach((folder) => folders.add(folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')));
  const paths = [
    ...(getBootstrap()?.workflows.map((workflow) => workflow.rel.replace(/\\/g, '/')) ?? []),
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

function contentBrowserWorkflowItems(): ContentBrowserItem[] {
  return (getBootstrap()?.workflows ?? []).map((workflow) => ({
    kind: 'workflow',
    path: workflow.rel.replace(/\\/g, '/'),
    name: workflow.name,
    workflow,
  }));
}

function contentBrowserAssetItems(): ContentBrowserItem[] {
  return contentAssets.map((asset) => ({
    kind: 'asset',
    path: asset.path.replace(/\\/g, '/'),
    name: contentName(asset.path),
    asset,
  }));
}

function isUnderContentFolder(path: string, folder: string): boolean {
  if (!folder) return true;
  return path === folder || path.startsWith(`${folder}/`);
}

/** 搜索框：跨整个项目匹配名称或路径。 */
function contentBrowserSearchItems(): ContentBrowserItem[] {
  const query = contentBrowserQuery.trim().toLocaleLowerCase('zh-CN');
  return [...contentBrowserWorkflowItems(), ...contentBrowserAssetItems()]
    .filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase('zh-CN').includes(query));
}

/** 「全部」：当前目录的直接子项。 */
function contentBrowserScopedItems(folder: string): ContentBrowserItem[] {
  return [
    ...contentFolders()
      .filter((candidate) => candidate && contentParent(candidate) === folder)
      .map((candidate): ContentBrowserItem => ({ kind: 'folder', path: candidate, name: contentName(candidate) })),
    ...contentBrowserWorkflowItems().filter((item) => contentParent(item.path) === folder),
    ...contentBrowserAssetItems().filter((item) => contentParent(item.path) === folder),
  ];
}

/**
 * 类型过滤：递归收集当前目录（含子目录）下的同类条目，
 * 这样在项目根目录按类型过滤时也能看到深层资产。
 */
function contentBrowserRecursiveItems(kind: ContentBrowserItemKind): ContentBrowserItem[] {
  const folder = contentBrowserFolder;
  if (kind === 'folder') {
    return contentFolders()
      .filter((candidate) => candidate && candidate !== folder && isUnderContentFolder(candidate, folder))
      .map((candidate): ContentBrowserItem => ({ kind: 'folder', path: candidate, name: contentName(candidate) }));
  }
  const pool = kind === 'workflow' ? contentBrowserWorkflowItems() : contentBrowserAssetItems();
  return pool.filter((item) => isUnderContentFolder(item.path, folder));
}

function contentBrowserEntries(): ContentBrowserItem[] {
  const base = contentBrowserQuery.trim()
    ? contentBrowserSearchItems()
    : contentBrowserFilter === 'all'
      ? contentBrowserScopedItems(contentBrowserFolder)
      : contentBrowserRecursiveItems(contentBrowserFilter);
  const items = contentBrowserFilter === 'all' ? base : base.filter((item) => item.kind === contentBrowserFilter);
  return items.sort((left, right) => {
    const order: Record<ContentBrowserItemKind, number> = { folder: 0, workflow: 1, asset: 2 };
    return order[left.kind] - order[right.kind] || left.name.localeCompare(right.name, 'zh-CN');
  });
}

function navigateContentBrowser(folder: string): void {
  contentBrowserFolder = folder;
  contentBrowserQuery = '';
  contentBrowserSearch.value = '';
  selectedContentPath = '';
  expandContentFolderPath(folder);
  renderContentBrowser();
}

function contentDragPath(event: DragEvent): string {
  const transfer = event.dataTransfer;
  if (!transfer) return '';
  return transfer.getData('application/x-onmyoji-content') || transfer.getData('text/plain') || '';
}

function workflowDragUri(event: DragEvent): string {
  const transfer = event.dataTransfer;
  if (!transfer) return '';
  const uri = transfer.getData('application/x-onmyoji-workflow').trim();
  if (uri) return uri;

  // 兼容内容浏览器或旧版本条目只写入普通内容路径的情况。
  const path = (transfer.getData('application/x-onmyoji-content') || transfer.getData('text/plain')).trim();
  const workflow = path ? workflowDescriptorForPath(relativeToProject(path)) : undefined;
  if (workflow) return workflow.uri;

  // Electron 的文件拖放可直接提供绝对路径；只接受项目内已登记的工作流。
  const filePath = (transfer.files?.[0] as (File & { path?: string }) | undefined)?.path?.trim();
  if (filePath) {
    const droppedWorkflow = workflowDescriptorForPath(relativeToProject(filePath));
    if (droppedWorkflow) return droppedWorkflow.uri;
  }
  return '';
}

/** 把工作流文件拖到工作流编辑器区域即在新面板打开。 */
function bindWorkflowTabDropTarget(element: HTMLElement): void {
  const acceptsWorkflow = (event: DragEvent): boolean => {
    const types = event.dataTransfer?.types;
    return Boolean(types && (
      types.includes('application/x-onmyoji-workflow')
      || types.includes('application/x-onmyoji-content')
      || types.includes('text/plain')
      || types.includes('Files')
    ));
  };
  element.addEventListener('dragover', (event) => {
    if (!acceptsWorkflow(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    element.classList.add('workflow-drop-active');
  });
  element.addEventListener('dragleave', (event) => {
    const related = event.relatedTarget;
    if (!(related instanceof Node) || !element.contains(related)) element.classList.remove('workflow-drop-active');
  });
  element.addEventListener('drop', (event) => {
    if (!acceptsWorkflow(event)) return;
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove('workflow-drop-active');
    const uri = workflowDragUri(event);
    if (uri) void openWorkflowTab(uri);
    else showToast('这里只能打开项目内的工作流文件', true);
  });
}

function bindContentDropTarget(element: HTMLElement, folder: string | (() => string)): void {
  const isInternalContentDrag = (event: DragEvent): boolean => {
    const types = event.dataTransfer?.types;
    return Boolean(types && (types.includes('application/x-onmyoji-content') || types.includes('text/plain')));
  };
  element.addEventListener('dragover', (event) => {
    if (!isInternalContentDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    element.classList.add('drop-target');
  });
  element.addEventListener('dragleave', (event) => {
    event.stopPropagation();
    const related = event.relatedTarget;
    if (!(related instanceof Node) || !element.contains(related)) element.classList.remove('drop-target');
  });
  element.addEventListener('drop', (event) => {
    if (!isInternalContentDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove('drop-target');
    const sourcePath = contentDragPath(event).replace(/\\/g, '/').trim();
    if (sourcePath) void moveContentItem(sourcePath, typeof folder === 'function' ? folder() : folder);
  });
}

async function moveContentItem(sourcePath: string, targetFolder: string): Promise<void> {
  const source = sourcePath.replace(/\\/g, '/').trim();
  if (!source) return;
  if (isDirty()) {
    showToast('请先保存当前工作流，再移动内容', true);
    return;
  }
  const sourceWorkflow = workflowDescriptorForPath(source);
  const sourceWorkflowTab = sourceWorkflow
    ? getWorkflowTabs().find((tab) => tab.uri === sourceWorkflow.uri)
    : undefined;
  if (sourceWorkflowTab?.dirty) {
    showToast('请先保存该工作流，再移动它', true);
    return;
  }
  const currentRelative = getCurrentUri() ? relativeToProject(displayFileUri(getCurrentUri())).replace(/\\/g, '/') : '';
  const movingCurrentWorkflow = currentRelative.toLowerCase() === source.toLowerCase();
  try {
    const result = await api.moveContent({ sourcePath: source, targetFolder });
    selectedContentPath = result.targetPath;

    const [assets, data, folders] = await Promise.all([api.listAssets(), api.bootstrap(), api.listContentFolders()]);
    contentAssets = assets;
    contentFolderPaths = folders;
    const currentBootstrap = getBootstrap();
    if (currentBootstrap) {
      currentBootstrap.workflows = data.workflows;
      currentBootstrap.catalog = data.catalog;
      currentBootstrap.defaultWorkflow = data.defaultWorkflow;
      currentBootstrap.instances = data.instances;
    } else {
      setBootstrap(data);
    }
    getOverview().reconcileSelection();
    getOverview().reconcileConfigurations();
    renderWorkflowSelect(data.workflows);
    renderContentBrowser();
    getOverview().render();

    if (movingCurrentWorkflow) {
      const moved = getBootstrap()?.workflows.find((workflow) => workflow.rel.replace(/\\/g, '/').toLowerCase() === result.targetPath.toLowerCase());
      if (moved) {
        const tab = getWorkflowTabs().find((item) => item.uri === getCurrentUri());
        if (tab) tab.uri = moved.uri;
        relocateDocument(getCurrentUri(), moved.uri);
        await loadWorkflow(moved.uri);
      }
    } else if (sourceWorkflowTab) {
      const moved = getBootstrap()?.workflows.find((workflow) => workflow.rel.replace(/\\/g, '/').toLowerCase() === result.targetPath.toLowerCase());
      if (moved) {
        const oldUri = sourceWorkflowTab.uri;
        sourceWorkflowTab.uri = moved.uri;
        relocateDocument(oldUri, moved.uri);
      }
      if (result.updatedFiles > 0 && getCurrentUri()) await loadWorkflow(getCurrentUri());
    } else if (result.updatedFiles > 0 && getCurrentUri()) {
      // 移动模板后，当前工作流的磁盘引用可能已被重写；重新载入以同步编辑器内存状态。
      await loadWorkflow(getCurrentUri());
    }
    const redirectText = result.updatedReferences > 0 ? `，已重定向 ${result.updatedReferences} 处引用` : '';
    showToast(`已移动到 ${result.targetPath}${redirectText}`);
  } catch (error) {
    showToast(`移动失败：${errorMessage(error)}`, true);
  }
}

function selectContentItem(button: HTMLButtonElement, item: ContentBrowserItem): void {
  selectedContentPath = item.path;
  setDeleteTarget({ kind: 'content', path: item.path });
  contentBrowserItems.querySelectorAll('.content-item.selected').forEach((element) => element.classList.remove('selected'));
  button.classList.add('selected');
  document.querySelector<HTMLElement>('#content-browser-selection')!.textContent = item.path;
}

/**
 * 左侧目录树与面包屑里的文件夹也参与删除目标：写回统一的选中路径，
 * 让底部选中信息与 Delete 的目标保持一致（根目录会在删除流程里被拦截）。
 */
function selectContentFolder(folder: string): void {
  if (!folder) return;
  selectedContentPath = folder;
  setDeleteTarget({ kind: 'content', path: folder });
  document.querySelector<HTMLElement>('#content-browser-selection')!.textContent = folder;
}

function createContentItem(item: ContentBrowserItem, editing = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `content-item ${item.kind}${item.workflow?.uri === getCurrentUri() ? ' current' : ''}${item.path === selectedContentPath ? ' selected' : ''}${editing ? ' editing' : ''}`;
  button.type = 'button';
  button.draggable = !editing && item.kind !== 'folder';
  button.title = editing ? '' : item.path;
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
  const kind = document.createElement('span');
  kind.className = 'content-item-kind';
  kind.textContent = item.kind === 'folder' ? '文件夹' : item.kind === 'workflow' ? '工作流' : '模板图片';
  preview.appendChild(kind);
  const label = editing ? document.createElement('input') : document.createElement('span');
  label.className = editing ? 'content-item-name-edit' : 'content-item-name';
  if (editing) {
    const input = label as HTMLInputElement;
    input.type = 'text';
    input.value = item.name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', '文件夹名称');
  } else {
    label.textContent = item.name;
  }
  const path = document.createElement('span');
  path.className = 'content-item-path';
  path.textContent = contentBrowserQuery ? item.path : item.kind === 'folder' ? '文件夹' : item.kind === 'workflow' ? '工作流' : '模板图片';
  button.append(preview, label, path);
  if (editing) {
    const input = label as HTMLInputElement;
    const stop = (event: Event): void => event.stopPropagation();
    input.addEventListener('click', stop);
    input.addEventListener('pointerdown', stop);
    input.addEventListener('dblclick', stop);
    input.addEventListener('input', () => {
      if (contentFolderDraft) contentFolderDraft.name = input.value;
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        void commitContentFolderDraft();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelContentFolderDraft();
      }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (contentFolderDraft && !contentFolderDraft.busy) void commitContentFolderDraft();
      }, 0);
    });
    window.setTimeout(() => {
      if (contentFolderDraft && !contentFolderDraft.busy) {
        input.focus();
        input.select();
      }
    }, 0);
  }
  button.addEventListener('click', () => {
    if (!editing) selectContentItem(button, item);
  });
  if (!editing && item.kind !== 'folder') {
    button.addEventListener('dragstart', (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      transfer.setData('application/x-onmyoji-content', item.path);
      transfer.setData('text/plain', item.path);
      if (item.kind === 'workflow' && item.workflow) {
        transfer.setData('application/x-onmyoji-workflow', item.workflow.uri);
        transfer.effectAllowed = 'copy';
      } else {
        transfer.effectAllowed = 'move';
      }
      button.classList.add('dragging');
    });
    button.addEventListener('dragend', () => button.classList.remove('dragging'));
  }
  if (!editing && item.kind === 'folder') bindContentDropTarget(button, item.path);
  button.addEventListener('dblclick', () => {
    if (editing) return;
    if (item.kind === 'folder') navigateContentBrowser(item.path);
    else if (item.workflow) openWorkflowInNewTab(item.workflow.uri);
    else if (item.asset) void api.openContentItem(item.asset.path).catch((error) => showToast(errorMessage(error), true));
  });
  if (!editing) button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectContentItem(button, item);
    showContentContextMenu(event, item, button);
  });
  return button;
}

function createContentFolderRow(folder: string, depth: number, hasChildren: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const collapsed = collapsedContentFolders.has(folder);
  button.className = `content-folder-row${folder === contentBrowserFolder ? ' selected' : ''}`;
  button.style.setProperty('--depth', String(depth));
  const chevron = document.createElement('span');
  chevron.className = `content-folder-chevron${hasChildren ? '' : ' leaf'}${collapsed ? ' collapsed' : ''}`;
  if (hasChildren) chevron.innerHTML = '<i data-lucide="chevron-right"></i>';
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', folder === contentBrowserFolder ? 'folder-open' : 'folder');
  const label = document.createElement('span');
  label.textContent = folder ? contentName(folder) : '项目内容';
  button.append(chevron, icon, label);
  button.title = folder ? `${folder}\nDelete 删除该文件夹` : '项目内容';
  if (hasChildren) {
    chevron.addEventListener('click', (event) => {
      event.stopPropagation();
      if (collapsedContentFolders.has(folder)) collapsedContentFolders.delete(folder);
      else collapsedContentFolders.add(folder);
      renderContentBrowserTree();
    });
  }
  button.addEventListener('click', () => {
    navigateContentBrowser(folder);
    selectContentFolder(folder);
  });
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showContentContextMenu(event, contentFolderItem(folder), button);
  });
  bindContentDropTarget(button, folder);
  return button;
}

/** 让目标目录及其所有上级保持展开，避免跳转后行被折叠隐藏。 */
function expandContentFolderPath(folder: string): void {
  collapsedContentFolders.delete('');
  let current = folder;
  while (current) {
    collapsedContentFolders.delete(current);
    current = contentParent(current);
  }
}

function renderContentBrowserTree(): void {
  contentBrowserTree.replaceChildren();
  const folders = contentFolders();
  const childrenOf = (folder: string): string[] => folders
    .filter((candidate) => candidate && contentParent(candidate) === folder)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const query = contentBrowserFolderQuery.trim().toLocaleLowerCase('zh-CN');
  if (query) {
    const matches = folders
      .filter((folder) => folder && folder.toLocaleLowerCase('zh-CN').includes(query))
      .sort((left, right) => left.localeCompare(right, 'zh-CN'));
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'content-folder-empty';
      empty.textContent = '没有匹配的文件夹';
      contentBrowserTree.appendChild(empty);
      createIconsRef({ icons: desktopIconsRef, root: contentBrowserTree });
      return;
    }
    for (const folder of matches) contentBrowserTree.appendChild(createContentFolderRow(folder, 0, false));
    createIconsRef({ icons: desktopIconsRef, root: contentBrowserTree });
    return;
  }
  const appendFolder = (folder: string, depth: number): void => {
    const children = childrenOf(folder);
    contentBrowserTree.appendChild(createContentFolderRow(folder, depth, children.length > 0));
    if (collapsedContentFolders.has(folder)) return;
    for (const child of children) appendFolder(child, depth + 1);
  };
  appendFolder('', 0);
  createIconsRef({ icons: desktopIconsRef, root: contentBrowserTree });
}

const CONTENT_BROWSER_FILTERS: Array<{ id: ContentBrowserFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'folder', label: '文件夹' },
  { id: 'workflow', label: '工作流' },
  { id: 'asset', label: '模板图片' },
];

function renderContentBrowserFilters(): void {
  const count = (kind: ContentBrowserItemKind): number => contentBrowserRecursiveItems(kind).length;
  const counts: Record<ContentBrowserFilter, number> = {
    all: contentBrowserScopedItems(contentBrowserFolder).length,
    folder: count('folder'),
    workflow: count('workflow'),
    asset: count('asset'),
  };
  contentBrowserFilters.replaceChildren(...CONTENT_BROWSER_FILTERS.map((filter) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `content-facet${contentBrowserFilter === filter.id ? ' active' : ''}`;
    button.dataset.contentFilter = filter.id;
    const label = document.createElement('span');
    label.textContent = filter.label;
    const countEl = document.createElement('em');
    countEl.textContent = String(counts[filter.id]);
    button.append(label, countEl);
    button.addEventListener('click', () => {
      if (contentBrowserFilter === filter.id) return;
      contentBrowserFilter = filter.id;
      selectedContentPath = '';
      renderContentBrowser();
    });
    return button;
  }));
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
    button.title = path ? `${path}\nDelete 删除该文件夹` : '项目内容';
    button.addEventListener('click', () => {
      navigateContentBrowser(path);
      selectContentFolder(path);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showContentContextMenu(event, contentFolderItem(path), button);
    });
    bindContentDropTarget(button, path);
    contentBrowserBreadcrumbs.appendChild(button);
  }
}

function renderContentBrowser(): void {
  const folders = new Set(contentFolders());
  if (!folders.has(contentBrowserFolder)) contentBrowserFolder = '';
  renderContentBrowserTree();
  renderContentBrowserBreadcrumbs();
  renderContentBrowserFilters();
  const entries = contentBrowserEntries();
  if (contentFolderDraft && contentFolderDraft.parentPath === contentBrowserFolder && !contentBrowserQuery) {
    entries.unshift({
      kind: 'folder',
      path: `${contentFolderDraft.parentPath}/.new-folder`,
      name: contentFolderDraft.name,
    });
  }
  contentBrowserItems.className = `content-browser-items ${contentBrowserView}`;
  const renderedEntries = entries.map((item, index) => ({ item, element: createContentItem(item, Boolean(contentFolderDraft && index === 0 && item.path.endsWith('/.new-folder'))) }));
  contentBrowserItems.replaceChildren(...renderedEntries.map((entry) => entry.element));
  document.querySelector<HTMLElement>('#content-browser-empty')!.classList.toggle('hidden', entries.length > 0);
  document.querySelector<HTMLElement>('#content-browser-summary')!.textContent = `${entries.length} 项`;
  document.querySelector<HTMLElement>('#content-browser-folder-count')!.textContent = `${contentFolders().filter(Boolean).length} 个文件夹`;
  document.querySelector<HTMLElement>('#content-browser-selection')!.textContent = selectedContentPath;
  document.querySelector<HTMLButtonElement>('#content-browser-up')!.disabled = contentBrowserFolder === '';
  document.querySelectorAll<HTMLButtonElement>('[data-content-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.contentView === contentBrowserView);
  });
  createIconsRef({ icons: desktopIconsRef, root: document.querySelector<HTMLElement>('#module-content-browser')! });
}

async function refreshContentBrowser(): Promise<void> {
  const refreshButton = document.querySelector<HTMLButtonElement>('#content-browser-refresh')!;
  refreshButton.disabled = true;
  refreshButton.classList.add('refreshing');
  try {
    const [assets, data, folders] = await Promise.all([api.listAssets(), api.bootstrap(), api.listContentFolders()]);
    contentAssets = assets;
    contentFolderPaths = folders;
    const currentBootstrap = getBootstrap();
    if (currentBootstrap) {
      currentBootstrap.workflows = data.workflows;
      currentBootstrap.catalog = data.catalog;
      currentBootstrap.defaultWorkflow = data.defaultWorkflow;
    } else {
      setBootstrap(data);
    }
    getOverview().reconcileSelection();
    getOverview().reconcileConfigurations();
    renderWorkflowSelect(data.workflows);
    renderContentBrowser();
    getOverview().render();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('refreshing');
  }
}

/* ---------- 内容浏览器列宽拖拽 ---------- */

interface ContentResizerConfig {
  name: 'sources' | 'filters';
  variable: string;
  key: string;
  fallback: number;
  min: number;
}

const CONTENT_BROWSER_RESIZERS: ContentResizerConfig[] = [
  { name: 'sources', variable: '--cb-sources-width', key: 'onmyoji-studio.content-browser.sources-width', fallback: 198, min: 150 },
  { name: 'filters', variable: '--cb-filters-width', key: 'onmyoji-studio.content-browser.filters-width', fallback: 132, min: 96 },
];

function setupContentBrowserResizers(): void {
  const module = document.querySelector<HTMLElement>('#module-content-browser');
  if (!module) return;
  const readWidth = (config: ContentResizerConfig): number => {
    const inline = parseFloat(module.style.getPropertyValue(config.variable));
    if (Number.isFinite(inline) && inline > 0) return inline;
    const stored = parseFloat(window.localStorage.getItem(config.key) ?? '');
    return Number.isFinite(stored) && stored > 0 ? stored : config.fallback;
  };
  for (const config of CONTENT_BROWSER_RESIZERS) {
    const stored = window.localStorage.getItem(config.key);
    if (stored) module.style.setProperty(config.variable, stored);
  }
  for (const config of CONTENT_BROWSER_RESIZERS) {
    const resizer = module.querySelector<HTMLElement>(`[data-content-resizer="${config.name}"]`);
    if (!resizer) continue;
    const apply = (width: number): void => {
      const max = Math.max(config.min, (module.clientWidth || 0) - 240);
      module.style.setProperty(config.variable, `${Math.min(max, Math.max(config.min, width))}px`);
    };
    const persist = (): void => {
      window.localStorage.setItem(config.key, module.style.getPropertyValue(config.variable));
    };
    resizer.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizer.setPointerCapture(event.pointerId);
      resizer.classList.add('dragging');
      const startX = event.clientX;
      const startWidth = readWidth(config);
      const move = (moveEvent: PointerEvent): void => apply(startWidth + (moveEvent.clientX - startX));
      const finish = (): void => {
        resizer.classList.remove('dragging');
        resizer.removeEventListener('pointermove', move);
        resizer.removeEventListener('pointerup', finish);
        resizer.removeEventListener('pointercancel', finish);
        persist();
      };
      resizer.addEventListener('pointermove', move);
      resizer.addEventListener('pointerup', finish);
      resizer.addEventListener('pointercancel', finish);
    });
    resizer.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      apply(readWidth(config) + (event.key === 'ArrowLeft' ? -12 : 12));
      persist();
    });
  }
}

/* ---------- 内容浏览器右键菜单 + 引用查看器 ---------- */
let contentContextMenu: { owner: Document; menu: HTMLElement; dismiss: (event: Event) => void; keyHandler: (event: KeyboardEvent) => void } | undefined;


/** 把绝对路径转成项目相对路径（正斜杠）；不在项目内时原样返回。 */
function relativeToProject(absolutePath: string): string {
  const root = getBootstrap()?.projectRoot ?? '';
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

function isContentRootFolder(path: string): boolean {
  return path === 'assets' || path === 'workflows';
}

function contentFolderItem(path: string): ContentBrowserItem {
  return { kind: 'folder', path, name: path ? contentName(path) : '项目内容' };
}

function finishContentNameDialog(value: string | null): void {
  const request = contentNameDialogState;
  if (!request) return;
  contentNameDialogState = undefined;
  contentNameModal.classList.add('hidden');
  contentNameModal.setAttribute('aria-hidden', 'true');
  contentNameInput.value = '';
  request.resolve(value);
}

function requestContentName(title: string, submitLabel: string, initialValue: string): Promise<string | null> {
  if (contentNameDialogState) finishContentNameDialog(null);
  contentNameTitle.textContent = title;
  contentNameSubmit.textContent = submitLabel;
  contentNameInput.value = initialValue;
  contentNameModal.classList.remove('hidden');
  contentNameModal.setAttribute('aria-hidden', 'false');
  const result = new Promise<string | null>((resolve) => {
    contentNameDialogState = { resolve };
  });
  window.setTimeout(() => {
    if (!contentNameDialogState) return;
    contentNameInput.focus();
    contentNameInput.select();
  }, 0);
  return result;
}

async function createContentFolderAt(parentPath: string): Promise<void> {
  if (contentFolderDraft) return;
  const normalizedParent = parentPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (contentBrowserFolder !== normalizedParent) navigateContentBrowser(normalizedParent);
  selectedContentPath = '';
  contentFolderDraft = { parentPath: normalizedParent, name: '新建文件夹', busy: false };
  renderContentBrowser();
}

function cancelContentFolderDraft(): void {
  if (!contentFolderDraft || contentFolderDraft.busy) return;
  contentFolderDraft = undefined;
  renderContentBrowser();
}

async function commitContentFolderDraft(): Promise<void> {
  const draft = contentFolderDraft;
  if (!draft || draft.busy) return;
  const input = contentBrowserItems.querySelector<HTMLInputElement>('.content-item-name-edit');
  const name = input?.value ?? draft.name;
  if (!name.trim()) {
    input?.focus();
    return;
  }
  draft.name = name;
  draft.busy = true;
  input?.setAttribute('aria-busy', 'true');
  if (input) input.disabled = true;
  try {
    const createdPath = await api.createContentFolder({ parentPath: draft.parentPath, name });
    contentFolderDraft = undefined;
    selectedContentPath = createdPath;
    await refreshContentBrowser();
    showToast(`已创建文件夹 ${createdPath}`);
  } catch (error) {
    draft.busy = false;
    if (contentFolderDraft === draft) {
      renderContentBrowser();
      const nextInput = contentBrowserItems.querySelector<HTMLInputElement>('.content-item-name-edit');
      nextInput?.focus();
      nextInput?.select();
    }
    showToast(`新建失败：${errorMessage(error)}`, true);
  }
}

async function copyContentPath(path: string): Promise<void> {
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    showToast(`已复制路径 ${path}`);
  } catch (error) {
    showToast(`复制失败：${errorMessage(error)}`, true);
  }
}

async function renameContentItem(item: ContentBrowserItem): Promise<void> {
  if (isDirty()) {
    showToast('请先保存当前工作流，再重命名内容', true);
    return;
  }
  const newName = await requestContentName('重命名', '保存', item.name);
  if (newName === null || !newName.trim() || newName.trim() === item.name) return;
  const sourceWorkflow = item.kind === 'workflow' ? workflowDescriptorForPath(item.path) : undefined;
  const sourceWorkflowTab = sourceWorkflow
    ? getWorkflowTabs().find((tab) => tab.uri === sourceWorkflow.uri)
    : undefined;
  if (sourceWorkflowTab?.dirty) {
    showToast('请先保存该工作流，再重命名它', true);
    return;
  }
  const currentRelative = getCurrentUri() ? relativeToProject(displayFileUri(getCurrentUri())).replace(/\\/g, '/') : '';
  const renamingCurrentWorkflow = item.kind === 'workflow' && currentRelative.toLowerCase() === item.path.toLowerCase();
  try {
    const result = await api.renameContent({ sourcePath: item.path, newName });
    selectedContentPath = result.targetPath;
    await refreshContentBrowser();
    if (renamingCurrentWorkflow) {
      const renamed = getBootstrap()?.workflows.find((workflow) => workflow.rel.replace(/\\/g, '/').toLowerCase() === result.targetPath.toLowerCase());
      if (renamed) {
        const tab = getWorkflowTabs().find((item) => item.uri === getCurrentUri());
        if (tab) tab.uri = renamed.uri;
        relocateDocument(getCurrentUri(), renamed.uri);
        await loadWorkflow(renamed.uri);
      }
    } else if (sourceWorkflowTab) {
      const renamed = getBootstrap()?.workflows.find((workflow) => workflow.rel.replace(/\\/g, '/').toLowerCase() === result.targetPath.toLowerCase());
      if (renamed) {
        const oldUri = sourceWorkflowTab.uri;
        sourceWorkflowTab.uri = renamed.uri;
        relocateDocument(oldUri, renamed.uri);
      }
      if (result.updatedFiles > 0 && getCurrentUri()) await loadWorkflow(getCurrentUri());
    } else if (result.updatedFiles > 0 && getCurrentUri()) {
      await loadWorkflow(getCurrentUri());
    }
    const redirectText = result.updatedReferences > 0 ? `，已重定向 ${result.updatedReferences} 处引用` : '';
    showToast(`已重命名为 ${result.targetPath}${redirectText}`);
  } catch (error) {
    showToast(`重命名失败：${errorMessage(error)}`, true);
  }
}

async function deleteContentItem(item: ContentBrowserItem): Promise<void> {
  if (isDirty()) {
    showToast('请先保存当前工作流，再删除内容', true);
    return;
  }
  if (!window.confirm(`确定删除“${item.name}”吗？`)) return;
  const sourceWorkflow = item.kind === 'workflow' ? workflowDescriptorForPath(item.path) : undefined;
  const sourceWorkflowTab = sourceWorkflow
    ? getWorkflowTabs().find((tab) => tab.uri === sourceWorkflow.uri)
    : undefined;
  if (sourceWorkflowTab?.dirty) {
    showToast('请先保存该工作流，再删除它', true);
    return;
  }
  const currentRelative = getCurrentUri() ? relativeToProject(displayFileUri(getCurrentUri())).replace(/\\/g, '/') : '';
  const deletingCurrentWorkflow = item.kind === 'workflow' && currentRelative.toLowerCase() === item.path.toLowerCase();
  try {
    await api.deleteContent(item.path);
    selectedContentPath = '';
    await refreshContentBrowser();
    if (deletingCurrentWorkflow) {
      const deletedIndex = getWorkflowTabs().findIndex((tab) => tab.uri === getCurrentUri());
      if (deletedIndex >= 0) {
        const oldUri = getWorkflowTabs()[deletedIndex].uri;
        getClosingDocuments().add(oldUri);
        getDocking()?.closeDocument(oldUri);
        getClosingDocuments().delete(oldUri);
        getDocumentRuntimes().delete(oldUri);
        getWorkflowTabs().splice(deletedIndex, 1);
      }
      const remaining = getWorkflowTabs()[Math.min(deletedIndex < 0 ? 0 : deletedIndex, getWorkflowTabs().length - 1)];
      const next = remaining ?? getBootstrap()?.workflows.find((workflow) => workflow.uri !== getCurrentUri());
      if (next) await openWorkflowTab(next.uri);
      else syncDocumentTabs();
    } else if (sourceWorkflowTab) {
      const deletedIndex = getWorkflowTabs().indexOf(sourceWorkflowTab);
      if (deletedIndex >= 0) {
        const oldUri = sourceWorkflowTab.uri;
        getClosingDocuments().add(oldUri);
        getDocking()?.closeDocument(oldUri);
        getClosingDocuments().delete(oldUri);
        getDocumentRuntimes().delete(oldUri);
        getWorkflowTabs().splice(deletedIndex, 1);
      }
      syncDocumentTabs();
    }
    showToast(`已删除 ${item.path}`);
  } catch (error) {
    showToast(`删除失败：${errorMessage(error)}`, true);
  }
}

/** 正在输入的控件必须保留 Delete/Backspace 的文本编辑语义。 */
function resolveContentDeleteTarget(path: string): ContentBrowserItem | undefined {
  const candidates = [path, selectedContentPath].map((value) => (value ?? '').replace(/\\/g, '/')).filter(Boolean);
  for (const candidate of candidates) {
    const item = contentBrowserEntries().find((entry) => entry.path === candidate);
    if (item) return item;
    if (contentFolders().includes(candidate)) return contentFolderItem(candidate);
  }
  return undefined;
}

/** 执行已登记的删除目标；返回 true 表示这次按键已被消费。 */
function addContentContextSeparator(doc: Document, menu: HTMLElement): void {
  const separator = doc.createElement('div');
  separator.className = 'content-context-separator';
  menu.appendChild(separator);
}

function showContentContextMenu(event: MouseEvent, item: ContentBrowserItem, button: HTMLElement): void {
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
    entry.appendChild(createElementRef(icon, { width: '13', height: '13', 'aria-hidden': 'true' }));
    entry.appendChild(doc.createTextNode(label));
    entry.addEventListener('click', () => {
      closeContentContextMenu();
      action();
    });
    menu.appendChild(entry);
  };

  if (item.kind === 'folder') {
    if (item.path) addEntry('打开文件夹', FolderOpen, () => navigateContentBrowser(item.path));
    if (item.path === '') {
      addEntry('在 assets 中新建文件夹', FolderPlus, () => void createContentFolderAt('assets'));
      addEntry('在 workflows 中新建文件夹', FolderPlus, () => void createContentFolderAt('workflows'));
    } else {
      addEntry('新建文件夹', FolderPlus, () => void createContentFolderAt(item.path));
    }
    if (!isContentRootFolder(item.path) && item.path) {
      addContentContextSeparator(doc, menu);
      addEntry('重命名', Pencil, () => void renameContentItem(item));
      addEntry('删除', Trash2, () => void deleteContentItem(item));
    }
    if (item.path) addEntry('复制路径', Copy, () => void copyContentPath(item.path));
  } else {
    addEntry('引用查看器', Network, () => getReferenceViewer().open(item.path, doc));
    addContentContextSeparator(doc, menu);
    if (item.workflow) {
      addEntry('在编辑器中打开', FileJson2, () => openWorkflowInNewTab(item.workflow!.uri));
    } else if (item.asset) {
      addEntry('打开图片', Image, () => void api.openContentItem(item.asset!.path).catch((error) => showToast(errorMessage(error), true)));
    }
    addContentContextSeparator(doc, menu);
    addEntry('重命名', Pencil, () => void renameContentItem(item));
    addEntry('删除', Trash2, () => void deleteContentItem(item));
    addEntry('复制路径', Copy, () => void copyContentPath(item.path));
  }
  addContentContextSeparator(doc, menu);
  addEntry('刷新', RefreshCw, () => void refreshContentBrowser());

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


const CONTENT_BROWSER_VIEW_KEY = 'onmyoji-studio.content-browser-view';

/** 切换网格/列表视图并持久化。 */
function setContentBrowserView(view: 'grid' | 'list'): void {
  contentBrowserView = view === 'list' ? 'list' : 'grid';
  window.localStorage.setItem(CONTENT_BROWSER_VIEW_KEY, contentBrowserView);
  renderContentBrowser();
}

/** 绑定内容浏览器面板的右键菜单、命名弹窗、视图切换与拖放事件。 */
function bindContentBrowserUi(): void {
  setupContentBrowserResizers();
  contentNameClose.addEventListener('click', () => finishContentNameDialog(null));
  contentNameCancel.addEventListener('click', () => finishContentNameDialog(null));
  contentNameSubmit.addEventListener('click', () => finishContentNameDialog(contentNameInput.value));
  contentNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishContentNameDialog(contentNameInput.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishContentNameDialog(null);
    }
  });
  contentNameModal.addEventListener('pointerdown', (event) => {
    if (event.target === contentNameModal) finishContentNameDialog(null);
  });
  document.querySelector('#content-browser-up')!.addEventListener('click', () => navigateContentBrowser(contentParent(contentBrowserFolder)));
  document.querySelector('#content-browser-refresh')!.addEventListener('click', () => void refreshContentBrowser());
  bindContentDropTarget(contentBrowserItems, () => contentBrowserFolder);
  contentBrowserItems.addEventListener('contextmenu', (event) => {
    if (event.target instanceof Element && event.target.closest('.content-item')) return;
    event.preventDefault();
    showContentContextMenu(event, contentFolderItem(contentBrowserFolder), contentBrowserItems);
  });
  contentBrowserTree.addEventListener('contextmenu', (event) => {
    if (event.target instanceof Element && event.target.closest('.content-folder-row')) return;
    event.preventDefault();
    showContentContextMenu(event, contentFolderItem(''), contentBrowserTree);
  });
  contentBrowserSearch.addEventListener('input', () => {
    contentBrowserQuery = contentBrowserSearch.value;
    selectedContentPath = '';
    setDeleteTarget(undefined);
    renderContentBrowser();
  });
  contentBrowserFolderSearch.addEventListener('input', () => {
    contentBrowserFolderQuery = contentBrowserFolderSearch.value;
    renderContentBrowserTree();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-content-view]').forEach((button) => {
    button.addEventListener('click', () => setContentBrowserView(button.dataset.contentView === 'list' ? 'list' : 'grid'));
  });
}

export interface ContentBrowserDeps {
  api: OnmyojiDesktopApi;
  createIcons: typeof createIcons;
  desktopIcons: IconSet;
  createElement: typeof createElement;
  showToast: (message: string, error?: boolean) => void;
  errorMessage: (error: unknown) => string;
  getBootstrap: () => BootstrapData | undefined;
  setBootstrap: (value: BootstrapData) => void;
  getCurrentUri: () => string;
  isDirty: () => boolean;
  getWorkflowTabs: () => WorkflowDocumentTab[];
  getOverview: () => ContentOverviewPort;
  getReferenceViewer: () => ContentReferenceViewerPort;
  getDocking: () => DockingController | undefined;
  getDocumentRuntimes: () => Map<string, unknown>;
  getClosingDocuments: () => Set<string>;
  workflowDescriptorForPath: (path: string) => WorkflowDescriptor | undefined;
  relocateDocument: (oldUri: string, newUri: string) => void;
  syncDocumentTabs: () => void;
  displayFileUri: (uri: string) => string;
  renderWorkflowSelect: (workflows: WorkflowDescriptor[]) => void;
  openWorkflowInNewTab: (uri: string) => void;
  openWorkflowTab: (uri: string) => Promise<void>;
  loadWorkflow: (uri: string) => Promise<void>;
  setDeleteTarget: (target: ContentDeleteTarget | undefined) => void;
}

export interface ContentBrowser {
  bind(): void;
  render(): void;
  refresh(): Promise<void>;
  setCatalog(assets: AssetImage[], folders: string[]): void;
  focusSearch(): void;
  getView(): 'grid' | 'list';
  setView(view: 'grid' | 'list'): void;
  bindWorkflowDropTarget(element: HTMLElement): void;
  resolveDeleteTarget(path: string): ContentBrowserItem | undefined;
  isRootFolder(path: string): boolean;
  deleteItem(item: ContentBrowserItem): Promise<void>;
  isNameDialogOpen(): boolean;
  cancelNameDialog(): void;
}

export function createContentBrowser(deps: ContentBrowserDeps): ContentBrowser {
  api = deps.api;
  createIconsRef = deps.createIcons;
  desktopIconsRef = deps.desktopIcons;
  createElementRef = deps.createElement;
  showToast = deps.showToast;
  errorMessage = deps.errorMessage;
  getBootstrap = deps.getBootstrap;
  setBootstrap = deps.setBootstrap;
  getCurrentUri = deps.getCurrentUri;
  isDirty = deps.isDirty;
  getWorkflowTabs = deps.getWorkflowTabs;
  getOverview = deps.getOverview;
  getReferenceViewer = deps.getReferenceViewer;
  getDocking = deps.getDocking;
  getDocumentRuntimes = deps.getDocumentRuntimes;
  getClosingDocuments = deps.getClosingDocuments;
  workflowDescriptorForPath = deps.workflowDescriptorForPath;
  relocateDocument = deps.relocateDocument;
  syncDocumentTabs = deps.syncDocumentTabs;
  displayFileUri = deps.displayFileUri;
  renderWorkflowSelect = deps.renderWorkflowSelect;
  openWorkflowInNewTab = deps.openWorkflowInNewTab;
  openWorkflowTab = deps.openWorkflowTab;
  loadWorkflow = deps.loadWorkflow;
  setDeleteTarget = deps.setDeleteTarget;
  return {
    bind: bindContentBrowserUi,
    render: renderContentBrowser,
    refresh: refreshContentBrowser,
    setCatalog: (assets, folders) => { contentAssets = assets; contentFolderPaths = folders; },
    focusSearch: () => contentBrowserSearch.focus(),
    getView: () => contentBrowserView,
    setView: setContentBrowserView,
    bindWorkflowDropTarget: bindWorkflowTabDropTarget,
    resolveDeleteTarget: resolveContentDeleteTarget,
    isRootFolder: isContentRootFolder,
    deleteItem: deleteContentItem,
    isNameDialogOpen: () => Boolean(contentNameDialogState),
    cancelNameDialog: () => finishContentNameDialog(null),
  };
}

export { contentName, relativeToProject };
