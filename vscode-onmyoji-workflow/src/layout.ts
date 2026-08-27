/**
 * 可视化编辑器的分层图布局。纯逻辑模块。
 * 布局规则：步骤按数组顺序自上而下排列；终点（$success/$failure/$cancelled）放在底部同一行。
 */
import { TERMINALS, WorkflowInfo } from './workflow';

export type NodeKind = 'step' | 'terminal';
export type EdgeKind = 'on_success' | 'on_failure' | 'on_skip' | 'fallthrough';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  action?: string;
  isEntry?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  explicit: boolean;
  label: string;
  /** 默认失败终点保留在布局数据中，但由画布选择不显示长连线。 */
  visible?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Record<string, Point>;
  width: number;
  height: number;
}

export const NODE_WIDTH = 280;
export const NODE_HEIGHT = 64;
export const ROW_GAP = 96;
export const MARGIN = 40;

export function computeLayout(info: WorkflowInfo): GraphLayout {
  const nodes: GraphNode[] = info.steps.map((step, index) => ({
    id: step.id || `__missing_${index}__`,
    kind: 'step' as NodeKind,
    label: step.id || '(未命名步骤)',
    action: step.action || undefined,
    isEntry: step.id !== '' && step.id === info.entry,
  }));
  for (const terminal of TERMINALS) {
    nodes.push({ id: terminal, kind: 'terminal', label: terminal });
  }

  const idToIndex = new Map<string, number>();
  nodes.forEach((node, index) => idToIndex.set(node.id, index));

  const edges: GraphEdge[] = [];
  info.steps.forEach((step, index) => {
    if (!step.id) return;
    const next = index + 1 < info.steps.length ? info.steps[index + 1].id : '$success';
    const pushEdge = (kind: EdgeKind, target: string, explicit: boolean, label: string, visible = true) => {
      if (!idToIndex.has(target) || target === step.id) return;
      edges.push({ from: step.id, to: target, kind, explicit, label, visible });
    };
    if (step.onSuccess) {
      pushEdge('on_success', step.onSuccess, true, '成功');
    } else if (next !== step.id) {
      pushEdge('on_success', next, false, '成功(默认)');
    }
    if (step.onFailure) {
      pushEdge('on_failure', step.onFailure, true, '失败');
    } else {
      pushEdge('on_failure', '$failure', false, '失败(默认)', false);
    }
    if (step.onSkip) {
      pushEdge('on_skip', step.onSkip, true, '跳过');
    } else if (step.hasWhen && next !== step.id) {
      pushEdge('on_skip', next, false, '跳过(默认)', false);
    }
  });

  // 坐标
  const positions: Record<string, Point> = {};
  const stepRows = info.steps.length;
  info.steps.forEach((step, index) => {
    positions[step.id || `__missing_${index}__`] = {
      x: MARGIN,
      y: MARGIN + index * (NODE_HEIGHT + ROW_GAP),
    };
  });
  const terminalRowY = MARGIN + stepRows * (NODE_HEIGHT + ROW_GAP);
  const terminalGap = NODE_WIDTH + 120;
  TERMINALS.forEach((terminal, index) => {
    positions[terminal] = {
      x: MARGIN + index * terminalGap,
      y: terminalRowY,
    };
  });

  const width = Math.max(MARGIN * 2 + NODE_WIDTH, MARGIN + (TERMINALS.length - 1) * terminalGap + NODE_WIDTH + MARGIN);
  const height = terminalRowY + NODE_HEIGHT + MARGIN;
  return { nodes, edges, positions, width, height };
}
