/**
 * 工作流图关系分析：沿父子连边推导某节点执行前可用 / 可能可用的输出节点。
 * 这是两端共同规则的一部分，Python 端在 validate_workflow 中做同样的判断。
 */
import type { NodeInfo, WorkflowInfo } from './types';

function guaranteedOutputNodeIds(
  nodeId: string,
  nodeMap: Map<string, NodeInfo>,
  visiting = new Set<string>(),
): Set<string> {
  if (visiting.has(nodeId)) return new Set();
  const node = nodeMap.get(nodeId);
  if (!node) return new Set();
  if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
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
