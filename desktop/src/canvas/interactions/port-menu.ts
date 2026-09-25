/**
 * 端口右键菜单项与插入/提升命令：输入/输出端口、变量端点、实例子输入与变量卡片。
 * 原 `workflow-editor.js` 的 nodeInputPortMenuItems/nodeOutputPortMenuItems/
 * nodeVariablePinMenuItems/instanceRunPinMenuItems/variableCardPortMenuItems/
 * insertNodeAbove/addChildNode/promotePinToVariable/copyVariableReference。
 *
 * 菜单项只构造数据；执行动作时经注入的连线/命令回调修改文档。
 */
import type { CanvasState } from '../state/canvas-state';
import type { PointerLike } from './connections';
import type { MenuEntry } from '../ui/overlays';
import {
  CONDITION_PORT_LABELS, boolJudgeShape, conditionPortOfChild, conditionPortOffset, isBooleanInputPin, isBoolJudgeOperandPin, nearestConditionPort, type ConditionPort,
} from '../model/exec-ports';

export interface PortPoint {
  x: number;
  y: number;
}

export interface PortPin {
  param: string;
  variable?: string;
  scope?: 'inputs' | 'variables';
  type?: string;
  /** 清单里的参数定义：提升为变量时要把结构（items/properties/边界）一起带过去。 */
  definition?: Record<string, any>;
}

export interface PortRunCard {
  node: { id: string; [key: string]: unknown };
  index: number;
  run?: { inputs?: Record<string, unknown> };
  variables: Array<{ name: string }>;
  x?: number;
  y?: number;
}

export interface PortVariableCard {
  id: string;
  name: string;
  scope: 'inputs' | 'variables';
}

export interface PortMenuDeps {
  state: CanvasState;
  startConnectionFromInput(event: PointerLike | null, nodeId: string, point: PortPoint): void;
  startConnection(event: PointerLike | null, nodeId: string, point: PortPoint, port?: ConditionPort): void;
  /** 任务卡输出口：开始拖节点输出引用。 */
  startReferenceConnection(event: PointerLike | null, nodeId: string, point: PortPoint): void;
  startVariableConnectionFromPin(event: PointerLike | null, nodeId: string, param: string, point: PortPoint): void;
  startVariableConnectionFromInstanceInput(event: PointerLike | null, nodeId: string, runIndex: number, param: string, point: PortPoint): void;
  startVariableConnectionFromCard(event: PointerLike | null, scope: string, name: string, cardId: string, point: PortPoint): void;
  parentOf(childId: string): { node: any; index: number } | null;
  buildNode(type: string): any;
  canConnect(parentId: string, childId: string): string | null;
  /** 节点对象版连接校验：刚 buildNode、还没入图的新节点要按对象校验（判断节点还要带口位）。 */
  canConnectNodes?(parent: any, child: any, port?: ConditionPort | null): string | null;
  connect(parentId: string, childId: string, port?: number | ConditionPort): unknown;
  disconnect(parentId: string, childId: string): void;
  mutate(fn: () => void): void;
  nodeById(id: string): any;
  position(node: any): PortPoint;
  layout(): Record<string, any>;
  nodes(): any[];
  nodeVariablePins(node: any): PortPin[];
  /** 节点输出字段（`nodes.<id>.output.<字段>`）：任务卡输出口菜单用。 */
  nodeOutputFields(node: any): Array<{ field: string; label: string; ref: string; schema: any }>;
  /** 断开参数上的节点输出引用。 */
  disconnectReferenceFromPin(nodeId: string, param: string): void;
  /** 写入一个节点输出引用（值卡片的「更改来源」菜单用）。 */
  connectReferenceToPin?(sourceNodeId: string, ref: string, label: string, nodeId: string, param: string): void;
  /** 拆分卡片可选的来源清单（等于 UE 调色板按结构体逐条列出）。 */
  breakSourceCandidates?(excludeNodeId?: string): Array<{ ref: string; label: string }>;
  /** 布尔判断卡片换运算符（UE 的 Convert Operator）。 */
  setBoolJudgeOperator?(nodeId: string, operator: string): void;
  /** 值卡片的进阶编辑入口（拆分字段映射 / 嵌套条件），从节点菜单打开。 */
  openValueCardEditor?(nodeId: string): void;
  variableCards(): Record<string, any>;
  variableLinks(): Record<string, string>;
  nextVariableCardId(): string;
  variableCardList(): PortVariableCard[];
  variableCardPosition(node: any, index: number): PortPoint;
  focusVariableCard(card: PortVariableCard): void;
  placeVariableCard(scope: string, name: string, point: PortPoint, options: { connect: boolean }): void;
  disconnectVariableFromPin(nodeId: string, param: string): void;
  disconnectVariableFromInstanceInput(nodeId: string, runIndex: number, param: string): void;
  removeVariableCard(id: string): void;
  fieldLabel(param: string): string;
  toast(message: string, error?: boolean): void;
  typeNames: Record<string, string>;
  nodeWidth: number;
  variableCardWidth: number;
  variableCardPortY: number;
  /** 组内端点「添加到组接口 / 从组接口移除」菜单项；不在可编辑的节点组内返回 null。 */
  nodeGroupPinMenu?(nodeId: string, param: string): MenuEntry | null;
  /** 可选覆盖：测试或宿主希望替换默认实现（菜单项调用覆盖实现，公开 API 仍是默认实现）。 */
  copyVariableReference?(scope: string, name: string): void;
  insertNodeAbove?(childId: string, type: string): void;
  addChildNode?(parentId: string, type: string, point: PortPoint, port?: ConditionPort): void;
  promotePinToVariable?(nodeId: string, param: string, pin: PortPin, point?: PortPoint, targetType?: string): void;
  /** 剪贴板所在 navigator，便于在 vm/测试环境注入；默认取全局。 */
  getNavigator?(): Navigator | undefined;
}

export interface CanvasPortMenu {
  nodeInputPortMenuItems(nodeId: string, point: PortPoint): MenuEntry[];
  nodeOutputPortMenuItems(nodeId: string, point: PortPoint, port?: ConditionPort): MenuEntry[];
  nodeReferencePortMenuItems(nodeId: string, point: PortPoint): MenuEntry[];
  nodeVariablePinMenuItems(nodeId: string, pin: PortPin, point: PortPoint): MenuEntry[];
  /** 值卡片（布尔判断 / 拆分）的节点菜单：UE 的节点右键（结构体选择 / Convert Operator）。 */
  valueCardMenuItems(nodeId: string): MenuEntry[];
  instanceRunPinMenuItems(card: PortRunCard, variable: { name: string }, point: PortPoint): MenuEntry[];
  variableCardPortMenuItems(card: PortVariableCard, point: PortPoint): MenuEntry[];
  insertNodeAbove(childId: string, type: string): void;
  addChildNode(parentId: string, type: string, point: PortPoint, port?: ConditionPort): void;
  promotePinToVariable(nodeId: string, param: string, pin: PortPin, point?: PortPoint): void;
  copyVariableReference(scope: string, name: string): void;
}

export function createCanvasPortMenu(deps: PortMenuDeps): CanvasPortMenu {
  const {
    state, startConnectionFromInput, startConnection, startVariableConnectionFromPin,
    startVariableConnectionFromInstanceInput, startVariableConnectionFromCard, parentOf, buildNode,
    canConnect, connect, disconnect, mutate, nodeById, position, layout, nodes, nodeVariablePins,
    variableCards, variableLinks, nextVariableCardId, variableCardList, variableCardPosition,
    focusVariableCard, placeVariableCard, disconnectVariableFromPin, disconnectVariableFromInstanceInput,
    removeVariableCard, fieldLabel, toast, typeNames, nodeWidth, variableCardWidth, variableCardPortY,
    startReferenceConnection, nodeOutputFields, disconnectReferenceFromPin,
    connectReferenceToPin, breakSourceCandidates, setBoolJudgeOperator, openValueCardEditor,
  } = deps;
  /**
   * 新节点校验：宿主注入了对象版就用它，否则退回按 id 的 canConnect
   * （测试桩只提供 canConnect 时行为不变）。
   */
  const canConnectNodes = deps.canConnectNodes || ((parent: any, child: any) => canConnect(parent && parent.id, child && child.id));

  /** 判断节点上被右键那个口：卡片上每个口单独绑了菜单，这里只做兜底（按指针位置就近取）。 */
  function portForNode(node: any, point: PortPoint): ConditionPort | undefined {
    if (!node || node.type !== 'condition') return undefined;
    return nearestConditionPort(nodeWidth, point.x - position(node).x);
  }

  function nodeInputPortMenuItems(nodeId: string, point: PortPoint): MenuEntry[] {
    const items: MenuEntry[] = [{ label: '从这里开始连线', run: () => startConnectionFromInput(null, nodeId, point) }];
    const parent = parentOf(nodeId);
    if (parent) {
      items.push('separator', { label: `断开与「${parent.node.name || parent.node.id}」的链接`, danger: true, run: () => { mutate(() => disconnect(parent.node.id, nodeId)); } });
      items.push('separator', {
        label: '在上方插入节点',
        children: ([['sequence', 'Sequence'], ['selector', 'Selector'], ['simple_parallel', 'Simple Parallel'], ['parallel', 'Parallel'], ['repeat_until', 'Repeat Until'], ['branch', 'Branch'], ['switch', 'Switch']] as Array<[string, string]>)
          .map(([type, label]) => ({ label, run: () => insertAbove(nodeId, type) })),
      });
    }
    return items;
  }

  /** 节点输出端口（底部）右键菜单：UE 风格——连线、断开全部链接（Break All Links）、创建并连接节点。 */
  function nodeOutputPortMenuItems(nodeId: string, point: PortPoint, port?: ConditionPort): MenuEntry[] {
    const node = nodeById(nodeId);
    const children = node && Array.isArray(node.children) ? node.children.filter((id: string) => nodeById(id)) : [];
    // 判断节点左右各一个口：右键哪个口就对着哪个口操作（没传口位时按指针位置就近取）。
    const slot = port || portForNode(node, point);
    const suffix = slot ? `（${CONDITION_PORT_LABELS[slot]}口）` : '';
    const items: MenuEntry[] = [{ label: `从这里开始连线${suffix}`, run: () => startConnection(null, nodeId, point, slot) }];
    if (children.length) {
      items.push('separator', { label: `断开全部子链接（${children.length} 条）`, danger: true, run: () => { mutate(() => { for (const childId of [...children]) disconnect(nodeId, childId); }); } });
    }
    items.push('separator', {
      label: `创建并连接节点${suffix}`,
      children: ([['task', 'Task'], ['condition', 'Condition（判断）'], ['bool_judge', 'Bool Judge（布尔判断卡片）'], ['sequence', 'Sequence'], ['selector', 'Selector'], ['simple_parallel', 'Simple Parallel'], ['parallel', 'Parallel'], ['repeat_until', 'Repeat Until'], ['branch', 'Branch'], ['switch', 'Switch'], ['instance_parallel', 'Instance Parallel']] as Array<[string, string]>)
        .map(([type, label]) => ({ label, run: () => addChild(nodeId, type, point, slot) })),
    });
    return items;
  }

  /** 任务卡变量端口右键菜单：UE 风格——提升为变量（Promote to Variable）、创建 Get 卡片、断开链接。 */
  function nodeVariablePinMenuItems(nodeId: string, pin: PortPin, point: PortPoint): MenuEntry[] {
    const items: MenuEntry[] = [];
    if (pin.variable) {
      const topName = String(pin.variable).split('.')[0];
      const card = variableCardList().find((item) => item.scope === pin.scope && item.name === topName);
      if (card) items.push({ label: '定位到变量卡片', run: () => focusVariableCard(card) });
      else items.push({ label: '创建变量卡片（Get）', run: () => placeVariableCard(pin.scope!, topName, point, { connect: false }) });
      items.push({ label: '复制变量引用', run: () => copyReference(pin.scope!, topName) });
      items.push('separator', { label: '断开变量链接', danger: true, run: () => disconnectVariableFromPin(nodeId, pin.param) });
    } else if (pinReference(nodeId, pin.param)) {
      // 这一行绑的是别的节点的输出：给出复制引用与断开。
      const ref = pinReference(nodeId, pin.param)!;
      items.push({ label: '复制引用', run: () => copyText(ref) });
      items.push('separator', { label: '断开引用', danger: true, run: () => disconnectReferenceFromPin(nodeId, pin.param) });
    } else {
      items.push({ label: '从这里开始连线（绑定变量）', run: () => startVariableConnectionFromPin(null, nodeId, pin.param, point) });
      // condition 是严格 boolean 输入，没有可提取的字面量；bool_judge 左右端点则代表可提升的比较操作数。
      // 拆分来源行同理：它是输出引用绑定，没有字面量可提升。
      const targetNode = nodeById(nodeId);
      if ((pin.param !== 'condition' || isBoolJudgeOperandPin(targetNode, pin.param)) && !(targetNode && targetNode.type === 'break')) items.push('separator', { label: '提升为变量', run: () => promotePin(nodeId, pin.param, pin) });
    }
    const groupItem = deps.nodeGroupPinMenu?.(nodeId, pin.param);
    if (groupItem) items.push('separator', groupItem);
    return items;
  }

  /**
   * 值卡片的节点菜单：UE 里这类节点的设置不在详情面板，而是节点右键菜单——
   * `K2Node_BreakStruct` 的结构体类型、`K2Node_PromotableOperator` 的
   * 「Convert Operator → Convert to Equal/…」（见 UE 的 GetNodeContextMenuActions）。
   */
  function valueCardMenuItems(nodeId: string): MenuEntry[] {
    const node = nodeById(nodeId);
    if (!node) return [];
    if (node.type === 'break') {
      const items: MenuEntry[] = [];
      const candidates = breakSourceCandidates ? breakSourceCandidates(nodeId) : [];
      if (candidates.length) {
        items.push({
          label: '更改拆分来源',
          children: candidates.map((candidate) => ({
            label: `${candidate.label}（${candidate.ref}）`,
            run: () => {
              const owner = candidate.ref.startsWith('nodes.') ? candidate.ref.split('.')[1] : candidate.ref.split('.')[0];
              connectReferenceToPin?.(owner, candidate.ref, candidate.label, nodeId, 'ref');
            },
          })),
        });
      }
      if (pinReference(nodeId, 'ref') || pinVariable(nodeId, 'ref')) {
        items.push({
          label: '断开拆分来源',
          danger: true,
          run: () => {
            if (pinVariable(nodeId, 'ref')) disconnectVariableFromPin(nodeId, 'ref');
            else disconnectReferenceFromPin(nodeId, 'ref');
          },
        });
      }
      if (openValueCardEditor) {
        items.push('separator', { label: '拆分字段（进阶）…', run: () => openValueCardEditor(nodeId) });
      }
      return items;
    }
    if (node.type === 'bool_judge') {
      const shape = boolJudgeShape(node);
      const expression = node.expression && typeof node.expression === 'object' && !Array.isArray(node.expression)
        ? node.expression as Record<string, unknown>
        : {};
      const operator = Object.keys(expression)[0] || 'eq';
      const items: MenuEntry[] = [];
      // UE 的 Convert Operator 只在同类二元运算符之间转换（Equal ↔ Greater …）。
      // 「与/或/非」不是比较运算符：转过去只会编出 `{and: [0, 0]}` 这种 Python 校验直接
      // 拒绝的表达式，卡面也没有对应引脚——嵌套逻辑一律走「嵌套条件（进阶）…」。
      if (setBoolJudgeOperator && shape === 'comparison') {
        const operators: Array<[string, string]> = [
          ['eq', '等于'], ['ne', '不等于'], ['gt', '大于'], ['gte', '大于等于'],
          ['lt', '小于'], ['lte', '小于等于'], ['contains', '包含'],
        ];
        items.push({
          label: '改为',
          children: operators
            .filter(([name]) => name !== operator)
            .map(([name, label]) => ({ label, run: () => setBoolJudgeOperator(nodeId, name) })),
        });
      }
      if (openValueCardEditor) {
        items.push(...(items.length ? ['separator' as const] : []), { label: '嵌套条件（进阶）…', run: () => openValueCardEditor(nodeId) });
      }
      return items;
    }
    return [];
  }

  /** 某个端点当前绑的变量名（`<scope>.<name>` 里的 name）；没绑返回空串。 */
  function pinVariable(nodeId: string, param: string): string {
    const node = nodeById(nodeId);
    if (!node) return '';
    const value = param === 'ref' ? node.ref : (!node.params || typeof node.params !== 'object' ? undefined : node.params[param]);
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { ref?: unknown }).ref !== 'string') return '';
    const ref = String((value as { ref: string }).ref);
    return /^(inputs|variables)\./.test(ref) ? ref : '';
  }

  /** 该端点当前是否绑着节点输出引用；是则返回引用文本。 */
  function pinReference(nodeId: string, param: string): string | null {
    const node = nodeById(nodeId);
    if (!node) return null;
    const value = isBooleanInputPin(node, param)
      ? node.expression
      : node.type === 'break' && param === 'ref'
        ? node.ref
        : (!node.params || typeof node.params !== 'object' ? undefined : param.startsWith('inputs.')
        ? (node.params.inputs && typeof node.params.inputs === 'object' ? node.params.inputs[param.slice('inputs.'.length)] : undefined)
        : node.params[param]);
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ref !== 'string') return null;
    return value.ref.startsWith('nodes.') ? value.ref : null;
  }

  /** 实例运行卡变量端口右键菜单：绑定时可定位/创建卡片/复制/断开，未绑定时开始连线。 */
  function instanceRunPinMenuItems(card: PortRunCard, variable: { name: string }, point: PortPoint): MenuEntry[] {
    const raw = card.run && card.run.inputs && typeof card.run.inputs === 'object' ? card.run.inputs[variable.name] : null;
    const ref = raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as { ref?: unknown }).ref === 'string' ? (raw as { ref: string }).ref : '';
    const match = /^(inputs|variables)\.([^.]+)/.exec(ref);
    const items: MenuEntry[] = [];
    if (match) {
      const cardItem = variableCardList().find((item) => item.scope === match[1] && item.name === match[2]);
      if (cardItem) items.push({ label: '定位到变量卡片', run: () => focusVariableCard(cardItem) });
      else items.push({ label: '创建变量卡片（Get）', run: () => placeVariableCard(match[1], match[2], point, { connect: false }) });
      items.push({ label: '复制变量引用', run: () => copyReference(match[1], match[2]) });
      items.push('separator', { label: '断开变量链接', danger: true, run: () => disconnectVariableFromInstanceInput(card.node.id, card.index, variable.name) });
    } else {
      items.push({ label: '从这里开始连线（绑定变量）', run: () => startVariableConnectionFromInstanceInput(null, card.node.id, card.index, variable.name, point) });
    }
    return items;
  }

  /**
   * 任务卡输出口右键菜单：列出这个 Action 的输出字段，每个都能从这里开始拖引用、
   * 复制引用文本；已有引用时给出「断开全部输出引用」。
   */
  function nodeReferencePortMenuItems(nodeId: string, point: PortPoint): MenuEntry[] {
    const node = nodeById(nodeId);
    if (!node) return [];
    const fields = nodeOutputFields(node);
    const items: MenuEntry[] = [];
    if (!fields.length) {
      items.push({ label: '该 Action 没有声明输出', run: () => toast('该 Action 没有声明输出', true) });
      return items;
    }
    items.push({
      label: '从这里开始连线（绑定到参数）',
      run: () => startReferenceConnection(null, nodeId, point),
    });
    items.push('separator');
    items.push(...referenceCopyItems(fields));
    const dependents = referenceDependents(nodeId);
    if (dependents.length) {
      items.push('separator');
      items.push({
        label: `断开全部输出引用（${dependents.length} 处）`,
        danger: true,
        run: () => { mutate(() => { for (const item of dependents) disconnectReferenceFromPin(item.nodeId, item.param); }); },
      });
    }
    return items;
  }

  /**
   * 「复制引用」那一组菜单项。
   *
   * 数组输出会展开成「每项 + 每项的字段」，平铺出来几十条没法看，
   * 所以按第一个路径段分组：整体输出一条、对象的每个字段一条、
   * 数组的每一项进子菜单（子菜单里第一条是整项，其余是该项的字段）。
   */
  function referenceCopyItems(fields: Array<{ field: string; label: string; ref: string }>): MenuEntry[] {
    const items: MenuEntry[] = [];
    const groups = new Map<string, { label: string; head?: MenuEntry; children: MenuEntry[] }>();
    const groupOf = (name: string, label: string): { label: string; head?: MenuEntry; children: MenuEntry[] } => {
      let group = groups.get(name);
      if (!group) {
        group = { label, children: [] };
        groups.set(name, group);
      }
      return group;
    };
    for (const entry of fields) {
      const segments = String(entry.field || '').split('.').filter(Boolean);
      if (!segments.length) {
        items.push({ label: '复制整体输出', run: () => copyText(entry.ref) });
        continue;
      }
      const name = segments[0];
      const indexed = /^\d+$/.test(name);
      const label = indexed ? `第 ${Number(name) + 1} 项` : (fields.find((item) => item.field === name)?.label || fieldLabel(name));
      if (segments.length === 1) {
        if (indexed) groupOf(name, label).head = { label: `整项（${entry.ref}）`, run: () => copyText(entry.ref) };
        else items.push({ label: `复制 ${label}`, run: () => copyText(entry.ref) });
        continue;
      }
      const tail = segments.slice(1).map((segment) => fieldLabel(segment)).join('.');
      groupOf(name, label).children.push({ label: `复制 ${tail}`, run: () => copyText(entry.ref) });
    }
    for (const group of groups.values()) {
      const children = group.head ? [group.head, ...group.children] : group.children;
      if (!children.length) continue;
      items.push({ label: group.label, children });
    }
    return items;
  }

  /** 哪些参数正引用这个节点的输出。 */
  function referenceDependents(nodeId: string): Array<{ nodeId: string; param: string }> {
    const prefix = `nodes.${nodeId}.output`;
    const found: Array<{ nodeId: string; param: string }> = [];
    for (const node of nodes()) {
      if (!node || node.type !== 'task' || !node.params || typeof node.params !== 'object') continue;
      const visit = (value: any, param: string): void => {
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ref !== 'string') return;
        if (value.ref === prefix || value.ref.startsWith(`${prefix}.`)) found.push({ nodeId: node.id, param });
      };
      for (const [param, value] of Object.entries(node.params)) {
        if (param === 'inputs' && value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [name, input] of Object.entries(value as Record<string, any>)) visit(input, `inputs.${name}`);
        } else visit(value, param);
      }
    }
    return found;
  }

  /** 复制任意文本（节点输出引用用）。 */
  function copyText(text: string): void {
    const owner = deps.getNavigator ? deps.getNavigator() : (typeof navigator !== 'undefined' ? navigator : undefined);
    const clipboard = owner ? (owner as Navigator & { clipboard?: { writeText(value: string): Promise<void> } }).clipboard : undefined;
    if (clipboard && clipboard.writeText) {
      clipboard.writeText(text).then(() => toast(`已复制 ${text}`)).catch(() => toast(`请手动复制：${text}`, true));
    } else toast(`请手动复制：${text}`);
  }

  /** 变量卡片输出端口右键菜单：开始连线、复制引用，或删除卡片。 */
  function variableCardPortMenuItems(card: PortVariableCard, point: PortPoint): MenuEntry[] {
    return [
      { label: '从这里开始连线', run: () => startVariableConnectionFromCard(null, card.scope, card.name, card.id, point) },
      { label: '复制变量引用', run: () => copyReference(card.scope, card.name) },
      'separator',
      { label: '删除变量卡片', danger: true, run: () => removeVariableCard(card.id) },
    ];
  }

  /** 在父节点与当前节点之间插入一个组合节点并保持原有连线（UE 风格）。 */
  function insertNodeAbove(childId: string, type: string): void {
    const parent = parentOf(childId);
    if (!parent) return;
    const node = buildNode(type);
    // 判断节点上的子节点挂在某个口上：包装节点要接手同一个口。
    const slot = parent.node.type === 'condition' ? (conditionPortOfChild(parent.node, childId) || 'true') : undefined;
    // 判断节点的口此刻正被 childId 占着，而它马上会被摘下来换成包装节点——那种占用不算冲突。
    const parentError = slot ? null : canConnectNodes(parent.node, node);
    const childError = canConnectNodes(node, nodeById(childId));
    if (parentError || childError) { toast(parentError || childError!, true); return; }
    const at = position(nodeById(childId));
    const from = position(parent.node);
    mutate(() => {
      nodes().push(node);
      layout()[node.id] = { x: Math.round((from.x + at.x) / 2), y: Math.round((from.y + at.y) / 2) - 24 };
      // 口位是排他的：先摘掉原子节点，包装节点才能在同一个口上接位。
      if (slot) disconnect(parent.node.id, childId);
      connect(parent.node.id, node.id, slot);
      connect(node.id, childId);
      state.selected = new Set([node.id]);
      state.selectedRun = null;
      state.inspector = 'node';
    });
    toast(`已在上方插入 ${typeNames[type] || type}`);
  }

  /** 在输出端口附近创建节点并直接连为当前节点的子节点（判断节点按该口接）。 */
  function addChildNode(parentId: string, type: string, point: PortPoint): void;
  function addChildNode(parentId: string, type: string, point: PortPoint, port?: ConditionPort): void;
  function addChildNode(parentId: string, type: string, point: PortPoint, port?: ConditionPort): void {
    const parent = nodeById(parentId);
    const node = buildNode(type);
    const slot = port || portForNode(parent, point);
    const error = canConnectNodes(parent, node, slot);
    if (error) { toast(error, true); return; }
    mutate(() => {
      nodes().push(node);
      const anchorX = parent && parent.type === 'condition' && slot
        ? position(parent).x + conditionPortOffset(nodeWidth, slot)
        : point.x;
      layout()[node.id] = { x: Math.round(anchorX - nodeWidth / 2), y: Math.round(point.y + 24) };
      connect(parentId, node.id, slot);
      state.selected = new Set([node.id]);
      state.selectedRun = null;
      state.inspector = 'node';
    });
  }

  /** 提升为变量时要带过去的结构字段：少了它们，变量详情只能退化成原始 JSON 输入。 */
  const VARIABLE_STRUCTURE_KEYS = [
    'type', 'items', 'properties', 'prefixItems', 'enum', 'min_items', 'max_items',
    'min_length', 'max_length', 'min', 'max', 'description', 'editor',
  ] as const;

  function copyValue<T>(value: T): T {
    return value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));
  }

  /**
   * 端点提升为变量：变量定义沿用清单里的参数定义（数组元素、对象字段、取值边界），
   * 这样变量详情能用结构化控件编辑——rect 四个坐标、固定长度数组按元素个数给输入框。
   */
  /**
   * 提升为变量时的名字：清单/标签表里有就用它；子工作流输入行的字段名是 `inputs.v_<uuid>`，
   * 标签表里查不到，这时用子工作流声明的 display_name（如「运行轮数」），别把自动生成的 id 当名字。
   */
  function promotedLabel(pin: PortPin, param: string): string {
    const field = fieldLabel(param);
    if (field && field !== param) return field;
    const definition = pin.definition && typeof pin.definition === 'object' ? pin.definition as Record<string, unknown> : {};
    return typeof definition.display_name === 'string' ? definition.display_name.trim() : '';
  }

  function literalType(value: unknown): string {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    if (Array.isArray(value)) return 'array';
    if (value && typeof value === 'object') return 'object';
    return 'any';
  }

  function promotedVariableDefinition(pin: PortPin, current: any): Record<string, unknown> {
    const source = pin.definition && typeof pin.definition === 'object' ? pin.definition : {};
    const definition: Record<string, unknown> = {};
    for (const key of VARIABLE_STRUCTURE_KEYS) {
      if (source[key] !== undefined) definition[key] = copyValue(source[key]);
    }
    if (definition.type === undefined) definition.type = pin.type || 'any';
    const label = promotedLabel(pin, pin.param);
    if (label) definition.display_name = label;
    // 端口上的字面量优先当默认值；没有就用清单默认值，避免变量卡片空着。
    const seed = current !== undefined ? current : source.default;
    if (seed !== undefined) definition.default = copyValue(seed);
    return definition;
  }

  /** 纯绑定值 `{ref: '...'}`；字面量对象/数组是「已配置」而不是「已绑定」，要允许提升为变量。 */
  function isBindingObject(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && typeof value.ref === 'string' && Object.keys(value).length === 1;
  }

  /** 把参数字面量（含 bool_judge 操作数）提升为带类型的工作流输入，并在画布创建变量卡片自动连上。 */
  function promotePinToVariable(nodeId: string, param: string, pin: PortPin, point?: PortPoint): void {
    const node = nodeById(nodeId);
    if (!node) return;
    const boolOperand = isBoolJudgeOperandPin(node, param);
    const expression = boolOperand && node.expression && typeof node.expression === 'object' && !Array.isArray(node.expression) ? node.expression : null;
    const operator = expression ? Object.keys(expression)[0] || 'eq' : '';
    const operands = expression && Array.isArray(expression[operator]) && expression[operator].length === 2 ? expression[operator].slice() : ['', ''];
    const current = boolOperand
      ? operands[param === 'left' ? 0 : 1]
      : param.startsWith('inputs.')
        ? (node.params && node.params.inputs && typeof node.params.inputs === 'object' ? node.params.inputs[param.slice('inputs.'.length)] : undefined)
        : (node.params ? node.params[param] : undefined);
    if (pin.variable || isBindingObject(current)) { toast('该端口已绑定变量，不能重复提取', true); return; }
    const inputs = state.raw && state.raw.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) { toast('缺少工作流输入区', true); return; }
    const base = String(promotedLabel(pin, param) || param.replace(/^inputs\./, '') || '变量')
      .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
      .replace(/^_+|_+$/g, '') || '变量';
    let name = base;
    let index = 1;
    while (Object.prototype.hasOwnProperty.call(inputs, name)) { name = `${base}_${index}`; index += 1; }
    mutate(() => {
      const promotedPin = boolOperand && (!pin.type || pin.type === 'any') ? { ...pin, type: literalType(current), definition: { type: literalType(current) } } : pin;
      inputs[name] = promotedVariableDefinition(promotedPin, current);
      if (boolOperand) {
        operands[param === 'left' ? 0 : 1] = { ref: `inputs.${name}` };
        node.expression = { [operator || 'eq']: operands };
      } else if (param.startsWith('inputs.')) {
        if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
        node.params.inputs[param.slice('inputs.'.length)] = { ref: `inputs.${name}` };
      } else node.params[param] = { ref: `inputs.${name}` };
      delete variableLinks()[`${nodeId}:${param}`];
      // 创建变量卡片并登记连线：端口右键后即可看到“变量卡片 + 自动连线”
      const pins = nodeVariablePins(node);
      const pinIndex = Math.max(0, pins.findIndex((item) => item.param === param));
      // 从端口拖到空白处时，让新卡片的输出端点正好落在松手位置；右键“提升为变量”仍沿用自动位置。
      const at = point
        ? { x: Math.round(point.x - variableCardWidth), y: Math.round(point.y - variableCardPortY) }
        : variableCardPosition(node, pinIndex);
      const cardId = nextVariableCardId();
      variableCards()[cardId] = { name, scope: 'inputs', x: at.x, y: at.y };
      variableLinks()[`${nodeId}:${param}`] = cardId;
    });
    toast(`已创建变量「${name}」并连接端口`);
  }

  /** 复制变量引用文本（如 inputs.模板）到剪贴板。 */
  function copyVariableReferenceDefault(scope: string, name: string): void {
    const text = `${scope}.${name}`;
    const owner = deps.getNavigator ? deps.getNavigator() : (typeof navigator !== 'undefined' ? navigator : undefined);
    const clipboard = owner ? (owner as Navigator & { clipboard?: { writeText(value: string): Promise<void> } }).clipboard : undefined;
    if (clipboard && clipboard.writeText) {
      clipboard.writeText(text).then(() => toast(`已复制 ${text}`)).catch(() => toast(`请手动复制：${text}`));
    } else toast(`请手动复制：${text}`);
  }

  const copyReference = deps.copyVariableReference ?? copyVariableReferenceDefault;
  const insertAbove = deps.insertNodeAbove ?? insertNodeAbove;
  const addChild = deps.addChildNode ?? addChildNode;
  const promotePin = deps.promotePinToVariable ?? promotePinToVariable;

  return {
    nodeInputPortMenuItems,
    nodeOutputPortMenuItems,
    nodeReferencePortMenuItems,
    nodeVariablePinMenuItems,
    valueCardMenuItems,
    instanceRunPinMenuItems,
    variableCardPortMenuItems,
    insertNodeAbove,
    addChildNode,
    promotePinToVariable,
    copyVariableReference: copyVariableReferenceDefault,
  };
}
