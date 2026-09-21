/**
 * 连线命中测试：节点端口、变量端点、实例子输入、变量卡片与节点输出引用的就近目标判定。
 * 原 `workflow-editor.js` 的 connectionTargetAt/variablePinTargetAt/instanceRunInputTargetAt/
 * variableInputTargetAt/variableCardTargetAt/variableCardTargetAtInstanceInput/variableConnectionTargetAt。
 *
 * 纯几何 + 类型兼容计算，不修改状态；变量连线与节点输出引用拖拽的悬停目标由这里给出。
 */
import type { CanvasState } from '../state/canvas-state';
import { isGroupBoundaryPin } from '../model/node-groups';

export interface HitPoint {
  x: number;
  y: number;
}

export interface HitTestDeps {
  state: CanvasState;
  worldPoint(event: { clientX: number; clientY: number }): HitPoint;
  nodes(): any[];
  nodeById(id: string): any;
  position(node: any): HitPoint;
  nodeHeight(node: any): number;
  /** 每个节点自己的参数行高（固定卡片用双行行样式）。 */
  nodeRowHeight?(node: any): number;
  nodeVariablePins(node: any): Array<{ param: string; [key: string]: any }>;
  variableCompatibleWithPin(scope: string, variableName: string, node: any, param: string): boolean;
  variableCompatibleWithInstanceInput(scope: string, variableName: string, card: any, input: any): boolean;
  /** 目标参数能接受源节点输出的哪些字段（为空表示不兼容）。 */
  referenceFieldsForPin(sourceNode: any, targetNode: any, param: string): any[];
  instanceRunCards(): any[];
  instanceRunInputPosition(card: any, index: number): HitPoint;
  variableCardList(): any[];
  portRadius: number;
  nodeWidth: number;
  baseHeight: number;
  runVariableHeight: number;
  variablePinX: number;
  runCardWidth: number;
  runCardBaseHeight: number;
  variableCardWidth: number;
  variableCardHeight: number;
  variableCardPortY: number;
}

export interface CanvasHitTest {
  connectionTargetAt(event: { clientX: number; clientY: number } | null | undefined): string | null;
  variablePinTargetAt(point: HitPoint | null | undefined, scope: string, variableName: string): any;
  instanceRunInputTargetAt(point: HitPoint | null | undefined, scope: string, variableName: string): any;
  variableInputTargetAt(point: HitPoint | null | undefined, scope: string, variableName: string): any;
  variableCardTargetAt(point: HitPoint | null | undefined, nodeId: string, param: string): any;
  variableCardTargetAtInstanceInput(point: HitPoint | null | undefined, nodeId: string, runIndex: number, param: string): any;
  variableConnectionTargetAt(event: { clientX: number; clientY: number } | null | undefined): any;
  /** 节点输出引用拖拽：光标附近的兼容参数端点。 */
  referenceTargetAt(point: HitPoint | null | undefined, sourceNodeId: string): any;
  referenceConnectionTargetAt(event: { clientX: number; clientY: number } | null | undefined): any;
  /** 落点被拒绝时光标下的那一行（用于解释为什么不兼容）。 */
  referenceMissAt(point: HitPoint | null | undefined, sourceNodeId: string): any;
}

export function createCanvasHitTest(deps: HitTestDeps): CanvasHitTest {
  const {
    state, worldPoint, nodes, nodeById, position, nodeHeight, nodeVariablePins,
    variableCompatibleWithPin, variableCompatibleWithInstanceInput, instanceRunCards,
    instanceRunInputPosition, variableCardList, portRadius, nodeWidth, baseHeight, runVariableHeight,
    variablePinX, runCardWidth, runCardBaseHeight, variableCardWidth, variableCardHeight, variableCardPortY,
    referenceFieldsForPin,
  } = deps;
  const rowHeightOf = deps.nodeRowHeight ?? (() => runVariableHeight);
  /** 参数行中心的世界坐标 Y（与 editor.nodeHeight 同一套公式）。 */
  function rowCenterY(node: any, index: number): number {
    const height = rowHeightOf(node);
    return position(node).y + baseHeight + index * height + height / 2;
  }

  function connectionTargetAt(event: { clientX: number; clientY: number } | null | undefined): string | null {
    if (!state.connect || !event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const point = worldPoint(event);
    const maxDistance = Math.max(portRadius + 6, 24 / state.zoom);
    let best: string | null = null;
    let bestDistance = maxDistance;
    for (const node of nodes()) {
      const wantsOutput = state.connect.direction === 'from-input';
      if ((wantsOutput && node.type === 'task') || (!wantsOutput && node.type === 'root')) continue;
      if ((wantsOutput && node.id === state.connect.child) || (!wantsOutput && node.id === state.connect.parent)) continue;
      const pos = position(node);
      const x = pos.x + nodeWidth / 2;
      const y = wantsOutput ? pos.y + nodeHeight(node) : pos.y;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= bestDistance) {
        best = node.id;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** 变量连线拖拽中，光标附近类型兼容的节点端点（变量卡片 → 节点）。 */
  function variablePinTargetAt(point: HitPoint | null | undefined, scope: string, variableName: string): any {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const maxDistance = Math.max(portRadius + 8, 32 / state.zoom);
    let best: any = null;
    let bestDistance = maxDistance;
    for (const node of nodes()) {
      const pins = nodeVariablePins(node);
      if (!pins.length) continue;
      const pos = position(node);
      pins.forEach((pin, index) => {
        const targetNode = isGroupBoundaryPin(pin) ? pin._targetNode : (pin.targetNodeId ? nodeById(pin.targetNodeId) : node);
        const targetParam = isGroupBoundaryPin(pin) ? pin.targetParam : pin.param;
        if (!targetNode || !variableCompatibleWithPin(scope, variableName, targetNode, targetParam)) return;
        const x = pos.x + variablePinX;
        const y = rowCenterY(node, index);
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance <= bestDistance) {
          best = { nodeId: targetNode.id, param: targetParam, x, y };
          bestDistance = distance;
        }
      });
    }
    if (best) return best;
    // 落在节点卡片本体上时，自动接到第一个类型兼容的参数端点（不必精确捏住引脚）。
    for (const node of nodes()) {
      const pos = position(node);
      if (point.x < pos.x || point.x > pos.x + nodeWidth || point.y < pos.y || point.y > pos.y + nodeHeight(node)) continue;
      const pins = nodeVariablePins(node);
      const index = pins.findIndex((pin) => {
        const targetNode = isGroupBoundaryPin(pin) ? pin._targetNode : (pin.targetNodeId ? nodeById(pin.targetNodeId) : node);
        return Boolean(targetNode) && variableCompatibleWithPin(scope, variableName, targetNode, isGroupBoundaryPin(pin) ? pin.targetParam : pin.param);
      });
      if (index < 0) continue;
      const pin = pins[index];
      return {
        nodeId: isGroupBoundaryPin(pin) ? pin.targetNodeId : node.id,
        param: isGroupBoundaryPin(pin) ? pin.targetParam : pin.param,
        x: pos.x + variablePinX,
        y: rowCenterY(node, index),
      };
    }
    return null;
  }

  /** 变量连线拖拽中，光标附近的实例子工作流输入端点。 */
  function instanceRunInputTargetAt(point: HitPoint | null | undefined, scope: string, variableName: string): any {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const maxDistance = Math.max(portRadius + 8, 32 / state.zoom);
    let best: any = null;
    let bestDistance = maxDistance;
    for (const card of instanceRunCards()) {
      card.variables.forEach((input: any, index: number) => {
        if (!variableCompatibleWithInstanceInput(scope, variableName, card, input)) return;
        const target = instanceRunInputPosition(card, index);
        const distance = Math.hypot(point.x - target.x, point.y - target.y);
        if (distance <= bestDistance) {
          best = { kind: 'instance-input', nodeId: card.node.id, runIndex: card.index, param: input.name, x: target.x, y: target.y };
          bestDistance = distance;
        }
      });
    }
    if (best) return best;
    // 落在输入行上时也视为连到该输入，避免必须精确捏住小圆点。
    for (const card of instanceRunCards()) {
      const index = card.variables.findIndex((input: any) => variableCompatibleWithInstanceInput(scope, variableName, card, input));
      if (index < 0) continue;
      const top = card.y + runCardBaseHeight + index * runVariableHeight;
      if (point.x < card.x || point.x > card.x + runCardWidth || point.y < top || point.y > top + runVariableHeight) continue;
      const target = instanceRunInputPosition(card, index);
      return { kind: 'instance-input', nodeId: card.node.id, runIndex: card.index, param: card.variables[index].name, x: target.x, y: target.y };
    }
    return null;
  }

  function variableInputTargetAt(point: HitPoint | null | undefined, scope: string, variableName: string): any {
    return variablePinTargetAt(point, scope, variableName) || instanceRunInputTargetAt(point, scope, variableName);
  }

  /** 变量连线拖拽中，光标附近的变量卡片（节点端点 → 变量卡片）。 */
  function variableCardTargetAt(point: HitPoint | null | undefined, nodeId: string, param: string): any {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const node = nodeById(nodeId);
    const maxDistance = Math.max(portRadius + 8, 32 / state.zoom);
    let best: any = null;
    let bestDistance = maxDistance;
    for (const card of variableCardList()) {
      if (!variableCompatibleWithPin(card.scope, card.name, node, param)) continue;
      const x = card.x + variableCardWidth;
      const y = card.y + variableCardPortY;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= bestDistance) {
        best = { card: card.name, scope: card.scope, cardId: card.id, x, y };
        bestDistance = distance;
      }
    }
    if (best) return best;
    // 落在卡片本体上时也视为连到该变量（允许重复连接当前变量，作为成功反馈）。
    for (const card of variableCardList()) {
      if (!variableCompatibleWithPin(card.scope, card.name, node, param)) continue;
      if (point.x >= card.x && point.x <= card.x + variableCardWidth && point.y >= card.y && point.y <= card.y + variableCardHeight) {
        return { card: card.name, scope: card.scope, cardId: card.id, x: card.x + variableCardWidth, y: card.y + variableCardPortY };
      }
    }
    return null;
  }

  /**
   * 节点输出引用拖拽中，光标附近的参数端点：只认能接受该输出的字段的那些端点。
   * 光标落在某张卡片的**某一行**上时，就以那一行为准——不能吸到隔壁行或另一张卡片，
   * 否则行高 24px 时相邻两行的引脚会互相抢吸附（「乱吸附」）。
   * 返回的 `fields` 是全部兼容字段，落点若有多个候选由调用方弹菜单让用户选。
   */
  function referenceTargetAt(point: HitPoint | null | undefined, sourceNodeId: string): any {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const source = nodeById(sourceNodeId);
    if (!source) return null;
    const maxDistance = Math.max(portRadius + 4, 16 / state.zoom);
    let pinBest: any = null;
    let pinDistance = maxDistance;
    let rowBest: any = null;
    let rowDistance = Infinity;
    for (const node of nodes()) {
      if (!node || node.type !== 'task' || node.id === sourceNodeId) continue;
      const pins = nodeVariablePins(node);
      if (!pins.length) continue;
      const pos = position(node);
      const rowHeight = rowHeightOf(node);
      const rowsTop = pos.y + baseHeight;
      const insideRows = point.x >= pos.x && point.x <= pos.x + nodeWidth
        && point.y >= rowsTop && point.y <= rowsTop + pins.length * rowHeight;
      const rowIndex = insideRows
        ? Math.min(pins.length - 1, Math.max(0, Math.floor((point.y - rowsTop) / rowHeight)))
        : -1;
      pins.forEach((pin, index) => {
        const fields = referenceFieldsForPin(source, node, pin.param);
        if (!fields.length) return;
        const x = pos.x + variablePinX;
        const y = rowCenterY(node, index);
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < pinDistance) {
          pinBest = { nodeId: node.id, param: pin.param, x, y, fields };
          pinDistance = distance;
        }
        if (index !== rowIndex) return;
        const centerDistance = Math.abs(point.y - y);
        if (centerDistance < rowDistance) {
          rowBest = { nodeId: node.id, param: pin.param, x, y, fields };
          rowDistance = centerDistance;
        }
      });
    }
    // 落在行上时以行为准；只在卡片外（例如贴着引脚小圆）才用「最近的引脚」。
    return rowBest || pinBest;
  }

  function referenceConnectionTargetAt(event: { clientX: number; clientY: number } | null | undefined): any {
    if (!state.referenceConnect || !event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return referenceTargetAt(worldPoint(event), state.referenceConnect.nodeId);
  }

  /**
   * 落点被拒绝时用来解释原因：光标下那一行（不管是哪个端点、类型是否兼容）。
   * 类型不兼容是正常的（例如数组输出 vs 单个对象），但不该悄无声息。
   */
  function referenceMissAt(point: HitPoint | null | undefined, sourceNodeId: string): any {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    let best: any = null;
    let bestDistance = Infinity;
    for (const node of nodes()) {
      if (!node || node.type !== 'task' || node.id === sourceNodeId) continue;
      const pins = nodeVariablePins(node);
      if (!pins.length) continue;
      const pos = position(node);
      const rowHeight = rowHeightOf(node);
      const rowsTop = pos.y + baseHeight;
      if (point.x < pos.x || point.x > pos.x + nodeWidth) continue;
      if (point.y < rowsTop || point.y > rowsTop + pins.length * rowHeight) continue;
      const index = Math.min(pins.length - 1, Math.max(0, Math.floor((point.y - rowsTop) / rowHeight)));
      const center = Math.abs(point.y - (rowsTop + index * rowHeight + rowHeight / 2));
      if (center < bestDistance) {
        best = { nodeId: node.id, param: pins[index].param, x: pos.x + variablePinX, y: rowCenterY(node, index), fields: [] };
        bestDistance = center;
      }
    }
    return best;
  }

  /** 变量连线拖拽中，光标附近的实例子工作流输入对应的变量卡片。 */
  function variableCardTargetAtInstanceInput(point: HitPoint | null | undefined, nodeId: string, runIndex: number, param: string): any {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const runCard = instanceRunCards().find((card) => card.node.id === nodeId && card.index === runIndex);
    const input = runCard && runCard.variables.find((item: any) => item.name === param);
    if (!runCard || !input) return null;
    const maxDistance = Math.max(portRadius + 8, 32 / state.zoom);
    let best: any = null;
    let bestDistance = maxDistance;
    for (const card of variableCardList()) {
      if (!variableCompatibleWithInstanceInput(card.scope, card.name, runCard, input)) continue;
      const x = card.x + variableCardWidth;
      const y = card.y + variableCardPortY;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= bestDistance) {
        best = { card: card.name, scope: card.scope, cardId: card.id, x, y };
        bestDistance = distance;
      }
    }
    if (best) return best;
    for (const card of variableCardList()) {
      if (!variableCompatibleWithInstanceInput(card.scope, card.name, runCard, input)) continue;
      if (point.x >= card.x && point.x <= card.x + variableCardWidth && point.y >= card.y && point.y <= card.y + variableCardHeight) {
        return { card: card.name, scope: card.scope, cardId: card.id, x: card.x + variableCardWidth, y: card.y + variableCardPortY };
      }
    }
    return null;
  }

  function variableConnectionTargetAt(event: { clientX: number; clientY: number } | null | undefined): any {
    if (!state.variableConnect || !event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const point = worldPoint(event);
    if (state.variableConnect.direction === 'from-card') return variableInputTargetAt(point, state.variableConnect.scope, state.variableConnect.variable);
    if (state.variableConnect.direction === 'from-instance-input') {
      return variableCardTargetAtInstanceInput(point, state.variableConnect.nodeId, state.variableConnect.runIndex, state.variableConnect.param);
    }
    return variableCardTargetAt(point, state.variableConnect.nodeId, state.variableConnect.param);
  }

  return { connectionTargetAt, variablePinTargetAt, instanceRunInputTargetAt, variableInputTargetAt, variableCardTargetAt, variableCardTargetAtInstanceInput, variableConnectionTargetAt, referenceTargetAt, referenceConnectionTargetAt, referenceMissAt };
}
