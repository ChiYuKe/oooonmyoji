/**
 * 「收成自定义类型」：把一个已配置好的节点变成一个可复用的 `x-…` 类型。
 *
 * 这是 P5 的编辑器入口——在那之前 `nodeTypes` 只能手写 JSON。规则与编译器的解析对齐
 * （见 `docs/graph-document-v5.md`「自定义节点类型」）：
 *
 * - 类型名从节点名派生（没有名字就用动作名、再退化到 id），加 `x-` 前缀并去重；
 * - 定义里**只预设字面量**：带 `{"ref": …}` 的参数/表达式不进预设，否则所有实例都会
 *   指向同一个来源节点，那是隐藏的耦合；
 * - 节点自身载荷一个字段都不动，只打上 `_nodeType` 标记（写回图文档时还原成 `x-…`）。
 */

import { iterNodeRefs, iterVariableRefs } from '../../shared/workflow/graph-document';

export interface CollapseResult {
  name?: string;
  error?: string;
}

/** 各基类值得预设的载荷键（其余如结构、坐标、锁一律不预设）。 */
const PRESET_KEYS: Record<string, string[]> = {
  task: ['action', 'params'],
  condition: ['expression'],
  bool_judge: ['expression'],
  break: ['ref', 'fields'],
  repeat_until: ['condition'],
  switch: ['expression'],
  sequence: [],
  selector: [],
  parallel: [],
  simple_parallel: [],
  branch: ['conditions'],
  root: [],
  instance_parallel: ['runs', 'wait_for', 'cancel_on_failure'],
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = clone(child);
    return out as unknown as T;
  }
  return value;
}

/** 这段载荷里有没有引用（`nodes.` / `inputs.` / `variables.`）。 */
function hasBinding(value: unknown): boolean {
  return iterNodeRefs(value).length > 0 || iterVariableRefs(value).length > 0;
}

/** 类型名：`x-` + 节点名 / 动作名 / id，空白换成下划线，撞名就加序号。 */
export function customTypeNameFor(raw: any, node: any, existing?: Record<string, any>): string {
  const definitions = isRecord(existing) ? existing : (isRecord(raw?.nodeTypes) ? raw.nodeTypes : {});
  const source = String(node?.name || node?.action || node?.id || 'node').trim() || 'node';
  const base = `x-${source.replace(/\s+/g, '_')}`;
  let candidate = base;
  let index = 2;
  while (Object.prototype.hasOwnProperty.call(definitions, candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

/**
 * 把节点收成自定义类型。返回 `{name}` 或 `{error}`；写文档的部分调用方负责包在 `mutate` 里。
 */
export function collapseNodeIntoCustomType(raw: any, nodeId: string): CollapseResult {
  if (!isRecord(raw) || !Array.isArray(raw.nodes)) return { error: '当前文档没有节点' };
  const node = raw.nodes.find((item: any) => item?.id === nodeId);
  if (!node) return { error: '找不到这个节点' };
  if (typeof node._nodeType === 'string' && node._nodeType) return { error: '这个节点已经是自定义类型了' };
  if (typeof node.type !== 'string' || !node.type) return { error: '节点没有类型，收不了' };

  const name = customTypeNameFor(raw, node);
  const definition: Record<string, any> = { base: node.type };
  if (typeof node.name === 'string' && node.name.trim()) definition.title = node.name;

  const preset: Record<string, any> = {};
  for (const key of PRESET_KEYS[node.type] ?? []) {
    if (!(key in node)) continue;
    const value = node[key];
    if (key === 'params' && isRecord(value)) {
      // 参数逐个筛：引用型参数不进预设（会变成所有实例共享的来源耦合）。
      const literals: Record<string, any> = {};
      for (const [param, paramValue] of Object.entries(value)) {
        if (hasBinding(paramValue)) continue;
        literals[param] = clone(paramValue);
      }
      if (Object.keys(literals).length) preset.params = literals;
      continue;
    }
    if (key === 'fields' && isRecord(value)) {
      if (Object.keys(value).length) preset.fields = clone(value);
      continue;
    }
    if (hasBinding(value)) continue;
    preset[key] = clone(value);
  }
  Object.assign(definition, preset);

  if (!isRecord(raw.nodeTypes)) raw.nodeTypes = {};
  raw.nodeTypes[name] = definition;
  node._nodeType = name;
  return { name };
}
