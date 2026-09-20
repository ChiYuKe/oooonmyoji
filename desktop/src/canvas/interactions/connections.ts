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
  /** 变量卡片列表：没带卡片 id 的绑定入口（参数行菜单等）用它补上连线项。 */
  variableCardList?(): Array<{ id: string; name: string; scope: string }>;
  variableCompatibleWithPin(scope: string, variableName: string, node: any, param: string): boolean;
  variableCompatibleWithInstanceInput(scope: string, variableName: string, card: any, input: any): boolean;
  variableLinks(): Record<string, string>;
  displayNameOfDefinition(definition: unknown, fallback?: string): string;
  variableDisplayNameOf(scope: 'inputs' | 'variables', name: string, fallback?: string): string;
  toast(message: string, error?: boolean): void;
  /** 节点输出引用拖拽的悬停目标与落点解析。 */
  referenceConnectionTargetAt(event: unknown): any;
  /** 落点被拒绝时光标下的那一行（解释类型不兼容）。 */
  referenceMissAt(point: unknown, sourceNodeId: string): any;
  /** 目标参数的显示名（落点菜单与提示用）。 */
  fieldLabel(name: string): string;
  /** 一个输出有多个字段可绑目标参数时，用菜单让用户挑。 */
  showMenu?(x: number, y: number, items: any[]): void;
  /** 引用显示名（`nodes.<id>.output.0` → `节点名[0]`），用于落点提示。 */
  referenceDisplayNameOf?(ref: string): string;
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
  /** 从任务卡输出口开始拖拽：把该节点的输出引用绑到别的参数端点上。 */
  startReferenceConnection(event: PointerLike | null, nodeId: string, at?: ConnectionPoint): void;
  cancelReferenceConnection(): void;
  finishReferenceConnection(event: PointerLike): void;
  connectReferenceToPin(sourceNodeId: string, ref: string, label: string, nodeId: string, param: string): void;
  disconnectReferenceFromPin(nodeId: string, param: string): void;
}

export function createCanvasConnections(deps: ConnectionsDeps): CanvasConnections {
  const {
    state, graph, worldPoint, render, snapshot, mutate, connect, disconnect, variableConnectionTargetAt,
    nodeById, instanceRunCards, variableCompatibleWithPin, variableCompatibleWithInstanceInput,
    variableLinks, displayNameOfDefinition, variableDisplayNameOf, toast, variableCardList,
    referenceConnectionTargetAt, referenceMissAt, fieldLabel, showMenu, referenceDisplayNameOf,
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
  /** 变量对应的卡片 id：调用方可能没带（参数行菜单这类入口），按作用域 + 名字找回来。 */
  function variableCardIdOf(scope: string, variable: string, cardId?: string): string {
    if (cardId) return cardId;
    const cards = variableCardList ? variableCardList() : [];
    const card = cards.find((item) => item && item.scope === scope && item.name === variable);
    return card && card.id ? card.id : '';
  }

  function connectVariableToPin(scope: string, variable: string, nodeId: string, param: string, cardId?: string): void {
    const node = nodeById(nodeId);
    if (!node || !state.raw?.[scope] || !Object.prototype.hasOwnProperty.call(state.raw[scope], variable)) return;
    if (!variableCompatibleWithPin(scope, variable, node, param)) {
      toast('变量类型或作用范围与目标不兼容', true);
      return;
    }
    const link = variableCardIdOf(scope, variable, cardId);
    mutate(() => {
      if (param.startsWith('inputs.')) {
        if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
        node.params.inputs[param.slice('inputs.'.length)] = { ref: `${scope}.${variable}` };
      } else {
        node.params[param] = { ref: `${scope}.${variable}` };
        // 子工作流来源改变后，旧工作流的输入键不再可靠；详情面板会按新变量默认值重新列出输入。
        if (node.type === 'task' && node.action === 'workflow.run' && param === 'workflow') node.params.inputs = {};
      }
      // 连线项一律记录（不管从哪个入口绑过来的），否则同一处绑定会出现两种描述。
      if (link) variableLinks()[`${nodeId}:${param}`] = link;
      else delete variableLinks()[`${nodeId}:${param}`];
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
    const link = variableCardIdOf(scope, variable, cardId);
    mutate(() => {
      if (!run.inputs || typeof run.inputs !== 'object' || Array.isArray(run.inputs)) run.inputs = {};
      run.inputs[param] = { ref: `${scope}.${variable}` };
      const key = `${nodeId}:runs.${runIndex}.inputs.${param}`;
      if (link) variableLinks()[key] = link;
      else delete variableLinks()[key];
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

  /* ---------------------------------------------------------------- 节点输出引用 */

  /** 值是否为节点输出引用（`{ref: 'nodes.<id>.output[.<字段>]'}`）。 */
  function isReferenceValue(value: any): boolean {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      && typeof value.ref === 'string' && value.ref.startsWith('nodes.');
  }

  /** 从任务卡右侧的输出口开始拖拽：目标只能是别的节点的参数端点。 */
  function startReferenceConnection(event: PointerLike | null, nodeId: string, at?: ConnectionPoint): void {
    if (event && event.button !== 0) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const point = at || (event ? worldPoint(event as PointerLike & { clientX: number; clientY: number }) : { x: 0, y: 0 });
    state.referenceConnect = { nodeId, x: point.x, y: point.y, hover: null, pointerId: event ? captureConnectionPointer(event) : null };
    state.selectedEdge = null;
    render();
  }

  function cancelReferenceConnection(): void {
    if (!state.referenceConnect) return;
    const pointerId = state.referenceConnect.pointerId;
    state.referenceConnect = null;
    releaseConnectionPointer(pointerId);
    render();
  }

  /** 落点写引用：源节点输出的某个字段挂到目标参数上（只读绑定，运行期取值）。 */
  function connectReferenceToPin(sourceNodeId: string, ref: string, label: string, nodeId: string, param: string): void {
    const node = nodeById(nodeId);
    if (!node || typeof ref !== 'string' || !ref) return;
    mutate(() => {
      if (param.startsWith('inputs.')) {
        if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
        node.params.inputs[param.slice('inputs.'.length)] = { ref };
      } else {
        if (!node.params || typeof node.params !== 'object' || Array.isArray(node.params)) node.params = {};
        node.params[param] = { ref };
      }
      // 引用不是变量链接：清掉可能存在的旧变量卡连线记录。
      delete variableLinks()[`${nodeId}:${param}`];
    });
    toast(`${fieldLabel(param)} ← ${referenceDisplayNameOf ? referenceDisplayNameOf(ref) : label}`);
  }

  /** 断开参数上的节点输出引用（把该参数恢复成未配置）。 */
  function disconnectReferenceFromPin(nodeId: string, param: string): void {
    const node = nodeById(nodeId);
    if (!node || !node.params || typeof node.params !== 'object') return;
    const current = param.startsWith('inputs.') ? node.params.inputs?.[param.slice('inputs.'.length)] : node.params[param];
    if (!isReferenceValue(current)) return;
    mutate(() => {
      if (param.startsWith('inputs.')) {
        if (node.params.inputs && typeof node.params.inputs === 'object') delete node.params.inputs[param.slice('inputs.'.length)];
      } else delete node.params[param];
      delete variableLinks()[`${nodeId}:${param}`];
    });
    toast(`已断开 ${fieldLabel(param)} 的引用`);
  }

  function finishReferenceConnection(event: PointerLike): void {
    if (!state.referenceConnect) return;
    event.preventDefault();
    event.stopPropagation();
    const connection = state.referenceConnect;
    const target = referenceConnectionTargetAt(event) || connection.hover;
    state.referenceConnect = null;
    releaseConnectionPointer(connection.pointerId);
    if (!target) {
      // 落在某一行上却没绑成：说清楚是类型不兼容，而不是悄悄什么都不做。
      const miss = referenceMissAt(worldPoint(event as PointerLike & { clientX: number; clientY: number }), connection.nodeId);
      if (miss) {
        const source = nodeById(connection.nodeId);
        const sourceName = source ? (source.name || source.id) : connection.nodeId;
        toast(`${fieldLabel(miss.param)} 不接受「${sourceName}」的输出类型`, true);
      }
      render();
      return;
    }
    const fields: any[] = Array.isArray(target.fields) ? target.fields : [];
    if (!fields.length) { render(); return; }
    if (fields.length === 1) {
      connectReferenceToPin(connection.nodeId, fields[0].ref, fields[0].label, target.nodeId, target.param);
      return;
    }
    // 一个输出有多个字段都能进这个参数：让用户挑一个。
    const source = nodeById(connection.nodeId);
    const label = source ? (source.name || source.id) : connection.nodeId;
    if (!showMenu) { connectReferenceToPin(connection.nodeId, fields[0].ref, fields[0].label, target.nodeId, target.param); return; }
    const items = fields.map((item) => ({
      label: `${item.label}（${item.ref}）`,
      run: () => connectReferenceToPin(connection.nodeId, item.ref, `${label}.${item.field}`, target.nodeId, target.param),
    }));
    render();
    const at = event as PointerLike & { clientX?: number; clientY?: number };
    showMenu(at.clientX ?? 0, at.clientY ?? 0, items);
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
    startReferenceConnection,
    cancelReferenceConnection,
    finishReferenceConnection,
    connectReferenceToPin,
    disconnectReferenceFromPin,
  };
}
