/**
 * 画布渲染调度：把「重绘原因」显式化，并把同一帧内的重复请求合并成一次。
 *
 * 设计约束（与既有画布语义保持一致）：
 * - 默认路径仍然是同步重绘：几乎所有交互（选中、菜单、就地编辑器贴合、撤销恢复）
 *   都要求在事件处理结束前看到新画面，绝不能延后一帧。
 * - 只有高频路径（指针移动、滚轮缩放）显式走 `coalesce()`：同一帧内多次请求只执行
 *   一次，且执行时带的是合并后的标记集合。
 * - 没有 `requestAnimationFrame` 的环境（node 测试、SSR）里 `coalesce()` 退化成同步，
 *   于是行为与 `request()` 完全一致，测试无需自行推进帧。
 *
 * 这里只做「调度」，不碰 DOM；真正的按标记渲染在 render-entry。
 */

/** 一次重绘涉及的范围。标记可以叠加，范围大的吞掉范围小的。 */
export interface RenderFlags {
  /** 平移/缩放：只需更新根图层变换、缩放分级与可见集合。 */
  viewport?: boolean;
  /** 拖动、临时连线、框选：只更新相关 SVG 元素。 */
  interaction?: boolean;
  /** 选中态变化：更新选中样式与详情面板。 */
  selection?: boolean;
  /** 节点/参数/连线结构变化：局部对账。 */
  graph?: boolean;
  /** 详情栏、结构树、变量列表、校验徽标等非画布面板。 */
  panels?: boolean;
  /** 小地图结构重建（仅布局或结构变化时）。 */
  minimap?: boolean;
  /** 首次载入、撤销恢复、文档整体替换：丢弃所有缓存重建。 */
  full?: boolean;
}

export type RenderFlagName = keyof RenderFlags;

/** 补齐后的范围：每个标记都有确定的真假，渲染层不必再判空。 */
export interface ResolvedRenderFlags {
  full: boolean;
  graph: boolean;
  minimap: boolean;
  viewport: boolean;
  interaction: boolean;
  selection: boolean;
  panels: boolean;
}

export interface RenderSchedulerOptions {
  run(reason: RenderFlags): void;
  /** 帧调度函数；缺省用全局 requestAnimationFrame，没有则同步执行。 */
  scheduleFrame?(fn: () => void): void;
  /** 允许把同帧请求合并到下一帧（默认在有 rAF 时开启）。 */
  coalesce?: boolean;
}

export interface CanvasRenderScheduler {
  /** 立即（同步）重绘，合并进尚未执行的重绘一起跑。 */
  request(flags?: RenderFlags): void;
  /** 合并到本帧的重绘里，最多执行一次；无帧调度时同步执行。 */
  coalesce(flags?: RenderFlags): void;
  /** 是否有排队等待的重绘。 */
  pending(): boolean;
  /** 丢弃排队中的重绘（文档被替换、画布销毁时用）。 */
  cancel(): void;
}

/** 标记的包含关系：大范围吞掉小范围。 */
const FLAG_ORDER: RenderFlagName[] = ['full', 'graph', 'minimap', 'viewport', 'interaction', 'selection', 'panels'];

function normalize(flags: RenderFlags | undefined): RenderFlags {
  const next: RenderFlags = {};
  for (const name of FLAG_ORDER) if (flags && flags[name]) next[name] = true;
  return next;
}

function isFull(flags: RenderFlags): boolean {
  return Boolean(flags.full);
}

export function createRenderScheduler(options: RenderSchedulerOptions): CanvasRenderScheduler {
  const scheduleFrame = options.scheduleFrame
    ?? (typeof requestAnimationFrame === 'function' ? (fn: () => void) => requestAnimationFrame(() => fn()) : (fn: () => void) => fn());
  const canCoalesce = options.coalesce ?? (typeof requestAnimationFrame === 'function');

  /** 排队等待执行的重绘标记；空对象表示「有请求但没有具体标记」。 */
  let pending: RenderFlags | null = null;
  let frameScheduled = false;
  /** 执行中收到的请求不能递归重入，递归会重新排队等下一帧。 */
  let running = false;

  function merge(flags: RenderFlags | undefined): void {
    const next = normalize(flags);
    if (!pending) {
      pending = next;
      return;
    }
    for (const name of FLAG_ORDER) if (next[name]) pending[name] = true;
  }

  function flush(): void {
    if (running) return;
    if (!pending) return;
    // 先摘下来再执行：执行期间新来的请求会重新排队，不会丢，也不会递归。
    const reason = pending;
    pending = null;
    running = true;
    try {
      options.run(reason);
    } finally {
      running = false;
    }
  }

  function request(flags: RenderFlags = {}): void {
    merge(flags);
    flush();
  }

  function coalesce(flags: RenderFlags = {}): void {
    merge(flags);
    if (!canCoalesce) {
      flush();
      return;
    }
    if (frameScheduled) return;
    frameScheduled = true;
    scheduleFrame(() => {
      frameScheduled = false;
      flush();
    });
  }

  function pendingNow(): boolean {
    return pending !== null;
  }

  function cancel(): void {
    pending = null;
    frameScheduled = false;
  }

  return { request, coalesce, pending: pendingNow, cancel };
}

/**
 * 把若干标记合并成一次具体重绘要做的范围。
 * `full` 之下所有范围都要重做；`viewport` 之下不需要碰卡片内容与面板。
 */
export function resolveRenderScope(flags: RenderFlags): ResolvedRenderFlags {
  const full = isFull(flags);
  const graph = full || Boolean(flags.graph);
  return {
    full,
    graph,
    minimap: full || graph || Boolean(flags.minimap),
    viewport: full || graph || Boolean(flags.viewport),
    interaction: full || graph || Boolean(flags.interaction),
    selection: full || graph || Boolean(flags.selection) || Boolean(flags.interaction),
    panels: full || graph || Boolean(flags.panels) || Boolean(flags.selection),
  };
}
