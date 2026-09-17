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
  startConnection(event: PointerLike | null, nodeId: string, point: PortPoint): void;
  startVariableConnectionFromPin(event: PointerLike | null, nodeId: string, param: string, point: PortPoint): void;
  startVariableConnectionFromInstanceInput(event: PointerLike | null, nodeId: string, runIndex: number, param: string, point: PortPoint): void;
  startVariableConnectionFromCard(event: PointerLike | null, scope: string, name: string, cardId: string, point: PortPoint): void;
  parentOf(childId: string): { node: any; index: number } | null;
  buildNode(type: string): any;
  canConnect(parentId: string, childId: string): string | null;
  connect(parentId: string, childId: string): unknown;
  disconnect(parentId: string, childId: string): void;
  mutate(fn: () => void): void;
  nodeById(id: string): any;
  position(node: any): PortPoint;
  layout(): Record<string, any>;
  nodes(): any[];
  nodeVariablePins(node: any): PortPin[];
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
  /** 可选覆盖：测试或宿主希望替换默认实现（菜单项调用覆盖实现，公开 API 仍是默认实现）。 */
  copyVariableReference?(scope: string, name: string): void;
  insertNodeAbove?(childId: string, type: string): void;
  addChildNode?(parentId: string, type: string, point: PortPoint): void;
  promotePinToVariable?(nodeId: string, param: string, pin: PortPin): void;
  /** 剪贴板所在 navigator，便于在 vm/测试环境注入；默认取全局。 */
  getNavigator?(): Navigator | undefined;
}

export interface CanvasPortMenu {
  nodeInputPortMenuItems(nodeId: string, point: PortPoint): MenuEntry[];
  nodeOutputPortMenuItems(nodeId: string, point: PortPoint): MenuEntry[];
  nodeVariablePinMenuItems(nodeId: string, pin: PortPin, point: PortPoint): MenuEntry[];
  instanceRunPinMenuItems(card: PortRunCard, variable: { name: string }, point: PortPoint): MenuEntry[];
  variableCardPortMenuItems(card: PortVariableCard, point: PortPoint): MenuEntry[];
  insertNodeAbove(childId: string, type: string): void;
  addChildNode(parentId: string, type: string, point: PortPoint): void;
  promotePinToVariable(nodeId: string, param: string, pin: PortPin): void;
  copyVariableReference(scope: string, name: string): void;
}

export function createCanvasPortMenu(deps: PortMenuDeps): CanvasPortMenu {
  const {
    state, startConnectionFromInput, startConnection, startVariableConnectionFromPin,
    startVariableConnectionFromInstanceInput, startVariableConnectionFromCard, parentOf, buildNode,
    canConnect, connect, disconnect, mutate, nodeById, position, layout, nodes, nodeVariablePins,
    variableCards, variableLinks, nextVariableCardId, variableCardList, variableCardPosition,
    focusVariableCard, placeVariableCard, disconnectVariableFromPin, disconnectVariableFromInstanceInput,
    removeVariableCard, fieldLabel, toast, typeNames, nodeWidth,
  } = deps;

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
  function nodeOutputPortMenuItems(nodeId: string, point: PortPoint): MenuEntry[] {
    const node = nodeById(nodeId);
    const children = node && Array.isArray(node.children) ? node.children.filter((id: string) => nodeById(id)) : [];
    const items: MenuEntry[] = [{ label: '从这里开始连线', run: () => startConnection(null, nodeId, point) }];
    if (children.length) {
      items.push('separator', { label: `断开全部子链接（${children.length} 条）`, danger: true, run: () => { mutate(() => { for (const childId of [...children]) disconnect(nodeId, childId); }); } });
    }
    items.push('separator', {
      label: '创建并连接节点',
      children: ([['task', 'Task'], ['sequence', 'Sequence'], ['selector', 'Selector'], ['simple_parallel', 'Simple Parallel'], ['parallel', 'Parallel'], ['repeat_until', 'Repeat Until'], ['branch', 'Branch'], ['switch', 'Switch'], ['instance_parallel', 'Instance Parallel']] as Array<[string, string]>)
        .map(([type, label]) => ({ label, run: () => addChild(nodeId, type, point) })),
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
    } else {
      items.push({ label: '从这里开始连线（绑定变量）', run: () => startVariableConnectionFromPin(null, nodeId, pin.param, point) });
      items.push('separator', { label: '提升为变量', run: () => promotePin(nodeId, pin.param, pin) });
    }
    return items;
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
    const parentError = canConnect(parent.node.id, node.id);
    const childError = canConnect(node.id, childId);
    if (parentError || childError) { toast(parentError || childError!, true); return; }
    const at = position(nodeById(childId));
    const from = position(parent.node);
    mutate(() => {
      nodes().push(node);
      layout()[node.id] = { x: Math.round((from.x + at.x) / 2), y: Math.round((from.y + at.y) / 2) - 24 };
      connect(parent.node.id, node.id);
      connect(node.id, childId);
      state.selected = new Set([node.id]);
      state.selectedRun = null;
      state.inspector = 'node';
    });
    toast(`已在上方插入 ${typeNames[type] || type}`);
  }

  /** 在输出端口附近创建节点并直接连为当前节点的子节点。 */
  function addChildNode(parentId: string, type: string, point: PortPoint): void {
    const node = buildNode(type);
    const error = canConnect(parentId, node.id);
    if (error) { toast(error, true); return; }
    mutate(() => {
      nodes().push(node);
      layout()[node.id] = { x: Math.round(point.x - nodeWidth / 2), y: Math.round(point.y + 24) };
      connect(parentId, node.id);
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
  function promotedVariableDefinition(pin: PortPin, current: any): Record<string, unknown> {
    const source = pin.definition && typeof pin.definition === 'object' ? pin.definition : {};
    const definition: Record<string, unknown> = {};
    for (const key of VARIABLE_STRUCTURE_KEYS) {
      if (source[key] !== undefined) definition[key] = copyValue(source[key]);
    }
    if (definition.type === undefined) definition.type = pin.type || 'any';
    const label = fieldLabel(pin.param);
    if (label && label !== pin.param) definition.display_name = label;
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

  /** UE 的 Promote to Variable：把参数字面量提升为工作流输入变量，绑定端口，并在画布创建变量卡片自动连上。 */
  function promotePinToVariable(nodeId: string, param: string, pin: PortPin): void {
    const node = nodeById(nodeId);
    if (!node) return;
    const current = param.startsWith('inputs.')
      ? (node.params && node.params.inputs && typeof node.params.inputs === 'object' ? node.params.inputs[param.slice('inputs.'.length)] : undefined)
      : (node.params ? node.params[param] : undefined);
    if (pin.variable || isBindingObject(current)) { toast('该端口已绑定变量，不能重复提取', true); return; }
    const inputs = state.raw && state.raw.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) { toast('缺少工作流输入区', true); return; }
    const base = String(fieldLabel(param) || param.replace(/^inputs\./, '') || '变量')
      .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
      .replace(/^_+|_+$/g, '') || '变量';
    let name = base;
    let index = 1;
    while (Object.prototype.hasOwnProperty.call(inputs, name)) { name = `${base}_${index}`; index += 1; }
    mutate(() => {
      inputs[name] = promotedVariableDefinition(pin, current);
      if (param.startsWith('inputs.')) {
        if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
        node.params.inputs[param.slice('inputs.'.length)] = { ref: `inputs.${name}` };
      } else node.params[param] = { ref: `inputs.${name}` };
      delete variableLinks()[`${nodeId}:${param}`];
      // 创建变量卡片并登记连线：端口右键后即可看到“变量卡片 + 自动连线”
      const pins = nodeVariablePins(node);
      const pinIndex = Math.max(0, pins.findIndex((item) => item.param === param));
      const at = variableCardPosition(node, pinIndex);
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
    nodeVariablePinMenuItems,
    instanceRunPinMenuItems,
    variableCardPortMenuItems,
    insertNodeAbove,
    addChildNode,
    promotePinToVariable,
    copyVariableReference: copyVariableReferenceDefault,
  };
}
