/**
 * 画布渲染入口：持久图层 + 按帧局部更新 + 视口裁剪 + 缩放分级。
 *
 * 与改造前的区别：
 * - 图层（`.graph-world` / `.wires` / `.cards` / `.variable-cards` …）只创建一次；
 *   平移、缩放、拖拽不再 `innerHTML = ''` 重建整张画布。
 * - `render()` 仍然同步（选中、就地编辑器贴合、撤销恢复都依赖它立刻看到新画面）；
 *   高频路径改用 `coalesce()`，同一帧内多次请求只执行一次。
 * - 视口外的节点/卡片不挂载；超出 300 CSS 像素外扩区的连线不挂载；结构边始终可见。
 * - 详情栏、侧栏、校验徽标、小地图只在需要时刷新。
 *
 * 各渲染片段的签名与实现不变，本文件只负责调度与对账。
 */
import type { CanvasState } from '../state/canvas-state';
import type { CanvasDetailLevel } from './zoom-level';
import { FOCUS_ZOOM, resolveDetailLevel } from './zoom-level';
import {
  createCanvasRenderController,
  type CanvasRenderController,
  type CanvasRenderStats,
  type EdgeGeometry,
  type GraphLayerPatchers,
  type GraphLayerContext,
} from './render-controller';
import type { RenderFlags } from './render-scheduler';
import { createWrapMeasurement } from '../canvas/wrap-measurement';

export interface RenderEntryDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  $(id: string): HTMLElement;
  graph: Element;
  wrap: HTMLElement;
  /** 视口尺寸测量（缓存读）；缺省按 `wrap` 自行创建。 */
  measurement?: { read(): { width: number; height: number; left: number; top: number } };
  svgEl(...args: any[]): any;
  UI: any;
  nodes(): any[];
  nodeById(id: string): any;
  position(node: any): { x: number; y: number };
  nodeHeight(node: any): number;
  nodeRowHeight?(node: any): number;
  instanceRunCards(): any[];
  variableCardList(): any[];
  nodeVariablePins(node: any): any[];
  renderNode(...args: any[]): any;
  renderInstanceRunCard(...args: any[]): any;
  renderVariableCard(...args: any[]): any;
  renderEdge(...args: any[]): any;
  renderInstanceRunEdge(...args: any[]): any;
  renderConnection(...args: any[]): any;
  renderVariableConnection(...args: any[]): any;
  renderReferenceConnection(...args: any[]): any;
  renderReferenceEdges(...args: any[]): any;
  renderVariableEdges(...args: any[]): any;
  renderMinimap(...args: any[]): any;
  renderInspector(): void;
  postSidebarState(): void;
  updateIssueBadge(): void;
  ensureLayout(): void;
  syncLegacyInputParameters(): boolean;
  syncLegacyVariableCards(): boolean;
  setDirty(value?: boolean): void;
  /** 重绘收尾：让贴在卡片行上的浮层（行内参数编辑器）跟随 pan/zoom 重新贴合。 */
  afterRender?(): void;
  /** 该节点引用了哪些节点输出。 */
  referenceSourceIds?(node: any): string[];
  /** 视口变化后延迟记录一次画布位置历史（前进/后退用）。 */
  recordViewportSoon?(): void;
  /** 该节点是否被「按状态/类型临时隐藏」筛掉。 */
  isNodeFiltered?(node: any): boolean;
  /** 节点内容签名（缺省用节点 JSON + 交互状态）。 */
  nodeSignature?(id: string): string;
  /** 该节点的校验错误（错误标记变化也要重建卡片）。 */
  nodeIssueInfo?(node: any): { node: any[]; params: Map<string, any[]> } | null;
  /** 合成组卡需要从真实成员节点推导运行状态。 */
  nodeRunStatus?(node: any): string;
  /** 卡片内部运行态文字的轻量补丁。 */
  patchNodeRuntime?(element: any, node: any): boolean;
  /** 整份文档的校验错误指纹（由渲染入口折叠成一个字符串，避免按节点重复查询）。 */
  issueFingerprint?(): string;
  /** 变量卡内容签名（缺省用卡片 JSON + 定义 + 实时值 + 选中态）。 */
  cardSignature?(card: any): string;
  /** 实例运行卡内容签名。 */
  runCardSignature?(card: any): string;
  /** 图形片段自带的局部补丁（连线 path 更新等）。 */
  patchers?: Partial<GraphLayerPatchers>;
  /** 连线整体重建前清理片段内部索引。 */
  beforeEdgeRebuild?(): void;
  nodeWidth: number;
  variableCardWidth?: number;
  variableCardHeight?: number;
  runCardWidth?: number;
  runCardBaseHeight?: number;
  /** 视口裁剪外扩（世界坐标，已按 zoom 折算）；默认走模块常量。 */
}

export interface CanvasRenderEntry {
  render(flags?: RenderFlags): void;
  /** 合并到本帧的重绘：高频路径用。 */
  coalesce(flags?: RenderFlags): void;
  focusNode(id: string, param?: string): void;
  focusNodeDetail(id: string): void;
  /** 导出前后切换：导出期间挂载全部节点。 */
  setRenderAll(value: boolean): void;
  rebuildAll(): void;
  stats(): CanvasRenderStats;
  detailLevel(): CanvasDetailLevel | null;
  controller: CanvasRenderController;
}

export function createRenderEntry(deps: RenderEntryDeps) {
  const {
    state, $, graph, wrap, svgEl, UI, nodes, nodeById, position, nodeHeight, nodeVariablePins,
    instanceRunCards, variableCardList,
    renderNode, renderInstanceRunCard, renderVariableCard, renderEdge, renderInstanceRunEdge,
    renderConnection, renderVariableConnection, renderReferenceConnection, renderReferenceEdges, renderVariableEdges,
    renderMinimap, renderInspector, postSidebarState, updateIssueBadge,
    ensureLayout, syncLegacyInputParameters, syncLegacyVariableCards, setDirty, nodeWidth: NODE_W,
  } = deps;
  const afterRender = deps.afterRender;
  const RUN_CARD_W = deps.runCardWidth ?? 250;
  const RUN_CARD_BASE_H = deps.runCardBaseHeight ?? 78;
  const VARIABLE_CARD_W = deps.variableCardWidth ?? 168;
  const VARIABLE_CARD_H = deps.variableCardHeight ?? 58;

  let detailLevel: CanvasDetailLevel | null = null;
  let panelsSeen = false;
  let marquee: any = null;
  /** 视口尺寸缓存：画布每帧写 DOM，读 rect 会强制同步布局。 */
  const measurement = deps.measurement ?? createWrapMeasurement(wrap as any);
  /** 控制器维护的「节点 id → 元素」索引：拖拽补丁构造期就要能引用。 */
  const nodeElements = new Map<string, any>();

  function structuralEdges(): Array<{ id: string; kind: 'structural'; parentId: string; childId: string }> {
    const list: Array<{ id: string; kind: 'structural'; parentId: string; childId: string }> = [];
    for (const parent of nodes()) {
      const children = Array.isArray(parent.children) ? parent.children : [];
      for (const childId of children) {
        list.push({ id: `${parent.id}->${childId}`, kind: 'structural', parentId: parent.id, childId: String(childId) });
      }
    }
    return list;
  }

  // 连线几何：与 edges.renderEdge / renderInstanceRunEdge 的公式一致。
  function structuralGeometry(parentId: string, childId: string): EdgeGeometry | null {
    const parent = nodeById(parentId);
    const child = nodeById(childId);
    if (!parent || !child) return null;
    const from = position(parent);
    const to = position(child);
    return {
      from: { x: from.x + NODE_W / 2, y: from.y + nodeHeight(parent) },
      to: { x: to.x + NODE_W / 2, y: to.y },
    };
  }

  function instanceGeometry(parentId: string, childId: string): EdgeGeometry | null {
    const card = instanceRunCards().find((item) => String(item.key) === childId || `${item.node?.id}:${item.index}` === childId);
    if (!card) return null;
    const from = position(card.node);
    return {
      from: { x: from.x + NODE_W / 2, y: from.y + nodeHeight(card.node) },
      to: { x: card.x + RUN_CARD_W / 2, y: card.y },
    };
  }

  /**
   * 卡片上「随交互变化」的 class 集合。
   *
   * 这些 class 变化**绝不能**进内容签名：选中、连线悬停、运行状态每帧都可能变，
   * 一旦进签名就会把整卡重建变成常态。它们由 `patchNodeState` 就地增删。
   */
  const DYNAMIC_NODE_CLASSES = ['selected', 'connect-hover', 'node-invalid'];
  const DYNAMIC_CLASS_PREFIXES = ['run-'];

  function dynamicNodeClasses(node: any): string[] {
    const classes: string[] = [];
    if (state.selected && state.selected.has(node.id)) classes.push('selected');
    const status = deps.nodeRunStatus ? deps.nodeRunStatus(node) : (state.run?.get ? state.run.get(node.id)?.status : '');
    if (status) classes.push(`run-${status}`);
    if (state.connect && state.connect.hover === node.id) classes.push('connect-hover');
    if (state.variableConnect && state.variableConnect.hover && state.variableConnect.hover.nodeId === node.id) classes.push('connect-hover');
    if (state.referenceConnect && state.referenceConnect.hover && state.referenceConnect.hover.nodeId === node.id) classes.push('connect-hover');
    const issueInfo = deps.nodeIssueInfo?.(node);
    if (issueInfo && Array.isArray(issueInfo.node) && issueInfo.node.length > 0) classes.push('node-invalid');
    return classes;
  }

  /** 就地改写卡片的交互 class，不重建子元素。返回是否真的变了。 */
  function patchNodeState(id: string): boolean {
    const element = nodeElements.get(id);
    const node = nodeById(id);
    if (!element || !node || typeof element.getAttribute !== 'function' || typeof element.setAttribute !== 'function') return false;
    const current = String(element.getAttribute('class') || '');
    const kept = current.split(/\s+/).filter((name) => name
      && !DYNAMIC_NODE_CLASSES.includes(name)
      && !DYNAMIC_CLASS_PREFIXES.some((prefix) => name.startsWith(prefix)));
    const next = [...kept, ...dynamicNodeClasses(node)].join(' ');
    let changed = false;
    if (next !== current) {
      element.setAttribute('class', next);
      changed = true;
    }
    // 即使组的主状态没变（例如连续完成第 2、3 个节点），进度文字仍须逐事件更新。
    return Boolean(deps.patchNodeRuntime?.(element, node)) || changed;
  }

  function nodeContentSignature(id: string): string {
    const node = nodeById(id);
    if (!node) return '';
    // 校验错误是文档级信息，由 `issueFingerprint` 统一进签名，这里不按节点查询。
    if (deps.nodeSignature) return deps.nodeSignature(id);
    try {
      return JSON.stringify(node);
    } catch {
      return String(node);
    }
  }

  /** 整份文档的校验错误指纹：只在文档版本变化时重算。 */
  let issueFingerprintVersion = -1;
  let issueFingerprintValue = '';
  function issueFingerprint(): string {
    if (!deps.issueFingerprint) return '';
    const version = Number(state.docVersion || 0);
    if (version === issueFingerprintVersion) return issueFingerprintValue;
    issueFingerprintVersion = version;
    // 校验是渲染路径上的附加信息：先出画面，错误标记下一帧再补，
    // 避免「打开 500 节点工作流」被一次全量校验拖慢。
    if (!panelsSeen) {
      deferIssueRecompute();
      return issueFingerprintValue;
    }
    issueFingerprintValue = deps.issueFingerprint();
    return issueFingerprintValue;
  }

  /** 首帧之后补算一次校验指纹：错误标记会在下一帧落到卡片上。 */
  let issueRecomputePending = false;
  function deferIssueRecompute(): void {
    if (issueRecomputePending) return;
    issueRecomputePending = true;
    const run = (): void => {
      issueRecomputePending = false;
      if (!deps.issueFingerprint) return;
      issueFingerprintVersion = Number(state.docVersion || 0);
      issueFingerprintValue = deps.issueFingerprint();
      render({ panels: true });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else if (typeof setTimeout === 'function') setTimeout(run, 0);
    else run();
  }

  /**
   * 变量卡片的裁剪矩形 = 文档里的绝对坐标。
   *
   * 这里**只**认 `card.x` / `card.y`：卡片就是这么画出来的（`cards.ts` 用同一个 transform），
   * 连线（`edges.ts`）、命中测试（`hit-test.ts`）、小地图（`minimap.ts`）也都读这两个值。
   * 曾经这里改用一个可注入的 `variableCardPosition`，而画布入口注入的是**节点侧**的同名
   * 算法（「把卡片放到某个节点某一行旁边」，对卡片而言 `position(card)` 恒为 `(0,0)`）——
   * 于是所有卡片的裁剪矩形都落在同一个固定点上：拖进画布的卡片要等视口滚到那个点才挂载，
   * 表现就是「拖进来没反应，滚一下才出现」。卡片位置只有这一个真值来源，不再开注入点。
   */
  function variableCardRect(card: any): { x: number; y: number; width: number; height: number } {
    return { x: card.x, y: card.y, width: VARIABLE_CARD_W, height: VARIABLE_CARD_H };
  }

  /** 生成一张只有外框与位置的卡片壳，供分帧补内容使用。 */
  function renderNodePlaceholder(parent: any, node: any): any {
    const pos = position(node);
    const group = svgEl('g', {
      class: `node studio-card node-placeholder type-${node.type}`,
      transform: `translate(${pos.x},${pos.y})`,
      'data-id': node.id,
    }, parent);
    if (group && group.dataset) group.dataset.id = node.id;
    svgEl('rect', { class: 'node-box card-body', width: NODE_W, height: nodeHeight(node), rx: 5 }, group);
    return group;
  }

  const context: GraphLayerContext = {
    state: state as CanvasState,
    graph,
    svgEl,
    nodes,
    nodeById,
    position,
    nodeHeight,
    structuralEdges,
    instanceRunCards,
    variableCardList,
    variableCardRect,
    nodeVariablePins,
    referenceSourceIds: deps.referenceSourceIds,
    docVersion: () => Number(state.docVersion || 0),
    issueFingerprint: () => issueFingerprint(),
    viewportSize: () => {
      const size = measurement.read();
      return { width: size.width, height: size.height };
    },
    renderNode: (target, node) => renderNode(target, node),
    renderNodePlaceholder: (target, node) => renderNodePlaceholder(target, node),
    renderVariableCard: (target, card) => renderVariableCard(target, card),
    renderInstanceRunCard: (target, card) => renderInstanceRunCard(target, card),
    renderEdge: (target, parent, childId, order) => renderEdge(target, parent, childId, order),
    renderInstanceRunEdge: (target, card) => renderInstanceRunEdge(target, card),
    renderVariableEdges: (target) => renderVariableEdges(target),
    renderReferenceEdges: (target) => renderReferenceEdges(target),
    // 临时连线预览：控制器每帧给一个清空的层，这里只画当前那一条（控制器不管这三种线）。
    renderConnectionPreviews: (target) => {
      if (state.connect) renderConnection(target);
      if (state.variableConnect) renderVariableConnection(target);
      if (state.referenceConnect) renderReferenceConnection(target);
    },
    nodeSignature: (id) => nodeContentSignature(id),
    cardSignature: (card) => {
      if (deps.cardSignature) return deps.cardSignature(card);
      let payload: string;
      try {
        // 位置不进签名：拖动变量卡片时只改 transform，不重建卡片（与节点一致）。
        const { x: _x, y: _y, ...rest } = card;
        payload = JSON.stringify(rest);
      } catch {
        payload = String(card);
      }
      const scope = card.scope;
      const definition = (state.raw && state.raw[scope] && state.raw[scope][card.name]) || {};
      const live = scope === 'variables' && state.variableValues
        && Object.prototype.hasOwnProperty.call(state.variableValues, card.name)
        ? state.variableValues[card.name]
        : undefined;
      const selected = state.inspector === 'variables'
        && (state.selectedVariableCardIds?.has(card.id) || state.selectedVariableCardId === card.id);
      return `${payload}|${JSON.stringify(definition)}|${JSON.stringify(live)}|${selected ? 'sel' : ''}|${state.variableConnect ? 'vc' : ''}`;
    },
    runCardSignature: (card) => {
      if (deps.runCardSignature) return deps.runCardSignature(card);
      const selected = state.selectedRun && state.selectedRun.nodeId === card.node.id && state.selectedRun.index === card.index;
      return `${card.key}|${JSON.stringify(card.run)}|${card.height}|${selected ? 'sel' : ''}`;
    },
    edgeGeometry: (kind, parentId, childId) => (kind === 'instance' ? instanceGeometry(parentId, childId) : structuralGeometry(parentId, childId)),
    nodeWidth: NODE_W,
    runCardWidth: RUN_CARD_W,
    runCardBaseHeight: RUN_CARD_BASE_H,
  };

  /** 通用局部补丁：拖拽时只改 transform / 相邻连线 path。 */
  const basePatchers: GraphLayerPatchers = {
    nodeTransform: (id, x, y) => {
      const element = nodeElements.get(id);
      if (!element || typeof element.setAttribute !== 'function') return false;
      const next = `translate(${x},${y})`;
      // 位置没变就不动 DOM，也不触发邻接连线重算。
      if (typeof element.getAttribute === 'function' && element.getAttribute('transform') === next) return false;
      element.setAttribute('transform', next);
      return true;
    },
    nodeEdges: (id) => deps.patchers?.nodeEdges?.(id),
  };

  const patchers: GraphLayerPatchers = { ...basePatchers, ...(deps.patchers || {}) };

  const controller = createCanvasRenderController({
    state: state as CanvasState,
    host: graph,
    context,
    patchers,
    // 索引由控制器在装卸时维护，拖拽补丁读到的永远是最新值。
    mountedNodes: nodeElements,
    beforeEdgeRebuild: () => deps.beforeEdgeRebuild?.(),
    // 分级由渲染入口判定（它掌握缩放与迟滞），控制器只按它决定挂载集合。
    get detailLevel() { return detailLevel; },
  });

  /**
   * 分帧补齐占位卡片。
   *
   * 视口突然变大（缩小画布）时一帧内要挂载几百张卡片；这里先把它们以「壳」的形式挂上，
   * 再用空闲帧分批补真实内容，于是单帧工作量有上界，输入不会因为一次挂载而卡住。
   * 视口内（外扩区以内）的卡片永远同步补齐，用户看到的位置不会出现空框。
   */
  const FILL_BUDGET_PER_FRAME = 24;
  let fillScheduled = false;
  function schedulePlaceholderFills(): void {
    if (fillScheduled || !controller.pendingPlaceholders().length) return;
    fillScheduled = true;
    const pump = (): void => {
      fillScheduled = false;
      // 补齐过程会触发新的 renderFrame，于是预算被重置；
      // 这里用「本批是否真的补上了」作为终止条件，而不是「还有没有壳」，
      // 否则预算被重置后补不上内容、壳又一直在，就会变成死循环。
      let filled = 0;
      for (const id of controller.pendingPlaceholders()) {
        if (filled >= FILL_BUDGET_PER_FRAME) break;
        if (controller.fillPlaceholder(id)) filled += 1;
      }
      if (filled) {
        render({ viewport: true });
        // 补齐帧也要留出输入响应：每帧最多补 FILL_BUDGET_PER_FRAME 张，
        // 用 rAF 续跑；无 rAF 时用宏任务，绝不同步递归。
        if (controller.pendingPlaceholders().length) schedulePlaceholderFills();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pump);
    // 测试环境没有 rAF：用宏任务续跑，绝不同步递归（会打爆调用栈）。
    else if (typeof setTimeout === 'function') setTimeout(pump, 0);
    else pump();
  }
  /** 导出/截图前必须没有壳：一次性补完（显式重置建卡预算）。 */
  function flushPlaceholders(): void {
    let filled = 0;
    for (let guard = 0; guard < 200; guard += 1) {
      controller.resetBuildBudget();
      const pending = controller.pendingPlaceholders();
      if (!pending.length) break;
      let round = 0;
      for (const id of pending) if (controller.fillPlaceholder(id)) round += 1;
      if (!round) break;
      filled += round;
    }
    if (filled) render({ viewport: true });
  }

  function ensureLayoutOnce(): void {
    if (panelsSeen && state.raw) return;
    ensureLayout();
  }

  /** 框选矩形：持久元素，只改属性。 */
  function renderMarquee(): void {
    const overlays = controller.getLayer().overlays;
    const box = state.marquee;
    if (!box) {
      if (marquee?.remove) marquee.remove();
      marquee = null;
      return;
    }
    const x = Math.min(box.x1, box.x2);
    const y = Math.min(box.y1, box.y2);
    const width = Math.abs(box.x2 - box.x1);
    const height = Math.abs(box.y2 - box.y1);
    if (!marquee) marquee = svgEl('rect', { class: 'marquee', x, y, width, height }, overlays);
    else if (typeof marquee.setAttribute === 'function') {
      marquee.setAttribute('x', String(x));
      marquee.setAttribute('y', String(y));
      marquee.setAttribute('width', String(width));
      marquee.setAttribute('height', String(height));
    }
  }

  /**
   * 按状态/类型临时隐藏：只增删 class，不重建卡片与连线。
   *
   * 卡片、结构连线组都带 `data-id` / `data-parent` / `data-child`，命中集合一变就地切换
   * `.node-filtered` / `.edge-filtered`；筛选是视图层的事，绝不写文档、也不进历史。
   */
  function filteredIds(): Set<string> {
    const ids = new Set<string>();
    if (!deps.isNodeFiltered) return ids;
    for (const node of nodes()) {
      if (deps.isNodeFiltered(node)) ids.add(String(node.id));
    }
    return ids;
  }

  /** 上一帧是否有命中项：没有筛选、上一帧也没有时，整段遍历直接跳过。 */
  let filterWasActive = false;
  function applyNodeFilter(): void {
    const filtered = filteredIds();
    const touched = filtered.size > 0 || filterWasActive;
    filterWasActive = filtered.size > 0;
    if (!touched) return;
    for (const [id, element] of controller.mountedNodes()) {
      if (!element || typeof element.classList !== 'object' || typeof element.classList.toggle !== 'function') continue;
      element.classList.toggle('node-filtered', filtered.has(String(id)));
    }
    const wires = controller.getLayer().wires;
    const children = wires && Array.isArray(wires.children) ? wires.children : [];
    for (const group of children) {
      const dataset = group && group.dataset;
      if (!dataset) continue;
      const hit = filtered.has(String(dataset.parent || '')) || filtered.has(String(dataset.child || ''));
      if (typeof group.classList === 'object' && typeof group.classList.toggle === 'function') {
        group.classList.toggle('edge-filtered', hit);
      }
    }
  }

  /** 排列预览的虚影：只画一层虚线框，确认后才真正写文档。 */
  let arrangePreviewLayer: any = null;
  /** 上一次已经请求记录过的视口（pan/zoom）：不变就不再排定时器。 */
  let lastViewportKey = '';
  function renderArrangePreview(): void {
    const overlays = controller.getLayer().overlays;
    const preview = state.arrangePreview;
    if (!preview || !preview.nodes || !Object.keys(preview.nodes).length) {
      if (arrangePreviewLayer && typeof arrangePreviewLayer.remove === 'function') arrangePreviewLayer.remove();
      arrangePreviewLayer = null;
      return;
    }
    if (arrangePreviewLayer && typeof arrangePreviewLayer.remove === 'function') arrangePreviewLayer.remove();
    arrangePreviewLayer = svgEl('g', { class: 'arrange-preview' }, overlays);
    for (const [id, pos] of Object.entries(preview.nodes) as Array<[string, { x: number; y: number }]>) {
      const node = nodeById(id);
      if (!node) continue;
      svgEl('rect', {
        class: 'arrange-preview-box',
        x: pos.x, y: pos.y, width: NODE_W, height: nodeHeight(node), rx: 5,
      }, arrangePreviewLayer);
    }
  }

  /** 一次重绘：控制器负责节点/卡片/连线；这里补它不管的世界变换、浮层与面板。 */
  function render(flags: RenderFlags = {}): void {    if (!state.raw) return;
    const full = Boolean(flags.full);
    const firstFrame = !panelsSeen;
    const scope: RenderFlags = full
      ? { full: true, graph: true, minimap: true, viewport: true, interaction: true, selection: true, panels: true }
      : { ...flags };

    if (firstFrame || scope.graph || full) {
      UI.closeDropdowns?.();
      ensureLayoutOnce();
      const migratedPublic = syncLegacyInputParameters();
      const migratedCards = syncLegacyVariableCards();
      if (migratedPublic || migratedCards) setDirty(true);
    }

    // 缩放分级：带迟滞，只在真正跨级时切换；切换只改根图层 class，不重建卡片。
    const nextDetail = full ? resolveDetailLevel(state.zoom, null) : resolveDetailLevel(state.zoom, detailLevel);
    const levelChanged = nextDetail !== detailLevel;
    detailLevel = nextDetail;

    // 内容变化由控制器从文档版本判断；这里只负责把「跨分级」也算成一次内容变化，
    // 因为分级会改变卡片实际显示的内容。选中 / 悬停 / 运行状态只改 class，
    // 由 patchNodeState 就地更新，不进内容信号。
    controller.request({
      full,
      graph: Boolean(scope.graph) || levelChanged,
      viewport: Boolean(scope.viewport) || levelChanged,
      interaction: Boolean(scope.interaction),
      selection: Boolean(scope.selection),
    });
    // 选中 / 悬停 / 运行状态只改 class，不重建卡片。
    if (scope.selection || scope.interaction || scope.full) {
      for (const id of nodeElements.keys()) patchNodeState(id);
    }
    renderMarquee();
    renderArrangePreview();
    // 临时隐藏的筛选：卡片与结构连线只切 class（不重建、不写文档）。
    if (scope.graph || scope.full || scope.selection || scope.interaction || firstFrame) applyNodeFilter();
    // 画布位置历史：只有平移/缩放真的变了才请求记录（避免每次图形重绘都排一个定时器）。
    if (scope.viewport || scope.graph || full || firstFrame) {
      const viewportKey = `${state.panX},${state.panY},${state.zoom}`;
      if (viewportKey !== lastViewportKey) {
        lastViewportKey = viewportKey;
        const gridStyle = wrap.style;
        if (gridStyle && typeof gridStyle.setProperty === 'function') {
          gridStyle.setProperty('--canvas-grid-size', `${24 * state.zoom}px`);
          gridStyle.setProperty('--canvas-grid-pan-x', `${state.panX}px`);
          gridStyle.setProperty('--canvas-grid-pan-y', `${state.panY}px`);
        }
        deps.recordViewportSoon?.();
      }
    }

    $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
    if (scope.panels || full || firstFrame) {
      updateIssueBadge();
      renderInspector();
      postSidebarState();
    }
    if (scope.minimap || full || firstFrame || scope.viewport) renderMinimap();
    panelsSeen = true;
    afterRender?.();
    // 有壳没补时安排下一帧继续补；导出一类必须完整的场景走 flushPlaceholders。
    if (controller.pendingPlaceholders().length) schedulePlaceholderFills();
  }

  /** 定位后的短暂高亮：节点卡与（可选）参数端点闪烁一次，1.4 秒后自动消退。 */
  let flashTimer: number | undefined;
  function flashNode(id: string, param?: string): void {
    const element = controller.mountedNodes().get(id);
    if (!element || typeof element.classList !== 'object' || typeof element.classList.add !== 'function') return;
    if (flashTimer !== undefined) {
      if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') window.clearTimeout(flashTimer);
      flashTimer = undefined;
    }
    let rowElements: any[] = [];
    if (param && typeof element.querySelectorAll === 'function') {
      try {
        rowElements = Array.from(element.querySelectorAll(`[data-param="${CSS.escape(param)}"]`));
      } catch {
        rowElements = [];
      }
    }
    element.classList.add('node-flash');
    for (const row of rowElements) {
      if (row && typeof row.classList === 'object' && typeof row.classList.add === 'function') row.classList.add('param-row-flash');
    }
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      flashTimer = window.setTimeout(() => {
        element.classList.remove('node-flash');
        for (const row of rowElements) {
          if (row && typeof row.classList === 'object' && typeof row.classList.remove === 'function') row.classList.remove('param-row-flash');
        }
        flashTimer = undefined;
      }, 1400);
    }
  }

  /** 把画布视野中心移到指定节点（搜索定位与结构树窗口共用），并让节点短暂闪烁。 */
  function focusNode(id: string, param?: string): void {
    const node = nodeById(id);
    if (!node) return;
    const pos = position(node);
    const rect = measurement.read();
    state.panX = rect.width / 2 - (pos.x + NODE_W / 2) * state.zoom;
    state.panY = rect.height / 2 - (pos.y + nodeHeight(node) / 2) * state.zoom;
    // 小地图据此标出「刚刚定位到的卡片」。
    state.searchTargetId = String(id);
    render({ viewport: true, selection: true, panels: true, minimap: true });
    flashNode(id, param);
  }

  /** 双击节点：自动聚焦并放大到完整卡片档（概览模式下也能看清内容）。 */
  function focusNodeDetail(id: string): void {
    const node = nodeById(id);
    if (!node) return;
    const pos = position(node);
    const rect = measurement.read();
    state.zoom = Math.max(FOCUS_ZOOM, state.zoom);
    state.panX = rect.width / 2 - (pos.x + NODE_W / 2) * state.zoom;
    state.panY = rect.height / 2 - (pos.y + nodeHeight(node) / 2) * state.zoom;
    detailLevel = resolveDetailLevel(state.zoom, null);
    state.searchTargetId = String(id);
    render({ viewport: true, selection: true, panels: true, minimap: true });
  }

  const entry: CanvasRenderEntry = {
    render,
    coalesce: (flags?: RenderFlags) => controller.coalesce(flags),
    focusNode,
    focusNodeDetail,
    setRenderAll: (value: boolean) => {
      if (value) {
        // 先挂载全部节点，再一次性补齐由全量挂载新产生的占位壳。
        // 反过来会让视口外节点仍以空卡片参与导出。
        controller.setRenderAll(true);
        flushPlaceholders();
        return;
      }
      controller.setRenderAll(false);
    },
    rebuildAll: () => controller.rebuildAll(),
    stats: () => controller.stats(),
    detailLevel: () => detailLevel,
    controller,
  };
  return entry;
}
