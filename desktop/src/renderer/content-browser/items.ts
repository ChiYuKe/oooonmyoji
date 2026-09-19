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
