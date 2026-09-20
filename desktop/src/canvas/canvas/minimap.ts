/**
 * 画布小地图：按包围盒绘制节点/实例卡/变量卡缩略图与当前视口框。
 *
 * 结构与画布解耦：
 * - 节点/卡片缩略矩形只在布局或结构变化时重建（`renderMinimap({ structure: true })`）；
 * - 平移、缩放只更新视口矩形（`renderMinimap()`）；
 * - 拖拽期间最多每 100 ms 更新一次结构，松手后精确更新。
 */
import type { CanvasState } from '../state/canvas-state';
import type { CanvasBounds } from './viewport';
import { createWrapMeasurement } from './wrap-measurement';

export interface MinimapNode {
  id?: string;
  type?: string;
}

export interface MinimapRunCard {
  x: number;
  y: number;
  height: number;
  key?: string;
}

export interface MinimapVariableCard {
  id?: string;
  x: number;
  y: number;
}

export interface MinimapDeps {
  state: CanvasState;
  $(id: string): HTMLElement;
  svgEl(tag: string, attrs: Record<string, unknown>, parent: any): any;
  bounds(): CanvasBounds;
  nodes(): MinimapNode[];
  position(node: MinimapNode): { x: number; y: number };
  nodeHeight(node: MinimapNode): number;
  instanceRunCards(): MinimapRunCard[];
  variableCardList(): MinimapVariableCard[];
  wrap: HTMLElement;
  /** 视口尺寸测量（缓存读）；缺省按 `wrap` 自行创建。 */
  measurement?: { read(): { width: number; height: number; left: number; top: number } };
  nodeWidth: number;
  runCardWidth: number;
  variableCardWidth: number;
  variableCardHeight: number;
}

export interface MinimapRenderOptions {
  /** 强制重建缩略矩形（布局/结构变化、首次渲染）。 */
  structure?: boolean;
  /** 视口框也来不及更新时可以整体跳过（拖拽节流用）。 */
  viewport?: boolean;
  /** 当前时间戳（毫秒）；缺省取 Date.now()，便于测试注入。 */
  now?: number;
}

export interface CanvasMinimap {
  renderMinimap(options?: MinimapRenderOptions): void;
  /** 结构重建次数（基准统计用）。 */
  structureBuilds(): number;
  /** 视口框更新次数（基准统计用）。 */
  viewportUpdates(): number;
  /** 丢弃缓存，下次渲染整块重建。 */
  invalidate(): void;
}

/** 拖拽期间小地图结构更新的最小间隔。 */
export const MINIMAP_DRAG_INTERVAL_MS = 100;

export function createCanvasMinimap(deps: MinimapDeps): CanvasMinimap {
  const {
    state, $, svgEl, bounds, nodes, position, nodeHeight, instanceRunCards, variableCardList,
    wrap, nodeWidth, runCardWidth, variableCardWidth, variableCardHeight,
  } = deps;
  const measurement = deps.measurement ?? createWrapMeasurement(wrap as any);

  let lastStructureSignature = '';
  let lastStructureAt = 0;
  let structureBuilds = 0;
  let viewportUpdates = 0;
  let viewportRect: any = null;

  function signature(): string {
    const parts: string[] = [];
    for (const node of nodes()) {
      const pos = position(node);
      parts.push(`n${node.id}:${pos.x},${pos.y},${nodeHeight(node)}`);
    }
    for (const card of instanceRunCards()) parts.push(`r${card.key ?? `${card.x},${card.y}`}:${card.x},${card.y},${card.height}`);
    for (const card of variableCardList()) parts.push(`v${card.id ?? `${card.x},${card.y}`}:${card.x},${card.y}`);
    const box = bounds();
    parts.push(`b${box.minX},${box.minY},${box.maxX},${box.maxY}`);
    return parts.join('|');
  }

  function renderStructure(mini: any): void {
    const box = bounds();
    const pad = 40;
    mini.setAttribute('viewBox', `${box.minX - pad} ${box.minY - pad} ${Math.max(1, box.maxX - box.minX + pad * 2)} ${Math.max(1, box.maxY - box.minY + pad * 2)}`);
    if (typeof mini.replaceChildren === 'function') mini.replaceChildren();
    else mini.innerHTML = '';
    for (const node of nodes()) {
      const pos = position(node);
      svgEl('rect', { class: `mini-node type-${node.type}`, x: pos.x, y: pos.y, width: nodeWidth, height: nodeHeight(node) }, mini);
    }
    for (const card of instanceRunCards()) {
      svgEl('rect', { class: 'mini-node type-instance-run', x: card.x, y: card.y, width: runCardWidth, height: card.height }, mini);
    }
    for (const card of variableCardList()) {
      svgEl('rect', { class: 'mini-node type-variable-card', x: card.x, y: card.y, width: variableCardWidth, height: variableCardHeight }, mini);
    }
    viewportRect = svgEl('rect', { class: 'mini-viewport', x: 0, y: 0, width: 0, height: 0 }, mini);
    structureBuilds += 1;
  }

  function renderViewport(): void {
    if (!viewportRect) return;
    const rect = measurement.read();
    const x = -state.panX / state.zoom;
    const y = -state.panY / state.zoom;
    const width = rect.width / state.zoom;
    const height = rect.height / state.zoom;
    if (typeof viewportRect.setAttribute === 'function') {
      viewportRect.setAttribute('x', String(x));
      viewportRect.setAttribute('y', String(y));
      viewportRect.setAttribute('width', String(width));
      viewportRect.setAttribute('height', String(height));
    } else {
      viewportRect.attrs = { ...(viewportRect.attrs || {}), x, y, width, height };
    }
    viewportUpdates += 1;
  }

  function renderMinimap(options: MinimapRenderOptions = {}): void {
    const mini = $('minimap');
    const now = options.now ?? Date.now();
    const next = signature();
    const dragging = Boolean(state.drag);
    const structureChanged = options.structure === true || !viewportRect || next !== lastStructureSignature;
    if (structureChanged) {
      // 拖拽期间结构更新节流：小地图不需要跟着每个像素动。
      if (dragging && options.structure !== true && now - lastStructureAt < MINIMAP_DRAG_INTERVAL_MS) {
        if (options.viewport !== false) renderViewport();
        return;
      }
      renderStructure(mini);
      lastStructureSignature = next;
      lastStructureAt = now;
    }
    if (options.viewport !== false) renderViewport();
  }

  return {
    renderMinimap,
    structureBuilds: () => structureBuilds,
    viewportUpdates: () => viewportUpdates,
    invalidate: () => {
      viewportRect = null;
      lastStructureSignature = '';
    },
  };
}
