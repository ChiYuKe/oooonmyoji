/**
 * 画布指针交互：节点拖拽、画布平移、框选与连线拖拽的指针生命周期。
 * 原 `workflow-editor.js` 的 startNodeDrag/onPointerDown/autoPan/onPointerMove/onPointerUp
 * 与 suppressPanContextMenu 状态。
 *
 * 所有文档修改通过状态写入与注入回调完成；连续拖拽只在指针抬起时形成一次历史。
 */
import type { CanvasState } from '../state/canvas-state';
import { createWrapMeasurement } from '../canvas/wrap-measurement';

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
  /** 视口尺寸测量（缓存读）；缺省按 `wrap` 自行创建。 */
  measurement?: { read(): { width: number; height: number; left: number; top: number } };
  worldPoint(event: { clientX: number; clientY: number }): PointerPoint;
  position(node: any): PointerPoint;
  nodeById(id: string): any;
  nodes(): any[];
  nodeHeight(node: any): number;
  snapshot(): string;
  render(): void;
  /**
   * 带标记的同步重绘：框选矩形要跟着指针走，不能延后到下一帧。
   * 缺省退化为无标记的 `render()`。
   */
  renderWith?(flags: { viewport?: boolean; interaction?: boolean; selection?: boolean }): void;
  /** 高频路径的重绘：合并到本帧，最多执行一次；缺省退化为 render()。 */
  coalesce?(flags?: { viewport?: boolean; interaction?: boolean }): void;
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
  /** 连线重连旋钮的指针捕获；缺省表示该画布不支持从连线旋钮重连。 */
  pointerCapture?(event: PointerEventLike): number | null;
  /** 该节点位置是否已锁定：锁定的卡片不参与拖拽（只选中）。 */
  isNodeLocked?(id: string): boolean;
  /** 提示（锁定卡片被拖动时给出原因）。 */
  toast?(message: string, error?: boolean): void;
  nodeWidth: number;
  variableCardWidth: number;
  variableCardHeight: number;
  /** 折点拖拽时把新坐标写进文档（缺省表示不支持手工折线）。 */
  moveStructuralWaypoint?(parentId: string, childId: string, pointIndex: number, point: PointerPoint): void;
}

export interface CanvasPointer {
  startNodeDrag(event: PointerEventLike, id: string): void;
  /** 注释框拖拽（移动 / 改尺寸）：与卡片拖拽共用同一套 pointer 生命周期。 */
  startCommentDrag(event: PointerEventLike, comment: any, mode: 'move' | 'resize'): void;
  /** 折点拖拽（手工折线）：只补它自己那条边。 */
  startWaypointDrag(event: PointerEventLike, parentId: string, childId: string, pointIndex: number): void;
  onPointerDown(event: PointerEventLike): void;
  autoPan(event: PointerEventLike): boolean;
  onPointerMove(event: PointerEventLike): void;
  onPointerUp(event: PointerEventLike): void;
  /** 右键平移拖拽结束后应吞掉紧随的 contextmenu；读取即消费。 */
  contextMenuSuppressedByPan(): boolean;
  /** 从连线旋钮拖出重连时捕获指针；没有注入捕获能力时返回 null。 */
  captureConnectionPointer(event: PointerEventLike): number | null;
}

export function createCanvasPointer(deps: PointerDeps): CanvasPointer {
  const {
    state, graph, wrap, worldPoint, position, nodeById, nodes, nodeHeight, snapshot, render, hideMenus,
    clearVariableCardSelection, layout, variableCards, variableCardList, connectionTargetAt,
    variableConnectionTargetAt, finishConnection, cancelConnection, finishVariableConnection, setDirty,
    referenceConnectionTargetAt, finishReferenceConnection,
    nodeWidth, variableCardWidth, variableCardHeight,
    moveStructuralWaypoint,
  } = deps;
  const isNodeLocked = deps.isNodeLocked ?? (() => false);

  // 高频路径（指针移动、滚轮）合并到本帧；没有注入调度器时保持同步重绘。
  const coalesce = deps.coalesce ?? ((flags) => { void flags; render(); });
  // 框选专用的同步重绘：没有注入时退化为普通 render()（测试替身多半不关心标记）。
  const renderWith = deps.renderWith ?? (() => render());
  // 自动平移每帧都要知道画布边缘在哪：缓存读，避免和 DOM 写入互相触发强制布局。
  const measurement = deps.measurement ?? createWrapMeasurement(wrap as any);

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
    let lockedSkipped = false;
    for (const selected of state.selected) {
      // 位置锁定的卡片不参与拖拽：多选时只拖没锁的那几张。
      if (isNodeLocked(selected)) { lockedSkipped = true; continue; }
      origins[selected] = { ...position(nodeById(selected)) };
    }
    if (!Object.keys(origins).length) {
      render();
      if (lockedSkipped) deps.toast?.('这些卡片的位置已锁定（右键可解锁）', true);
      return;
    }
    if (lockedSkipped) deps.toast?.('已跳过位置锁定的卡片', false);
    state.drag = { kind: 'nodes', start: point, origins, before: snapshot(), moved: false };
    render();
  }

  /**
   * 注释框拖拽（移动 / 改尺寸）。
   *
   * 与卡片拖拽共用同一套 `state.drag` + `onPointerMove/Up`：这样 autoPan、历史快照与
   * 「位置改了才记一条撤销」的行为完全一致，注释框模块自己不用再管指针捕获。
   */
  function startCommentDrag(event: PointerEventLike, comment: any, mode: 'move' | 'resize'): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const size = comment.size && typeof comment.size === 'object' ? comment.size : { w: 360, h: 200 };
    state.drag = {
      kind: 'comment',
      mode,
      comment,
      start: worldPoint(event),
      origin: { ...(comment.at || { x: 0, y: 0 }) },
      size: { w: Number(size.w) || 360, h: Number(size.h) || 200 },
      before: snapshot(),
      moved: false,
    };
    render();
  }

  /**
   * 折点拖拽（手工折线 / UE Knot）。
   *
   * 折点只影响它自己那条连线，所以拖动时走 `drag.kind = 'waypoint'`：由渲染层只补这一条边
   * 的 `d`（见 `render-controller.applyPatches`），不重建整张画布。
   */
  function startWaypointDrag(event: PointerEventLike, parentId: string, childId: string, pointIndex: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    state.drag = {
      kind: 'waypoint',
      parentId,
      childId,
      pointIndex,
      start: worldPoint(event),
      before: snapshot(),
      moved: false,
    };
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

  /**
   * 自动平移：指针贴着画布边缘时推动视野。返回本帧是否真的移动过，
   * 便于调用方只在需要时安排重绘。
   */
  function autoPan(event: PointerEventLike): boolean {
    if (!state.drag && !state.connect) return false;
    const rect = measurement.read();
    const margin = 36;
    let dx = 0;
    let dy = 0;
    if (event.clientX - rect.left < margin) dx = 12;
    else if (event.clientX > rect.left + rect.width - margin) dx = -12;
    if (event.clientY - rect.top < margin) dy = 12;
    else if (event.clientY > rect.top + rect.height - margin) dy = -12;
    if (!dx && !dy) return false;
    state.panX += dx;
    state.panY += dy;
    return true;
  }

  function onPointerMove(event: PointerEventLike): void {
    if (state.connect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.connect.pointerId) && event.pointerId !== state.connect.pointerId) return;
      autoPan(event);
      const point = worldPoint(event);
      state.connect.x = point.x;
      state.connect.y = point.y;
      state.connect.hover = connectionTargetAt(event);
      coalesce({ viewport: true, interaction: true });
      return;
    }
    if (state.variableConnect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.variableConnect.pointerId) && event.pointerId !== state.variableConnect.pointerId) return;
      autoPan(event);
      const point = worldPoint(event);
      state.variableConnect.x = point.x;
      state.variableConnect.y = point.y;
      state.variableConnect.hover = variableConnectionTargetAt(event);
      coalesce({ viewport: true, interaction: true });
      return;
    }
    if (state.referenceConnect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.referenceConnect.pointerId) && event.pointerId !== state.referenceConnect.pointerId) return;
      autoPan(event);
      const point = worldPoint(event);
      state.referenceConnect.x = point.x;
      state.referenceConnect.y = point.y;
      state.referenceConnect.hover = referenceConnectionTargetAt(event);
      coalesce({ viewport: true, interaction: true });
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
      // 整组选中一起拖：每张卡片按自己的起点加同一个位移（和节点拖拽同一套语义）。
      const cards = variableCards();
      for (const [id, origin] of Object.entries(state.drag.origins || {}) as Array<[string, PointerPoint]>) {
        const card = cards[id];
        if (!card) continue;
        card.x = Math.round((origin.x + dx) / 8) * 8;
        card.y = Math.round((origin.y + dy) / 8) * 8;
      }
    } else if (state.drag.kind === 'comment') {
      autoPan(event);
      const point = worldPoint(event);
      const dx = point.x - state.drag.start.x;
      const dy = point.y - state.drag.start.y;
      state.drag.moved = state.drag.moved || Math.abs(dx) + Math.abs(dy) > 2;
      const comment = state.drag.comment;
      if (comment) {
        if (state.drag.mode === 'resize') {
          // 改尺寸：宽高各自至少留一个最小值，贴 8 像素网格。
          comment.size = {
            w: Math.max(120, Math.round((state.drag.size.w + dx) / 8) * 8),
            h: Math.max(80, Math.round((state.drag.size.h + dy) / 8) * 8),
          };
        } else {
          comment.at = {
            x: Math.round((state.drag.origin.x + dx) / 8) * 8,
            y: Math.round((state.drag.origin.y + dy) / 8) * 8,
          };
        }
      }
    } else if (state.drag.kind === 'waypoint') {
      autoPan(event);
      const point = worldPoint(event);
      state.drag.moved = state.drag.moved || Math.abs(point.x - state.drag.start.x) + Math.abs(point.y - state.drag.start.y) > 2;
      deps.moveStructuralWaypoint?.(state.drag.parentId, state.drag.childId, state.drag.pointIndex, point);
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
    // 框选矩形是用户「正在画」的反馈，必须跟着指针走：延后到下一帧画会明显落后一拍，
    // 快速拖拽时甚至只在抬起时闪一下。因此框选帧走同步重绘，其余高频路径仍按帧合并。
    // 标记只给视口与交互：框选不改文档，不能因此触发连线整体重建。
    if (state.drag && state.drag.kind === 'marquee') {
      renderWith({ viewport: true, interaction: true, selection: true });
      return;
    }
    // 拖拽、平移只影响视口与相关元素：同一帧内合并成一次局部更新。
    coalesce({ viewport: true, interaction: true });
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
    if (state.drag.kind === 'comment' && state.drag.moved && snapshot() !== state.drag.before) {
      state.undo.push(state.drag.before);
      state.redo = [];
      setDirty();
    }
    if (state.drag.kind === 'waypoint' && state.drag.moved && snapshot() !== state.drag.before) {
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

  function captureConnectionPointer(event: PointerEventLike): number | null {
    return deps.pointerCapture ? deps.pointerCapture(event) : null;
  }

  return {
    startNodeDrag, startCommentDrag, startWaypointDrag, onPointerDown, autoPan, onPointerMove, onPointerUp,
    contextMenuSuppressedByPan, captureConnectionPointer,
  };
}
