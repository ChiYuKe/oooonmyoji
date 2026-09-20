/**
 * 画布持久化图层控制器：把「每次操作重建整张画布」换成「持久图层 + 按帧局部更新 + 视口裁剪 +
 * 缩放分级」。
 *
 * 职责边界：
 * - 本模块只决定**哪些元素该挂载、哪些元素内容需要重建、哪些元素只需改属性**；
 *   元素长什么样仍然由既有的 renderNode/renderVariableCard/renderEdge 负责，视觉不变。
 * - 文档、选择与视口状态由调用方注入，本模块不写文档。
 *
 * 关键不变量：
 * - 结构边按曲线本身是否与视口相交裁剪；与画面相交的线会保留两端占位。
 *   因此缩放后即使一端卡片刚好离开视口，画面内的线段也不会整条消失，同时不会产生悬空端点。
 * - 卡片元素按内容签名复用：签名不变就只改 transform 与状态 class，不重建子元素。
 * - `full`（首次载入、撤销恢复、文档替换）才整层重建。
 */
import type { CanvasState } from '../state/canvas-state';
import type { CanvasDetailLevel } from './zoom-level';
import { VIEWPORT_PADDING_CSS, showsDataEdges } from './zoom-level';
import { createSpatialIndex, rectsIntersect, type CanvasSpatialIndex, type SpatialRect } from './spatial-index';
import { createRenderScheduler, type CanvasRenderScheduler, type RenderFlags } from './render-scheduler';

export interface GraphEdgeGeometry {
  id: string;
  kind: 'structural' | 'instance';
  parentId: string;
  childId: string;
}

export interface EdgePoint {
  x: number;
  y: number;
}

export interface EdgeGeometry {
  from: EdgePoint;
  to: EdgePoint;
}

export interface GraphLayerPatchers {
  /** 拖动只改这一个属性。 */
  nodeTransform(id: string, x: number, y: number): boolean;
  /** 只更新与被拖节点相邻的连线路径。 */
  nodeEdges(id: string): void;
}

export interface GraphLayerContext {
  state: CanvasState;
  graph: Element;
  svgEl(tag: string, attrs: Record<string, any>, parent?: any): any;
  nodes(): any[];
  nodeById(id: string): any;
  position(node: any): { x: number; y: number };
  nodeHeight(node: any): number;
  /**
   * 同步创建一个尚无内容的卡片壳（`.node-placeholder`，带 `data-id` 与 transform）。
   * 视口突然变大（缩小画布）时先用壳占位、内容分帧补齐：单帧工作量因此有上界，
   * 输入不会因为一次挂载几百张卡片而卡住。缺省表示该渲染层不支持占位（一次性补齐）。
   */
  renderNodePlaceholder?(parent: any, node: any): any;
  /** 结构边快照（父节点 → 子节点顺序）。 */
  structuralEdges(): GraphEdgeGeometry[];
  instanceRunCards(): any[];
  variableCardList(): any[];
  /** 变量卡几何（世界坐标）。 */
  variableCardRect(card: any): SpatialRect;
  nodeVariablePins(node: any): any[];
  /** 该节点引用了哪些节点输出（用于保留引用边的源节点）。 */
  referenceSourceIds?(node: any): string[];
  /** 文档版本：变化即视为结构可能变化。 */
  docVersion(): number;
  /**
   * 内容版本：**只有节点/参数内容真正变化**时才需要 +1。
   *
   * 与 `docVersion` 的区别在于「拖动节点位置」这类不改变卡片内容的改动。
   * 卡片内容签名的帧内缓存用它做失效键：平移/缩放/拖拽期间签名不必重算，
   * 500 节点首次渲染因此不必为每张卡片做一次节点序列化。
   * 缺省退化为 `docVersion()`（保守但正确）。
   */
  contentVersion?(): number;
  /**
   * 整份文档的校验错误指纹：错误标记会改变卡片外观，但它是**文档级**信息，
   * 由渲染层算一次即可。缺省返回空串（没有校验标记的画布）。
   */
  issueFingerprint?(): string;
  /** 视口实际像素尺寸（CSS 像素）。 */
  viewportSize(): { width: number; height: number };
  renderNode(layer: any, node: any): any;
  renderVariableCard(layer: any, card: any): any;
  renderInstanceRunCard(layer: any, card: any): any;
  renderEdge(layer: any, parent: any, childId: string, order: number): any;
  renderInstanceRunEdge(layer: any, card: any): any;
  renderVariableEdges(layer: any): void;
  renderReferenceEdges(layer: any): void;
  /**
   * 临时连线预览：从端口拖出、还没落下的那一条（节点连线 / 变量连线 / 输出引用）。
   * 控制器每帧先清空 `previews` 层再调它，所以实现只管把当前那一条画进去（可以只画一条）。
   * 缺省表示该渲染层不画预览。
   */
  renderConnectionPreviews?(layer: any): void;
  nodeSignature(id: string): string;
  cardSignature(card: any): string;
  runCardSignature(card: any): string;
  /** 连线几何（含弯曲量），用于裁剪；返回 null 表示这条线画不出来。 */
  edgeGeometry(kind: 'structural' | 'instance', parentId: string, childId: string): EdgeGeometry | null;
  nodeWidth: number;
  runCardWidth: number;
  runCardBaseHeight: number;
}

export interface CanvasRenderStats {
  /** 本帧实际挂载（重建）的卡片元素数。 */
  mountedNodes: number;
  mountedCards: number;
  mountedRuns: number;
  /** 本帧只改属性、没有重建的卡片数。 */
  patchedNodes: number;
  /** 本帧直接复用（连内容签名都没算）的卡片数：平移/缩放/拖拽的常态。 */
  reusedNodes: number;
  /** 本帧被裁剪（未挂载）的卡片数。 */
  culledNodes: number;
  /** 本帧被裁剪（未挂载）的连线数。 */
  culledEdges: number;
  /** 自创建以来发生过的整层重建次数；平移/缩放/拖拽期间必须为 0。 */
  fullRebuilds: number;
  /** 自创建以来执行的重绘帧数。 */
  frames: number;
  /** 自创建以来所有重绘帧的同步耗时总和（毫秒）：可离线核算「一次载入花了多少 JS 时间」。 */
  totalRenderMs: number;
  /** 本帧重建的连线条数。 */
  rebuiltEdges: number;
  /** 当前仍以「壳」挂载、等待补内容的卡片数。 */
  placeholderNodes: number;
  /** 当前挂载的卡片 / 连线元素数量（DOM 占用）。 */
  activeNodes: number;
  activeEdges: number;
  /** 当前缩放分级。 */
  detailLevel: CanvasDetailLevel | null;
  /** 最近一帧的耗时（毫秒，仅用于基准展示）。 */
  lastFrameMs: number;
  /** 最近一帧的分段耗时（毫秒）：空间索引、可见集合、卡片装卸、连线重建。 */
  lastFrameBreakdown: { indexMs: number; visibleMs: number; cardsMs: number; edgesMs: number; totalMs: number };
}

export interface CanvasRenderControllerOptions {
  state: CanvasState;
  /** 图层所在容器（`#graph`）；首次渲染时创建持久图层。 */
  host: Element;
  context: GraphLayerContext;
  patchers: GraphLayerPatchers;
  /** 外部（渲染入口）判定的缩放分级：视口标记的执行者只需要用它决定挂载什么。 */
  detailLevel?: CanvasDetailLevel | null;
  onFrame?(detail: { scope: RenderFlags; stats: CanvasRenderStats }): void;
  /** 连线整体重建之前调用：用于清空外部的连线元素索引。 */
  beforeEdgeRebuild?(): void;
  /**
   * 每帧最多**同步**建多少张真实卡片。
   *
   * 视口突然变大（缩小画布）时可见节点会成倍增加；如果一帧内把它们全部建出来，
   * 单帧就会从 1 ms 涨到 20 ms 以上，输入立刻失去响应。超过预算的部分先挂壳，
   * 由渲染入口在后续帧分批补齐——用户看到的是「逐级显影」，而不是卡顿。
   */
  nodeBuildBudgetPerFrame?: number;
  /**
   * 外部提供的「节点 id → 元素」索引。传入后由控制器在装卸时维护，
   * 这样拖拽补丁不必等一帧就能拿到最新元素。
   */
  mountedNodes?: Map<string, any>;
}

export interface CanvasRenderController {
  scheduler: CanvasRenderScheduler;
  request(flags?: RenderFlags): void;
  coalesce(flags?: RenderFlags): void;
  /** 整层重建（首次渲染、文档替换、导出前）。 */
  rebuildAll(): void;
  /** 导出期间暂停裁剪，保证导出拿到完整画面。 */
  setRenderAll(value: boolean): void;
  isRenderAll(): boolean;
  /** 丢弃所有缓存元素（图层被外部清空后必须调用）。 */
  dropCache(): void;
  /** 重置本帧建卡预算：需要「立即补齐」的调用方（导出、测试）显式重置后自行循环补齐。 */
  resetBuildBudget(): void;
  stats(): CanvasRenderStats;
  activeNodeIds(): string[];
  activeCardIds(): string[];
  /**
   * 仍以「壳」形式挂载、等待补内容的节点 id。
   * 由渲染入口分帧补齐（见 render-entry 的补内容循环）。
   */
  pendingPlaceholders(): string[];
  /** 用真实内容重建一个已占位的卡片；返回 false 表示它已不需要补齐。 */
  fillPlaceholder(id: string): boolean;
  /** 已挂载的节点 id → SVG 元素（拖拽补丁与测试用）。 */
  mountedNodes(): Map<string, any>;
  /** 元素索引本体：装卸时同步维护，拖动补丁可以直接读最新值。 */
  readonly mounted: Map<string, any>;
  /** 持久图层容器；首次调用即创建。 */
  getLayer(): { root: any; wires: any; variableEdges: any; referenceEdges: any; cards: any; variableCards: any; previews: any; overlays: any };
  /** 当前可见性裁剪使用的世界坐标视口矩形。 */
  viewportRect(): SpatialRect;
  index: CanvasSpatialIndex;
}

/** 视口外扩（世界坐标）。 */
export function inflateRect(rect: SpatialRect, padding: number): SpatialRect {
  return { x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
}

/**
 * 与 viewport.bezier 一致的三次曲线粗包围盒。
 * 控制点也必须算进去：两个端点很近时，48px 的最小弯曲量会让曲线超出端点矩形。
 */
export function edgeGeometryRect(geometry: EdgeGeometry): SpatialRect {
  const { from, to } = geometry;
  const bend = Math.max(48, Math.abs(to.y - from.y) * 0.48);
  const xs = [from.x, to.x];
  const ys = [from.y, from.y + bend, to.y - bend, to.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export const DEFAULT_NODE_BUILD_BUDGET = 10;

export function createCanvasRenderController(options: CanvasRenderControllerOptions): CanvasRenderController {
  const { state, host, context, patchers } = options;
  const index = createSpatialIndex();
  const buildBudgetPerFrame = options.nodeBuildBudgetPerFrame ?? DEFAULT_NODE_BUILD_BUDGET;

  /**
   * 挂载表：元素 + 内容签名 + **上次写进 DOM 的位置**。
   *
   * 位置不进内容签名（否则拖拽每帧都要重建卡片），拖拽帧由 `applyPatches` 就地改写 transform。
   * 其他会移动卡片的操作——自动排列、外部改写、分组投影变化——不走补丁路径，
   * 所以这里记着渲染时的坐标，下一帧发现对不上就补一次 transform；
   * 否则元素会停在旧位置，直到它被视口裁掉又重新挂载才「刷新」
   * （用户看到的就是「点了自动排列没反应，滚一下画布才动」）。
   */
  interface MountedEntry { element: any; signature: string; x?: number; y?: number }

  const nodes = new Map<string, MountedEntry>();
  const cards = new Map<string, MountedEntry>();
  const runs = new Map<string, MountedEntry>();
  const edges = new Map<string, { element: any; kind: 'structural' | 'instance'; parentId: string; childId: string }>();
  /** 节点 id → 元素：与 `nodes` 同步维护，拖拽补丁直接读它。 */
  const mounted = options.mountedNodes ?? new Map<string, any>();

  let layer: {
    root: any; wires: any; variableEdges: any; referenceEdges: any;
    cards: any; variableCards: any; previews: any; overlays: any;
  } | null = null;

  let indexDirty = true;
  let nodeSetKey = '';
  let cardSetKey = '';
  let edgeStateKey = '';
  let detailLevel: CanvasDetailLevel | null = null;
  let renderAll = false;
  let graphVersionSeen = -1;

  const stats: CanvasRenderStats = {
    mountedNodes: 0, mountedCards: 0, mountedRuns: 0, patchedNodes: 0, reusedNodes: 0,
    culledNodes: 0, culledEdges: 0,
    fullRebuilds: 0, frames: 0, totalRenderMs: 0, rebuiltEdges: 0, activeNodes: 0, activeEdges: 0,
    detailLevel: null, lastFrameMs: 0, placeholderNodes: 0,
    lastFrameBreakdown: {indexMs: 0, visibleMs: 0, cardsMs: 0, edgesMs: 0, totalMs: 0},
  };
  /** 仍以壳形式挂载、等待补内容的节点。 */
  const placeholders = new Set<string>();
  /** 本帧还剩多少张卡片可以同步建；每次 reconcile 与随后的补内容共用它。 */
  let buildBudget = buildBudgetPerFrame;
  /**
   * 卡片内容签名的帧内缓存。
   *
   * 签名只由「签名前缀」与节点 id 决定：前缀里已经含了修订号、文档版本、内容版本与
   * 校验指纹。因此缓存以 `signaturePrefix` 为唯一失效键——前缀没变就不可能变内容，
   * 平移/缩放/拖拽帧因此完全不必重新序列化任何节点。
   */
  let signatureCacheKey = '';
  const signatureCache = new Map<string, string>();
  /** 本帧签名前缀（修订号 + 校验指纹 + 内容版本），补内容循环也要用。 */
  let signaturePrefix = '';
  /** 上一次真正比对签名时用的前缀：相同表示这一帧不必再算任何内容签名。 */
  let signaturePrefixSeen = '';

  let activeNodeIds = new Set<string>();
  let activeCardIds = new Set<string>();
  let signatureRevision = 0;
  /** 拖拽中「上一次已经补过连线」的节点坐标：位置真变了才重算邻接边。 */
  const dragPatchedAt = new Map<string, { x: number; y: number }>();

  function ensureLayer(): typeof layer {
    if (layer) return layer;
    const svgEl = context.svgEl;
    const root = svgEl('g', { class: 'graph-world' }, host);
    const wires = svgEl('g', { class: 'wires' }, root);
    const variableEdges = svgEl('g', { class: 'variable-edges' }, root);
    const referenceEdges = svgEl('g', { class: 'reference-edges' }, root);
    const cardsLayer = svgEl('g', { class: 'cards' }, root);
    const variableCards = svgEl('g', { class: 'variable-cards' }, root);
    // 临时连线预览：盖在卡片之上，但排在框选矩形之下（框选矩形是最后画的浮层）。
    const previews = svgEl('g', { class: 'previews' }, root);
    // 浮层（框选矩形、交互预览）在最后创建，始终盖在卡片之上。
    const overlays = svgEl('g', { class: 'overlays' }, root);
    layer = { root, wires, variableEdges, referenceEdges, cards: cardsLayer, variableCards, previews, overlays };
    return layer;
  }

  function clearLayerContents(target: any): void {
    if (!target) return;
    if (typeof target.replaceChildren === 'function') target.replaceChildren();
    else if ('innerHTML' in target) target.innerHTML = '';
    else if (Array.isArray(target.children)) target.children.length = 0;
  }

  function removeElement(element: any): void {
    if (element && typeof element.remove === 'function') element.remove();
  }

  /**
   * 把已挂载元素的 transform 对齐到文档坐标。
   *
   * 位置不进内容签名（见 `MountedEntry` 注释），所以位置变了但内容没变的帧必须在这里补一次，
   * 否则「自动排列」这类不走拖拽补丁的移动会一直停留在旧位置，直到元素被裁掉重新挂载。
   * 只有坐标真的变了才写 DOM（拖拽帧由 `applyPatches` 写并同步这里的坐标，因此不会重复写）。
   */
  function syncTransform(entry: MountedEntry | undefined, x: number, y: number): boolean {
    if (!entry || !entry.element) return false;
    if (entry.x === x && entry.y === y) return false;
    entry.x = x;
    entry.y = y;
    if (typeof entry.element.setAttribute === 'function') {
      entry.element.setAttribute('transform', `translate(${x},${y})`);
    }
    return true;
  }

  function dropCache(): void {
    for (const entry of nodes.values()) removeElement(entry.element);
    for (const entry of cards.values()) removeElement(entry.element);
    for (const entry of runs.values()) removeElement(entry.element);
    for (const entry of edges.values()) removeElement(entry.element);
    nodes.clear();
    cards.clear();
    runs.clear();
    edges.clear();
    mounted.clear();
    placeholders.clear();
    activeNodeIds = new Set();
    activeCardIds = new Set();
    nodeSetKey = '';
    cardSetKey = '';
    edgeStateKey = '';
    indexDirty = true;
  }

  function viewportRect(): SpatialRect {
    const { width, height } = context.viewportSize();
    const zoom = state.zoom || 1;
    return {
      x: -state.panX / zoom,
      y: -state.panY / zoom,
      width: Math.max(1, width) / zoom,
      height: Math.max(1, height) / zoom,
    };
  }

  function cullingRect(): SpatialRect {
    if (renderAll) return { x: -1e9, y: -1e9, width: 2e9, height: 2e9 };
    const rect = viewportRect();
    return inflateRect(rect, VIEWPORT_PADDING_CSS / (state.zoom || 1));
  }

  function nodeRect(node: any): SpatialRect {
    const pos = context.position(node);
    return { x: pos.x, y: pos.y, width: context.nodeWidth, height: context.nodeHeight(node) };
  }

  function runKeyOf(card: any): string {
    if (!card) return '';
    return String(card.key !== undefined && card.key !== null ? card.key : `${card.node?.id}:${card.index}`);
  }

  function runCardRect(card: any): SpatialRect {
    return { x: card.x, y: card.y, width: context.runCardWidth, height: card.height || context.runCardBaseHeight };
  }

  /**
   * 重建空间索引。
   *
   * 只索引**节点、变量卡与实例卡**：这些是可见性、框选与命中测试要查的矩形。
   * 连线不进索引——曲线包围盒要逐条算几何，而目前没有任何查询需要它，
   * 索引里放连线只会让每一帧白白多算几百次贝塞尔包围盒（实测占缩放帧时间的一半）。
   */
  function rebuildIndex(runCards: any[]): void {
    const entries: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const node of context.nodes()) entries.push({ id: `node:${node.id}`, ...nodeRect(node) });
    for (const card of context.variableCardList()) entries.push({ id: `card:${card.id}`, ...context.variableCardRect(card) });
    for (const card of runCards) entries.push({ id: `run:${runKeyOf(card)}`, ...runCardRect(card) });
    index.rebuild(entries);
    indexDirty = false;
  }

  /**
   * 挂载一张卡片。
   * - `lazy` 为真且渲染层支持占位、且卡片当前不在视口内时：只建壳，内容稍后补。
   *   视口突然变大（缩小画布）时这是保持单帧工作量有界的关键。
   */
  /**
   * 挂载一张卡片。
   * - `lazy` 为真且卡片不在视口内时：只建壳，内容稍后补（内容签名也延后到补的时候再算）。
   * - 签名**只在需要判断「要不要重建」时才算**：视口裁剪掉 90% 节点时，
   *   如果为每个节点都算一次内容签名，500 节点首帧会多花上百毫秒。
   */
  function mountNode(
    node: any,
    signature: string | null,
    options: { lazy?: boolean; inViewport?: boolean } = {},
  ): void {
    const cached = nodes.get(node.id);
    const isPlaceholder = cached ? placeholders.has(node.id) : false;
    // 复用已有元素前先把位置对齐：位置不进签名，自动排列这类移动只能在这里补。
    if (cached) {
      const pos = context.position(node);
      syncTransform(cached, pos.x, pos.y);
    }
    // 前缀没变（平移/缩放/拖拽这类不改内容的帧）就不必算签名：直接复用现有元素。
    const needsSignature = signaturePrefixSeen !== signaturePrefix;
    const expected = needsSignature
      ? buildSignature(cachedNodeFingerprint(node.id))
      : (signature ?? null);
    if (cached) {
      if (isPlaceholder) return; // 已有壳：等补内容循环处理，不重复挂载。
      if (expected === null) {
        // 这一帧不需要比对内容：元素原样复用（这是平移/缩放/拖拽的常态路径）。
        stats.reusedNodes += 1;
        return;
      }
      // 只比内容指纹：前缀变化本身不代表卡片内容变了。
      if (contentOf(cached.signature) === contentOf(expected)) {
        // 内容没变但前缀变了：顺手把签名更新到当前前缀，下一帧可以继续走复用路径。
        cached.signature = expected;
        stats.patchedNodes += 1;
        return;
      }
    }
    removeElement(cached?.element);
    placeholders.delete(node.id);
    // 视口内的卡片优先补齐，但每帧最多建 `buildBudget` 张；
    // 只因为连线被带进视口的卡片一律先挂壳，等补内容循环处理。
    const allowBuild = !options.lazy || options.inViewport === true;
    if ((!allowBuild || buildBudget <= 0) && mountPlaceholder(node, expected)) return;
    const rendered = context.renderNode(layer!.cards, node);
    const placed = context.position(node);
    nodes.set(node.id, {element: rendered, signature: expected ?? '', x: placed.x, y: placed.y});
    mounted.set(node.id, rendered);
    stats.mountedNodes += 1;
    if (allowBuild) buildBudget -= 1;
  }

  /** 用占位壳顶替真实卡片；渲染层不支持占位时返回 false（调用方会直接建真实卡片）。 */
  function mountPlaceholder(node: any, signature: string | null): boolean {
    if (!context.renderNodePlaceholder) return false;
    const shell = context.renderNodePlaceholder(layer!.cards, node);
    if (!shell) return false;
    const placed = context.position(node);
    nodes.set(node.id, {element: shell, signature: signature ?? '', x: placed.x, y: placed.y});
    mounted.set(node.id, shell);
    placeholders.add(node.id);
    stats.placeholderNodes += 1;
    return true;
  }

  /**
   * 用真实内容补齐一个占位卡片。
   * 分帧补齐由渲染入口驱动：视口突然变大时不会有一帧因为要建几百张卡片而超时。
   */
  function fillPlaceholder(id: string): boolean {
    if (!placeholders.has(id)) return false;
    if (buildBudget <= 0) return false;
    const node = context.nodeById(id);
    const cached = nodes.get(id);
    if (!node || !cached) {
      placeholders.delete(id);
      return false;
    }
    removeElement(cached.element);
    nodes.delete(id);
    mounted.delete(id);
    placeholders.delete(id);
    const element = context.renderNode(layer!.cards, node);
    const placed = context.position(node);
    // 补齐时才真正算内容指纹（占位阶段不算，省掉整份文档的序列化）。
    nodes.set(id, {element, signature: buildSignature(cachedNodeFingerprint(id)), x: placed.x, y: placed.y});
    mounted.set(id, element);
    stats.mountedNodes += 1;
    buildBudget -= 1;
    return true;
  }

  function mountCard(card: any, signature: string): void {
    const cached = cards.get(card.id);
    if (cached) {
      syncTransform(cached, card.x, card.y);
      if (cached.signature === signature) return;
    }
    removeElement(cached?.element);
    const rendered = context.renderVariableCard(layer!.variableCards, card);
    cards.set(card.id, { element: rendered, signature, x: card.x, y: card.y });
    stats.mountedCards += 1;
  }

  function mountRunCard(card: any, signature: string): void {
    const key = runKeyOf(card);
    const cached = runs.get(key);
    if (cached) {
      syncTransform(cached, card.x, card.y);
      if (cached.signature === signature) return;
    }
    removeElement(cached?.element);
    const rendered = context.renderInstanceRunCard(layer!.cards, card);
    runs.set(key, { element: rendered, signature, x: card.x, y: card.y });
    stats.mountedRuns += 1;
  }

  function unmountNode(id: string): void {
    const cached = nodes.get(id);
    if (!cached) return;
    removeElement(cached.element);
    nodes.delete(id);
    mounted.delete(id);
    placeholders.delete(id);
  }

  function unmountCard(id: string): void {
    const cached = cards.get(id);
    if (!cached) return;
    removeElement(cached.element);
    cards.delete(id);
  }

  function unmountRun(key: string): void {
    const cached = runs.get(key);
    if (!cached) return;
    removeElement(cached.element);
    runs.delete(key);
  }

  /**
   * 卡片签名 = 前缀 + 节点内容指纹。
   *
   * 前缀里含文档版本、内容版本与校验指纹，用来回答「这一帧要不要重新比对内容」；
   * 真正决定「这张卡片要不要重建」的只有**节点内容指纹**。
   * 两者必须拆开：如果拿整串签名比较，前缀一变就会把所有卡片都判成「内容变了」，
   * 一次参数修改会重建整张画布——正是要消除的行为。
   */
  const SIGNATURE_SEPARATOR = '␟';

  function buildSignature(contentFingerprint: string): string {
    return `${signaturePrefix}${contentFingerprint}`;
  }

  function contentOf(signature: string | null | undefined): string {
    if (!signature) return '';
    // 前缀自身以分隔符结尾，所以内容部分在**最后一处**分隔符之后。
    const index = signature.lastIndexOf(SIGNATURE_SEPARATOR);
    return index < 0 ? signature : signature.slice(index + 1);
  }

  /**
   * 取节点内容指纹：同一签名前缀内复用。
   * 前缀变化（文档/内容/校验任一变化）时清空缓存；前缀没变的帧一次序列化都不做。
   */
  function cachedNodeFingerprint(id: string): string {
    if (signatureCacheKey !== signaturePrefix) {
      signatureCache.clear();
      signatureCacheKey = signaturePrefix;
    }
    const hit = signatureCache.get(id);
    if (hit !== undefined) return hit;
    const value = context.nodeSignature(id);
    signatureCache.set(id, value);
    return value;
  }

  /** 局部对账：只装卸差集，并按内容签名决定是否重建卡片。 */
  function reconcile(): void {
    const startedAt = now();
    stats.mountedNodes = 0;
    stats.mountedCards = 0;
    stats.mountedRuns = 0;
    stats.patchedNodes = 0;
    stats.reusedNodes = 0;
    stats.culledNodes = 0;
    stats.culledEdges = 0;
    stats.rebuiltEdges = 0;
    stats.frames += 1;

    const detail = detailLevel || 'full';
    const root = layer!.root;
    if (root) {
      const classes = `graph-world zoom-${detail}`;
      if (root.setAttribute) {
        root.setAttribute('class', classes);
        root.setAttribute('transform', `translate(${state.panX},${state.panY}) scale(${state.zoom})`);
      }
      if (root.dataset) root.dataset.zoomLevel = detail;
    }

    const edgeList = context.structuralEdges();
    const runCards = context.instanceRunCards();
    const indexStart = now();
    if (indexDirty) rebuildIndex(runCards);
    const visibleStart = now();

    const viewRect = cullingRect();
    // 卡片用大外扩区预挂载，连线则只需要比真实视口多留一小段抗锏齿/命中宽度。
    // 如果连线也用卡片的 300px 外扩区，长曲线的包围盒会误带入大量画外端点。
    const edgeViewRect = inflateRect(viewportRect(), 24 / (state.zoom || 1));
    const nodeList = context.nodes();
    const cardList = context.variableCardList();
    const runList = runCards;

    const visibleNodes = new Set<string>();
    for (const node of nodeList) {
      if (renderAll || rectsIntersect(nodeRect(node), viewRect)) visibleNodes.add(node.id);
    }
    const visibleCards = new Set<string>();
    for (const card of cardList) {
      if (renderAll || rectsIntersect(context.variableCardRect(card), viewRect)) visibleCards.add(card.id);
    }
    const visibleRuns = new Set<string>();
    for (const card of runList) {
      if (renderAll || rectsIntersect(runCardRect(card), viewRect)) visibleRuns.add(runKeyOf(card));
    }
    const visibleEnd = now();

    const byId = new Map(nodeList.map((node) => [node.id, node]));
    // 裁剪后的挂载集合就是「视口可见节点」；连线两端都必须在这个集合里，
    // 于是不可能出现悬空连线。这里不再沿拓扑扩张，否则大图等于全量挂载。
    // 必须拷贝：后续因连线带入的画外端点只挂载轻量占位壳，
    // 不能被误当成「视口内卡片」去构建完整内容。
    const keepNodes = new Set(visibleNodes);

    // 结构线独立按自己的曲线包围盒裁剪。以前依赖「两端卡片都在视口」，
    // 放大时只要一端越过裁剪线，明明还在画面内的整条线也会被卸载。
    const visibleStructuralEdges = new Set<string>();
    for (const edge of edgeList) {
      const geometry = context.edgeGeometry('structural', edge.parentId, edge.childId);
      if (renderAll || (geometry && rectsIntersect(edgeGeometryRect(geometry), edgeViewRect))) {
        visibleStructuralEdges.add(edge.id);
        // 连线元素仍然保持「两端都已挂载」的交互契约；画外端点会走占位壳。
        if (byId.has(edge.parentId)) keepNodes.add(edge.parentId);
        if (byId.has(edge.childId)) keepNodes.add(edge.childId);
      }
    }

    // 选中的连线：只要有一端还在视口里，就把两端都留下，便于用户看清当前编辑对象。
    if (state.selectedEdge) {
      const { parent, child } = state.selectedEdge;
      if (byId.has(parent) && byId.has(child) && (visibleNodes.has(parent) || visibleNodes.has(child))) {
        keepNodes.add(parent);
        keepNodes.add(child);
      }
    }

    // 引用边的源节点：目标行可见时把源节点一并留下（跨视口引用不会断线）。
    if (context.referenceSourceIds) {
      for (const nodeId of [...visibleNodes]) {
        const node = byId.get(nodeId);
        if (!node) continue;
        for (const sourceId of context.referenceSourceIds(node)) {
          if (byId.has(sourceId)) keepNodes.add(sourceId);
        }
      }
    }

    // 变量卡片的挂载集合 = 视口内的卡片 ∪ 被可见节点引脚引用的卡片。
    // 两条来源缺一不可：
    // - 只按「被引脚引用」判定，会让刚从变量面板拖进画布、还没接上端点的卡片整张消失
    //   （拖进来没反应，缩到概览档才又出现——概览档走的就是可见集合）。
    // - 只按视口判定，被引用的画外卡片会被卸载，连线就会悬空。
    const dataEdgesVisible = renderAll || showsDataEdges(detail);
    const cardById = new Map(cardList.map((card) => [card.id, card]));
    const cardByName = new Map<string, any>();
    for (const card of cardList) {
      const key = `${card.scope}.${card.name}`;
      if (!cardByName.has(key)) cardByName.set(key, card);
    }
    const keepCardIds = new Set<string>(visibleCards);
    /**
     * 「决定数据边内容」的卡片集合：只有被引脚引用的卡片才画得出变量连线，
     * 所以它**不含视口因素**——平移缩放不该因此反复重建连线图层。
     */
    const edgeCardIds = new Set<string>();
    const keepCardRef = (reference: any): void => {
      const text = String(reference || '');
      if (!text) return;
      const byId = cardById.get(text);
      if (byId) { keepCardIds.add(byId.id); edgeCardIds.add(byId.id); return; }
      const byName = cardByName.get(text);
      if (byName) { keepCardIds.add(byName.id); edgeCardIds.add(byName.id); }
    };
    if (dataEdgesVisible) {
      const links = state.raw && state.raw._variableLinks && typeof state.raw._variableLinks === 'object'
        ? state.raw._variableLinks as Record<string, string>
        : {};
      for (const node of nodeList) {
        if (!keepNodes.has(node.id)) continue;
        context.nodeVariablePins(node).forEach((pin) => {
          if (!pin.variable) return;
          // 卡片优先按显式链接解析，退化到「作用域.变量名」的唯一卡片。
          keepCardRef(links[`${pin.targetNodeId || node.id}:${pin.targetParam || pin.param}`]);
          keepCardRef(`${pin.scope}.${pin.variable}`);
        });
      }
      for (const card of runList) {
        if (!keepNodes.has(card.node.id)) continue;
        for (const variable of card.variables || []) {
          const value = card.run?.inputs?.[variable.name];
          const ref = value && typeof value === 'object' && typeof value.ref === 'string' ? value.ref : '';
          const match = /^(inputs|variables)\.([^\.]+)/.exec(ref);
          if (match) keepCardRef(`${match[1]}.${match[2]}`);
        }
      }
    }

    // 卡片装卸。
    // 签名里**不放文档版本**：每次改动都重建全部卡片正是要消除的开销。
    // 内容签名本身由渲染层给出（节点 JSON + 校验错误），整份文档替换会走 `full` 丢弃全部缓存。
    const signatureToken = String(signatureRevision);
    const mountStart = now();
    /**
     * 内容版本：只有「卡片内容会变」的改动才 +1。
     * 平移、缩放、拖拽不改内容，因此这些帧的签名前缀完全不变，
     * 卡片元素可以直接复用，连内容签名都不必重新计算。
     */
    const contentToken = context.contentVersion ? context.contentVersion() : context.docVersion();
    // 校验错误的指纹是**整份文档**级别的：它只依赖文档版本，与具体节点无关。
    // 放在这里算一次，避免每张卡片各触发一次按节点查询（实测这是首帧的主要开销）。
    const issueToken = context.issueFingerprint ? context.issueFingerprint() : '';
    // 前缀包含文档版本 + 内容版本 + 校验指纹：
    // 三者任一变化都意味着「卡片内容可能变了」，这一帧才需要重新比对内容签名。
    const docToken = context.docVersion();
    signaturePrefix = `${signatureToken}${SIGNATURE_SEPARATOR}${docToken}${SIGNATURE_SEPARATOR}${contentToken}${SIGNATURE_SEPARATOR}${issueToken}${SIGNATURE_SEPARATOR}`;
    const mountedIds = new Set<string>();
    for (const node of nodeList) {
      if (!keepNodes.has(node.id)) {
        if (nodes.has(node.id)) unmountNode(node.id);
        stats.culledNodes += 1;
        continue;
      }
      // 视口内的卡片立即补齐；只因为连线被带进来的卡片先挂壳，稍后分帧补内容。
      // 签名延后到「真的需要判断内容变化」时才算（见 mountNode 的注释）。
      mountNode(node, null, {
        lazy: true,
        inViewport: visibleNodes.has(node.id),
      });
      mountedIds.add(node.id);
    }
    for (const id of [...nodes.keys()]) if (!keepNodes.has(id)) unmountNode(id);

    for (const card of cardList) {
      if (!keepCardIds.has(card.id)) {
        if (cards.has(card.id)) unmountCard(card.id);
        continue;
      }
      mountCard(card, `${signatureToken}|${context.cardSignature(card)}`);
    }
    for (const id of [...cards.keys()]) if (!keepCardIds.has(id)) unmountCard(id);

    for (const card of runList) {
      const key = runKeyOf(card);
      if (!keepNodes.has(card.node.id)) {
        if (runs.has(key)) unmountRun(key);
        continue;
      }
      mountRunCard(card, `${signatureToken}|${context.runCardSignature(card)}`);
    }
    const liveRunKeys = new Set(runList.map(runKeyOf));
    for (const key of [...runs.keys()]) if (!liveRunKeys.has(key)) unmountRun(key);
    const edgesStart = now();

    // 连线：整体重建，但只在**端点集合**变化时发生。
    // 只按已挂载集合判断会让「卡片装卸但端点不变」的帧也重建几百条线；
    // 端点集合与选中项/文档版本都没变时，连线元素原样复用。
    // 卡片一侧只看 `edgeCardIds`（被引脚引用的卡片）：视口里多挂一张未绑定卡片
    // 不会改变任何连线，不该因此重建图层。
    stats.culledEdges += edgeList.length - visibleStructuralEdges.size;
    let edgePairs = '';
    for (const edge of edgeList) {
      if (!visibleStructuralEdges.has(edge.id)) continue;
      edgePairs += `${edge.parentId}>${edge.childId},`;
    }
    const nextNodeKey = edgePairs;
    const nextCardKey = [...edgeCardIds].join(',');
    // 数据边档位也要进 key：概览档不画变量/引用线，跨档时必须重画一次。
    const nextEdgeStateKey = `${state.selectedEdge ? `${state.selectedEdge.parent}>${state.selectedEdge.child}` : ''}|${signatureToken}|${renderAll ? 'all' : 'cull'}|${dataEdgesVisible ? 'data' : 'plain'}`;
    if (nextNodeKey !== nodeSetKey || nextCardKey !== cardSetKey || nextEdgeStateKey !== edgeStateKey) {
      nodeSetKey = nextNodeKey;
      cardSetKey = nextCardKey;
      edgeStateKey = nextEdgeStateKey;
      rebuildEdges(edgeList, runList, mountedIds, visibleStructuralEdges);
    }

    activeNodeIds = mountedIds;
    activeCardIds = keepCardIds;
    stats.activeNodes = activeNodeIds.size;
    stats.activeEdges = edges.size;
    stats.detailLevel = detail;
    stats.placeholderNodes = placeholders.size;
    const finishedAt = now();
    // 这一帧比对过签名了，下一帧只要前缀不变就不必再算。
    signaturePrefixSeen = signaturePrefix;
    stats.lastFrameMs = finishedAt - startedAt;
    stats.totalRenderMs += stats.lastFrameMs;
    stats.lastFrameBreakdown = {
      indexMs: visibleStart - indexStart,
      cardsMs: edgesStart - visibleStart,
      edgesMs: finishedAt - edgesStart,
      totalMs: stats.lastFrameMs,
      visibleMs: visibleEnd - visibleStart,
    };
  }
  function rebuildEdges(
    edgeList: GraphEdgeGeometry[],
    runCards: any[],
    keepNodes: Set<string>,
    visibleStructuralEdges: Set<string>,
  ): void {
    const wires = layer!.wires;
    clearLayerContents(wires);
    clearLayerContents(layer!.variableEdges);
    clearLayerContents(layer!.referenceEdges);
    options.beforeEdgeRebuild?.();
    edges.clear();

    let rebuilt = 0;
    for (const edge of edgeList) {
      if (!visibleStructuralEdges.has(edge.id)) continue;
      const parent = context.nodeById(edge.parentId);
      if (!parent) continue;
      const order = Array.isArray(parent.children) ? parent.children.indexOf(edge.childId) : 0;
      const rendered = context.renderEdge(wires, parent, edge.childId, Math.max(0, order));
      edges.set(`edge:${edge.parentId}:${edge.childId}`, {
        element: rendered, kind: 'structural', parentId: edge.parentId, childId: edge.childId,
      });
      rebuilt += 1;
    }
    for (const card of runCards) {
      if (!keepNodes.has(card.node.id)) continue;
      const rendered = context.renderInstanceRunEdge(wires, card);
      edges.set(`run:${card.node.id}:${runKeyOf(card)}`, {
        element: rendered, kind: 'instance', parentId: card.node.id, childId: runKeyOf(card),
      });
      rebuilt += 1;
    }
    // 概览模式隐藏数据边；选中节点相关的关系仍保留，便于大图里定位当前对象。
    const showData = renderAll || showsDataEdges(detailLevel || 'full') || Boolean(state.selectedEdge);
    if (showData) {
      context.renderVariableEdges(layer!.variableEdges);
      context.renderReferenceEdges(layer!.referenceEdges);
    }
    stats.rebuiltEdges = rebuilt;
  }

  function applyPatches(scope: RenderFlags): void {
    if (scope.graph || scope.full) return; // 结构重绘已经重建过元素。
    if (state.drag && state.drag.kind === 'nodes') {
      for (const id of Object.keys(state.drag.origins || {})) {
        const node = context.nodeById(id);
        if (!node) continue;
        const pos = context.position(node);
        patchers.nodeTransform(id, pos.x, pos.y);
        // 补丁已经把新坐标写进 DOM：同步挂载表，下一帧的位置比对才不会重复写。
        const cached = nodes.get(id);
        if (cached) { cached.x = pos.x; cached.y = pos.y; }
        // 「有没有移动」必须按**上一次补过的坐标**判断，绝不能拿 nodeTransform 的返回值：
        // reconcile 里的位置同步（syncTransform）会先把 transform 写成最新值，
        // 补丁于是恒返回 false，相邻连线就永远补不上——卡片动了、线留在原地，
        // 正是「拖卡片时线不跟着走」。
        const last = dragPatchedAt.get(id);
        dragPatchedAt.set(id, { x: pos.x, y: pos.y });
        if (!last || last.x !== pos.x || last.y !== pos.y) patchers.nodeEdges(id);
      }
      return;
    }
    if (state.drag && state.drag.kind === 'variable-card') {
      // 整组选中一起拖：每张被拖的卡片只改自己的 transform。
      const cardList = context.variableCardList();
      for (const id of Object.keys(state.drag.origins || {})) {
        const card = cardList.find((item) => item.id === id);
        const cached = card ? cards.get(card.id) : null;
        if (card && cached?.element?.setAttribute) {
          cached.element.setAttribute('transform', `translate(${card.x},${card.y})`);
          cached.x = card.x;
          cached.y = card.y;
        }
      }
      // 变量卡片没有单条连线的补丁（变量边按层整体重画）：卡片动了，挂在它上面的边也要跟着走。
      refreshVariableEdges();
      return;
    }
  }

  /** 只重画数据边图层里的变量连线；概览档与「不画数据边」的档位保持为空。 */
  function refreshVariableEdges(): void {
    if (!layer) return;
    clearLayerContents(layer.variableEdges);
    const showData = renderAll || showsDataEdges(detailLevel || 'full') || Boolean(state.selectedEdge);
    if (showData) context.renderVariableEdges(layer.variableEdges);
  }

  /**
   * 临时连线预览：拖动中每帧重建那一条线（位置跟着指针与吸附目标走）。
   *
   * 预览不参与连线层的对账（那条线还不属于文档），所以放在独立图层里整层清空重画：
   * 层里只有这一条，清空的代价就是一次 replaceChildren。松手后状态清空，这里只剩清空，
   * 预览因此不会残留、也不会逐帧累积。
   */
  function refreshConnectionPreviews(): void {
    if (!context.renderConnectionPreviews || !layer) return;
    const target = layer.previews;
    if (!target) return;
    const active = Boolean(state.connect || state.variableConnect || state.referenceConnect);
    const hasChildren = Array.isArray(target.children) ? target.children.length > 0 : true;
    if (!active && !hasChildren) return;
    clearLayerContents(target);
    if (active) context.renderConnectionPreviews(target);
  }

  function renderFrame(scope: RenderFlags): void {
    const fresh = !layer;
    ensureLayer();
    // 建卡预算按帧重置：一次 renderFrame 是一次「帧」，同帧内的补内容循环共享剩余额度。
    buildBudget = buildBudgetPerFrame;
    if (scope.full) {
      signatureRevision += 1;
      dropCache();
      stats.fullRebuilds += 1;
    } else if (fresh) {
      signatureRevision += 1;
      dropCache();
    }
    // 分级由渲染入口判定（它掌握缩放与迟滞），控制器只按它决定挂载集合。
    if (options.detailLevel !== undefined) detailLevel = options.detailLevel ?? null;
    const version = context.docVersion();
    if (version !== graphVersionSeen) {
      graphVersionSeen = version;
      indexDirty = true;
    }
    if (scope.graph || scope.minimap) indexDirty = true;
    reconcile();
    applyPatches(scope);
    refreshConnectionPreviews();
  }

  const scheduler = createRenderScheduler({
    run: (flags) => {
      const scope = resolveScope(flags);
      renderFrame(scope);
      if (scope.panels) options.onFrame?.({ scope: flags, stats });
    },
  });

  /** full 吞掉一切；graph 至少要做卡片对账与连线重建。 */
  function resolveScope(flags: RenderFlags): RenderFlags {
    if (flags.full) {
      return { full: true, graph: true, minimap: true, viewport: true, interaction: true, selection: true, panels: true };
    }
    const scope: RenderFlags = { ...flags };
    if (scope.graph) scope.viewport = true;
    return scope;
  }

  function request(flags: RenderFlags = {}): void {
    scheduler.request(flags);
  }

  function coalesce(flags: RenderFlags = {}): void {
    scheduler.coalesce(flags);
  }

  function rebuildAll(): void {
    request({ full: true });
  }

  function setRenderAll(value: boolean): void {
    if (renderAll === value) return;
    renderAll = value;
    // 开关本身不能整层重建：关掉后下一帧按正常规则把视口外的元素裁掉。
    nodeSetKey = '';
    cardSetKey = '';
    edgeStateKey = '';
    request({ viewport: true });
  }

  return {
    scheduler,
    request,
    coalesce,
    rebuildAll,
    setRenderAll,
    isRenderAll: () => renderAll,
    dropCache: () => {
      dropCache();
      layer = null;
    },
    resetBuildBudget: () => {
      buildBudget = buildBudgetPerFrame;
    },
    stats: () => stats,
    activeNodeIds: () => [...activeNodeIds],
    activeCardIds: () => [...activeCardIds],
    pendingPlaceholders: () => [...placeholders],
    fillPlaceholder,
    mountedNodes: () => mounted,
    mounted,
    getLayer: () => ensureLayer()!,
    viewportRect,
    index,
  };
}
