/**
 * 连线生命周期与变量连接命令：开始/取消/完成普通连线，以及变量端点到参数/实例输入的解绑与绑定。
 * 原 `workflow-editor.js` 的 startConnection 系列（capture/release/cancel/finish）、
 * 变量连线的 start 系列（cancel/finish）与 connect/disconnectVariable 系列。
 *
 * 普通连线与变量连线都通过注入的 mutate 修改文档；指针捕获失败时静默降级（合成事件）。
 */
import type { CanvasState } from '../state/canvas-state';

export interface ConnectionPoint {
  x: number;
  y: number;
}

export interface PointerLike {
  button?: number;
  pointerId?: number;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface ConnectionsDeps {
  state: CanvasState;
  graph: Element;
  worldPoint(event: PointerLike & { clientX: number; clientY: number }): ConnectionPoint;
  render(): void;
  snapshot(): string;
  mutate(fn: () => void): void;
  connect(parentId: string, childId: string, replaceIndex?: number): boolean;
  disconnect(parentId: string, childId: string): void;
  variableConnectionTargetAt(event: unknown): any;
  nodeById(id: string): any;
  instanceRunCards(): any[];
  variableCompatibleWithPin(scope: string, variableName: string, node: any, param: string): boolean;
  variableCompatibleWithInstanceInput(scope: string, variableName: string, card: any, input: any): boolean;
  variableLinks(): Record<string, string>;
  displayNameOfDefinition(definition: unknown, fallback?: string): string;
  variableDisplayNameOf(scope: 'inputs' | 'variables', name: string, fallback?: string): string;
  toast(message: string, error?: boolean): void;
}

export interface CanvasConnections {
  startConnection(event: PointerLike | null, parentId: string, at?: ConnectionPoint): void;
  startConnectionFromInput(event: PointerLike | null, childId: string, at?: ConnectionPoint): void;
  captureConnectionPointer(event: PointerLike): number | null;
  releaseConnectionPointer(pointerId: number | null): void;
  cancelConnection(): void;
  finishConnection(event: PointerLike, childId: string): void;
  startVariableConnectionFromCard(event: PointerLike | null, scope: string, name: string, cardId: string, at?: ConnectionPoint): void;
  startVariableConnectionFromPin(event: PointerLike | null, nodeId: string, param: string, at?: ConnectionPoint): void;
  startVariableConnectionFromInstanceInput(event: PointerLike | null, nodeId: string, runIndex: number, param: string, at?: ConnectionPoint): void;
  cancelVariableConnection(): void;
  finishVariableConnection(event: PointerLike): void;
  connectVariableToPin(scope: string, variable: string, nodeId: string, param: string, cardId?: string): void;
  disconnectVariableFromPin(nodeId: string, param: string): void;
  connectVariableToInstanceInput(scope: string, variable: string, nodeId: string, runIndex: number, param: string, cardId?: string): void;
  disconnectVariableFromInstanceInput(nodeId: string, runIndex: number, param: string): void;
}

export function createCanvasConnections(deps: ConnectionsDeps): CanvasConnections {
  const {
    state, graph, worldPoint, render, snapshot, mutate, connect, disconnect, variableConnectionTargetAt,
    nodeById, instanceRunCards, variableCompatibleWithPin, variableCompatibleWithInstanceInput,
    variableLinks, displayNameOfDefinition, variableDisplayNameOf, toast,
  } = deps;

  function captureConnectionPointer(event: PointerLike): number | null {
    if (!Number.isInteger(event.pointerId)) return null;
    try { (graph as Element & { setPointerCapture(id: number): void }).setPointerCapture(event.pointerId!); } catch { /* Synthetic tests may not own an active pointer. */ }
    return event.pointerId!;
  }

  function releaseConnectionPointer(pointerId: number | null): void {
    if (!Number.isInteger(pointerId)) return;
    try { (graph as Element & { releasePointerCapture(id: number): void }).releasePointerCapture(pointerId!); } catch { /* Capture may already be released. */ }
  }

  function startConnection(event: PointerLike | null, parentId: string, at?: ConnectionPoint): void {
    if (event && event.button !== 0) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const point = at || (event ? worldPoint(event as PointerLike & { clientX: number; clientY: number }) : { x: 0, y: 0 });
    state.connect = { direction: 'from-output', parent: parentId, x: point.x, y: point.y, hover: null, pointerId: event ? captureConnectionPointer(event) : null };
    state.selectedEdge = null;
    render();
  }

  function startConnectionFromInput(event: PointerLike | null, childId: string, at?: ConnectionPoint): void {
    if (event && event.button !== 0) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const point = at || (event ? worldPoint(event as PointerLike & { clientX: number; clientY: number }) : { x: 0, y: 0 });
    state.connect = { direction: 'from-input', child: childId, x: point.x, y: point.y, hover: null, pointerId: event ? captureConnectionPointer(event) : null };
    state.selectedEdge = null;
    render();
  }

  function cancelConnection(): void {
    if (!state.connect) return;
    const pointerId = state.connect.pointerId;
    state.connect = null;
    releaseConnectionPointer(pointerId);
    render();
  }

  function finishConnection(event: PointerLike, childId: string): void {
    if (!state.connect) return;
    event.preventDefault();
    event.stopPropagation();
    const connection = state.connect;
    state.connect = null;
    releaseConnectionPointer(connection.pointerId);
    const before = snapshot();
    mutate(() => {
      if (connection.direction === 'from-input') {
        connect(childId, connection.child);
        return;
      }
      if (connection.oldChild) disconnect(connection.parent, connection.oldChild);
      if (!connect(connection.parent, childId, connection.oldIndex) && connection.oldChild) connect(connection.parent, connection.oldChild, connection.oldIndex);
    });
    if (snapshot() === before) render();
  }

  function startVariableConnectionFromCard(event: PointerLike | null, scope: string, name: string, cardId: string, at?: ConnectionPoint): void {
    if (event && event.button !== 0) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const point = at || (event ? worldPoint(event as PointerLike & { clientX: number; clientY: number }) : { x: 0, y: 0 });
    state.variableConnect = { direction: 'from-card', scope, variable: name, cardId, x: point.x, y: point.y, hover: null, pointerId: event ? captureConnectionPointer(event) : null };
    state.selectedEdge = null;
    render();
  }

  function startVariableConnectionFromPin(event: PointerLike | null, nodeId: string, param: string, at?: ConnectionPoint): void {
    if (event && event.button !== 0) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const point = at || (event ? worldPoint(event as PointerLike & { clientX: number; clientY: number }) : { x: 0, y: 0 });
    state.variableConnect = { direction: 'from-pin', nodeId, param, x: point.x, y: point.y, hover: null, pointerId: event ? captureConnectionPointer(event) : null };
    state.selectedEdge = null;
    render();
  }

  function startVariableConnectionFromInstanceInput(event: PointerLike | null, nodeId: string, runIndex: number, param: string, at?: ConnectionPoint): void {
    if (event && event.button !== 0) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const point = at || (event ? worldPoint(event as PointerLike & { clientX: number; clientY: number }) : { x: 0, y: 0 });
    state.variableConnect = { direction: 'from-instance-input', nodeId, runIndex, param, x: point.x, y: point.y, hover: null, pointerId: event ? captureConnectionPointer(event) : null };
    state.selectedEdge = null;
    render();
  }

  function cancelVariableConnection(): void {
    if (!state.variableConnect) return;
    const pointerId = state.variableConnect.pointerId;
    state.variableConnect = null;
    releaseConnectionPointer(pointerId);
    render();
  }

  function finishVariableConnection(event: PointerLike): void {
    if (!state.variableConnect) return;
    event.preventDefault();
    event.stopPropagation();
    const connection = state.variableConnect;
    const target = variableConnectionTargetAt(event) || connection.hover;
    state.variableConnect = null;
    releaseConnectionPointer(connection.pointerId);
    if (!target) { render(); return; }
    if (connection.direction === 'from-card') {
      if (target.kind === 'instance-input') connectVariableToInstanceInput(connection.scope, connection.variable, target.nodeId, target.runIndex, target.param, connection.cardId);
      else connectVariableToPin(connection.scope, connection.variable, target.nodeId, target.param, connection.cardId);
    } else if (connection.direction === 'from-instance-input') {
      connectVariableToInstanceInput(target.scope, target.card, connection.nodeId, connection.runIndex, connection.param, target.cardId);
    } else connectVariableToPin(target.scope, target.card, connection.nodeId, connection.param, target.cardId);
  }

  /** 用变量绑定节点参数端点（等价于把该参数接到对应变量）。 */
  function connectVariableToPin(scope: string, variable: string, nodeId: string, param: string, cardId?: string): void {
    const node = nodeById(nodeId);
    if (!node || !state.raw?.[scope] || !Object.prototype.hasOwnProperty.call(state.raw[scope], variable)) return;
    if (!variableCompatibleWithPin(scope, variable, node, param)) {
      toast('变量类型或作用范围与目标不兼容', true);
      return;
    }
    mutate(() => {
      if (param.startsWith('inputs.')) {
        if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
        node.params.inputs[param.slice('inputs.'.length)] = { ref: `${scope}.${variable}` };
      } else node.params[param] = { ref: `${scope}.${variable}` };
      if (cardId) variableLinks()[`${nodeId}:${param}`] = cardId;
    });
    toast(`参数 ${param} ← 变量 ${variable}`);
  }

  function disconnectVariableFromPin(nodeId: string, param: string): void {
    const node = nodeById(nodeId);
    if (!node || !node.params || typeof node.params !== 'object') return;
    const current = param.startsWith('inputs.') ? node.params.inputs?.[param.slice('inputs.'.length)] : node.params[param];
    if (!current || typeof current !== 'object' || Array.isArray(current) || typeof current.ref !== 'string') return;
    mutate(() => {
      if (param.startsWith('inputs.')) {
        if (node.params.inputs && typeof node.params.inputs === 'object') delete node.params.inputs[param.slice('inputs.'.length)];
      } else delete node.params[param];
      delete variableLinks()[`${nodeId}:${param}`];
    });
    toast(`已断开参数 ${param}`);
  }

  function connectVariableToInstanceInput(scope: string, variable: string, nodeId: string, runIndex: number, param: string, cardId?: string): void {
    const node = nodeById(nodeId);
    const run = node && Array.isArray(node.runs) ? node.runs[runIndex] : null;
    const card = instanceRunCards().find((item) => item.node.id === nodeId && item.index === runIndex);
    const input = card && card.variables.find((item: any) => item.name === param);
    if (!run || !input || !state.raw?.[scope] || !Object.prototype.hasOwnProperty.call(state.raw[scope], variable)) return;
    if (!variableCompatibleWithInstanceInput(scope, variable, card, input)) {
      toast('变量类型或作用范围与目标不兼容', true);
      return;
    }
    mutate(() => {
      if (!run.inputs || typeof run.inputs !== 'object' || Array.isArray(run.inputs)) run.inputs = {};
      run.inputs[param] = { ref: `${scope}.${variable}` };
      if (cardId) variableLinks()[`${nodeId}:runs.${runIndex}.inputs.${param}`] = cardId;
    });
    toast(`实例输入 ${displayNameOfDefinition(input.definition, param)} ← 变量 ${variableDisplayNameOf(scope as 'inputs' | 'variables', variable)}`);
  }

  function disconnectVariableFromInstanceInput(nodeId: string, runIndex: number, param: string): void {
    const node = nodeById(nodeId);
    const run = node && Array.isArray(node.runs) ? node.runs[runIndex] : null;
    const current = run && run.inputs && typeof run.inputs === 'object' ? run.inputs[param] : null;
    if (!run || !current || typeof current !== 'object' || Array.isArray(current) || typeof current.ref !== 'string') return;
    mutate(() => {
      delete run.inputs[param];
      delete variableLinks()[`${nodeId}:runs.${runIndex}.inputs.${param}`];
    });
    toast(`已断开实例输入 ${param}`);
  }

  return {
    startConnection,
    startConnectionFromInput,
    captureConnectionPointer,
    releaseConnectionPointer,
    cancelConnection,
    finishConnection,
    startVariableConnectionFromCard,
    startVariableConnectionFromPin,
    startVariableConnectionFromInstanceInput,
    cancelVariableConnection,
    finishVariableConnection,
    connectVariableToPin,
    disconnectVariableFromPin,
    connectVariableToInstanceInput,
    disconnectVariableFromInstanceInput,
  };
}
