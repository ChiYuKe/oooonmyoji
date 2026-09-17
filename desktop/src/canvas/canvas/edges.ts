/**
 * 画布连线渲染：父子连线、实例运行连线、拖拽预览与变量连线。
 * 原 `workflow-editor.js` 的 renderEdge/renderInstanceRunEdge/renderConnection/
 * renderVariableEdges/renderVariableConnection/bindVariableEdgeQuickDisconnect。
 *
 * 渲染函数不修改文档；选择与断开都通过注入的命令/回调完成。
 */
import type { CanvasState } from '../state/canvas-state';

export interface EdgePoint {
  x: number;
  y: number;
}

export interface EdgeNode {
  id: string;
  type?: string;
  children?: string[];
  [key: string]: any;
}

export interface EdgeRunCard {
  node: EdgeNode;
  index: number;
  key?: string;
  x: number;
  y: number;
  height?: number;
  variables: Array<{ name: string }>;
  run?: { inputs?: Record<string, unknown> };
}

export interface EdgeVariableCard {
  id: string;
  name: string;
  scope: 'inputs' | 'variables';
  x: number;
  y: number;
}

export interface EdgesDeps {
  state: CanvasState;
  svgEl(tag: string, attrs: Record<string, any>, parent: any): any;
  bezier(x1: number, y1: number, x2: number, y2: number): string;
  nodes(): EdgeNode[];
  nodeById(id: string): EdgeNode | null;
  position(node: EdgeNode): EdgePoint;
  nodeHeight(node: EdgeNode): number;
  instanceRunCards(): EdgeRunCard[];
  instanceRunInputPosition(card: EdgeRunCard, index: number): EdgePoint;
  variableCardList(): EdgeVariableCard[];
  nodeVariablePins(node: EdgeNode): Array<{ param: string; variable: string; scope: 'inputs' | 'variables' }>;
  variablePinPosition(node: EdgeNode, index: number): EdgePoint;
  disconnect(parentId: string, childId: string): void;
  disconnectVariableFromPin(nodeId: string, param: string): void;
  disconnectVariableFromInstanceInput(nodeId: string, runIndex: number, param: string): void;
  mutate(fn: () => void): void;
  requestInspector(selection?: unknown): void;
  render(): void;
  worldPoint(event: { clientX: number; clientY: number }): EdgePoint;
  captureConnectionPointer(event: PointerEvent): number | null;
  nodeWidth: number;
  runCardWidth: number;
  baseHeight: number;
  runVariableHeight: number;
  variableCardWidth: number;
  variableCardPortY: number;
  variablePinX: number;
}

export interface CanvasEdges {
  bindVariableEdgeQuickDisconnect(edge: any, disconnect: () => void): void;
  renderVariableEdges(layer: any): void;
  renderEdge(layer: any, parent: EdgeNode, childId: string, order: number): void;
  renderInstanceRunEdge(layer: any, card: EdgeRunCard): void;
  renderConnection(layer: any): void;
  renderVariableConnection(layer: any): void;
}

const RUN_STATUSES = ['running', 'succeeded', 'matched', 'failed', 'not_matched', 'branch_miss', 'cancelled'];

export function createCanvasEdges(deps: EdgesDeps): CanvasEdges {
  const {
    state, svgEl, bezier, nodes, nodeById, position, nodeHeight, instanceRunCards, instanceRunInputPosition,
    variableCardList, nodeVariablePins, variablePinPosition, disconnect,
    disconnectVariableFromPin, disconnectVariableFromInstanceInput, mutate, requestInspector, render,
    worldPoint, captureConnectionPointer, nodeWidth, runCardWidth, baseHeight, runVariableHeight,
    variableCardWidth, variableCardPortY, variablePinX,
  } = deps;

  function bindVariableEdgeQuickDisconnect(edge: any, disconnectEdge: () => void): void {
    edge.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      disconnectEdge();
    });
  }

  function renderVariableEdges(layer: any): void {
    const cards = new Map(variableCardList().map((card) => [card.id, card]));
    const byReference = new Map<string, EdgeVariableCard>();
    for (const card of variableCardList()) {
      const ref = `${card.scope}.${card.name}`;
      if (!byReference.has(ref)) byReference.set(ref, card);
    }
    const links = state.raw && state.raw._variableLinks && typeof state.raw._variableLinks === 'object' ? state.raw._variableLinks as Record<string, string> : {};
    for (const node of nodes()) {
      const pos = position(node);
      nodeVariablePins(node).forEach((pin, index) => {
        if (!pin.variable) return;
        const card = cards.get(links[`${node.id}:${pin.param}`]) || byReference.get(`${pin.scope}.${pin.variable}`);
        if (!card) return;
        const x1 = card.x + variableCardWidth;
        const y1 = card.y + variableCardPortY;
        const x2 = pos.x + variablePinX;
        const y2 = pos.y + baseHeight + index * runVariableHeight + runVariableHeight / 2;
        const bend = Math.max(32, Math.abs(x2 - x1) * 0.42);
        const edge = svgEl('path', { class: 'variable-edge', d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` }, layer);
        bindVariableEdgeQuickDisconnect(edge, () => disconnectVariableFromPin(node.id, pin.param));
      });
    }
    for (const runCard of instanceRunCards()) {
      const inputs = runCard.run && runCard.run.inputs && typeof runCard.run.inputs === 'object' && !Array.isArray(runCard.run.inputs)
        ? runCard.run.inputs
        : {};
      runCard.variables.forEach((variable, index) => {
        const value = inputs[variable.name];
        const ref = value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { ref?: unknown }).ref === 'string' ? (value as { ref: string }).ref : '';
        const match = /^(inputs|variables)\.([^\.]+)/.exec(ref);
        if (!match) return;
        const card = cards.get(links[`${runCard.node.id}:runs.${runCard.index}.inputs.${variable.name}`])
          || byReference.get(`${match[1]}.${match[2]}`);
        if (!card) return;
        const x1 = card.x + variableCardWidth;
        const y1 = card.y + variableCardPortY;
        const target = instanceRunInputPosition(runCard, index);
        const bend = Math.max(32, Math.abs(target.x - x1) * 0.42);
        const edge = svgEl('path', { class: 'variable-edge', d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}` }, layer);
        bindVariableEdgeQuickDisconnect(edge, () => disconnectVariableFromInstanceInput(runCard.node.id, runCard.index, variable.name));
      });
    }
  }

  function renderEdge(layer: any, parent: EdgeNode, childId: string, order: number): void {
    const child = nodeById(childId);
    if (!child) return;
    const from = position(parent);
    const to = position(child);
    const x1 = from.x + nodeWidth / 2;
    const y1 = from.y + nodeHeight(parent);
    const x2 = to.x + nodeWidth / 2;
    const y2 = to.y;
    const selected = state.selectedEdge && state.selectedEdge.parent === parent.id && state.selectedEdge.child === childId;
    const run = state.run.get(childId);
    const runStatus = run && RUN_STATUSES.includes(run.status) ? run.status : '';
    const group = svgEl('g', { class: `edge${selected ? ' selected' : ''}${runStatus ? ` run-${runStatus}` : ''}`, 'data-parent': parent.id, 'data-child': childId }, layer);
    group.dataset.parent = parent.id;
    group.dataset.child = childId;
    const path = svgEl('path', { class: 'edge-hit', d: bezier(x1, y1, x2, y2) }, group);
    const edgePath = bezier(x1, y1, x2, y2);
    svgEl('path', { class: 'edge-line', d: edgePath }, group);
    svgEl('path', { class: 'edge-flow', d: edgePath }, group);
    const midY = (y1 + y2) / 2;
    svgEl('circle', { class: 'edge-order-bg', cx: (x1 + x2) / 2, cy: midY, r: 10 }, group);
    svgEl('text', { class: 'edge-order', x: (x1 + x2) / 2, y: midY + 4, 'text-anchor': 'middle' }, group).textContent = String(order + 1);
    const rewire = svgEl('circle', { class: 'edge-rewire', cx: x2, cy: y2 - 18, r: 6, title: '拖动以重新连接' }, group);
    path.addEventListener('mousedown', (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      state.selected.clear();
      state.selectedEdge = { parent: parent.id, child: childId };
      state.selectedRun = null;
      state.inspector = 'node';
      requestInspector({ kind: 'edge', parent: parent.id, child: childId });
      render();
    });
    group.addEventListener('dblclick', (event: MouseEvent) => {
      event.stopPropagation();
      mutate(() => disconnect(parent.id, childId));
    });
    rewire.addEventListener('pointerdown', (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const point = worldPoint(event);
      state.connect = { direction: 'from-output', parent: parent.id, x: point.x, y: point.y, oldChild: childId, oldIndex: order, hover: null, pointerId: captureConnectionPointer(event) };
      render();
    });
  }

  function renderInstanceRunEdge(layer: any, card: EdgeRunCard): void {
    const parent = position(card.node);
    const x1 = parent.x + nodeWidth / 2;
    const y1 = parent.y + nodeHeight(card.node);
    const x2 = card.x + runCardWidth / 2;
    const y2 = card.y;
    const path = bezier(x1, y1, x2, y2);
    const group = svgEl('g', { class: 'instance-run-edge', 'data-run-key': card.key }, layer);
    svgEl('path', { class: 'instance-run-edge-line', d: path }, group);
    const midY = (y1 + y2) / 2;
    svgEl('circle', { class: 'edge-order-bg', cx: (x1 + x2) / 2, cy: midY, r: 10 }, group);
    svgEl('text', { class: 'edge-order', x: (x1 + x2) / 2, y: midY + 4, 'text-anchor': 'middle' }, group).textContent = String(card.index + 1);
  }

  function renderConnection(layer: any): void {
    const connect = state.connect;
    if (!connect) return;
    const classes = `connection-preview${connect.hover ? ' snapped' : ''}`;
    if (connect.direction === 'from-input') {
      const child = nodeById(connect.child);
      if (!child) return;
      const pos = position(child);
      svgEl('path', { class: classes, d: bezier(connect.x, connect.y, pos.x + nodeWidth / 2, pos.y) }, layer);
      return;
    }
    const parent = nodeById(connect.parent);
    if (!parent) return;
    const pos = position(parent);
    svgEl('path', { class: classes, d: bezier(pos.x + nodeWidth / 2, pos.y + nodeHeight(parent), connect.x, connect.y) }, layer);
  }

  function renderVariableConnection(layer: any): void {
    const connection = state.variableConnect;
    if (!connection) return;
    let origin: EdgePoint | null = null;
    if (connection.direction === 'from-card') {
      const card = variableCardList().find((item) => item.id === connection.cardId) || variableCardList().find((item) => item.scope === connection.scope && item.name === connection.variable);
      if (card) origin = { x: card.x + variableCardWidth, y: card.y + variableCardPortY };
    } else if (connection.direction === 'from-instance-input') {
      const card = instanceRunCards().find((item) => item.node.id === connection.nodeId && item.index === connection.runIndex);
      const index = card ? card.variables.findIndex((input) => input.name === connection.param) : -1;
      if (card && index >= 0) origin = instanceRunInputPosition(card, index);
    } else {
      const node = nodeById(connection.nodeId);
      const index = node ? nodeVariablePins(node).findIndex((pin) => pin.param === connection.param) : -1;
      if (node && index >= 0) origin = variablePinPosition(node, index);
    }
    if (!origin) return;
    const hover = connection.hover;
    svgEl('path', {
      class: `variable-connection-preview${hover ? ' snapped' : ''}`,
      d: bezier(origin.x, origin.y, hover ? hover.x : connection.x, hover ? hover.y : connection.y),
    }, layer);
  }

  return { bindVariableEdgeQuickDisconnect, renderVariableEdges, renderEdge, renderInstanceRunEdge, renderConnection, renderVariableConnection };
}
