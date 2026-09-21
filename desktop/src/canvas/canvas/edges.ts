/**
 * 画布连线渲染：父子连线、实例运行连线、拖拽预览与变量连线。
 * 原 `workflow-editor.js` 的 renderEdge/renderInstanceRunEdge/renderConnection/
 * renderVariableEdges/renderVariableConnection/bindVariableEdgeQuickDisconnect。
 *
 * 渲染函数不修改文档；选择与断开都通过注入的命令/回调完成。
 */
import type { CanvasState } from '../state/canvas-state';
import { dataTone, dataToneColor, parameterDataKey, variableDataKey } from './data-tones';
import { isGroupBoundaryPin, isGroupCardNode, isGroupInterfaceNode, isGroupMemberNode, isGroupVariablesNode } from '../model/node-groups';
import { aggregateNodeRunStatus } from '../model/node-group-runtime';

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
  /** 折叠节点组时，把隐藏的真实引用源解析成可见的组卡。 */
  referenceSourceById?(id: string): EdgeNode | null;
  /** 折叠组的代理执行边实际指向哪些真实节点（运行事件仍使用真实节点 id）。 */
  edgeRunTargetIds?(parentId: string, childId: string): string[];
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
  /**
   * 局部更新：拖动节点时只改这条连线的 `d`，不重建元素、不重挂监听。
   * 返回 false 表示这条线当前没有挂载（已被视口裁剪）。
   */
  patchEdge(parent: EdgeNode, childId: string, order: number): boolean;
  /** 局部更新实例运行连线。 */
  patchInstanceRunEdge(card: EdgeRunCard): boolean;
  /** 局部更新以该节点为源或目标的数据线（变量线、节点输出引用线）。 */
  patchNodeDataEdges(nodeId: string): number;
  /** 运行事件到达时，就地更新目标节点入边的运行状态样式；省略 id 时更新全部。 */
  patchRunEdgeStates(nodeId?: string): number;
  /** 图层整体重建前清空元素索引。 */
  resetPatchRegistry(): void;
  /** 已挂载连线的世界坐标包围盒（视口裁剪用）。 */
  edgeBounds(parentId: string, childId: string): { x: number; y: number; width: number; height: number } | null;
}

/** 数据线的色调下标：按身份字符串取色（配色见 workflow-editor.css 的 `.data-tone-N`）。
 * 变量线按「作用域.变量名」、引用线按引用文本，于是同一个变量/引用在所有卡片、端点和
 * 连线上颜色一致，不同来源颜色不同。 */
export function dataEdgeTone(key: string): number {
  return dataTone(key);
}

export function createCanvasEdges(deps: EdgesDeps): CanvasEdges {
  const {
    state, svgEl, bezier, nodes, nodeById, position, nodeHeight, instanceRunCards, instanceRunInputPosition,
    variableCardList, nodeVariablePins, variablePinPosition, disconnect,
    disconnectVariableFromPin, disconnectVariableFromInstanceInput, mutate, requestInspector, render,
    worldPoint, captureConnectionPointer, nodeWidth, runCardWidth, baseHeight, runVariableHeight,
    variableCardWidth, variableCardPortY, variablePinX, taskOutputPortY,
    disconnectReferenceFromPin, referenceSourceById,
  } = deps;
  const rowHeightOf = deps.nodeRowHeight ?? (() => runVariableHeight);

  /**
   * 已挂载连线的元素索引：`patchEdge` 用它做局部更新，不必查询 DOM。
   * key 为 `parentId\0childId`，图层整体重建时清空。
   */
  const edgeRegistry = new Map<string, { group: any; parentId: string; childId: string; runTargetIds: string[]; paths: any[]; order: any; orderBg: any; rewire: any }>();
  const runEdgeRegistry = new Map<string, { paths: any[]; order: any; orderBg: any }>();
  const edgeBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
  type DataEdgeEntry = { paths: any[]; path(): string };
  /** 节点 id → 以它为源或目标的数据线；拖拽时只改这些 path。 */
  const variableEdgeRegistry = new Map<string, Set<DataEdgeEntry>>();
  const referenceEdgeRegistry = new Map<string, Set<DataEdgeEntry>>();

  function registerDataEdge(registry: Map<string, Set<DataEdgeEntry>>, nodeIds: string[], paths: any[], path: () => string): void {
    const entry: DataEdgeEntry = { paths, path };
    for (const nodeId of new Set(nodeIds.filter(Boolean))) {
      let entries = registry.get(nodeId);
      if (!entries) registry.set(nodeId, entries = new Set());
      entries.add(entry);
    }
  }

  function patchNodeDataEdges(nodeId: string): number {
    const entries = new Set([
      ...(variableEdgeRegistry.get(nodeId) || []),
      ...(referenceEdgeRegistry.get(nodeId) || []),
    ]);
    let patched = 0;
    for (const entry of entries) {
      const d = entry.path();
      for (const path of entry.paths) path?.setAttribute?.('d', d);
      patched += 1;
    }
    return patched;
  }

  function structuralEdgeClass(parentId: string, childId: string, runTargetIds = [childId]): string {
    const selected = state.selectedEdge && state.selectedEdge.parent === parentId && state.selectedEdge.child === childId;
    // 多条真实边折叠成一条代理边时，与组卡使用完全相同的状态优先级。
    const runStatus = aggregateNodeRunStatus(runTargetIds, state.run);
    const collapsed = Boolean(isGroupCardNode(nodeById(parentId)) || isGroupCardNode(nodeById(childId)));
    return `edge${selected ? ' selected' : ''}${runStatus ? ` run-${runStatus}` : ''}${collapsed ? ' edge-collapsed-group' : ''}`;
  }

  function patchRunEdgeStates(nodeId?: string): number {
    let patched = 0;
    for (const entry of edgeRegistry.values()) {
      if (nodeId && !entry.runTargetIds.includes(nodeId)) continue;
      const next = structuralEdgeClass(entry.parentId, entry.childId, entry.runTargetIds);
      if (entry.group?.getAttribute?.('class') === next) continue;
      entry.group?.setAttribute?.('class', next);
      patched += 1;
    }
    return patched;
  }

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
  function renderDisconnectableEdge(layer: any, className: string, hitClassName: string, d: string, disconnectEdge: () => void, toneKey = ''): any[] {
    const hit = svgEl('path', { class: hitClassName, d }, layer);
    bindVariableEdgeQuickDisconnect(hit, disconnectEdge);
    const visible = svgEl('path', { class: className, d, style: `--data-tone:${dataToneColor(toneKey)};--edge-tone:var(--data-tone)` }, layer);
    return [hit, visible];
  }

  function renderVariableEdges(layer: any): void {
    // 变量卡移动会单独重画本图层；先丢掉已移除 path 的索引，避免后续拖节点写入失效元素。
    variableEdgeRegistry.clear();
    const cards = new Map(variableCardList().map((card) => [card.id, card]));
    const byReference = new Map<string, EdgeVariableCard>();
    for (const card of variableCardList()) {
      const ref = `${card.scope}.${card.name}`;
      if (!byReference.has(ref)) byReference.set(ref, card);
    }
    const links = state.raw && state.raw._variableLinks && typeof state.raw._variableLinks === 'object' ? state.raw._variableLinks as Record<string, string> : {};
    for (const node of nodes()) {
      // 进入组内后，变量卡先连到「组接口」，再由接口映射到真实参数。
      // 成员卡不再同时画一条重复的变量卡直连。
      if (isGroupMemberNode(node)) continue;
      nodeVariablePins(node).forEach((pin, index) => {
        const targetNodeId = isGroupBoundaryPin(pin) ? pin.targetNodeId : node.id;
        const targetParam = isGroupBoundaryPin(pin) ? pin.targetParam : pin.param;
        const targetNode = isGroupBoundaryPin(pin) ? pin._targetNode : nodeById(targetNodeId);
        const toneKey = pin.variable
          ? variableDataKey(pin.scope, pin.variable)
          : parameterDataKey(targetNodeId, targetParam);
        const tone = dataTone(toneKey);

        // 手动添加到组接口后立即画到真实成员参数的映射；不必等外部变量先连上。
        if ((isGroupInterfaceNode(node) || isGroupVariablesNode(node)) && targetNode) {
          const targetPins = nodeVariablePins(targetNode);
          const targetIndex = isGroupBoundaryPin(pin) && Number.isInteger(pin.targetIndex)
            ? pin.targetIndex
            : targetPins.findIndex((item) => item.param === targetParam);
          if (targetIndex >= 0) {
            const mappingPath = (): string => {
              const origin = position(node);
              const target = position(targetNode);
              // 出线口在哪一侧决定了头段控制点往哪推：变量卡的端口在右边缘（线向右走），
              // 接口卡的端口在左边缘。两个控制点都往左推时，长距离的映射线几乎退化成直斜线。
              const fromRight = isGroupVariablesNode(node);
              const x1 = origin.x + (fromRight ? nodeWidth - variablePinX : variablePinX);
              const y1 = origin.y + baseHeight + index * rowHeightOf(node) + rowHeightOf(node) / 2;
              const x2 = target.x + variablePinX;
              const y2 = target.y + baseHeight + targetIndex * rowHeightOf(targetNode) + rowHeightOf(targetNode) / 2;
              const bend = Math.max(32, Math.abs(x2 - x1) * 0.42);
              const headX = fromRight ? x1 + bend : x1 - bend;
              // 末端落在成员卡左侧的参数引脚上，所以从左边切入。
              return `M ${x1} ${y1} C ${headX} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
            };
            // 组接口 / 组变量卡到真实成员参数也是**变量线**：与普通变量线同一套「数据线」样式
            // （实线、按身份取色、1.8px，带透明命中线），不是另一种虚线。
            // `group-interface-edge` 只作为语义标记保留，不再自带样式。
            const mappingPaths = renderDisconnectableEdge(
              layer,
              `variable-edge group-interface-edge data-tone-${tone}`,
              'variable-edge-hit',
              mappingPath(),
              () => disconnectVariableFromPin(targetNodeId, targetParam),
              toneKey,
            );
            registerDataEdge(variableEdgeRegistry, [node.id, targetNodeId], mappingPaths, mappingPath);
          }
        }

        if (!pin.variable) return;
        const card = cards.get(links[`${targetNodeId}:${targetParam}`]) || byReference.get(`${pin.scope}.${pin.variable}`);
        if (!card) return;
        const x1 = card.x + variableCardWidth;
        const y1 = card.y + variableCardPortY;
        const path = (): string => {
          const current = position(node);
          const targetX = current.x + (isGroupVariablesNode(node) ? nodeWidth - variablePinX : variablePinX);
          const targetY = current.y + baseHeight + index * rowHeightOf(node) + rowHeightOf(node) / 2;
          const curve = Math.max(32, Math.abs(targetX - x1) * 0.42);
          return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`;
        };
        const paths = renderDisconnectableEdge(layer, `variable-edge data-tone-${tone}`, 'variable-edge-hit', path(),
          () => disconnectVariableFromPin(targetNodeId, targetParam), toneKey);
        registerDataEdge(variableEdgeRegistry, [node.id], paths, path);
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
        const toneKey = variableDataKey(match[1], match[2]);
        const tone = dataTone(toneKey);
        renderDisconnectableEdge(layer, `variable-edge data-tone-${tone}`, 'variable-edge-hit',
          `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`,
          () => disconnectVariableFromInstanceInput(runCard.node.id, runCard.index, variable.name), toneKey);
      });
    }
  }

  function renderEdge(layer: any, parent: EdgeNode, childId: string, order: number): void {
    const child = nodeById(childId);
    if (!child) return;
    const collapsed = Boolean((parent as any)._nodeGroup || (child as any)._nodeGroup);
    const from = position(parent);
    const to = position(child);
    const x1 = from.x + nodeWidth / 2;
    const y1 = from.y + nodeHeight(parent);
    const x2 = to.x + nodeWidth / 2;
    const y2 = to.y;
    const runTargetIds = deps.edgeRunTargetIds?.(parent.id, childId) ?? [childId];
    const group = svgEl('g', { class: structuralEdgeClass(parent.id, childId, runTargetIds), 'data-parent': parent.id, 'data-child': childId }, layer);
    group.dataset.parent = parent.id;
    group.dataset.child = childId;
    const path = svgEl('path', { class: 'edge-hit', d: bezier(x1, y1, x2, y2) }, group);
    const edgePath = bezier(x1, y1, x2, y2);
    const line = svgEl('path', { class: 'edge-line', d: edgePath }, group);
    const flow = svgEl('path', { class: 'edge-flow', d: edgePath }, group);
    const midY = (y1 + y2) / 2;
    const orderBg = svgEl('circle', { class: 'edge-order-bg', cx: (x1 + x2) / 2, cy: midY, r: 10 }, group);
    const orderText = svgEl('text', { class: 'edge-order', x: (x1 + x2) / 2, y: midY + 4, 'text-anchor': 'middle' }, group);
    orderText.textContent = String(order + 1);
    const rewire = svgEl('circle', { class: 'edge-rewire', cx: x2, cy: y2 - 18, r: 6, title: '拖动以重新连接' }, group);
    // 局部更新用的元素索引：拖拽时只改这些属性的 `d` / 位置。
    edgeRegistry.set(`${parent.id}\u0000${childId}`, {
      group, parentId: parent.id, childId, runTargetIds, paths: [path, line, flow], order: orderText, orderBg, rewire,
    });
    edgeBounds.set(`${parent.id}\u0000${childId}`, {
      x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
    });
    // 折叠后的边可能代表多条真实边，不能在外层直接断开或重连；进入组后再编辑真实连线。
    if (collapsed) return;
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
    const line = svgEl('path', { class: 'instance-run-edge-line', d: path }, group);
    const midY = (y1 + y2) / 2;
    const orderBg = svgEl('circle', { class: 'edge-order-bg', cx: (x1 + x2) / 2, cy: midY, r: 10 }, group);
    const orderText = svgEl('text', { class: 'edge-order', x: (x1 + x2) / 2, y: midY + 4, 'text-anchor': 'middle' }, group);
    orderText.textContent = String(card.index + 1);
    runEdgeRegistry.set(String(card.key), { paths: [line], order: orderText, orderBg });
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
    let toneKey = '';
    if (connection.direction === 'from-card') {
      const card = variableCardList().find((item) => item.id === connection.cardId) || variableCardList().find((item) => item.scope === connection.scope && item.name === connection.variable);
      if (card) {
        origin = { x: card.x + variableCardWidth, y: card.y + variableCardPortY };
        toneKey = variableDataKey(card.scope, card.name);
      }
    } else if (connection.direction === 'from-instance-input') {
      const card = instanceRunCards().find((item) => item.node.id === connection.nodeId && item.index === connection.runIndex);
      const index = card ? card.variables.findIndex((input) => input.name === connection.param) : -1;
      if (card && index >= 0) {
        origin = instanceRunInputPosition(card, index);
        const value = card.run?.inputs?.[connection.param];
        const ref = value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { ref?: unknown }).ref === 'string'
          ? (value as { ref: string }).ref
          : '';
        toneKey = ref || `run:${card.node.id}:${card.index}:${connection.param}`;
      }
    } else {
      const node = nodeById(connection.nodeId);
      const index = node ? nodeVariablePins(node).findIndex((pin) => pin.param === connection.param) : -1;
      if (node && index >= 0) {
        origin = variablePinPosition(node, index);
        const pin = nodeVariablePins(node)[index];
        toneKey = pin.variable ? variableDataKey(pin.scope, pin.variable) : parameterDataKey(node.id, pin.param);
      }
    }
    if (!origin) return;
    const hover = connection.hover;
    svgEl('path', {
      class: `variable-connection-preview data-tone-${dataTone(toneKey)}${hover ? ' snapped' : ''}`,
      style: `--data-tone:${dataToneColor(toneKey)}`,
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
      class: `reference-connection-preview data-tone-${dataTone(`nodes.${source.id}.output`) }${hover ? ' snapped' : ''}`,
      style: `--data-tone:${dataToneColor(`nodes.${source.id}.output`)}`,
      d: bezier(origin.x, origin.y, hover ? hover.x : connection.x, hover ? hover.y : connection.y),
    }, layer);
  }

  /** 任务卡右侧输出口的世界坐标。 */
  function referencePortPosition(node: any): EdgePoint {
    const pos = position(node);
    return { x: pos.x + nodeWidth, y: pos.y + taskOutputPortY };
  }

  /**
   * 结构边的几何：父节点输出口 → 子节点输入口。
   * patchEdge 与 renderEdge 共用同一份公式，避免局部更新和整体重建画出两条不同的线。
   */
  function structuralPath(parent: EdgeNode, childId: string): { d: string; box: { x: number; y: number; width: number; height: number } } | null {
    const child = nodeById(childId);
    if (!child) return null;
    const from = position(parent);
    const to = position(child);
    const x1 = from.x + nodeWidth / 2;
    const y1 = from.y + nodeHeight(parent);
    const x2 = to.x + nodeWidth / 2;
    const y2 = to.y;
    const bend = Math.max(48, Math.abs(y2 - y1) * 0.48);
    const d = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
    return {
      d,
      box: {
        x: Math.min(x1, x2), y: Math.min(y1, y2),
        width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
      },
    };
  }

  /**
   * 局部更新结构边：只写三个 `<path>` 的 `d` 与顺序徽标位置。
   * 元素引用在 renderEdge 时登记，所以拖拽期间不需要查询 DOM，也不会重建元素。
   */
  function patchEdge(parent: EdgeNode, childId: string, order: number): boolean {
    const entry = edgeRegistry.get(`${parent.id}\u0000${childId}`);
    if (!entry) return false;
    const geometry = structuralPath(parent, childId);
    if (!geometry) return false;
    for (const path of entry.paths) path.setAttribute('d', geometry.d);
    const midX = geometry.box.x + geometry.box.width / 2;
    const midY = geometry.box.y + geometry.box.height / 2;
    entry.orderBg?.setAttribute('cx', String(midX));
    entry.orderBg?.setAttribute('cy', String(midY));
    entry.order?.setAttribute('x', String(midX));
    entry.order?.setAttribute('y', String(midY + 4));
    if (entry.order) entry.order.textContent = String(order + 1);
    entry.rewire?.setAttribute('cx', String(geometry.box.x + geometry.box.width));
    entry.rewire?.setAttribute('cy', String(geometry.box.y + geometry.box.height - 18));
    edgeBounds.set(`${parent.id}\u0000${childId}`, geometry.box);
    return true;
  }

  /** 局部更新实例运行连线（只有一条可见线）。 */
  function patchInstanceRunEdge(card: EdgeRunCard): boolean {
    const entry = runEdgeRegistry.get(String(card.key));
    if (!entry) return false;
    const parent = position(card.node);
    const x1 = parent.x + nodeWidth / 2;
    const y1 = parent.y + nodeHeight(card.node);
    const x2 = card.x + runCardWidth / 2;
    const y2 = card.y;
    const bend = Math.max(48, Math.abs(y2 - y1) * 0.48);
    const d = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
    for (const path of entry.paths) path.setAttribute('d', d);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    entry.orderBg?.setAttribute('cx', String(midX));
    entry.orderBg?.setAttribute('cy', String(midY));
    entry.order?.setAttribute('x', String(midX));
    entry.order?.setAttribute('y', String(midY + 4));
    return true;
  }

  /**
   * 节点输出引用边：从源任务的输出口连到目标参数端点（实线、比执行连线细；
   * 颜色按源输出字段取，不同变量拉出来的线颜色不同）。引用文本本身带着源节点
   * 与字段，所以不需要额外的连线记录。
   */
  function renderReferenceEdges(layer: any): void {
    referenceEdgeRegistry.clear();
    for (const node of nodes()) {
      if (!node || (node.type !== 'task' && !isGroupCardNode(node))) continue;
      nodeVariablePins(node).forEach((pin, index) => {
        const ref = pin.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof (pin.value as { ref?: unknown }).ref === 'string'
          ? (pin.value as { ref: string }).ref
          : '';
        const match = /^nodes\.([^\.]+)\.output/.exec(ref);
        if (!match) return;
        const source = referenceSourceById ? referenceSourceById(match[1]) : nodeById(match[1]);
        if (!source || source.id === node.id) return;
        const targetNodeId = isGroupBoundaryPin(pin) ? pin.targetNodeId : node.id;
        const targetParam = isGroupBoundaryPin(pin) ? pin.targetParam : pin.param;
        const path = (): string => {
          const currentOrigin = referencePortPosition(source);
          const currentTargetPos = position(node);
          const currentTarget = {
            x: currentTargetPos.x + variablePinX,
            y: currentTargetPos.y + baseHeight + index * rowHeightOf(node) + rowHeightOf(node) / 2,
          };
          const curve = Math.max(36, Math.abs(currentTarget.x - currentOrigin.x) * 0.42);
          return `M ${currentOrigin.x} ${currentOrigin.y} C ${currentOrigin.x + curve} ${currentOrigin.y}, ${currentTarget.x - curve} ${currentTarget.y}, ${currentTarget.x} ${currentTarget.y}`;
        };
        const paths = renderDisconnectableEdge(layer, `reference-edge data-tone-${dataEdgeTone(ref)}`, 'reference-edge-hit', path(),
          () => disconnectReferenceFromPin(targetNodeId, targetParam), ref);
        registerDataEdge(referenceEdgeRegistry, [source.id, node.id], paths, path);
      });
    }
  }

  return {
    bindVariableEdgeQuickDisconnect, renderVariableEdges, renderEdge, renderInstanceRunEdge, renderConnection,
    renderVariableConnection, renderReferenceConnection, renderReferenceEdges, referencePortPosition,
    patchEdge, patchInstanceRunEdge, patchNodeDataEdges, patchRunEdgeStates,
    /** 图层整体重建前清空元素索引，避免补丁写到已被移除的元素上。 */
    resetPatchRegistry(): void {
      edgeRegistry.clear();
      runEdgeRegistry.clear();
      variableEdgeRegistry.clear();
      referenceEdgeRegistry.clear();
      edgeBounds.clear();
    },
    /** 已挂载连线的包围盒（世界坐标），供视口裁剪精确判定。 */
    edgeBounds(parentId: string, childId: string): { x: number; y: number; width: number; height: number } | null {
      return edgeBounds.get(`${parentId}\u0000${childId}`) || null;
    },
  };
}
