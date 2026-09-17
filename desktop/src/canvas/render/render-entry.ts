/**
 * 画布渲染入口：重绘节点/连线/实例运行卡片/变量卡片/小地图与详情，并同步侧栏状态。
 * 原 `workflow-editor.js` 的 render 与 focusNode。
 *
 * 渲染只读取文档与状态；通过注入的渲染片段组合出完整画面。
 */
import type { CanvasState } from '../state/canvas-state';

export interface RenderEntryDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  $(id: string): HTMLElement;
  graph: Element;
  wrap: HTMLElement;
  svgEl(...args: any[]): any;
  UI: any;
  nodes(): any[];
  nodeById(id: string): any;
  position(node: any): { x: number; y: number };
  nodeHeight(node: any): number;
  instanceRunCards(): any[];
  variableCardList(): any[];
  renderNode(...args: any[]): any;
  renderInstanceRunCard(...args: any[]): any;
  renderVariableCard(...args: any[]): any;
  renderEdge(...args: any[]): any;
  renderInstanceRunEdge(...args: any[]): any;
  renderConnection(...args: any[]): any;
  renderVariableConnection(...args: any[]): any;
  renderVariableEdges(...args: any[]): any;
  renderMinimap(...args: any[]): any;
  renderInspector(): void;
  postSidebarState(): void;
  updateIssueBadge(): void;
  ensureLayout(): void;
  syncLegacyInputParameters(): boolean;
  syncLegacyVariableCards(): boolean;
  setDirty(value?: boolean): void;
  /** 重绘收尾：让贴在卡片行上的浮层（行内参数编辑器）跟随 pan/zoom 重新贴合。 */
  afterRender?(): void;
  nodeWidth: number;
}

export function createRenderEntry(deps: RenderEntryDeps) {
  const {
    state, $, graph, wrap, svgEl, UI, nodes, nodeById, position, nodeHeight, instanceRunCards, variableCardList,
    renderNode, renderInstanceRunCard, renderVariableCard, renderEdge, renderInstanceRunEdge, renderConnection,
    renderVariableConnection, renderVariableEdges, renderMinimap, renderInspector, postSidebarState, updateIssueBadge,
    ensureLayout, syncLegacyInputParameters, syncLegacyVariableCards, setDirty, nodeWidth: NODE_W,
  } = deps;
  const afterRender = deps.afterRender;
  function render(): void {
    if (!state.raw) return;
    UI.closeDropdowns?.();
    ensureLayout();
    const migratedPublic = syncLegacyInputParameters();
    const migratedCards = syncLegacyVariableCards();
    if (migratedPublic || migratedCards) setDirty(true);
    graph.innerHTML = '';
    const root = svgEl('g', { class: 'graph-world', transform: `translate(${state.panX},${state.panY}) scale(${state.zoom})` }, graph);
    const wires = svgEl('g', { class: 'wires' }, root);
    for (const parent of nodes()) {
      const children = Array.isArray(parent.children) ? parent.children : [];
      children.forEach((childId: any, order: number) => renderEdge(wires, parent, childId, order));
    }
    const runCards = instanceRunCards();
    runCards.forEach((card) => renderInstanceRunEdge(wires, card));
    if (state.connect) renderConnection(wires);
    const variableEdges = svgEl('g', { class: 'variable-edges' }, root);
    renderVariableEdges(variableEdges);
    const cards = svgEl('g', { class: 'cards' }, root);
    nodes().forEach((node) => renderNode(cards, node));
    runCards.forEach((card) => renderInstanceRunCard(cards, card));
    const variableLayer = svgEl('g', { class: 'variable-cards' }, root);
    variableCardList().forEach((card) => renderVariableCard(variableLayer, card));
    if (state.variableConnect) renderVariableConnection(variableLayer);
    if (state.marquee) {
      const box = state.marquee;
      svgEl('rect', { class: 'marquee', x: Math.min(box.x1, box.x2), y: Math.min(box.y1, box.y2), width: Math.abs(box.x2 - box.x1), height: Math.abs(box.y2 - box.y1) }, root);
    }
    $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
    updateIssueBadge();
    renderMinimap();
    renderInspector();
    postSidebarState();
    afterRender?.();
  }

  /** 把画布视野中心移到指定节点（搜索定位与结构树窗口共用）。 */
  function focusNode(id: string): void {
    const node = nodeById(id);
    if (!node) return;
    const pos = position(node);
    const rect = wrap.getBoundingClientRect();
    state.panX = rect.width / 2 - (pos.x + NODE_W / 2) * state.zoom;
    state.panY = rect.height / 2 - (pos.y + nodeHeight(node) / 2) * state.zoom;
    render();
  }

  return { render, focusNode };
}