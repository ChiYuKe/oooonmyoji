/**
 * 画布连线渲染：父子连线、实例运行连线、拖拽预览与变量连线。
 * 原 `workflow-editor.js` 的 renderEdge/renderInstanceRunEdge/renderConnection/
 * renderVariableEdges/renderVariableConnection/bindVariableEdgeQuickDisconnect。
 *
 * 渲染函数不修改文档；选择与断开都通过注入的命令/回调完成。
 */
import type { CanvasState } from '../state/canvas-state';
import {
  CONDITION_INPUT_X, CONDITION_INPUT_Y, CONDITION_PORT_LABELS,
  conditionPortOfChild, conditionPortOffset, expressionInputOffset, isBooleanInputNode, isBooleanInputPin, nearestConditionPort,
} from '../model/exec-ports';
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
  /** 这条连线上的校验问题（空/缺省表示没问题）：连线涂红并给出悬停说明。 */
  edgeIssues?(parentId: string, childId: string): any[];
  /** 这条执行边上的手工折点（UE Knot）；缺省表示不支持手工走线。 */
  structuralWaypoints?(parentId: string, childId: string): Array<{ x: number; y: number }>;
  /** 连线右键菜单项（手工走线）。 */
  edgeMenuItems?(parentId: string, childId: string, point: EdgePoint): any[];
  showMenu?(x: number, y: number, items: any[]): void;
  /** 删掉一个折点（写文档 + 重绘由调用方负责）。 */
  removeStructuralWaypoint?(parentId: string, childId: string, pointIndex: number): void;
  /** 开始拖动折点：复用 pointer 模块的生命周期。 */
  startWaypointDrag?(event: PointerEvent, parentId: string, childId: string, pointIndex: number): void;
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
  /** 任务卡右侧输出口在节点内的 X 偏移（收在卡片右缘以内）。默认贴右缘。 */
  taskOutputPortX?: number;
  /**
   * 拆分卡片字段引脚在节点内的偏移（`field` → `{x,y}`）。引用边从被引用的那个
   * 字段引脚出线；返回 null（未绑定/镜像标量/不是拆分卡）时回落到通用输出口。
   */
  breakFieldPinOffset?(node: any, field: string): { x: number; y: number } | null;
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
  /** 输出口横向位置：与卡片渲染共用同一份「节点内偏移」，两边永远同一个点。 */
  const referencePortX = deps.taskOutputPortX ?? nodeWidth;
  const breakFieldPinOffset = deps.breakFieldPinOffset;

  /**
   * 已挂载连线的元素索引：`patchEdge` 用它做局部更新，不必查询 DOM。
   * key 为 `parentId\0childId`，图层整体重建时清空。
   */
  const edgeRegistry = new Map<string, { group: any; parentId: string; childId: string; runTargetIds: string[]; paths: any[]; order: any; orderBg: any; rewire: any; knots?: any[] }>();
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

  /** 执行连线的出线口 X：判断节点分左右两个口（真/假），其余节点居中。 */
  function execPinX(parent: EdgeNode, childId: string): number {
    if (!parent || parent.type !== 'condition') return nodeWidth / 2;
    return conditionPortOffset(nodeWidth, conditionPortOfChild(parent, childId) || 'true');
  }

  /** 连线中点徽标：判断节点写「真/假」（口位），其余写 1/2/3… 的优先级序号。 */
  function edgeOrderText(parent: EdgeNode, childId: string, order: number): string {
    const port = parent && parent.type === 'condition' ? conditionPortOfChild(parent, childId) : null;
    return port ? CONDITION_PORT_LABELS[port] : String(order + 1);
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
   * 数据线末端的箭头（UE 的数据线在落点前收一个小三角，方向一目了然）。
   *
   * Chrome 的 marker **不支持** `context-stroke`（箭头不会跟着引用它的那条线的颜色走），
   * 所以只能按颜色建 marker；色相按 15° 归并，于是 marker 数量上限是 24 个，
   * 不随工作流里的变量/引用数量无限增长。
   * marker 挂在图层父节点（`.graph-world`）上：数据线图层每帧整层重建，父节点不重建，
   * 所以 marker 建一次就一直在，不会被逐帧清掉重建。
   */
  const WIRE_ARROW_HUE_STEP = 15;
  const wireArrowIds = new Map<string, string>();
  let wireArrowDefs: any = null;
  let wireArrowSeq = 0;

  /** 把 `hsl(H 62% 60%)` 的色相归并到 15° 一档（只用于箭头，线本身仍是完整散列色）。 */
  function wireArrowColor(color: string): string {
    const match = /^hsl\(\s*([\d.]+)/i.exec(String(color || ''));
    if (!match) return color;
    const step = Math.round(Number(match[1]) / WIRE_ARROW_HUE_STEP) * WIRE_ARROW_HUE_STEP;
    return `hsl($((step % 360) + 360) % 360 62% 60%)`;
  }

  /** 取（或建立）这条数据线颜色对应的箭头 marker，返回它的 id；无法建 marker 时返回 null。 */
  function wireArrowMarker(layer: any, color: string): string | null {
    const host = layer && layer.parentNode;
    if (!host || typeof host.appendChild !== 'function') return null;
    const key = wireArrowColor(color);
    const cached = wireArrowIds.get(key);
    if (cached) {
      if (wireArrowDefs && wireArrowDefs.parentNode !== host) host.appendChild(wireArrowDefs);
      return cached;
    }
    if (!wireArrowDefs || wireArrowDefs.parentNode !== host) wireArrowDefs = svgEl('defs', { class: 'wire-arrows' }, host);
    const id = `wire-arrow-${wireArrowSeq++}`;
    const marker = svgEl('marker', {
      id,
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      markerUnits: 'userSpaceOnUse',
      orient: 'auto',
    }, wireArrowDefs);
    svgEl('path', { class: 'wire-arrow', d: 'M 0 1 L 9 5 L 0 9 Z', fill: key }, marker);
    wireArrowIds.set(key, id);
    return id;
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
    const tone = dataToneColor(toneKey);
    const arrow = wireArrowMarker(layer, tone);
    const visible = svgEl('path', {
      class: className,
      d,
      style: `--data-tone:${tone};--edge-tone:var(--data-tone)`,
      // 箭头画在可见线上（命中线不画），方向由 marker 的 `orient="auto"` 沿末端切线决定。
      'marker-end': arrow ? `url(#${arrow})` : undefined,
    }, layer);
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
              const inputOffset = expressionInputOffset(node, pin.param);
              const x1 = origin.x + (inputOffset
                ? inputOffset.x
                : (fromRight ? nodeWidth - variablePinX : variablePinX));
              const y1 = origin.y + (inputOffset
                ? inputOffset.y
                : baseHeight + index * rowHeightOf(node) + rowHeightOf(node) / 2);
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
          const inputOffset = expressionInputOffset(node, pin.param);
          const targetX = current.x + (inputOffset
            ? inputOffset.x
            : (isGroupVariablesNode(node) ? nodeWidth - variablePinX : variablePinX));
          const targetY = current.y + (inputOffset
            ? inputOffset.y
            : baseHeight + index * rowHeightOf(node) + rowHeightOf(node) / 2);
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
    const x1 = from.x + execPinX(parent, childId);
    const y1 = from.y + nodeHeight(parent);
    const x2 = to.x + nodeWidth / 2;
    const y2 = to.y;
    const runTargetIds = deps.edgeRunTargetIds?.(parent.id, childId) ?? [childId];
    // 连线上的校验问题：这条边自身不合法，或它牵涉的节点有结构问题（成环、父节点数量不对…）。
    const edgeIssues = deps.edgeIssues?.(parent.id, childId) ?? [];
    const classes = [structuralEdgeClass(parent.id, childId, runTargetIds)];
    if (edgeIssues.length) classes.push('edge-invalid');
    const group = svgEl('g', { class: classes.join(' '), 'data-parent': parent.id, 'data-child': childId }, layer);
    group.dataset.parent = parent.id;
    group.dataset.child = childId;
    if (edgeIssues.length) {
      const title = svgEl('title', {}, group);
      title.textContent = edgeIssues.map((issue: any) => String(issue && issue.message || '')).filter(Boolean).join('\n');
    }
    // 没有折点时仍走注入的 `bezier`（老路径，逐字不变）；有折点时才用按折点走线的几何。
    const waypoints = deps.structuralWaypoints?.(parent.id, childId) ?? [];
    const routed = waypoints.length ? structuralPath(parent, childId) : null;
    const edgePath = routed ? routed.d : bezier(x1, y1, x2, y2);
    const path = svgEl('path', { class: 'edge-hit', d: edgePath }, group);
    const line = svgEl('path', { class: 'edge-line', d: edgePath }, group);
    const flow = svgEl('path', { class: 'edge-flow', d: edgePath }, group);
    // 手工折点画在连线上（可拖可删）；没有折点时不会有任何多余元素。
    const knots = waypoints.length ? renderKnots(group, parent, childId, waypoints) : [];
    const midY = (y1 + y2) / 2;
    const orderBg = svgEl('circle', { class: 'edge-order-bg', cx: (x1 + x2) / 2, cy: midY, r: 10 }, group);
    const orderText = svgEl('text', { class: 'edge-order', x: (x1 + x2) / 2, y: midY + 4, 'text-anchor': 'middle' }, group);
    orderText.textContent = edgeOrderText(parent, childId, order);
    const rewire = svgEl('circle', { class: 'edge-rewire', cx: x2, cy: y2 - 18, r: 6, title: '拖动以重新连接' }, group);
    // 局部更新用的元素索引：拖拽时只改这些属性的 `d` / 位置。
    edgeRegistry.set(`${parent.id}\u0000${childId}`, {
      group, parentId: parent.id, childId, runTargetIds, paths: [path, line, flow], order: orderText, orderBg, rewire, knots,
    });
    edgeBounds.set(`${parent.id}\u0000${childId}`, routed
      ? routed.box
      : { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
    // 折叠后的边可能代表多条真实边，不能在外层直接断开或重连；进入组后再编辑真实连线。
    if (collapsed) return;
    group.addEventListener('contextmenu', (event: MouseEvent) => {
      // 连线右键：手工走线（UE 的 Knot）。
      if (!deps.edgeMenuItems) return;
      event.preventDefault();
      event.stopPropagation();
      const point = worldPoint(event);
      const items = deps.edgeMenuItems(parent.id, childId, point);
      if (items.length) deps.showMenu?.(event.clientX, event.clientY, items);
    });
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
      state.connect = {
        direction: 'from-output', parent: parent.id, x: point.x, y: point.y,
        oldChild: childId, oldIndex: order, hover: null, pointerId: captureConnectionPointer(event),
        // 判断节点：重连落回原来那个口（真/假），不会被当成普通子节点追加。
        ...(parent.type === 'condition' ? { slot: conditionPortOfChild(parent, childId) || 'true' } : {}),
      };
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
      // 反向拖线（子输入口 → 父输出口）：命中目标时自由端吸附到父节点底部执行口；
      // 判断节点按指针相对卡片的偏移吸附到最近的真/假口。
      let endX = connect.x;
      let endY = connect.y;
      if (connect.hover) {
        const hover = nodeById(connect.hover);
        if (hover) {
          const hoverPos = position(hover);
          const portX = hover.type === 'condition'
            ? conditionPortOffset(nodeWidth, nearestConditionPort(nodeWidth, connect.x - hoverPos.x))
            : nodeWidth / 2;
          endX = hoverPos.x + portX;
          endY = hoverPos.y + nodeHeight(hover);
        }
      }
      svgEl('path', { class: classes, d: bezier(endX, endY, pos.x + nodeWidth / 2, pos.y) }, layer);
      return;
    }
    const parent = nodeById(connect.parent);
    if (!parent) return;
    const pos = position(parent);
    // 判断节点从被拖的那个口出线（真口在左、假口在右），普通节点只有一个居中口。
    const portX = parent.type === 'condition' && connect.slot ? conditionPortOffset(nodeWidth, connect.slot) : nodeWidth / 2;
    // 正向拖线（父输出口 → 子输入口）：命中目标时自由端吸附到子节点顶部输入口。
    let endX = connect.x;
    let endY = connect.y;
    if (connect.hover) {
      const hover = nodeById(connect.hover);
      if (hover) {
        const hoverPos = position(hover);
        endX = hoverPos.x + nodeWidth / 2;
        endY = hoverPos.y;
      }
    }
    svgEl('path', { class: classes, d: bezier(pos.x + portX, pos.y + nodeHeight(parent), endX, endY) }, layer);
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
    const field = connection.field ? String(connection.field) : '';
    const origin = referenceOriginFor(source, field);
    const hover = connection.hover;
    const tone = `nodes.${source.id}.output${field ? `.${field}` : ''}`;
    svgEl('path', {
      class: `reference-connection-preview data-tone-${dataTone(tone)}${hover ? ' snapped' : ''}`,
      style: `--data-tone:${dataToneColor(tone)}`,
      d: bezier(origin.x, origin.y, hover ? hover.x : connection.x, hover ? hover.y : connection.y),
    }, layer);
  }

  /** 任务卡右侧输出口的世界坐标。 */
  function referencePortPosition(node: any): EdgePoint {
    const pos = position(node);
    return { x: pos.x + referencePortX, y: pos.y + taskOutputPortY };
  }

  /**
   * 一条节点输出引用的起点：拆分卡片被引用的字段有自己的引脚就从那个引脚出线，
   * 否则回落到通用输出口（任务卡、布尔判断卡、以及镜像整个输出的拆分卡）。
   */
  function referenceOriginFor(source: any, field: string): EdgePoint {
    if (field && breakFieldPinOffset) {
      const offset = breakFieldPinOffset(source, field);
      if (offset) {
        const pos = position(source);
        return { x: pos.x + offset.x, y: pos.y + offset.y };
      }
    }
    if (source && source._nodeGroup) {
      const outputs = Array.isArray(source._referenceOutputs) ? source._referenceOutputs : [];
      const index = outputs.findIndex((item: any) => item && item.field === field);
      const pos = position(source);
      const y = baseHeight + (index >= 0 ? index : 0) * rowHeightOf(source) + rowHeightOf(source) / 2;
      return { x: pos.x + referencePortX, y: pos.y + y };
    }
    if (source && source.type === 'break') {
      const pos = position(source);
      // Break 的整体输出口与“拆分来源/输出”首行共用行中心；不能用普通节点的顶部口。
      return { x: pos.x + nodeWidth, y: pos.y + baseHeight + rowHeightOf(source) / 2 };
    }
    if (source && source.type === 'bool_judge') {
      const pos = position(source);
      return { x: pos.x + nodeWidth, y: pos.y + nodeHeight(source) / 2 };
    }
    return referencePortPosition(source);
  }

  /**
   * 结构边的几何：父节点输出口 → 子节点输入口，中间按手工折点（UE Knot）走线。
   * patchEdge 与 renderEdge 共用同一份公式，避免局部更新和整体重建画出两条不同的线。
   *
   * 没有折点时**逐字返回**原来的单段三次贝塞尔（老文档的观感与几何完全不变）；
   * 有折点时按 `起点 → 折点… → 终点` 串成多段，每段保持竖直切线（往下流的执行流语言）。
   */
  function structuralPath(parent: EdgeNode, childId: string): { d: string; box: { x: number; y: number; width: number; height: number } } | null {
    const child = nodeById(childId);
    if (!child) return null;
    const from = position(parent);
    const to = position(child);
    const x1 = from.x + execPinX(parent, childId);
    const y1 = from.y + nodeHeight(parent);
    const x2 = to.x + nodeWidth / 2;
    const y2 = to.y;
    const bend = Math.max(48, Math.abs(y2 - y1) * 0.48);
    const waypoints = deps.structuralWaypoints?.(parent.id, childId) ?? [];
    if (!waypoints.length) {
      return {
        d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`,
        box: {
          x: Math.min(x1, x2), y: Math.min(y1, y2),
          width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
        },
      };
    }
    const points = [{ x: x1, y: y1 }, ...waypoints.map((point) => ({ x: point.x, y: point.y })), { x: x2, y: y2 }];
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const segmentBend = Math.max(32, Math.abs(current.y - previous.y) * 0.48);
      d += ` C ${previous.x} ${previous.y + segmentBend}, ${current.x} ${current.y - segmentBend}, ${current.x} ${current.y}`;
    }
    return {
      d,
      box: {
        x: Math.min(...points.map((point) => point.x)),
        y: Math.min(...points.map((point) => point.y)),
        width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
        height: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
      },
    };
  }

  /** 折点的小圆点：点/右键都在它上面（拖动与删除）。返回元素供局部补丁复用。 */
  function renderKnots(group: any, parent: EdgeNode, childId: string, waypoints: Array<{ x: number; y: number }>): any[] {
    return waypoints.map((point, index) => {
      const knot = svgEl('circle', { class: 'edge-knot', cx: point.x, cy: point.y, r: 5, title: '折点：拖动改走线，右键删除' }, group);
      knot.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        deps.removeStructuralWaypoint?.(parent.id, childId, index);
      });
      knot.addEventListener('pointerdown', (event: PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        deps.startWaypointDrag?.(event, parent.id, childId, index);
      });
      return knot;
    });
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
    if (entry.order) entry.order.textContent = edgeOrderText(parent, childId, order);
    entry.rewire?.setAttribute('cx', String(geometry.box.x + geometry.box.width));
    entry.rewire?.setAttribute('cy', String(geometry.box.y + geometry.box.height - 18));
    // 折点圆心跟着新坐标走：拖动折点时线条与圆点必须一起动。
    const waypoints = deps.structuralWaypoints?.(parent.id, childId) ?? [];
    if (entry.knots) {
      entry.knots.forEach((knot: any, index: number) => {
        const point = waypoints[index];
        if (!point) return;
        knot.setAttribute('cx', String(point.x));
        knot.setAttribute('cy', String(point.y));
      });
    }
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
      // 拆分卡片也消费引用（「拆分来源」行）：它的引用线同样要画出来。
      if (!node || (node.type !== 'task' && node.type !== 'break' && !isBooleanInputNode(node) && !isGroupCardNode(node))) continue;
      nodeVariablePins(node).forEach((pin, index) => {
        const ref = pin.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof (pin.value as { ref?: unknown }).ref === 'string'
          ? (pin.value as { ref: string }).ref
          : '';
        const match = /^nodes\.([^\.]+)\.output(?:\.(.+))?$/.exec(ref);
        if (!match) return;
        // 引用指向拆分卡片的某个字段时，线从那个字段引脚出。
        const field = match[2] ? match[2].split('.')[0] : '';
        const source = referenceSourceById ? referenceSourceById(match[1]) : nodeById(match[1]);
        if (!source || source.id === node.id) return;
        const targetNodeId = isGroupBoundaryPin(pin) ? pin.targetNodeId : node.id;
        const targetParam = isGroupBoundaryPin(pin) ? pin.targetParam : pin.param;
        const path = (): string => {
          const currentOrigin = referenceOriginFor(source, field);
          const currentTargetPos = position(node);
          const inputOffset = expressionInputOffset(node, pin.param);
          const currentTarget = {
            x: currentTargetPos.x + (inputOffset ? inputOffset.x : variablePinX),
            y: currentTargetPos.y + (inputOffset
              ? inputOffset.y
              : baseHeight + index * rowHeightOf(node) + rowHeightOf(node) / 2),
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
