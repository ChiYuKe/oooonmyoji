/**
 * 节点卡片渲染：节点外观、运行状态、变量引脚、装饰器行、端口与卡片级交互。
 * 原 `workflow-editor.js` 的 renderNode/renderNodePreview。
 *
 * 渲染函数不修改文档；选择、拖拽与连线都经注入的指针/命令回调。
 */
import type { CanvasState } from '../state/canvas-state';
import { presentNodeGroupRun, type NodeGroupRunSummary } from '../model/node-group-runtime';
import type { CardsNodeCards } from './cards';
import { nodeCardSummary } from './card-values';
import { PARAM_FIELD_GAP, PARAM_FIELD_PADDING, paramColorSwatch, paramFieldWidth, paramRectParts, paramRowEditable, paramRowGeometry, paramRowKindOf, paramRowOpensPicker, paramRowValueView, paramTupleCells, paramTupleElementText, paramTupleItemKind, paramTupleLength } from './param-rows';
import type { ParamRowLike } from './param-rows';
import { dataTone, dataToneColor, parameterDataKey, variableDataKey } from '../canvas/data-tones';
import { FULL_DETAIL_MIN_ZOOM } from './zoom-level';
import { isGroupBoundaryPin, isGroupInterfaceNode, isGroupVariablesNode, isProjectedGroupNode } from '../model/node-groups';

export interface NodePreviewInfo {
  uri: string;
  path?: string;
}

/** 卡片参数行的折叠状态：total 为动作定义里的参数总数，hidden 为当前折叠掉的数量。 */
export interface NodeParamRowInfo {
  expanded: boolean;
  total: number;
  hidden: number;
  /** 清单声明了固定卡片的节点：始终显示声明里的全部端点，标题栏没有折叠箭头。 */
  fixed?: boolean;
  /** 固定卡片用双行行样式（标签一行、值一行）。 */
  twoLine?: boolean;
}

export interface NodeParamEditorRequest {
  node: any;
  pin: any;
  /** 值区热区的世界坐标矩形（就地编辑器按视口换算成屏幕坐标）。 */
  rect: { x: number; y: number; width: number; height: number };
  clientX: number;
  clientY: number;
  world: { x: number; y: number };
  /** 值文字的横向对齐：固定卡片的值行在框内左对齐，默认右对齐。 */
  valueAlign?: 'left' | 'right';
  /** 多格参数中被点击的格子；区域参数用它直接聚焦 X / Y / W / H。 */
  inputIndex?: number;
}

export interface NodeRenderDeps {
  state: CanvasState;
  svgEl(tag: string, attrs: Record<string, any>, parent: any): any;
  nodeCards: CardsNodeCards;
  position(node: any): { x: number; y: number };
  nodeHeight(node: any): number;
  /** 每个节点自己的参数行高：清单声明了固定卡片的节点用双行行样式（更高）。 */
  nodeRowHeight?(node: any): number;
  subWorkflowRef(node: any): string;
  templatePreview(node: any): NodePreviewInfo | null;
  compositeSubtitle(node: any): string;
  variableDisplayNameOf(scope: 'inputs' | 'variables', name: string, fallback?: string): string;
  /** 节点输出引用的显示名（`nodes.<id>.output.<字段>` → `<节点名>.<字段>`）。 */
  referenceDisplayNameOf?(ref: unknown): string;
  /** 这个节点上的校验错误（整节点 + 每个参数），用于把出错的行标红。 */
  nodeIssueInfo?(node: any): { node: any[]; params: Map<string, any[]> } | null;
  /** 把错误拼成悬停提示。 */
  issueTitle?(issues: any[]): string;
  decoratorLabel(decorator: any): string;
  nodeVariablePins(node: any): ParamRowLike[];
  openLightbox(src: string): void;
  disconnectVariableFromPin(nodeId: string, param: string): void;
  startVariableConnectionFromPin(event: any, nodeId: string, param: string): void;
  openPortContextMenu(event: any): { x: number; y: number } | null;
  showMenu(x: number, y: number, items: any[], options?: Record<string, unknown>): void;
  nodeVariablePinMenuItems(nodeId: string, pin: any, point: { x: number; y: number }): any[];
  nodeInputPortMenuItems(nodeId: string, point: { x: number; y: number }): any[];
  nodeOutputPortMenuItems(nodeId: string, point: { x: number; y: number }): any[];
  startConnectionFromInput(event: any, nodeId: string): void;
  startConnection(event: any, nodeId: string): void;
  /** 从任务卡右侧输出口开始拖「节点输出引用」。 */
  startReferenceConnection?(event: any, nodeId: string): void;
  /** 任务卡输出口的右键菜单（列出输出字段、复制引用、断开全部引用）。 */
  nodeReferencePortMenuItems?(nodeId: string, point: { x: number; y: number }): any[];
  /** 组内左侧变量卡的“新增接口变量”菜单。 */
  nodeGroupVariableMenuItems?(groupId: string): any[];
  startNodeDrag(event: any, nodeId: string): void;
  registerCardPress(key: string, event: { clientX: number; clientY: number }): boolean;
  requestInspector(selection: unknown): void;
  requestOpenSubWorkflow(nodeId: string): void;
  enterNodeGroup?(groupId: string, focusNodeId?: string): boolean;
  ungroupNodeGroup?(groupId: string): boolean;
  groupSelection?(): boolean;
  render(): void;
  /** 双击节点：聚焦并把缩放提到完整卡片档（概览 / 紧凑模式下用）。 */
  focusNodeDetail?(nodeId: string): void;
  contextMenuSuppressedByPan(): boolean;
  copySelection(): void;
  cutSelection(): void;
  deleteSelection(): void;
  /** 参数行的折叠状态与开关；缺省时按“全部展开”以外的旧行为渲染。 */
  paramRowInfo?(node: any): NodeParamRowInfo;
  toggleParamRows?(nodeId: string): void;
  /** 点击参数行的值区：交由就地编辑器决定菜单/输入框/详情栏。 */
  openParamEditor?(request: NodeParamEditorRequest): void;
  paramRowMenuItems?(nodeId: string, pin: any, point: { x: number; y: number }): any[];
  compactValue?(value: unknown, max?: number): string;
  typeIcons: Record<string, string>;
  typeNames: Record<string, string>;
  runLabels: Record<string, string>;
  /** 折叠组卡的状态来自真实成员节点，不使用合成组 id 查询运行表。 */
  nodeGroupRunSummary?(groupId: string): NodeGroupRunSummary | null;
  nodeWidth: number;
  baseHeight: number;
  portRadius: number;
  decoratorHeight: number;
  runVariableHeight: number;
  variablePinX: number;
  /** 任务卡右侧输出口在节点内的 Y 偏移（表头中线）。 */
  taskOutputPortY?: number;
  preview: { x: number; y: number; width: number; height: number };
}

export interface CanvasNodeCardRenderer {
  /** 返回节点组元素：渲染控制器把它记进挂载表，拖拽时只改 transform，不重建卡片。 */
  renderNode(layer: any, node: any): any;
  /** 运行事件的轻量补丁：只改组卡状态文字，不重建卡片。 */
  patchNodeRuntime(element: any, node: any): boolean;
}

/** Stable task identity, independent of the surrounding workbench theme. */
export function nodeCardCategory(node: { type?: string; action?: string }): string {
  if (node.type !== 'task') return 'control';
  const action = typeof node.action === 'string' ? node.action : '';
  if (action.startsWith('vision.wait')) return 'wait';
  if (action.startsWith('vision.')) return 'vision';
  if (action.startsWith('input.')) return 'input';
  if (action.startsWith('workflow.')) return 'workflow';
  if (action === 'core.sleep') return 'wait';
  if (action.startsWith('core.')) return 'utility';
  return 'custom';
}

export function createNodeCardRenderer(deps: NodeRenderDeps): CanvasNodeCardRenderer {
  const {
    state, svgEl, nodeCards, position, nodeHeight, nodeRowHeight, subWorkflowRef, templatePreview, compositeSubtitle,
    variableDisplayNameOf, decoratorLabel, nodeVariablePins, openLightbox,
    disconnectVariableFromPin, startVariableConnectionFromPin, openPortContextMenu, showMenu,
    nodeVariablePinMenuItems, nodeInputPortMenuItems, nodeOutputPortMenuItems,
    startConnectionFromInput, startConnection, startNodeDrag, registerCardPress, requestInspector,
    requestOpenSubWorkflow, render, contextMenuSuppressedByPan, copySelection, cutSelection, deleteSelection,
    paramRowInfo, toggleParamRows, openParamEditor, paramRowMenuItems, compactValue,
    typeIcons, typeNames, runLabels, nodeWidth, baseHeight, portRadius, decoratorHeight, runVariableHeight,
    variablePinX, preview, taskOutputPortY, startReferenceConnection, nodeReferencePortMenuItems, nodeGroupVariableMenuItems, referenceDisplayNameOf,
    nodeIssueInfo, issueTitle, focusNodeDetail, enterNodeGroup, ungroupNodeGroup, groupSelection, nodeGroupRunSummary,
  } = deps;
  const rowHeightOf = nodeRowHeight ?? (() => runVariableHeight);
  const referencePortY = taskOutputPortY ?? 16;
  const referenceLabel = referenceDisplayNameOf ?? ((ref: unknown) => String(ref || ''));
  const issuesOf = nodeIssueInfo ?? (() => null);
  const issuesText = issueTitle ?? ((items: any[]) => items.map((item) => String(item && item.message || '')).filter(Boolean).join('\n'));

  function classElement(element: any, name: string): any {
    if (typeof element?.querySelector === 'function') return element.querySelector(`.${name}`);
    if (typeof element?.querySelectorAll === 'function') return element.querySelectorAll(`.${name}`)?.[0] || null;
    return null;
  }

  function setText(element: any, value: string): boolean {
    if (!element || element.textContent === value) return false;
    element.textContent = value;
    return true;
  }

  function setVisibility(element: any, visible: boolean): boolean {
    if (!element?.getAttribute || !element?.setAttribute) return false;
    const next = visible ? 'visible' : 'hidden';
    if (element.getAttribute('visibility') === next) return false;
    element.setAttribute('visibility', next);
    return true;
  }

  function groupPresentation(node: any) {
    const groupId = String(node?._nodeGroupId || node?.id || '');
    return presentNodeGroupRun(nodeGroupRunSummary?.(groupId), runLabels);
  }

  function groupRuntimeFocus(node: any): { id: string; label: string } | null {
    if (!node?._nodeGroup) return null;
    const summary = nodeGroupRunSummary?.(String(node._nodeGroupId || node.id));
    if (summary?.runningNodeId) return { id: summary.runningNodeId, label: '定位当前运行节点' };
    if (summary?.failedNodeIds?.length) return { id: summary.failedNodeIds[0], label: '定位异常节点' };
    return null;
  }

  function patchNodeRuntime(element: any, node: any): boolean {
    if (!node?._nodeGroup || node._nodeGroupInterface || node._nodeGroupVariables) return false;
    const view = groupPresentation(node);
    let changed = false;
    changed = setVisibility(classElement(element, 'node-group-run-dot'), Boolean(view.status)) || changed;
    changed = setVisibility(classElement(element, 'node-group-run-label'), Boolean(view.status)) || changed;
    changed = setText(classElement(element, 'node-group-run-label'), view.statusLabel) || changed;
    changed = setText(classElement(element, 'node-group-progress'), view.progressLabel) || changed;
    changed = setText(classElement(element, 'node-group-runtime-detail'), view.detailLabel) || changed;
    changed = setText(classElement(element, 'node-group-runtime-title'), `${node.name || '节点组'}\n${view.title}`) || changed;
    return changed;
  }

  /** 当前拖拽（变量或节点输出引用）是否正好落在这个节点的这一行上。 */
  function hoverTargetOf(nodeId: string, param: string): boolean {
    for (const connection of [state.variableConnect, state.referenceConnect]) {
      const hover = connection && connection.hover;
      if (hover && hover.nodeId === nodeId && hover.param === param) return true;
    }
    return false;
  }

  const compact = compactValue ?? ((value: unknown, max = 24) => {
    let text: string;
    if (value === undefined) text = '未传值';
    else if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { ref?: unknown }).ref === 'string') text = `← ${(value as { ref: string }).ref}`;
    else if (typeof value === 'string') text = value;
    else { try { text = JSON.stringify(value); } catch { text = String(value); } }
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  });

  function renderNodePreview(group: any, previewInfo: NodePreviewInfo, className: string, preserveAspectRatio: string, onOpen?: string): void {
    const frame = svgEl('rect', { class: 'node-preview-frame', x: preview.x, y: preview.y, width: preview.width, height: preview.height, rx: 3 }, group);
    const image = svgEl('image', {
      class: `node-preview-image ${className}`,
      href: previewInfo.uri,
      x: preview.x + 1,
      y: preview.y + 1,
      width: preview.width - 2,
      height: preview.height - 2,
      preserveAspectRatio,
      'data-template-path': previewInfo.path || undefined,
    }, group);
    const stop = (event: { stopPropagation(): void }): void => event.stopPropagation();
    image.addEventListener('mousedown', stop);
    image.addEventListener('pointerdown', stop);
    image.addEventListener('click', (event: any) => { event.stopPropagation(); openLightbox(onOpen || previewInfo.uri); });
    image.addEventListener('error', () => { image.remove(); frame.remove(); });
    const title = svgEl('title', {}, image);
    title.textContent = previewInfo.path || '运行截图';
  }

  function renderNodeGroup(layer: any, node: any): any {
    const pos = position(node);
    const pins = nodeVariablePins(node);
    const height = nodeHeight(node);
    const isInterface = isGroupInterfaceNode(node);
    const isVariables = isGroupVariablesNode(node);
    const isCollapsedGroup = !isInterface && !isVariables;
    const runtime = isCollapsedGroup ? groupPresentation(node) : null;
    const selected = state.selected.has(node.id) ? ' selected' : '';
    const runClass = runtime?.status ? ` run-${runtime.status}` : '';
    const group = svgEl('g', {
      class: `node studio-card type-node_group category-control${selected}${runClass}`,
      transform: `translate(${pos.x},${pos.y})`,
      'data-id': node.id,
    }, layer);
    group.dataset.id = node.id;
    const body = svgEl('rect', { class: 'node-box card-body node-group-box', width: nodeWidth, height, rx: 7 }, group);
    const head = svgEl('rect', { class: 'node-head card-head node-group-head', x: 1, y: 1, width: nodeWidth - 2, height: 32, rx: 6 }, group);
    svgEl('rect', { class: 'node-accent card-accent node-group-accent', x: 1, y: 3, width: 4, height: 27, rx: 2 }, group);
    svgEl('line', { class: 'node-header-rule', x1: 1, y1: 33, x2: nodeWidth - 1, y2: 33 }, group);
    const iconPlate = svgEl('rect', { class: 'node-icon-plate', x: 10, y: 7, width: 20, height: 20, rx: 4 }, group);
    svgEl('text', { class: 'node-icon node-group-icon', x: 20, y: 22, 'text-anchor': 'middle' }, group).textContent = isInterface ? '⇄' : isVariables ? '◆' : '▦';
    nodeCards.text(group, { className: 'node-name card-title', x: 39, y: 22, value: node.name || '节点组', width: nodeWidth - (isVariables ? 80 : 53), size: 12 });
    if (isVariables) {
      const add = svgEl('g', { class: 'node-group-add', role: 'button', tabindex: 0 }, group);
      svgEl('rect', { class: 'node-group-add-bg', x: nodeWidth - 29, y: 6, width: 22, height: 22, rx: 3 }, add);
      svgEl('text', { class: 'node-group-add-icon', x: nodeWidth - 18, y: 22, 'text-anchor': 'middle' }, add).textContent = '+';
      svgEl('title', {}, add).textContent = '添加组接口变量';
      const stop = (event: any): void => { event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); };
      add.addEventListener('mousedown', stop);
      add.addEventListener('pointerdown', stop);
      add.addEventListener('click', (event: any) => {
        stop(event);
        showMenu(event.clientX, event.clientY, nodeGroupVariableMenuItems?.(String(node._nodeGroupId || '')) || []);
      });
      add.addEventListener('keydown', (event: any) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        stop(event);
        const at = position(node);
        showMenu(at.x + nodeWidth, at.y + 28, nodeGroupVariableMenuItems?.(String(node._nodeGroupId || '')) || []);
      });
    }
    nodeCards.text(group, { className: 'node-type card-kicker', x: 22, y: 50, value: isInterface ? '执行入口' : isVariables ? '组变量' : '节点组', width: 100, size: 10 });
    if (isCollapsedGroup) {
      svgEl('circle', { class: 'run-dot node-group-run-dot', cx: nodeWidth - 74, cy: 46, r: 3, visibility: runtime?.status ? 'visible' : 'hidden' }, group);
      nodeCards.text(group, {
        className: 'run-label node-group-run-label', x: nodeWidth - 14, y: 50,
        value: runtime?.statusLabel || '', width: 52, size: 10, anchor: 'end',
      }).setAttribute('visibility', runtime?.status ? 'visible' : 'hidden');
    }
    nodeCards.text(group, {
      className: `node-subtitle card-description${isCollapsedGroup ? ' node-group-progress' : ''}`, x: 22, y: 70,
      value: isInterface ? '连接组内入口节点' : isVariables ? `${pins.length} 个跨组数据端点` : (runtime?.progressLabel || `${Number(node._nodeCount || 0)} 个节点`),
      width: nodeWidth - 44, size: 11,
    });
    nodeCards.text(group, {
      className: `node-meta card-meta${isCollapsedGroup ? ' node-group-runtime-detail' : ''}`, x: 22, y: 87,
      value: isInterface ? '执行流从这里进入' : isVariables ? '连接真实成员参数' : (runtime?.detailLabel || '双击进入组内编辑'),
      width: nodeWidth - 44, size: 10,
    });
    if (isCollapsedGroup) svgEl('title', { class: 'node-group-runtime-title' }, group).textContent = `${node.name || '节点组'}\n${runtime?.title || ''}`;
    pins.forEach((pin: any, index: number) => {
      const centerY = baseHeight + index * runVariableHeight + runVariableHeight / 2;
      const targetNodeId = isGroupBoundaryPin(pin) ? pin.targetNodeId : node.id;
      const targetParam = isGroupBoundaryPin(pin) ? pin.targetParam : pin.param;
      const reference = pin.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof pin.value.ref === 'string' ? pin.value.ref : '';
      const linked = Boolean(pin.variable || reference);
      const dataKey = pin.variable ? variableDataKey(pin.scope, pin.variable) : reference || parameterDataKey(targetNodeId, targetParam);
      const toneClass = `data-tone-${dataTone(dataKey)}`;
      const pinX = isVariables ? nodeWidth - variablePinX : variablePinX;
      svgEl('line', { class: 'param-row-rule', x1: 1, y1: baseHeight + index * runVariableHeight, x2: nodeWidth - 1, y2: baseHeight + index * runVariableHeight }, group);
      svgEl('circle', {
        class: `port port-variable type-${pin.type || 'any'} ${toneClass}${linked ? ' bound configured' : ''}`,
        style: `--data-tone:${dataToneColor(dataKey)}`,
        cx: pinX, cy: centerY, r: portRadius - 2,
      }, group);
      nodeCards.text(group, { className: 'param-row-label', x: 22, y: centerY + 4, value: pin.label || targetParam, width: 142, size: 9 });
      nodeCards.text(group, {
        className: `param-row-value tone-${pin.variable ? 'bound' : 'default'}`,
        x: nodeWidth - 12, y: centerY + 4,
        value: pin.variable ? `← ${variableDisplayNameOf(pin.scope, pin.variable)}` : reference ? `← ${referenceLabel(reference)}` : '未连接',
        width: 76, size: 9, anchor: 'end',
      });
      const hit = svgEl('circle', {
        class: 'variable-port-hit', cx: pinX, cy: centerY, r: 10,
        'data-node': targetNodeId, 'data-param': targetParam,
      }, group);
      hit.addEventListener('pointerdown', (event: any) => {
        event.stopPropagation();
        if (event.altKey) disconnectVariableFromPin(targetNodeId, targetParam);
        else startVariableConnectionFromPin(event, targetNodeId, targetParam);
      });
      hit.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeVariablePinMenuItems(targetNodeId, { ...pin, param: targetParam }, point));
      });
    });
    if (!isVariables) svgEl('circle', { class: 'port port-in node-group-port', cx: nodeWidth / 2, cy: 0, r: portRadius }, group);
    if (Array.isArray(node.children) && node.children.length) {
      svgEl('circle', { class: 'port port-out node-group-port', cx: nodeWidth / 2, cy: height, r: portRadius }, group);
    }
    if (node._hasReferenceOutput) {
      const output = svgEl('circle', {
        class: 'port port-out port-out-reference node-group-port',
        cx: nodeWidth, cy: referencePortY, r: portRadius - 2.5,
      }, group);
      svgEl('title', {}, output).textContent = '组内节点输出引用';
    }
    const press = (event: any): void => {
      if (event.button !== 0) return;
      // 组内两张合成卡也编辑同一个组名；详情镜像只需要认识真实 group id。
      requestInspector({ kind: 'node', nodeId: String(node._nodeGroupId || node.id) });
      if (isInterface || isVariables) {
        startNodeDrag(event, node.id);
        return;
      }
      const isDouble = registerCardPress(node.id, event);
      if (isDouble) {
        event.preventDefault();
        event.stopPropagation();
        enterNodeGroup?.(node.id, groupRuntimeFocus(node)?.id);
        return;
      }
      startNodeDrag(event, node.id);
    };
    [body, head, iconPlate, ...group.querySelectorAll('text')].forEach((surface: any) => surface.addEventListener('mousedown', press));
    group.addEventListener('contextmenu', (event: any) => {
      event.preventDefault();
      event.stopPropagation();
      if (contextMenuSuppressedByPan()) return;
      if (isInterface || isVariables) return;
      state.selected = new Set([node.id]);
      state.selectedEdge = null;
      state.selectedRun = null;
      render();
      const runtimeFocus = groupRuntimeFocus(node);
      showMenu(event.clientX, event.clientY, [
        ...(runtimeFocus ? [{ label: runtimeFocus.label, run: () => enterNodeGroup?.(node.id, runtimeFocus.id) }] : []),
        { label: '进入节点组', run: () => enterNodeGroup?.(node.id) },
        { label: '解散节点组', run: () => ungroupNodeGroup?.(node.id) },
      ]);
    });
    return group;
  }

  function renderNode(layer: any, node: any): any {
    if (isProjectedGroupNode(node)) return renderNodeGroup(layer, node);
    const pos = position(node);
    const height = nodeHeight(node);
    const run = state.run.get(node.id);
    const subRef = subWorkflowRef(node);
    const template = templatePreview(node);
    const classes = ['node', 'studio-card', `type-${node.type}`, `category-${nodeCardCategory(node)}`];
    if (subRef) classes.push('node-subworkflow');
    if (state.selected.has(node.id)) classes.push('selected');
    if (state.connect && state.connect.hover === node.id) classes.push('connect-hover');
    if (state.variableConnect && state.variableConnect.hover && state.variableConnect.hover.nodeId === node.id) classes.push('connect-hover');
    // 拖节点输出引用时，光标下的卡片也要亮起来（用户看不出目标是谁就会「乱吸附」）。
    if (state.referenceConnect && state.referenceConnect.hover && state.referenceConnect.hover.nodeId === node.id) classes.push('connect-hover');
    if (run && run.status) classes.push(`run-${run.status}`);
    // 校验错误：节点级错误把卡片标红，参数级错误落到具体那一行。
    const issueInfo = issuesOf(node);
    if (issueInfo && issueInfo.node.length) classes.push('node-invalid');
    const group = svgEl('g', { class: classes.join(' '), transform: `translate(${pos.x},${pos.y})`, 'data-id': node.id }, layer);
    group.dataset.id = node.id;
    const body = svgEl('rect', { class: 'node-box card-body', width: nodeWidth, height, rx: 5 }, group);
    const head = svgEl('rect', { class: 'node-head card-head', x: 1, y: 1, width: nodeWidth - 2, height: 32, rx: 4 }, group);
    svgEl('rect', { class: 'node-accent card-accent', x: 1, y: 3, width: 3, height: 27, rx: 1 }, group);
    svgEl('line', { class: 'node-header-rule', x1: 1, y1: 33, x2: nodeWidth - 1, y2: 33 }, group);
    const iconPlate = svgEl('rect', { class: 'node-icon-plate', x: 10, y: 7, width: 20, height: 20, rx: 4 }, group);
    svgEl('text', { class: 'node-icon', x: 20, y: 22, 'text-anchor': 'middle' }, group).textContent = typeIcons[node.type] || '•';
    const hasRunStatus = Boolean(run && run.status);
    const rows = paramRowInfo ? paramRowInfo(node) : null;
    const pins = nodeVariablePins(node);
    // 清单声明了固定卡片的节点没有折叠状态：行就是清单里声明的那几个端点。
    const fixedRows = Boolean(rows && rows.fixed);
    const twoLine = Boolean(rows && rows.twoLine);
    const rowHeight = rowHeightOf(node);
    // 卡片文字列：表头说明行与端点标签、值行输入框共用同一条左基准线（标题跟在图标后面，单独一列）。
    const contentX = 22;
    const contentRight = nodeWidth - 12;
    const showRowToggle = !fixedRows && node.type === 'task' && Boolean(rows && rows.total > 0 && toggleParamRows);
    nodeCards.text(group, { className: 'node-name card-title', x: 39, y: 22, value: node.name || node.id, width: nodeWidth - (showRowToggle ? 71 : 51), size: 12 });
    nodeCards.text(group, { className: 'node-type card-kicker', x: contentX, y: 47, value: subRef ? '子工作流' : typeNames[node.type] || node.type, width: 130, size: 10 });
    const nodeErrorText = issueInfo && issueInfo.node.length ? issuesText(issueInfo.node) : '';
    svgEl('title', {}, group).textContent = `${node.name || node.id}\nID: ${node.id}${hasRunStatus ? `\n${runLabels[run.status] || run.status}${run.error ? `：${run.error}` : ''}` : ''}${nodeErrorText ? `\n⚠ ${nodeErrorText}` : ''}`;
    if (issueInfo && issueInfo.node.length) {
      const dot = svgEl('circle', { class: 'node-error-dot', cx: nodeWidth - 8, cy: 8, r: 4 }, group);
      dot.style.pointerEvents = 'none';
    }
    if (showRowToggle && rows) {
      const caret = svgEl('text', {
        class: `param-rows-toggle${rows.expanded ? ' expanded' : ''}`,
        x: nodeWidth - 14,
        y: 22,
        'text-anchor': 'end',
      }, group);
      caret.textContent = rows.expanded ? '▾' : (rows.hidden > 0 ? `▸ ${rows.hidden}` : '▸');
      const caption = svgEl('title', {}, caret);
      caption.textContent = rows.expanded ? '收起参数行（只显示必填与已配置）' : `展开全部参数行（还有 ${rows.hidden} 项未显示）`;
      // 箭头是标题栏上的按钮：不要触发节点拖拽（同类监听在下方批量注册，先注册者优先）。
      caret.addEventListener('mousedown', (event: any) => { event.preventDefault(); event.stopImmediatePropagation(); });
      caret.addEventListener('click', (event: any) => { event.preventDefault(); event.stopPropagation(); toggleParamRows?.(node.id); });
    }
    if (hasRunStatus) {
      svgEl('circle', { class: 'run-dot', cx: nodeWidth - 74, cy: 43, r: 3 }, group);
      nodeCards.text(group, { className: 'run-label', x: nodeWidth - 14, y: 47, value: runLabels[run.status] || run.status, width: 52, size: 10, anchor: 'end' });
    }
    const subtitle = node.type === 'task'
      ? (subRef ? subRef.split(/[\\/]/).pop() : (node.action || '未选择动作'))
      : compositeSubtitle(node);
    const hasPreview = Boolean(template || (run && run.thumbnail));
    nodeCards.text(group, { className: 'node-subtitle card-description', x: contentX, y: 66, value: subtitle, width: hasPreview ? 148 : contentRight - contentX, size: 11 });
    // 参数已经以内联行呈现，摘要只报数量（折叠时给出“已显示 / 全部”）。
    const metaValue = node.type === 'task'
      ? (pins.length
        ? (fixedRows
          ? `${pins.length} 项端点 · 卡片直接设置`
          : (rows && rows.hidden > 0 ? `${pins.length} / ${rows.total} 项参数 · 点值编辑` : `${pins.length} 项参数 · 点值编辑`))
        : '详情栏编辑参数')
      : nodeCardSummary(node);
    nodeCards.text(group, { className: 'node-meta card-meta', x: contentX, y: 84, value: metaValue, width: hasPreview ? 148 : run && Number.isFinite(run.duration) ? 160 : contentRight - contentX, size: 10 });
    if (run && run.thumbnail) {
      const uri = run.thumbnail.startsWith('data:') ? run.thumbnail : `data:image/png;base64,${run.thumbnail}`;
      renderNodePreview(group, { uri, path: '' }, 'step-thumb', 'xMidYMid slice', run.screenshot || uri);
    } else if (template) renderNodePreview(group, template, 'template-thumb', 'xMidYMid meet');
    else if (run && Number.isFinite(run.duration)) {
      nodeCards.text(group, { className: 'node-duration', x: nodeWidth - 14, y: 84, value: run.duration < 1000 ? `${run.duration} ms` : `${(run.duration / 1000).toFixed(1)} s`, width: 66, size: 10, anchor: 'end' });
    }
    const pinOffset = pins.length * rowHeight;
    pins.forEach((pin, index) => {
      const kind = paramRowKindOf(pin, pin.definition);
      const row = paramRowGeometry({ nodeWidth, baseHeight, rowHeight, index, pinX: variablePinX, twoLine });
      // 拖拽中的落点行：卡片亮起来的同时，这一行的值框也要亮，用户才知道会绑到哪一行。
      const targeted = hoverTargetOf(node.id, pin.param);
      // 校验错误：这一行出错的参数直接标红（必填未填、类型/范围不对等），悬停给出原文。
      const rowErrors = issueInfo ? (issueInfo.params.get(String(pin.param)) || []) : [];
      const invalid = rowErrors.length > 0;
      const errorText = invalid ? issuesText(rowErrors) : '';
      const checked = Boolean(pin.configured ? pin.value : pin.definition && pin.definition.default);
      const reference = pin.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof (pin.value as { ref?: unknown }).ref === 'string'
        ? (pin.value as { ref: string }).ref
        : '';
      const dataKey = pin.variable ? variableDataKey(pin.scope, pin.variable) : reference || parameterDataKey(node.id, pin.param);
      const dataToneClass = `data-tone-${dataTone(dataKey)}`;
      const linked = Boolean(pin.variable || /^nodes\.[^\.]+\.output(?:\.|$)/.test(reference));
      svgEl('line', { class: 'param-row-rule', x1: 0, y1: row.y, x2: nodeWidth, y2: row.y }, group);
      svgEl('circle', {
        class: `port port-variable type-${pin.type} ${dataToneClass}${linked ? ' bound' : ''}${pin.configured ? ' configured' : ''}${invalid ? ' invalid' : ''}`,
        style: `--data-tone:${dataToneColor(dataKey)}`,
        cx: row.portX,
        cy: row.centerY,
        r: portRadius - 2,
      }, group);
      // UE 风格：参数名与值分行（固定卡片）或同行（默认卡片）；复杂参数只显示摘要。
      const label = nodeCards.text(group, {
        className: `param-row-label${pin.required && !pin.configured ? ' required' : ''}${invalid ? ' error' : ''}`,
        x: row.labelX,
        y: row.labelY,
        value: pin.label || pin.param,
        width: row.labelWidth,
        size: 10,
      });
      label.style.pointerEvents = 'none';
      const view = paramRowValueView(pin, compact, pin.variable
        ? variableDisplayNameOf(pin.scope === 'variables' ? 'variables' : 'inputs', pin.variable, pin.label)
        : referenceLabel(pin.value && typeof pin.value === 'object' ? (pin.value as { ref?: unknown }).ref : ''));
      const opensPicker = paramRowOpensPicker(kind);
      // 固定长度数组：把**自己那一格**再均分成 N 个小输入格（随机间隔 → 最小值 / 最大值），
      // 整行宽度仍然不超过一个值框，和别的行共用同一条右边界。
      const tupleCells = twoLine && kind === 'tuple' ? paramTupleLength(pin.definition) ?? 0 : 0;
      const tupleWidth = tupleCells > 1 ? (row.hit.width - (tupleCells - 1) * PARAM_FIELD_GAP) / tupleCells : row.hit.width;
      const cellX = (index: number): number => row.hit.x + index * (tupleWidth + PARAM_FIELD_GAP);
      // 识别区域直接显示 X / Y / W / H 四格。它需要整行值区，避免把四个坐标压回一条摘要。
      const rectCells = twoLine && kind === 'rect' ? 4 : 0;
      const rectWidth = rectCells > 0 ? (row.valueWidth - (rectCells - 1) * PARAM_FIELD_GAP) / rectCells : row.hit.width;
      const rectX = (index: number): number => row.hit.x + index * (rectWidth + PARAM_FIELD_GAP);
      const rectParts = rectCells > 0
        ? paramRectParts(pin.configured ? pin.value : pin.definition && pin.definition.default)
        : null;
      // 值行的可点区域 = 可见输入框的完整范围；区域四格中的任意一格都打开同一个编辑器。
      const fieldSpan = {
        x: row.hit.x,
        y: row.hit.y,
        width: rectCells > 0 ? row.valueWidth : row.hit.width,
        height: row.hit.height,
      };
      const anchorWidth = fieldSpan.width;
      // 固定卡片：值行画成可见的输入框/控件，行内浮层点开后贴在同一个矩形上。
      // 需要离开卡片去详情栏的行（对象/数组）用虚线框，其余都是实线输入框。
      if (twoLine) {
        const boxes = rectCells > 0
          ? Array.from({ length: rectCells }, (_item, cell) => ({ x: rectX(cell), width: rectWidth, rect: true }))
          : tupleCells > 1
            ? Array.from({ length: tupleCells }, (_item, cell) => ({ x: cellX(cell), width: tupleWidth, rect: false }))
            : [{ x: row.hit.x, width: row.hit.width, rect: false }];
        for (const box of boxes) {
          svgEl('rect', {
            class: `param-row-field${tupleCells > 1 || rectCells > 0 ? ' param-row-cell' : ''}${box.rect ? ' param-row-rect-cell' : ''}${kind === 'complex' ? ' goes-inspector' : ''}${opensPicker ? ' opens-picker' : ''}${targeted ? ' target' : ''}${invalid ? ' error' : ''}`,
            x: box.x,
            y: row.hit.y,
            width: box.width,
            height: row.hit.height,
            rx: 4,
          }, group).style.pointerEvents = 'none';
        }
      }
      const fieldX = twoLine ? row.hit.x + PARAM_FIELD_PADDING : row.valueLeft;
      // 右侧的 › 只占最后几个像素：值文字按实际渲染宽度让位，别把「60,120 200×80」这种
      // 刚好放得下的区域值提前截断。
      const caretGlyph = 6;
      const showsPickerCaret = opensPicker && kind !== 'rect';
      const caretSpace = twoLine && showsPickerCaret ? caretGlyph : 0;
      // 颜色色块在双行样式下贴值行框右侧（与行内浮层里的取色块同位置）。
      const colorSwatch = kind === 'color'
        ? paramColorSwatch(pin.configured ? pin.value : pin.definition && pin.definition.default)
        : null;
      const swatchSpace = colorSwatch ? (twoLine ? 22 : 14) : 0;
      const fieldWidth = Math.max(24, (twoLine ? row.hit.width - PARAM_FIELD_PADDING * 2 : row.valueWidth) - caretSpace - swatchSpace);
      if (kind === 'boolean' && paramRowEditable(kind)) {
        // 双行样式下勾选框在值行框内左侧，单行样式下仍贴值区右侧。
        const checkX = twoLine ? fieldX : row.valueRight - 11;
        // 勾选框按文字的光学中心对齐（10px 字的光学中心在基线上方 3.5px），不是压在基线上。
        const checkY = twoLine ? row.valueY - 9 : row.centerY - 5.5;
        svgEl('rect', {
          class: `param-row-check tone-${view.tone}${checked ? ' checked' : ''}`,
          x: checkX,
          y: checkY,
          width: 11,
          height: 11,
          rx: 2.5,
        }, group).style.pointerEvents = 'none';
        if (checked) {
          svgEl('path', {
            class: 'param-row-check-mark',
            d: `M ${checkX + 2.4} ${checkY + 6} l 2.4 2.8 l 4.2 -5`,
            fill: 'none',
          }, group).style.pointerEvents = 'none';
        }
        if (twoLine) {
          const toggleText = nodeCards.text(group, {
            className: `param-row-value tone-${view.tone}`,
            x: checkX + 17,
            y: row.valueY,
            value: checked ? (pin.onLabel || '开') : (pin.offLabel || '关'),
            width: Math.max(24, fieldWidth - 11),
            size: 10,
          });
          toggleText.style.pointerEvents = 'none';
        }
      } else if (rectCells > 0) {
        // 区域值始终保留四个稳定位置。轴名与数字分开排版，把绝大多数宽度留给数字，
        // 四位坐标、高分辨率尺寸和常见负坐标都不会被省略号截断。
        const rectLabels = ['X', 'Y', 'W', 'H'];
        rectLabels.forEach((rectLabel, cellIndex) => {
          const cellValue = rectParts ? rectParts[cellIndex] : null;
          const axis = svgEl('text', {
            class: 'param-row-rect-axis',
            x: rectX(cellIndex) + 3,
            y: row.valueY,
            'font-size': 8,
            'font-weight': 700,
            fill: 'var(--card-muted)',
          }, group);
          axis.textContent = rectLabel;
          axis.style.pointerEvents = 'none';
          const cellText = nodeCards.text(group, {
            className: `param-row-value param-row-rect-value tone-${view.tone}`,
            x: rectX(cellIndex) + 11,
            y: row.valueY,
            value: cellValue ?? '—',
            width: Math.max(16, rectWidth - 15),
            size: 9,
          });
          cellText.style.pointerEvents = 'none';
          // `.param-row-value` 的通用字号是 10px；区域四格使用更紧凑的 9px，并启用等宽数字。
          cellText.style.fontSize = '9px';
          cellText.style.fontVariantNumeric = 'tabular-nums';
          const cellCaption: any = cellText.querySelectorAll('title')[0];
          if (cellCaption) cellCaption.textContent = `${pin.label || pin.param} ${rectLabel} = ${cellValue ?? '未设置'}`;
        });
      } else if (tupleCells > 1) {
        // 固定长度数组：每格一个输入格，自己的值文字（元素类型决定显示形式）。
        const itemKind = paramTupleItemKind(pin.definition);
        const current = pin.configured ? pin.value : pin.definition && pin.definition.default;
        paramTupleCells(pin.definition, current).forEach((cellValue, cellIndex) => {
          const cellText = nodeCards.text(group, {
            className: `param-row-value tone-${view.tone}`,
            x: cellX(cellIndex) + PARAM_FIELD_PADDING,
            y: row.valueY,
            value: paramTupleElementText(itemKind, cellValue),
            width: Math.max(16, tupleWidth - PARAM_FIELD_PADDING * 2),
            size: 10,
          });
          cellText.style.pointerEvents = 'none';
          const cellCaption: any = cellText.querySelectorAll('title')[0];
          if (cellCaption) cellCaption.textContent = `${pin.label || pin.param} 第 ${cellIndex + 1} 项`;
        });
      } else {
        const swatch = colorSwatch;
        const valueText = nodeCards.text(group, {
          className: `param-row-value tone-${view.tone}`,
          x: twoLine ? fieldX : row.valueRight,
          y: row.valueY,
          value: view.text,
          width: fieldWidth,
          size: 10,
          anchor: twoLine ? 'start' : 'end',
        });
        valueText.style.pointerEvents = 'none';
        if (swatch) {
          svgEl('rect', {
            class: 'param-row-swatch',
            x: twoLine ? row.hit.x + row.hit.width - 19 : row.valueRight - row.valueWidth + 2,
            y: twoLine ? row.hit.y + 1 : row.centerY - 5,
            width: twoLine ? 16 : 10,
            height: twoLine ? 16 : 10,
            rx: twoLine ? 3 : 2,
            fill: swatch,
          }, group).style.pointerEvents = 'none';
        }
        if (twoLine && showsPickerCaret) {
          svgEl('text', {
            class: 'param-row-caret',
            x: row.hit.x + row.hit.width - PARAM_FIELD_PADDING,
            y: row.valueY,
            'text-anchor': 'end',
          }, group).textContent = '›';
        }
        // nodeCards.text 已带一个 title（显示文本）；这里替换成更完整的参数提示。
        const caption: any = valueText.querySelectorAll('title')[0];
        if (caption) caption.textContent = view.title;
      }
      const hit = svgEl('circle', { class: 'variable-port-hit', cx: row.portX, cy: row.centerY, r: 10, 'data-node': node.id, 'data-param': pin.param }, group);
      hit.addEventListener('pointerdown', (event: any) => {
        event.stopPropagation();
        if (event.altKey) {
          disconnectVariableFromPin(node.id, pin.param);
          return;
        }
        startVariableConnectionFromPin(event, node.id, pin.param);
      });
      hit.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeVariablePinMenuItems(node.id, pin, point));
      });
      const valueHit = svgEl('rect', {
        class: `param-row-hit tone-${view.tone}${twoLine && opensPicker ? ' kind-picker' : ''}${targeted ? ' target' : ''}${invalid ? ' invalid' : ''}`,
        x: fieldSpan.x,
        y: fieldSpan.y,
        width: fieldSpan.width,
        height: fieldSpan.height,
        rx: 3,
        'data-node': node.id,
        'data-param': pin.param,
        ...(errorText ? { title: errorText } : {}),
      }, group);
      if (errorText) {
        // 出错的行：SVG 自带 title 之外再补一条，悬停在值区任意位置都能看到原因。
        const caption = svgEl('title', {}, valueHit);
        caption.textContent = errorText;
      }
      valueHit.addEventListener('pointerdown', (event: any) => {
        // 值区是行内编辑器：吞掉事件，避免触发框选/平移/节点拖拽。
        event.stopPropagation();
      });
      valueHit.addEventListener('click', (event: any) => {
        event.preventDefault();
        event.stopPropagation();
        const point = position(node);
        let inputIndex: number | undefined;
        if (rectCells > 0 && typeof valueHit.getBoundingClientRect === 'function') {
          const bounds = valueHit.getBoundingClientRect();
          if (bounds && bounds.width > 0 && Number.isFinite(event.clientX)) {
            const ratio = Math.max(0, Math.min(0.999999, (event.clientX - bounds.left) / bounds.width));
            inputIndex = Math.floor(ratio * rectCells);
          }
        }
        openParamEditor?.({
          node,
          pin,
          rect: { x: point.x + fieldSpan.x, y: point.y + fieldSpan.y, width: anchorWidth, height: fieldSpan.height },
          clientX: event.clientX,
          clientY: event.clientY,
          world: { x: point.x + fieldSpan.x, y: point.y + row.centerY },
          // 双行卡片的文字在框内左对齐，行内浮层要跟它保持一致，点开才像「框获得焦点」。
          valueAlign: twoLine ? 'left' : 'right',
          inputIndex,
        });
      });
      valueHit.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        const items = paramRowMenuItems ? paramRowMenuItems(node.id, pin, point) : nodeVariablePinMenuItems(node.id, pin, point);
        showMenu(event.clientX, event.clientY, items);
      });
    });
    const decorators = Array.isArray(node.decorators) ? node.decorators : [];
    decorators.forEach((decorator: any, index: number) => {
      const y = baseHeight + pinOffset + index * decoratorHeight;
      svgEl('line', { class: 'decorator-rule', x1: 0, y1: y, x2: nodeWidth, y2: y }, group);
      svgEl('text', { class: 'decorator-icon', x: 14, y: y + 15 }, group).textContent = '◇';
      nodeCards.text(group, { className: 'decorator-label', x: 32, y: y + 15, value: decoratorLabel(decorator), width: nodeWidth - 46, size: 10 });
    });
    if (node.type !== 'root') {
      const input = svgEl('circle', { class: 'port port-in', cx: nodeWidth / 2, cy: 0, r: portRadius, 'data-node': node.id }, group);
      input.addEventListener('pointerdown', (event: any) => startConnectionFromInput(event, node.id));
      input.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeInputPortMenuItems(node.id, point));
      });
    }
    if (node.type === 'task') {
      // 任务节点是叶子，没有执行流输出；右侧这个口是「节点输出引用」口，
      // 拖到别的节点的参数行即可绑定 nodes.<id>.output.<字段>。
      const output = svgEl('circle', {
        class: `port port-out port-out-reference data-tone-${dataTone(`nodes.${node.id}.output`)}${state.referenceConnect && state.referenceConnect.nodeId === node.id ? ' active' : ''}`,
        style: `--data-tone:${dataToneColor(`nodes.${node.id}.output`)}`,
        cx: nodeWidth,
        cy: referencePortY,
        r: portRadius - 2.5,
        'data-node': node.id,
      }, group);
      svgEl('title', {}, output).textContent = '节点输出：拖到别的节点的参数行绑定引用';
      output.addEventListener('pointerdown', (event: any) => startReferenceConnection?.(event, node.id));
      output.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeReferencePortMenuItems ? nodeReferencePortMenuItems(node.id, point) : []);
      });
    } else {
      const output = svgEl('circle', { class: 'port port-out', cx: nodeWidth / 2, cy: height, r: portRadius, 'data-node': node.id }, group);
      output.addEventListener('pointerdown', (event: any) => startConnection(event, node.id));
      output.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeOutputPortMenuItems(node.id, point));
      });
    }
    const handleNodeMouseDown = (event: any): void => {
      if (event.button !== 0) { startNodeDrag(event, node.id); return; }
      requestInspector({ kind: 'node', nodeId: node.id });
      const isDouble = registerCardPress(node.id, event);
      if (isDouble) {
        event.preventDefault();
        event.stopPropagation();
        if (subRef) { requestOpenSubWorkflow(node.id); return; }
        if (!state.selected.has(node.id)) state.selected = new Set([node.id]);
        state.selectedRun = null;
        state.inspector = 'node';
        // 概览 / 紧凑模式下双击自动聚焦并放大到完整卡片，否则只做选中。
        if (focusNodeDetail && state.zoom < FULL_DETAIL_MIN_ZOOM) {
          focusNodeDetail(node.id);
          return;
        }
        render();
        return;
      }
      startNodeDrag(event, node.id);
    };
    [body, head, iconPlate, ...group.querySelectorAll('text')].forEach((surface: any) => surface.addEventListener('mousedown', handleNodeMouseDown));
    if (subRef) {
      // 子流程节点右键菜单：直接进入子工作流视图
      group.addEventListener('contextmenu', (event: any) => {
        event.preventDefault();
        event.stopPropagation();
        if (contextMenuSuppressedByPan()) return;
        if (!state.selected.has(node.id)) state.selected = new Set([node.id]);
        state.selectedRun = null;
        render();
        showMenu(event.clientX, event.clientY, [
          { label: '进入子工作流视图', run: () => requestOpenSubWorkflow(node.id) },
          'separator',
          ...(state.selected.size >= 2 && groupSelection ? [{ label: '将所选节点打组', run: () => groupSelection() }, 'separator'] : []),
          { label: '复制 (Ctrl+C)', run: () => copySelection() },
          { label: '剪切 (Ctrl+X)', run: () => cutSelection() },
          { label: '删除节点', danger: true, run: () => deleteSelection() },
        ]);
      });
    } else {
      // 普通节点右键菜单（UE 风格）：复制 / 剪切 / 删除
      group.addEventListener('contextmenu', (event: any) => {
        event.preventDefault();
        event.stopPropagation();
        if (contextMenuSuppressedByPan()) return;
        if (!state.selected.has(node.id)) state.selected = new Set([node.id]);
        state.selectedRun = null;
        render();
        showMenu(event.clientX, event.clientY, [
          ...(state.selected.size >= 2 && groupSelection ? [{ label: '将所选节点打组', run: () => groupSelection() }, 'separator'] : []),
          { label: '复制 (Ctrl+C)', run: () => copySelection() },
          { label: '剪切 (Ctrl+X)', run: () => cutSelection() },
          'separator',
          { label: '删除节点', danger: true, run: () => deleteSelection() },
        ]);
      });
    }
    return group;
  }

  return { renderNode, patchNodeRuntime };
}
