/**
 * 主窗口几何记忆：窗口位置、尺寸与最大化状态属于「用户布局」，和停靠布局一起持久化。
 *
 * 这里只放可测试的纯函数，主进程负责读写存储与事件接线。恢复时必须先判断这份几何
 * 还落在某个显示器的工作区里：换屏、改分辨率或拔掉外接屏之后，上一份坐标会把窗口
 * 丢到看不见的地方；尺寸再按所有显示器工作区的并集收敛，避免整窗比屏幕还大。
 */

/** 窗口几何（与 Electron `BrowserWindow.getNormalBounds()` 同形）。 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 显示器工作区（`screen.getAllDisplays()[i].workArea` 的子集）。 */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 持久化的窗口状态：最大化时记的是还原后的几何，所以取消最大化也能回到原位置。 */
export interface WindowState {
  bounds: WindowBounds;
  maximized: boolean;
}

/** 交给 `new BrowserWindow` 的窗口几何；缺省 x/y 时由系统居中。 */
export interface WindowGeometry {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

/** 与 `createWindow` 的 minWidth/minHeight 保持一份来源。 */
export const MIN_WINDOW_WIDTH = 880;
export const MIN_WINDOW_HEIGHT = 620;

/** 只要与工作区重叠这么多像素就认为窗口还看得见（标题栏与左缘都要能抓到）。 */
const MIN_VISIBLE_SPAN = 80;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function round(value: number): number {
  return Math.round(value);
}

/** 解析存储里的窗口状态；字段缺失、非数字或 JSON 坏掉时返回 `undefined`（按首次运行处理）。 */
export function parseWindowState(raw: string | null | undefined): WindowState | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  if (width === undefined || height === undefined) return undefined;
  return {
    bounds: {
      x: round(finiteNumber(record.x) ?? 0),
      y: round(finiteNumber(record.y) ?? 0),
      width: round(Math.max(MIN_WINDOW_WIDTH, width)),
      height: round(Math.max(MIN_WINDOW_HEIGHT, height)),
    },
    maximized: record.maximized === true,
  };
}

export function serializeWindowState(state: WindowState): string {
  return JSON.stringify({
    x: round(state.bounds.x),
    y: round(state.bounds.y),
    width: round(state.bounds.width),
    height: round(state.bounds.height),
    maximized: state.maximized === true,
  });
}

/** 窗口是否与至少一个工作区重叠了「抓得住」的一块。 */
export function visibleOnDisplays(bounds: WindowBounds, areas: readonly WorkArea[]): boolean {
  return areas.some((area) => {
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapWidth >= MIN_VISIBLE_SPAN && overlapHeight >= MIN_VISIBLE_SPAN;
  });
}

/** 所有工作区的并集：多屏并排时窗口仍可跨越，但不会比整个桌面还大。 */
function unionOf(areas: readonly WorkArea[]): WorkArea | undefined {
  if (areas.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const area of areas) {
    minX = Math.min(minX, area.x);
    minY = Math.min(minY, area.y);
    maxX = Math.max(maxX, area.x + area.width);
    maxY = Math.max(maxY, area.y + area.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 恢复用的窗口几何：位置还能看见就沿用上一份（连同最大化状态）；
 * 否则退回默认尺寸、交给系统居中，并且不带最大化——旧坐标已经不成立了，
 * 再按它去最大化只会落在已经不存在的显示器上。
 */
export function resolveWindowGeometry(
  state: WindowState | undefined,
  areas: readonly WorkArea[],
  fallback: { width: number; height: number },
): WindowGeometry {
  if (state && visibleOnDisplays(state.bounds, areas)) {
    const union = unionOf(areas);
    return {
      x: state.bounds.x,
      y: state.bounds.y,
      width: union ? round(Math.min(state.bounds.width, union.width)) : state.bounds.width,
      height: union ? round(Math.min(state.bounds.height, union.height)) : state.bounds.height,
      maximized: state.maximized,
    };
  }
  return { width: fallback.width, height: fallback.height, maximized: false };
}
