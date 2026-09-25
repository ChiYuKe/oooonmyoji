/**
 * 节点图 v5 ⇄ 画布编辑形态的双向转换与图结构检查。
 *
 * 权威契约是 `docs/graph-document-v5.md`，运行时编译器在 Python
 * （`src/oooonmyoji/workflows/graph_compile.py`）。这一份是**桌面端**的对应物：
 *
 * - `toCanvasDocument`：v5 → 画布内部形态（`children` / `ports` / `cases[].child` /
 *   `default_child` / `_layout` / `_layoutLocks`）。画布内部仍然按这套字段工作，
 *   于是渲染、命中、连线、节点组这些成熟代码一行不用改。
 * - `toGraphDocument`：画布内部形态 → v5（`at` + `edges`）。落盘写的是这个。
 * - `graphDocumentIssues`：图结构问题（未知节点、非法引脚、一个口接两条、一父多子、
 *   成环、switch 空分支、暂不支持的数据边）。**不能靠 v4 校验兜底**——转换时被跳过的
 *   边必须在这里报出来，否则会「线还在，保存后就没了」。
 *
 * 引脚命名与 Python 侧完全一致：`then.<下标>` / `true` / `false` / `case.<下标>` / `default`。
 */
import type { ValidationIssue } from './types';
import { NODE_TYPES } from './types';

export const GRAPH_SCHEMA_VERSION = 6;

/** 自定义节点类型：`x-…` → 内置基类 + 预设载荷（定义写在文档的 `nodeTypes` 里）。 */
export const CUSTOM_TYPE_PREFIX = 'x-';
const BUILTIN_NODE_TYPES = new Set<string>(NODE_TYPES);
const DEFINITION_DISPLAY_KEYS = new Set(['base', 'title', 'description', 'tint']);
const DEFINITION_FORBIDDEN_KEYS = new Set([
  'id', 'type', 'children', 'ports', 'default_child', 'at', 'size', 'locked', 'comment',
]);
/** 画布内部用：节点来自哪个自定义类型（写回图文档时还原，不进 v4 文档）。 */
export const CUSTOM_TYPE_MARKER = '_nodeType';

/** 变量节点：图里的「变量/输入」数据源（编辑器里的变量卡，运行时没有对应节点）。 */
export const VARIABLE_NODE_TYPE = 'variable';
const VARIABLE_SCOPES = ['inputs', 'variables'] as const;
/** 只活在编辑器/图文档里的节点类型。 */
const GRAPH_ONLY_NODE_TYPES = new Set<string>([VARIABLE_NODE_TYPE]);

const CONDITION_PINS = ['true', 'false'] as const;
const NODE_STRUCTURE_KEYS = ['children', 'ports', 'default_child'];
const NODE_EDITOR_KEYS = ['at', 'size', 'locked', 'comment'];

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 深拷载荷。
 *
 * 两个转换函数都会往载荷里写/摘 `{"ref": …}`（`setAtPath` / `deleteAtPath`）；
 * 浅拷会让这些改动穿透到调用方手里的文档上——画布正在编辑的那份 `state.raw`
 * 会被就地改写（保存时就会出现「边 + 内联引用」双份表示）。
 */
function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = cloneValue(child);
    return out as unknown as T;
  }
  return value;
}

export function isGraphDocument(raw: unknown): boolean {
  return isRecord(raw) && raw.schema_version === GRAPH_SCHEMA_VERSION;
}

export function isExecOutPin(pin: string): boolean {
  if (pin === 'then' || pin === 'true' || pin === 'false' || pin === 'default') return true;
  const [head, tail] = splitPin(pin);
  return (head === 'then' || head === 'case') && tail !== '';
}

function splitPin(pin: string): [string, string] {
  const index = pin.indexOf('.');
  return index < 0 ? [pin, ''] : [pin.slice(0, index), pin.slice(index + 1)];
}

/** 会产出 `nodes.<id>.output…` 或 `inputs./variables.` 数据源的节点类型。 */
const OUTPUT_NODE_TYPES = new Set(['task', 'bool_judge', 'break', VARIABLE_NODE_TYPE]);

function isDataOutPin(pin: string): boolean {
  return pin === 'out' || pin.startsWith('out.');
}

/**
 * 变量节点的 id：`(作用域, 键)` 推导而来。
 *
 * v4 的引用里只有 `variables.x`，卡片 id 过一趟编译就没了，所以 id 必须从引用本身推出来，
 * 这样「编译 → 反编译」与反复刷新都稳定（同名重复卡片会并成一个变量）。与 Python
 * `graph_compile.decompile_workflow` 同一套规则。
 */
function variableNodeId(scope: string, name: string, usedIds: Set<string>): string {
  let candidate = `var__${scope}__${name}`;
  while (usedIds.has(candidate)) candidate += '_';
  usedIds.add(candidate);
  return candidate;
}

/** 变量 → 参数这条边在 `_variableLinks` 里对应的键（只覆盖桌面端自己维护的两类）。 */
function variableLinkKey(nodeId: string, path: (string | number)[]): string | null {
  if (path[0] === 'params' && path.length > 1) return `${nodeId}:${path.slice(1).join('.')}`;
  if (path[0] === 'runs') return `${nodeId}:${path.join('.')}`;
  return null;
}

/** 组卡与两张组内合成卡的布局键（画布按这三个 id 记位置）。 */
const GROUP_INTERFACE_PREFIX = '__node_group_interface__:';
const GROUP_VARIABLES_PREFIX = '__node_group_variables__:';

/**
 * 手工折线（UE Knot）在画布侧的旁表。
 *
 * 文件里折点挂在边上（`edges[].waypoints`），而画布的边是从 `children` 现推出来的、
 * 没有可以挂东西的对象，所以边界上用这张表承接：键就是边自身的身份（from/to 的
 * 节点与引脚），执行边与数据边因此不会互相串。
 */
const EDGE_WAYPOINTS_KEY = '_edgeWaypoints';

/** `then` 是 `then.0` 的别名：折点表的键统一用规范写法，别名写法不会丢折点。 */
function canonicalPin(pin: string): string {
  return pin === 'then' ? 'then.0' : pin;
}

function edgeIdentity(edge: any): string {
  const from = edge?.from;
  const to = edge?.to;
  if (!isRecord(from) || !isRecord(to)) return '';
  if (typeof from.node !== 'string' || typeof from.pin !== 'string') return '';
  if (typeof to.node !== 'string' || typeof to.pin !== 'string') return '';
  return `${from.node}\u0000${canonicalPin(from.pin)}\u0000${to.node}\u0000${to.pin}`;
}

function readWaypoints(value: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isPosition(item))
    .map((item) => ({ x: Math.trunc(item.x), y: Math.trunc(item.y) }));
}

/** 折点的问题：结构由 schema 兜底，这里只挡「坐标不是整数」这类硬错。 */
export function graphWaypointIssues(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isGraphDocument(raw) || !Array.isArray((raw as any).edges)) return issues;
  ((raw as any).edges as any[]).forEach((edge, index) => {
    if (!isRecord(edge) || edge.waypoints === undefined) return;
    if (!Array.isArray(edge.waypoints)) {
      issues.push(issue(['edges', index, 'waypoints'], '折点必须是数组', 'graph-waypoint-shape'));
      return;
    }
    edge.waypoints.forEach((point: any, pointIndex: number) => {
      if (!isPosition(point)) {
        issues.push(issue(['edges', index, 'waypoints', pointIndex], '折点必须写整数坐标 x / y', 'graph-waypoint-position'));
      }
    });
  });
  return issues;
}

function isPosition(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

/** 节点组的问题：成员与端点必须存在且自洽（运行时不认识组，但文档里写了就要说清楚）。 */
export function graphGroupIssues(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isGraphDocument(raw) || !Array.isArray((raw as any).groups)) return issues;
  const nodeIds = new Set(
    (Array.isArray((raw as any).nodes) ? (raw as any).nodes : [])
      .map((node: any) => node?.id)
      .filter((id: unknown): id is string => typeof id === 'string'),
  );
  const seen = new Set<string>();
  ((raw as any).groups as any[]).forEach((group, index) => {
    if (!isRecord(group)) {
      issues.push(issue(['groups', index], '节点组必须是对象', 'graph-group-shape'));
      return;
    }
    const groupId = group.id;
    if (typeof groupId !== 'string' || !groupId) {
      issues.push(issue(['groups', index, 'id'], '节点组必须有 id', 'graph-group-id'));
      return;
    }
    if (seen.has(groupId)) {
      issues.push(issue(['groups', index, 'id'], `节点组 id 重复：${groupId}`, 'graph-group-duplicate'));
      return;
    }
    seen.add(groupId);
    const members = Array.isArray(group.nodeIds) ? group.nodeIds : [];
    if (!members.length) {
      issues.push(issue(['groups', index, 'nodeIds'], `节点组 ${groupId} 至少要有一个成员节点`, 'graph-group-members'));
      return;
    }
    for (const member of members) {
      if (!nodeIds.has(member)) {
        issues.push(issue(['groups', index, 'nodeIds'], `节点组 ${groupId} 指向不存在的节点：${member}`, 'graph-group-unknown-member'));
      }
    }
    if (group.pins === undefined) return;
    if (!Array.isArray(group.pins)) {
      issues.push(issue(['groups', index, 'pins'], `节点组 ${groupId} 的 pins 必须是数组`, 'graph-group-pins'));
      return;
    }
    group.pins.forEach((pin: any, pinIndex: number) => {
      if (!isRecord(pin) || typeof pin.nodeId !== 'string' || typeof pin.param !== 'string' || !pin.param) {
        issues.push(issue(['groups', index, 'pins', pinIndex], `节点组 ${groupId} 的端点必须写 nodeId 与 param`, 'graph-group-pin-shape'));
        return;
      }
      if (!members.includes(pin.nodeId)) {
        issues.push(issue(['groups', index, 'pins', pinIndex, 'nodeId'], `节点组 ${groupId} 的端点指向组外节点：${pin.nodeId}`, 'graph-group-pin-outside'));
      }
    });
  });
  return issues;
}

const BOOL_JUDGE_OPERANDS = ['left', 'right'] as const;

/** 布尔判断卡片当前的比较运算符（只有 `{op: [a, b]}` 形态才有操作数引脚）。 */
function boolJudgeOperator(node: any): string | null {
  const expression = node?.expression;
  if (!isRecord(expression)) return null;
  const keys = Object.keys(expression);
  if (keys.length !== 1) return null;
  const operator = keys[0];
  const operands = expression[operator];
  if (operator === 'ref' || !Array.isArray(operands) || operands.length !== 2) return null;
  return operator;
}

/**
 * 数据输入引脚 → 载荷路径（编译方向）。与 Python `workflows/graph_pins.py` 的
 * `pin_to_path` 一一对应：认不出来就返回 null，那条引用原样留在参数里。
 */
export function dataPinToPath(node: any, pin: string): (string | number)[] | null {
  const type = node?.type;
  if (type === 'task') {
    if (pin.startsWith('inputs.') && pin.length > 'inputs.'.length) {
      return ['params', 'inputs', ...pin.slice('inputs.'.length).split('.')];
    }
    if (!pin || pin.startsWith('out')) return null;
    return ['params', ...pin.split('.')];
  }
  if (type === 'condition' && pin === 'condition') return ['expression'];
  if (type === 'repeat_until' && pin === 'condition') return ['condition'];
  if (type === 'switch' && pin === 'expression') return ['expression'];
  if (type === 'break' && pin === 'ref') return ['ref'];
  if (type === 'bool_judge') {
    if (pin === 'condition') return ['expression'];
    if ((BOOL_JUDGE_OPERANDS as readonly string[]).includes(pin)) {
      const operator = boolJudgeOperator(node);
      if (operator === null) return null;
      return ['expression', operator, (BOOL_JUDGE_OPERANDS as readonly string[]).indexOf(pin)];
    }
    return null;
  }
  if (type === 'branch') {
    const [head, tail] = splitPin(pin);
    if (head === 'conditions' && /^\d+$/.test(tail)) return ['conditions', Number(tail)];
    return null;
  }
  if (type === 'instance_parallel') {
    const [head, tail] = splitPin(pin);
    if (head !== 'runs') return null;
    const [runIndex, ...rest] = tail.split('.');
    if (!/^\d+$/.test(runIndex) || rest.length < 2 || rest[0] !== 'inputs') return null;
    return ['runs', Number(runIndex), 'inputs', ...rest.slice(1)];
  }
  const [head, tail] = splitPin(pin);
  if (head === 'decorators') {
    const [decoratorIndex, field] = tail.split('.');
    if (/^\d+$/.test(decoratorIndex) && field) return ['decorators', Number(decoratorIndex), field];
  }
  return null;
}

/** 载荷路径 → 数据输入引脚（反编译方向）。与 Python 的 `path_to_pin` 一一对应。 */
export function payloadPathToPin(node: any, path: (string | number)[]): string | null {
  const type = node?.type;
  if (path.length === 0) return null;
  const head = path[0];
  if (head === 'params') {
    const rest = path.slice(1);
    if (rest.length === 0) return null;
    if (rest[0] === 'inputs' && rest.length > 1) return `inputs.${rest.slice(1).join('.')}`;
    return rest.join('.');
  }
  if (head === 'expression') {
    if (path.length === 1) {
      if (type === 'condition' || type === 'bool_judge') return 'condition';
      if (type === 'switch') return 'expression';
      return null;
    }
    if (type === 'bool_judge' && path.length === 3 && /^\d+$/.test(String(path[2]))) {
      if (boolJudgeOperator(node) !== String(path[1])) return null;
      const index = Number(path[2]);
      if (index >= 0 && index < BOOL_JUDGE_OPERANDS.length) return BOOL_JUDGE_OPERANDS[index];
    }
    return null;
  }
  if (head === 'condition' && type === 'repeat_until' && path.length === 1) return 'condition';
  if (head === 'ref' && type === 'break' && path.length === 1) return 'ref';
  if (head === 'conditions' && type === 'branch' && path.length === 2) return `conditions.${path[1]}`;
  if (head === 'runs' && type === 'instance_parallel' && path.length >= 4 && path[2] === 'inputs') {
    return `runs.${path[1]}.inputs.${path.slice(3).join('.')}`;
  }
  if (head === 'decorators' && path.length === 3) return `decorators.${path[1]}.${path[2]}`;
  return null;
}

/** 遍历一段载荷里所有 `{"ref": "nodes.…"}`，产出（路径, 引用文本）。 */
export function iterNodeRefs(value: unknown, path: (string | number)[] = []): Array<[(string | number)[], string]> {
  const found: Array<[(string | number)[], string]> = [];
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const ref = value.ref;
    if (keys.length === 1 && keys[0] === 'ref' && typeof ref === 'string') {
      if (ref.startsWith('nodes.')) found.push([path, ref]);
      return found;
    }
    for (const key of keys) found.push(...iterNodeRefs(value[key], [...path, key]));
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => found.push(...iterNodeRefs(child, [...path, index])));
  }
  return found;
}

/** 遍历一段载荷里所有 `{"ref": "inputs.… / variables.…"}`。 */
export function iterVariableRefs(value: unknown, path: (string | number)[] = []): Array<[(string | number)[], string]> {
  const found: Array<[(string | number)[], string]> = [];
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const ref = value.ref;
    if (keys.length === 1 && keys[0] === 'ref' && typeof ref === 'string') {
      if (ref.startsWith('inputs.') || ref.startsWith('variables.')) found.push([path, ref]);
      return found;
    }
    for (const key of keys) found.push(...iterVariableRefs(value[key], [...path, key]));
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => found.push(...iterVariableRefs(child, [...path, index])));
  }
  return found;
}

function resolveSegment(container: any, segment: string | number): string | number {
  // 容器是数组时把数字字符串当索引（引脚里的 `states.0.threshold` 就是这种）。
  if (Array.isArray(container) && typeof segment === 'string' && /^\d+$/.test(segment)) return Number(segment);
  return segment;
}

/** 把值写到载荷路径上，缺的中间容器按下一段是下标还是键自动补出来。 */
export function setAtPath(target: any, path: (string | number)[], value: unknown): void {
  let current: any = target;
  path.forEach((rawSegment, position) => {
    const segment = resolveSegment(current, rawSegment);
    const last = position === path.length - 1;
    const following = path[position + 1];
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) throw new Error(`payload path expects an array at ${path.slice(0, position + 1).join('.')}`);
      while (current.length <= segment) current.push(null);
      if (last) {
        current[segment] = value;
        return;
      }
      if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
        current[segment] = typeof following === 'number' ? [] : {};
      }
      current = current[segment];
      return;
    }
    if (!isRecord(current)) throw new Error(`payload path expects an object at ${path.slice(0, position + 1).join('.')}`);
    if (last) {
      current[segment] = value;
      return;
    }
    if (!isRecord(current[segment]) && !Array.isArray(current[segment])) {
      current[segment] = typeof following === 'number' ? [] : {};
    }
    current = current[segment];
  });
}

/**
 * 把载荷路径上的值摘掉；路径不存在时静默跳过。
 *
 * 数组里的元素**留洞（置 null）而不是删除**：删掉会让后面的元素前移，
 * 同一段里的另一个引用就会挪位——编译回填时会把相邻的字面量盖掉。
 */
export function deleteAtPath(target: any, path: (string | number)[]): void {
  let current: any = target;
  for (const rawSegment of path.slice(0, -1)) {
    const segment = resolveSegment(current, rawSegment);
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) return;
      current = current[segment];
    } else {
      if (!isRecord(current) || !(segment in current)) return;
      current = current[segment];
    }
  }
  const last = resolveSegment(current, path[path.length - 1]);
  if (typeof last === 'number') {
    if (Array.isArray(current) && last < current.length) current[last] = null;
  } else if (isRecord(current)) {
    delete current[last];
  }
}

function issue(path: (string | number)[], message: string, code: string): ValidationIssue {
  return { path, message, severity: 'error', code };
}

function nodeLabel(node: any): string {
  return `${node?.id ?? '<unknown>'}（${node?.type ?? '?'}）`;
}

/** 这个类型的执行出口长什么样（只用于报错说明）。 */
function execPinHint(node: any): string {
  if (node?.type === 'condition') return 'true / false';
  if (node?.type === 'switch') return 'case.<下标> / default';
  return 'then.<下标>';
}

function mergeDicts(defaults: Record<string, any>, overrides: Record<string, any>): Record<string, any> {
  const merged: Record<string, any> = cloneValue(defaults);
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = isRecord(value) && isRecord(merged[key]) ? mergeDicts(merged[key], value) : cloneValue(value);
  }
  return merged;
}

/** 读出 `nodeTypes` 定义表（结构不对的条目跳过，问题由 `graphNodeTypeIssues` 报出）。 */
export function nodeTypeDefinitions(raw: unknown): Record<string, any> {
  if (!isRecord(raw) || !isRecord(raw.nodeTypes)) return {};
  return raw.nodeTypes as Record<string, any>;
}

/**
 * 自定义类型定义的问题。与 Python `graph_types.node_type_definitions` 同一套规矩：
 * `x-` 前缀、不得重定义内置类型、必须有内置 `base`、不得藏结构字段。
 */
export function graphNodeTypeIssues(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isGraphDocument(raw) || !isRecord((raw as any).nodeTypes)) return issues;
  const definitions = (raw as any).nodeTypes as Record<string, any>;
  for (const [name, definition] of Object.entries(definitions)) {
    if (!name || !name.startsWith(CUSTOM_TYPE_PREFIX)) {
      issues.push(issue(['nodeTypes', name], `自定义节点类型名必须以 '${CUSTOM_TYPE_PREFIX}' 开头：${name}`, 'graph-type-name'));
      continue;
    }
    if (BUILTIN_NODE_TYPES.has(name)) {
      issues.push(issue(['nodeTypes', name], `'${name}' 是内置类型，不能重定义`, 'graph-type-builtin'));
      continue;
    }
    if (!isRecord(definition)) {
      issues.push(issue(['nodeTypes', name], '节点类型定义必须是对象', 'graph-type-shape'));
      continue;
    }
    const forbidden = Object.keys(definition).filter((key) => DEFINITION_FORBIDDEN_KEYS.has(key));
    if (forbidden.length) {
      issues.push(issue(['nodeTypes', name], `节点类型定义不能写结构字段：${forbidden.join('、')}`, 'graph-type-structure'));
      continue;
    }
    if (typeof definition.base !== 'string' || !BUILTIN_NODE_TYPES.has(definition.base)) {
      issues.push(issue(['nodeTypes', name, 'base'], `base 必须是内置类型之一：${definition.base ?? '缺失'}`, 'graph-type-base'));
    }
  }
  return issues;
}

/**
 * 把节点解析成「内置基类 + 合并后的载荷」。解析不出自定义类型时原样返回，
 * 由 `graphNodeTypeIssues` / `graphDocumentIssues` 报错——转换保持宽容。
 */
export function resolveCustomNode(node: any, definitions: Record<string, any>): any {
  const type = node?.type;
  if (typeof type !== 'string' || !type || BUILTIN_NODE_TYPES.has(type)) return node;
  const definition = definitions[type];
  if (!isRecord(definition) || typeof definition.base !== 'string' || !BUILTIN_NODE_TYPES.has(definition.base)) {
    return node;
  }
  const payload: Record<string, any> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') continue;
    payload[key] = cloneValue(value);
  }
  for (const [key, value] of Object.entries(definition)) {
    if (key === 'base' || DEFINITION_DISPLAY_KEYS.has(key)) continue;
    if (key === 'params' && isRecord(value)) {
      payload.params = mergeDicts(value, isRecord(payload.params) ? payload.params : {});
      continue;
    }
    if (!(key in payload)) payload[key] = cloneValue(value);
  }
  payload.type = definition.base;
  if (!('name' in payload) && typeof definition.title === 'string') payload.name = definition.title;
  // 记住来源，写回图文档时还原成 `x-…`；画布内部按基类工作。
  payload[CUSTOM_TYPE_MARKER] = type;
  return payload;
}

/**
 * 图结构检查。只报「转换与编译会出问题」的硬错误，节点语义（参数、绑定、装饰器）
 * 仍然交给同一份 v4 校验器。
 */
export function graphDocumentIssues(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isGraphDocument(raw)) return issues;
  const document = raw as Record<string, any>;
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const definitions = nodeTypeDefinitions(document);
  issues.push(
    ...graphNodeTypeIssues(document),
    ...graphGroupIssues(document),
    ...graphCommentIssues(document),
    ...graphWaypointIssues(document),
  );
  const byId = new Map<string, any>();
  /** 解析后的节点（自定义类型 → 基类 + 预设载荷）：引脚合法性按基类判定。 */
  const resolvedById = new Map<string, any>();
  nodes.forEach((node, index) => {
    const id = node?.id;
    if (typeof id !== 'string' || !id) {
      issues.push(issue(['nodes', index, 'id'], '节点缺少 id', 'graph-node-id'));
      return;
    }
    if (byId.has(id)) issues.push(issue(['nodes', index, 'id'], `节点 id 重复：${id}`, 'graph-duplicate-node'));
    const type = node?.type;
    if (typeof type !== 'string' || !type) {
      issues.push(issue(['nodes', index, 'type'], `节点 ${id} 缺少类型`, 'graph-node-type'));
    } else if (type === VARIABLE_NODE_TYPE) {
      // 变量节点（编辑器里的变量卡）：作用域与键必须有。
      if (!(VARIABLE_SCOPES as readonly string[]).includes(node?.scope)) {
        issues.push(issue(['nodes', index, 'scope'], `变量节点 ${id} 的 scope 必须是 ${VARIABLE_SCOPES.join(' / ')}`, 'graph-variable-scope'));
      }
      if (typeof node?.name !== 'string' || !node.name) {
        issues.push(issue(['nodes', index, 'name'], `变量节点 ${id} 必须写 name`, 'graph-variable-name'));
      }
    } else if (!BUILTIN_NODE_TYPES.has(type) && !GRAPH_ONLY_NODE_TYPES.has(type)) {
      const definition = definitions[type];
      if (!isRecord(definition) || typeof definition.base !== 'string' || !BUILTIN_NODE_TYPES.has(definition.base)) {
        issues.push(issue(
          ['nodes', index, 'type'],
          `节点 ${id} 用了未声明的节点类型 '${type}'：内置类型之外的类型必须写在 nodeTypes 里（以 '${CUSTOM_TYPE_PREFIX}' 开头并给出内置 base）`,
          'graph-unknown-type',
        ));
      }
    }
    byId.set(id, node);
    resolvedById.set(id, resolveCustomNode(node, definitions));
  });
  const edges = document.edges;
  if (!Array.isArray(edges)) {
    issues.push(issue(['edges'], '节点图必须定义 edges 数组', 'graph-missing-edges'));
    return issues;
  }
  const parents = new Map<string, string>();
  const seenPins = new Set<string>();
  const dataPins = new Set<string>();
  edges.forEach((edge, index) => {
    const source = edge?.from;
    const target = edge?.to;
    if (!isRecord(source) || !isRecord(target)) {
      issues.push(issue(['edges', index], '边必须定义 from 与 to', 'graph-edge-shape'));
      return;
    }
    const sourceId = source.node;
    const sourcePin = source.pin;
    const targetId = target.node;
    const targetPin = target.pin;
    if (typeof sourceId !== 'string' || typeof sourcePin !== 'string') {
      issues.push(issue(['edges', index, 'from'], '边缺少来源节点或引脚', 'graph-edge-shape'));
      return;
    }
    if (typeof targetId !== 'string' || typeof targetPin !== 'string') {
      issues.push(issue(['edges', index, 'to'], '边缺少目标节点或引脚', 'graph-edge-shape'));
      return;
    }
    const sourceNode = byId.get(sourceId);
    if (!sourceNode) {
      issues.push(issue(['edges', index, 'from', 'node'], `边指向不存在的节点：${sourceId}`, 'graph-unknown-node'));
      return;
    }
    if (!byId.has(targetId)) {
      issues.push(issue(['edges', index, 'to', 'node'], `边指向不存在的节点：${targetId}`, 'graph-unknown-node'));
      return;
    }
    // 引脚判定一律按解析后的节点（自定义类型在画布/编译器眼里就是它的基类）。
    const resolvedSource = resolvedById.get(sourceId) ?? sourceNode;
    const resolvedTarget = resolvedById.get(targetId) ?? byId.get(targetId);
    if (isDataOutPin(sourcePin)) {
      // 数据边：来源必须是产出输出的节点（含变量节点），目标必须认得出数据引脚位置。
      if (!OUTPUT_NODE_TYPES.has(String(resolvedSource.type))) {
        issues.push(issue(
          ['edges', index, 'from', 'pin'],
          `${nodeLabel(sourceNode)} 不产出输出，不能作为数据来源`,
          'graph-data-source',
        ));
        return;
      }
      if (resolvedTarget?.type === VARIABLE_NODE_TYPE) {
        issues.push(issue(
          ['edges', index, 'to', 'node'],
          `边指向变量节点 ${targetId}：变量节点是数据来源，不接受输入`,
          'graph-variable-target',
        ));
        return;
      }
      if (dataPinToPath(resolvedTarget, targetPin) === null) {
        issues.push(issue(
          ['edges', index, 'to', 'pin'],
          `${nodeLabel(sourceNode)} → ${nodeLabel(resolvedTarget)} 没有数据引脚 '${targetPin}'`,
          'graph-data-target',
        ));
        return;
      }
      const dataKey = `${targetId}\u0000${targetPin}`;
      if (dataPins.has(dataKey)) {
        issues.push(issue(['edges', index, 'to', 'pin'], `${nodeLabel(resolvedTarget)} 的 ${targetPin} 口接了两条线`, 'graph-double-data-pin'));
        return;
      }
      dataPins.add(dataKey);
      return;
    }
    if (!isExecOutPin(sourcePin)) {
      issues.push(issue(
        ['edges', index, 'from', 'pin'],
        `${nodeLabel(resolvedSource)} 没有 '${sourcePin}' 引脚：执行出口是 ${execPinHint(resolvedSource)}，数据出口是 out / out.<字段路径>`,
        'graph-bad-pin',
      ));
      return;
    }
    if (resolvedSource.type === VARIABLE_NODE_TYPE) {
      issues.push(issue(
        ['edges', index, 'from', 'pin'],
        `变量节点 ${sourceId} 只有数据出口 out / out.<字段路径>，没有执行流`,
        'graph-variable-exec-pin',
      ));
      return;
    }
    if (targetPin !== 'in') {
      issues.push(issue(['edges', index, 'to', 'pin'], `执行流边的目标引脚必须是 in：${targetPin}`, 'graph-bad-target-pin'));
      return;
    }
    if (sourcePin === 'true' || sourcePin === 'false') {
      if (resolvedSource.type !== 'condition') {
        issues.push(issue(['edges', index, 'from', 'pin'], `${nodeLabel(resolvedSource)} 没有 '${sourcePin}' 出口，它的执行出口是 ${execPinHint(resolvedSource)}`, 'graph-bad-pin'));
        return;
      }
    } else if (resolvedSource.type === 'condition') {
      issues.push(issue(['edges', index, 'from', 'pin'], `${nodeLabel(resolvedSource)} 没有 '${sourcePin}' 出口，它的执行出口是 ${execPinHint(resolvedSource)}`, 'graph-bad-pin'));
      return;
    } else {
      const [head, tail] = splitPin(sourcePin);
      const legal = resolvedSource.type === 'switch' ? (head === 'case' || sourcePin === 'default') : head === 'then';
      if (!legal || (head !== 'default' && tail !== '' && !/^\d+$/.test(tail))) {
        issues.push(issue(['edges', index, 'from', 'pin'], `${nodeLabel(resolvedSource)} 没有 '${sourcePin}' 出口，它的执行出口是 ${execPinHint(resolvedSource)}`, 'graph-bad-pin'));
        return;
      }
      const caseLimit = Array.isArray(resolvedSource.cases) ? resolvedSource.cases.length : 0;
      if (resolvedSource.type === 'switch' && head === 'case' && Number(tail) >= caseLimit) {
        issues.push(issue(['edges', index, 'from', 'pin'], `${nodeLabel(resolvedSource)} 只声明了 ${caseLimit} 个分支，接不到 case.${tail}`, 'graph-case-out-of-range'));
        return;
      }
    }
    const pinKey = `${sourceId}\u0000${sourcePin}`;
    if (seenPins.has(pinKey)) {
      issues.push(issue(['edges', index, 'from', 'pin'], `${nodeLabel(sourceNode)} 的 ${sourcePin} 口接了两条线`, 'graph-double-pin'));
      return;
    }
    seenPins.add(pinKey);
    const previous = parents.get(targetId);
    if (previous !== undefined) {
      issues.push(issue(['edges', index, 'to', 'node'], `节点 ${targetId} 有两个执行父级：${previous} 与 ${sourceId}`, 'graph-double-parent'));
      return;
    }
    parents.set(targetId, sourceId);
  });
  if (!issues.some((item) => item.code === 'graph-double-parent')) {
    issues.push(...cycleIssues(byId, edges));
  }
  // switch 的每个分支都必须接上：v4 的 `cases` 只认带 `child` 的分支，
  // 空分支在编译时会被直接丢掉——那是数据丢失，必须在图上说出来。
  const wiredCases = new Map<string, Set<number>>();
  for (const edge of edges) {
    const pin = edge?.from?.pin;
    const sourceId = edge?.from?.node;
    if (typeof sourceId !== 'string' || typeof pin !== 'string' || !pin.startsWith('case.')) continue;
    const bucket = wiredCases.get(sourceId) || new Set<number>();
    bucket.add(Number(pin.slice('case.'.length)));
    wiredCases.set(sourceId, bucket);
  }
  nodes.forEach((node, index) => {
    if (node?.type !== 'switch') return;
    const declared = Array.isArray(node.cases) ? node.cases : [];
    declared.forEach((_entry: any, caseIndex: number) => {
      if (!wiredCases.get(node.id)?.has(caseIndex)) {
        issues.push(issue(
          ['nodes', index, 'cases', caseIndex],
          `${nodeLabel(node)} 的分支 ${caseIndex} 没有接子节点（空分支会被丢掉）`,
          'graph-switch-unwired-case',
        ));
      }
    });
  });
  if (document.root !== undefined && typeof document.root === 'string' && !byId.has(document.root)) {
    issues.push(issue(['root'], `root 指向不存在的节点：${document.root}`, 'graph-unknown-root'));
  }
  return issues;
}

function cycleIssues(byId: Map<string, any>, edges: any[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceId = edge?.from?.node;
    const targetId = edge?.to?.node;
    if (typeof sourceId !== 'string' || typeof targetId !== 'string') continue;
    const bucket = outgoing.get(sourceId) || [];
    bucket.push(targetId);
    outgoing.set(sourceId, bucket);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (nodeId: string, trail: string[]): void => {
    if (visiting.has(nodeId)) {
      issues.push(issue(['edges'], `执行流成环：${[...trail, nodeId].join(' -> ')}`, 'graph-cycle'));
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const childId of outgoing.get(nodeId) || []) walk(childId, [...trail, nodeId]);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of byId.keys()) walk(nodeId, []);
  return issues;
}

/** 注释框（UE Comment）的问题：纯编辑期标注，运行时不认识，但文档里写了就要自洽。 */
export function graphCommentIssues(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isGraphDocument(raw) || !Array.isArray((raw as any).comments)) return issues;
  const seen = new Set<string>();
  ((raw as any).comments as any[]).forEach((comment, index) => {
    if (!isRecord(comment)) {
      issues.push(issue(['comments', index], '注释框必须是对象', 'graph-comment-shape'));
      return;
    }
    const commentId = comment.id;
    if (typeof commentId !== 'string' || !commentId) {
      issues.push(issue(['comments', index, 'id'], '注释框必须有 id', 'graph-comment-id'));
      return;
    }
    if (seen.has(commentId)) {
      issues.push(issue(['comments', index, 'id'], `注释框 id 重复：${commentId}`, 'graph-comment-duplicate'));
      return;
    }
    seen.add(commentId);
    if (typeof comment.text !== 'string') {
      issues.push(issue(['comments', index, 'text'], `注释框 ${commentId} 的 text 必须是字符串`, 'graph-comment-text'));
    }
    if (!isPosition(comment.at)) {
      issues.push(issue(['comments', index, 'at'], `注释框 ${commentId} 必须写整数坐标 at`, 'graph-comment-position'));
    }
    if (comment.size === undefined) return;
    const commentSize = comment.size;
    if (
      !isRecord(commentSize)
      || !Number.isFinite(commentSize.w)
      || !Number.isFinite(commentSize.h)
      || commentSize.w < 1
      || commentSize.h < 1
    ) {
      issues.push(issue(['comments', index, 'size'], `注释框 ${commentId} 的 size 必须是正整数 w / h`, 'graph-comment-size'));
    }
  });
  return issues;
}

/**
 * v5 → 画布内部形态。**宽容转换**：结构问题由 `graphDocumentIssues` 负责报出来，
 * 这里只保证「能转的都转过去」，不因为一条坏边丢掉整份文档。
 */
export function toCanvasDocument(raw: unknown): any {
  if (!isGraphDocument(raw)) return raw;
  const document = raw as Record<string, any>;
  const nodes: any[] = Array.isArray(document.nodes) ? document.nodes : [];
  const definitions = nodeTypeDefinitions(document);
  const byId = new Set(nodes.map((node) => node?.id).filter((id) => typeof id === 'string'));
  const converted: any[] = [];
  /** 变量节点 → 编辑器的变量卡（坐标、作用域、键）。 */
  const variableCards: Record<string, any> = {
    ...(isRecord(document._variableCards) ? document._variableCards : {}),
  };
  const variableLinks: Record<string, any> = {
    ...(isRecord(document._variableLinks) ? document._variableLinks : {}),
  };
  for (const node of nodes) {
    // 自定义类型先解析成基类 + 预设载荷；画布按基类工作，`_nodeType` 记住来源以便写回。
    const resolved = resolveCustomNode(node, definitions);
    if (resolved?.type === VARIABLE_NODE_TYPE) {
      const scope = VARIABLE_SCOPES.includes(resolved.scope) ? resolved.scope : 'inputs';
      const card: Record<string, any> = { name: resolved.name, scope };
      const at = resolved.at;
      if (isRecord(at) && Number.isFinite(at.x) && Number.isFinite(at.y)) {
        card.x = Math.trunc(at.x);
        card.y = Math.trunc(at.y);
      }
      variableCards[String(resolved.id)] = { ...(variableCards[String(resolved.id)] ?? {}), ...card };
      continue;
    }
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(resolved || {})) {
      if (NODE_EDITOR_KEYS.includes(key)) continue;
      payload[key] = cloneValue(value);
    }
    converted.push(payload);
  }

  // 引脚 → 目标：`then.<下标>` 用数字键，`case.<下标>` 用 `case:<下标>`，其余用引脚名。
  const buckets = new Map<string, Map<any, string>>();
  const edgeWaypoints: Array<{ from: any; to: any; waypoints: Array<{ x: number; y: number }> }> = [];
  for (const edge of Array.isArray(document.edges) ? document.edges : []) {
    const sourceId = edge?.from?.node;
    const pin = edge?.from?.pin;
    const targetId = edge?.to?.node;
    const targetPin = edge?.to?.pin;
    const waypoints = readWaypoints(edge?.waypoints);
    if (waypoints.length) {
      edgeWaypoints.push({
        from: { node: sourceId, pin: canonicalPin(String(pin)) },
        to: { node: targetId, pin: targetPin },
        waypoints,
      });
    }
    if (typeof sourceId !== 'string' || typeof pin !== 'string' || typeof targetId !== 'string') continue;
    if (!byId.has(sourceId) || !byId.has(targetId)) continue;
    if (isDataOutPin(pin)) {
      // 数据边落回参数里的绑定：认不出引脚位置就跳过（graphDocumentIssues 已经报过）。
      if (typeof targetPin !== 'string') continue;
      const targetNode = converted.find((node) => node.id === targetId);
      const path = targetNode ? dataPinToPath(targetNode, targetPin) : null;
      if (!path) continue;
      const sourceNode = nodes.find((node) => node?.id === sourceId);
      const sourceType = sourceNode?.type === VARIABLE_NODE_TYPE ? VARIABLE_NODE_TYPE : 'node';
      const ref = sourceType === VARIABLE_NODE_TYPE
        ? `${sourceNode.scope}.${sourceNode.name}${pin.slice('out'.length)}`
        : `nodes.${sourceId}.output${pin.slice('out'.length)}`;
      setAtPath(targetNode, path, { ref });
      if (sourceType === VARIABLE_NODE_TYPE) {
        const linkKey = variableLinkKey(targetId, path);
        if (linkKey) variableLinks[linkKey] = String(sourceId);
      }
      continue;
    }
    if (!isExecOutPin(pin)) continue;
    const bucket = buckets.get(sourceId) || new Map<any, string>();
    buckets.set(sourceId, bucket);
    if (pin === 'true' || pin === 'false' || pin === 'default') bucket.set(pin, targetId);
    else {
      const [head, tail] = splitPin(pin);
      bucket.set(head === 'case' ? `case:${Number(tail)}` : Number(tail), targetId);
    }
  }

  for (const node of converted) {
    const bucket = buckets.get(node.id);
    if (!bucket || bucket.size === 0) continue;
    if (node.type === 'condition') {
      const children: string[] = [];
      const ports: string[] = [];
      for (const port of CONDITION_PINS) {
        const child = bucket.get(port);
        if (typeof child === 'string') {
          children.push(child);
          ports.push(port);
        }
      }
      if (children.length) {
        node.children = children;
        node.ports = ports;
      }
    } else if (node.type === 'switch') {
      const declared = Array.isArray(node.cases) ? node.cases : [];
      const rebuilt: any[] = [];
      const children: string[] = [];
      declared.forEach((entry: any, index: number) => {
        const child = bucket.get(`case:${index}`);
        if (typeof child === 'string') {
          rebuilt.push({ value: entry?.value, child });
          children.push(child);
        } else {
          rebuilt.push({ value: entry?.value });
        }
      });
      node.cases = rebuilt;
      const fallback = bucket.get('default');
      if (typeof fallback === 'string') {
        node.default_child = fallback;
        children.push(fallback);
      }
      if (children.length) node.children = children;
    } else {
      const indexes = [...bucket.keys()].filter((key) => typeof key === 'number').sort((a, b) => a - b);
      if (indexes.length) node.children = indexes.map((index) => bucket.get(index));
    }
  }

  const layout: Record<string, { x: number; y: number }> = {};
  const locks: string[] = [];
  for (const node of nodes) {
    // 变量节点不是画布节点（它变成变量卡了），坐标归 `_variableCards`：
    // 写进 `_layout` 只会变成「指向不存在节点的残留坐标」，每次打开都触发一次剪枝提示。
    if (node?.type === VARIABLE_NODE_TYPE) continue;
    const at = node?.at;
    if (isRecord(at) && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      layout[String(node.id)] = { x: Math.trunc(at.x), y: Math.trunc(at.y) };
    }
    if (node?.locked === true) locks.push(String(node.id));
  }

  // 节点组回到画布的下划线旁表，组卡 / 组接口卡 / 组变量卡的位置回到 `_layout`。
  const nodeGroups: Record<string, any> = {};
  for (const group of Array.isArray(document.groups) ? document.groups : []) {
    if (!isRecord(group) || typeof group.id !== 'string' || !group.id) continue;
    const members = (Array.isArray(group.nodeIds) ? group.nodeIds : []).filter((id: unknown) => typeof id === 'string');
    if (!members.length) continue;
    // 画布旁表用「id 当键」，条目里不再重复一份 id（与编辑器的 `_nodeGroups` 形状一致）。
    const entry: Record<string, any> = {};
    if (typeof group.name === 'string' && group.name) entry.name = group.name;
    entry.nodeIds = members;
    if (Array.isArray(group.pins)) entry.pins = cloneValue(group.pins);
    if (typeof group.pinPolicy === 'string') entry.pinPolicy = group.pinPolicy;
    nodeGroups[group.id] = entry;
    for (const [key, layoutKey] of [
      ['at', group.id],
      ['interfaceAt', `${GROUP_INTERFACE_PREFIX}${group.id}`],
      ['variablesAt', `${GROUP_VARIABLES_PREFIX}${group.id}`],
    ] as const) {
      if (isPosition(group[key])) {
        layout[layoutKey] = { x: Math.trunc(group[key].x), y: Math.trunc(group[key].y) };
      }
    }
  }
  const result: Record<string, any> = { schema_version: 4 };
  for (const [key, value] of Object.entries(document)) {
    if (key === 'schema_version' || key === 'nodes' || key === 'edges') continue;
    // 节点组回到旁表（`_nodeGroups`），不再以 `groups` 出现在画布文档里。
    if (key === 'groups') continue;
    result[key] = value;
  }
  result.nodes = converted;
  result._layout = { ...(isRecord(document._layout) ? document._layout : {}), ...layout };
  if (locks.length) result._layoutLocks = locks;
  else if (Array.isArray(result._layoutLocks)) delete result._layoutLocks;
  if (Object.keys(nodeGroups).length) result._nodeGroups = nodeGroups;
  // 变量卡与变量连线是这份文档的落盘表示：只有画布内部才用下划线旁表。
  if (Object.keys(variableCards).length) result._variableCards = variableCards;
  if (Object.keys(variableLinks).length) result._variableLinks = variableLinks;
  // 折点是边的属性，画布的边是现推出来的：编辑期先寄存在这张表里，写回时再挂回边。
  if (edgeWaypoints.length) result[EDGE_WAYPOINTS_KEY] = edgeWaypoints;
  return result;
}

/**
 * 画布内部形态 → v5。引脚命名与 Python 的 `decompile_workflow` 一致：
 * 判断节点按 `children` 顺序配 `ports`（缺省 0=真、1=假），其余节点 `then.<下标>`。
 */
export function toGraphDocument(raw: unknown): any {
  if (isGraphDocument(raw)) return raw;
  if (!isRecord(raw)) return raw;
  const document = raw as Record<string, any>;
  const nodes: any[] = Array.isArray(document.nodes) ? document.nodes : [];
  const layout = isRecord(document._layout) ? document._layout : {};
  const locks = new Set((Array.isArray(document._layoutLocks) ? document._layoutLocks : []).map(String));

  const converted = nodes.map((node) => {
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(node || {})) {
      if (NODE_STRUCTURE_KEYS.includes(key)) continue;
      if (key === CUSTOM_TYPE_MARKER) continue;
      if (key === 'cases' && Array.isArray(value)) {
        payload.cases = value.map((entry: any) => (isRecord(entry) ? { value: cloneValue(entry.value) } : { value: cloneValue(entry) }));
        continue;
      }
      payload[key] = cloneValue(value);
    }
    // 画布内部按基类工作；来自自定义类型的节点写回时还原成 `x-…`。
    const customType = node?.[CUSTOM_TYPE_MARKER];
    if (typeof customType === 'string' && customType) payload.type = customType;
    const at = layout[String(node?.id)];
    if (isRecord(at) && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      payload.at = { x: Math.trunc(at.x), y: Math.trunc(at.y) };
    }
    if (locks.has(String(node?.id))) payload.locked = true;
    return payload;
  });

  // 变量卡 → 变量节点：一个 (作用域, 键) 一个节点，id 由两者推导（与 Python 同一套规则）。
  const usedNodeIds = new Set(nodes.map((node) => String(node?.id)));
  const variableNodes = new Map<string, any>();
  const variableNodeFor = (scope: string, name: string): any => {
    const key = `${scope}\u0000${name}`;
    const existing = variableNodes.get(key);
    if (existing) return existing;
    const node: Record<string, any> = {
      id: variableNodeId(scope, name, usedNodeIds),
      type: VARIABLE_NODE_TYPE,
      scope,
      name,
    };
    variableNodes.set(key, node);
    return node;
  };
  const cards = isRecord(document._variableCards) ? document._variableCards : {};
  for (const card of Object.values(cards)) {
    if (!isRecord(card)) continue;
    const name = typeof card.name === 'string' ? card.name : '';
    if (!name) continue;
    const scope = card.scope === 'variables' ? 'variables' : 'inputs';
    const node = variableNodeFor(scope, name);
    if (!('at' in node) && Number.isFinite(card.x) && Number.isFinite(card.y)) {
      node.at = { x: Math.trunc(card.x), y: Math.trunc(card.y) };
    }
  }

  const edges: Array<{ from: { node: string; pin: string }; to: { node: string; pin: string }; waypoints?: Array<{ x: number; y: number }> }> = [];
  // 折点表：键是边自身的身份（节点 + 引脚），执行边与数据边因此不会互相串。
  const waypointTable = new Map<string, Array<{ x: number; y: number }>>();
  for (const entry of Array.isArray(document[EDGE_WAYPOINTS_KEY]) ? document[EDGE_WAYPOINTS_KEY] : []) {
    const key = edgeIdentity(entry);
    const waypoints = readWaypoints(entry?.waypoints);
    if (key && waypoints.length) waypointTable.set(key, waypoints);
  }
  const attachWaypoints = (
    edge: { from: { node: string; pin: string }; to: { node: string; pin: string }; waypoints?: Array<{ x: number; y: number }> },
  ): void => {
    const waypoints = waypointTable.get(edgeIdentity(edge));
    if (waypoints) edge.waypoints = cloneValue(waypoints);
  };
  const link = (sourceId: any, pin: string, targetId: any): void => {
    if (typeof sourceId !== 'string' || typeof targetId !== 'string') return;
    const edge = { from: { node: sourceId, pin }, to: { node: targetId, pin: 'in' } };
    attachWaypoints(edge);
    edges.push(edge);
  };
  // 参数里的 `{"ref": "nodes.…"}` 提成数据边：认得出引脚位置才提，认不出的原样留着。
  // 摘引用时数组元素留洞，所以提取顺序不影响结果。
  nodes.forEach((node, index) => {
    const payload = converted[index];
    const extractions = iterNodeRefs(payload)
      .map(([path, ref]) => ({ path, ref, pin: payloadPathToPin(node, path) }))
      .filter((item): item is { path: (string | number)[]; ref: string; pin: string } => item.pin !== null);
    for (const item of extractions) {
      const parts = item.ref.split('.');
      const outputField = parts.slice(3).join('.');
      const edge = {
        from: { node: parts[1], pin: outputField ? `out.${outputField}` : 'out' },
        to: { node: String(node?.id), pin: item.pin },
      };
      attachWaypoints(edge);
      edges.push(edge);
      deleteAtPath(payload, item.path);
    }
    // 变量/输入引用同样折成边：来源是变量节点（没有卡片就补一张）。
    for (const [path, ref] of iterVariableRefs(payload)) {
      const pin = payloadPathToPin(node, path);
      if (pin === null) continue;
      const [scope, ...rest] = ref.split('.');
      if (!(VARIABLE_SCOPES as readonly string[]).includes(scope) || rest.length === 0) continue;
      const [name, ...nested] = rest;
      const source = variableNodeFor(scope, name);
      const edge = {
        from: { node: source.id, pin: nested.length ? `out.${nested.join('.')}` : 'out' },
        to: { node: String(node?.id), pin },
      };
      attachWaypoints(edge);
      edges.push(edge);
      deleteAtPath(payload, path);
    }
  });
  for (const node of nodes) {
    const children: any[] = Array.isArray(node?.children) ? node.children : [];
    if (node?.type === 'condition') {
      const declared: any[] = Array.isArray(node?.ports) ? node.ports : [];
      const used = new Set<string>();
      children.forEach((child, position) => {
        let port = typeof declared[position] === 'string' ? declared[position] : '';
        if ((port !== 'true' && port !== 'false') || used.has(port)) port = used.has('true') ? 'false' : 'true';
        used.add(port);
        link(node?.id, port, child);
      });
    } else if (node?.type === 'switch') {
      const cases: any[] = Array.isArray(node?.cases) ? node.cases : [];
      cases.forEach((entry, index) => {
        if (isRecord(entry) && typeof entry.child === 'string') link(node?.id, `case.${index}`, entry.child);
      });
      if (typeof node?.default_child === 'string') link(node?.id, 'default', node.default_child);
    } else {
      children.forEach((child, position) => link(node?.id, `then.${position}`, child));
    }
  }

  // 节点组：`_nodeGroups` + 组卡/接口卡/变量卡的位置 → 文档顶层的 `groups`。
  const groups: any[] = [];
  const nodeGroups = isRecord(document._nodeGroups) ? document._nodeGroups : {};
  for (const [groupId, value] of Object.entries(nodeGroups)) {
    if (!isRecord(value)) continue;
    const members = (Array.isArray(value.nodeIds) ? value.nodeIds : []).filter((id: unknown) => typeof id === 'string');
    if (!members.length) continue;
    // 键序与 Python 一致（id / name / nodeIds / pins / pinPolicy / 位置），减少无谓 diff。
    const entry: Record<string, any> = { id: groupId };
    if (typeof value.name === 'string' && value.name) entry.name = value.name;
    entry.nodeIds = members;
    if (Array.isArray(value.pins)) entry.pins = cloneValue(value.pins);
    if (typeof value.pinPolicy === 'string') entry.pinPolicy = value.pinPolicy;
    for (const [key, layoutKey] of [
      ['at', groupId],
      ['interfaceAt', `${GROUP_INTERFACE_PREFIX}${groupId}`],
      ['variablesAt', `${GROUP_VARIABLES_PREFIX}${groupId}`],
    ] as const) {
      if (isPosition(layout[layoutKey])) {
        entry[key] = { x: Math.trunc(layout[layoutKey].x), y: Math.trunc(layout[layoutKey].y) };
      }
    }
    groups.push(entry);
  }

  const result: Record<string, any> = { schema_version: GRAPH_SCHEMA_VERSION };
  for (const [key, value] of Object.entries(document)) {
    if (key === 'schema_version' || key === 'nodes' || key === 'edges') continue;
    if (key === '_layout' || key === '_layoutLocks') continue;
    // 变量卡与变量连线变成变量节点 + 数据边，不再以旁表落盘。
    if (key === '_variableCards' || key === '_variableLinks') continue;
    // 节点组搬进顶层的 `groups`。
    if (key === '_nodeGroups') continue;
    // 折点挂回各自的边，不再以旁表落盘。
    if (key === EDGE_WAYPOINTS_KEY) continue;
    result[key] = value;
  }
  result.nodes = [...converted, ...variableNodes.values()];
  result.edges = edges;
  if (groups.length) result.groups = groups;
  return result;
}
