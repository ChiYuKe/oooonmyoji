/**
 * 画布状态助手：问题徽标、变量卡片聚焦与端口右键菜单唤起。
 * 原 `workflow-editor.js` 的 updateIssueBadge 至 focusVariableCard 区间。
 */
import type { CanvasState } from '../state/canvas-state';
import { createWrapMeasurement } from '../canvas/wrap-measurement';

export interface CanvasHelpersDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  $(id: string): HTMLElement;
  nodes(): any[];
  worldPoint(event: any): { x: number; y: number };
  render(): void;
  contextMenuSuppressedByPan(): boolean;
  setVariableCardSelection(ids: any): void;
  wrap: HTMLElement;
  /** 视口尺寸测量（缓存读）；缺省按 `wrap` 自行创建。 */
  measurement?: { read(): { width: number; height: number; left: number; top: number } };
  variableCardWidth: number;
  variableCardHeight: number;
  /** 本地校验出的错误数（画布自己跑的工作流校验，比宿主的快照新）。 */
  localErrorCount?(): number;
  /** 本地校验出的提醒数（warning）：不阻止保存，只在徽标里提示。 */
  localWarningCount?(): number;
}

export function createCanvasHelpers(deps: CanvasHelpersDeps) {
  const {
    state, $, nodes, worldPoint, render, contextMenuSuppressedByPan, setVariableCardSelection, wrap,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  } = deps;
  const measurement = deps.measurement ?? createWrapMeasurement(wrap as any);
  function updateIssueBadge(): void {
    const local = localIssueCount();
    // 宿主快照与本画布各自算过一遍：错误取最大值（谁更新谁更全），提醒只由本画布提供。
    const fromHost = Array.isArray(state.issues) ? state.issues.filter((item) => item.severity === 'error').length : 0;
    const fromCanvas = deps.localErrorCount ? deps.localErrorCount() : 0;
    const errors = Math.max(local, fromHost, fromCanvas);
    const warnings = deps.localWarningCount ? deps.localWarningCount() : 0;
    const badge = $('issue-badge');
    if (errors) badge.textContent = warnings ? `${errors} 个错误 · ${warnings} 个提醒` : `${errors} 个错误`;
    else if (warnings) badge.textContent = `${warnings} 个提醒`;
    else badge.textContent = '结构有效';
    badge.classList.toggle('error', errors > 0);
    badge.classList.toggle('warning', errors === 0 && warnings > 0);
    badge.title = errors
      ? `有 ${errors} 个会让运行时拒绝的错误${warnings ? `，另有 ${warnings} 个提醒` : ''}；点「更多 → 下一个问题」逐个查看`
      : warnings
        ? `${warnings} 个提醒：不影响保存与运行`
        : '结构与引用都通过校验';
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
    const rect = measurement.read();
    state.panX = rect.width / 2 - (card.x + VARIABLE_CARD_W / 2) * state.zoom;
    state.panY = rect.height / 2 - (card.y + VARIABLE_CARD_H / 2) * state.zoom;
    render();
  }

  return { updateIssueBadge, localIssueCount, openPortContextMenu, focusVariableCard };
}