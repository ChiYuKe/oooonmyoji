/**
 * 卡片错误标记：把校验问题（`ValidationIssue`）落到具体节点与参数上。
 *
 * 纯计算：只读问题列表与文档，不碰 DOM。路径约定与 `shared/workflow/validate.ts` 一致——
 * `['nodes', <节点 id>, 'params', <参数名>, ...]`；没有参数名时算整节点的错误（例如缺 Action）。
 */
import type { ValidationIssue } from '../../shared/workflow/types';

export interface NodeIssueInfo {
  /** 整节点的错误（标题旁边点红点）。 */
  node: ValidationIssue[];
  /** 参数名 → 该参数上的错误（含嵌套路径，例如 `match.x` 归到 `match`）。 */
  params: Map<string, ValidationIssue[]>;
}

const EMPTY: NodeIssueInfo = { node: [], params: new Map() };

function nodeKeyOf(path: ValidationIssue['path']): string {
  if (!Array.isArray(path) || path[0] !== 'nodes' || path.length < 2) return '';
  const key = path[1];
  return typeof key === 'string' ? key : '';
}

function paramOf(path: ValidationIssue['path']): string {
  if (!Array.isArray(path) || path[0] !== 'nodes' || path[2] !== 'params') return '';
  const name = path[3];
  return typeof name === 'string' ? name : '';
}

/**
 * 按节点 id 汇总错误。`nodeKeyOf` 只认节点 id：解析不出 id 的问题（JSON 解析失败、
 * 工作流级问题）不落到任何卡片上。
 */
export function issuesByNode(issues: unknown): Map<string, NodeIssueInfo> {
  const result = new Map<string, NodeIssueInfo>();
  const list = Array.isArray(issues) ? issues : [];
  for (const item of list) {
    const issue = item as ValidationIssue;
    if (!issue || issue.severity !== 'error') continue;
    const nodeKey = nodeKeyOf(issue.path);
    if (!nodeKey) continue;
    let info = result.get(nodeKey);
    if (!info) {
      info = { node: [], params: new Map() };
      result.set(nodeKey, info);
    }
    const param = paramOf(issue.path);
    if (!param) {
      info.node.push(issue);
      continue;
    }
    const bucket = info.params.get(param);
    if (bucket) bucket.push(issue);
    else info.params.set(param, [issue]);
  }
  return result;
}

/** 某个节点的错误信息；没有错误返回空结构。 */
export function nodeIssues(byNode: Map<string, NodeIssueInfo>, nodeId: unknown): NodeIssueInfo {
  const key = typeof nodeId === 'string' ? nodeId : '';
  return (key && byNode.get(key)) || EMPTY;
}

/** 某个参数端点上的错误（把嵌套路径并到顶层参数名）。 */
export function paramIssues(info: NodeIssueInfo, param: unknown): ValidationIssue[] {
  const name = typeof param === 'string' ? param : '';
  if (!name) return [];
  return info.params.get(name) || [];
}

/** 悬停提示：把错误拼成人话，供卡片行与节点标题用。 */
export function issueTitle(issues: ValidationIssue[]): string {
  const list = Array.isArray(issues) ? issues : [];
  return list.map((issue) => String(issue && issue.message || '')).filter(Boolean).join('\n');
}

/**
 * 按严重度拆分：`error` 是运行时会拒绝的硬错误，`warning` 只是提醒。
 *
 * 保存策略与徽标计数都读这一份拆分，避免各处各写一遍 `severity === 'error'`。
 */
export function splitBySeverity(issues: unknown): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  for (const item of Array.isArray(issues) ? issues : []) {
    const issue = item as ValidationIssue;
    if (!issue) continue;
    if (issue.severity === 'warning' || issue.severity === 'info') warnings.push(issue);
    else errors.push(issue);
  }
  return { errors, warnings };
}

/** 每个节点上的提醒（warning）数量，供卡片画琥珀色小点；只统计能定位到节点的。 */
export function warningsByNode(issues: unknown): Map<string, ValidationIssue[]> {
  const result = new Map<string, ValidationIssue[]>();
  for (const item of Array.isArray(issues) ? issues : []) {
    const issue = item as ValidationIssue;
    if (!issue || issue.severity !== 'warning') continue;
    const nodeKey = nodeKeyOf(issue.path);
    if (!nodeKey) continue;
    const bucket = result.get(nodeKey);
    if (bucket) bucket.push(issue);
    else result.set(nodeKey, [issue]);
  }
  return result;
}

/**
 * 连线上的问题：既要标「这条边本身不合法」（children 路径指向的那条边），
 * 也要标「这条边牵涉的节点有问题」（父节点少了/多了子节点、成环、不可达…）。
 *
 * 返回 `${parentId}\u0000${childId}` → 问题列表；`edges.ts` 按这个键把连线涂红。
 * `raw` 用来把 `children.<index>` 还原成真实的子节点 id（children 里可能写着不存在的 id，
 * 这种「指向不存在的子节点」没有边可标，直接跳过——它已经落到父节点的卡片上了）。
 */
const NODE_STRUCTURE_CODES = new Set([
  'parent-count', 'cycle', 'unreachable-node', 'root-parent',
  'root-child-count', 'composite-child-count', 'parallel-child-count',
  'repeat-child-count', 'parallel-main-task',
]);

export function issuesByEdge(issues: unknown, raw: any): Map<string, ValidationIssue[]> {
  const result = new Map<string, ValidationIssue[]>();
  const list = Array.isArray(issues) ? issues : [];
  if (!list.length) return result;
  const nodeMap = new Map<string, any>();
  for (const node of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    if (node && typeof node === 'object' && typeof node.id === 'string') nodeMap.set(node.id, node);
  }
  const existing = new Set(nodeMap.keys());
  const add = (parentId: string, childId: string, issue: ValidationIssue): void => {
    if (!parentId || !childId) return;
    const key = `${parentId}\u0000${childId}`;
    const bucket = result.get(key);
    if (bucket) { if (!bucket.includes(issue)) bucket.push(issue); }
    else result.set(key, [issue]);
  };
  /** 节点级结构问题：把它相邻的每条边都标上（进边与出边都要，成环时首尾都看得见）。 */
  const markIncident = (nodeId: string, issue: ValidationIssue): void => {
    for (const [id, node] of nodeMap) {
      for (const child of Array.isArray(node.children) ? node.children : []) {
        if (!existing.has(String(child))) continue;
        if (String(id) === nodeId || String(child) === nodeId) add(String(id), String(child), issue);
      }
    }
  };
  for (const item of list) {
    const issue = item as ValidationIssue;
    if (!issue || !Array.isArray(issue.path)) continue;
    const path = issue.path;
    if (path[0] !== 'nodes' || typeof path[1] !== 'string') continue;
    const nodeId = path[1];
    if (path[2] === 'children' && typeof path[3] === 'number') {
      const parent = nodeMap.get(nodeId);
      const child = parent && Array.isArray(parent.children) ? parent.children[path[3]] : undefined;
      if (typeof child === 'string' && existing.has(child)) add(nodeId, child, issue);
      continue;
    }
    if (NODE_STRUCTURE_CODES.has(String(issue.code || ''))) markIncident(nodeId, issue);
  }
  return result;
}
