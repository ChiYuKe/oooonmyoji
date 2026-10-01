import type { CanvasState } from '../state/canvas-state';
import type { MenuEntry } from '../ui/overlays';
import { groupCardPosition, groupVariableCardIds } from '../canvas/card-follow-layout';
import { GROUP_ENTRY_TYPE, GROUP_EXIT_TYPE } from '../../shared/workflow/types';
import { nextNodeId } from '../../shared/workflow/node-identifiers';
import { conditionPortsOf } from './exec-ports';
import { summarizeNodeGroupRun } from './node-group-runtime';

export interface NodeGroupRecord {
  id: string;
  name: string;
  nodeIds: string[];
  /** 用户主动暴露或打组时为保留既有跨组连接而固化的成员参数。 */
  pins: Array<{ nodeId: string; param: string }>;
  execInputs: string[];
  execOutputs: string[];
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
  /** 节点显示标题（值卡片是类型派生标题）；缺省时退回 `name || id`。 */
  nodeTitle?(node: any): string;
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
  _referenceOutputs?: Array<{ nodeId: string; field: string; ref: string }>;
  _execOutputCount?: number;
  _execOutputNames?: string[];
  /** 组外进来几条执行边（= 几张组入口卡）：组卡顶边按这个数排输入口。 */
  _groupEntryCount?: number;
  _groupEntryNames?: string[];
}

/**
 * 折叠图卡片执行口的横向位置：`count` 个口平分卡片宽度（口间距相同、两端留半格），
 * 单个口落在顶边/底边中点。输入侧（组入口）与输出侧（组出口）共用这一份排法，
 * 于是判断的真/假不会挤在中点，而是各落各的口——与线本身的位置一致。
 */
export function groupPortOffset(nodeWidth: number, index: number, count: number): number {
  const total = Math.max(1, count);
  if (total === 1) return nodeWidth / 2;
  const safe = Math.max(0, Math.min(index, total - 1));
  return (nodeWidth * (safe + 1)) / (total + 1);
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
  _execOutputCount: number;
  _execOutputNames?: string[];
  _nodeGroupPosition: { x: number; y: number };
}

/** 组内统一的执行出口卡：成员的多条组外出边都投影到这一个节点上。 */
export interface ProjectedGroupOutputNode {
  id: string;
  type: 'node_group_output';
  name: string;
  children: string[];
  _nodeGroupOutput: true;
  _nodeGroupId: string;
  _execInputCount: number;
  _execInputNames?: string[];
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
  | ProjectedGroupOutputNode
  | ProjectedGroupVariablesNode;

/** 进入组内后按当前可见成员重新投影的真实节点。 */
export interface ProjectedGroupMemberNode {
  id: string;
  children?: string[];
  _nodeGroupMember: true;
  [key: string]: any;
}

export function isProjectedGroupNode(node: any): node is ProjectedGroupNode {
  return Boolean(node && (node._nodeGroup || node._nodeGroupInterface || node._nodeGroupOutput || node._nodeGroupVariables));
}

export function isGroupCardNode(node: any): node is ProjectedGroupCardNode {
  return Boolean(node && node._nodeGroup === true);
}

export function isGroupInterfaceNode(node: any): node is ProjectedGroupInterfaceNode {
  return Boolean(node && node._nodeGroupInterface === true);
}

export function isGroupOutputInterfaceNode(node: any): node is ProjectedGroupOutputNode {
  return Boolean(node && node._nodeGroupOutput === true);
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
 * 折叠图边界卡：**真实的执行流隧道节点**（UE 的 Collapsed Graph Tunnel）。
 *
 * 折叠图不是「视图上的一个框」——跨边界的执行边真的经过这两类卡：
 * `组外父 → group_entry → 组内子`、`组内父 → group_exit → 组外子`。
 * 每条跨组边各得一张卡（UE 一个连接一个隧道），组卡只把这些真实边投影成自己的端口；
 * 运行时把它们当透传容器（等价于只有一个子节点的 sequence），执行语义零变化。
 *
 * 因此组内视图里判断卡的真/否不再是悬空箭头：它们真的接在组出口卡上，
 * 而组出口卡的另一侧就是组外的真实目标（展开折叠图时这两条边直接相接）。
 */
export { GROUP_ENTRY_TYPE, GROUP_EXIT_TYPE };

export function isGroupEntryNode(node: any): boolean {
  return Boolean(node) && node.type === GROUP_ENTRY_TYPE;
}

export function isGroupExitNode(node: any): boolean {
  return Boolean(node) && node.type === GROUP_EXIT_TYPE;
}

/** 折叠图边界卡（组入口 / 组出口）。 */
export function isGroupBoundaryNode(node: any): boolean {
  return isGroupEntryNode(node) || isGroupExitNode(node);
}

/**
 * 可折叠节点组只属于编辑器视图，不改变运行时节点与父子关系。
 * 数据保存在 `_nodeGroups`，运行器会像其它 `_` 前缀编辑器元数据一样忽略它。
 *
 * 例外是**边界卡**：它们是文档里的真实节点（`group_entry` / `group_exit`），
 * 真的参与执行流（见上面的注释），所以打组/展开折叠图会改写 `children`。
 */
export function createNodeGroups(deps: NodeGroupsDeps) {
  const {
    state, nodes, nodeById, layout, mutate, toast, nodeWidth, nodeHeight, nodeVariablePins, refreshView,
    baseHeight, runVariableHeight, markDirty, focusNode,
  } = deps;

  const interfaceId = (groupId: string): string => `__node_group_interface__:${groupId}`;
  const outputInterfaceId = (groupId: string): string => `__node_group_output__:${groupId}`;
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
        label: `${deps.nodeTitle?.(node) || node.name || node.id} · ${pin.label || pin.param}`,
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

  /** 只为已经存在的组外引用建立代理输出；不凭空给组卡生成悬空端点。 */
  function externalReferenceOutputs(group: NodeGroupRecord): Array<{ nodeId: string; field: string; ref: string }> {
    const members = new Set(group.nodeIds);
    const result: Array<{ nodeId: string; field: string; ref: string }> = [];
    const seen = new Set<string>();
    for (const node of nodes()) {
      if (members.has(node.id)) continue;
      for (const pin of nodeVariablePins(node)) {
        const ref = pin?.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof pin.value.ref === 'string' ? pin.value.ref : '';
        const match = /^nodes\.([^\.]+)\.output(?:\.(.*))?$/.exec(ref);
        if (!match || !members.has(match[1])) continue;
        const field = match[2] ? match[2].split('.')[0] : '';
        const key = `${match[1]}\u0000${field}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ nodeId: match[1], field, ref });
      }
    }
    return result;
  }

  function hasExternalReferenceOutput(group: NodeGroupRecord): boolean {
    return externalReferenceOutputs(group).length > 0;
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
      // 旧文档的折叠图只有元数据、没有边界卡：在这里补齐一次真实的入口/出口卡。
      // 补齐后「成员里没有边界卡」不再成立，所以不会重复迁移；改写结果要落盘。
      const boundary = migrateBoundaryCards(id, nodeIds);
      if (boundary.length) {
        nodeIds.push(...boundary);
        migrated = true;
      }
      const inputCount = nodeIds.filter((nodeId) => isGroupEntryNode(nodeById(nodeId))).length;
      const outputCount = nodeIds.filter((nodeId) => isGroupExitNode(nodeById(nodeId))).length;
      const normalizeExecPins = (rawPins: unknown, count: number, base: string): string[] => {
        const result = Array.isArray(rawPins) ? rawPins.map((item) => String(item || '').trim()) : [];
        while (result.length < count) result.push(result.length === 0 ? base : `${base}${result.length + 1}`);
        return result;
      };
      const execInputs = normalizeExecPins(value.execInputs, inputCount, 'execute');
      const execOutputs = normalizeExecPins(value.execOutputs, outputCount, 'then');
      // 执行引脚名是**画布侧派生**字段：图文档与 `.owf` 都不持久化它
      // （`shared/workflow/graph-document.ts` 的 groups 转换只搬 nodeIds / pins / pinPolicy），
      // 所以「它不是数组」在每次重新解析后都成立。这里只把补齐结果写回旁表供本次会话使用，
      // **绝不能**因此把文档标脏：一旦标脏就会上报整份正文，壳层回灌 replaceDocument →
      // 文档版本 +1 → 组缓存失效 → 再次迁移标脏 —— 静置状态下的死循环（实测 40~180 条/秒，
      // 主线程 90% 以上耗在 postMessage，整个应用被压到 ~9 fps）。
      value.execInputs = execInputs;
      value.execOutputs = execOutputs;
      return [{ id, name: String(value.name || '节点组'), nodeIds, pins, execInputs, execOutputs }];
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

  /**
   * 投影一个节点的 children。
   *
   * **外层（折叠视图）保留每一条真实边**：同一个父节点的两条跨组边（判断的真/假各接一张
   * 入口卡）必须各画一条代理线；去重会让其中一口看起来根本没接线。保留后投影 children 与
   * 真实 `ports` 仍然逐位对齐，端口徽标（真/假）不会串位。
   *
   * 内层（组内视图）只画组内的那一侧：组外目标不画，同一张卡也不会重复出现。
   */
  function projectedChildren(node: any, visible: Set<string>, memberOf: Map<string, string>, scopeId = ''): string[] {
    const result: string[] = [];
    for (const child of Array.isArray(node?.children) ? node.children : []) {
      const target = scopeId
        ? visible.has(child) ? child : ''
        : (memberOf.get(child) || child);
      if (!target || target === node.id) continue;
      if (scopeId && result.includes(target)) continue;
      result.push(target);
    }
    return result;
  }

  /**
   * 边界卡与成员卡之间的纵向净空：入口卡排在成员上方、出口卡排在下方各留这么远，
   * 展开折叠图后一眼能看出「这一侧是外面」。
   */
  const BOUNDARY_GAP = 176;

  const snapToGrid = (value: number): number => (Number.isFinite(value) ? Math.round(value / 8) * 8 : 0);

  /** 跨组入边：组外父 → 组内子。每条边都会得到一张真实的组入口卡。 */
  function incomingCrossings(members: Set<string>): Array<{ parent: any; childId: string; index: number }> {
    const result: Array<{ parent: any; childId: string; index: number }> = [];
    for (const node of nodes()) {
      if (members.has(String(node.id))) continue;
      const children: string[] = Array.isArray(node.children) ? node.children : [];
      children.forEach((child, index) => {
        // 已经经过入口卡的边不再算跨组边，否则每归一化一次就会再叠一张卡。
        if (isGroupEntryNode(nodeById(child))) return;
        if (members.has(String(child))) result.push({ parent: node, childId: String(child), index });
      });
    }
    return result;
  }

  /** 跨组出边：组内父 → 组外子。每条边都会得到一张真实的组出口卡。 */
  function outgoingCrossings(members: Set<string>): Array<{ parent: any; childId: string; index: number }> {
    const result: Array<{ parent: any; childId: string; index: number }> = [];
    for (const node of nodes()) {
      if (!members.has(String(node.id))) continue;
      // 出口卡的下游就是隧道目标本身，不能把「出口卡 → 组外目标」再当成一条新的跨组边，
      // 否则每归一化一次就会在出口卡下面再叠一张出口卡。
      if (isGroupExitNode(node)) continue;
      const children: string[] = Array.isArray(node.children) ? node.children : [];
      children.forEach((child, index) => {
        // 已经经过出口卡的边不再算跨组边。
        if (isGroupExitNode(nodeById(child))) return;
        if (!members.has(String(child))) result.push({ parent: node, childId: String(child), index });
      });
    }
    return result;
  }

  /**
   * 把跨组执行边换成真实的边界卡：`组外父 → 入口 → 组内子`、`组内父 → 出口 → 组外子`。
   *
   * 就地改写父节点的 children 槽位（数组长度不变，所以 `condition` 的 `ports` 保持对齐），
   * 新卡按「入口在成员上方、出口在成员下方、纵向对齐各自的成员」落位并写进 `_layout`。
   * 返回创建出来的节点，由调用方登记进组的 `nodeIds`。
   */
  function materializeBoundaryCards(
    memberIds: string[],
    entries: Array<{ parent: any; childId: string; index: number }>,
    exits: Array<{ parent: any; childId: string; index: number }>,
  ): any[] {
    if (!entries.length && !exits.length) return [];
    const used = new Set(nodes().map((node) => String(node.id)));
    const created: any[] = [];
    const nextBoundaryId = (type: string): string => {
      const id = nextNodeId(type, used);
      used.add(id);
      return id;
    };
    const rows = memberIds
      .map((id) => ({ node: nodeById(id), at: layout()[id] }))
      .filter((row) => row.node && row.at && Number.isFinite(row.at.x) && Number.isFinite(row.at.y));
    const top = rows.length ? Math.min(...rows.map((row) => row.at.y)) : 0;
    const bottom = rows.length
      ? Math.max(...rows.map((row) => row.at.y + Math.max(baseHeight, Number(nodeHeight(row.node)) || baseHeight)))
      : 0;
    // 同一行里两张卡不叠在一起：列被占了就往右挪一列。
    const columns = new Set<number>();
    const column = (value: number): number => {
      let x = snapToGrid(value);
      while (columns.has(x)) x += nodeWidth + 32;
      columns.add(x);
      return x;
    };
    for (const crossing of entries) {
      const anchor = layout()[crossing.childId] || layout()[crossing.parent.id];
      const node = { id: nextBoundaryId(GROUP_ENTRY_TYPE), type: GROUP_ENTRY_TYPE, children: [crossing.childId] };
      layout()[node.id] = { x: column(anchor ? anchor.x : 0), y: snapToGrid(top - BOUNDARY_GAP) };
      crossing.parent.children[crossing.index] = node.id;
      created.push(node);
    }
    columns.clear();
    for (const crossing of exits) {
      const anchor = layout()[crossing.parent.id] || layout()[crossing.childId];
      const node = { id: nextBoundaryId(GROUP_EXIT_TYPE), type: GROUP_EXIT_TYPE, children: [crossing.childId] };
      layout()[node.id] = { x: column(anchor ? anchor.x : 0), y: snapToGrid(bottom + BOUNDARY_GAP) };
      crossing.parent.children[crossing.index] = node.id;
      created.push(node);
    }
    nodes().push(...created);
    return created;
  }

  /**
   * 展开折叠图：边界卡内联回两侧的真实边，卡本身从 `nodes` 与 `_layout` 里消失。
   * 边界卡只有一条真实边（入口接组内首节点、出口接组外目标），所以还原是逐槽替换。
   */
  function collapseBoundaryCards(memberIds: string[]): void {
    const raw = nodes();
    const members = new Set(memberIds);
    const boundary = raw.filter((node) => members.has(String(node.id)) && isGroupBoundaryNode(node));
    if (!boundary.length) return;
    const boundaryIds = new Set(boundary.map((node) => String(node.id)));
    for (const node of boundary) {
      const children: string[] = (Array.isArray(node.children) ? node.children : [])
        .map((child: any) => String(child))
        .filter((child: string) => !boundaryIds.has(child));
      const parent = raw.find((candidate) => !boundaryIds.has(String(candidate.id))
        && Array.isArray(candidate.children) && candidate.children.includes(String(node.id)));
      if (!parent) continue;
      const index = parent.children.indexOf(String(node.id));
      if (parent.type === 'condition') {
        // 判断节点的口位与 children 对齐：替换槽位时把口位一起带过去。
        const ports = conditionPortsOf(parent);
        const slot = ports[index] || 'true';
        parent.children.splice(index, 1, ...children);
        ports.splice(index, 1, ...children.map((_: string, offset: number) => (offset === 0 ? slot : (slot === 'true' ? 'false' : 'true'))));
        if (ports.length) parent.ports = ports; else delete parent.ports;
      } else {
        parent.children.splice(index, 1, ...children);
      }
    }
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      if (boundaryIds.has(String(raw[index].id))) raw.splice(index, 1);
    }
    for (const node of boundary) delete layout()[String(node.id)];
  }

  /**
   * 旧文档的折叠图只有元数据（打组只写 `_nodeGroups`、不改 `children`）：在这里补齐边界卡，
   * 把跨组执行边真的接上。补齐后「成员里没有边界卡」不再成立，所以是幂等的；
   * 返回新建的卡 id，调用方负责写进组的 `nodeIds` 并把文档标成待保存。
   *
   * 只在 `groups()` 内部调用：它不能回头调 `groups()`（缓存还没写好，会递归）。
   * 交互命令走 `normalizeBoundaryCards`。
   */
  function migrateBoundaryCards(groupId: string, nodeIds: string[]): string[] {
    if (nodeIds.some((id) => isGroupBoundaryNode(nodeById(id)))) return [];
    const members = new Set(nodeIds);
    const entries = incomingCrossings(members);
    const exits = outgoingCrossings(members);
    if (!entries.length && !exits.length) return [];
    const created = materializeBoundaryCards(nodeIds, entries, exits).map((node) => String(node.id));
    const record = table()[groupId];
    if (record && typeof record === 'object') record.nodeIds = [...nodeIds, ...created];
    return created;
  }

  /** 边界卡在 `nodes` 里的直接执行父节点（边界卡只有一个父）；找不到返回 null。 */
  function boundaryParent(nodeId: string): any | null {
    for (const node of nodes()) {
      if (Array.isArray(node.children) && node.children.includes(String(nodeId))) return node;
    }
    return null;
  }

  /**
   * 折叠图的真实入口（组外父 → 组入口卡）。数量决定组卡顶边画几个输入口：
   * 判断留在组外、真/假都折进来时，这里就是两张卡 → 顶边两个口。
   * 入口卡自己没有入边（悬空）时不计入，因为它外面并没有线。
   */
  function groupEntryCardIds(group: NodeGroupRecord): string[] {
    const members = new Set(group.nodeIds);
    const result: string[] = [];
    for (const id of group.nodeIds) {
      if (!isGroupEntryNode(nodeById(id))) continue;
      const parent = boundaryParent(String(id));
      if (parent && !members.has(String(parent.id))) result.push(String(id));
    }
    return result;
  }

  /**
   * 把折叠图的边界卡调回自洽状态：先内联「已经不跨边界」的卡（成员变了、卡的另一侧被删了），
   * 再为剩下的跨组边补齐缺失的卡。打组、加入成员、删除成员都走这一趟，
   * 「每条跨组执行边都经过一张真实的边界卡」这条不变量由它兜住。
   *
   * 调用方必须处于同一次 `mutate` 内；返回值供调用方更新提示文案。
   */
  function normalizeBoundaryCards(groupId: string): { added: string[]; removed: string[] } {
    const group = groupById(groupId);
    if (!group) return { added: [], removed: [] };
    const members = new Set(group.nodeIds);
    const stale: string[] = [];
    for (const id of group.nodeIds) {
      const node = nodeById(id);
      if (!isGroupBoundaryNode(node)) continue;
      const children: string[] = (Array.isArray(node.children) ? node.children : []).map((child: any) => String(child));
      // 入口的子必须在组内、出口的子必须在组外；空卡（另一侧被删了）也算失效。
      const childOk = children.length > 0 && children.every((child: string) => (isGroupEntryNode(node) ? members.has(child) : !members.has(child)));
      // 入口的父必须在组外、出口的父必须在组内；父节点没了（成员被删）同样失效。
      const parent = boundaryParent(String(id));
      const parentOk = parent !== null && (isGroupEntryNode(node) ? !members.has(String(parent.id)) : members.has(String(parent.id)));
      if (!childOk || !parentOk) stale.push(String(id));
    }
    if (stale.length) collapseBoundaryCards(stale);
    const record = table()[groupId];
    if (!record || typeof record !== 'object') return { added: [], removed: stale };
    const kept: string[] = (Array.isArray(record.nodeIds) ? record.nodeIds : [])
      .map((id: any) => String(id))
      .filter((id: string) => !stale.includes(id));
    const remaining = new Set<string>(kept);
    const created = materializeBoundaryCards(kept, incomingCrossings(remaining), outgoingCrossings(remaining))
      .map((node) => String(node.id));
    record.nodeIds = [...kept, ...created];
    return { added: created, removed: stale };
  }

  function synthetic(group: NodeGroupRecord, memberOf: Map<string, string>): ProjectedGroupCardNode {
    // 组卡的执行出口就是组出口卡的真实下游：出口卡本身是成员，它的 children 指向组外目标，
    // 于是每条跨组出边在组卡上各得一个边界 pin（UE Collapse Graph 的排法）。
    // 组入口卡的 children 是组内节点、会被 memberOf 折回组 id，因此不会在这里冒出来。
    const targets: string[] = [];
    for (const id of group.nodeIds) {
      const node = nodeById(id);
      for (const child of Array.isArray(node?.children) ? node.children : []) {
        const target = memberOf.get(child) || child;
        if (target !== group.id) targets.push(target);
      }
    }
    const execOutputCount = Math.max(targets.length, group.execOutputs.length);
    // 卡上的「N 个节点」只数真实成员：边界卡是折叠图自己造的，不该混进用户的节点数。
    const memberCount = group.nodeIds.filter((id) => !isGroupBoundaryNode(nodeById(id))).length;
    return {
      id: group.id,
      type: 'node_group',
      name: group.name,
      children: targets,
      _nodeGroup: true,
      _nodeCount: memberCount,
      _groupPins: boundaryPins(group),
      _hasReferenceOutput: hasExternalReferenceOutput(group),
      _referenceOutputs: externalReferenceOutputs(group),
      _execOutputCount: execOutputCount,
      _execOutputNames: group.execOutputs,
      // 顶边按组外进来的执行边数排输入口：判断留在组外、真/假都折进来时就是两个口。
      _groupEntryCount: Math.max(group.execInputs.length, groupEntryCardIds(group).length),
      _groupEntryNames: group.execInputs,
    };
  }

  /** 组内统一的执行入口卡：每条真实入口隧道投影成它的一个输出引脚。 */
  function syntheticInterface(group: NodeGroupRecord): ProjectedGroupInterfaceNode {
    const entries = group.nodeIds.flatMap((id) => {
      const node = nodeById(id);
      if (!isGroupEntryNode(node)) return [];
      const child = Array.isArray(node.children) ? node.children.find((childId: string) => group.nodeIds.includes(String(childId)) && !isGroupBoundaryNode(nodeById(String(childId)))) : null;
      return child ? [String(child)] : [];
    });
    const memberPositions = group.nodeIds
      .filter((id) => !isGroupBoundaryNode(nodeById(id)))
      .map((id) => layout()[id]).filter(Boolean);
    const centerX = memberPositions.length
      ? (Math.min(...memberPositions.map((pos) => pos.x)) + Math.max(...memberPositions.map((pos) => pos.x + nodeWidth))) / 2
      : nodeWidth / 2;
    const minY = memberPositions.length ? Math.min(...memberPositions.map((pos) => pos.y)) : 0;
    return {
      id: interfaceId(group.id),
      type: 'node_group_interface',
      name: '输入',
      children: entries,
      _nodeGroupInterface: true,
      _nodeGroupId: group.id,
      _groupPins: [],
      _execOutputCount: Math.max(entries.length, group.execInputs.length),
      _execOutputNames: group.execInputs,
      _nodeGroupPosition: {
        x: Math.round((centerX - nodeWidth / 2) / 8) * 8,
        // 接口卡自身高度 = baseHeight，底边落在成员顶部上方 INTERFACE_GAP 处。
        y: Math.round((minY - baseHeight - INTERFACE_GAP) / 8) * 8,
      },
    };
  }

  function syntheticOutputInterface(group: NodeGroupRecord): ProjectedGroupOutputNode {
    const memberPositions = group.nodeIds
      .filter((id) => !isGroupBoundaryNode(nodeById(id)))
      .map((id) => ({ node: nodeById(id), at: layout()[id] }))
      .filter((item) => item.node && item.at);
    const centerX = memberPositions.length
      ? (Math.min(...memberPositions.map((item) => item.at.x)) + Math.max(...memberPositions.map((item) => item.at.x + nodeWidth))) / 2
      : nodeWidth / 2;
    const bottom = memberPositions.length
      ? Math.max(...memberPositions.map((item) => item.at.y + nodeHeight(item.node)))
      : 0;
    const exitCount = group.nodeIds.filter((id) => isGroupExitNode(nodeById(id))).length;
    return {
      id: outputInterfaceId(group.id),
      type: 'node_group_output',
      name: '输出',
      children: [],
      _nodeGroupOutput: true,
      _nodeGroupId: group.id,
      _execInputCount: Math.max(exitCount, group.execOutputs.length),
      _execInputNames: group.execOutputs,
      _nodeGroupPosition: {
        x: Math.round((centerX - nodeWidth / 2) / 8) * 8,
        y: Math.round((bottom + BOUNDARY_GAP) / 8) * 8,
      },
    };
  }

  /** 组内左侧的数据边界卡：与顶部执行入口分离，让数据线保持从左向右流动。 */
  function syntheticVariables(group: NodeGroupRecord): ProjectedGroupVariablesNode {
    const pins = boundaryPins(group);
    // 数据边界卡量的是真实成员的区域：入口/出口卡是执行隧道，没有参数端点，
    // 把它们算进包围盒会把变量卡撑高（入口在上、出口在下各让 176px）。
    const members = group.nodeIds
      .map((id) => ({ node: nodeById(id), pos: layout()[id] }))
      .filter((item) => item.node && item.pos && !isGroupBoundaryNode(item.node));
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
      // 入口/出口现在是文档里的真实隧道节点，组内直接展示真实节点。
      // 旧实现额外注入合成的 input/output 卡，会让同一边界出现两次，也使重命名误改合成卡。
      const members = nodes().filter((node) => visible.has(node.id)).map((node) => ({
        ...node,
        _nodeGroupMember: true,
        ...(Array.isArray(node.children) ? { children: projectedChildren(node, visible, new Map(), scope.id) } : {}),
      }));
      const variables = syntheticVariables(scope);
      result = [variables, ...members];
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
   *
   * `order` 是这条代理边在投影 `children` 里的下标：同一个父节点可能有多条代理边指向
   * 同一张折叠图（判断的真/假各接一张入口卡），给了下标就只认那一条真实边，
   * 免得真口被假口的运行态点亮。
   */
  function viewEdgeRunTargetIds(parentId: string, childId: string, order?: number): string[] {
    const scope = currentGroup();
    if (scope) {
      if (childId === outputInterfaceId(scope.id) && typeof order === 'number' && order >= 0) {
        const parent = nodeById(parentId);
        const realChild = Array.isArray(parent?.children) ? parent.children[order] : undefined;
        if (isGroupExitNode(nodeById(String(realChild || '')))) return [String(realChild)];
      }
      return [childId];
    }
    const memberOf = membership();
    const sourceGroup = groupById(parentId);
    if (typeof order === 'number' && order >= 0 && !sourceGroup) {
      const source = nodeById(parentId);
      const realChild = Array.isArray(source?.children) ? source.children[order] : undefined;
      if (realChild !== undefined && (memberOf.get(String(realChild)) || String(realChild)) === childId) {
        return [String(realChild)];
      }
    }
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
    const used = new Set([...nodes().map((node) => String(node.id)), ...groups().map((group) => group.id)]);
    return nextNodeId('node_group', used);
  }

  function groupSelection(): boolean {
    if (currentGroup()) {
      toast('暂不支持在折叠图内继续嵌套折叠图', true);
      return false;
    }
    const memberOf = membership();
    const ids = [...state.selected].filter((id) => {
      const node = nodeById(id);
      return node && node.type !== 'root' && !memberOf.has(id);
    });
    if (ids.length < 2) {
      toast('请至少选择两个尚未折叠的节点', true);
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
    let boundaryCount = 0;
    mutate(() => {
      table(true)[id] = { name: `节点组 ${groups().length + 1}`, nodeIds: ids, pins, pinPolicy: 'explicit-v1' };
      invalidate();
      // 打组的核心动作：跨组执行边换成真实的边界卡（组外父 → 入口 → 组内子、
      // 组内父 → 出口 → 组外子），展开时再内联回去，所以运行时的执行关系一个字都不变。
      normalizeBoundaryCards(id);
      const members = Array.isArray(table()[id]?.nodeIds) ? table()[id].nodeIds : [];
      boundaryCount = members.filter((nodeId: string) => isGroupBoundaryNode(nodeById(nodeId))).length;
      layout()[id] = at;
      state.selected = new Set([id]);
      state.selectedEdge = null;
      state.selectedRun = null;
    }, { render: false });
    refreshView();
    toast(boundaryCount
      ? `已将 ${ids.length} 个节点折叠为折叠图（${boundaryCount} 张边界卡接住了跨组执行边）`
      : `已将 ${ids.length} 个节点折叠为折叠图`);
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
      // 展开折叠图 = 边界卡内联回两侧的真实边：组外父 → 组内子、组内父 → 组外子。
      // 边界卡只活在折叠图的边界上，展开后它们不该再留在图里。
      collapseBoundaryCards(group.nodeIds);
      delete table()[id];
      invalidate();
      delete layout()[id];
      delete layout()[interfaceId(id)];
      delete layout()[outputInterfaceId(id)];
      delete layout()[variablesId(id)];
      if (state.nodeGroupId === id) state.nodeGroupId = '';
      state.selected = new Set(group.nodeIds.filter((nodeId) => {
        const node = nodeById(nodeId);
        return node && !isGroupBoundaryNode(node);
      }));
    }, { render: false });
    refreshView(true);
    toast('折叠图已展开，节点与执行关系回到折叠前');
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

  function execPinNames(groupId: string, side: 'inputs' | 'outputs'): string[] {
    const group = groupById(groupId);
    return group ? [...(side === 'inputs' ? group.execInputs : group.execOutputs)] : [];
  }

  function addExecPin(groupId: string, side: 'inputs' | 'outputs'): boolean {
    const value = table()[groupId];
    const group = groupById(groupId);
    if (!value || !group) return false;
    const key = side === 'inputs' ? 'execInputs' : 'execOutputs';
    const names = Array.isArray(value[key]) ? [...value[key]] : [...(side === 'inputs' ? group.execInputs : group.execOutputs)];
    const base = side === 'inputs' ? 'execute' : 'then';
    mutate(() => {
      names.push(names.length ? `${base}${names.length + 1}` : base);
      value[key] = names;
      invalidate();
    }, { render: false });
    refreshView();
    return true;
  }

  function renameExecPin(groupId: string, side: 'inputs' | 'outputs', index: number, name: string): boolean {
    const value = table()[groupId];
    const group = groupById(groupId);
    if (!value || !group) return false;
    const key = side === 'inputs' ? 'execInputs' : 'execOutputs';
    const names = Array.isArray(value[key]) ? [...value[key]] : [...(side === 'inputs' ? group.execInputs : group.execOutputs)];
    if (index < 0 || index >= names.length) return false;
    const next = String(name || '').trim();
    if (!next || names[index] === next) return true;
    mutate(() => {
      names[index] = next;
      value[key] = names;
      invalidate();
    }, { render: false });
    refreshView();
    return true;
  }

  function removeExecPin(groupId: string, side: 'inputs' | 'outputs', index: number): boolean {
    const value = table()[groupId];
    const group = groupById(groupId);
    if (!value || !group) return false;
    const key = side === 'inputs' ? 'execInputs' : 'execOutputs';
    const names = Array.isArray(value[key]) ? [...value[key]] : [...(side === 'inputs' ? group.execInputs : group.execOutputs)];
    const linkedCount = side === 'inputs' ? groupEntryCardIds(group).length : group.nodeIds.filter((id) => isGroupExitNode(nodeById(id))).length;
    if (index < linkedCount || index < 0 || index >= names.length) {
      toast('已连接的执行引脚不能直接删除，请先断开对应连线', true);
      return false;
    }
    mutate(() => {
      names.splice(index, 1);
      value[key] = names;
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
      // 成员变了，边界也跟着变：新成员跨边界的执行边要接上边界卡，
      // 已经被并进来的那一侧（例如原来的组外目标）要把旧卡内联掉。
      normalizeBoundaryCards(group.id);
    }
  }

  /**
   * 删除/剪切节点后原子清理组元数据：从成员与端点里移除这些节点，
   * 没有剩余成员的组整组删除（含它的布局残留）。调用方必须处于同一次 mutate 内。
   *
   * 边界卡只有一条真实边（入口接组内首节点、出口接组外目标）：那条边的另一端被删掉，
   * 这张卡就成了死卡——`normalizeBoundaryCards` 会把它内联掉并从图里移除，
   * 画布上不会留下指向空节点的边界卡。
   */
  function removeMembers(ids: string[]): void {
    const removed = new Set(ids.map(String));
    if (!removed.size) return;
    const source = table();
    const affected: string[] = [];
    for (const [id, value] of Object.entries(source)) {
      if (!value || typeof value !== 'object') continue;
      const nextIds = (Array.isArray(value.nodeIds) ? value.nodeIds : []).filter((nodeId: any) => !removed.has(String(nodeId)));
      value.nodeIds = nextIds;
      if (Array.isArray(value.pins)) {
        value.pins = value.pins.filter((pin: any) => !removed.has(String(pin?.nodeId)));
      }
      if (!nextIds.length) {
        // 连边界卡都不剩：整组连同布局残留一起删除。
        delete source[id];
        delete layout()[id];
        delete layout()[interfaceId(id)];
        delete layout()[outputInterfaceId(id)];
        delete layout()[variablesId(id)];
        if (state.nodeGroupId === id) state.nodeGroupId = '';
      } else {
        // 最后一个真实成员被删时，剩下的边界卡失去意义：内联回去再整组删除，
        // 否则画布上会留下一个只剩入口/出口、没有任何业务节点的空折叠图。
        const realMembers = nextIds.filter((nodeId: any) => !isGroupBoundaryNode(nodeById(nodeId)));
        if (!realMembers.length) {
          collapseBoundaryCards(nextIds);
          delete source[id];
          delete layout()[id];
          delete layout()[interfaceId(id)];
          delete layout()[outputInterfaceId(id)];
          delete layout()[variablesId(id)];
          if (state.nodeGroupId === id) state.nodeGroupId = '';
        } else {
          affected.push(id);
        }
      }
    }
    invalidate();
    // 边界卡离开成员表后没有任何归属，留在图上就是非法节点（校验会报「必须属于某个折叠图」）：
    // 直接从图与布局里摘掉，父节点对它的引用同步清掉（判断节点同步口位）。
    // 真实成员由调用方（deleteSelection / cutSelection）负责，这里只收拾边界卡。
    const raw = nodes();
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const node = raw[index];
      if (isGroupBoundaryNode(node) && removed.has(String(node.id))) {
        delete layout()[String(node.id)];
        raw.splice(index, 1);
      }
    }
    for (const node of raw) {
      if (!Array.isArray(node.children)) continue;
      const doomed = [...node.children].filter((child: string) => removed.has(String(child)) && isGroupBoundaryNode(nodeById(child)));
      if (!doomed.length) continue;
      if (node.type === 'condition') {
        const ports = conditionPortsOf(node);
        const kept = node.children
          .map((child: string, index: number) => ({ child, port: ports[index] }))
          .filter((item: any) => !doomed.includes(String(item.child)));
        node.children = kept.map((item: any) => String(item.child));
        const nextPorts = kept.map((item: any) => item.port || 'true');
        if (nextPorts.length) node.ports = nextPorts; else delete node.ports;
      } else {
        node.children = node.children.filter((child: string) => !doomed.includes(String(child)));
      }
    }
    for (const id of affected) normalizeBoundaryCards(id);
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
          nodeName: String(deps.nodeTitle?.(node) || node.name || node.id),
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
    groupSelection, enterGroup, leaveGroup, ungroup, renameGroup, execPinNames, addExecPin, renameExecPin, removeExecPin, addToCurrentGroup, removeMembers,
    pinExposure, pinCandidates, setPinExposed, pinMenuEntry, candidateMenu, boundaryVariableRefs, visibleVariableCardIds,
  };
}
