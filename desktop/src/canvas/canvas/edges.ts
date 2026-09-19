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
  /** 每个节点自己的参数行高（固定卡片用双行行样式）。 */
  nodeRowHeight?(node: EdgeNode): number;
  instanceRunCards(): EdgeRunCard[];
  instanceRunInputPosition(card: EdgeRunCard, index: number): EdgePoint;
  variableCardList(): EdgeVariableCard[];
  nodeVariablePins(node: EdgeNode): Array<{ param: string; variable: string; scope: 'inputs' | 'variables'; value?: unknown }>;
  variablePinPosition(node: EdgeNode, index: number): EdgePoint;
  disconnect(parentId: string, childId: string): void;
  disconnectVariableFromPin(nodeId: string, param: string): void;
  disconnectVariableFromInstanceInput(nodeId: string, runIndex: number, param: string): void;
  /** 断开参数上的节点输出引用（引用边 Alt 点击）。 */
  disconnectReferenceFromPin(nodeId: string, param: string): void;
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
  /** 任务卡右侧输出口在节点内的 Y 偏移（表头中线）。 */
  taskOutputPortY: number;
}

export interface CanvasEdges {
  bindVariableEdgeQuickDisconnect(edge: any, disconnect: () => void): void;
  renderVariableEdges(layer: any): void;
  renderEdge(layer: any, parent: EdgeNode, childId: string, order: number): void;
  renderInstanceRunEdge(layer: any, card: EdgeRunCard): void;
  renderConnection(layer: any): void;
  renderVariableConnection(layer: any): void;
  renderReferenceConnection(layer: any): void;
  renderReferenceEdges(layer: any): void;
  referencePortPosition(node: any): EdgePoint;
}

const RUN_STATUSES = ['running', 'succeeded', 'matched', 'failed', 'not_matched', 'branch_miss', 'cancelled'];

/** 引用边色调数量（配色见 workflow-editor.css 的 `.reference-edge.tone-N`）。 */
export const REFERENCE_EDGE_TONES = 10;

/** 引用文本 `nodes.<节点>.output[.<字段>]` 里的字段部分；整体输出时记作 output。 */
export function referenceEdgeField(ref: string): string {
  return ref.replace(/^nodes\.[^\.]+\.output\.?/, '') || 'output';
}

/**
 * 引用边的色调下标：按源输出字段取色，于是**不同变量拉出来的线颜色不同**，
 * 同一个变量在所有卡片之间的连线颜色一致（同一字段恒等）。
 */
export function referenceEdgeTone(field: string): number {
  let hash = 0;
  for (let index = 0; index < field.length; index += 1) hash = (hash * 31 + field.charCodeAt(index)) >>> 0;
  return hash % REFERENCE_EDGE_TONES;
}

export function createCanvasEdges(deps: EdgesDeps): CanvasEdges {
  const {
    state, svgEl, bezier, nodes, nodeById, position, nodeHeight, instanceRunCards, instanceRunInputPosition,
    variableCardList, nodeVariablePins, variablePinPosition, disconnect,
    disconnectVariableFromPin, disconnectVariableFromInstanceInput, mutate, requestInspector, render,
    worldPoint, captureConnectionPointer, nodeWidth, runCardWidth, baseHeight, runVariableHeight,
    variableCardWidth, variableCardPortY, variablePinX, taskOutputPortY,
    disconnectReferenceFromPin,
  } = deps;
  const rowHeightOf = deps.nodeRowHeight ?? (() => runVariableHeight);

  /**
   * Alt + 左键点线即断开。按下只记起点，抬起时位移仍在阈值内才算「点击」：
   * 命中范围比线宽大得多，Alt + 拖拽平移常常从线附近开始，不能因此误删连线。
   */
  function bindVariableEdgeQuickDisconnect(edge: any, disconnectEdge: () => void): void {
    let origin: { x: number; y: number } | null = null;
    edge.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || !event.altKey) return;
      origin = { x: event.clientX, y: event.clientY };
    });
    edge.addEventListener('pointerup', (event: PointerEvent) => {
      const start = origin;
      origin = null;
      if (!start || event.button !== 0 || !event.altKey) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return; // 拖拽（平移）不算点击
      event.preventDefault();
      event.stopPropagation();
      disconnectEdge();
    });
    edge.addEventListener('pointercancel', () => { origin = null; });
  }

  /**
   * 画一条可快速断开的细线：可见线保持细，另叠一条透明的加粗命中线
   * （`.xxx-hit`，屏幕空间恒定宽度，不随缩放/线宽变细），Alt + 左键点在命中线上即断开。
   * 命中线在卡片下层，所以不会挡住卡片与引脚的点击；它排在可见线**前面**，
   * 这样 CSS 能用 `.xxx-hit:hover + .xxx` 把细线点亮，给出「可以点」的反馈。
   */
  function renderDisconnectableEdge(layer: any, className: string, hitClassName: string, d: string, disconnectEdge: () => void): void {
    bindVariableEdgeQuickDisconnect(svgEl('path', { class: hitClassName, d }, layer), disconnectEdge);
    svgEl('path', { class: className, d }, layer);
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
        const rowHeight = rowHeightOf(node);
        const y2 = pos.y + baseHeight + index * rowHeight + rowHeight / 2;
        const bend = Math.max(32, Math.abs(x2 - x1) * 0.42);
        renderDisconnectableEdge(layer, 'variable-edge', 'variable-edge-hit', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
          () => disconnectVariableFromPin(node.id, pin.param));
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
        renderDisconnectableEdge(layer, 'variable-edge', 'variable-edge-hit', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`,
          () => disconnectVariableFromInstanceInput(runCard.node.id, runCard.index, variable.name));
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
      if (event.button !== 0 || event.altKey) return; // Alt 交给下边的快速断开，不当成选中
      event.stopPropagation();
      state.selected.clear();
      state.selectedEdge = { parent: parent.id, child: childId };
      state.selectedRun = null;
      state.inspector = 'node';
      requestInspector({ kind: 'edge', parent: parent.id, child: childId });
      render();
    });
    group.addEventListener('mousedown', (event: MouseEvent) => {
      // Alt + 左键：直接断开这条连线（与变量边/引用边的快速断开一致）。
      // 挂在整个连线组上，点在线条或顺序徽标上都生效，同时拦住画布的 Alt 平移。
      if (event.button !== 0 || !event.altKey) return;
      if ((event.target as Element | null)?.closest?.('.edge-rewire')) return; // 拖拽重连优先
      event.preventDefault();
      event.stopPropagation();
      if (state.selectedEdge && state.selectedEdge.parent === parent.id && state.selectedEdge.child === childId) state.selectedEdge = null;
      mutate(() => disconnect(parent.id, childId));
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

  function renderReferenceConnection(layer: any): void {
    const connection = state.referenceConnect;
    if (!connection) return;
    const source = nodeById(connection.nodeId);
    if (!source) return;
    const origin = referencePortPosition(source);
    const hover = connection.hover;
    svgEl('path', {
      class: `reference-connection-preview${hover ? ' snapped' : ''}`,
      d: bezier(origin.x, origin.y, hover ? hover.x : connection.x, hover ? hover.y : connection.y),
    }, layer);
  }

  /** 任务卡右侧输出口的世界坐标。 */
  function referencePortPosition(node: any): EdgePoint {
    const pos = position(node);
    return { x: pos.x + nodeWidth, y: pos.y + taskOutputPortY };
  }

  /**
   * 节点输出引用边：从源任务的输出口连到目标参数端点（实线、比执行连线细；
   * 颜色按源输出字段取，不同变量拉出来的线颜色不同）。引用文本本身带着源节点
   * 与字段，所以不需要额外的连线记录。
   */
  function renderReferenceEdges(layer: any): void {
    for (const node of nodes()) {
      if (!node || node.type !== 'task') continue;
      const pos = position(node);
      const rowHeight = rowHeightOf(node);
      nodeVariablePins(node).forEach((pin, index) => {
        const ref = pin.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof (pin.value as { ref?: unknown }).ref === 'string'
          ? (pin.value as { ref: string }).ref
          : '';
        const match = /^nodes\.([^\.]+)\.output/.exec(ref);
        if (!match) return;
        const source = nodeById(match[1]);
        if (!source || source.id === node.id) return;
        const origin = referencePortPosition(source);
        const target = { x: pos.x + variablePinX, y: pos.y + baseHeight + index * rowHeight + rowHeight / 2 };
        const bend = Math.max(36, Math.abs(target.x - origin.x) * 0.42);
        renderDisconnectableEdge(layer, `reference-edge tone-${referenceEdgeTone(referenceEdgeField(ref))}`, 'reference-edge-hit',
          `M ${origin.x} ${origin.y} C ${origin.x + bend} ${origin.y}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`,
          () => disconnectReferenceFromPin(node.id, pin.param));
      });
    }
  }

  return {
    bindVariableEdgeQuickDisconnect, renderVariableEdges, renderEdge, renderInstanceRunEdge, renderConnection,
    renderVariableConnection, renderReferenceConnection, renderReferenceEdges, referencePortPosition,
  };
}
