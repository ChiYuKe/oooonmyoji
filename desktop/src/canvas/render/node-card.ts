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
import { PARAM_FIELD_GAP, PARAM_FIELD_PADDING, paramColorSwatch, paramRectParts, paramRowEditable, paramRowGeometry, paramRowKindOf, paramRowOpensPicker, paramRowValueView, paramTupleCells, paramTupleElementText, paramTupleItemKind, paramTupleLength } from './param-rows';
import type { ParamRowLike } from './param-rows';
import { dataTone, dataToneColor, parameterDataKey, variableDataKey } from '../canvas/data-tones';
import { dataPinArrow, execPinArrow } from './pin-glyphs';
import {
  CONDITION_INPUT_X, CONDITION_INPUT_Y, CONDITION_PORT_LABELS, CONDITION_PORT_ORDER, boolJudgeShape, conditionChildOf, conditionPortOffset, expressionInputOffset, isBooleanInputNode, isBoolJudgeNode, isValueCardNode, type ConditionPort,
} from '../model/exec-ports';
import { appendSelectionOutline } from './selection-outline';
import { FULL_DETAIL_MIN_ZOOM } from './zoom-level';
import { isGroupBoundaryPin, isGroupInterfaceNode, isGroupVariablesNode, isProjectedGroupNode } from '../model/node-groups';
import { nodeDisplayTitle } from '../model/node-title';

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
  /** 旧卡片的双行行样式；固定卡片现用左右单行。 */
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
  /** 每个节点自己的参数行高：固定卡片略高于普通摘要行。 */
  nodeRowHeight?(node: any): number;
  subWorkflowRef(node: any): string;
  templatePreview(node: any): NodePreviewInfo | null;
  compositeSubtitle(node: any): string;
  /** 条件表达式 → 中文回读（不带「当…时执行」包装）；布尔判断卡的嵌套形态用它做卡面回读。 */
  conditionToText?(expression: any): string;
  variableDisplayNameOf(scope: 'inputs' | 'variables', name: string, fallback?: string): string;
  /** 节点输出引用的显示名（`nodes.<id>.output.<字段>` → `<节点名>.<字段>`）。 */
  referenceDisplayNameOf?(ref: unknown): string;
  /**
   * 标题里的引用短名（`nodes.classify.output` → `识别结果`，不带「› 输出」尾缀）。
   * 拆分卡片的 UE 式标题 `Break <来源名>` 用它；缺省时退回 `referenceDisplayNameOf`。
   */
  referenceTitleOf?(ref: unknown): string;
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
  nodeOutputPortMenuItems(nodeId: string, point: { x: number; y: number }, port?: ConditionPort): any[];
  startConnectionFromInput(event: any, nodeId: string): void;
  startConnection(event: any, nodeId: string, at?: { x: number; y: number }, port?: ConditionPort): void;
  /** 从任务卡右侧输出口开始拖「节点输出引用」；拆分卡片的字段引脚带字段名定向绑定。 */
  startReferenceConnection?(event: any, nodeId: string, at?: { x: number; y: number }, field?: string): void;
  /** 任务卡输出口的右键菜单（列出输出字段、复制引用、断开全部引用）。 */
  nodeReferencePortMenuItems?(nodeId: string, point: { x: number; y: number }): any[];
  /** 这个节点的输出是否已经被别的节点引用：连了画实心，没连是空心环。 */
  outputReferenced?(nodeId: string): boolean;
  /** 值卡片（布尔判断 / 拆分）的浮动编辑器：点卡片上的条件 / 拆分回读行打开。 */
  openValueCardEditor?(nodeId: string): boolean;
  /** 值卡片的右键菜单（UE 的节点菜单：Break 选结构体、比较节点 Convert Operator）。 */
  valueCardMenuItems?(nodeId: string): any[];
  /** 拆分卡片右侧的字段引脚候选与几何（与 editor 的 nodeHeight 共用同一份公式）。 */
  breakFieldPins?(node: any): Array<{ field: string; label: string; ref: string }>;
  breakFieldPinOffset?(node: any, field: string): { x: number; y: number } | null;
  /** 拆分卡片的某个字段是否已被引用（字段引脚的实心/空心状态）。 */
  outputFieldReferenced?(nodeId: string, field: string): boolean;
  /** 组内左侧变量卡的“新增接口变量”菜单。 */
  nodeGroupVariableMenuItems?(groupId: string): any[];
  startNodeDrag(event: any, nodeId: string): void;
  registerCardPress(key: string, event: { clientX: number; clientY: number }): boolean;
  requestInspector(selection: unknown): void;
  requestOpenSubWorkflow(nodeId: string): void;
  enterNodeGroup?(groupId: string, focusNodeId?: string): boolean;
  ungroupNodeGroup?(groupId: string): boolean;
  groupSelection?(): boolean;
  /** 把当前节点收成一个可复用的自定义类型（缺省表示该画布不支持）。 */
  collapseIntoCustomType?(): void;
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
  /** 该节点位置是否已锁定：卡片显示一把小锁，拖动与自动排列都跳过它。 */
  isNodeLocked?(nodeId: string): boolean;
  /** 折叠组内部的问题汇总：错误数、提醒数与第一个出问题节点（点组卡徽标直接定位）。 */
  groupIssueSummary?(groupId: string): { errors: number; warnings: number; first: string };
  /** 该节点上的提醒（warning）数量：卡片画琥珀色小点，与红色错误点区分。 */
  nodeWarningCount?(nodeId: string): number;
  nodeWidth: number;
  baseHeight: number;
  portRadius: number;
  decoratorHeight: number;
  runVariableHeight: number;
  variablePinX: number;
  /** 任务卡右侧输出口在节点内的 Y 偏移（表头中线）。 */
  taskOutputPortY?: number;
  /** 任务卡右侧输出口在节点内的 X 偏移（收在卡片右缘以内）。默认贴右缘。 */
  taskOutputPortX?: number;
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
    variablePinX, preview, taskOutputPortY, taskOutputPortX, startReferenceConnection, nodeReferencePortMenuItems, nodeGroupVariableMenuItems, referenceDisplayNameOf,
    nodeIssueInfo, issueTitle, focusNodeDetail, enterNodeGroup, ungroupNodeGroup, groupSelection, nodeGroupRunSummary,
    collapseIntoCustomType,
    outputReferenced, breakFieldPins, breakFieldPinOffset, outputFieldReferenced, openValueCardEditor, valueCardMenuItems,
  } = deps;
  const isNodeLocked = deps.isNodeLocked ?? (() => false);
  const groupIssueSummary = deps.groupIssueSummary;
  const nodeWarningCount = deps.nodeWarningCount ?? (() => 0);
  const rowHeightOf = nodeRowHeight ?? (() => runVariableHeight);
  const breakFieldPinsOf = breakFieldPins ?? (() => []);
  const breakFieldPinOffsetOf = breakFieldPinOffset ?? (() => null);
  const referencePortY = taskOutputPortY ?? 16;
  /** 输出口横向位置：与连线起点（`edges.referencePortPosition`）共用同一个偏移。 */
  const referencePortX = taskOutputPortX ?? nodeWidth;
  const referenceLabel = referenceDisplayNameOf ?? ((ref: unknown) => String(ref || ''));
  const conditionToText = deps.conditionToText;
  // 标题里只用「来源名」这一层（`Break 识别结果`），字段引用才带完整路径。
  const referenceTitle = deps.referenceTitleOf ?? ((ref: unknown) => referenceLabel(ref));
  /** 卡片标题：name 覆盖 > 值卡片类型派生标题 > 节点 ID（见 model/node-title）。 */
  const titleOf = (node: any): string => nodeDisplayTitle(node, { referenceTitle: (ref: string) => referenceTitle(ref) });
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
    // 折叠组内部的问题汇总：组员（含嵌套组）里有多少错误就在组卡上标多少，
    // 点一下直接进入组内并定位到第一个出错的节点——不用进组一个个找。
    if (isCollapsedGroup) {
      const groupId = String(node._nodeGroupId || node.id);
      const problems = groupIssueSummary?.(groupId) || { errors: 0, warnings: 0, first: '' };
      if (problems.errors || problems.warnings) {
        const badge = svgEl('g', {
          class: `node-group-issue${problems.errors ? ' error' : ' warning'}`, role: 'button', tabindex: 0,
        }, group);
        svgEl('rect', { class: 'node-group-issue-bg', x: nodeWidth - 30, y: 6, width: 24, height: 22, rx: 3 }, badge);
        svgEl('text', { class: 'node-group-issue-text', x: nodeWidth - 18, y: 21, 'text-anchor': 'middle' }, badge)
          .textContent = problems.errors ? `⚠${problems.errors}` : `!${problems.warnings}`;
        svgEl('title', {}, badge).textContent = problems.errors
          ? `组内有 ${problems.errors} 个错误${problems.warnings ? `、${problems.warnings} 个提醒` : ''}\n点击进入组并定位到第一个问题`
          : `组内有 ${problems.warnings} 个提醒\n点击进入组并定位到第一个问题`;
        const stop = (event: any): void => { event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); };
        badge.addEventListener('mousedown', stop);
        badge.addEventListener('pointerdown', stop);
        badge.addEventListener('click', (event: any) => {
          stop(event);
          if (!enterNodeGroup?.(groupId, problems.first || undefined)) {
            // 进不去（组已被删除等）：至少把视野移到这张组卡上。
            focusNodeDetail?.(node.id);
          }
        });
        badge.addEventListener('keydown', (event: any) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          stop(event);
          enterNodeGroup?.(groupId, problems.first || undefined);
        });
      }
    }
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
      svgEl('path', {
        class: 'port-glyph port-glyph-data', style: `--data-tone:${dataToneColor(dataKey)}`,
        d: dataPinArrow(pinX, centerY, portRadius - 2),
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
    if (!isVariables) {
      svgEl('circle', { class: 'port port-in node-group-port', cx: nodeWidth / 2, cy: 0, r: portRadius }, group);
      svgEl('path', { class: 'port-glyph port-glyph-exec', d: execPinArrow(nodeWidth / 2, 0, portRadius) }, group);
    }
    if (Array.isArray(node.children) && node.children.length) {
      svgEl('circle', { class: 'port port-out node-group-port', cx: nodeWidth / 2, cy: height, r: portRadius }, group);
      svgEl('path', { class: 'port-glyph port-glyph-exec', d: execPinArrow(nodeWidth / 2, height, portRadius) }, group);
    }
    if (node._hasReferenceOutput && Array.isArray(node._referenceOutputs) && node._referenceOutputs.length) {
      const outputs = node._referenceOutputs;
      outputs.forEach((item: any, index: number) => {
        const y = baseHeight + index * rowHeightOf(node) + rowHeightOf(node) / 2;
        const ref = String(item.ref || `nodes.${node._nodeGroupId || node.id}.output`);
        const tone = dataToneColor(ref);
        const output = svgEl('circle', {
          class: 'port port-out port-out-reference node-group-port connected',
          style: `--data-tone:${tone}`,
          cx: referencePortX, cy: y, r: portRadius - 2.5,
          'data-field': item.field || '',
        }, group);
        svgEl('path', {
          class: 'port-glyph port-glyph-data', style: `--data-tone:${tone}`,
          d: dataPinArrow(referencePortX, y, portRadius - 2.5),
        }, group);
        svgEl('title', {}, output).textContent = `组内节点输出引用：${ref}`;
      });
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
    appendSelectionOutline(group, svgEl, nodeWidth, height, 7);
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
    // 值卡片（布尔判断 / 拆分）的卡面身份：CSS 用 `.studio-card.value-card` 只改
    // `--card-tint` 派生的文字与色条，让它们一眼区别于执行流卡片（卡身底色不动）。
    if (isValueCardNode(node)) classes.push('value-card');
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
    // 锁定位置：卡片样式与角标都要标出来（拖动与自动排列都会跳过它）。
    const locked = Boolean(isNodeLocked?.(node.id));
    if (locked) classes.push('node-locked');
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
    const allPins = nodeVariablePins(node);
    // 判断节点与布尔判断卡片：bool 输入口是说明区独立端点，不作为参数行渲染。
    const booleanInputNode = isBooleanInputNode(node);
    const pins = booleanInputNode ? [] : allPins;
    const conditionPin = booleanInputNode
      ? allPins.find((pin: any) => pin && pin.param === 'condition')
      : null;
    // 判断节点的 bool 输入口是说明区独立端点，不作为参数行渲染。
    // 清单声明了固定卡片的节点没有折叠状态：行就是清单里声明的那几个端点。
    const fixedRows = Boolean(rows && rows.fixed);
    const twoLine = Boolean(rows && rows.twoLine);
    const boxedRows = fixedRows || twoLine;
    const rowHeight = rowHeightOf(node);
    // 表头说明行与参数标签共用左基准线，固定卡片的值框在右列。
    const contentX = 22;
    const contentRight = nodeWidth - 12;
    const showRowToggle = !fixedRows && node.type === 'task' && Boolean(rows && rows.total > 0 && toggleParamRows);
    nodeCards.text(group, { className: 'node-name card-title', x: 39, y: 22, value: titleOf(node), width: nodeWidth - (showRowToggle ? 71 : 51), size: 12 });
    nodeCards.text(group, { className: 'node-type card-kicker', x: contentX, y: 47, value: subRef ? '子工作流' : typeNames[node.type] || node.type, width: 130, size: 10 });
    const nodeErrorText = issueInfo && issueInfo.node.length ? issuesText(issueInfo.node) : '';
    svgEl('title', {}, group).textContent = `${titleOf(node)}\nID: ${node.id}${hasRunStatus ? `\n${runLabels[run.status] || run.status}${run.error ? `：${run.error}` : ''}` : ''}${nodeErrorText ? `\n⚠ ${nodeErrorText}` : ''}${locked ? '\n🔒 位置已锁定（自动排列与拖动都会跳过）' : ''}`;
    if (issueInfo && issueInfo.node.length) {
      const dot = svgEl('circle', { class: 'node-error-dot', cx: nodeWidth - 8, cy: 8, r: 4 }, group);
      dot.style.pointerEvents = 'none';
    } else if (nodeWarningCount(node.id) > 0) {
      // 只有提醒（warning）时画琥珀色小点：文件照常能跑，不必报警红色。
      const warnings = nodeWarningCount(node.id);
      const dot = svgEl('circle', { class: 'node-warning-dot', cx: nodeWidth - 8, cy: 8, r: 4 }, group);
      dot.style.pointerEvents = 'none';
      const title = svgEl('title', {}, dot);
      title.textContent = `${warnings} 个提醒（不阻止保存）`;
    }
    // 锁定角标：画在标题带右上角，避开错误点/提醒点（有圆点时小锁左移一点）。
    if (locked) {
      const hasDot = Boolean(issueInfo && issueInfo.node.length) || nodeWarningCount(node.id) > 0;
      const badgeX = hasDot ? nodeWidth - 38 : nodeWidth - 22;
      svgEl('rect', { class: 'node-locked-badge', x: badgeX, y: 6, width: 14, height: 12, rx: 3 }, group);
      svgEl('text', { class: 'node-locked-badge-glyph', x: badgeX + 7, y: 15, 'text-anchor': 'middle' }, group).textContent = '锁';
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
    if (node.type === 'bool_judge') {
      nodeCards.text(group, { className: 'node-type card-kicker', x: contentX, y: 47, value: '布尔判断', width: 130, size: 10 });
      // 卡面按表达式形态排：只有二元比较才画 UE 紧凑节点的操作数格，
      // 嵌套条件与整卡绑定只回读（它们没有「两个操作数」这回事，画出来就是假的引脚）。
      const shape = boolJudgeShape(node);
      const expression = node.expression && typeof node.expression === 'object' && !Array.isArray(node.expression)
        ? node.expression as Record<string, any>
        : {};
      const operator = Object.keys(expression)[0] || 'eq';
      const operatorText: Record<string, string> = { eq: '==', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=', contains: '∋' };
      if (shape === 'comparison') {
        nodeCards.text(group, { className: 'bool-judge-operator', x: 132, y: 76, value: operatorText[operator] || operator, width: 32, size: 12, anchor: 'middle' });
      }
      nodeCards.text(group, { className: 'bool-judge-output-label', x: 188, y: 76, value: 'bool', width: 42, size: 10 });
      if (shape === 'comparison') {
        const boolJudgePins = allPins.filter((pin: any) => pin && (pin.param === 'left' || pin.param === 'right'));
        boolJudgePins.forEach((pin: any) => {
          const offset = expressionInputOffset(node, pin.param);
          if (!offset) return;
          const value = pin.value === undefined ? 0 : pin.value;
          const text = value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string'
            ? `← ${referenceLabel(value.ref)}`
            : String(value);
          svgEl('rect', { class: 'bool-judge-operand-field', x: 48, y: offset.y - 9, width: 74, height: 18, rx: 2 }, group);
          const valueText = nodeCards.text(group, { className: 'bool-judge-operand-value', x: 54, y: offset.y + 4, value: text || '0', width: 62, size: 10 });
          valueText.style.pointerEvents = 'none';
          // 操作数值像 UE 的引脚默认值一样就地编辑：点这一格打开行内编辑器
          // （已绑变量时走端口菜单，字面量写回 expression 的操作数位置）。
          const fieldHit = svgEl('rect', {
            class: 'bool-judge-operand-hit',
            x: 46, y: offset.y - 10, width: 78, height: 20, rx: 3,
            'data-node': node.id, 'data-param': pin.param,
          }, group);
          const fieldTip = svgEl('title', {}, fieldHit);
          fieldTip.textContent = pin.variable
            ? `${pin.label || pin.param}：已绑定变量，点击打开端口菜单`
            : `${pin.label || pin.param}：点击编辑字面量（拖到左侧引脚可绑变量/引用）`;
          fieldHit.addEventListener('click', (event: any) => {
            event.preventDefault();
            event.stopPropagation();
            const point = position(node);
            openParamEditor?.({
              node,
              pin: {
                ...pin,
                param: pin.param,
                label: pin.label || (pin.param === 'left' ? '左值' : '右值'),
                definition: { type: pin.variable || value && typeof value === 'object' ? 'any' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string' },
              },
              rect: { x: point.x + 46, y: point.y + offset.y - 10, width: 78, height: 20 },
              clientX: event.clientX,
              clientY: event.clientY,
              world: { x: point.x + 46, y: point.y + offset.y },
              valueAlign: 'left',
            });
          });
        });
      } else {
        // 回读行：绑定形态读「← 来源」，嵌套形态读整句中文；点它打开「嵌套条件（进阶）」浮层
        // （嵌套逻辑只能在那里编，卡面上没有对应的可编辑字段）。
        const boundPin = allPins.find((pin: any) => pin && pin.param === 'condition');
        const boundVariable = boundPin && boundPin.variable ? String(boundPin.variable) : '';
        const boundScope = boundPin && boundPin.scope === 'variables' ? 'variables' : 'inputs';
        const reference = typeof expression.ref === 'string' ? expression.ref : '';
        const source = boundVariable
          ? variableDisplayNameOf(boundScope, boundVariable)
          : reference ? referenceLabel(reference) : '';
        const readback = shape === 'binding'
          ? (source ? `← ${source}` : typeof node.expression === 'boolean' ? String(node.expression) : '未绑定 bool 来源')
          : (conditionToText?.(node.expression) || '等待左侧输入');
        const line = nodeCards.text(group, {
          className: 'node-subtitle card-description value-card-readback',
          // 回读行停在 `bool` 输出标签左边，不让长句压到标签上（超长部分截断，完整整句在悬停提示里）。
          x: contentX, y: 66, value: readback, width: 188 - contentX - 6, size: 11,
        });
        const readbackTip = svgEl('title', {}, group);
        readbackTip.textContent = `${readback}\n条件值由左侧布尔输入端口提供`;
        const readbackHit = svgEl('rect', { class: 'value-card-readback-hit', x: contentX - 2, y: 52, width: contentRight - contentX + 4, height: 20, rx: 3 }, group);
        readbackHit.addEventListener('click', (event: any) => {
          event.preventDefault();
          event.stopPropagation();
          openValueCardEditor?.(node.id);
        });
        line.style.pointerEvents = 'none';
        if (shape === 'nested') {
          nodeCards.text(group, { className: 'node-meta card-meta value-card-hint', x: contentX, y: 84, value: '点这一行改嵌套条件', width: contentRight - contentX, size: 10 });
        }
      }
    } else {
      nodeCards.text(group, { className: 'node-subtitle card-description', x: contentX, y: 66, value: subtitle, width: hasPreview ? 148 : contentRight - contentX, size: 11 });
    }
    if (isValueCardNode(node)) {
      // 值卡片的设置走**节点右键菜单**（UE：Break 的结构体、比较节点的 Convert Operator），
      // 值就在引脚上就地编辑，没有详情面板、也没有额外的浮层。
      const cardMenu = (event: any): void => {
        const items = valueCardMenuItems?.(node.id) || [];
        if (!items.length) return;
        event.preventDefault();
        event.stopPropagation();
        if (contextMenuSuppressedByPan()) return;
        const point = openPortContextMenu(event);
        if (!point) return;
        state.selected = new Set([node.id]);
        state.selectedEdge = null;
        state.selectedRun = null;
        render();
        showMenu(event.clientX, event.clientY, items);
      };
      head.addEventListener('contextmenu', cardMenu);
      body.addEventListener('contextmenu', cardMenu);
    }
    // 参数已经以内联行呈现，摘要只报数量（折叠时给出“已显示 / 全部”）。
    // 值卡片不画这一行：它们的身体是引脚/操作数格（UE 的排法），摘要会跟引脚格打架。
    const metaValue = node.type === 'task'
      ? (pins.length
        ? (fixedRows
          ? `${pins.length} 项端点 · 卡片直接设置`
          : (rows && rows.hidden > 0 ? `${pins.length} / ${rows.total} 项参数 · 点值编辑` : `${pins.length} 项参数 · 点值编辑`))
        : '详情栏编辑参数')
      : nodeCardSummary(node);
    if (!isValueCardNode(node)) {
      nodeCards.text(group, { className: 'node-meta card-meta', x: contentX, y: 84, value: metaValue, width: hasPreview ? 148 : run && Number.isFinite(run.duration) ? 160 : contentRight - contentX, size: 10 });
    }
    if (run && run.thumbnail) {
      const uri = run.thumbnail.startsWith('data:') ? run.thumbnail : `data:image/png;base64,${run.thumbnail}`;
      renderNodePreview(group, { uri, path: '' }, 'step-thumb', 'xMidYMid slice', run.screenshot || uri);
    } else if (template) renderNodePreview(group, template, 'template-thumb', 'xMidYMid meet');
    else if (run && Number.isFinite(run.duration)) {
      nodeCards.text(group, { className: 'node-duration', x: nodeWidth - 14, y: 84, value: run.duration < 1000 ? `${run.duration} ms` : `${(run.duration / 1000).toFixed(1)} s`, width: 66, size: 10, anchor: 'end' });
    }
    const breakFields = node.type === 'break' ? breakFieldPinsOf(node) : [];
    const rowCount = node.type === 'break' ? Math.max(pins.length, breakFields.length) : pins.length;
    const pinOffset = rowCount * rowHeight;
    /**
     * 拆分卡片的紧凑排法（UE Break 结构体）：左侧「拆分来源」输入引脚，右缘按字段逐行排出
     * 输出引脚，两边共用同一套行网格；这一行不画参数值——右半行是字段引脚的位置。
     */
    const renderBreakRows = (): void => {
      const sourcePin = pins[0];
      for (let index = 0; index < rowCount; index += 1) {
        const row = paramRowGeometry({ nodeWidth, baseHeight, rowHeight, index, pinX: variablePinX, twoLine, boxedInline: fixedRows && !twoLine });
        svgEl('line', { class: 'param-row-rule', x1: 0, y1: row.y, x2: nodeWidth, y2: row.y }, group);
        if (index === 0 && sourcePin) {
          const param = sourcePin.param;
          const rowErrors = issueInfo ? (issueInfo.params.get(String(param)) || []) : [];
          const invalid = rowErrors.length > 0;
          const errorText = invalid ? issuesText(rowErrors) : '';
          const reference = sourcePin.value && typeof sourcePin.value === 'object' && !Array.isArray(sourcePin.value) && typeof (sourcePin.value as { ref?: unknown }).ref === 'string'
            ? (sourcePin.value as { ref: string }).ref
            : '';
          const dataKey = sourcePin.variable ? variableDataKey(sourcePin.scope, sourcePin.variable) : reference || parameterDataKey(node.id, param);
          const linked = Boolean(sourcePin.variable || /^nodes\.[^\.]+\.output(?:\.|$)/.test(reference));
          const port = svgEl('circle', {
            class: `port port-variable type-${sourcePin.type} data-tone-${dataTone(dataKey)}${linked ? ' bound' : ''}${sourcePin.configured ? ' configured' : ''}${invalid ? ' invalid' : ''}`,
            style: `--data-tone:${dataToneColor(dataKey)}`,
            cx: row.portX,
            cy: row.centerY,
            r: portRadius - 2,
          }, group);
          svgEl('path', {
            class: `port-glyph port-glyph-data${invalid ? ' invalid' : ''}`,
            style: `--data-tone:${dataToneColor(dataKey)}`,
            d: dataPinArrow(row.portX, row.centerY, portRadius - 2),
          }, group);
          const label = nodeCards.text(group, {
            className: `param-row-label${sourcePin.required && !sourcePin.configured ? ' required' : ''}${invalid ? ' error' : ''}`,
            x: row.labelX,
            y: row.labelY,
            value: sourcePin.label || param,
            width: row.labelWidth,
            size: 10,
          });
          label.style.pointerEvents = 'none';
          if (errorText) {
            const caption = svgEl('title', {}, port);
            caption.textContent = errorText;
          }
          const hit = svgEl('circle', { class: 'variable-port-hit', cx: row.portX, cy: row.centerY, r: 10, 'data-node': node.id, 'data-param': param }, group);
          hit.addEventListener('pointerdown', (event: any) => {
            event.stopPropagation();
            if (event.altKey) {
              disconnectVariableFromPin(node.id, param);
              return;
            }
            startVariableConnectionFromPin(event, node.id, param);
          });
          hit.addEventListener('contextmenu', (event: any) => {
            const point = openPortContextMenu(event);
            if (!point) return;
            showMenu(event.clientX, event.clientY, nodeVariablePinMenuItems(node.id, { ...sourcePin, param }, point));
          });
        }
        const candidate = breakFields[index];
        if (!candidate) continue;
        const offset = breakFieldPinOffsetOf(node, candidate.field);
        if (!offset) continue;
        const tone = `nodes.${node.id}.output${candidate.field ? `.${candidate.field}` : ''}`;
        const connected = outputFieldReferenced ? outputFieldReferenced(node.id, candidate.field) : outputReferenced?.(node.id);
        const output = svgEl('circle', {
          class: `port port-out port-out-reference port-out-field data-tone-${dataTone(tone)}${connected ? ' connected' : ''}${state.referenceConnect && state.referenceConnect.nodeId === node.id ? ' active' : ''}`,
          style: `--data-tone:${dataToneColor(tone)}`,
          cx: offset.x,
          cy: offset.y,
          r: portRadius - 2.5,
          'data-node': node.id,
          'data-field': candidate.field,
        }, group);
        svgEl('path', {
          class: 'port-glyph port-glyph-data',
          style: `--data-tone:${dataToneColor(tone)}`,
          d: dataPinArrow(offset.x, offset.y, portRadius - 2.5),
        }, group);
        // 字段名贴在引脚左侧（UE 的 `X ○` 排法）。
        nodeCards.text(group, {
          className: 'port-label port-label-field',
          x: offset.x - 11,
          y: offset.y + 3.5,
          value: candidate.label,
          width: Math.max(64, nodeWidth - 64),
          size: 10,
          anchor: 'end',
        });
        svgEl('title', {}, output).textContent = `拆分输出：拖到别的节点的参数行绑定 ${candidate.ref}`;
        output.addEventListener('pointerdown', (event: any) => startReferenceConnection?.(event, node.id, undefined, candidate.field));
        output.addEventListener('contextmenu', (event: any) => {
          const point = openPortContextMenu(event);
          if (!point) return;
          showMenu(event.clientX, event.clientY, nodeReferencePortMenuItems ? nodeReferencePortMenuItems(node.id, point) : []);
        });
      }
    };
    if (node.type === 'break') renderBreakRows();
    else pins.forEach((pin, index) => {
      const kind = paramRowKindOf(pin, pin.definition);
      const row = paramRowGeometry({ nodeWidth, baseHeight, rowHeight, index, pinX: variablePinX, twoLine, boxedInline: fixedRows && !twoLine });
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
      svgEl('path', {
        class: `port-glyph port-glyph-data${invalid ? ' invalid' : ''}`,
        style: `--data-tone:${dataToneColor(dataKey)}`,
        d: dataPinArrow(row.portX, row.centerY, portRadius - 2),
      }, group);
      // 固定卡片左侧显示参数名，右侧显示可编辑值；复杂参数只显示摘要。
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
      const tupleCells = boxedRows && kind === 'tuple' ? paramTupleLength(pin.definition) ?? 0 : 0;
      const tupleWidth = tupleCells > 1 ? (row.hit.width - (tupleCells - 1) * PARAM_FIELD_GAP) / tupleCells : row.hit.width;
      const cellX = (index: number): number => row.hit.x + index * (tupleWidth + PARAM_FIELD_GAP);
      // 左右布局以摘要显示区域；旧双行布局仍保留四格显示。
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
      // 四坐标输入需要较宽的浮层；静止时热区仍只占右侧值框。
      const editorSpan = fixedRows && !twoLine && kind === 'rect'
        ? { x: row.labelX, y: fieldSpan.y, width: row.valueRight - row.labelX, height: fieldSpan.height }
        : fieldSpan;
      // 固定卡片的值区画成可见控件，行内浮层贴在对应矩形上。
      // 需要离开卡片去详情栏的行（对象/数组）用虚线框，其余都是实线输入框。
      if (boxedRows) {
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
      const fieldX = boxedRows ? row.hit.x + PARAM_FIELD_PADDING : row.valueLeft;
      // 右侧的 › 只占最后几个像素：值文字按实际渲染宽度让位，别把「60,120 200×80」这种
      // 刚好放得下的区域值提前截断。
      const caretGlyph = 6;
      const showsPickerCaret = opensPicker && kind !== 'rect';
      const caretSpace = boxedRows && showsPickerCaret ? caretGlyph : 0;
      // 颜色色块贴在值框右侧（与行内浮层里的取色块同位置）。
      const colorSwatch = kind === 'color'
        ? paramColorSwatch(pin.configured ? pin.value : pin.definition && pin.definition.default)
        : null;
      const swatchSpace = colorSwatch ? (boxedRows ? 22 : 14) : 0;
      const fieldPaddingRight = fixedRows && !twoLine && kind === 'rect' ? 3 : PARAM_FIELD_PADDING;
      const fieldWidth = Math.max(24, (boxedRows ? row.hit.width - PARAM_FIELD_PADDING - fieldPaddingRight : row.valueWidth) - caretSpace - swatchSpace);
      if (kind === 'boolean' && paramRowEditable(kind)) {
        // 有框值区的勾选框靠左，普通摘要行仍贴值区右侧。
        const checkX = boxedRows ? fieldX : row.valueRight - 11;
        // 勾选框按文字的光学中心对齐（10px 字的光学中心在基线上方 3.5px），不是压在基线上。
        const checkY = boxedRows ? row.valueY - 9 : row.centerY - 5.5;
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
        if (boxedRows) {
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
          x: boxedRows ? fieldX : row.valueRight,
          y: row.valueY,
          value: view.text,
          width: fieldWidth,
          size: 10,
          anchor: boxedRows ? 'start' : 'end',
        });
        valueText.style.pointerEvents = 'none';
        if (swatch) {
          svgEl('rect', {
            class: 'param-row-swatch',
            x: boxedRows ? row.hit.x + row.hit.width - 19 : row.valueRight - row.valueWidth + 2,
            y: boxedRows ? row.hit.y + 1 : row.centerY - 5,
            width: boxedRows ? 16 : 10,
            height: boxedRows ? 16 : 10,
            rx: boxedRows ? 3 : 2,
            fill: swatch,
          }, group).style.pointerEvents = 'none';
        }
        if (boxedRows && showsPickerCaret) {
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
      // 固定长度数组的每个小格独立命中：悬停只高亮鼠标所在的一格，点击也聚焦对应输入框。
      const valueHitCells = tupleCells > 1
        ? Array.from({ length: tupleCells }, (_item, cell) => ({ x: cellX(cell), width: tupleWidth, inputIndex: cell }))
        : [{ x: fieldSpan.x, width: fieldSpan.width, inputIndex: undefined as number | undefined }];
      for (const cell of valueHitCells) {
        const valueHit = svgEl('rect', {
          class: `param-row-hit tone-${view.tone}${boxedRows && opensPicker ? ' kind-picker' : ''}${targeted ? ' target' : ''}${invalid ? ' invalid' : ''}`,
          x: cell.x,
          y: fieldSpan.y,
          width: cell.width,
          height: fieldSpan.height,
          rx: 3,
          'data-node': node.id,
          'data-param': pin.param,
          ...(errorText ? { title: errorText } : {}),
        }, group);
        if (errorText) {
          const caption = svgEl('title', {}, valueHit);
          caption.textContent = errorText;
        }
        valueHit.addEventListener('pointerdown', (event: any) => {
          event.stopPropagation();
        });
        valueHit.addEventListener('click', (event: any) => {
          event.preventDefault();
          event.stopPropagation();
          const point = position(node);
          let inputIndex = cell.inputIndex;
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
            rect: { x: point.x + editorSpan.x, y: point.y + editorSpan.y, width: editorSpan.width, height: editorSpan.height },
            clientX: event.clientX,
            clientY: event.clientY,
            world: { x: point.x + fieldSpan.x, y: point.y + row.centerY },
            valueAlign: boxedRows ? 'left' : 'right',
            inputIndex,
          });
        });
        valueHit.addEventListener('contextmenu', (event: any) => {
          const point = openPortContextMenu(event);
          if (!point) return;
          const items = paramRowMenuItems ? paramRowMenuItems(node.id, pin, point) : nodeVariablePinMenuItems(node.id, pin, point);
          showMenu(event.clientX, event.clientY, items);
        });
      }
    });
    const decorators = Array.isArray(node.decorators) ? node.decorators : [];    decorators.forEach((decorator: any, index: number) => {
      const y = baseHeight + pinOffset + index * decoratorHeight;
      svgEl('line', { class: 'decorator-rule', x1: 0, y1: y, x2: nodeWidth, y2: y }, group);
      svgEl('text', { class: 'decorator-icon', x: 14, y: y + 15 }, group).textContent = '◇';
      nodeCards.text(group, { className: 'decorator-label', x: 32, y: y + 15, value: decoratorLabel(decorator), width: nodeWidth - 46, size: 10 });
    });
    // 值卡片（布尔判断 / 拆分）只有数据端点：顶部不画执行流入口箭头。
    // 它们的值通过右侧输出引用口被别的节点取用，一条悬空的入口箭头只会让人
    // 去找那条并不存在的父连线（父节点的线仍可拖到卡片顶边接上）。
    if (node.type !== 'root' && !isValueCardNode(node)) {
      const input = svgEl('circle', { class: 'port port-in', cx: nodeWidth / 2, cy: 0, r: portRadius, 'data-node': node.id }, group);
      // 箭头紧跟端口圆点：圆点只做几何与命中，可见形状交给它后面的箭头（CSS 用 `+` 做悬停联动）。
      svgEl('path', { class: 'port-glyph port-glyph-exec', d: execPinArrow(nodeWidth / 2, 0, portRadius) }, group);
      input.addEventListener('pointerdown', (event: any) => startConnectionFromInput(event, node.id));
      input.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeInputPortMenuItems(node.id, point));
      });
    }
    if (booleanInputNode) {
      // 布尔判断卡：比较形态是两个操作数口，整卡绑定形态只有一个布尔口（见 boolJudgeShape）。
      const inputPins = isBoolJudgeNode(node)
        ? allPins.filter((pin: any) => pin && (pin.param === 'condition' || pin.param === 'left' || pin.param === 'right'))
        : conditionPin ? [conditionPin] : [];
      for (const pin of inputPins) {
        const param = pin.param;
        const offset = expressionInputOffset(node, param);
        if (!offset) continue;
        const value = pin.value && typeof pin.value === 'object' && !Array.isArray(pin.value) ? pin.value as { ref?: unknown } : null;
        const reference = value && typeof value.ref === 'string' ? value.ref : '';
        const linked = Boolean(pin.variable || reference);
        const toneKey = pin.variable ? variableDataKey(pin.scope, pin.variable) : reference || parameterDataKey(node.id, param);
        const input = svgEl('circle', {
          class: `port port-variable type-${pin.type || (isBoolJudgeNode(node) ? 'any' : 'boolean')} ${isBoolJudgeNode(node) ? 'bool-judge-input' : 'condition-input'} data-tone-${dataTone(toneKey)}${linked ? ' bound configured' : pin.configured ? ' configured' : ''}`,
          style: `--data-tone:${dataToneColor(toneKey)}`,
          cx: offset.x, cy: offset.y, r: portRadius - 2,
          'data-node': node.id, 'data-param': param,
        }, group);
        svgEl('path', {
          class: `port-glyph port-glyph-data ${isBoolJudgeNode(node) ? 'bool-judge-input-glyph' : 'condition-input-glyph'}`,
          style: `--data-tone:${dataToneColor(toneKey)}`,
          d: dataPinArrow(offset.x, offset.y, portRadius - 2),
        }, group);
        const scope = pin.scope === 'variables' ? 'variables' : 'inputs';
        svgEl('title', {}, input).textContent = linked
          ? `${pin.label || param}：${pin.variable ? `← ${variableDisplayNameOf(scope, pin.variable)}` : `← ${reference}`}`
          : (isBoolJudgeNode(node)
            ? (param === 'condition' ? '布尔值输入：整卡取这个 bool 源，未绑定时用卡片自己的表达式' : `${pin.label || param}：比较表达式输入`)
            : 'bool 条件输入：为真走真口，为假走假口；未连接时使用判断条件表达式');
        const hit = svgEl('circle', {
          class: `variable-port-hit ${isBoolJudgeNode(node) ? 'bool-judge-input-hit' : 'condition-input-hit'}`,
          cx: offset.x, cy: offset.y, r: 10, 'data-node': node.id, 'data-param': param,
        }, group);
        hit.addEventListener('pointerdown', (event: any) => {
          event.stopPropagation();
          if (event.altKey) disconnectVariableFromPin(node.id, param);
          else startVariableConnectionFromPin(event, node.id, param);
        });
        hit.addEventListener('contextmenu', (event: any) => {
          const point = openPortContextMenu(event);
          if (!point) return;
          showMenu(event.clientX, event.clientY, nodeVariablePinMenuItems(node.id, {
            ...pin, param, label: pin.label || (param === 'left' ? '左值' : param === 'right' ? '右值' : '布尔条件'),
          }, point));
        });
      }
    }
    const renderGenericReferencePort = (title: string): void => {
      const output = svgEl('circle', {
        class: `port port-out port-out-reference data-tone-${dataTone(`nodes.${node.id}.output`)}${outputReferenced?.(node.id) ? ' connected' : ''}${state.referenceConnect && state.referenceConnect.nodeId === node.id ? ' active' : ''}`,
        style: `--data-tone:${dataToneColor(`nodes.${node.id}.output`)}`,
        cx: isValueCardNode(node) ? nodeWidth : referencePortX,
        cy: node.type === 'break' ? baseHeight + rowHeightOf(node) / 2 : isValueCardNode(node) ? nodeHeight(node) / 2 : referencePortY,
        r: portRadius - 2.5,
        'data-node': node.id,
      }, group);
      svgEl('path', {
        class: 'port-glyph port-glyph-data',
        style: `--data-tone:${dataToneColor(`nodes.${node.id}.output`)}`,
        d: dataPinArrow(
          isValueCardNode(node) ? nodeWidth : referencePortX,
          node.type === 'break' ? baseHeight + rowHeightOf(node) / 2 : isValueCardNode(node) ? nodeHeight(node) / 2 : referencePortY,
          portRadius - 2.5,
        ),
      }, group);
      svgEl('title', {}, output).textContent = title;
      output.addEventListener('pointerdown', (event: any) => startReferenceConnection?.(event, node.id));
      output.addEventListener('contextmenu', (event: any) => {
        const point = openPortContextMenu(event);
        if (!point) return;
        showMenu(event.clientX, event.clientY, nodeReferencePortMenuItems ? nodeReferencePortMenuItems(node.id, point) : []);
      });
    };
    if (node.type === 'task' || isValueCardNode(node)) {
      // 任务节点 / 布尔判断卡片 / 没有字段的拆分卡片：右侧一个通用输出引用口，
      // 拖到别的节点的参数行即可绑定 `nodes.<id>.output[.<字段>]`。
      // 拆分卡片的字段引脚排在行网格里（renderBreakRows），有引脚时不再画这个通用口。
      if (!(node.type === 'break' && breakFieldPinsOf(node).length)) {
        renderGenericReferencePort(node.type === 'bool_judge'
          ? '布尔判断输出：拖到别的节点的参数行绑定 nodes.<id>.output.value（boolean）'
          : node.type === 'break'
            ? '拆分输出：拖到别的节点的参数行绑定 nodes.<id>.output.<拆分字段>'
            : '节点输出：拖到别的节点的参数行绑定引用');
      }
    } else if (node.type === 'condition') {
      // 判断节点：底部左真右假两个执行输出口，每个口最多接一个子节点（没接就是空路径）。
      for (const port of CONDITION_PORT_ORDER) {
        const x = conditionPortOffset(nodeWidth, port);
        const connected = Boolean(conditionChildOf(node, port));
        const output = svgEl('circle', {
          class: `port port-out port-out-${port}${connected ? ' connected' : ''}`,
          cx: x, cy: height, r: portRadius, 'data-node': node.id, 'data-port': port,
        }, group);
        svgEl('path', { class: 'port-glyph port-glyph-exec', d: execPinArrow(x, height, portRadius) }, group);
        nodeCards.text(group, {
          className: 'port-label port-label-exec',
          x, y: height - 7, value: CONDITION_PORT_LABELS[port], width: 26, size: 9, anchor: 'middle',
        });
        const tip = svgEl('title', {}, output);
        tip.textContent = `${CONDITION_PORT_LABELS[port]}口：条件为${port === 'true' ? '真' : '假'}时执行这里接的子节点（拖线连接）`;
        output.addEventListener('pointerdown', (event: any) => startConnection(event, node.id, undefined, port));
        output.addEventListener('contextmenu', (event: any) => {
          const point = openPortContextMenu(event);
          if (!point) return;
          showMenu(event.clientX, event.clientY, nodeOutputPortMenuItems(node.id, point, port));
        });
      }
    } else {
      const output = svgEl('circle', { class: 'port port-out', cx: nodeWidth / 2, cy: height, r: portRadius, 'data-node': node.id }, group);
      svgEl('path', { class: 'port-glyph port-glyph-exec', d: execPinArrow(nodeWidth / 2, height, portRadius) }, group);
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
          ...(collapseIntoCustomType ? [{ label: '收成自定义类型', title: '把这一个节点的配置变成可复用的 x- 类型（字面量参数进预设，引用不进）', run: () => collapseIntoCustomType() }] : []),
          { label: '复制 (Ctrl+C)', run: () => copySelection() },
          { label: '剪切 (Ctrl+X)', run: () => cutSelection() },
          'separator',
          { label: '删除节点', danger: true, run: () => deleteSelection() },
        ]);
      });
    }
    appendSelectionOutline(group, svgEl, nodeWidth, height, 5);
    return group;
  }

  return { renderNode, patchNodeRuntime };
}
