/**
 * 画布入口组装。
 *
 * 原 `workflow-editor.js` 闭包已全部迁移为 TS 模块；本文件只按依赖顺序组装
 * 状态/模型、渲染、交互与壳层通信，不再有 `late()` 包裹的循环接线。
 *
 * 仅三处跨模块互调留在入口显式接线，其余依赖顺着构造顺序直接传入：
 * - render / focusNode：所有模块共用的重绘入口由 RenderEntry 提供，入口先建
 *   占位函数、渲染层就绪后赋值（各交互/渲染模块直接引用函数本身）；
 * - inspectorRenderers：详情面板 ⇄ 各详情渲染器互调，面板先建、内容后填表；
 * - assetHooks.requestTemplateReplacement：素材浏览器补图 ⇄ 素材动作互调。
 *
 * 编辑器命令出口以 `CanvasEditorHandle` 显式返回；`window.__btEditor` 仅作为
 * 验证脚本与旧展示页的调试出口（画布模块自身不再读取）。
 */
import { createCanvasEdges } from './canvas/edges';
import { createCanvasMinimap } from './canvas/minimap';
import { createCanvasViewport } from './canvas/viewport';
import { validateWorkflow } from '../shared/workflow/validate';
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
import { createInspectorPanel, type InspectorRenderers } from './inspector/panel';
import { createParameterControls } from './inspector/parameter-controls';
import { createVariableInspectors } from './inspector/variable-inspectors';
import { createCanvasWorkflowModel } from './model/canvas-workflow-model';
import { issuesByNode, issueTitle, nodeIssues } from './model/card-issues';
import { createCanvasReferences } from './model/references';
import { createEditorSchema } from './model/schema';
import { createSidebarState } from './model/sidebar-state';
import { createSubworkflowHelpers } from './model/subworkflow';
import { createVariableSystem } from './model/variable-system';
import { createWorkflowModel } from './model/workflow-model';
import { compactValue, instanceLabel } from './render/card-values';
import { createAssetPreview } from './render/asset-preview';
import { cardRowParams, hasCardLayout } from './render/card-layout';
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
import { normalizeRaw } from './state/normalize';
import { createRunEvents } from './state/run-events';
import { createCanvasState, type CanvasState } from './state/canvas-state';
import { createEditorToolbar } from './toolbar';
import { createCanvasHelpers } from './ui/canvas-helpers';
import { createUi } from './ui/elements';
import { ACTION_LABELS, actionLabel, enumOption, fieldLabel } from './ui/labels';
import { createCanvasOverlays, type MenuEntry } from './ui/overlays';
import type { CanvasBridge } from './bridge';

/**
 * 编辑器命令出口（调试与独立窗口转发使用）。
 * 验证脚本与旧展示页经 `window.__btEditor` 读取；画布模块内部不走这里。
 */
export interface CanvasEditorHandle {
  state: CanvasState;
  connect(parentId: string, childId: string, replaceIndex?: number): boolean;
  disconnect(parentId: string, childId: string): void;
  autoLayout(record?: boolean): void;
  render(): void;
  exportFullCanvasImage(): void;
  copySelection(): void;
  cutSelection(): void;
  pasteClipboard(point: { x: number; y: number }): void;
  snapshot(): string;
  collectExportTemplatePaths(...args: any[]): any;
  applyInlineThumbnails(...args: any[]): any;
  placeVariableCard(...args: any[]): any;
  variableCardList(): any[];
  nodeVariablePins(node: any): any[];
  collectNodeCardVariableRefs(...args: any[]): any;
  connectVariableToPin(...args: any[]): any;
  referenceFieldsForPin(...args: any[]): any;
  nodeOutputFields(...args: any[]): any;
  removeVariable(...args: any[]): any;
  deleteVariable(...args: any[]): any;
  renderInspector(): void;
}

export function startCanvasEditor(bridge: CanvasBridge): CanvasEditorHandle {
  // Initialize before publishing the editor handle: declarations below return
  // never execute, even when their neighboring function declarations are hoisted.
  let issuesCache: { version: number; raw: unknown; byNode: Map<string, any> } | null = null;
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
  /** 清单声明了固定卡片的 Action：双行行样式（标签一行、值一行）的行高。 */
  const CARD_ROW_H = 40;
  const RUN_CARD_GAP_X = 48;
  const RUN_CARD_GAP_Y = 92;
  const PREVIEW = { x: 174, y: 56, width: 72, height: 30 };
  const VARIABLE_CARD_W = 168;
  const VARIABLE_CARD_H = 58;
  const VARIABLE_CARD_PORT_Y = 29;
  const VARIABLE_PIN_X = 10;
  /** 任务卡右侧「节点输出引用」口在节点内的 Y 偏移（表头中线）。 */
  const TASK_OUTPUT_PORT_Y = 16;
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

  /** 重绘入口占位：RenderEntry 就绪后赋值（模块直接引用 render/focusNode 函数本身）。 */
  let renderPieces: { render(): void; focusNode(id: string): void } | null = null;

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
  const { variableCards, variableLinks, nextVariableCardId, variableCardList, clearVariableCardSelection, setVariableCardSelection } = Model;
  const { displayNameOfDefinition, variableDisplayNameOf, inputParameterMetadata } = Model;

  const EditorStatus = createEditorStatus({ state, vscode, $ });
  const { setDirty, currentInspectorSelection, requestInspector } = EditorStatus;

  const StudioSchema = createEditorSchema();
  const { definitionSchema, compatibleRefType, appendNestedRefs } = StudioSchema;

  const References = createCanvasReferences({
    state, clone, nodes, definitionSchema, compatibleRefType, appendNestedRefs,
    variableSystem: VariableSystem, catalogByName,
  });
  const { defaultValue, allRefs, referenceLabel } = References;

  /** 子流程 task（workflow.run）的引用解析与摘要，状态/模型层即可构建。 */
  const SubworkflowHelpers = createSubworkflowHelpers({
    state, vscode, nodeById, $, showMenu, compactValue,
  });
  const {
    subWorkflowRef, requestOpenSubWorkflow, requestOpenWorkflowReference, compositeSubtitle, decoratorLabel,
  } = SubworkflowHelpers;

  const History = createEditorHistory({
    state,
    cleanupReleased: (raw, before) => raw ? VariableSystem.cleanupReleased(raw, before) : [],
    clearVariableCardSelection,
    nodeById,
    setDirty: (value) => setDirty(value),
    render,
  });
  const { snapshot, mutate, restore, replaceDocument, undo, redo } = History;

  /** 工作流浏览器：CanvasWorkflowModel 的子流程引用解析依赖它，故在模型前创建。 */
  const StudioWorkflowBrowser = createWorkflowBrowser({ state, $, el, nodeById, mutate, toast, requestWorkflows: () => vscode.postMessage({ type: 'refreshWorkflows' }) });
  const { workflowReference, openWorkflowBrowser, closeWorkflowBrowser, renderWorkflowBrowser } = StudioWorkflowBrowser;

  /** CanvasWorkflowModel 自身提供的子流程输入列表；经入口回填，避免构造期互相引用。 */
  let workflowInputs: (reference: any) => any[];
  const workflowNodeInputs = (node: { [key: string]: unknown }) => subWorkflowRef(node) ? workflowInputs(subWorkflowRef(node)) : [];

  const CanvasWorkflowModel = createCanvasWorkflowModel({
    state, Model, VariableSystem, nodes, position, variableCards,
    compatibleRefType, definitionSchema,
    nodeHeight,
    baseHeight: BASE_H, nodeWidth: NODE_W, decoHeight: DECO_H,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
    variableCardPortY: VARIABLE_CARD_PORT_Y, variablePinX: VARIABLE_PIN_X,
    runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H, runVariableHeight: RUN_VARIABLE_H,
    runCardGapX: RUN_CARD_GAP_X, runCardGapY: RUN_CARD_GAP_Y,
    catalogByName, fieldLabel, workflowNodeInputs, nextVariableCardId,
    workflowReference, nodeRowHeight,
  });
  const {
    nodeVariablePins, collectNodeCardVariableRefs, variableCardPosition, paramRowsExpanded, nodeOutputFields,
    referenceFieldsForPin, referenceDisplayName, syncLegacyInputParameters, syncLegacyVariableCards, variablePinPosition,
    variableCompatibleWithPin, variableCompatibleWithInstanceInput, instanceRunCards, instanceRunInputPosition,
  } = CanvasWorkflowModel;
  workflowInputs = CanvasWorkflowModel.workflowInputs;

  const StudioSidebarState = createSidebarState({ state, collectNodeCardVariableRefs, nodes, currentInspectorSelection, vscode });
  const { postSidebarState } = StudioSidebarState;

  const Viewport = createCanvasViewport({
    state, nodes, position, layout, mutate, instanceRunCards, variableCardList, nodeHeight,
    wrap, minimap: () => $('minimap'), render,
    nodeWidth: NODE_W, baseHeight: BASE_H, runCardWidth: RUN_CARD_W,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { autoLayout, ensureLayout, bounds, fitView, zoomAt, worldPoint, bezier } = Viewport;

  const Commands = createCanvasCommands({
    state, nodes, nodeById, layout, mutate, clone, toast: (message, error) => toast(message, error), worldPoint,
    wrap, nodeWidth: NODE_W, baseHeight: BASE_H,
  });
  const { parentOf, canConnect, connect, disconnect, buildNode, addNode, deleteSelection, copySelection, cutSelection, pasteClipboard } = Commands;

  const HitTest = createCanvasHitTest({
    state, worldPoint, nodes, nodeById, position, nodeHeight, nodeRowHeight, nodeVariablePins,
    variableCompatibleWithPin, variableCompatibleWithInstanceInput, instanceRunCards,
    instanceRunInputPosition, variableCardList, referenceFieldsForPin,
    portRadius: PORT_R, nodeWidth: NODE_W, baseHeight: BASE_H, runVariableHeight: RUN_VARIABLE_H,
    variablePinX: VARIABLE_PIN_X, runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H, variableCardPortY: VARIABLE_CARD_PORT_Y,
  });
  const {
    connectionTargetAt, variableInputTargetAt, variableCardTargetAt, variableCardTargetAtInstanceInput,
    variableConnectionTargetAt, referenceConnectionTargetAt, referenceMissAt,
  } = HitTest;

  const EditorCommands = createEditorCommands({
    state, mutate, nodeById, nodes, layout, position, clone, toast,
    variableCards, variableLinks, nextVariableCardId,
    setVariableCardSelection, variableInputTargetAt,
    instanceRunCards, displayNameOfDefinition, wrap,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
    variableCardPortY: VARIABLE_CARD_PORT_Y, nodeWidth: NODE_W, runCardWidth: RUN_CARD_W,
  });
  const {
    removeVariableCard, releasePinBinding, removeVariableCards, placeVariableCard, addVariableCardCommand,
    renameNode, changeNodeType,
  } = EditorCommands;

  const Connections = createCanvasConnections({
    state, graph, worldPoint, render, snapshot, mutate, connect, disconnect, variableConnectionTargetAt,
    nodeById, instanceRunCards, variableCompatibleWithPin, variableCompatibleWithInstanceInput,
    variableLinks, displayNameOfDefinition, variableDisplayNameOf, toast: (message, error) => toast(message, error),
    referenceConnectionTargetAt, referenceMissAt, fieldLabel, showMenu,
    referenceDisplayNameOf: (ref) => referenceDisplayName(ref), variableCardList,
  });
  const {
    startConnection, startConnectionFromInput, captureConnectionPointer,
    cancelConnection, finishConnection, startVariableConnectionFromCard, startVariableConnectionFromPin,
    startVariableConnectionFromInstanceInput, cancelVariableConnection, finishVariableConnection,
    connectVariableToPin, disconnectVariableFromPin, connectVariableToInstanceInput, disconnectVariableFromInstanceInput,
    startReferenceConnection, cancelReferenceConnection, finishReferenceConnection,
    connectReferenceToPin, disconnectReferenceFromPin,
  } = Connections;

  const Pointer = createCanvasPointer({
    state, graph, wrap, worldPoint, position, nodeById, nodes, nodeHeight, snapshot, render, hideMenus,
    clearVariableCardSelection, layout, variableCards, variableCardList, connectionTargetAt,
    variableConnectionTargetAt, referenceConnectionTargetAt,
    finishConnection, cancelConnection, finishVariableConnection, finishReferenceConnection, setDirty,
    nodeWidth: NODE_W, variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { startNodeDrag, onPointerDown, onPointerMove, onPointerUp, contextMenuSuppressedByPan } = Pointer;

  const CanvasHelpers = createCanvasHelpers({
    state, $, nodes, worldPoint, render,
    contextMenuSuppressedByPan,
    setVariableCardSelection, wrap,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
    localErrorCount: () => {
      let count = 0;
      for (const info of documentIssues().values()) count += info.node.length + info.params.size;
      return count;
    },
  });
  const { updateIssueBadge, openPortContextMenu, focusVariableCard } = CanvasHelpers;

  const AssetPreview = createAssetPreview({ state, $ });
  const {
    templatePreview, assetPreviewForPath, hideAssetPathPreview, bindAssetPreview, bindAssetPathPreview,
  } = AssetPreview;

  /** 素材浏览器 ⇄ 素材动作互相调用（从当前画面补齐模板图），入口显式接线。 */
  const assetHooks: { requestTemplateReplacement: (...args: any[]) => void } = { requestTemplateReplacement: () => {} };
  const AssetActions = createAssetActions({
    state, $, el, vscode,
    requestTemplateReplacement: (...args) => assetHooks.requestTemplateReplacement(...args),
  });
  const { normalizedAssetPath, assetPathStatus, requestAssetInventory, appendMissingAssetAction, requestRoi } = AssetActions;

  const StudioTemplateCheck = createTemplateCheck({ state, $, el, nodeById, catalogByName, clone, vscode, toast });
  const { requestTemplateCheck, closeTemplateCheck, renderTemplateCheck } = StudioTemplateCheck;

  const StudioAssetBrowser = createAssetBrowser({ state, $, el, mutate, nodeById, toast, vscode, requestRoi });
  const { openAssetBrowser, closeAssetBrowser, renderAssetBrowser, restoreAssetBrowserAfterRoi } = StudioAssetBrowser;
  assetHooks.requestTemplateReplacement = StudioAssetBrowser.requestTemplateReplacement;

  const StudioRoiPicker = createEditorRoiPicker({ state, $, el, mutate, vscode, toast, nodeById, restoreAssetBrowserAfterRoi });
  const { openRoiPicker } = StudioRoiPicker;

  const Minimap = createCanvasMinimap({
    state, $, svgEl, bounds, nodes, position, nodeHeight, instanceRunCards, variableCardList,
    wrap, nodeWidth: NODE_W, runCardWidth: RUN_CARD_W, variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { renderMinimap } = Minimap;

  const Edges = createCanvasEdges({
    state, svgEl, bezier, nodes, nodeById, position, nodeHeight, nodeRowHeight, instanceRunCards, instanceRunInputPosition,
    variableCardList, nodeVariablePins, variablePinPosition, disconnect,
    disconnectVariableFromPin, disconnectVariableFromInstanceInput, disconnectReferenceFromPin,
    mutate, requestInspector, render,
    worldPoint, captureConnectionPointer,
    nodeWidth: NODE_W, runCardWidth: RUN_CARD_W, baseHeight: BASE_H, runVariableHeight: RUN_VARIABLE_H,
    variableCardWidth: VARIABLE_CARD_W, variableCardPortY: VARIABLE_CARD_PORT_Y, variablePinX: VARIABLE_PIN_X,
    taskOutputPortY: TASK_OUTPUT_PORT_Y,
  });
  const {
    renderVariableEdges, renderEdge, renderInstanceRunEdge, renderConnection,
    renderVariableConnection, renderReferenceConnection, renderReferenceEdges, referencePortPosition,
  } = Edges;

  const PortMenu = createCanvasPortMenu({
    state, startConnectionFromInput, startConnection, startReferenceConnection,
    startVariableConnectionFromPin, startVariableConnectionFromInstanceInput, startVariableConnectionFromCard,
    parentOf, buildNode, canConnect, connect, disconnect, mutate, nodeById, position, layout, nodes,
    nodeVariablePins, nodeOutputFields, disconnectReferenceFromPin,
    variableCards, variableLinks, nextVariableCardId, variableCardList, variableCardPosition,
    focusVariableCard, placeVariableCard, disconnectVariableFromPin, disconnectVariableFromInstanceInput,
    removeVariableCard, fieldLabel, toast: (message, error) => toast(message, error),
    typeNames: TYPE_NAMES, nodeWidth: NODE_W,
  });
  const {
    nodeInputPortMenuItems, nodeOutputPortMenuItems, nodeReferencePortMenuItems, nodeVariablePinMenuItems,
    instanceRunPinMenuItems, variableCardPortMenuItems,
  } = PortMenu;

  /** 详情面板 ⇄ 各详情渲染器互调：面板先建，内容渲染器构造后填表。 */
  const inspectorRenderers: InspectorRenderers = {
    renderTaskInspector: () => {}, renderCompositeInspector: () => {}, renderDecorators: () => {},
    renderWorkflowInspector: () => {}, renderVariablesInspector: () => {}, renderInstanceRunInspector: () => {}, renderEdgeInspector: () => {},
  };
  const InspectorPanel = createInspectorPanel({
    state, UI, $, el, nodeById, hideAssetPathPreview, types: TYPES, typeNames: TYPE_NAMES, typeLabels: TYPE_LABEL,
    renameNode, changeNodeType, mutate, deleteSelection,
    renderers: inspectorRenderers,
  });
  const {
    clearInspector, section, field, textInput, selectInput, segmentedInput, checkbox, renderInspector,
  } = InspectorPanel;

  const StudioToolbar = createEditorToolbar({ state, $, el, UI, vscode, showMenu, zoomAt, setDirty, toast, nodes, focusNode });
  const { renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, bindToolbar, searchNodeByName, setWorkflow, setInstance } = StudioToolbar;
  bridge.setTopbarControls({ setWorkflow, setInstance });

  const StudioExport = createEditorExport({ state, graph, vscode, bounds, wrap, toast, NS });
  const { exportFullCanvasImage, setExportBusy, collectExportTemplatePaths, applyInlineThumbnails } = StudioExport;

  const ParameterControls = createParameterControls({
    state, mutate, UI, el, $, clone, toast, defaultValue, allRefs, referenceLabel,
    fieldLabel, enumOption, actionLabel, bindAssetPreview, assetPreviewForPath,
    assetPathStatus, openAssetBrowser, requestRoi,
    inputParameterMetadata, VariableSystem,
    ACTION_LABELS,
    requestTemplateCheck,
    requestTemplateReplacement: (nodeId: string, key: string, path: string, options: any) => StudioAssetBrowser.requestTemplateReplacement(nodeId, key, path, options),
    variableLinks, variableDisplayNameOf,
    renderInspector, appendMissingAssetAction, openWorkflowBrowser,
    selectInput, textInput, checkbox, segmentedInput, field,
  });
  const {
    actionDropdown, renderParameter, rememberParameterLiteral, restoreParameterLiteral, clearParameterLiteralCache,
    convertWaitTemplateToAny, convertWaitAnyToTemplate, complexValueControl, iconButton, addRowButton,
    conditionControl, conditionOperandControl, conditionParseLiteral, nodeChildrenOptions,
  } = ParameterControls;

  const DetailInspectors = createDetailInspectors({
    state, mutate, UI, el, $, nodeById, catalogByName, clone,
    defaultValue, referenceLabel,
    enumOption,
    runtimeInstanceLabel, workflowInputs,
    workflowReference, requestOpenWorkflowReference,
    definitionSchema, compatibleRefType,
    actionDropdown, renderParameter, complexValueControl,
    displayNameOfDefinition, compactValue, renderInspector,
    selectInput, textInput, field, section, clearInspector,
  });
  const { renderTaskInspector, removeInstanceRun, renderInstanceRunInspector } = DetailInspectors;

  const VariableInspectors = createVariableInspectors({
    state, mutate, UI, el, $, nodeById, clone, toast,
    defaultValue, allRefs, referenceLabel,
    fieldLabel, disconnect, bindAssetPreview,
    openAssetBrowser,
    variableCards, variableLinks, clearVariableCardSelection, VariableSystem,
    vscode,
    selectInput, textInput, checkbox, field, section, clearInspector,
  });
  const {
    renderEdgeInspector, renderWorkflowInspector, removeVariable, deleteVariable, addVariable, renderVariablesInspector,
    valueBindingMenu,
  } = VariableInspectors;

  const StudioCompositeInspector = createCompositeInspector({
    el, section, field, selectInput, checkbox, segmentedInput, textInput, iconButton, addRowButton,
    conditionControl, conditionOperandControl, conditionParseLiteral, nodeChildrenOptions, nodeById,
    mutate, disconnect, runtimeInstanceLabel, removeInstanceRun, workflowInputs, render, state,
    decoratorLabel, clone, allRefs, referenceLabel, valueBindingMenu, toast, UI,
  });
  const { renderCompositeInspector, renderDecorators } = StudioCompositeInspector;

  inspectorRenderers.renderTaskInspector = renderTaskInspector;
  inspectorRenderers.renderInstanceRunInspector = renderInstanceRunInspector;
  inspectorRenderers.renderCompositeInspector = renderCompositeInspector;
  inspectorRenderers.renderDecorators = renderDecorators;
  inspectorRenderers.renderWorkflowInspector = renderWorkflowInspector;
  inspectorRenderers.renderVariablesInspector = renderVariablesInspector;
  inspectorRenderers.renderEdgeInspector = renderEdgeInspector;

  const Cards = createCanvasCards({
    state, svgEl, nodeCards, displayNameOfDefinition, assetPreviewForPath, bindAssetPathPreview,
    disconnectVariableFromInstanceInput, startVariableConnectionFromInstanceInput, startVariableConnectionFromCard,
    openPortContextMenu, showMenu, instanceRunPinMenuItems, variableCardPortMenuItems, requestInspector,
    requestOpenWorkflowReference, render, contextMenuSuppressedByPan,
    removeInstanceRun, removeVariableCard, setVariableCardSelection, worldPoint, snapshot,
    runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H, runVariableHeight: RUN_VARIABLE_H, portRadius: PORT_R,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H, variableCardPortY: VARIABLE_CARD_PORT_Y,
  });
  const { renderInstanceRunCard, renderVariableCard, registerCardPress } = Cards;

  const InlineEditor = createCanvasInlineEditor({
    state, wrap, el, mutate, clearParameterLiteralCache, rememberParameterLiteral, variableLinks,
    showMenu, nodeVariablePinMenuItems, requestInspector,
    toast: (message, error) => toast(message, error), enumOption, fieldLabel,
    openAssetBrowser, requestRoi,
  });
  const { openParamEditor, closeInlineEditor, setParamLiteral, refreshInlineEditor } = InlineEditor;

  const NodeCard = createNodeCardRenderer({
    state, svgEl, nodeCards, position, nodeHeight, nodeRowHeight,
    subWorkflowRef, templatePreview,
    compositeSubtitle, variableDisplayNameOf, referenceDisplayNameOf: (ref) => referenceDisplayName(ref),
    nodeIssueInfo, issueTitle,
    decoratorLabel, nodeVariablePins, openLightbox,
    disconnectVariableFromPin, startVariableConnectionFromPin,
    openPortContextMenu, showMenu,
    nodeVariablePinMenuItems, nodeInputPortMenuItems, nodeOutputPortMenuItems,
    startConnectionFromInput, startConnection, startReferenceConnection,
    nodeReferencePortMenuItems,
    startNodeDrag,
    registerCardPress, requestInspector, requestOpenSubWorkflow, render,
    contextMenuSuppressedByPan,
    copySelection, cutSelection, deleteSelection,
    paramRowInfo, toggleParamRows, paramRowMenuItems,
    openParamEditor,
    compactValue,
    typeIcons: TYPE_ICON, typeNames: TYPE_NAMES, runLabels: RUN_LABEL,
    nodeWidth: NODE_W, baseHeight: BASE_H, portRadius: PORT_R, decoratorHeight: DECO_H,
    runVariableHeight: RUN_VARIABLE_H, variablePinX: VARIABLE_PIN_X, taskOutputPortY: TASK_OUTPUT_PORT_Y, preview: PREVIEW,
  });
  const { renderNode } = NodeCard;

  const RenderEntry = createRenderEntry({
    state, $, graph, wrap, svgEl, UI, nodes, nodeById, position, nodeHeight, instanceRunCards, variableCardList,
    renderNode, renderInstanceRunCard, renderVariableCard,
    renderEdge, renderInstanceRunEdge, renderConnection,
    renderVariableConnection, renderReferenceConnection, renderReferenceEdges, renderVariableEdges,
    renderMinimap, renderInspector,
    postSidebarState, updateIssueBadge,
    ensureLayout, syncLegacyInputParameters, syncLegacyVariableCards, setDirty, nodeWidth: NODE_W,
    afterRender: () => refreshInlineEditor(),
  });
  renderPieces = RenderEntry;

  const RunEvents = createRunEvents({
    state, nodes, nodeById, clone, render, deleteSelection, removeVariableCards, removeVariableCard,
    removeInstanceRun, removeVariable,
  });
  const { handleRunEvent, deleteCurrentSelection } = RunEvents;

  const EditorCommandDispatch = createEditorCommandDispatch({
    convertInputToVariable: VariableInspectors.convertInputToVariable,
    state, mutate, nodes, nodeById, undo, redo, fitView, autoLayout, copySelection, cutSelection,
    pasteClipboard, deleteSelection, addNode, render, focusNode, searchNodeByName, exportFullCanvasImage,
    addVariable, clearVariableCardSelection, deleteCurrentSelection, renderInspector, addVariableCardCommand,
    deleteVariable,
    VariableSystem,
  });
  const { executeEditorCommand } = EditorCommandDispatch;

  graph.addEventListener('mousedown', onPointerDown);
  graph.addEventListener('mousemove', onPointerMove);
  graph.addEventListener('mouseup', onPointerUp);
  graph.addEventListener('mousemove', (event) => { state.mouse = worldPoint(event); });
  graph.addEventListener('pointermove', (event) => { if (state.connect || state.variableConnect || state.referenceConnect) onPointerMove(event); });
  graph.addEventListener('pointerup', (event) => { if (state.connect || state.variableConnect || state.referenceConnect) onPointerUp(event); });
  graph.addEventListener('pointercancel', () => { cancelConnection(); cancelVariableConnection(); cancelReferenceConnection(); });
  graph.addEventListener('mouseleave', (event) => { if (state.drag || state.connect || state.variableConnect || state.referenceConnect) onPointerMove(event); });
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
  window.addEventListener('mousemove', (event) => { if (state.drag || state.connect || state.variableConnect || state.referenceConnect) onPointerMove(event); });
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
    cancelConnection, cancelVariableConnection, cancelReferenceConnection,
    hideMenus, closeAssetBrowser, closeTemplateCheck,
    render,
    deleteCurrentSelection,
    copySelection, cutSelection, pasteClipboard,
    executeEditorCommand,
    undo, redo, fitView, nodeById, position, nodeHeight, nodeWidth: NODE_W, bounds,
  });
  InputBridge.install();
  const CanvasMessages = createCanvasMessages({
    state, $, mutate, nodeById, normalizeRaw, clearVariableCardSelection, setDirty, render, fitView, ensureLayout,
    renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, renderInspector, renderAssetBrowser,
    renderWorkflowBrowser,
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
  const handle: CanvasEditorHandle = {
    state, connect, disconnect, autoLayout, render, exportFullCanvasImage, copySelection, cutSelection, pasteClipboard,
    snapshot: () => JSON.stringify(state.raw), collectExportTemplatePaths, applyInlineThumbnails, placeVariableCard, variableCardList,
    nodeVariablePins, collectNodeCardVariableRefs, connectVariableToPin, referenceFieldsForPin, nodeOutputFields,
    removeVariable, deleteVariable, renderInspector,
  };
  window.__btEditor = handle;
  vscode.postMessage({ type: 'ready' });
  return handle;

  // ---- 入口局部胶水 ----
  // 以下函数声明（含 render/focusNode）在函数体内提升，可被上方各工厂直接引用；
  // 它们只在**调用期**访问后文才初始化的模块输出（nodeVariablePins 等），构造期不调用。

  /** 按名字找 Action 规格（画布目录快照）。 */
  function catalogByName(name: string): any {
    return state.catalog.find((item) => item.name === name) || null;
  }

  /** 校验器要的目录接口：按名字找 Action 规格。 */
  function catalogLike(): { byName(name: string): any; names(): string[] } {
    return {
      byName: (name: string) => catalogByName(name),
      names: () => state.catalog.map((item) => item.name),
    };
  }

  /** 任务节点对应的动作清单（清单里声明 `card.rows` 时卡片布局固定）。 */
  function nodeActionSpec(node: any): any {
    return (node && node.type === 'task' && node.action ? catalogByName(node.action) : null);
  }

  /**
   * 每个节点自己的参数行高：声明了固定卡片的动作用双行行样式（标签一行、值一行）。
   * nodeHeight、参数行几何、变量端点、连线与命中测试共用这一个公式。
   */
  function nodeRowHeight(node: any): number {
    return (hasCardLayout(nodeActionSpec(node)) ? CARD_ROW_H : RUN_VARIABLE_H);
  }

  function nodeHeight(node: { id?: string; decorators?: unknown[] }): number {
    return BASE_H
      + nodeVariablePins(node).length * nodeRowHeight(node)
      + (Array.isArray(node.decorators) ? node.decorators.length * DECO_H : 0);
  }

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

  /** 实例运行项的实例名显示（含回退）。 */
  function runtimeInstanceLabel(instanceId: string, fallback?: string): string {
    return instanceLabel(instanceId, state.instances, fallback);
  }

  /** 卡片错误标记：文档版本变化时才重跑一次校验，把错误按节点/参数分组。 */
  function documentIssues(): Map<string, any> {
    const version = state.docVersion || 0;
    // 缓存键 = 文档版本 + 文档对象本身：改动走 mutate 会 bump 版本，
    // 整份替换（载入/撤销/外部同步）会换对象，两条路都能失效。
    if (issuesCache && issuesCache.version === version && issuesCache.raw === state.raw) return issuesCache.byNode;
    let byNode = new Map<string, any>();
    try {
      byNode = issuesByNode(state.raw ? validateWorkflow(state.raw, catalogLike()) : []);
    } catch {
      // 校验是渲染路径上的附加信息：目录/文档畸形时宁可不标红，也不能让画布画不出来。
      byNode = new Map();
    }
    issuesCache = { version, raw: state.raw, byNode };
    return byNode;
  }

  function nodeIssueInfo(node: any): { node: any[]; params: Map<string, any[]> } | null {
    return nodeIssues(documentIssues(), node && node.id);
  }

  /** 参数行的折叠状态：清单声明了固定卡片的动作按声明显示全部端点（无折叠）；
   * 其余默认只显示「必填 + 已配置」，箭头展开动作定义里的全部参数。
   */
  function paramRowInfo(node: any): { expanded: boolean; total: number; hidden: number; fixed: boolean; twoLine: boolean } {
    const spec = nodeActionSpec(node);
    if (hasCardLayout(spec)) {
      const total = cardRowParams(spec)?.length ?? 0;
      return { expanded: true, total, hidden: 0, fixed: true, twoLine: true };
    }
    const total = spec && spec.parameters ? Object.keys(spec.parameters).length : 0;
    const expanded = paramRowsExpanded().has(node && node.id);
    const shown = nodeVariablePins(node).length;
    return { expanded, total, hidden: Math.max(0, total - shown), fixed: false, twoLine: false };
  }

  function toggleParamRows(nodeId: string): void {
    const expanded = paramRowsExpanded();
    if (expanded.has(nodeId)) expanded.delete(nodeId);
    else expanded.add(nodeId);
    render();
  }

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

  /** 重绘入口占位：RenderEntry 就绪后赋值（模块直接引用 render/focusNode 函数本身）。 */
  function render(): void {
    renderPieces?.render();
  }
  function focusNode(id: string): void {
    renderPieces?.focusNode(id);
  }
}
