/**
 * 画布缩放分级：按 zoom 决定卡片显示到什么程度，并给出切换时的迟滞，避免在阈值上来回重建。
 *
 * - full：完整卡片（参数、装饰器、预览、全部端口）。
 * - compact：紧凑卡片（标题、类型、关键摘要与端口，隐藏图片预览与详细说明）。
 * - overview：概览卡片（标题、类型、运行状态与结构关系，隐藏变量/引用边）。
 *
 * 分级只通过根图层上的 class（`zoom-full` / `zoom-compact` / `zoom-overview`）表达，
 * CSS 负责显隐；节点元素不会被重建，因此缩放分级切换不会造成 DOM 抖动。
 */

export type CanvasDetailLevel = 'full' | 'compact' | 'overview';

export const FULL_DETAIL_MIN_ZOOM = 0.75;
export const COMPACT_DETAIL_MIN_ZOOM = 0.45;
/** 双击节点聚焦后的缩放（概览模式下始终能落到完整卡片）。 */
export const FOCUS_ZOOM = 0.8;

/** 分级迟滞：只有离开阈值这么多才换级，避免滚轮停在边界时反复重建。 */
export const DETAIL_LEVEL_HYSTERESIS = 0.03;

export function detailLevelForZoom(zoom: number): CanvasDetailLevel {
  if (zoom >= FULL_DETAIL_MIN_ZOOM) return 'full';
  if (zoom >= COMPACT_DETAIL_MIN_ZOOM) return 'compact';
  return 'overview';
}

/**
 * 带迟滞的分级判定：当前级别在阈值附近抖动时保持不变。
 * `previous` 为空（首次渲染或强制重建）时直接按 zoom 判定。
 */
export function resolveDetailLevel(zoom: number, previous?: CanvasDetailLevel | null): CanvasDetailLevel {
  if (!previous) return detailLevelForZoom(zoom);
  const exact = detailLevelForZoom(zoom);
  if (exact === previous) return previous;
  // 跨两级的跳变（例如 1.0 → 0.3 再回到 0.46）没有迟滞可谈：直接按 zoom 判定。
  const distance = Math.abs(levelIndex(exact) - levelIndex(previous));
  if (distance > 1) return exact;
  if (previous === 'full' && exact === 'compact') return zoom < FULL_DETAIL_MIN_ZOOM - DETAIL_LEVEL_HYSTERESIS ? exact : previous;
  if (previous === 'compact' && exact === 'full') return zoom > FULL_DETAIL_MIN_ZOOM + DETAIL_LEVEL_HYSTERESIS ? exact : previous;
  if (previous === 'compact' && exact === 'overview') return zoom < COMPACT_DETAIL_MIN_ZOOM - DETAIL_LEVEL_HYSTERESIS ? exact : previous;
  if (previous === 'overview' && exact === 'compact') return zoom > COMPACT_DETAIL_MIN_ZOOM + DETAIL_LEVEL_HYSTERESIS ? exact : previous;
  return exact;
}

function levelIndex(level: CanvasDetailLevel): number {
  return level === 'full' ? 2 : level === 'compact' ? 1 : 0;
}

/** 该分级下是否显示变量 / 引用连线（选中相关连线除外，由渲染层单独放行）。 */
export function showsDataEdges(level: CanvasDetailLevel): boolean {
  return level !== 'overview';
}

/**
 * 视口外扩区（CSS 像素）：视口外这么多距离内的卡片仍然挂载，避免平移时反复装卸。
 * 世界坐标下的外扩量是它除以 zoom。
 */
export const VIEWPORT_PADDING_CSS = 300;
