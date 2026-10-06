/**
 * 内容浏览器的纯条目工具：目录归属判断与按类型递归收集。
 * 原 content-browser.ts 顶部的 isUnderContentFolder/contentBrowserRecursiveItems；
 * 依赖（当前目录、目录清单、条目来源）显式传入，便于独立测试。
 */

export type ContentBrowserItemKind = 'folder' | 'workflow' | 'asset';

/** 条目工具需要的最小形状（content-browser.ts 的 ContentBrowserItem 满足它）。 */
export interface ContentBrowserItemLike {
  kind: ContentBrowserItemKind;
  path: string;
  name: string;
}

export interface ContentBrowserFolderDraftLike {
  parentPath: string;
  name: string;
}

export interface ContentBrowserRenameDraftLike<T extends ContentBrowserItemLike> {
  item: T;
}

export interface ContentBrowserRenderPlanItem<T extends ContentBrowserItemLike> {
  item: T;
  editing: boolean;
}

export interface ContentBrowserRenderPlanOptions<T extends ContentBrowserItemLike> {
  entries: readonly T[];
  folder: string;
  query: string;
  folderDraft?: ContentBrowserFolderDraftLike;
  renameDraft?: ContentBrowserRenameDraftLike<T>;
  createFolderDraft(path: string, name: string): T;
}

/**
 * 生成内容区的稳定渲染计划。
 *
 * 新建文件夹固定排在第一项；正在重命名但被筛选隐藏的条目也临时补到第一项。
 * 这段规则不接触 DOM，视图层只需按顺序创建元素，测试也能直接验证真实实现。
 */
export function contentBrowserRenderPlan<T extends ContentBrowserItemLike>(
  options: ContentBrowserRenderPlanOptions<T>,
): ContentBrowserRenderPlanItem<T>[] {
  const entries = [...options.entries];
  const folderDraftVisible = Boolean(
    options.folderDraft
    && options.folderDraft.parentPath === options.folder
    && !options.query,
  );
  if (folderDraftVisible && options.folderDraft) {
    entries.unshift(options.createFolderDraft(
      `${options.folderDraft.parentPath}/.new-folder`,
      options.folderDraft.name,
    ));
  }
  if (options.renameDraft && !entries.some((entry) => entry.path === options.renameDraft!.item.path)) {
    entries.unshift(options.renameDraft.item);
  }
  return entries.map((item, index) => ({
    item,
    editing: Boolean(
      (folderDraftVisible && index === 0 && item.path.endsWith('/.new-folder'))
      || (options.renameDraft && item.path === options.renameDraft.item.path),
    ),
  }));
}

export interface ContentFolderRelocation {
  oldUri: string;
  newUri: string;
}

export interface ContentFolderRelocationOptions {
  oldFolder: string;
  newFolder: string;
  tabs: readonly { uri: string }[];
  relativePath(uri: string): string;
  targetUri(relativePath: string): string | undefined;
}

/**
 * 计算文件夹改名后需要迁移的已打开工作流标签。
 *
 * 路径比较忽略大小写但要求完整目录边界，避免把 `foo` 的移动误应用到 `foo2`。
 * 本函数只生成计划，文档状态的实际迁移仍由工作台统一执行。
 */
export function contentFolderRelocations(options: ContentFolderRelocationOptions): ContentFolderRelocation[] {
  const folder = options.oldFolder.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!folder) return [];
  const prefix = `${folder}/`;
  const moved: ContentFolderRelocation[] = [];
  for (const tab of options.tabs) {
    const relative = options.relativePath(tab.uri).replace(/\\/g, '/');
    if (!relative.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const newUri = options.targetUri(`${options.newFolder}/${relative.slice(prefix.length)}`);
    if (newUri) moved.push({ oldUri: tab.uri, newUri });
  }
  return moved;
}

/** 是否位于目录下（含目录自身）；空目录表示项目根，永远为真。 */
export function isUnderContentFolder(path: string, folder: string): boolean {
  if (!folder) return true;
  return path === folder || path.startsWith(`${folder}/`);
}

/** 内容区条目缩放的上下限（Ctrl + 滚轮）。 */
export const CONTENT_BROWSER_ZOOM_MIN = .7;
export const CONTENT_BROWSER_ZOOM_MAX = 1.8;

/**
 * Ctrl + 滚轮换算条目缩放：向上滚放大、向下滚缩小，行/页模式先归一到像素，
 * 结果夹在上下限内并保留两位小数（持久化时不会有浮点噪声）。
 */
export function nextContentBrowserZoom(current: number, deltaY: number, deltaMode = 0): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  const next = base * Math.exp(-pixels * .0015);
  const clamped = Math.min(CONTENT_BROWSER_ZOOM_MAX, Math.max(CONTENT_BROWSER_ZOOM_MIN, next));
  return Math.round(clamped * 100) / 100;
}

export interface RecursiveItemsSources {
  /** 当前目录；空串表示项目根目录。 */
  folder: string;
  contentName(value: string): string;
  contentFolders(): string[];
  workflowItems(): ContentBrowserItemLike[];
  assetItems(): ContentBrowserItemLike[];
}

/**
 * 类型过滤：递归收集当前目录（含子目录）下的同类条目，
 * 这样在项目根目录按类型过滤时也能看到深层资产。
 */
export function contentBrowserRecursiveItems(sources: RecursiveItemsSources, kind: ContentBrowserItemKind): ContentBrowserItemLike[] {
  const { folder } = sources;
  if (kind === 'folder') {
    return sources.contentFolders()
      .filter((candidate) => candidate && candidate !== folder && isUnderContentFolder(candidate, folder))
      .map((candidate): ContentBrowserItemLike => ({ kind: 'folder', path: candidate, name: sources.contentName(candidate) }));
  }
  const pool = kind === 'workflow' ? sources.workflowItems() : sources.assetItems();
  return pool.filter((item) => isUnderContentFolder(item.path, folder));
}
