import type { CanvasState } from '../state/canvas-state';
import type { MenuEntry } from '../ui/overlays';
import { groupCardPosition, groupVariableCardIds } from '../canvas/card-follow-layout';
import { summarizeNodeGroupRun } from './node-group-runtime';

export interface NodeGroupRecord {
  id: string;
  name: string;
  nodeIds: string[];
  /** 用户主动暴露或打组时为保留既有跨组连接而固化的成员参数。 */
  pins: Array<{ nodeId: string; param: string }>;
}

export interface NodeGroupsDeps {
  state: CanvasState;
  nodes(): any[];
  nodeById(id: string): any;
  layout(): Record<string, any>;
  mutate(fn: () => void, options?: { render?: boolean }): void;
  toast(message: string, error?: boolean): void;
  nodeWidth: number;
  nodeHeight(node: any): number;
  nodeVariablePins(node: any): any[];
  /** 卡片基准高度与端点行高：组卡布局、连线锚点与渲染共用同一套尺寸。 */
  baseHeight: number;
  runVariableHeight: number;
  /** 旧组元数据完成无历史迁移后标记文档需要保存。 */
  markDirty?(): void;
  refreshView(fit?: boolean): void;
  /** 进入运行中的组后，把视野直接落到真实成员节点。 */
  focusNode?(nodeId: string): void;
}

/**
 * 组边界上的变量端点：视图里显示在组卡/接口卡上，真正读写的仍是成员节点参数。
 * `param` 是合成卡内的稳定行 id；`target*` 字段是交互层回写真实节点的路由。
 * 组接口只读取持久化端点（`_nodeGroups[groupId].pins`），不在每次渲染时自动发现。
 * 新建组时会把已经跨越新组边界的输入连接固化进去，避免打组让现有连线消失；
 * 其余端点生命周期由「添加到组接口 / 从组接口移除」决定。
 */
export interface GroupBoundaryPin {
  /** 合成卡内的稳定行 id；真实成员参数见 targetParam。 */
  param: string;
  label: string;
  targetNodeId: string;
  targetParam: string;
  targetIndex: number;
  _targetNode: any;
  _nodeGroupPin: true;
  [key: string]: any;
}

/** 折叠视图里的组卡：代理整组的执行进出与显式暴露的数据端点。 */
export interface ProjectedGroupCardNode {
  id: string;
  type: 'node_group';
  name: string;
  children: string[];
  _nodeGroup: true;
  /** 组 id：三张合成卡（组卡/接口卡/变量卡）都用它归一到同一个组名编辑。 */
  _nodeGroupId?: string;
  _nodeCount: number;
  _groupPins: GroupBoundaryPin[];
  _hasReferenceOutput: boolean;
}

/** 组内顶部的执行接口卡：组内成员从它进入。 */
export interface ProjectedGroupInterfaceNode {
  id: string;
  type: 'node_group_interface';
  name: string;
  children: string[];
  _nodeGroupInterface: true;
  _nodeGroupId: string;
  _groupPins: GroupBoundaryPin[];
  _nodeGroupPosition: { x: number; y: number };
}

/** 组内左侧的变量卡：显示组接口数据端点，并提供「＋」创建入口。 */
export interface ProjectedGroupVariablesNode {
  id: string;
  type: 'node_group_variables';
  name: string;
  children: string[];
  _nodeGroupVariables: true;
  _nodeGroupId: string;
  _groupPins: GroupBoundaryPin[];
  _nodeGroupHeight: number;
  _nodeGroupPosition: { x: number; y: number };
}

export type ProjectedGroupNode =
  | ProjectedGroupCardNode
  | ProjectedGroupInterfaceNode
  | ProjectedGroupVariablesNode;

/** 进入组内后按当前可见成员重新投影的真实节点。 */
export interface ProjectedGroupMemberNode {
  id: string;
  children?: string[];
  _nodeGroupMember: true;
  [key: string]: any;
}

export function isProjectedGroupNode(node: any): node is ProjectedGroupNode {
  return Boolean(node && (node._nodeGroup || node._nodeGroupInterface || node._nodeGroupVariables));
}

export function isGroupCardNode(node: any): node is ProjectedGroupCardNode {
  return Boolean(node && node._nodeGroup === true);
}

export function isGroupInterfaceNode(node: any): node is ProjectedGroupInterfaceNode {
  return Boolean(node && node._nodeGroupInterface === true);
}

export function isGroupVariablesNode(node: any): node is ProjectedGroupVariablesNode {
  return Boolean(node && node._nodeGroupVariables === true);
}

export function isGroupMemberNode(node: any): node is ProjectedGroupMemberNode {
  return Boolean(node && node._nodeGroupMember === true);
}

export function isGroupBoundaryPin(pin: any): pin is GroupBoundaryPin {
  return Boolean(pin && pin._nodeGroupPin === true);
}

/** 组内接口卡与成员顶部之间的纵向净空。 */
const INTERFACE_GAP = 80;
/** 组变量卡与成员左侧之间的横向净空。 */
const VARIABLES_GAP = 96;

/**
 * 可折叠节点组只属于编辑器视图，不改变运行时节点与父子关系。
 * 数据保存在 `_nodeGroups`，运行器会像其它 `_` 前缀编辑器元数据一样忽略它。
 */
export function createNodeGroups(deps: NodeGroupsDeps) {
  const {
    state, nodes, nodeById, layout, mutate, toast, nodeWidth, nodeHeight, nodeVariablePins, refreshView,
    baseHeight, runVariableHeight, markDirty, focusNode,
  } = deps;

  const interfaceId = (groupId: string): string => `__node_group_interface__:${groupId}`;
  const variablesId = (groupId: string): string => `__node_group_variables__:${groupId}`;

  /** 读取 `{ref: 'nodes.<id>.output...'}` 里的源节点 id；没有则返回空串。 */
  function referenceSourceId(pin: any): string {
    const ref = pin?.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof pin.value.ref === 'string'
      ? pin.value.ref
      : '';
    return /^nodes\.([^\.]+)\.output/.exec(ref)?.[1] || '';
  }

  /** 组接口端点：只投影用户显式暴露的成员参数（`group.pins`），不做任何自动发现。 */
  function boundaryPins(group: NodeGroupRecord): GroupBoundaryPin[] {
    const result: GroupBoundaryPin[] = [];
    for (const exposed of group.pins) {
      const node = nodeById(exposed.nodeId);
      if (!node) continue;
      const pins = nodeVariablePins(node);
      const targetIndex = pins.findIndex((pin) => pin.param === exposed.param);
      if (targetIndex < 0) continue;
      const pin = pins[targetIndex];
      result.push({
        ...pin,
        param: `group-pin:${result.length}`,
        label: `${node.name || node.id} · ${pin.label || pin.param}`,
        targetNodeId: node.id,
        targetParam: pin.param,
        targetIndex,
        _targetNode: node,
        _nodeGroupPin: true,
      });
    }
    return result;
  }

  /**
   * 打组前已经存在的跨边界输入必须获得代理端点，否则折叠后变量线/引用线会失去目标。
   * 这里只在结构变更时计算一次并写入 `group.pins`，不是恢复按渲染状态自动生成端点。
   */
  function connectedBoundaryPinSpecs(memberIds: string[], candidates = memberIds): Array<{ nodeId: string; param: string }> {
    const members = new Set(memberIds);
    const result: Array<{ nodeId: string; param: string }> = [];
    const seen = new Set<string>();
    for (const nodeId of candidates) {
      if (!members.has(nodeId)) continue;
      const node = nodeById(nodeId);
      for (const pin of node ? nodeVariablePins(node) : []) {
        const param = String(pin?.param || '');
        const sourceId = referenceSourceId(pin);
        const crossesBoundary = Boolean(pin?.variable) || Boolean(sourceId && !members.has(sourceId));
        const key = `${nodeId}\u0000${param}`;
        if (!param || !crossesBoundary || seen.has(key)) continue;
        seen.add(key);
        result.push({ nodeId, param });
      }
    }
    return result;
  }

  /** 是否有组外节点引用了组内成员输出：有则在组卡右侧显示「节点输出引用」口。 */
  function hasExternalReferenceOutput(group: NodeGroupRecord): boolean {
    const members = new Set(group.nodeIds);
    return nodes().some((node) => !members.has(node.id)
      && nodeVariablePins(node).some((pin) => members.has(referenceSourceId(pin))));
  }

  function entryNodeIds(group: NodeGroupRecord): string[] {
    const members = new Set(group.nodeIds);
    const hasInternalParent = new Set<string>();
    for (const nodeId of group.nodeIds) {
      const node = nodeById(nodeId);
      for (const childId of Array.isArray(node?.children) ? node.children : []) {
        if (members.has(String(childId))) hasInternalParent.add(String(childId));
      }
    }
    return group.nodeIds.filter((nodeId) => !hasInternalParent.has(nodeId));
  }

  function table(create = false): Record<string, any> {
    if (!state.raw || typeof state.raw !== 'object') return {};
    if (!state.raw._nodeGroups || typeof state.raw._nodeGroups !== 'object' || Array.isArray(state.raw._nodeGroups)) {
      if (!create) return {};
      state.raw._nodeGroups = {};
    }
    return state.raw._nodeGroups;
  }

  let groupsVersion = -1;
  let groupsRaw: unknown = null;
  let groupsCache: NodeGroupRecord[] = [];
  function invalidate(): void {
    groupsVersion = -1;
    projectionKey = '';
  }
  function groups(): NodeGroupRecord[] {
    const source = table();
    const version = Number(state.docVersion || 0);
    if (groupsVersion === version && groupsRaw === source) return groupsCache;
    const entries = Object.entries(source);
    if (!entries.length) {
      groupsVersion = version;
      groupsRaw = source;
      groupsCache = [];
      return groupsCache;
    }
    const valid = new Set(nodes().map((node) => String(node.id)));
    let migrated = false;
    groupsCache = entries.flatMap(([id, value]) => {
      if (!value || typeof value !== 'object') return [];
      const rawIds: unknown[] = Array.isArray(value.nodeIds) ? value.nodeIds : [];
      const nodeIds: string[] = [...new Set(rawIds.map(String).filter((nodeId) => valid.has(nodeId)))];
      if (!nodeIds.length) return [];
      // 旧版本已经可能保存了空 pins，导致打组前的外部连接没有代理端点。
      // 只迁移一次并写入策略标记；之后端点完全由持久化配置控制，不再动态补回。
      if (value.pinPolicy !== 'explicit-v1') {
        const rawPins = Array.isArray(value.pins) ? value.pins : [];
        const seen = new Set(rawPins.map((pin: any) => `${String(pin?.nodeId || '')}\u0000${String(pin?.param || '')}`));
        const connected = connectedBoundaryPinSpecs(nodeIds)
          .filter((pin) => !seen.has(`${pin.nodeId}\u0000${pin.param}`));
        value.pins = [...rawPins, ...connected];
        value.pinPolicy = 'explicit-v1';
        migrated = true;
      }
      const seenPins = new Set<string>();
      const pins = (Array.isArray(value.pins) ? value.pins : []).flatMap((pin: any) => {
        const nodeId = String(pin?.nodeId || '');
        const param = String(pin?.param || '');
        const key = `${nodeId}\u0000${param}`;
        if (!nodeIds.includes(nodeId) || !param || seenPins.has(key)) return [];
        const node = nodeById(nodeId);
        if (!node || !nodeVariablePins(node).some((item) => item.param === param)) return [];
        seenPins.add(key);
        return [{ nodeId, param }];
      });
      return [{ id, name: String(value.name || '节点组'), nodeIds, pins }];
    });
    groupsVersion = version;
    groupsRaw = source;
    if (migrated) markDirty?.();
    return groupsCache;
  }

  function groupById(id: string): NodeGroupRecord | null {
    return groups().find((group) => group.id === id) || null;
  }

  function currentGroup(): NodeGroupRecord | null {
    const id = String(state.nodeGroupId || '');
    const group = id ? groupById(id) : null;
    if (!group && id) state.nodeGroupId = '';
    return group;
  }

  /**
   * 当前组边界卡上已经代表的变量（`作用域.变量名`）。
   *
   * 这些变量在组内视图里由边界行表示，画布上不该再画一张同名变量卡——否则同一个变量
   * 会同时出现在边界行和画布卡片里（用户看到的就是「一个变量画了两遍」）。
   * 只是在**组内视图**里不画：文档里的卡片本身不动，退出组后照旧显示。
   */
  function boundaryVariableRefs(): Set<string> {
    const scope = currentGroup();
    const refs = new Set<string>();
    if (!scope) return refs;
    for (const pin of boundaryPins(scope)) {
      if (!pin || !pin.variable) continue;
      refs.add(`${pin.scope === 'variables' ? 'variables' : 'inputs'}.${pin.variable}`);
    }
    return refs;
  }

  /**
   * 组内视图该画哪些变量卡片（卡 id 集合）。不在组内时返回空集合，调用方照旧画全部卡片。
   *
   * 只在**文档版本、当前组或成员表**变化时重算：这份集合要扫全部节点的端点与引用
   * （`groupVariableCardIds`），而 `editor.variableCardList()` 在渲染、命中测试、连线与
   * 画布签名里每帧都会被调用好几次，不能每次都算。
   */
  let cardScopeKey = '';
  let cardScopeValue = new Set<string>();
  function visibleVariableCardIds(): Set<string> {
    const scope = currentGroup();
    if (!scope) {
      cardScopeKey = '';
      cardScopeValue = new Set();
      return cardScopeValue;
    }
    const key = `${Number(state.docVersion || 0)}|${scope.id}|${scope.nodeIds.join(',')}`;
    if (key !== cardScopeKey) {
      cardScopeKey = key;
      cardScopeValue = groupVariableCardIds(state.raw, scope.id, nodes(), nodeVariablePins);
    }
    return cardScopeValue;
  }

  /** 读取真实成员节点的即时运行态；不依赖投影缓存，也不污染持久化组元数据。 */
  function runSummary(groupId: string) {
    const group = groupById(groupId);
    return group ? summarizeNodeGroupRun(group.nodeIds, state.run, nodeById) : null;
  }

  function membership(): Map<string, string> {
    const result = new Map<string, string>();
    for (const group of groups()) for (const id of group.nodeIds) if (!result.has(id)) result.set(id, group.id);
    return result;
  }

  function projectedChildren(node: any, visible: Set<string>, memberOf: Map<string, string>, scopeId = ''): string[] {
    const result: string[] = [];
    for (const child of Array.isArray(node?.children) ? node.children : []) {
      const target = scopeId ? (visible.has(child) ? child : '') : (memberOf.get(child) || child);
      if (target && target !== node.id && !result.includes(target)) result.push(target);
    }
    return result;
  }

  function synthetic(group: NodeGroupRecord, memberOf: Map<string, string>): ProjectedGroupCardNode {
    const targets: string[] = [];
    for (const id of group.nodeIds) {
      const node = nodeById(id);
      for (const child of Array.isArray(node?.children) ? node.children : []) {
        const target = memberOf.get(child) || child;
        if (target !== group.id && !targets.includes(target)) targets.push(target);
      }
    }
    return {
      id: group.id,
      type: 'node_group',
      name: group.name,
      children: targets,
      _nodeGroup: true,
      _nodeCount: group.nodeIds.length,
      _groupPins: boundaryPins(group),
      _hasReferenceOutput: hasExternalReferenceOutput(group),
    };
  }

  function syntheticInterface(group: NodeGroupRecord): ProjectedGroupInterfaceNode {
    const entries = entryNodeIds(group);
    const memberPositions = group.nodeIds.map((id) => layout()[id]).filter(Boolean);
    const centerX = memberPositions.length
      ? (Math.min(...memberPositions.map((pos) => pos.x)) + Math.max(...memberPositions.map((pos) => pos.x + nodeWidth))) / 2
      : nodeWidth / 2;
    const minY = memberPositions.length ? Math.min(...memberPositions.map((pos) => pos.y)) : 0;
    return {
      id: interfaceId(group.id),
      type: 'node_group_interface',
      name: `${group.name} 接口`,
      children: entries,
      _nodeGroupInterface: true,
      _nodeGroupId: group.id,
      _groupPins: [],
      _nodeGroupPosition: {
        x: Math.round((centerX - nodeWidth / 2) / 8) * 8,
        // 接口卡自身高度 = baseHeight，底边落在成员顶部上方 INTERFACE_GAP 处。
        y: Math.round((minY - baseHeight - INTERFACE_GAP) / 8) * 8,
      },
    };
  }

  /** 组内左侧的数据边界卡：与顶部执行入口分离，让数据线保持从左向右流动。 */
  function syntheticVariables(group: NodeGroupRecord): ProjectedGroupVariablesNode {
    const pins = boundaryPins(group);
    const members = group.nodeIds
      .map((id) => ({ node: nodeById(id), pos: layout()[id] }))
      .filter((item) => item.node && item.pos);
    const minX = members.length ? Math.min(...members.map((item) => item.pos.x)) : 0;
    const minY = members.length ? Math.min(...members.map((item) => item.pos.y)) : 0;
    const maxY = members.length
      ? Math.max(...members.map((item) => item.pos.y + nodeHeight(item.node)))
      : minY + baseHeight;
    return {
      id: variablesId(group.id),
      type: 'node_group_variables',
      name: `${group.name} 变量`,
      children: [],
      _nodeGroupVariables: true,
      _nodeGroupId: group.id,
      _groupPins: pins,
      // 高度 = 端点区（baseHeight + 行数 × 行高）与成员区高度取较大者。
      _nodeGroupHeight: Math.max(baseHeight + pins.length * runVariableHeight, maxY - minY),
      _nodeGroupPosition: {
        x: Math.round((minX - nodeWidth - VARIABLES_GAP) / 8) * 8,
        y: Math.round(minY / 8) * 8,
      },
    };
  }

  let projectionKey = '';
  let projectionNodes: any[] = [];
  let projectionById = new Map<string, any>();

  /** 当前层级用于画布渲染的投影视图。 */
  function viewNodes(): any[] {
    const scope = currentGroup();
    const allGroups = groups();
    // 没有分组的绝大多数工作流直接走原模型，避免给 500 节点画布增加克隆和 O(n²) 查找。
    if (!scope && !allGroups.length) return nodes();
    const key = `${Number(state.docVersion || 0)}|${scope?.id || ''}|${allGroups.map((group) => `${group.id}:${group.nodeIds.join(',')}`).join('|')}`;
    if (key === projectionKey) return projectionNodes;
    let result: any[];
    if (scope) {
      const visible = new Set(scope.nodeIds);
      const members = nodes().filter((node) => visible.has(node.id)).map((node) => ({
        ...node,
        _nodeGroupMember: true,
        ...(Array.isArray(node.children) ? { children: projectedChildren(node, visible, new Map(), scope.id) } : {}),
      }));
      const variables = syntheticVariables(scope);
      result = [syntheticInterface(scope), variables, ...members];
    } else {
      const memberOf = membership();
      const visibleReal = nodes().filter((node) => !memberOf.has(node.id));
      const projected = visibleReal.map((node) => ({
        ...node,
        ...(Array.isArray(node.children) ? { children: projectedChildren(node, new Set(), memberOf) } : {}),
      }));
      result = [...projected, ...allGroups.map((group) => synthetic(group, memberOf))];
    }
    projectionKey = key;
    projectionNodes = result;
    projectionById = new Map(result.map((node) => [node.id, node]));
    return result;
  }

  function viewNodeById(id: string): any {
    if (!currentGroup() && !groups().length) return nodeById(id);
    viewNodes();
    return projectionById.get(id) || null;
  }

  /** 折叠视图里，组内引用源由组卡代理；进入组内后只解析当前可见成员。 */
  function viewReferenceSourceById(id: string): any {
    const scope = currentGroup();
    if (scope) return scope.nodeIds.includes(id) ? viewNodeById(id) : null;
    const groupId = membership().get(id);
    return viewNodeById(groupId || id);
  }

  /**
   * 折叠组的执行边只是视觉代理，运行事件仍以真实节点 id 上报。
   * 返回一条可见边实际指向的节点，供连线继承运行态并在事件到达时局部刷新。
   */
  function viewEdgeRunTargetIds(parentId: string, childId: string): string[] {
    if (currentGroup()) return [childId];
    const memberOf = membership();
    const sourceGroup = groupById(parentId);
    const sourceIds = sourceGroup ? sourceGroup.nodeIds : [parentId];
    const targets: string[] = [];
    for (const sourceId of sourceIds) {
      const source = nodeById(sourceId);
      for (const targetId of Array.isArray(source?.children) ? source.children : []) {
        const realTargetId = String(targetId);
        const projectedTargetId = memberOf.get(realTargetId) || realTargetId;
        if (projectedTargetId !== childId) continue;
        if (!targets.includes(realTargetId)) targets.push(realTargetId);
      }
    }
    if (targets.length) return targets;
    // 损坏或旧布局若缺少直接边，至少仍以组入口节点驱动代理线，不能回退到永远收不到事件的合成组 id。
    const targetGroup = groupById(childId);
    return targetGroup ? entryNodeIds(targetGroup) : [childId];
  }

  /** 当前投影视图中与卡片相邻的执行边；拖拽组卡时必须使用它同步更新折叠线。 */
  function adjacentEdges(id: string): Array<{ parent: any; childId: string; order: number }> {
    const result: Array<{ parent: any; childId: string; order: number }> = [];
    for (const parent of viewNodes()) {
      const children: string[] = Array.isArray(parent.children) ? parent.children : [];
      children.forEach((childId, order) => {
        if (parent.id === id || childId === id) result.push({ parent, childId, order });
      });
    }
    return result;
  }

  function nextId(): string {
    let index = 1;
    const used = new Set([...nodes().map((node) => String(node.id)), ...groups().map((group) => group.id)]);
    while (used.has(`node_group_${index}`)) index += 1;
    return `node_group_${index}`;
  }

  function groupSelection(): boolean {
    if (currentGroup()) {
      toast('暂不支持在节点组内继续嵌套打组', true);
      return false;
    }
    const memberOf = membership();
    const ids = [...state.selected].filter((id) => {
      const node = nodeById(id);
      return node && node.type !== 'root' && !memberOf.has(id);
    });
    if (ids.length < 2) {
      toast('请至少选择两个尚未打组的节点', true);
      return false;
    }
    const id = nextId();
    const positions = ids.map((nodeId) => ({ node: nodeById(nodeId), pos: layout()[nodeId] || { x: 0, y: 0 } }));
    // 组卡落在成员包围盒中心：与「自动排列」后的归位共用同一个公式（card-follow-layout）。
    const at = groupCardPosition(
      positions.map((item) => ({ pos: item.pos, height: nodeHeight(item.node) })),
      nodeWidth,
    ) ?? { x: 0, y: 0 };
    const pins = connectedBoundaryPinSpecs(ids);
    mutate(() => {
      table(true)[id] = { name: `节点组 ${groups().length + 1}`, nodeIds: ids, pins, pinPolicy: 'explicit-v1' };
      invalidate();
      layout()[id] = at;
      state.selected = new Set([id]);
      state.selectedEdge = null;
      state.selectedRun = null;
    }, { render: false });
    refreshView();
    toast(`已将 ${ids.length} 个节点打组`);
    return true;
  }

  function enterGroup(id: string, preferredNodeId = ''): boolean {
    const group = groupById(id);
    if (!group) return false;
    const targetId = group.nodeIds.includes(preferredNodeId) ? preferredNodeId : '';
    state.nodeGroupId = id;
    state.selected = targetId ? new Set([targetId]) : new Set();
    state.selectedEdge = null;
    state.selectedRun = null;
    refreshView(!targetId);
    if (targetId) focusNode?.(targetId);
    return true;
  }

  function leaveGroup(): boolean {
    const id = String(state.nodeGroupId || '');
    if (!id) return false;
    state.nodeGroupId = '';
    state.selected = groupById(id) ? new Set([id]) : new Set();
    state.selectedEdge = null;
    state.selectedRun = null;
    refreshView(true);
    return true;
  }

  function ungroup(id: string): boolean {
    const group = groupById(id);
    if (!group) return false;
    mutate(() => {
      delete table()[id];
      invalidate();
      delete layout()[id];
      delete layout()[interfaceId(id)];
      delete layout()[variablesId(id)];
      if (state.nodeGroupId === id) state.nodeGroupId = '';
      state.selected = new Set(group.nodeIds.filter((nodeId) => nodeById(nodeId)));
    }, { render: false });
    refreshView(true);
    toast('节点组已解散，节点和执行关系保持不变');
    return true;
  }

  /** 重命名编辑器节点组；运行节点 id、执行关系与成员名称都不受影响。 */
  function renameGroup(id: string, name: string): boolean {
    const value = table()[id];
    const next = String(name || '').trim();
    if (!value || typeof value !== 'object' || !next) return false;
    if (String(value.name || '') === next) return true;
    mutate(() => {
      value.name = next;
      invalidate();
    }, { render: false });
    refreshView();
    return true;
  }

  function addToCurrentGroup(ids: string[]): void {
    const group = currentGroup();
    if (!group || !ids.length) return;
    const value = table()[group.id];
    if (value) {
      const nextIds = [...new Set([...(Array.isArray(value.nodeIds) ? value.nodeIds : []), ...ids])];
      const rawPins = Array.isArray(value.pins) ? value.pins : [];
      const seen = new Set(rawPins.map((pin: any) => `${String(pin?.nodeId || '')}\u0000${String(pin?.param || '')}`));
      const connected = connectedBoundaryPinSpecs(nextIds, ids)
        .filter((pin) => !seen.has(`${pin.nodeId}\u0000${pin.param}`));
      value.nodeIds = nextIds;
      value.pins = [...rawPins, ...connected];
      invalidate();
    }
  }

  /**
   * 删除/剪切节点后原子清理组元数据：从成员与端点里移除这些节点，
   * 没有剩余成员的组整组删除（含它的布局残留）。调用方必须处于同一次 mutate 内。
   */
  function removeMembers(ids: string[]): void {
    const removed = new Set(ids.map(String));
    if (!removed.size) return;
    const source = table();
    for (const [id, value] of Object.entries(source)) {
      if (!value || typeof value !== 'object') continue;
      const nextIds = (Array.isArray(value.nodeIds) ? value.nodeIds : []).filter((nodeId: any) => !removed.has(String(nodeId)));
      value.nodeIds = nextIds;
      if (Array.isArray(value.pins)) {
        value.pins = value.pins.filter((pin: any) => !removed.has(String(pin?.nodeId)));
      }
      if (!nextIds.length) {
        delete source[id];
        delete layout()[id];
        delete layout()[interfaceId(id)];
        delete layout()[variablesId(id)];
        if (state.nodeGroupId === id) state.nodeGroupId = '';
      }
    }
    invalidate();
  }

  /** 当前组内的某个成员参数是否已经被用户暴露到组接口；组外返回 null。 */
  function pinExposure(nodeId: string, param: string): boolean | null {
    const group = currentGroup();
    if (!group || !group.nodeIds.includes(nodeId)) return null;
    const node = nodeById(nodeId);
    if (!node || !nodeVariablePins(node).some((pin) => pin.param === param)) return null;
    return group.pins.some((pin) => pin.nodeId === nodeId && pin.param === param);
  }

  /** 当前组变量卡还能创建的接口变量；名称和类型继承真实成员参数。 */
  function pinCandidates(groupId = String(state.nodeGroupId || '')): Array<{ nodeId: string; nodeName: string; param: string; label: string; type: string }> {
    const group = groupById(groupId);
    if (!group) return [];
    // 只把已经持久化的端点视为已存在：绑定/引用等连接状态不再自动占位。
    const existing = new Set(group.pins.map((pin) => `${pin.nodeId}\u0000${pin.param}`));
    const result: Array<{ nodeId: string; nodeName: string; param: string; label: string; type: string }> = [];
    for (const nodeId of group.nodeIds) {
      const node = nodeById(nodeId);
      if (!node) continue;
      for (const pin of nodeVariablePins(node)) {
        const param = String(pin?.param || '');
        if (!param || existing.has(`${nodeId}\u0000${param}`)) continue;
        result.push({
          nodeId,
          nodeName: String(node.name || node.id),
          param,
          label: String(pin.label || param),
          type: String(pin.type || pin.definition?.type || 'any'),
        });
      }
    }
    return result;
  }

  /** 显式添加或移除组接口端点，不改变成员节点的参数值和现有变量绑定。 */
  function setPinExposed(nodeId: string, param: string, exposed: boolean): boolean {
    const group = currentGroup();
    if (!group || !group.nodeIds.includes(nodeId)) return false;
    const node = nodeById(nodeId);
    const pin = node && nodeVariablePins(node).find((item) => item.param === param);
    if (!pin) return false;
    const value = table()[group.id];
    if (!value) return false;
    const rawPins = Array.isArray(value.pins) ? value.pins : [];
    const already = rawPins.some((item: any) => String(item?.nodeId) === nodeId && String(item?.param) === param);
    if (already === exposed) return true;
    mutate(() => {
      value.pins = exposed
        ? [...rawPins, { nodeId, param }]
        : rawPins.filter((item: any) => String(item?.nodeId) !== nodeId || String(item?.param) !== param);
      invalidate();
    }, { render: false });
    refreshView();
    toast(exposed ? `已将「${pin.label || param}」添加到组接口` : `已从组接口移除「${pin.label || param}」`);
    return true;
  }

  /** 端口右键菜单的「添加到组接口 / 从组接口移除」项；不在可编辑节点组内返回 null。 */
  function pinMenuEntry(nodeId: string, param: string): MenuEntry | null {
    const exposed = pinExposure(nodeId, param);
    if (exposed === null) return null;
    return exposed
      ? { label: '从组接口移除', danger: true, run: () => { setPinExposed(nodeId, param, false); } }
      : { label: '添加到组接口', run: () => { setPinExposed(nodeId, param, true); } };
  }

  /** 组变量卡「＋」菜单：按成员分组的候选参数（未暴露的成员端点）。 */
  function candidateMenu(groupId = String(state.nodeGroupId || '')): MenuEntry[] {
    const candidates = pinCandidates(groupId);
    const grouped = new Map<string, { nodeName: string; children: Exclude<MenuEntry, 'separator'>[] }>();
    for (const candidate of candidates) {
      let item = grouped.get(candidate.nodeId);
      if (!item) grouped.set(candidate.nodeId, item = { nodeName: candidate.nodeName, children: [] });
      item.children.push({
        label: `${candidate.label} · ${candidate.type}`,
        run: () => { setPinExposed(candidate.nodeId, candidate.param, true); },
      });
    }
    if (!grouped.size) return [{ label: '没有可添加的参数' }];
    return [...grouped.values()].map((item) => ({ label: item.nodeName, children: item.children }));
  }

  return {
    groups, groupById, currentGroup, runSummary, viewNodes, viewNodeById, viewReferenceSourceById, viewEdgeRunTargetIds, adjacentEdges,
    groupSelection, enterGroup, leaveGroup, ungroup, renameGroup, addToCurrentGroup, removeMembers,
    pinExposure, pinCandidates, setPinExposed, pinMenuEntry, candidateMenu, boundaryVariableRefs, visibleVariableCardIds,
  };
}
