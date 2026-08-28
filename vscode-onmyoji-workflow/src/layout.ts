/** Deterministic top-down layout for ordered Behavior Trees. */
import { NodeType, WorkflowInfo } from './workflow';

export interface GraphNode {
  id: string;
  kind: NodeType;
  label: string;
  action?: string;
  isRoot?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  order: number;
  label: string;
}

export interface Point { x: number; y: number }
export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Record<string, Point>;
  width: number;
  height: number;
}

export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 96;
export const COLUMN_GAP = 64;
export const ROW_GAP = 112;
export const MARGIN = 48;

export function computeLayout(info: WorkflowInfo): GraphLayout {
  const nodes: GraphNode[] = info.nodes.map((node, index) => ({
    id: node.id || `__missing_${index}__`,
    kind: node.type,
    label: node.name || node.id || '(未命名节点)',
    action: node.action,
    isRoot: node.id === info.root,
  }));
  const nodeMap = new Map(info.nodes.map((node) => [node.id, node]));
  const positions: Record<string, Point> = {};
  const edges: GraphEdge[] = [];
  let leaf = 0;
  let maxDepth = 0;

  const place = (id: string, depth: number): number => {
    const node = nodeMap.get(id);
    maxDepth = Math.max(maxDepth, depth);
    if (!node || node.children.length === 0) {
      const x = MARGIN + leaf * (NODE_WIDTH + COLUMN_GAP);
      leaf += 1;
      positions[id] = { x, y: MARGIN + depth * (NODE_HEIGHT + ROW_GAP) };
      return x;
    }
    const childXs = node.children.map((child, index) => {
      edges.push({ from: id, to: child, order: index, label: String(index + 1) });
      return place(child, depth + 1);
    });
    const x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    positions[id] = { x, y: MARGIN + depth * (NODE_HEIGHT + ROW_GAP) };
    return x;
  };

  if (info.root && nodeMap.has(info.root)) place(info.root, 0);
  for (const node of info.nodes) {
    if (!positions[node.id]) {
      positions[node.id] = { x: MARGIN + leaf * (NODE_WIDTH + COLUMN_GAP), y: MARGIN };
      leaf += 1;
    }
  }
  return {
    nodes,
    edges,
    positions,
    width: Math.max(MARGIN * 2 + NODE_WIDTH, MARGIN * 2 + Math.max(1, leaf) * NODE_WIDTH + Math.max(0, leaf - 1) * COLUMN_GAP),
    height: MARGIN * 2 + NODE_HEIGHT + maxDepth * (NODE_HEIGHT + ROW_GAP),
  };
}
