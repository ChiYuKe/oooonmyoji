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
