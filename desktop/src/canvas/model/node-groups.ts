import type { CanvasState } from '../state/canvas-state';
import { groupCardPosition } from '../canvas/card-follow-layout';

export interface NodeGroupRecord {
  id: string;
  name: string;
  nodeIds: string[];
  /** 用户主动暴露的成员参数；已有的跨组连接会另外自动投影到组边界。 */
  pins: Array<{ nodeId: string; param: string }>;
}

export interface NodeGroupsDeps {
  state: CanvasState;
  nodes(): any[];
  nodeById(id: string): any;
  layout(): Record<string, any>;
  mutate(fn: () => void): void;
  toast(message: string, error?: boolean): void;
  nodeWidth: number;
  nodeHeight(node: any): number;
  nodeVariablePins(node: any): any[];
  refreshView(fit?: boolean): void;
}

/**
 * 可折叠节点组只属于编辑器视图，不改变运行时节点与父子关系。
 * 数据保存在 `_nodeGroups`，运行器会像其它 `_` 前缀编辑器元数据一样忽略它。
 */
export function createNodeGroups(deps: NodeGroupsDeps) {
  const { state, nodes, nodeById, layout, mutate, toast, nodeWidth, nodeHeight, nodeVariablePins, refreshView } = deps;

  const interfaceId = (groupId: string): string => `__node_group_interface__:${groupId}`;
  const variablesId = (groupId: string): string => `__node_group_variables__:${groupId}`;

  /**
   * 组边界上的变量端点：视图里显示在组卡/接口卡上，真正读写的仍是成员节点参数。
   * `param` 是合成卡内的稳定行 id；`target*` 字段是交互层回写真实节点的路由。
   */
  function referenceSourceId(pin: any): string {
    const ref = pin?.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof pin.value.ref === 'string'
      ? pin.value.ref
      : '';
    return /^nodes\.([^\.]+)\.output/.exec(ref)?.[1] || '';
  }

  /**
   * 组边界端点由两部分组成：用户主动暴露的端点，以及当前已有的跨组数据连接。
   * 后者只存在于视图投影中，不写回 `_nodeGroups.pins`，避免打组改变文档语义。
   */
  function boundaryPins(group: NodeGroupRecord): any[] {
    const result: any[] = [];
    const members = new Set(group.nodeIds);
    const candidates = [...group.pins];
    const seen = new Set(candidates.map((pin) => `${pin.nodeId}\u0000${pin.param}`));
    for (const nodeId of group.nodeIds) {
      const node = nodeById(nodeId);
      for (const pin of node ? nodeVariablePins(node) : []) {
        const sourceId = referenceSourceId(pin);
        const crossesBoundary = Boolean(pin.variable) || Boolean(sourceId && !members.has(sourceId));
        const key = `${nodeId}\u0000${pin.param}`;
        if (!crossesBoundary || seen.has(key)) continue;
        seen.add(key);
        candidates.push({ nodeId, param: pin.param });
      }
    }
    for (const exposed of candidates) {
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
    groupsCache = entries.flatMap(([id, value]) => {
      if (!value || typeof value !== 'object') return [];
      const rawIds: unknown[] = Array.isArray(value.nodeIds) ? value.nodeIds : [];
      const nodeIds: string[] = [...new Set(rawIds.map(String).filter((nodeId) => valid.has(nodeId)))];
      if (!nodeIds.length) return [];
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

  function synthetic(group: NodeGroupRecord, memberOf: Map<string, string>): any {
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

  function syntheticInterface(group: NodeGroupRecord): any {
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
        y: Math.round((minY - 96 - 80) / 8) * 8,
      },
    };
  }

  /** 组内左侧的数据边界卡：与顶部执行入口分离，让数据线保持从左向右流动。 */
  function syntheticVariables(group: NodeGroupRecord): any | null {
    const pins = boundaryPins(group);
    const members = group.nodeIds
      .map((id) => ({ node: nodeById(id), pos: layout()[id] }))
      .filter((item) => item.node && item.pos);
    const minX = members.length ? Math.min(...members.map((item) => item.pos.x)) : 0;
    const minY = members.length ? Math.min(...members.map((item) => item.pos.y)) : 0;
    const maxY = members.length
      ? Math.max(...members.map((item) => item.pos.y + nodeHeight(item.node)))
      : minY + 96;
    return {
      id: variablesId(group.id),
      type: 'node_group_variables',
      name: `${group.name} 变量`,
      children: [],
      _nodeGroupVariables: true,
      _nodeGroupId: group.id,
      _groupPins: pins,
      _nodeGroupHeight: Math.max(96 + pins.length * 24, maxY - minY),
      _nodeGroupPosition: {
        x: Math.round((minX - nodeWidth - 96) / 8) * 8,
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
      result = [syntheticInterface(scope), ...(variables ? [variables] : []), ...members];
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
    mutate(() => {
      table(true)[id] = { name: `节点组 ${groups().length + 1}`, nodeIds: ids, pins: [] };
      invalidate();
      layout()[id] = at;
      state.selected = new Set([id]);
      state.selectedEdge = null;
      state.selectedRun = null;
    });
    refreshView();
    toast(`已将 ${ids.length} 个节点打组`);
    return true;
  }

  function enterGroup(id: string): boolean {
    const group = groupById(id);
    if (!group) return false;
    state.nodeGroupId = id;
    state.selected.clear();
    state.selectedEdge = null;
    state.selectedRun = null;
    refreshView(true);
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
    });
    refreshView(true);
    toast('节点组已解散，节点和执行关系保持不变');
    return true;
  }

  function addToCurrentGroup(ids: string[]): void {
    const group = currentGroup();
    if (!group || !ids.length) return;
    const value = table()[group.id];
    if (value) {
      value.nodeIds = [...new Set([...(Array.isArray(value.nodeIds) ? value.nodeIds : []), ...ids])];
      invalidate();
    }
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
    const existing = new Set(boundaryPins(group).map((pin) => `${pin.targetNodeId}\u0000${pin.targetParam}`));
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
    });
    refreshView();
    toast(exposed ? `已将「${pin.label || param}」添加到组接口` : `已从组接口移除「${pin.label || param}」`);
    return true;
  }

  return {
    groups, groupById, currentGroup, viewNodes, viewNodeById, viewReferenceSourceById, adjacentEdges,
    groupSelection, enterGroup, leaveGroup, ungroup, addToCurrentGroup,
    pinExposure, pinCandidates, setPinExposed,
  };
}
