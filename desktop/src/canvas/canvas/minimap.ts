/**
 * 画布小地图：按包围盒绘制节点/实例卡/变量卡缩略图与当前视口框。
 * 原 `workflow-editor.js` 的 renderMinimap。
 */
import type { CanvasState } from '../state/canvas-state';
import type { CanvasBounds } from './viewport';

export interface MinimapNode {
  id?: string;
  type?: string;
}

export interface MinimapRunCard {
  x: number;
  y: number;
  height: number;
}

export interface MinimapVariableCard {
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
  nodeWidth: number;
  runCardWidth: number;
  variableCardWidth: number;
  variableCardHeight: number;
}

export interface CanvasMinimap {
  renderMinimap(): void;
}

export function createCanvasMinimap(deps: MinimapDeps): CanvasMinimap {
  const {
    state, $, svgEl, bounds, nodes, position, nodeHeight, instanceRunCards, variableCardList,
    wrap, nodeWidth, runCardWidth, variableCardWidth, variableCardHeight,
  } = deps;

  function renderMinimap(): void {
    const mini = $('minimap');
    mini.innerHTML = '';
    const box = bounds();
    const pad = 40;
    mini.setAttribute('viewBox', `${box.minX - pad} ${box.minY - pad} ${Math.max(1, box.maxX - box.minX + pad * 2)} ${Math.max(1, box.maxY - box.minY + pad * 2)}`);
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
    const rect = wrap.getBoundingClientRect();
    svgEl('rect', { class: 'mini-viewport', x: -state.panX / state.zoom, y: -state.panY / state.zoom, width: rect.width / state.zoom, height: rect.height / state.zoom }, mini);
  }

  return { renderMinimap };
}
