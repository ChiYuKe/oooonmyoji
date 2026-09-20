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

export interface ViewportDeps {
  state: CanvasState;
  nodes(): any[];
  position(node: any): { x: number; y: number };
  layout(): Record<string, any>;
  mutate(fn: () => void): void;
  instanceRunCards(): any[];
  variableCardList(): Array<{ x: number; y: number }>;
  nodeHeight(node: any): number;
  /** 真实节点的变量端点：自动排列后变量卡片按显式连线找归属，缺省时不看端口。 */
  nodeVariablePins?(node: any): any[];
  /** 节点参数行的行高：绑定卡片纵向对齐到所属的那一行。 */
  nodeRowHeight?(node: any): number;
  /** 变量卡输出口在卡片内的纵向位置。 */
  variableCardPortY?: number;
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
  autoLayout(record?: boolean): void;
  ensureLayout(): void;
  bounds(): CanvasBounds;
  fitView(): void;
  zoomAt(factor: number, clientX?: number, clientY?: number): void;
  worldPoint(event: { clientX: number; clientY: number }): { x: number; y: number };
  bezier(x1: number, y1: number, x2: number, y2: number): string;
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
   */
  function autoLayout(record = true): void {
    const run = (): void => {
      const previous = { ...layout() };
      const map = new Map(nodes().map((node) => [node.id, node]));
      const placed = new Set<string>();
      let leaf = 0;
      const xGap = 72;
      const yGap = 112;
      const place = (id: string, depth: number): number => {
        const node = map.get(id);
        if (!node || placed.has(id)) return 0;
        placed.add(id);
        const children = Array.isArray(node.children) ? node.children.filter((child: string) => map.has(child)) : [];
        let x: number;
        if (!children.length) {
          x = leaf * (nodeWidth + xGap);
          leaf += 1;
        } else {
          const values = children.map((child: string) => place(child, depth + 1));
          x = (values[0] + values[values.length - 1]) / 2;
        }
        layout()[id] = { x: Math.round(x), y: Math.round(depth * (baseHeight + yGap)) };
        return x;
      };
      // 从**当前视图的根**开始排树：外层是文档 root（外加没连上的孤立节点），
      // 组内视图里则是那张「组接口」卡——它的 children 就是组的入口节点。
      // 以前只认 `state.raw.root`：进组后文档 root 不在投影里，递归一次都没跑起来，
      // 成员于是被当成一堆孤立节点平铺成一行（这就是「组内排得不好看」的原因）。
      const list = nodes();
      const hasParent = new Set<string>();
      for (const node of list) {
        for (const child of Array.isArray(node.children) ? node.children : []) {
          if (map.has(child)) hasParent.add(String(child));
        }
      }
      const roots: string[] = [];
      if (state.raw?.root && map.has(state.raw.root)) roots.push(state.raw.root);
      for (const node of list) {
        const id = String(node.id);
        if (roots.includes(id) || hasParent.has(id)) continue;
        roots.push(id);
      }
      for (const id of roots) place(id, 0);
      for (const node of list) {
        if (!placed.has(node.id)) {
          layout()[node.id] = { x: leaf * (nodeWidth + xGap), y: 0 };
          leaf += 1;
        }
      }
      if (record) {
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
        });
      }
    };
    if (record) mutate(run); else run();
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

  return { autoLayout, ensureLayout, bounds, fitView, zoomAt, worldPoint, bezier };
}
