/**
 * 问题定位与折叠组汇总：把校验问题（错误 + 提醒）变成「能跳过去的目标」。
 *
 * 纯计算，不碰 DOM 也不改文档；`editor.ts` 只负责缓存与把目标落到选区/视野上。
 * 路径约定与 `shared/workflow/validate.ts` 一致：
 * `['nodes', <节点 id>, 'params', <参数名>, ...]`、`['nodes', <id>, 'children', <下标>]`。
 */
import type { ValidationIssue } from '../../shared/workflow/types';

export interface IssueTarget {
  /** 出问题的节点（解析不出时为空的字符串）。 */
  nodeId: string;
  /** 具体参数端点（有的话定位时连那一行一起闪）。 */
  param: string;
  /** children 路径还原出的连线两端（结构问题可选中的那条边）。 */
  edgeParent: string;
  edgeChild: string;
  message: string;
  severity: 'error' | 'warning';
}

function nodeOrder(raw: any): string[] {
  return Array.isArray(raw?.nodes) ? raw.nodes.map((node: any) => String(node?.id ?? '')) : [];
}

/**
 * 问题清单排序键：先按节点在文档里的顺序（和工作流树一致），
 * 同一节点先错误后提醒；解析不到节点的（工作流级问题）排在最后。
 */
function rankOf(order: string[], nodeId: string): number {
  const index = order.indexOf(nodeId);
  return index < 0 ? order.length + 1 : index;
}

/** 把问题清单摊平成可导航的目标列表（稳定排序，位置相同的保持原顺序）。 */
export function issueTargets(raw: any, issues: unknown): IssueTarget[] {
  const list = Array.isArray(issues) ? issues : [];
  const order = nodeOrder(raw);
  const targets = list.map((item) => {
    const issue = item as ValidationIssue;
    const issuePath = Array.isArray(issue?.path) ? issue.path : [];
    // 节点路径：优先用 id；校验碰到缺 id 的节点会用下标，这里按同一下标还原。
    let nodeId = '';
    if (issuePath[0] === 'nodes') {
      if (typeof issuePath[1] === 'string') nodeId = issuePath[1];
      else if (typeof issuePath[1] === 'number') nodeId = String(raw?.nodes?.[issuePath[1]]?.id ?? '');
    } else if (issuePath[0] === 'root' || issuePath[0] === 'inputs' || issuePath[0] === 'variables') {
      nodeId = '';
    }
    const param = issuePath[0] === 'nodes' && issuePath[2] === 'params' && typeof issuePath[3] === 'string' ? issuePath[3] : '';
    let edgeParent = '';
    let edgeChild = '';
    if (issuePath[0] === 'nodes' && issuePath[2] === 'children' && typeof issuePath[3] === 'number') {
      const parent = Array.isArray(raw?.nodes)
        ? raw.nodes.find((node: any) => String(node?.id) === String(issuePath[1]))
        : undefined;
      const child = parent && Array.isArray(parent.children) ? parent.children[issuePath[3]] : undefined;
      if (typeof child === 'string') {
        edgeParent = String(issuePath[1]);
        edgeChild = child;
      }
    }
    return {
      nodeId,
      param,
      edgeParent,
      edgeChild,
      message: String(issue?.message || ''),
      severity: (issue?.severity === 'warning' || issue?.severity === 'info' ? 'warning' : 'error') as 'error' | 'warning',
    };
  });
  return targets
    .map((target, index) => ({ target, index }))
    .sort((a, b) => {
      const byNode = rankOf(order, a.target.nodeId) - rankOf(order, b.target.nodeId);
      if (byNode) return byNode;
      const bySeverity = (a.target.severity === 'error' ? 0 : 1) - (b.target.severity === 'error' ? 0 : 1);
      if (bySeverity) return bySeverity;
      return a.index - b.index;
    })
    .map((entry) => entry.target)
    .filter((target) => Boolean(target.nodeId || target.edgeParent || target.message));
}

export interface GroupIssueSummary {
  errors: number;
  warnings: number;
  /** 组内第一个出问题的节点（优先错误）；点组卡徽标进组后定位它。 */
  first: string;
}

/**
 * 折叠组内部的问题汇总：只统计组员自己的问题（组是扁平模型，成员互不重叠）。
 * `first` 按组员在文档里的先后挑，且优先错误——进组后一眼看到的就是最该修的那个。
 */
export function groupIssueSummary(
  raw: any,
  groupId: string,
  memberIds: string[],
  byNode: Map<string, { node?: unknown[]; params?: Map<string, unknown> }>,
  warnings: Map<string, unknown[]>,
): GroupIssueSummary {
  const members = new Set((memberIds || []).map(String));
  if (!members.size) return { errors: 0, warnings: 0, first: '' };
  const order = nodeOrder(raw);
  let errors = 0;
  let warningCount = 0;
  let firstError = '';
  let firstWarning = '';
  for (const [id, info] of byNode) {
    if (!members.has(String(id))) continue;
    const count = (info?.node?.length || 0) + (info?.params?.size || 0);
    if (!count) continue;
    errors += count;
    if (!firstError) firstError = String(id);
  }
  for (const [id, list] of warnings) {
    if (!members.has(String(id))) continue;
    if (!list || !list.length) continue;
    warningCount += list.length;
    if (!firstWarning) firstWarning = String(id);
  }
  const pick = (a: string, b: string): string => {
    if (!a) return b;
    if (!b) return a;
    return rankOf(order, a) <= rankOf(order, b) ? a : b;
  };
  return { errors, warnings: warningCount, first: pick(firstError, firstWarning) };
}
