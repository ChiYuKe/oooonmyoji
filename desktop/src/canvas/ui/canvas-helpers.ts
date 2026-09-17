/**
 * 画布状态助手：问题徽标、变量卡片聚焦与端口右键菜单唤起。
 * 原 `workflow-editor.js` 的 updateIssueBadge 至 focusVariableCard 区间。
 */
import type { CanvasState } from '../state/canvas-state';

export interface CanvasHelpersDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  $(id: string): HTMLElement;
  nodes(): any[];
  worldPoint(event: any): { x: number; y: number };
  render(): void;
  contextMenuSuppressedByPan(): boolean;
  setVariableCardSelection(ids: any): void;
  wrap: HTMLElement;
  variableCardWidth: number;
  variableCardHeight: number;
}

export function createCanvasHelpers(deps: CanvasHelpersDeps) {
  const {
    state, $, nodes, worldPoint, render, contextMenuSuppressedByPan, setVariableCardSelection, wrap,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  } = deps;
  function updateIssueBadge(): void {
    const local = localIssueCount();
    const count = Math.max(local, Array.isArray(state.issues) ? state.issues.filter((item) => item.severity === 'error').length : 0);
    const badge = $('issue-badge');
    badge.textContent = count ? `${count} 个问题` : '结构有效';
    badge.classList.toggle('error', count > 0);
  }

  function localIssueCount(): number {
    if (!state.raw) return 1;
    let count = state.raw.schema_version === 4 ? 0 : 1;
    const map = new Map(nodes().map((node) => [node.id, node]));
    const root = map.get(state.raw.root);
    if (!root || root.type !== 'root') count += 1;
    const parents = new Map(nodes().map((node) => [node.id, 0]));
    for (const node of nodes()) for (const child of (Array.isArray(node.children) ? node.children : [])) parents.set(child, (parents.get(child) || 0) + 1);
    for (const node of nodes()) if (node.id !== state.raw.root && parents.get(node.id) !== 1) count += 1;
    return count;
  }

  /** 端口右键：阻止冒泡并吞掉右键平移后的误触，返回端口处的世界坐标；被抑制时返回 null。 */
  function openPortContextMenu(event: any): any {
    event.preventDefault();
    event.stopPropagation();
    if (contextMenuSuppressedByPan()) return null;
    return worldPoint(event);
  }

  /** 把画布视野移到指定变量卡片并选中它（端口右键菜单的“定位”操作）。 */
  function focusVariableCard(card: any): void {
    if (!card) return;
    state.selected.clear();
    state.selectedEdge = null;
    state.selectedRun = null;
    state.selectedVariable = card.name;
    state.selectedVariableScope = card.scope;
    setVariableCardSelection([card.id]);
    state.inspector = 'variables';
    const rect = wrap.getBoundingClientRect();
    state.panX = rect.width / 2 - (card.x + VARIABLE_CARD_W / 2) * state.zoom;
    state.panY = rect.height / 2 - (card.y + VARIABLE_CARD_H / 2) * state.zoom;
    render();
  }

  return { updateIssueBadge, localIssueCount, openPortContextMenu, focusVariableCard };
}