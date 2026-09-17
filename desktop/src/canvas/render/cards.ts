/**
 * 实例运行卡与变量卡片渲染：卡片外观、变量值/端口与卡片级交互绑定。
 * 原 `workflow-editor.js` 的 renderInstanceRunCard/renderVariableCard。
 *
 * 渲染函数不修改文档；双击检测由本模块统一持有，节点卡与运行卡共用同一计时。
 */
import type { CanvasState } from '../state/canvas-state';
import { parameterTypeLabel } from '../../shared/parameter-types';
import { compactValue, variableValueSummary, workflowInputVariableValue } from './card-values';
import { paramColorSwatch } from './param-rows';

export interface CardsNodeCards {
  text(parent: SVGElement, options: {
    className?: string;
    x: number | string;
    y: number | string;
    value: unknown;
    width: number;
    size?: number;
    anchor?: string;
  }): SVGTextElement;
}

export interface CardsInstanceRun {
  instance?: string;
  workflow?: string;
  inputs?: Record<string, unknown>;
}

export interface CardsRunCard {
  node: { id: string; [key: string]: unknown };
  index: number;
  key: string;
  x: number;
  y: number;
  height: number;
  run: CardsInstanceRun;
  variables: Array<{ name: string; definition: Record<string, any> }>;
}

export interface CardsVariableCard {
  id: string;
  name: string;
  scope: 'inputs' | 'variables';
  x: number;
  y: number;
}

export interface CardsDeps {
  state: CanvasState;
  svgEl(tag: string, attrs: Record<string, any>, parent: any): any;
  nodeCards: CardsNodeCards;
  displayNameOfDefinition(definition: unknown, fallback?: string): string;
  assetPreviewForPath(value: unknown): unknown;
  bindAssetPathPreview(target: unknown, getValue: () => unknown): void;
  disconnectVariableFromInstanceInput(nodeId: string, runIndex: number, param: string): void;
  startVariableConnectionFromInstanceInput(event: any, nodeId: string, runIndex: number, param: string): void;
  startVariableConnectionFromCard(event: any, scope: string, name: string, cardId: string): void;
  openPortContextMenu(event: any): { x: number; y: number } | null;
  showMenu(x: number, y: number, items: any[], options?: Record<string, unknown>): void;
  instanceRunPinMenuItems(card: CardsRunCard, variable: unknown, point: { x: number; y: number }): any[];
  variableCardPortMenuItems(card: CardsVariableCard, point: { x: number; y: number }): any[];
  requestInspector(selection: unknown): void;
  requestOpenWorkflowReference(reference: string): void;
  render(): void;
  contextMenuSuppressedByPan(): boolean;
  removeInstanceRun(node: any, index: number): void;
  removeVariableCard(id: string): void;
  setVariableCardSelection(ids: unknown): void;
  worldPoint(event: { clientX: number; clientY: number }): { x: number; y: number };
  snapshot(): string;
  runCardWidth: number;
  runCardBaseHeight: number;
  runVariableHeight: number;
  portRadius: number;
  variableCardWidth: number;
  variableCardHeight: number;
  variableCardPortY: number;
}

export interface CanvasCards {
  renderInstanceRunCard(layer: any, card: CardsRunCard): void;
  renderVariableCard(layer: any, card: CardsVariableCard): void;
  /** 记录一次卡片按下并返回是否构成双击（节点卡与实例卡共用计时）。 */
  registerCardPress(key: string, event: { clientX: number; clientY: number }): boolean;
}

export function createCanvasCards(deps: CardsDeps): CanvasCards {
  const {
    state, svgEl, nodeCards, displayNameOfDefinition, assetPreviewForPath, bindAssetPathPreview,
    disconnectVariableFromInstanceInput, startVariableConnectionFromInstanceInput, startVariableConnectionFromCard,
    openPortContextMenu, showMenu, instanceRunPinMenuItems, variableCardPortMenuItems, requestInspector,
    requestOpenWorkflowReference, render, contextMenuSuppressedByPan, removeInstanceRun, removeVariableCard,
    setVariableCardSelection, worldPoint, snapshot,
    runCardWidth, runCardBaseHeight, runVariableHeight, portRadius,
    variableCardWidth, variableCardHeight, variableCardPortY,
  } = deps;

  // 双击检测（原生 dblclick 会被 mousedown 后的 render() 重建 DOM 破坏，改用两次按下计时）
  let lastClickTime = 0;
  let lastClickNode = '';
  let lastClickX = -1;
  let lastClickY = -1;

  function registerCardPress(key: string, event: { clientX: number; clientY: number }): boolean {
    const now = Date.now();
    const nearby = Math.abs(event.clientX - lastClickX) < 8 && Math.abs(event.clientY - lastClickY) < 8;
    const isDouble = now - lastClickTime < 300 && lastClickNode === key && nearby;
    lastClickTime = now;
    lastClickNode = key;
    lastClickX = event.clientX;
    lastClickY = event.clientY;
    return isDouble;
  }

  function renderInstanceRunCard(layer: any, card: CardsRunCard): void {
    const selected = state.selectedRun && state.selectedRun.nodeId === card.node.id && state.selectedRun.index === card.index;
    const instance = (state.instances || []).find((item) => item && item.id === card.run.instance);
    const instanceLabel = instance
      ? (instance.displayName
        || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id))
      : card.run.instance || '未选择实例';
    const group = svgEl('g', {
      class: `instance-run-card studio-card${selected ? ' selected' : ''}`,
      transform: `translate(${card.x},${card.y})`,
      'data-run-key': card.key,
    }, layer);
    group.dataset.runKey = card.key;
    svgEl('rect', { class: 'instance-run-card-box card-body', width: runCardWidth, height: card.height, rx: 5 }, group);
    svgEl('rect', { class: 'instance-run-card-head card-head', x: 1, y: 1, width: runCardWidth - 2, height: 32, rx: 4 }, group);
    svgEl('rect', { class: 'instance-run-card-accent card-accent', x: 1, y: 10, width: 3, height: 14, rx: 1 }, group);
    svgEl('line', { class: 'instance-run-card-header-rule', x1: 1, y1: 33, x2: runCardWidth - 1, y2: 33 }, group);
    svgEl('rect', { class: 'instance-run-card-icon-plate', x: 10, y: 7, width: 20, height: 20, rx: 4 }, group);
    svgEl('text', { class: 'instance-run-card-icon', x: 20, y: 22, 'text-anchor': 'middle' }, group).textContent = '▣';
    nodeCards.text(group, { className: 'instance-run-card-instance card-title', x: 39, y: 22, value: instanceLabel, width: runCardWidth - 51, size: 12 });
    nodeCards.text(group, { className: 'instance-run-card-type card-kicker', x: 14, y: 47, value: '实例 · 子工作流', width: runCardWidth - 28, size: 10 });
    const workflowName = String(card.run.workflow || '未选择工作流').split(/[\\/]/).pop();
    nodeCards.text(group, { className: 'instance-run-card-workflow card-description', x: 14, y: 66, value: workflowName, width: runCardWidth - 28, size: 11 });
    card.variables.forEach((variable, variableIndex) => {
      const y = runCardBaseHeight + variableIndex * runVariableHeight;
      svgEl('line', { class: 'instance-variable-rule', x1: 0, y1: y, x2: runCardWidth, y2: y }, group);
      svgEl('circle', { class: `instance-variable-pin type-${variable.definition.type || 'any'}`, cx: 10, cy: y + runVariableHeight / 2, r: 5 }, group);
      nodeCards.text(group, { className: 'instance-variable-name', x: 22, y: y + 16, value: displayNameOfDefinition(variable.definition, variable.name), width: 104, size: 10 });
      nodeCards.text(group, { className: 'instance-variable-value', x: runCardWidth - 12, y: y + 16, value: workflowInputVariableValue(card.run, variable), width: 102, size: 10, anchor: 'end' });
      const hit = svgEl('circle', { class: 'variable-port-hit', cx: 10, cy: y + runVariableHeight / 2, r: 10, 'data-node': card.node.id, 'data-run-index': card.index, 'data-param': variable.name }, group);
      hit.addEventListener('pointerdown', (event: any) => {
        if (event.altKey) {
          disconnectVariableFromInstanceInput(card.node.id, card.index, variable.name);
          return;
        }
        startVariableConnectionFromInstanceInput(event, card.node.id, card.index, variable.name);
      });
      hit.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, instanceRunPinMenuItems(card, variable, point));
      });
    });
    const input = svgEl('circle', { class: 'port port-in instance-run-port', cx: runCardWidth / 2, cy: 0, r: portRadius }, group);
    input.style.pointerEvents = 'none';
    group.addEventListener('mousedown', (event: any) => {
      if (!event.target.closest('.card-body, .card-head, text')) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const isDouble = registerCardPress(`run:${card.key}`, event);
      state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = { nodeId: card.node.id, index: card.index };
      state.inspector = 'node';
      requestInspector({ kind: 'run', nodeId: card.node.id, index: card.index });
      if (isDouble && card.run.workflow) requestOpenWorkflowReference(card.run.workflow);
      else render();
    });
    group.addEventListener('contextmenu', (event: any) => {
      event.preventDefault();
      event.stopPropagation();
      if (contextMenuSuppressedByPan()) return;
      state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = { nodeId: card.node.id, index: card.index };
      render();
      const items: any[] = [];
      if (card.run.workflow) items.push({ label: '进入子工作流视图', run: () => requestOpenWorkflowReference(card.run.workflow!) }, 'separator');
      items.push({ label: '删除实例运行项', danger: true, run: () => removeInstanceRun(card.node, card.index) });
      showMenu(event.clientX, event.clientY, items);
    });
  }

  function renderVariableCard(layer: any, card: CardsVariableCard): void {
    const definition = (state.raw?.[card.scope] && state.raw[card.scope][card.name]) || {};
    const type = definition.type || 'any';
    const selectedCardIds = state.selectedVariableCardIds instanceof Set ? state.selectedVariableCardIds : new Set<string>();
    const selected = state.inspector === 'variables'
      && (selectedCardIds.has(card.id) || state.selectedVariableCardId === card.id);
    const targeted = state.variableConnect && state.variableConnect.direction === 'from-pin'
      && state.variableConnect.hover && state.variableConnect.hover.card === card.name && state.variableConnect.hover.scope === card.scope;
    const group = svgEl('g', {
      class: `variable-card studio-card type-${type}${selected ? ' selected' : ''}${targeted ? ' connect-target' : ''}`,
      transform: `translate(${card.x},${card.y})`,
      'data-variable': card.name,
    }, layer);
    group.dataset.variable = card.name;
    svgEl('rect', { class: 'variable-card-box card-body', width: variableCardWidth, height: variableCardHeight, rx: 5 }, group);
    svgEl('rect', { class: 'variable-card-head card-head', x: 1, y: 1, width: variableCardWidth - 2, height: 32, rx: 4 }, group);
    svgEl('rect', { class: 'variable-card-accent card-accent', x: 1, y: 10, width: 3, height: 14, rx: 1 }, group);
    svgEl('line', { class: 'variable-card-header-rule', x1: 1, y1: 33, x2: variableCardWidth - 1, y2: 33 }, group);
    svgEl('circle', { class: `variable-card-dot type-${type}`, cx: 15, cy: 18, r: 4.5 }, group);
    nodeCards.text(group, { className: 'variable-card-name card-title', x: 27, y: 22, value: definition.display_name || card.name, width: variableCardWidth - 39, size: 11 });
    const typeName = parameterTypeLabel(type);
    nodeCards.text(group, { className: 'variable-card-access card-meta', x: 12, y: 49, value: `${typeName} · ${card.scope === 'inputs' ? '输入' : '状态'}`, width: 76, size: 9 });
    const live = card.scope === 'variables' && state.variableValues && Object.prototype.hasOwnProperty.call(state.variableValues, card.name);
    const value = live ? state.variableValues[card.name] : definition.default;
    const valueNode = nodeCards.text(group, { className: 'variable-card-value', x: variableCardWidth - 12, y: 49, value: live ? compactValue(value, Infinity) : variableValueSummary(definition), width: 58, size: 10, anchor: 'end' });
    if (assetPreviewForPath(value)) bindAssetPathPreview(valueNode, () => {
      const currentLive = card.scope === 'variables' && state.variableValues && Object.prototype.hasOwnProperty.call(state.variableValues, card.name);
      return currentLive ? state.variableValues[card.name] : definition.default;
    });
    if (type === 'color') {
      const swatch = paramColorSwatch(live ? value : definition.default);
      if (swatch) svgEl('rect', { class: 'variable-card-swatch', x: variableCardWidth - 66, y: 41, width: 8, height: 8, rx: 2, fill: swatch }, group);
    }
    svgEl('circle', { class: `port port-variable-out type-${type}`, cx: variableCardWidth, cy: variableCardPortY, r: portRadius }, group);
    const port = svgEl('circle', { class: 'variable-port-hit', cx: variableCardWidth, cy: variableCardPortY, r: 10, 'data-variable': card.name }, group);
    port.addEventListener('pointerdown', (event: any) => startVariableConnectionFromCard(event, card.scope, card.name, card.id));
    port.addEventListener('contextmenu', (event: any) => {
      const point = openPortContextMenu(event);
      if (!point) return;
      showMenu(event.clientX, event.clientY, variableCardPortMenuItems(card, point));
    });
    group.addEventListener('mousedown', (event: any) => {
      if (!event.target.closest('.card-body, .card-head, text')) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = null;
      state.selectedVariable = card.name;
      state.selectedVariableScope = card.scope;
      setVariableCardSelection([card.id]);
      state.inspector = 'variables';
      const point = worldPoint(event);
      state.drag = { kind: 'variable-card', id: card.id, name: card.name, start: point, origin: { x: card.x, y: card.y }, before: snapshot(), moved: false };
      render();
    });
    group.addEventListener('contextmenu', (event: any) => {
      event.preventDefault();
      event.stopPropagation();
      if (contextMenuSuppressedByPan()) return;
      state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = null;
      state.selectedVariable = card.name;
      state.selectedVariableScope = card.scope;
      setVariableCardSelection([card.id]);
      state.inspector = 'variables';
      render();
      showMenu(event.clientX, event.clientY, [
        { label: '删除变量卡片', run: () => removeVariableCard(card.id) },
      ]);
    });
  }

  return { renderInstanceRunCard, renderVariableCard, registerCardPress };
}
