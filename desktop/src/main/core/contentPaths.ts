import path from 'node:path';

/** 内容浏览器当前支持的两类项目资源。 */
export type ContentKind = 'workflow' | 'asset';

/** 已定位到磁盘上的项目内容文件。 */
export interface ContentFileLocation {
  relative: string;
  absolute: string;
  kind: ContentKind;
}

/**
 * 判断候选路径是否位于指定目录中。
 *
 * 两个路径都会先转成绝对路径，避免 `..`、相对路径或相似目录名前缀绕过边界检查。
 */
export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** 把项目相对路径编码为自定义资源协议可安全使用的 URL 路径。 */
export function encodeResourcePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]/)
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/**
 * 规范化来自界面的项目相对路径，并拒绝绝对路径和目录穿越。
 * 返回值统一使用 `/`，便于跨平台保存和比较。
 */
export function normalizeProjectRelative(raw: string): string {
  const value = String(raw ?? '').replace(/\\/g, '/').trim();
  if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) throw new Error('文件路径无效');
  const normalized = path.posix.normalize(value).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('文件路径无效');
  }
  return normalized;
}

/** 校验单个文件或文件夹名称，禁止路径分隔符和 Windows 非法字符。 */
export function normalizeContentName(raw: string): string {
  const name = String(raw ?? '').trim();
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || /[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('名称无效');
  }
  return name;
}
