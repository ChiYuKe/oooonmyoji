/**
 * 画布视口与布局计算：自动布局、包围盒、适配视图、缩放与坐标换算。
 * 原 `workflow-editor.js` 的 autoLayout/ensureLayout/bounds/fitView/zoomAt/worldPoint/bezier。
 *
 * 只读写注入状态；修改布局走注入的 mutate，保持一次自动布局一条历史。
 */
import type { CanvasState } from '../state/canvas-state';
import { createWrapMeasurement, type CanvasWrapMeasurement } from './wrap-measurement';
import { followCardsAfterLayout, groupMemberIdsOf, variableCardOwners } from './card-follow-layout';

export interface CanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 自动排列范围：整份工作流 / 只排选中的卡片 / 只排当前节点组。 */
export type AutoLayoutScope = 'all' | 'selected' | 'group';

export interface ViewportDeps {
  state: CanvasState;
  nodes(): any[];
  position(node: any): { x: number; y: number };
  layout(): Record<string, any>;
  mutate(fn: () => void): void;
  instanceRunCards(): any[];
  variableCardList(): Array<{ x: number; y: number }>;
  nodeHeight(node: any): number;
  /** 该节点是否锁定位置：锁定的卡片自动排列时保持原位。 */
  isLocked?(id: string): boolean;
  /** 当前节点组（进入的组或选中的组卡）：`group` 范围的排列对象。 */
  currentNodeGroupId?(): string;
  /** 真实节点的变量端点：自动排列后变量卡片按显式连线找归属，缺省时不看端口。 */
  nodeVariablePins?(node: any): any[];
  /** 节点参数行的行高：绑定卡片纵向对齐到所属的那一行。 */
  nodeRowHeight?(node: any): number;
  /** 变量卡输出口在卡片内的纵向位置。 */
  variableCardPortY?: number;
  /**
   * 组内视图里被组边界行代表的变量（`作用域.变量名`）：这些卡片组内不画，组内排列也不碰。
   * 与 `editor.variableCardList()` 的过滤用同一个来源（`boundaryVariableRefs()`）。
   */
  groupRepresentedRefs?(): Set<string>;
  wrap: HTMLElement;
  /** 视口尺寸测量（缓存读，避免每帧强制同步布局）；缺省按 `wrap` 自行创建。 */
  measurement?: CanvasWrapMeasurement;
  minimap(): HTMLElement | null;
  render(): void;
  nodeWidth: number;
  baseHeight: number;
  runCardWidth: number;
  variableCardWidth: number;
  variableCardHeight: number;
}

export interface CanvasViewport {
  autoLayout(record?: boolean, scope?: AutoLayoutScope): void;
  /** 只算不写：排列预览的虚影位置（不碰文档、不进历史）。 */
  autoLayoutPreview(scope?: AutoLayoutScope): Record<string, { x: number; y: number }>;
  /** 把一份预览位置写进文档（调用方负责包 mutate，保证一次排列一条历史）。 */
  applyLayoutPositions(positions: Record<string, { x: number; y: number }>): void;
  ensureLayout(): void;
  bounds(): CanvasBounds;
  fitView(): void;
  zoomAt(factor: number, clientX?: number, clientY?: number): void;
  worldPoint(event: { clientX: number; clientY: number }): { x: number; y: number };
  bezier(x1: number, y1: number, x2: number, y2: number): string;
  /** 画布位置历史：视口变化后延迟记录一次（平移/缩放/定位共用）。 */
  recordViewportSoon(): void;
  recordViewport(): void;
  viewportBack(): boolean;
  viewportForward(): boolean;
  viewportHistoryState(): { canBack: boolean; canForward: boolean; length: number };
}

export function createCanvasViewport(deps: ViewportDeps): CanvasViewport {
  const {
    state, nodes, position, layout, mutate, instanceRunCards, variableCardList, nodeHeight,
    wrap, minimap, render, nodeWidth, baseHeight, runCardWidth, variableCardWidth, variableCardHeight,
  } = deps;
  // 视口尺寸缓存：读 rect 会强制刷新布局，而画布每帧都在写 DOM。
  const measurement = deps.measurement ?? createWrapMeasurement(wrap as any);

  /**
   * 自动排列：重排真实节点，并让变量卡片 / 节点组卡片跟着搬家。
   *
   * `record` 同时代表「用户主动排列」：只有这时才动卡片坐标。
   * 载入时的兜底布局（`ensureLayout` → `autoLayout(false)`）不能改用户存下来的卡片位置。
   *
   * `scope` 决定重排哪些卡片：
   * - `all`（缺省）：整份当前视图（与改造前完全一致）；
   * - `selected`：只排选中的卡片，整体以选区包围盒左上角为基准；
   * - `group`：只排当前节点组的成员，基准是该组现有包围盒。
   * 锁定的卡片两种范围下都不动（作为父级居中的锚点）。
   */
  function computeLayout(scope: AutoLayoutScope): Record<string, { x: number; y: number }> {
    const list = nodes();
    const map = new Map(list.map((node) => [node.id, node]));
    const out: Record<string, { x: number; y: number }> = {};
    const placed = new Set<string>();
    const locked = new Set<string>();
    for (const node of list) if (deps.isLocked?.(String(node.id))) locked.add(String(node.id));
    let leaf = 0;
    const xGap = 72;
    const yGap = 112;

    // 范围过滤：null 表示整份视图。
    let scopeIds: Set<string> | null = null;
    if (scope === 'selected') scopeIds = new Set([...state.selected].map(String));
    else if (scope === 'group') {
      const groupId = String(deps.currentNodeGroupId?.() || '');
      const members = groupId ? groupMemberIdsOf(state.raw, groupId) : [];
      scopeIds = new Set(members.map(String));
    }
    const candidates = scopeIds ? list.filter((node) => scopeIds!.has(String(node.id))) : list;
    if (scopeIds && !candidates.length) return out;

    // 排列基准：整份视图从原点开始（保持旧行为）；局部排列以现有包围盒左上角为基准，
    // 否则「只排选中」会把选中的卡片整块搬到工作流原点去。
    let baseX = 0;
    let baseY = 0;
    if (scopeIds) {
      const points = candidates.map((node) => position(node));
      if (points.length) {
        baseX = Math.min(...points.map((point) => point.x));
        baseY = Math.min(...points.map((point) => point.y));
      }
    }
    const currentRelativeX = (id: string): number => {
      const node = map.get(id);
      if (!node) return 0;
      return position(node).x - baseX;
    };

    const place = (id: string, depth: number): number => {
      const node = map.get(id);
      if (!node || placed.has(id)) return currentRelativeX(id);
      placed.add(id);
      const children = (Array.isArray(node.children) ? node.children : [])
        .map(String)
        .filter((child: string) => map.has(child) && (!scopeIds || scopeIds.has(child)));
      let x: number;
      if (!children.length) {
        x = leaf * (nodeWidth + xGap);
        leaf += 1;
      } else {
        const values = children.map((child: string) => place(child, depth + 1));
        x = (values[0] + values[values.length - 1]) / 2;
      }
      // 锁定：位置保持原样，只把它当前的横坐标交回去给父级居中。
      if (locked.has(id)) return currentRelativeX(id);
      out[id] = { x: Math.round(x + baseX), y: Math.round(depth * (baseHeight + yGap) + baseY) };
      return x;
    };

    // 从**当前视图的根**开始排树：外层是文档 root（外加没连上的孤立节点），
    // 组内视图里则是那张「组接口」卡——它的 children 就是组的入口节点。
    // 以前只认 `state.raw.root`：进组后文档 root 不在投影里，递归一次都没跑起来，
    // 成员于是被当成一堆孤立节点平铺成一行（这就是「组内排得不好看」的原因）。
    const inScope = new Set(candidates.map((node) => String(node.id)));
    const hasParent = new Set<string>();
    for (const node of candidates) {
      for (const child of Array.isArray(node.children) ? node.children : []) {
        if (inScope.has(String(child))) hasParent.add(String(child));
      }
    }
    const roots: string[] = [];
    if (!scopeIds && state.raw?.root && map.has(state.raw.root)) roots.push(String(state.raw.root));
    for (const node of candidates) {
      const id = String(node.id);
      if (roots.includes(id) || hasParent.has(id)) continue;
      roots.push(id);
    }
    for (const id of roots) place(id, 0);
    // 孤立节点只有整份视图排列时才补到第一行；局部排列不碰范围外的卡片。
    if (!scopeIds) {
      for (const node of list) {
        if (!placed.has(String(node.id))) {
          out[String(node.id)] = { x: leaf * (nodeWidth + xGap), y: 0 };
          leaf += 1;
        }
      }
    }
    return out;
  }

  /** 把一份位置表写进文档，并让变量卡片跟着搬家（一次 mutate = 一条历史）。 */
  function applyLayout(positions: Record<string, { x: number; y: number }>, followCards: boolean): void {
    const previous = { ...layout() };
    for (const [id, pos] of Object.entries(positions)) layout()[id] = { x: pos.x, y: pos.y };
    if (!followCards) return;
    followCardsAfterLayout({
      raw: state.raw,
      layout: layout(),
      previous,
      nodes,
      nodeHeight,
      nodeVariablePins: deps.nodeVariablePins,
      // 参数行几何：绑定卡片要纵向对齐到它绑定的那一行。
      baseHeight,
      nodeRowHeight: deps.nodeRowHeight,
      variableCardPortY: deps.variableCardPortY,
      nodeWidth,
      variableCardWidth,
      variableCardHeight,
      // 进着某个组时只动组内的东西：组卡位置与组外卡片保持原样。
      groupScopeId: String(state.nodeGroupId || ''),
      // 组内被边界行代表的卡片组内不画，组内排列也不碰（与 variableCardList 同一条规则）。
      groupRepresentedRefs: deps.groupRepresentedRefs?.(),
    });
  }

  function autoLayout(record = true, scope: AutoLayoutScope = 'all'): void {
    const positions = computeLayout(scope);
    if (record) mutate(() => applyLayout(positions, true));
    else applyLayout(positions, false);
  }

  function autoLayoutPreview(scope: AutoLayoutScope = 'all'): Record<string, { x: number; y: number }> {
    return computeLayout(scope);
  }

  /** 写入一份已经算好的位置（排列预览确认后走这里，不再重算）。 */
  function applyLayoutPositions(positions: Record<string, { x: number; y: number }>): void {
    applyLayout(positions || {}, true);
  }

  function ensureLayout(): void {
    const values = layout();
    if (nodes().some((node) => !values[node.id])) autoLayout(false);
  }

  function bounds(): CanvasBounds {
    if (!nodes().length) return { minX: 0, minY: 0, maxX: nodeWidth, maxY: baseHeight };
    const points = nodes().map((node) => ({ node, pos: position(node) }));
    const runCards = instanceRunCards();
    const cards = scopedVariableCards();
    return {
      minX: Math.min(...points.map((item) => item.pos.x), ...runCards.map((item) => item.x), ...cards.map((item) => item.x)),
      minY: Math.min(...points.map((item) => item.pos.y), ...cards.map((item) => item.y)),
      maxX: Math.max(...points.map((item) => item.pos.x + nodeWidth), ...runCards.map((item) => item.x + runCardWidth), ...cards.map((item) => item.x + variableCardWidth)),
      maxY: Math.max(...points.map((item) => item.pos.y + nodeHeight(item.node)), ...runCards.map((item) => item.y + item.height), ...cards.map((item) => item.y + variableCardHeight)),
    };
  }

  /**
   * 算包围盒时该计入哪些变量卡片。
   *
   * 组内视图只算**挂在本组成员上**的卡片：组外卡片（用户留在外层的）如果被算进来，
   * 一进组 `fitView` 就会被它们拉远，看起来就是「组里空荡荡、内容缩成一小团」。
   */
  function scopedVariableCards(): Array<{ id: string; x: number; y: number }> {
    const all = variableCardList() as Array<{ id: string; x: number; y: number }>;
    const groupId = String(state.nodeGroupId || '');
    if (!groupId) return all;
    const members = new Set(groupMemberIdsOf(state.raw, groupId));
    if (!members.size) return all;
    const owners = variableCardOwners(state.raw, nodes(), deps.nodeVariablePins ?? (() => []));
    return all.filter((card) => {
      const owner = owners.get(card.id);
      return Boolean(owner && members.has(owner.nodeId));
    });
  }

  function fitView(): void {
    const rect = measurement.read();
    const box = bounds();
    const width = Math.max(1, box.maxX - box.minX + 160);
    const height = Math.max(1, box.maxY - box.minY + 160);
    const mini = minimap();
    const miniHeight = mini ? mini.getBoundingClientRect().height : 0;
    const reservedBottom = miniHeight > 0 ? miniHeight + 24 : 0;
    const availableHeight = Math.max(1, rect.height - reservedBottom);
    state.zoom = Math.min(1.5, Math.max(0.25, Math.min(rect.width / width, availableHeight / height)));
    state.panX = (rect.width - (box.maxX - box.minX) * state.zoom) / 2 - box.minX * state.zoom;
    state.panY = (availableHeight - (box.maxY - box.minY) * state.zoom) / 2 - box.minY * state.zoom;
    render();
  }

  function zoomAt(factor: number, clientX?: number, clientY?: number): void {
    const rect = measurement.read();
    const x = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const y = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    const next = Math.min(2.5, Math.max(0.25, state.zoom * factor));
    const ratio = next / state.zoom;
    state.panX = x - (x - state.panX) * ratio;
    state.panY = y - (y - state.panY) * ratio;
    state.zoom = next;
    render();
  }

  function worldPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = measurement.read();
    return {
      x: (event.clientX - rect.left - state.panX) / state.zoom,
      y: (event.clientY - rect.top - state.panY) / state.zoom,
    };
  }

  function bezier(x1: number, y1: number, x2: number, y2: number): string {
    const bend = Math.max(48, Math.abs(y2 - y1) * 0.48);
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
  }

  /** 位置历史上限：够回退一大段操作，又不会无限增长。 */
  const VIEWPORT_HISTORY_LIMIT = 60;
  let recordTimer: any;

  function cancelRecordTimer(): void {
    if (recordTimer === undefined) return;
    if (typeof clearTimeout === 'function') clearTimeout(recordTimer);
    recordTimer = undefined;
  }

  /** 记录当前视口（相同快照不重复入栈；在历史中间操作时丢弃「未来」分支）。 */
  function recordViewport(): void {
    cancelRecordTimer();
    const history = Array.isArray(state.viewportHistory) ? state.viewportHistory : (state.viewportHistory = []);
    let index = Number.isInteger(state.viewportHistoryIndex) ? state.viewportHistoryIndex : -1;
    if (index > history.length - 1) index = history.length - 1;
    while (history.length - 1 > index) history.pop();
    const snapshot = { panX: state.panX, panY: state.panY, zoom: state.zoom };
    const last = history[history.length - 1];
    if (last && last.panX === snapshot.panX && last.panY === snapshot.panY && last.zoom === snapshot.zoom) {
      state.viewportHistoryIndex = history.length - 1;
      return;
    }
    history.push(snapshot);
    if (history.length > VIEWPORT_HISTORY_LIMIT) history.splice(0, history.length - VIEWPORT_HISTORY_LIMIT);
    state.viewportHistoryIndex = history.length - 1;
  }

  /** 视口变化后延迟记录：平移/缩放会连打很多帧，一段操作只留一个历史点。 */
  function recordViewportSoon(): void {
    if (typeof setTimeout !== 'function') { recordViewport(); return; }
    cancelRecordTimer();
    recordTimer = setTimeout(() => { recordTimer = undefined; recordViewport(); }, 350);
  }

  function restoreViewport(snapshot: { panX: number; panY: number; zoom: number }): void {
    state.panX = snapshot.panX;
    state.panY = snapshot.panY;
    state.zoom = snapshot.zoom;
    render();
  }

  function viewportHistoryState(): { canBack: boolean; canForward: boolean; length: number } {
    const history = Array.isArray(state.viewportHistory) ? state.viewportHistory : [];
    const index = Number.isInteger(state.viewportHistoryIndex) ? state.viewportHistoryIndex : -1;
    return { canBack: index > 0, canForward: index >= 0 && index < history.length - 1, length: history.length };
  }

  function viewportBack(): boolean {
    cancelRecordTimer();
    const history = Array.isArray(state.viewportHistory) ? state.viewportHistory : [];
    let index = Number.isInteger(state.viewportHistoryIndex) ? state.viewportHistoryIndex : -1;
    if (index <= 0 || !history[index - 1]) return false;
    index -= 1;
    state.viewportHistoryIndex = index;
    restoreViewport(history[index]);
    return true;
  }

  function viewportForward(): boolean {
    cancelRecordTimer();
    const history = Array.isArray(state.viewportHistory) ? state.viewportHistory : [];
    let index = Number.isInteger(state.viewportHistoryIndex) ? state.viewportHistoryIndex : -1;
    if (index < 0 || index >= history.length - 1 || !history[index + 1]) return false;
    index += 1;
    state.viewportHistoryIndex = index;
    restoreViewport(history[index]);
    return true;
  }

  return {
    autoLayout, autoLayoutPreview, applyLayoutPositions, ensureLayout, bounds, fitView, zoomAt, worldPoint, bezier,
    recordViewportSoon, recordViewport, viewportBack, viewportForward, viewportHistoryState,
  };
}
