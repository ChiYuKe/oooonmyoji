/** 节点组运行态的稳定数据契约：只由真实成员节点的运行事件推导，不写回工作流。 */
export interface NodeGroupRunSummary {
  status: string;
  total: number;
  completed: number;
  runningNodeId: string;
  runningNodeName: string;
  failedNodeIds: string[];
  failedNodeNames: string[];
}

export interface NodeGroupRunPresentation {
  status: string;
  statusLabel: string;
  progressLabel: string;
  detailLabel: string;
  title: string;
}

/** 卡片与代理线共用的状态优先级，避免两处视觉结果互相矛盾。 */
export const NODE_GROUP_RUN_STATUS_PRIORITY = [
  'running', 'failed', 'not_matched', 'matched', 'succeeded', 'branch_miss', 'cancelled',
] as const;

/** 从一组真实节点 id 中选择当前最应显示的运行态。 */
export function aggregateNodeRunStatus(
  nodeIds: string[],
  run: { get(id: string): any } | null | undefined,
): string {
  const statuses = new Set(nodeIds.map((id) => run?.get(id)?.status).filter((status) => typeof status === 'string'));
  return NODE_GROUP_RUN_STATUS_PRIORITY.find((status) => statuses.has(status)) || '';
}

/**
 * 汇总一组真实节点的即时运行状态。
 * 未收到事件的成员不算完成；失败摘要同时包含 failed 与 not_matched，便于折叠态定位问题。
 */
export function summarizeNodeGroupRun(
  nodeIds: string[],
  run: { get(id: string): any } | null | undefined,
  nodeById: (id: string) => any,
): NodeGroupRunSummary {
  const states = nodeIds.map((id) => ({ id, node: nodeById(id), value: run?.get(id) || null }));
  const observed = states.filter((item) => Boolean(item.value?.status));
  const status = aggregateNodeRunStatus(nodeIds, run);
  const running = observed.find((item) => item.value.status === 'running');
  const failed = observed.filter((item) => item.value.status === 'failed' || item.value.status === 'not_matched');
  const nameOf = (item: { id: string; node: any }): string => String(item.node?.name || item.id);
  return {
    status,
    total: nodeIds.length,
    completed: observed.filter((item) => item.value.status !== 'running').length,
    runningNodeId: running?.id || '',
    runningNodeName: running ? nameOf(running) : '',
    failedNodeIds: failed.map((item) => item.id),
    failedNodeNames: failed.map(nameOf),
  };
}

/** 组卡初次渲染与运行事件局部补丁共用同一套文案，避免两条路径逐渐不一致。 */
export function presentNodeGroupRun(
  summary: NodeGroupRunSummary | null | undefined,
  runLabels: Record<string, string>,
): NodeGroupRunPresentation {
  if (!summary || !summary.status) {
    const total = Number(summary?.total || 0);
    return {
      status: '', statusLabel: '', progressLabel: `${total} 个节点`, detailLabel: '双击进入组内编辑',
      title: `${total} 个节点`,
    };
  }
  const statusLabel = runLabels[summary.status] || summary.status;
  const progressLabel = `${summary.total} 个节点 · 已完成 ${summary.completed}/${summary.total}`;
  let detailLabel = '双击进入组内编辑';
  if (summary.status === 'running' && summary.runningNodeName) detailLabel = `正在执行：${summary.runningNodeName}`;
  else if (summary.failedNodeNames.length === 1) detailLabel = `异常节点：${summary.failedNodeNames[0]}`;
  else if (summary.failedNodeNames.length > 1) detailLabel = `异常 ${summary.failedNodeNames.length} 项：${summary.failedNodeNames.slice(0, 2).join('、')}`;
  else if (summary.completed >= summary.total && (summary.status === 'branch_miss' || summary.status === 'cancelled')) detailLabel = '组内路径已跳过';
  else if (summary.completed >= summary.total) detailLabel = '组内节点已完成';
  const details = summary.failedNodeNames.length ? `\n异常节点：${summary.failedNodeNames.join('、')}` : '';
  return { status: summary.status, statusLabel, progressLabel, detailLabel, title: `${statusLabel}\n${progressLabel}${details}` };
}
