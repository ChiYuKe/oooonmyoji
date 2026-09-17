/**
 * 画布入口组装。
 *
 * 原 `workflow-editor.js` 闭包已全部迁移为 TS 模块；本文件只按既有依赖顺序组装
 * 状态、渲染、交互与壳层通信，并把编辑器命令出口暴露为 `window.__btEditor`。
 *
 */
import { createCanvasEdges } from './canvas/edges';
import { createCanvasMinimap } from './canvas/minimap';
import { createCanvasViewport } from './canvas/viewport';
import { createEditorExport } from './export';
import { createAssetActions } from './interactions/asset-actions';
import { createAssetBrowser } from './interactions/asset-browser';
import { createCanvasConnections } from './interactions/connections';
import { createCanvasHitTest } from './interactions/hit-test';
import { createInputBridge } from './interactions/input-bridge';
import { createCanvasInlineEditor } from './interactions/inline-editor';
import { createCanvasPointer } from './interactions/pointer';
import { createCanvasPortMenu } from './interactions/port-menu';
import { createEditorRoiPicker } from './interactions/roi-picker';
import { createTemplateCheck } from './interactions/template-check';
import { createWorkflowBrowser } from './interactions/workflow-browser';
import { createCompositeInspector } from './inspector/composite-inspector';
import { createDetailInspectors } from './inspector/detail-inspectors';
import { createInspectorPanel } from './inspector/panel';
import { createParameterControls } from './inspector/parameter-controls';
import { createVariableInspectors } from './inspector/variable-inspectors';
import { createCanvasWorkflowModel } from './model/canvas-workflow-model';
import { createCanvasReferences } from './model/references';
import { createEditorSchema } from './model/schema';
import { createSidebarState } from './model/sidebar-state';
import { createSubworkflowHelpers } from './model/subworkflow';
import { createVariableSystem } from './model/variable-system';
import { createWorkflowModel } from './model/workflow-model';
import * as cardValues from './render/card-values';
import { createAssetPreview } from './render/asset-preview';
import { createCanvasCards } from './render/cards';
import { createNodeCardRenderer } from './render/node-card';
import { createNodeCards } from './render/node-cards';
import { createRenderEntry } from './render/render-entry';
import { createCanvasMessages } from './shell/messages';
import { createCanvasCommands } from './state/commands';
import { createEditorCommandDispatch } from './state/editor-command-dispatch';
import { createEditorCommands } from './state/editor-commands';
import { createEditorStatus } from './state/editor-status';
import { createEditorHistory } from './state/history';
import { createRunEvents } from './state/run-events';
import { createCanvasState } from './state/canvas-state';
import { createEditorToolbar } from './toolbar';
import { createCanvasHelpers } from './ui/canvas-helpers';
import { createUi } from './ui/elements';
import { ACTION_LABELS, actionLabel, enumOption, fieldLabel } from './ui/labels';
import { createCanvasOverlays, type MenuEntry } from './ui/overlays';
import type { CanvasBridge } from './bridge';

/** Resolve circular wiring only when a callback runs, while preserving its signature. */
function late<Args extends unknown[], Result>(get: () => (...args: Args) => Result): (...args: Args) => Result {
  return (...args) => get()(...args);
}

export function startCanvasEditor(bridge: CanvasBridge): void {
  const vscode = bridge.editorApi();
  const UI = createUi();
  const VariableSystem = createVariableSystem();
  const nodeCards = createNodeCards();
  const NS = 'http://www.w3.org/2000/svg';
  const NODE_W = 260;
  const BASE_H = 96;
  const DECO_H = 22;
  const PORT_R = 7;
  const RUN_CARD_W = 250;
  const RUN_CARD_BASE_H = 78;
  const RUN_VARIABLE_H = 24;
  const RUN_CARD_GAP_X = 48;
  const RUN_CARD_GAP_Y = 92;
  const PREVIEW = { x: 174, y: 56, width: 72, height: 30 };
  const VARIABLE_CARD_W = 168;
  const VARIABLE_CARD_H = 58;
  const VARIABLE_CARD_PORT_Y = 29;
  const VARIABLE_PIN_X = 10;
  const VARIABLE_DRAG_MIME = 'application/x-onmyoji-variable';
  const TYPES = ['root', 'selector', 'sequence', 'simple_parallel', 'parallel', 'repeat_until', 'branch', 'switch', 'instance_parallel', 'task'];
  const TYPE_LABEL = { root: 'ROOT', selector: 'SELECTOR', sequence: 'SEQUENCE', simple_parallel: 'SIMPLE PARALLEL', parallel: 'PARALLEL', repeat_until: 'REPEAT UNTIL', branch: 'BRANCH', switch: 'SWITCH', instance_parallel: 'INSTANCE PARALLEL', task: 'TASK' };
  const TYPE_NAMES = { root: '根节点', task: '任务', selector: '选择器', sequence: '顺序', simple_parallel: '简单并行', parallel: '并行', repeat_until: '循环直到', branch: '条件分支', switch: '多路开关', instance_parallel: '实例并行' };
  const TYPE_ICON = { root: '◆', selector: '?', sequence: '→', simple_parallel: '∥', parallel: '⇉', repeat_until: '↻', branch: '⑂', switch: '⎇', instance_parallel: '⇶', task: '▣' };
  const RUN_LABEL = {
    running: '运行中', succeeded: '已完成', matched: '已匹配', not_matched: '未匹配',
    failed: '失败', cancelled: '已取消', branch_miss: '分支跳过',
  };
  const state = createCanvasState();

  // 统一 tooltip 由 public/shared/tooltip.js 提供；嵌入时把提示位置转发给父窗口。
  if (window.StudioTooltip) {
    window.StudioTooltip.install({
      bridge: 'send',
      embedded: 'auto',
      ariaLabelTags: /^(BUTTON|INPUT|SELECT)$/,
      suppressSelector: '[data-asset-preview]',
    });
  }


  const $ = (id: string): HTMLElement => document.getElementById(id)!;
  const graph = document.querySelector<SVGSVGElement>('#graph')!;
  const wrap = $('canvas-wrap');
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const Overlays = createCanvasOverlays({ el: (tag, className, text) => el(tag, className, text), $: (id) => $(id) });
  const { showMenu, hideMenus, openLightbox, toast } = Overlays;
  const Model = createWorkflowModel(state);
  const { nodes, nodeById, layout, position } = Model;
  const catalogByName = (name: string) => state.catalog.find((item) => item.name === name) || null;
  const workflowNodeInputs = (node: { [key: string]: unknown }) => subWorkflowRef(node) ? workflowInputs(subWorkflowRef(node)) : [];
  const nodeHeight = (node: { id?: string; decorators?: unknown[] }) => BASE_H
    + nodeVariablePins(node).length * RUN_VARIABLE_H
    + (Array.isArray(node.decorators) ? node.decorators.length * DECO_H : 0);

  const { variableCards, variableLinks, nextVariableCardId, variableCardList, clearVariableCardSelection, setVariableCardSelection } = Model;
  const { displayNameOfDefinition, variableDisplayNameOf, inputParameterMetadata } = Model;

  const CanvasWorkflowModel = createCanvasWorkflowModel({
    state, Model, VariableSystem, nodes, position, variableCards,
    compatibleRefType: late(() => compatibleRefType),
    definitionSchema: late(() => definitionSchema),
    nodeHeight,
    baseHeight: BASE_H, nodeWidth: NODE_W, decoHeight: DECO_H,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
    variableCardPortY: VARIABLE_CARD_PORT_Y, variablePinX: VARIABLE_PIN_X,
    runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H, runVariableHeight: RUN_VARIABLE_H,
    runCardGapX: RUN_CARD_GAP_X, runCardGapY: RUN_CARD_GAP_Y,
    catalogByName, fieldLabel: (name) => fieldLabel(name), workflowNodeInputs, nextVariableCardId,
    workflowReference: late(() => workflowReference),
  });
  const {
    variableTypeOf, nodeVariablePins, collectNodeCardVariableRefs, variableCardPosition, inputParameterNames,
    paramRowsExpanded,
    syncLegacyInputParameters, syncLegacyVariableCards, variablePinPosition, variableCompatibleWithPin,
    variableCompatibleWithInstanceInput, workflowDescriptor, workflowInputs, instanceRunCards, instanceRunInputPosition,
  } = CanvasWorkflowModel;

  function svgEl(tag: string, attrs: Record<string, unknown>, parent?: Element): SVGElement {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    }
    if (parent) parent.appendChild(element);
    return element;
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K];
  function el(tag: string, className?: string, text?: string): HTMLElement;
  function el(tag: string, className?: string, text?: string): HTMLElement {
    if (tag === 'button') return UI.button({ label: text, className });
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  const EditorStatus = createEditorStatus({ state, vscode, $ });
  const { setDirty, currentInspectorSelection, requestInspector } = EditorStatus;

  const StudioSidebarState = createSidebarState({ state, collectNodeCardVariableRefs, nodes, currentInspectorSelection, vscode });
  const postSidebarState = late(() => StudioSidebarState.postSidebarState);

  const History = createEditorHistory({
    state,
    cleanupReleased: (raw, before) => raw ? VariableSystem.cleanupReleased(raw, before) : [],
    clearVariableCardSelection,
    nodeById,
    normalizeRaw: (value) => normalizeRaw(value),
    setDirty: (value) => setDirty(value),
    render: () => render(),
  });
  const { snapshot, mutate, restore, replaceDocument, undo, redo } = History;

  const Commands = createCanvasCommands({
    state, nodes, nodeById, layout, mutate, clone, toast: (message, error) => toast(message, error), worldPoint: (event) => worldPoint(event),
    wrap, nodeWidth: NODE_W, baseHeight: BASE_H,
  });
  const { nextId, parentOf, descendants, canConnect, connect, disconnect, buildNode, addNode, deleteSelection, selectionTreeIds, copySelection, cutSelection, pasteClipboard } = Commands;

  const Viewport = createCanvasViewport({
    state, nodes, position, layout, mutate, instanceRunCards, variableCardList, nodeHeight,
    wrap, minimap: () => $('minimap'), render: late(() => render),
    nodeWidth: NODE_W, baseHeight: BASE_H, runCardWidth: RUN_CARD_W,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { autoLayout, ensureLayout, bounds, fitView, zoomAt, worldPoint, bezier } = Viewport;

  const Edges = createCanvasEdges({
    state, svgEl, bezier, nodes, nodeById, position, nodeHeight, instanceRunCards, instanceRunInputPosition,
    variableCardList, nodeVariablePins, variablePinPosition, disconnect,
    disconnectVariableFromPin: late(() => disconnectVariableFromPin),
    disconnectVariableFromInstanceInput: late(() => disconnectVariableFromInstanceInput),
    mutate, requestInspector, render: () => render(),
    worldPoint, captureConnectionPointer: (event) => captureConnectionPointer(event),
    nodeWidth: NODE_W, runCardWidth: RUN_CARD_W, baseHeight: BASE_H, runVariableHeight: RUN_VARIABLE_H,
    variableCardWidth: VARIABLE_CARD_W, variableCardPortY: VARIABLE_CARD_PORT_Y, variablePinX: VARIABLE_PIN_X,
  });
  const { bindVariableEdgeQuickDisconnect, renderVariableEdges, renderEdge, renderInstanceRunEdge, renderConnection, renderVariableConnection } = Edges;

  // 行内参数编辑器在下方创建（依赖参数控件），这里先用占位保持重绘收尾的调用顺序。
  let refreshInlineEditor: () => void = () => {};
  const RenderEntry = createRenderEntry({
    state, $, graph, wrap, svgEl, UI, nodes, nodeById, position, nodeHeight, instanceRunCards, variableCardList,
    renderNode: late(() => renderNode),
    renderInstanceRunCard: late(() => renderInstanceRunCard),
    renderVariableCard: late(() => renderVariableCard),
    renderEdge, renderInstanceRunEdge, renderConnection,
    renderVariableConnection, renderVariableEdges,
    renderMinimap: late(() => renderMinimap),
    renderInspector: late(() => renderInspector),
    postSidebarState, updateIssueBadge: late(() => updateIssueBadge),
    ensureLayout, syncLegacyInputParameters, syncLegacyVariableCards, setDirty, nodeWidth: NODE_W,
    afterRender: () => refreshInlineEditor(),
  });
  const { render, focusNode } = RenderEntry;

  const AssetPreview = createAssetPreview({ state, $ });
  const {
    templatePreview, assetPreviewForPath, hideAssetPathPreview, showAssetPathPreview, bindAssetPreview, bindAssetPathPreview,
  } = AssetPreview;

  const CardValues = cardValues;
  const { nodeCardSummary, compactValue, workflowInputVariableValue } = CardValues;
  const runtimeInstanceLabel = (instanceId: string, fallback?: string) => CardValues.instanceLabel(instanceId, state.instances, fallback);

  const Cards = createCanvasCards({
    state, svgEl, nodeCards: nodeCards, displayNameOfDefinition, assetPreviewForPath, bindAssetPathPreview,
    disconnectVariableFromInstanceInput: late(() => disconnectVariableFromInstanceInput),
    startVariableConnectionFromInstanceInput: late(() => startVariableConnectionFromInstanceInput),
    startVariableConnectionFromCard: late(() => startVariableConnectionFromCard),
    openPortContextMenu: late(() => openPortContextMenu), showMenu, instanceRunPinMenuItems: late(() => instanceRunPinMenuItems), variableCardPortMenuItems: late(() => variableCardPortMenuItems), requestInspector,
    requestOpenWorkflowReference: late(() => requestOpenWorkflowReference), render, contextMenuSuppressedByPan: () => contextMenuSuppressedByPan(),
    removeInstanceRun: late(() => removeInstanceRun), removeVariableCard: late(() => removeVariableCard), setVariableCardSelection, worldPoint, snapshot,
    runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H, runVariableHeight: RUN_VARIABLE_H, portRadius: PORT_R,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H, variableCardPortY: VARIABLE_CARD_PORT_Y,
  });
  const { renderInstanceRunCard, renderVariableCard, registerCardPress } = Cards;

  const NodeCard = createNodeCardRenderer({
    state, svgEl, nodeCards: nodeCards, position, nodeHeight,
    subWorkflowRef: late(() => subWorkflowRef), templatePreview,
    compositeSubtitle: late(() => compositeSubtitle), variableDisplayNameOf,
    decoratorLabel: late(() => decoratorLabel), nodeVariablePins, openLightbox,
    disconnectVariableFromPin: late(() => disconnectVariableFromPin),
    startVariableConnectionFromPin: late(() => startVariableConnectionFromPin),
    openPortContextMenu: late(() => openPortContextMenu), showMenu,
    nodeVariablePinMenuItems: late(() => nodeVariablePinMenuItems),
    nodeInputPortMenuItems: late(() => nodeInputPortMenuItems),
    nodeOutputPortMenuItems: late(() => nodeOutputPortMenuItems),
    startConnectionFromInput: (event, id) => startConnectionFromInput(event, id),
    startConnection: (event, id) => startConnection(event, id),
    startNodeDrag: (event, id) => startNodeDrag(event, id),
    registerCardPress, requestInspector, requestOpenSubWorkflow: late(() => requestOpenSubWorkflow), render,
    contextMenuSuppressedByPan: () => contextMenuSuppressedByPan(),
    copySelection, cutSelection, deleteSelection,
    paramRowInfo, toggleParamRows, paramRowMenuItems,
    openParamEditor: late(() => InlineEditor.openParamEditor),
    compactValue,
    typeIcons: TYPE_ICON, typeNames: TYPE_NAMES, runLabels: RUN_LABEL,
    nodeWidth: NODE_W, baseHeight: BASE_H, portRadius: PORT_R, decoratorHeight: DECO_H,
    runVariableHeight: RUN_VARIABLE_H, variablePinX: VARIABLE_PIN_X, preview: PREVIEW,
  });
  const { renderNode } = NodeCard;

  const { variableValueSummary } = CardValues;

  const EditorCommands = createEditorCommands({
    state, mutate, nodeById, nodes, layout, position, clone, toast,
    variableCards, variableLinks, nextVariableCardId,
    parameterLiteralCache: late(() => parameterLiteralCache),
    parameterLiteralCacheKey: late(() => parameterLiteralCacheKey),
    setVariableCardSelection,
    variableInputTargetAt: late(() => variableInputTargetAt),
    instanceRunCards, displayNameOfDefinition, wrap,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
    variableCardPortY: VARIABLE_CARD_PORT_Y, nodeWidth: NODE_W, runCardWidth: RUN_CARD_W,
  });
  const {
    removeVariableCard, releasePinBinding, removeVariableCards, placeVariableCard, addVariableCardCommand,
    renameNode, changeNodeType,
  } = EditorCommands;

  /** 若节点是子流程 task（workflow.run），返回子工作流引用，否则返回空字符串。 */
  const SubworkflowHelpers = createSubworkflowHelpers({
    state, vscode, nodeById, $, showMenu, compactValue,
    isBindingValue: late(() => isBindingValue),
  });
  const {
    subWorkflowRef, requestOpenSubWorkflow, requestOpenWorkflowReference, compositeSubtitle, decoratorLabel, conditionSummary,
  } = SubworkflowHelpers;

  const HitTest = createCanvasHitTest({
    state, worldPoint, nodes, nodeById, position, nodeHeight, nodeVariablePins,
    variableCompatibleWithPin, variableCompatibleWithInstanceInput, instanceRunCards,
    instanceRunInputPosition, variableCardList,
    portRadius: PORT_R, nodeWidth: NODE_W, baseHeight: BASE_H, runVariableHeight: RUN_VARIABLE_H,
    variablePinX: VARIABLE_PIN_X, runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H, variableCardPortY: VARIABLE_CARD_PORT_Y,
  });
  const { connectionTargetAt, variablePinTargetAt, instanceRunInputTargetAt, variableInputTargetAt, variableCardTargetAt, variableCardTargetAtInstanceInput, variableConnectionTargetAt } = HitTest;

  const Connections = createCanvasConnections({
    state, graph, worldPoint, render, snapshot, mutate, connect, disconnect, variableConnectionTargetAt,
    nodeById, instanceRunCards, variableCompatibleWithPin, variableCompatibleWithInstanceInput,
    variableLinks, displayNameOfDefinition, variableDisplayNameOf, toast: (message, error) => toast(message, error),
  });
  const {
    startConnection, startConnectionFromInput, captureConnectionPointer, releaseConnectionPointer,
    cancelConnection, finishConnection, startVariableConnectionFromCard, startVariableConnectionFromPin,
    startVariableConnectionFromInstanceInput, cancelVariableConnection, finishVariableConnection,
    connectVariableToPin, disconnectVariableFromPin, connectVariableToInstanceInput, disconnectVariableFromInstanceInput,
  } = Connections;

  const Pointer = createCanvasPointer({
    state, graph, wrap, worldPoint, position, nodeById, nodes, nodeHeight, snapshot, render, hideMenus,
    clearVariableCardSelection, layout, variableCards, variableCardList, connectionTargetAt,
    variableConnectionTargetAt, finishConnection, cancelConnection, finishVariableConnection, setDirty,
    nodeWidth: NODE_W, variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { startNodeDrag, onPointerDown, autoPan, onPointerMove, onPointerUp, contextMenuSuppressedByPan } = Pointer;

  const Minimap = createCanvasMinimap({
    state, $, svgEl, bounds, nodes, position, nodeHeight, instanceRunCards, variableCardList,
    wrap, nodeWidth: NODE_W, runCardWidth: RUN_CARD_W, variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { renderMinimap } = Minimap;

  const CanvasHelpers = createCanvasHelpers({
    state, $, nodes, worldPoint, render: late(() => render),
    contextMenuSuppressedByPan: () => contextMenuSuppressedByPan(),
    setVariableCardSelection, wrap,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { updateIssueBadge, localIssueCount, openPortContextMenu, focusVariableCard } = CanvasHelpers;

  /** 节点输入端口（顶部）右键菜单：UE 风格——连线、断开链接（Break Link）、插入节点（Reroute）。 */
  const PortMenu = createCanvasPortMenu({
    state, startConnectionFromInput: (event, id, point) => startConnectionFromInput(event, id, point),
    startConnection: (event, id, point) => startConnection(event, id, point),
    startVariableConnectionFromPin: (event, id, param, point) => startVariableConnectionFromPin(event, id, param, point),
    startVariableConnectionFromInstanceInput: (event, id, runIndex, param, point) => startVariableConnectionFromInstanceInput(event, id, runIndex, param, point),
    startVariableConnectionFromCard: (event, scope, name, cardId, point) => startVariableConnectionFromCard(event, scope, name, cardId, point),
    parentOf, buildNode, canConnect, connect, disconnect, mutate, nodeById, position, layout, nodes,
    nodeVariablePins, variableCards, variableLinks, nextVariableCardId, variableCardList, variableCardPosition,
    focusVariableCard, placeVariableCard, disconnectVariableFromPin: late(() => disconnectVariableFromPin),
    disconnectVariableFromInstanceInput: late(() => disconnectVariableFromInstanceInput),
    removeVariableCard, fieldLabel: (param) => fieldLabel(param), toast: (message, error) => toast(message, error),
    typeNames: TYPE_NAMES, nodeWidth: NODE_W,
  });
  const {
    nodeInputPortMenuItems, nodeOutputPortMenuItems, nodeVariablePinMenuItems, instanceRunPinMenuItems,
    variableCardPortMenuItems, insertNodeAbove, addChildNode, promotePinToVariable, copyVariableReference,
  } = PortMenu;

  const InspectorPanel = createInspectorPanel({
    state, UI, $, el, nodeById, hideAssetPathPreview, types: TYPES, typeNames: TYPE_NAMES, typeLabels: TYPE_LABEL,
    renameNode: late(() => renameNode),
    changeNodeType: late(() => changeNodeType),
    mutate: late(() => mutate),
    deleteSelection: late(() => deleteSelection),
    renderTaskInspector: late(() => renderTaskInspector),
    renderCompositeInspector: late(() => renderCompositeInspector),
    renderDecorators: late(() => renderDecorators),
    renderWorkflowInspector: late(() => renderWorkflowInspector),
    renderVariablesInspector: late(() => renderVariablesInspector),
    renderInstanceRunInspector: late(() => renderInstanceRunInspector),
    renderEdgeInspector: late(() => renderEdgeInspector),
  });
  const {
    clearInspector, section, field, textInput, selectInput, segmentedInput, checkbox, groupSections, renderInspector,
  } = InspectorPanel;

  const StudioToolbar = createEditorToolbar({ state, $, el, UI, vscode, showMenu, zoomAt, setDirty, toast, nodes, focusNode });
  const renderInstancePicker = late(() => StudioToolbar.renderInstancePicker);
  const renderWorkflowPicker = late(() => StudioToolbar.renderWorkflowPicker);
  const renderWorkflowBreadcrumb = late(() => StudioToolbar.renderWorkflowBreadcrumb);
  const bindToolbar = late(() => StudioToolbar.bindToolbar);
  const searchNodeByName = late(() => StudioToolbar.searchNodeByName);


  const DetailInspectors = createDetailInspectors({
    state, mutate, UI, el, $, nodeById, catalogByName, clone,
    defaultValue: late(() => defaultValue),
    referenceLabel: late(() => referenceLabel),
    enumOption: late(() => enumOption),
    runtimeInstanceLabel, workflowInputs,
    workflowReference: late(() => workflowReference),
    requestOpenWorkflowReference,
    definitionSchema: late(() => definitionSchema),
    compatibleRefType: late(() => compatibleRefType),
    actionDropdown: late(() => actionDropdown),
    renderParameter: late(() => renderParameter),
    complexValueControl: late(() => complexValueControl),
    displayNameOfDefinition, compactValue, renderInspector,
    selectInput, textInput, field, section, clearInspector,
  });
  const {
    renderTaskInspector, removeInstanceRun, parentVariableRefs, runInputLiteralControl, rectLiteralControl,
    changePublicInputMode, renderPublicWorkflowInputs, renderInstanceRunInspector,
  } = DetailInspectors;

  const StudioSchema = createEditorSchema();
  const definitionSchema = late(() => StudioSchema.definitionSchema);
  const compatibleRefType = late(() => StudioSchema.compatibleRefType);
  const appendNestedRefs = late(() => StudioSchema.appendNestedRefs);

  const References = createCanvasReferences({
    state, clone, nodes, definitionSchema, compatibleRefType, appendNestedRefs,
    variableSystem: VariableSystem, catalogByName,
  });
  const {
    defaultValue, guaranteedOutputIds, availableOutputIds, possibleOutputIdsInSubtree,
    possiblyAvailableOutputIds, allRefs, referenceLabel,
  } = References;

  const ParameterControls = createParameterControls({
    state, mutate, UI, el, $, clone, toast, defaultValue, allRefs, referenceLabel,
    fieldLabel, enumOption, actionLabel, bindAssetPreview, assetPreviewForPath,
    assetPathStatus: late(() => assetPathStatus),
    openAssetBrowser: late(() => openAssetBrowser),
    requestRoi: late(() => requestRoi),
    inputParameterMetadata, VariableSystem,
    ACTION_LABELS,
    requestTemplateCheck: late(() => requestTemplateCheck),
    requestTemplateReplacement: late(() => requestTemplateReplacement),
    valueBindingMenu: late(() => valueBindingMenu), variableLinks,
    renderInspector, appendMissingAssetAction: late(() => appendMissingAssetAction),
    openWorkflowBrowser: late(() => openWorkflowBrowser),
    selectInput, textInput, checkbox, segmentedInput, field,
  });
  const {
    actionDropdown, renderParameter, parameterLiteralCache, parameterLiteralCacheKey, rememberParameterLiteral,
    restoreParameterLiteral, clearParameterLiteralCache, convertWaitTemplateToAny, convertWaitAnyToTemplate,
    literalControl, paramJsonModes, cardExpansion, jsonModeToggle, complexValueControl, scalarDefinitionUsable,
    isBindingValue, structuredControl, objectFieldsControl, bindingControl, nestedValueControl, scalarValueControl,
    tupleControl, scalarArrayControl, itemDefaultValue, objectArrayControl, objectArraySummary, iconButton,
    ICON_SVG, iconSvg, addRowButton, CONDITION_OPERATORS, CONDITION_GROUP_OPERATORS, CONDITION_UNARY_OPERATORS,
    conditionControl, conditionOperatorLabel, conditionOperatorDefault, conditionOperandControl,
    conditionLiteralDefault, conditionParseLiteral, nodeChildrenOptions,
  } = ParameterControls;

  /** 卡片参数行的折叠状态：默认只显示「必填 + 已配置」，箭头展开动作定义里的全部参数。 */
  function paramRowInfo(node: any): { expanded: boolean; total: number; hidden: number } {
    const spec = node && node.action ? catalogByName(node.action) : null;
    const total = spec && spec.parameters ? Object.keys(spec.parameters).length : 0;
    const expanded = paramRowsExpanded().has(node && node.id);
    const shown = nodeVariablePins(node).length;
    return { expanded, total, hidden: Math.max(0, total - shown) };
  }

  function toggleParamRows(nodeId: string): void {
    const expanded = paramRowsExpanded();
    if (expanded.has(nodeId)) expanded.delete(nodeId);
    else expanded.add(nodeId);
    render();
  }

  const InlineEditor = createCanvasInlineEditor({
    state, wrap, el, mutate, clearParameterLiteralCache, rememberParameterLiteral, variableLinks,
    showMenu, nodeVariablePinMenuItems: late(() => nodeVariablePinMenuItems), requestInspector,
    toast: (message, error) => toast(message, error), enumOption, fieldLabel,
  });
  const { openParamEditor, closeInlineEditor, setParamLiteral } = InlineEditor;
  refreshInlineEditor = InlineEditor.refreshInlineEditor;

  /** 参数行右键：保留端口菜单（绑定/提升为变量），再补上字面量与详情栏入口。 */
  function paramRowMenuItems(nodeId: string, pin: any, point: { x: number; y: number }): MenuEntry[] {
    const node = nodeById(nodeId);
    const items: MenuEntry[] = nodeVariablePinMenuItems(nodeId, pin, point);
    items.push('separator');
    if (pin && pin.configured) {
      items.push({ label: '恢复默认值', run: () => { if (node) setParamLiteral(node, String(pin.param), undefined); } });
    }
    items.push({ label: '在详情栏编辑', run: () => requestInspector({ kind: 'node', nodeId }) });
    return items;
  }

  const StudioCompositeInspector = createCompositeInspector({ el, section, field, selectInput, checkbox, segmentedInput, textInput, iconButton, addRowButton, conditionControl, conditionOperandControl, conditionParseLiteral, nodeChildrenOptions, nodeById, mutate, disconnect, runtimeInstanceLabel, removeInstanceRun, workflowInputs, render, state, decoratorLabel, isBindingValue, clone, allRefs, referenceLabel, valueBindingMenu: late(() => valueBindingMenu), toast, UI });
  const renderCompositeInspector = late(() => StudioCompositeInspector.renderCompositeInspector);
  const renderDecorators = late(() => StudioCompositeInspector.renderDecorators);

  const VariableInspectors = createVariableInspectors({
    state, mutate, UI, el, $, nodeById, clone, toast,
    defaultValue: late(() => defaultValue),
    allRefs: late(() => allRefs),
    referenceLabel: late(() => referenceLabel),
    fieldLabel, disconnect, bindAssetPreview,
    openAssetBrowser: late(() => openAssetBrowser),
    variableCards, variableLinks, clearVariableCardSelection, VariableSystem,
    selectInput, textInput, checkbox, field, section, clearInspector,
  });
  const {
    renderEdgeInspector, renderLimitControl, renderWorkflowInspector, sameDefinitionValue, definitionAcceptsValue,
    changeDefinitionType, initialDefinitionValue, definitionValueControl, variableReferenceCount, convertInputToVariable,
    removeVariable, addVariable, renderVariablesInspector, renameVariable, variableDisplayName, syncExposedInput,
    valueBindingMenu,
  } = VariableInspectors;

  const StudioExport = createEditorExport({ state, graph, vscode, bounds, wrap, toast, NS });
  const exportFullCanvasImage = late(() => StudioExport.exportFullCanvasImage);
  const setExportBusy = late(() => StudioExport.setExportBusy);
  const collectExportTemplatePaths = late(() => StudioExport.collectExportTemplatePaths);
  const applyInlineThumbnails = late(() => StudioExport.applyInlineThumbnails);

  const AssetActions = createAssetActions({
    state, $, el, vscode,
    requestTemplateReplacement: late(() => requestTemplateReplacement),
  });
  const { normalizedAssetPath, assetPathStatus, requestAssetInventory, appendMissingAssetAction, requestRoi } = AssetActions;

  const StudioTemplateCheck = createTemplateCheck({ state, $, el, nodeById, catalogByName, clone, vscode, toast });
  const requestTemplateCheck = late(() => StudioTemplateCheck.requestTemplateCheck);
  const closeTemplateCheck = late(() => StudioTemplateCheck.closeTemplateCheck);
  const renderTemplateCheck = late(() => StudioTemplateCheck.renderTemplateCheck);

  const StudioAssetBrowser = createAssetBrowser({ state, $, el, mutate, nodeById, toast, vscode, requestRoi });
  const openAssetBrowser = late(() => StudioAssetBrowser.openAssetBrowser);
  const closeAssetBrowser = late(() => StudioAssetBrowser.closeAssetBrowser);
  const renderAssetBrowser = late(() => StudioAssetBrowser.renderAssetBrowser);
  const restoreAssetBrowserAfterRoi = late(() => StudioAssetBrowser.restoreAssetBrowserAfterRoi);
  const requestTemplateReplacement = late(() => StudioAssetBrowser.requestTemplateReplacement);

  const StudioWorkflowBrowser = createWorkflowBrowser({ state, $, el, nodeById, mutate, toast });
  const workflowReference = late(() => StudioWorkflowBrowser.workflowReference);
  const openWorkflowBrowser = late(() => StudioWorkflowBrowser.openWorkflowBrowser);
  const closeWorkflowBrowser = late(() => StudioWorkflowBrowser.closeWorkflowBrowser);

  const StudioRoiPicker = createEditorRoiPicker({ state, $, el, mutate, vscode, toast, nodeById, restoreAssetBrowserAfterRoi });
  const openRoiPicker = late(() => StudioRoiPicker.openRoiPicker);

  const RunEvents = createRunEvents({
    state, nodes, nodeById, clone, render, deleteSelection, removeVariableCards, removeVariableCard,
    removeInstanceRun, removeVariable,
  });
  const { handleRunEvent, normalizeRaw, deleteCurrentSelection } = RunEvents;

  const EditorCommandDispatch = createEditorCommandDispatch({
    state, mutate, nodes, nodeById, undo, redo, fitView, autoLayout, copySelection, cutSelection,
    pasteClipboard, deleteSelection, addNode, render, focusNode, searchNodeByName, exportFullCanvasImage,
    addVariable, clearVariableCardSelection, deleteCurrentSelection, renderInspector, addVariableCardCommand,
    VariableSystem,
  });
  const { executeEditorCommand } = EditorCommandDispatch;

  graph.addEventListener('mousedown', onPointerDown);
  graph.addEventListener('mousemove', onPointerMove);
  graph.addEventListener('mouseup', onPointerUp);
  graph.addEventListener('mousemove', (event) => { state.mouse = worldPoint(event); });
  graph.addEventListener('pointermove', (event) => { if (state.connect || state.variableConnect) onPointerMove(event); });
  graph.addEventListener('pointerup', (event) => { if (state.connect || state.variableConnect) onPointerUp(event); });
  graph.addEventListener('pointercancel', () => { cancelConnection(); cancelVariableConnection(); });
  graph.addEventListener('mouseleave', (event) => { if (state.drag || state.connect || state.variableConnect) onPointerMove(event); });
  graph.addEventListener('wheel', (event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY); }, { passive: false });
  graph.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (contextMenuSuppressedByPan()) return;
    const point = worldPoint(event);
    const items: MenuEntry[] = [
      { label: '＋ Task', run: () => addNode('task', point) }, { label: '＋ Selector', run: () => addNode('selector', point) },
      { label: '＋ Sequence', run: () => addNode('sequence', point) }, { label: '＋ Simple Parallel', run: () => addNode('simple_parallel', point) },
      { label: '＋ Parallel', run: () => addNode('parallel', point) }, { label: '＋ Repeat Until', run: () => addNode('repeat_until', point) },
      { label: '＋ Branch', run: () => addNode('branch', point) }, { label: '＋ Switch', run: () => addNode('switch', point) },
      { label: '＋ Instance Parallel', run: () => addNode('instance_parallel', point) },
      'separator',
    ];
    if (state.selected.size > 0) {
      items.push(
        { label: '复制 (Ctrl+C)', run: () => copySelection() },
        { label: '剪切 (Ctrl+X)', run: () => cutSelection() },
      );
    }
    if (state.clipboard && state.clipboard.length > 0) {
      items.push({ label: `粘贴 (Ctrl+V) · ${state.clipboard.length} 个节点`, run: () => pasteClipboard(point) });
    }
    items.push('separator', { label: '自动排列', run: () => { autoLayout(); fitView(); } });
    showMenu(event.clientX, event.clientY, items);
  });
  window.addEventListener('mousemove', (event) => { if (state.drag || state.connect || state.variableConnect) onPointerMove(event); });
  window.addEventListener('mouseup', onPointerUp);

  // 右键菜单全局收起（UE 行为）：菜单外的任何按下/右键都会先收起当前菜单，
  // 避免端口密集时旧菜单盖住其它端口导致无法再次右键；菜单空白处右键也立即收起并抑制原生菜单。
  document.addEventListener('mousedown', (event) => {
    if (event.target instanceof Element && event.target.closest('.context-menu')) return;
    hideMenus();
  }, true);
  document.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const inMenu = target?.closest('.context-menu');
    if (inMenu) {
      event.preventDefault();
      if (!target?.closest('.context-menu button')) hideMenus();
      return;
    }
    hideMenus();
  }, true);

  // 从桌面端变量面板拖入变量：允许放置时显示跟随光标的提示，落点吸附兼容端点。
  const InputBridge = createInputBridge({
    state, $, el, wrap, worldPoint, placeVariableCard, variableDragMime: VARIABLE_DRAG_MIME,
    getShortcuts: () => window.StudioShortcuts,
    cancelConnection: late(() => cancelConnection),
    cancelVariableConnection: late(() => cancelVariableConnection),
    hideMenus, closeAssetBrowser: late(() => closeAssetBrowser),
    closeTemplateCheck: late(() => closeTemplateCheck),
    render: late(() => render),
    deleteCurrentSelection: late(() => deleteCurrentSelection),
    copySelection, cutSelection, pasteClipboard,
    executeEditorCommand: late(() => executeEditorCommand),
    undo, redo, fitView, nodeById, position, nodeHeight, nodeWidth: NODE_W, bounds,
  });
  InputBridge.install();
  const { matchesShortcut, variableDragAccepted, hideVariableDropGhost } = InputBridge;
  const CanvasMessages = createCanvasMessages({
    state, $, mutate, nodeById, normalizeRaw, clearVariableCardSelection, setDirty, render, fitView, ensureLayout,
    renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, renderInspector, renderAssetBrowser,
    closeAssetBrowser, renderTemplateCheck, restoreAssetBrowserAfterRoi, openRoiPicker, requestAssetInventory,
    normalizedAssetPath, handleRunEvent, setExportBusy,
    replaceDocument: (text: string, record?: boolean) => { closeInlineEditor(); replaceDocument(text, record); },
    executeEditorCommand, toast,
  });
  window.addEventListener('message', (event) => CanvasMessages.handleMessage(event.data || {}));
  for (const id of ['lightbox', 'roi-picker', 'asset-browser', 'workflow-browser', 'template-check']) {
    const overlay = el('div', `overlay hidden`); overlay.id = id; document.body.appendChild(overlay);
    if (id === 'asset-browser') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeAssetBrowser(); });
    if (id === 'workflow-browser') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeWorkflowBrowser(); });
    if (id === 'template-check') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeTemplateCheck(); });
  }
  bindToolbar();
  window.__btEditor = { state, connect, disconnect, autoLayout, render, exportFullCanvasImage, copySelection, cutSelection, pasteClipboard, snapshot: () => clone(state.raw), collectExportTemplatePaths, applyInlineThumbnails, placeVariableCard, variableCardList, nodeVariablePins, collectNodeCardVariableRefs, connectVariableToPin };
  vscode.postMessage({ type: 'ready' });
}
