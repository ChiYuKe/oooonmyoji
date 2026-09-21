/**
 * 内容浏览器：工作流 / 资源文件的树、网格、右键菜单、命名弹窗与拖放。
 * 状态由本模块持有，通过 createContentBrowser 注入实时状态与共享操作。
 * 纯条目工具（目录归属、递归类型过滤）已抽到 content-browser/items.ts。
 * 注意：workbench.test.cjs 仍按函数名切片 renderContentBrowser，改动需同步测试。
 */
import { Box, Copy, FileJson2, FolderOpen, FolderPlus, Image, Network, Pencil, RefreshCw, Trash2 } from 'lucide';
import type { createElement, createIcons } from 'lucide';
import type {
  AssetImage,
  BootstrapData,
  MoveContentResult,
  OnmyojiDesktopApi,
  WorkflowDescriptor,
} from '../shared/contracts';
import type { DockingController } from './docking';
import { contentBrowserRecursiveItems, isUnderContentFolder, nextContentBrowserZoom, CONTENT_BROWSER_ZOOM_MIN, CONTENT_BROWSER_ZOOM_MAX, type ContentBrowserItemKind } from './content-browser/items';
import { contentRewriteReport } from './content-browser/rewrite-report';

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
type ContentBrowserFilter = 'all' | ContentBrowserItemKind;

export interface ContentBrowserItem {
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

/** 行内重命名草稿：条目名称在网格里原地变成输入框，Enter 提交、Escape 取消。 */
interface ContentRenameDraft {
  item: ContentBrowserItem;
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
const contentRewriteModal = document.querySelector<HTMLElement>('#content-rewrite-modal')!;
const contentRewriteTitle = document.querySelector<HTMLElement>('#content-rewrite-title')!;
const contentRewriteSubtitle = document.querySelector<HTMLElement>('#content-rewrite-subtitle')!;
const contentRewriteList = document.querySelector<HTMLElement>('#content-rewrite-list')!;
const contentRewriteHint = document.querySelector<HTMLElement>('#content-rewrite-hint')!;
const contentRewriteConfirm = document.querySelector<HTMLButtonElement>('#content-rewrite-confirm')!;
const contentRewriteClose = document.querySelector<HTMLButtonElement>('#content-rewrite-close')!;

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
let contentRenameDraft: ContentRenameDraft | undefined;
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
let getWorkflowTabs!: () => readonly WorkflowDocumentTab[];
let renameWorkflowTab!: (oldUri: string, newUri: string) => void;
let removeWorkflowTab!: (uri: string) => void;
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
/** 磁盘引用被改写后把受影响的打开文档重新读盘；返回因未保存修改而跳过的项目相对路径。 */
let reloadRewrittenDocuments!: (paths: readonly string[]) => Promise<string[]>;
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
 * 类型过滤：递归收集当前目录（含子目录）下的同类条目（实现见 content-browser/items.ts）。
 */
function contentBrowserEntries(): ContentBrowserItem[] {
  const base = contentBrowserQuery.trim()
    ? contentBrowserSearchItems()
    : contentBrowserFilter === 'all'
      ? contentBrowserScopedItems(contentBrowserFolder)
      : contentBrowserRecursiveItems({
          folder: contentBrowserFolder,
          contentName,
          contentFolders,
          workflowItems: contentBrowserWorkflowItems,
          assetItems: contentBrowserAssetItems,
        }, contentBrowserFilter);
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
  if (contentRenameDraft) contentRenameDraft = undefined;
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
    }
    // 磁盘引用可能刚被重写：打开中的文档必须重新读盘，不能沿用内存里的旧正文。
    const skipped = await reloadRewrittenDocuments(result.rewritten.map((detail) => detail.path));
    reportContentRewrite(result, '移动', skipped);
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
    const icon = document.createElement('i');
    icon.className = `content-item-icon ph-duotone ${item.kind === 'folder' ? 'ph-folder-simple' : 'ph-file-code'}`;
    icon.setAttribute('aria-hidden', 'true');
    preview.appendChild(icon);
  }
  const kind = document.createElement('span');
  kind.className = 'content-item-kind';
  kind.textContent = item.kind === 'folder' ? '文件夹' : item.kind === 'workflow' ? '工作流' : '模板图片';
  preview.appendChild(kind);
  const label = editing ? document.createElement('input') : document.createElement('span');
  label.className = editing ? 'inline-rename-input content-item-name-edit' : 'content-item-name';
  if (editing) {
    const input = label as HTMLInputElement;
    input.type = 'text';
    input.value = item.name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', item.kind === 'folder' ? '文件夹名称' : '名称');
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
      if (contentRenameDraft) contentRenameDraft.name = input.value;
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        if (contentFolderDraft) void commitContentFolderDraft();
        else if (contentRenameDraft) void commitContentRenameDraft();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (contentFolderDraft) cancelContentFolderDraft();
        else if (contentRenameDraft) cancelContentRenameDraft();
      }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (contentFolderDraft && !contentFolderDraft.busy) void commitContentFolderDraft();
        else if (contentRenameDraft && !contentRenameDraft.busy) void commitContentRenameDraft();
      }, 0);
    });
    window.setTimeout(() => {
      if ((contentFolderDraft && !contentFolderDraft.busy) || (contentRenameDraft && !contentRenameDraft.busy)) {
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
  icon.className = `content-folder-icon ph-duotone ${folder === contentBrowserFolder ? 'ph-folder-open' : 'ph-folder-simple'}`;
  icon.setAttribute('aria-hidden', 'true');
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
  const recursiveCount = (kind: ContentBrowserItemKind): number => contentBrowserRecursiveItems({
    folder: contentBrowserFolder,
    contentName,
    contentFolders,
    workflowItems: contentBrowserWorkflowItems,
    assetItems: contentBrowserAssetItems,
  }, kind).length;
  const counts: Record<ContentBrowserFilter, number> = {
    all: contentBrowserScopedItems(contentBrowserFolder).length,
    folder: recursiveCount('folder'),
    workflow: recursiveCount('workflow'),
    asset: recursiveCount('asset'),
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
  if (contentRenameDraft && !entries.some((entry) => entry.path === contentRenameDraft!.item.path)) {
    // 筛选（例如只看工作流）会把重命名目标藏起来：补进网格保证输入框出现。
    entries.unshift(contentRenameDraft.item);
  }
  contentBrowserItems.className = `content-browser-items ${contentBrowserView}`;
  const renderedEntries = entries.map((item, index) => {
    const editing = Boolean(
      (contentFolderDraft && index === 0 && item.path.endsWith('/.new-folder'))
      || (contentRenameDraft && item.path === contentRenameDraft.item.path),
    );
    return { item, element: createContentItem(item, editing) };
  });
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

function hideContentRewriteDialog(): void {
  contentRewriteModal.classList.add('hidden');
  contentRewriteModal.setAttribute('aria-hidden', 'true');
}

/**
 * 汇报一次移动/重命名的引用改写结果。
 * 没有引用需要改写时维持原来的单条 toast；有明细时再弹出列表，列出每个被改写的文件与处数。
 * `skipped` 是有未保存修改、因而没有跟着重载的文档：保存它们会把重定向覆盖回去，必须在弹窗里点名。
 */
function reportContentRewrite(result: MoveContentResult, verb: '重命名' | '移动', skipped: readonly string[] = []): void {
  const report = contentRewriteReport(result, verb);
  if (report.rows.length === 0) {
    showToast(report.title);
    return;
  }
  showToast(`${report.title}，已重定向 ${report.references} 处引用`);
  contentRewriteTitle.textContent = report.title;
  contentRewriteSubtitle.textContent = report.subtitle;
  contentRewriteHint.textContent = skipped.length > 0
    ? `另有 ${skipped.length} 个文件有未保存修改，未自动重载：保存它们会覆盖本次重定向（${skipped.join('、')}）`
    : '改动已写入磁盘，可用右键菜单的「引用查看器」复核';
  contentRewriteList.replaceChildren(...report.rows.map((detail) => {
    const row = document.createElement('div');
    row.className = 'content-rewrite-item';
    const path = document.createElement('span');
    path.className = 'content-rewrite-path';
    path.textContent = detail.path;
    path.title = detail.path;
    const count = document.createElement('span');
    count.className = 'content-rewrite-count';
    count.textContent = `${detail.references} 处`;
    row.append(path, count);
    return row;
  }));
  contentRewriteModal.classList.remove('hidden');
  contentRewriteModal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => contentRewriteConfirm.focus(), 0);
}

/**
 * 文件夹改名：内部工作流全部换了路径，打开中的标签要按新旧前缀一起搬到新位置。
 * 必须在刷新目录之后调用（新描述符此时才在 bootstrap 里），返回搬迁后的文档 URI。
 */
function relocateFolderDocuments(oldFolder: string, newFolder: string): string[] {
  const folder = oldFolder.replace(/\\/g, '/').replace(/\/+$/, '');
  const prefix = `${folder}/`;
  const moved: string[] = [];
  if (!folder) return moved;
  for (const tab of getWorkflowTabs()) {
    const relative = relativeToProject(displayFileUri(tab.uri)).replace(/\\/g, '/');
    if (!relative.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const target = workflowDescriptorForPath(`${newFolder}/${relative.slice(prefix.length)}`);
    if (!target) continue;
    relocateDocument(tab.uri, target.uri);
    moved.push(target.uri);
  }
  return moved;
}

async function createContentFolderAt(parentPath: string): Promise<void> {
  if (contentFolderDraft) return;
  contentRenameDraft = undefined;
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

/**
 * 行内重命名入口（F2 与右键菜单「重命名」共用）：条目名称原地变成输入框。
 * 已有未保存修改时先提示，避免重命名把磁盘引用改写叠在脏内容上。
 */
async function renameContentItem(item: ContentBrowserItem): Promise<void> {
  if (isDirty()) {
    showToast('请先保存当前工作流，再重命名内容', true);
    return;
  }
  if (contentRenameDraft || contentFolderDraft) return;
  // 搜索/筛选可能把目标条目藏起来：跳到它的父目录，保证输入框出现在网格里。
  const parent = contentParent(item.path);
  if (parent !== contentBrowserFolder) navigateContentBrowser(parent);
  selectedContentPath = item.path;
  contentRenameDraft = { item, name: item.name, busy: false };
  renderContentBrowser();
}

function cancelContentRenameDraft(): void {
  if (!contentRenameDraft || contentRenameDraft.busy) return;
  contentRenameDraft = undefined;
  renderContentBrowser();
}

async function commitContentRenameDraft(): Promise<void> {
  const draft = contentRenameDraft;
  if (!draft || draft.busy) return;
  const input = contentBrowserItems.querySelector<HTMLInputElement>('.content-item-name-edit');
  const name = (input?.value ?? draft.name).trim();
  if (!name) {
    input?.focus();
    return;
  }
  if (name === draft.item.name) {
    // 名字没变：直接收掉输入框，不做任何磁盘操作。
    contentRenameDraft = undefined;
    renderContentBrowser();
    return;
  }
  draft.name = name;
  draft.busy = true;
  input?.setAttribute('aria-busy', 'true');
  if (input) input.disabled = true;
  try {
    await performContentRename(draft.item, name);
    contentRenameDraft = undefined;
    // performContentRename 内部已刷新过一遍（重命名后要按新路径重定位标签）；
    // 这里再刷一次把残留的编辑态输入框收掉。
    await refreshContentBrowser();
  } catch (error) {
    draft.busy = false;
    if (contentRenameDraft === draft) {
      renderContentBrowser();
      const nextInput = contentBrowserItems.querySelector<HTMLInputElement>('.content-item-name-edit');
      nextInput?.focus();
      nextInput?.select();
    }
    showToast(`重命名失败：${errorMessage(error)}`, true);
  }
}

/**
 * 执行一次真实的重命名：写盘、刷新目录、重定位打开的标签并重定向磁盘引用。
 * 失败抛错由调用方提示（commitContentRenameDraft）。
 */
async function performContentRename(item: ContentBrowserItem, newName: string): Promise<void> {
  const sourceWorkflow = item.kind === 'workflow' ? workflowDescriptorForPath(item.path) : undefined;
  const sourceWorkflowTab = sourceWorkflow
    ? getWorkflowTabs().find((tab) => tab.uri === sourceWorkflow.uri)
    : undefined;
  if (sourceWorkflowTab?.dirty) {
    throw new Error('请先保存该工作流，再重命名它');
  }
  const currentRelative = getCurrentUri() ? relativeToProject(displayFileUri(getCurrentUri())).replace(/\\/g, '/') : '';
  const renamingCurrentWorkflow = item.kind === 'workflow' && currentRelative.toLowerCase() === item.path.toLowerCase();
  const result = await api.renameContent({ sourcePath: item.path, newName });
  selectedContentPath = result.targetPath;
  await refreshContentBrowser();
  if (item.kind === 'folder') {
    // 文件夹改名带走了内部所有工作流：先把打开中的标签搬到新路径，再统一重新读盘。
    const relocated = relocateFolderDocuments(item.path, result.targetPath);
    if (relocated.includes(getCurrentUri())) await loadWorkflow(getCurrentUri());
  } else if (renamingCurrentWorkflow) {
    const renamed = getBootstrap()?.workflows.find((workflow) => workflow.rel.replace(/\\/g, '/').toLowerCase() === result.targetPath.toLowerCase());
    if (renamed) {
      const oldUri = getCurrentUri();
      renameWorkflowTab(oldUri, renamed.uri);
      relocateDocument(oldUri, renamed.uri);
      await loadWorkflow(renamed.uri);
    }
  } else if (sourceWorkflowTab) {
    const renamed = getBootstrap()?.workflows.find((workflow) => workflow.rel.replace(/\\/g, '/').toLowerCase() === result.targetPath.toLowerCase());
    if (renamed) {
      const oldUri = sourceWorkflowTab.uri;
      renameWorkflowTab(oldUri, renamed.uri);
      relocateDocument(oldUri, renamed.uri);
    }
  }
  // 磁盘引用可能刚被重写：打开中的文档必须重新读盘，不能沿用内存里的旧正文。
  const skipped = await reloadRewrittenDocuments(result.rewritten.map((detail) => detail.path));
  reportContentRewrite(result, '重命名', skipped);
}

async function deleteContentItem(item: ContentBrowserItem): Promise<void> {
  if (isDirty()) {
    showToast('请先保存当前工作流，再删除内容', true);
    return;
  }
  if (contentRenameDraft) contentRenameDraft = undefined;
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
        removeWorkflowTab(oldUri);
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
        removeWorkflowTab(oldUri);
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
const CONTENT_BROWSER_ZOOM_KEY = 'onmyoji-studio.content-browser.zoom';

/** 切换网格/列表视图并持久化。 */
function setContentBrowserView(view: 'grid' | 'list'): void {
  contentBrowserView = view === 'list' ? 'list' : 'grid';
  window.localStorage.setItem(CONTENT_BROWSER_VIEW_KEY, contentBrowserView);
  renderContentBrowser();
}

/** 内容区条目缩放（Ctrl + 滚轮）：改 --cb-zoom 派生所有尺寸，默认 1 即原大小。 */
function applyContentBrowserZoom(value: number, persist = true): void {
  const zoom = Number.isFinite(value) ? Math.min(CONTENT_BROWSER_ZOOM_MAX, Math.max(CONTENT_BROWSER_ZOOM_MIN, value)) : 1;
  contentBrowserItems.style.setProperty('--cb-zoom', String(Math.round(zoom * 100) / 100));
  if (persist) window.localStorage.setItem(CONTENT_BROWSER_ZOOM_KEY, String(Math.round(zoom * 100) / 100));
}

function readContentBrowserZoom(): number {
  const stored = parseFloat(window.localStorage.getItem(CONTENT_BROWSER_ZOOM_KEY) ?? '');
  return Number.isFinite(stored) && stored > 0 ? stored : 1;
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
  contentRewriteClose.addEventListener('click', hideContentRewriteDialog);
  contentRewriteConfirm.addEventListener('click', hideContentRewriteDialog);
  contentRewriteModal.addEventListener('pointerdown', (event) => {
    if (event.target === contentRewriteModal) hideContentRewriteDialog();
  });
  contentRewriteModal.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    hideContentRewriteDialog();
  });
  document.querySelector('#content-browser-up')!.addEventListener('click', () => navigateContentBrowser(contentParent(contentBrowserFolder)));
  document.querySelector('#content-browser-refresh')!.addEventListener('click', () => void refreshContentBrowser());
  bindContentDropTarget(contentBrowserItems, () => contentBrowserFolder);
  contentBrowserItems.addEventListener('contextmenu', (event) => {
    if (event.target instanceof Element && event.target.closest('.content-item')) return;
    event.preventDefault();
    showContentContextMenu(event, contentFolderItem(contentBrowserFolder), contentBrowserItems);
  });
  // Ctrl + 滚轮缩放条目（相当于「文件大小」）：只改 --cb-zoom，不重排 DOM。
  applyContentBrowserZoom(readContentBrowserZoom(), false);
  contentBrowserItems.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return; // Ctrl + 滚轮；macOS 的 Cmd / 触控板捏合同样走这里
    event.preventDefault(); // 别让 Electron 缩放整个界面
    const current = parseFloat(contentBrowserItems.style.getPropertyValue('--cb-zoom')) || readContentBrowserZoom();
    const next = nextContentBrowserZoom(current, event.deltaY, event.deltaMode);
    if (next !== current) applyContentBrowserZoom(next);
  }, { passive: false });
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
  getWorkflowTabs: () => readonly WorkflowDocumentTab[];
  renameWorkflowTab: (oldUri: string, newUri: string) => void;
  removeWorkflowTab: (uri: string) => void;
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
  reloadRewrittenDocuments: (paths: readonly string[]) => Promise<string[]>;
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
  /** 重命名快捷键用的条目解析：与删除共用同一份路径→条目回退逻辑。 */
  resolveRenameTarget(path: string): ContentBrowserItem | undefined;
  isRootFolder(path: string): boolean;
  deleteItem(item: ContentBrowserItem): Promise<void>;
  /** 打开重命名对话框并执行重命名（右键菜单「重命名」的同一入口）。 */
  renameItem(item: ContentBrowserItem): Promise<void>;
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
  renameWorkflowTab = deps.renameWorkflowTab;
  removeWorkflowTab = deps.removeWorkflowTab;
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
  reloadRewrittenDocuments = deps.reloadRewrittenDocuments;
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
    resolveRenameTarget: resolveContentDeleteTarget,
    isRootFolder: isContentRootFolder,
    deleteItem: deleteContentItem,
    renameItem: renameContentItem,
    // 行内重命名草稿对快捷键守卫来说等价于一个打开的命名对话框。
    isNameDialogOpen: () => Boolean(contentNameDialogState) || Boolean(contentRenameDraft),
    cancelNameDialog: () => {
      finishContentNameDialog(null);
      if (contentRenameDraft) cancelContentRenameDraft();
    },
  };
}

export { contentName, relativeToProject };
