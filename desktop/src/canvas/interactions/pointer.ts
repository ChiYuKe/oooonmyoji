/**
 * 画布指针交互：节点拖拽、画布平移、框选与连线拖拽的指针生命周期。
 * 原 `workflow-editor.js` 的 startNodeDrag/onPointerDown/autoPan/onPointerMove/onPointerUp
 * 与 suppressPanContextMenu 状态。
 *
 * 所有文档修改通过状态写入与注入回调完成；连续拖拽只在指针抬起时形成一次历史。
 */
import type { CanvasState } from '../state/canvas-state';

export interface PointerPoint {
  x: number;
  y: number;
}

export interface PointerEventLike {
  button?: number;
  clientX: number;
  clientY: number;
  pointerId?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface PointerDeps {
  state: CanvasState;
  graph: Element;
  wrap: HTMLElement;
  worldPoint(event: { clientX: number; clientY: number }): PointerPoint;
  position(node: any): PointerPoint;
  nodeById(id: string): any;
  nodes(): any[];
  nodeHeight(node: any): number;
  snapshot(): string;
  render(): void;
  hideMenus(): void;
  clearVariableCardSelection(): void;
  layout(): Record<string, any>;
  variableCards(): Record<string, any>;
  variableCardList(): any[];
  connectionTargetAt(event: PointerEventLike): any;
  variableConnectionTargetAt(event: PointerEventLike): any;
  referenceConnectionTargetAt(event: PointerEventLike): any;
  finishConnection(event: PointerEventLike, target: any): void;
  cancelConnection(): void;
  finishVariableConnection(event: PointerEventLike): void;
  finishReferenceConnection(event: PointerEventLike): void;
  setDirty(value?: boolean): void;
  nodeWidth: number;
  variableCardWidth: number;
  variableCardHeight: number;
}

export interface CanvasPointer {
  startNodeDrag(event: PointerEventLike, id: string): void;
  onPointerDown(event: PointerEventLike): void;
  autoPan(event: PointerEventLike): void;
  onPointerMove(event: PointerEventLike): void;
  onPointerUp(event: PointerEventLike): void;
  /** 右键平移拖拽结束后应吞掉紧随的 contextmenu；读取即消费。 */
  contextMenuSuppressedByPan(): boolean;
}

export function createCanvasPointer(deps: PointerDeps): CanvasPointer {
  const {
    state, graph, wrap, worldPoint, position, nodeById, nodes, nodeHeight, snapshot, render, hideMenus,
    clearVariableCardSelection, layout, variableCards, variableCardList, connectionTargetAt,
    variableConnectionTargetAt, finishConnection, cancelConnection, finishVariableConnection, setDirty,
    referenceConnectionTargetAt, finishReferenceConnection,
    nodeWidth, variableCardWidth, variableCardHeight,
  } = deps;

  let suppressPanContextMenu = false;

  function startNodeDrag(event: PointerEventLike, id: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.shiftKey && !state.selected.has(id)) state.selected = new Set([id]);
    else if (event.shiftKey) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    }
    state.selectedEdge = null;
    state.selectedRun = null;
    state.inspector = 'node';
    const point = worldPoint(event);
    const origins: Record<string, PointerPoint> = {};
    for (const selected of state.selected) origins[selected] = { ...position(nodeById(selected)) };
    state.drag = { kind: 'nodes', start: point, origins, before: snapshot(), moved: false };
    render();
  }

  function onPointerDown(event: PointerEventLike): void {
    hideMenus();
    suppressPanContextMenu = false;
    if (event.button === 1 || event.button === 2 || (event.button === 0 && event.altKey)) {
      event.preventDefault();
      state.drag = { kind: 'pan', x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY, moved: false };
      return;
    }
    if (event.button === 0 && event.target === graph) {
      const point = worldPoint(event);
      if (!event.shiftKey) {
        state.selected.clear();
        clearVariableCardSelection();
      }
      state.selectedEdge = null;
      state.selectedRun = null;
      state.inspector = 'node';
      state.marquee = { x1: point.x, y1: point.y, x2: point.x, y2: point.y, additive: event.shiftKey };
      state.drag = { kind: 'marquee' };
      render();
    }
  }

  function autoPan(event: PointerEventLike): void {
    if (!state.drag && !state.connect) return;
    const rect = wrap.getBoundingClientRect();
    const margin = 36;
    let dx = 0;
    let dy = 0;
    if (event.clientX - rect.left < margin) dx = 12;
    else if ((rect as DOMRect).right !== undefined && (rect as DOMRect).right - event.clientX < margin) dx = -12;
    else if (event.clientX > rect.left + rect.width - margin) dx = -12;
    if (event.clientY - rect.top < margin) dy = 12;
    else if ((rect as DOMRect).bottom !== undefined && (rect as DOMRect).bottom - event.clientY < margin) dy = -12;
    else if (event.clientY > rect.top + rect.height - margin) dy = -12;
    state.panX += dx;
    state.panY += dy;
  }

  function onPointerMove(event: PointerEventLike): void {
    if (state.connect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.connect.pointerId) && event.pointerId !== state.connect.pointerId) return;
      autoPan(event);
      const point = worldPoint(event);
      state.connect.x = point.x;
      state.connect.y = point.y;
      state.connect.hover = connectionTargetAt(event);
      render();
      return;
    }
    if (state.variableConnect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.variableConnect.pointerId) && event.pointerId !== state.variableConnect.pointerId) return;
      autoPan(event);
      const point = worldPoint(event);
      state.variableConnect.x = point.x;
      state.variableConnect.y = point.y;
      state.variableConnect.hover = variableConnectionTargetAt(event);
      render();
      return;
    }
    if (state.referenceConnect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.referenceConnect.pointerId) && event.pointerId !== state.referenceConnect.pointerId) return;
      autoPan(event);
      const point = worldPoint(event);
      state.referenceConnect.x = point.x;
      state.referenceConnect.y = point.y;
      state.referenceConnect.hover = referenceConnectionTargetAt(event);
      render();
      return;
    }
    if (!state.drag) return;
    if (state.drag.kind === 'pan') {
      state.drag.moved = state.drag.moved || Math.abs(event.clientX - state.drag.x) + Math.abs(event.clientY - state.drag.y) > 3;
      state.panX = state.drag.panX + event.clientX - state.drag.x;
      state.panY = state.drag.panY + event.clientY - state.drag.y;
    } else if (state.drag.kind === 'nodes') {
      autoPan(event);
      const point = worldPoint(event);
      const dx = point.x - state.drag.start.x;
      const dy = point.y - state.drag.start.y;
      state.drag.moved = state.drag.moved || Math.abs(dx) + Math.abs(dy) > 2;
      for (const [id, origin] of Object.entries(state.drag.origins) as Array<[string, PointerPoint]>) {
        layout()[id] = { x: Math.round((origin.x + dx) / 8) * 8, y: Math.round((origin.y + dy) / 8) * 8 };
      }
    } else if (state.drag.kind === 'variable-card') {
      autoPan(event);
      const point = worldPoint(event);
      const dx = point.x - state.drag.start.x;
      const dy = point.y - state.drag.start.y;
      state.drag.moved = state.drag.moved || Math.abs(dx) + Math.abs(dy) > 2;
      const card = variableCards()[state.drag.id];
      if (card) {
        card.x = Math.round((state.drag.origin.x + dx) / 8) * 8;
        card.y = Math.round((state.drag.origin.y + dy) / 8) * 8;
      }
    } else if (state.drag.kind === 'marquee' && state.marquee) {
      const point = worldPoint(event);
      state.marquee.x2 = point.x;
      state.marquee.y2 = point.y;
      const x1 = Math.min(state.marquee.x1, point.x);
      const x2 = Math.max(state.marquee.x1, point.x);
      const y1 = Math.min(state.marquee.y1, point.y);
      const y2 = Math.max(state.marquee.y1, point.y);
      const selected = state.marquee.additive ? new Set(state.selected) : new Set<string>();
      const selectedCardIds = state.marquee.additive && state.selectedVariableCardIds instanceof Set
        ? new Set(state.selectedVariableCardIds)
        : new Set<string>();
      for (const node of nodes()) {
        const pos = position(node);
        if (pos.x + nodeWidth >= x1 && pos.x <= x2 && pos.y + nodeHeight(node) >= y1 && pos.y <= y2) selected.add(node.id);
      }
      for (const card of variableCardList()) {
        if (card.x + variableCardWidth >= x1 && card.x <= x2 && card.y + variableCardHeight >= y1 && card.y <= y2) selectedCardIds.add(card.id);
      }
      state.selected = selected;
      if (selectedCardIds.size && !selected.size) {
        state.selectedVariableCardIds = selectedCardIds;
        state.selectedVariableCardId = selectedCardIds.size === 1 ? [...selectedCardIds][0] : '';
        const first = variableCardList().find((card: any) => selectedCardIds.has(card.id));
        state.selectedVariable = first?.name || '';
        state.selectedVariableScope = first?.scope || 'inputs';
        state.inspector = 'variables';
      } else {
        clearVariableCardSelection();
        state.inspector = 'node';
      }
    }
    render();
  }

  function onPointerUp(event: PointerEventLike): void {
    if (state.connect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.connect.pointerId) && event.pointerId !== state.connect.pointerId) return;
      const target = connectionTargetAt(event) || state.connect.hover;
      if (target) finishConnection(event, target);
      else cancelConnection();
      return;
    }
    if (state.variableConnect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.variableConnect.pointerId) && event.pointerId !== state.variableConnect.pointerId) return;
      finishVariableConnection(event);
      return;
    }
    if (state.referenceConnect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.referenceConnect.pointerId) && event.pointerId !== state.referenceConnect.pointerId) return;
      finishReferenceConnection(event);
      return;
    }
    if (!state.drag) return;
    if (state.drag.kind === 'nodes' && state.drag.moved && snapshot() !== state.drag.before) {
      state.undo.push(state.drag.before);
      state.redo = [];
      setDirty();
    }
    if (state.drag.kind === 'variable-card' && state.drag.moved && snapshot() !== state.drag.before) {
      state.undo.push(state.drag.before);
      state.redo = [];
      setDirty();
    }
    if (state.drag.kind === 'pan' && state.drag.moved) suppressPanContextMenu = true;
    state.drag = null;
    state.marquee = null;
    render();
  }

  function contextMenuSuppressedByPan(): boolean {
    if (suppressPanContextMenu) {
      suppressPanContextMenu = false;
      return true;
    }
    return Boolean(state.drag && state.drag.kind === 'pan' && state.drag.moved);
  }

  return { startNodeDrag, onPointerDown, autoPan, onPointerMove, onPointerUp, contextMenuSuppressedByPan };
}
