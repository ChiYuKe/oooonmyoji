/**
 * 画布视口与布局计算：自动布局、包围盒、适配视图、缩放与坐标换算。
 * 原 `workflow-editor.js` 的 autoLayout/ensureLayout/bounds/fitView/zoomAt/worldPoint/bezier。
 *
 * 只读写注入状态；修改布局走注入的 mutate，保持一次自动布局一条历史。
 */
import type { CanvasState } from '../state/canvas-state';

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
  wrap: HTMLElement;
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

  function autoLayout(record = true): void {
    const run = (): void => {
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
      if (state.raw?.root) place(state.raw.root, 0);
      for (const node of nodes()) {
        if (!placed.has(node.id)) {
          layout()[node.id] = { x: leaf * (nodeWidth + xGap), y: 0 };
          leaf += 1;
        }
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
    const cards = variableCardList();
    return {
      minX: Math.min(...points.map((item) => item.pos.x), ...runCards.map((item) => item.x), ...cards.map((item) => item.x)),
      minY: Math.min(...points.map((item) => item.pos.y), ...cards.map((item) => item.y)),
      maxX: Math.max(...points.map((item) => item.pos.x + nodeWidth), ...runCards.map((item) => item.x + runCardWidth), ...cards.map((item) => item.x + variableCardWidth)),
      maxY: Math.max(...points.map((item) => item.pos.y + nodeHeight(item.node)), ...runCards.map((item) => item.y + item.height), ...cards.map((item) => item.y + variableCardHeight)),
    };
  }

  function fitView(): void {
    const rect = wrap.getBoundingClientRect();
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
    const rect = wrap.getBoundingClientRect();
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
    const rect = wrap.getBoundingClientRect();
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
