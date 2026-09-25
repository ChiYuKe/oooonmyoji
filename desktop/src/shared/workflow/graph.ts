/**
 * 工作流图关系分析：沿父子连边推导某节点执行前可用 / 可能可用的输出节点。
 * 这是两端共同规则的一部分，Python 端在 validate_workflow 中做同样的判断。
 */
import { isObject } from './guards';
import { schemaAtPath } from './schema-path';
import { BOOL_JUDGE_OUTPUT_SCHEMA, type ActionCatalogLike, type NodeInfo, type WorkflowInfo } from './types';

/** 拆分卡片的来源绑定形状（`{ ref: string }`）。 */
function breakRefString(node: NodeInfo): string {
  if (!isObject(node.ref) || typeof node.ref.ref !== 'string') return '';
  return node.ref.ref;
}

/**
 * 拆分卡片（`break`）的输出 schema：
 * - 未声明 fields：镜像 ref 指向的输出 schema，字段同名可引用；
 * - 声明了 fields（输出名 → 源内路径）：每个输出名按路径取子 schema，打包成 object。
 * 拆分节点可以指向另一个拆分节点，用 visiting 集合挡住环。
 */
function breakNodeOutputSchema(
  node: NodeInfo,
  catalog: ActionCatalogLike | undefined,
  lookup: ((id: string) => NodeInfo | undefined) | undefined,
  visiting: Set<string>,
  resolveRef?: (ref: string) => Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const ref = breakRefString(node);
  const parts = ref.split('.');
  let base: Record<string, unknown> | undefined;
  if (parts.length >= 3 && parts[0] === 'nodes' && parts[2] === 'output' && parts.slice(1).every(Boolean) && lookup) {
    const sourceId = parts[1];
    if (visiting.has(sourceId)) return undefined;
    visiting.add(sourceId);
    const source = lookup(sourceId);
    base = source
      ? source.type === 'break'
        ? breakNodeOutputSchema(source, catalog, lookup, visiting, resolveRef)
        : nodeOutputSchema(source, catalog, lookup, resolveRef)
      : undefined;
    if (!base) return undefined;
    base = parts.length > 3 ? schemaAtPath(base, parts.slice(3)) : base;
  } else {
    // inputs / variables / runtime 等来源：schema 不在节点输出表里，交给调用方给的
    // 引用解析器（画布按文档的 inputs/variables 定义编译；校验器按已编译的引用表）。
    base = (resolveRef ? resolveRef(ref) : undefined) ?? {};
  }
  const fields = node.fields;
  if (!isObject(fields) || Object.keys(fields).length === 0) return base;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, pathValue] of Object.entries(fields)) {
    if (!name || typeof pathValue !== 'string' || !pathValue) continue;
    properties[name] = schemaAtPath(base, pathValue.split('.')) ?? {};
    required.push(name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/**
 * 节点输出的 schema：Task 取 Action 的输出 schema；布尔判断卡片没有 Action，
 * 输出固定是 `{ value: boolean }`（卡片执行成功就会登记）；拆分卡片按 ref + fields 推导。
 *
 * `resolveRef` 供拆分卡片解析 `inputs.` / `variables.` 这类非节点来源（节点来源用 `lookup`）。
 */
export function nodeOutputSchema(
  node: NodeInfo | undefined | null,
  catalog?: ActionCatalogLike,
  lookup?: (id: string) => NodeInfo | undefined,
  resolveRef?: (ref: string) => Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!node) return undefined;
  if (node.type === 'bool_judge') return BOOL_JUDGE_OUTPUT_SCHEMA;
  if (node.type === 'break') return breakNodeOutputSchema(node, catalog, lookup, new Set([node.id]), resolveRef);
  const spec = node.action && catalog ? catalog.byName(node.action) : undefined;
  return spec ? spec.outputSchema : undefined;
}

function guaranteedOutputNodeIds(
  nodeId: string,
  nodeMap: Map<string, NodeInfo>,
  visiting = new Set<string>(),
): Set<string> {
  if (visiting.has(nodeId)) return new Set();
  const node = nodeMap.get(nodeId);
  if (!node) return new Set();
  if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
  // 布尔判断卡片是值卡片：执行成功就一定产出 `nodes.<id>.output.value`。
  if (node.type === 'bool_judge') return new Set([node.id]);
  // 拆分卡片同为值卡片：总是成功并登记拆分结果。
  if (node.type === 'break') return new Set([node.id]);
  const nested = new Set(visiting);
  nested.add(nodeId);
  if (node.type === 'root' && node.children.length === 1) {
    return guaranteedOutputNodeIds(node.children[0], nodeMap, nested);
  }
  if (node.type === 'sequence') {
    const result = new Set<string>();
    for (const child of node.children) {
      for (const id of guaranteedOutputNodeIds(child, nodeMap, nested)) result.add(id);
    }
    return result;
  }
  if (node.type === 'selector' && node.children.length === 1) {
    return guaranteedOutputNodeIds(node.children[0], nodeMap, nested);
  }
  if (node.type === 'simple_parallel' && node.children.length === 2) {
    // Parallel success is determined by the main (first) task. The background
    // branch can still be running, fail, or be cancelled, so it contributes no
    // guaranteed outputs.
    return guaranteedOutputNodeIds(node.children[0], nodeMap, nested);
  }
  return new Set();
}

function parentIndex(info: WorkflowInfo): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const node of info.nodes) {
    for (const child of node.children) {
      const entries = parents.get(child) ?? [];
      entries.push(node.id);
      parents.set(child, entries);
    }
  }
  return parents;
}

/** Outputs guaranteed to exist immediately before targetNodeId starts. */
export function availableOutputNodeIds(info: WorkflowInfo, targetNodeId: string): Set<string> {
  const nodeMap = new Map(info.nodes.filter((node) => node.id).map((node) => [node.id, node]));
  const parents = parentIndex(info);
  const result = new Set<string>();
  const visited = new Set<string>();
  let current = targetNodeId;
  while (!visited.has(current)) {
    visited.add(current);
    const parentIds = parents.get(current) ?? [];
    if (parentIds.length !== 1) break;
    const parent = nodeMap.get(parentIds[0]);
    if (!parent) break;
    if (parent.type === 'sequence') {
      const currentIndex = parent.children.indexOf(current);
      for (const sibling of parent.children.slice(0, Math.max(0, currentIndex))) {
        for (const id of guaranteedOutputNodeIds(sibling, nodeMap)) result.add(id);
      }
    }
    current = parent.id;
  }
  return result;
}

function possibleOutputNodeIdsInSubtree(
  nodeId: string,
  nodeMap: Map<string, NodeInfo>,
  visiting = new Set<string>(),
): Set<string> {
  if (visiting.has(nodeId)) return new Set();
  const node = nodeMap.get(nodeId);
  if (!node) return new Set();
  if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
  if (node.type === 'bool_judge') return new Set([node.id]);
  if (node.type === 'break') return new Set([node.id]);
  const nested = new Set(visiting);
  nested.add(nodeId);
  const result = new Set<string>();
  for (const child of node.children) {
    for (const id of possibleOutputNodeIdsInSubtree(child, nodeMap, nested)) result.add(id);
  }
  return result;
}

/** Outputs that may have been produced before targetNodeId, for safe exists checks. */
export function possiblyAvailableOutputNodeIds(info: WorkflowInfo, targetNodeId: string): Set<string> {
  const nodeMap = new Map(info.nodes.filter((node) => node.id).map((node) => [node.id, node]));
  const parents = parentIndex(info);
  const result = availableOutputNodeIds(info, targetNodeId);
  const visited = new Set<string>();
  let current = targetNodeId;
  while (!visited.has(current)) {
    visited.add(current);
    const parentIds = parents.get(current) ?? [];
    if (parentIds.length !== 1) break;
    const parent = nodeMap.get(parentIds[0]);
    if (!parent) break;
    if (parent.type === 'sequence' || parent.type === 'selector') {
      const currentIndex = parent.children.indexOf(current);
      for (const sibling of parent.children.slice(0, Math.max(0, currentIndex))) {
        for (const id of possibleOutputNodeIdsInSubtree(sibling, nodeMap)) result.add(id);
      }
    }
    current = parent.id;
  }
  return result;
}
