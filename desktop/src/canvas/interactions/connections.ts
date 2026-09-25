/**
 * 连线生命周期与变量连接命令：开始/取消/完成普通连线，以及变量端点到参数/实例输入的解绑与绑定。
 * 原 `workflow-editor.js` 的 startConnection 系列（capture/release/cancel/finish）、
 * 变量连线的 start 系列（cancel/finish）与 connect/disconnectVariable 系列。
 *
 * 普通连线与变量连线都通过注入的 mutate 修改文档；指针捕获失败时静默降级（合成事件）。
 */
import type { CanvasState } from '../state/canvas-state';
import type { ConditionPort } from '../model/exec-ports';
import { boolJudgeShape, isBoolJudgeBoolPin, isBoolJudgeOperandPin, isBooleanInputPin, isBreakRefPin } from '../model/exec-ports';

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
  connect(parentId: string, childId: string, port?: number | ConditionPort): boolean;
  disconnect(parentId: string, childId: string): void;
  /** 反向拖线（从子节点输入口往上）落点该接在父节点的哪个执行口上。 */
  execPortAt?(point: { x: number; y: number }, parentId: string): ConditionPort | null;
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
  /** 源节点的输出候选（拆分卡片的字段引脚按候选直接定向绑定，不再弹菜单）。 */
  nodeOutputFields?(node: any): Array<{ field: string; label: string; ref: string }>;
  /** 目标参数的显示名（落点菜单与提示用）。 */
  fieldLabel(name: string): string;
  /** 输出引用落到目标端点时的类型兼容字段；condition 端口也复用这层校验。 */
  referenceFieldsForPin?(sourceNode: any, targetNode: any, param: string): Array<{ ref?: string; schema?: any }>;
  /** 一个输出有多个字段可绑目标参数时，用菜单让用户挑。 */
  showMenu?(x: number, y: number, items: any[]): void;
  /** 引用显示名（`nodes.<id>.output.0` → `节点名[0]`），用于落点提示。 */
  referenceDisplayNameOf?(ref: string): string;
  /** 变量线落在空白画布时交给宿主创建合适的端点/变量卡；返回 true 表示已处理。 */
  onEmptyVariableDrop?(connection: any, point: ConnectionPoint): boolean;
}

export interface CanvasConnections {
  startConnection(event: PointerLike | null, parentId: string, at?: ConnectionPoint, port?: ConditionPort): void;
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
  startReferenceConnection(event: PointerLike | null, nodeId: string, at?: ConnectionPoint, field?: string): void;
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
    nodeOutputFields, onEmptyVariableDrop,
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

  function startConnection(event: PointerLike | null, parentId: string, at?: ConnectionPoint, port?: ConditionPort): void {
    if (event && event.button !== 0) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const point = at || (event ? worldPoint(event as PointerLike & { clientX: number; clientY: number }) : { x: 0, y: 0 });
    state.connect = {
      direction: 'from-output', parent: parentId, x: point.x, y: point.y, hover: null,
      pointerId: event ? captureConnectionPointer(event) : null,
      // 判断节点：记住从哪个口（真/假）拖出来的，落点才知道接哪一支。
      ...(port ? { slot: port } : {}),
    };
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
        // 反向拖线：判断节点要看落点离哪个口更近（真口/假口），普通节点没有口位。
        const slot = deps.execPortAt?.(worldPoint(event as PointerLike & { clientX: number; clientY: number }), childId) || undefined;
        connect(childId, connection.child, slot);
        return;
      }
      const slot = connection.slot ?? connection.oldIndex;
      if (connection.oldChild) disconnect(connection.parent, connection.oldChild);
      if (!connect(connection.parent, childId, slot) && connection.oldChild) connect(connection.parent, connection.oldChild, slot);
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
    if (!target) {
      const point = worldPoint(event as PointerLike & { clientX: number; clientY: number });
      if (!onEmptyVariableDrop?.(connection, point)) render();
      return;
    }
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
      if (isBooleanInputPin(node, param) || isBoolJudgeBoolPin(node, param)) {
        // 判断节点与布尔判断卡的布尔口：整卡/整节点就是一个 bool 绑定。
        node.expression = { ref: `${scope}.${variable}` };
      } else if (isBoolJudgeOperandPin(node, param)) {
        // 只有比较形态才有操作数引脚；嵌套/绑定形态的卡片没有可写的操作数（防住过期拖拽）。
        if (boolJudgeShape(node) !== 'comparison') return;
        const expression = node.expression && typeof node.expression === 'object' && !Array.isArray(node.expression) ? node.expression : { eq: ['', ''] };
        const operator = Object.keys(expression)[0] || 'eq';
        const operands = Array.isArray(expression[operator]) && expression[operator].length === 2 ? expression[operator].slice() : ['', ''];
        operands[param === 'left' ? 0 : 1] = { ref: `${scope}.${variable}` };
        node.expression = { [operator]: operands };
      } else if (isBreakRefPin(node, param)) {
        // 拆分卡片的来源绑定写在顶层 ref 字段上。
        node.ref = { ref: `${scope}.${variable}` };
      } else if (param.startsWith('inputs.')) {
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
    if (!node) return;

    // bool_judge 的变量分别写在比较表达式的两个 operand 中，不能像普通参数一样
    // 直接读取整个 expression；否则永远看不到当前一侧的 `{ ref: ... }`，断开会被提前返回。
    if (isBoolJudgeOperandPin(node, param)) {
      const expression = node.expression && typeof node.expression === 'object' && !Array.isArray(node.expression) ? node.expression : { eq: ['', ''] };
      const operator = Object.keys(expression)[0] || 'eq';
      const operands = Array.isArray(expression[operator]) && expression[operator].length === 2 ? expression[operator].slice() : ['', ''];
      const index = param === 'left' ? 0 : 1;
      const current = operands[index];
      if (!current || typeof current !== 'object' || Array.isArray(current) || typeof current.ref !== 'string') return;
      mutate(() => {
        operands[index] = '';
        node.expression = { [operator]: operands };
        delete variableLinks()[`${nodeId}:${param}`];
      });
      toast(`已断开参数 ${param}`);
      return;
    }

    const current = isBooleanInputPin(node, param) || isBoolJudgeBoolPin(node, param)
      ? node.expression
      : isBreakRefPin(node, param)
        ? node.ref
        : (!node.params || typeof node.params !== 'object' ? undefined : param.startsWith('inputs.') ? node.params.inputs?.[param.slice('inputs.'.length)] : node.params[param]);
    if (!current || typeof current !== 'object' || Array.isArray(current) || typeof current.ref !== 'string') return;
    mutate(() => {
      if (isBooleanInputPin(node, param) || isBoolJudgeBoolPin(node, param)) {
        node.expression = { eq: [1, 1] };
      } else if (isBreakRefPin(node, param)) {
        delete node.ref;
      } else if (param.startsWith('inputs.')) {
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

  /**
   * 从任务卡右侧的输出口开始拖拽：目标只能是别的节点的参数端点。
   * 拆分卡片的字段引脚带 `field` 起拖：字段已定，落点直接绑这一个引用，不再弹菜单。
   */
  function startReferenceConnection(event: PointerLike | null, nodeId: string, at?: ConnectionPoint, field?: string): void {
    if (event && event.button !== 0) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const point = at || (event ? worldPoint(event as PointerLike & { clientX: number; clientY: number }) : { x: 0, y: 0 });
    state.referenceConnect = { nodeId, x: point.x, y: point.y, hover: null, pointerId: event ? captureConnectionPointer(event) : null, field: field === undefined ? null : field };
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
    // 判断节点/布尔判断卡片的左侧端口是严格 boolean 输入。节点输出引用在落点阶段已做
    // 类型筛选，但这里再拦一次，避免菜单/旧调用方绕过命中测试写入错误类型。
    if (isBooleanInputPin(node, param) || isBoolJudgeBoolPin(node, param)) {
      const source = nodeById(sourceNodeId);
      const fields = source && deps.referenceFieldsForPin
        ? deps.referenceFieldsForPin(source, node, param)
        : [];
      if (!fields.some((field) => field && field.ref === ref)) {
        toast('布尔条件端口只接受 boolean 输出', true);
        return;
      }
    }
    mutate(() => {
      if (isBooleanInputPin(node, param) || isBoolJudgeBoolPin(node, param)) {
        node.expression = { ref };
      } else if (isBoolJudgeOperandPin(node, param)) {
        // 只有比较形态才有操作数引脚；嵌套/绑定形态的卡片没有可写的操作数（防住过期拖拽）。
        if (boolJudgeShape(node) !== 'comparison') return;
        const expression = node.expression && typeof node.expression === 'object' && !Array.isArray(node.expression) ? node.expression : { eq: ['', ''] };
        const operator = Object.keys(expression)[0] || 'eq';
        const operands = Array.isArray(expression[operator]) && expression[operator].length === 2 ? expression[operator].slice() : ['', ''];
        operands[param === 'left' ? 0 : 1] = { ref };
        node.expression = { [operator]: operands };
      } else if (isBreakRefPin(node, param)) {
        // 拆分卡片的来源绑定写在顶层 ref 字段上。
        node.ref = { ref };
      } else if (param.startsWith('inputs.')) {
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
    if (!node) return;
    // 表达式输入端口的引用写在 `expression` 上。
    if (isBooleanInputPin(node, param) || isBoolJudgeBoolPin(node, param)) {
      if (!isReferenceValue(node.expression)) return;
      mutate(() => {
        node.expression = { eq: [1, 1] };
        delete variableLinks()[`${nodeId}:${param}`];
      });
      toast(`已断开 ${fieldLabel(param)} 的引用`);
      return;
    }
    if (isBreakRefPin(node, param)) {
      // 拆分卡片的来源绑定写在顶层 ref 字段上。
      if (!isReferenceValue(node.ref)) return;
      mutate(() => {
        delete node.ref;
        delete variableLinks()[`${nodeId}:${param}`];
      });
      toast(`已断开 ${fieldLabel(param)} 的引用`);
      return;
    }
    if (isBoolJudgeOperandPin(node, param)) {
      const expression = node.expression && typeof node.expression === 'object' && !Array.isArray(node.expression) ? node.expression : { eq: ['', ''] };
      const operator = Object.keys(expression)[0] || 'eq';
      const operands = Array.isArray(expression[operator]) && expression[operator].length === 2 ? expression[operator].slice() : ['', ''];
      const index = param === 'left' ? 0 : 1;
      if (!isReferenceValue(operands[index])) return;
      mutate(() => {
        operands[index] = '';
        node.expression = { [operator]: operands };
        delete variableLinks()[`${nodeId}:${param}`];
      });
      toast(`已断开 ${fieldLabel(param)} 的引用`);
      return;
    }
    if (!node.params || typeof node.params !== 'object') return;
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
    if (connection.field !== null && connection.field !== undefined) {
      // 拆分卡片的字段引脚起拖（`field: ''` 表示「整体输出」那个引脚）：
      // 绑哪个引用已经定了，直接写目标行。
      const source = nodeById(connection.nodeId);
      const candidate = source && nodeOutputFields
        ? (nodeOutputFields(source) || []).find((item) => item && item.field === connection.field)
        : null;
      if (candidate) {
        const sourceName = source ? (source.name || source.id) : connection.nodeId;
        connectReferenceToPin(connection.nodeId, candidate.ref, candidate.field ? `${sourceName}.${candidate.field}` : sourceName, target.nodeId, target.param);
        return;
      }
    }
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
