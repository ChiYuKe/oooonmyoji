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
import { createWrapMeasurement } from './canvas/wrap-measurement';
import { validateWorkflow } from '../shared/workflow/validate';
import { createEditorExport } from './export';
import { createAssetActions } from './interactions/asset-actions';
import { createAssetBrowser } from './interactions/asset-browser';
import { createCanvasConnections } from './interactions/connections';
import { createCanvasHitTest } from './interactions/hit-test';
import { createInputBridge } from './interactions/input-bridge';
import { createCanvasInlineEditor } from './interactions/inline-editor';
import { createNodeNameEditor } from './interactions/node-name-editor';
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
import { createNodeGroups, isGroupInterfaceNode, isGroupVariablesNode, isProjectedGroupNode } from './model/node-groups';
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
import { createRenderEntry, type CanvasRenderEntry } from './render/render-entry';
import { paramRowKindOf } from './render/param-rows';
import type { RenderFlags } from './render/render-scheduler';
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
import { readRuntimeEdgePreview, writeRuntimeEdgePreview } from '../shared/runtime-edge-preview';

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
  /**
   * 画布基准入口：给 Electron 性能基准（scripts/canvas-benchmark.cjs）用。
   * 只暴露「测量视口/交互类操作」需要的能力，不改变编辑器语义。
   */
  benchmark: CanvasBenchmarkApi;
}

/** 画布基准接口：平移、缩放、拖拽与统计。 */
export interface CanvasBenchmarkApi {
  /** 当前渲染统计（整层重建次数、挂载卡片数等）。 */
  stats(): any;
  /** 画布内节点/连线/变量卡的实际 DOM 元素数量。 */
  domCounts(): { nodes: number; edges: number; variableEdges: number; variableCards: number; total: number };
  /** 平移视口（只改视口，不触发整层重建）。 */
  panBy(dx: number, dy: number): void;
  /** 以画布中心为锚点缩放。 */
  zoomBy(factor: number): void;
  /** 选中一个节点（用于拖拽基准）。 */
  selectNode(id?: string): string | null;
  /** 把选中节点移动 (dx, dy)（世界坐标），模拟拖拽。 */
  dragSelected(dx: number, dy: number): void;
  endDrag(): void;
  /** 触发一次视口重绘（与外层 rAF 对齐）。 */
  flushViewport(): void;
  /** 当前可见（已挂载）的节点数量。 */
  activeNodeCount(): number;
  /** 当前缩放分级。 */
  detailLevel(): string | null;
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

  let runtimeEdgePreviewEnabled = readRuntimeEdgePreview(window.localStorage);
  function setRuntimeEdgePreview(enabled: boolean): void {
    runtimeEdgePreviewEnabled = enabled;
    document.body.classList.toggle('runtime-edge-preview-disabled', !enabled);
    writeRuntimeEdgePreview(window.localStorage, enabled);
  }
  setRuntimeEdgePreview(runtimeEdgePreviewEnabled);

  /** 重绘入口占位：RenderEntry 就绪后赋值（模块直接引用 render/focusNode 函数本身）。 */
  let renderPieces: CanvasRenderEntry | null = null;
  /**
   * 连线重连旋钮的指针捕获：Connections 在 Edges 之后构造，先占位、构造后回填，
   * 避免 Edges ⇄ Connections 的环形依赖。
   */
  let captureConnectionPointer: (event: any) => number | null = () => null;
  /** 滚轮缩放合并：一帧内的多次滚轮只做一次视口更新。 */
  let wheelZoom = 1;
  let wheelPoint: { x: number; y: number } | null = null;
  let wheelScheduled = false;

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
  /** 视口尺寸缓存：画布每帧都在写 DOM，读 rect 会强制同步布局（实测占缩放的 50% 帧时间）。 */
  const wrapMeasurement = createWrapMeasurement(wrap as any);
  window.addEventListener('resize', () => wrapMeasurement.invalidate());
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const Overlays = createCanvasOverlays({ el: (tag, className, text) => el(tag, className, text), $: (id) => $(id) });
  const { showMenu, hideMenus, openLightbox, toast } = Overlays;
  const Model = createWorkflowModel(state);
  const { nodes, nodeById, layout, position } = Model;
  const { variableCards, variableLinks, nextVariableCardId, variableCardList: documentVariableCardList, clearVariableCardSelection, setVariableCardSelection } = Model;
  const { displayNameOfDefinition, variableDisplayNameOf, inputParameterMetadata } = Model;

  const EditorStatus = createEditorStatus({ state, vscode, $ });
  const { setDirty, currentInspectorSelection, requestInspector, requestInspectorRename } = EditorStatus;

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
    resolveWorkflowRef, subWorkflowRef, requestOpenSubWorkflow, requestOpenWorkflowReference, compositeSubtitle, decoratorLabel,
  } = SubworkflowHelpers;

  const History = createEditorHistory({
    state,
    cleanupReleased: (raw, before) => raw ? VariableSystem.cleanupReleased(raw, before) : [],
    clearVariableCardSelection,
    nodeById,
    setDirty: (value) => setDirty(value),
    render,
    renderGraph: () => renderGraph(),
    renderAll: () => renderPieces?.render({ full: true }),
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

  // 节点组是编辑器视图投影：运行时仍读取原始 nodes/children，打组不会改变执行语义。
  let renderNodeGroupBreadcrumb = (): void => {};
  let fitNodeGroupView = (): void => {};
  const refreshNodeGroupView = (fit = false): void => {
    renderPieces?.rebuildAll();
    renderPieces?.render({ full: true });
    renderNodeGroupBreadcrumb();
    if (fit) fitNodeGroupView();
  };
  const NodeGroups = createNodeGroups({
    state, nodes, nodeById, layout, mutate, toast, nodeWidth: NODE_W, nodeHeight, nodeVariablePins,
    baseHeight: BASE_H, runVariableHeight: RUN_VARIABLE_H,
    markDirty: () => setDirty(true),
    refreshView: refreshNodeGroupView,
    focusNode: (nodeId) => focusNode(nodeId),
  });
  const {
    currentGroup, runSummary: nodeGroupRunSummary, viewNodes, viewNodeById, viewReferenceSourceById, adjacentEdges, groupSelection, enterGroup, leaveGroup, ungroup, renameGroup, addToCurrentGroup, removeMembers,
    setPinExposed, pinMenuEntry, candidateMenu, boundaryVariableRefs,
  } = NodeGroups;
  /**
   * 画布上该画哪些变量卡片。
   *
   * 组内视图里，已经被**组边界卡**代表了的变量不再重复画一张卡片——否则同一个变量会同时
   * 出现在边界行和画布上的同名卡片里（「一个变量画了两遍」）。文档里的卡片本身不动
   * （`documentVariableCardList`），退出组后照旧显示；渲染、命中测试、连线、包围盒与
   * 画布签名都走这一份列表，行为一致。
   */
  const variableCardList = (): any[] => {
    const refs = boundaryVariableRefs();
    if (!refs.size) return documentVariableCardList();
    return documentVariableCardList().filter((card: any) => !refs.has(`${card.scope}.${card.name}`));
  };
  const viewPosition = (node: any) => {
    // 只有组内两张合成卡（接口卡/变量卡）有投影位置；组卡位置直接存布局。
    if (!isGroupInterfaceNode(node) && !isGroupVariablesNode(node)) return position(node);
    const saved = layout()[node.id];
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : node._nodeGroupPosition;
  };
  const viewNodeVariablePins = (node: any) => isProjectedGroupNode(node) ? node._groupPins : nodeVariablePins(node);
  const viewNodeHeight = (node: any) => {
    // 变量卡高度由成员跨度与端点行数决定；其余合成卡按「基准高 + 行数 × 行高」推导。
    if (isGroupVariablesNode(node) && Number.isFinite(node._nodeGroupHeight)) return Number(node._nodeGroupHeight);
    if (isProjectedGroupNode(node)) return BASE_H + node._groupPins.length * RUN_VARIABLE_H;
    return nodeHeight(node);
  };
  // 缩放分级只隐藏卡内元素、不改卡片尺寸：连线锚点直接用真实布局高度。
  const viewInstanceRunCards = () => instanceRunCards().filter((card: any) => {
    const visible = viewNodeById(card?.node?.id);
    return visible && !visible._nodeGroup;
  });

  const StudioSidebarState = createSidebarState({
    state, collectNodeCardVariableRefs, nodes, currentInspectorSelection, vscode,
    references: (scope, name) => (state.raw ? VariableSystem.references(state.raw, scope, name) : []),
  });
  const { postSidebarState } = StudioSidebarState;

  const Viewport = createCanvasViewport({
    state, nodes: viewNodes, position: viewPosition, layout, mutate, instanceRunCards: viewInstanceRunCards, variableCardList, nodeHeight: viewNodeHeight,
    // 自动排列要按变量端点把变量卡片跟着节点一起搬（真实节点的端点，不是当前投影的）。
    nodeVariablePins,
    // 绑定卡片纵向对齐到所属参数行：与创建卡片时同一套行几何。
    nodeRowHeight,
    variableCardPortY: VARIABLE_CARD_PORT_Y,
    // 组内排列跳过被组边界行代表的卡片：与 variableCardList() 的过滤同一个来源，
    // 否则组内根本不画的那张卡会被搬走，用户出组才发现外层布局被改了。
    groupRepresentedRefs: boundaryVariableRefs,
    wrap, measurement: wrapMeasurement, minimap: () => $('minimap'), render,
    nodeWidth: NODE_W, baseHeight: BASE_H, runCardWidth: RUN_CARD_W,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { autoLayout, ensureLayout, bounds, fitView, zoomAt, worldPoint, bezier } = Viewport;
  fitNodeGroupView = fitView;

  const Commands = createCanvasCommands({
    state, nodes, nodeById, layout, mutate, clone, toast: (message, error) => toast(message, error), worldPoint,
    wrap, nodeWidth: NODE_W, baseHeight: BASE_H,
    // 复制/剪切交给壳层保管：跨画布（含弹出到独立窗口的面板）粘贴靠它。
    publishClipboard: (payload) => vscode.postMessage({ type: 'clipboardWrite', clipboard: payload }),
    nextVariableCardId,
    onNodesCreated: addToCurrentGroup,
    onNodesRemoved: (ids) => removeMembers(ids),
  });
  const { parentOf, canConnect, connect, disconnect, buildNode, addNode, deleteSelection, copySelection, cutSelection, pasteClipboard } = Commands;

  const HitTest = createCanvasHitTest({
    state, worldPoint, nodes: viewNodes, nodeById: viewNodeById, position: viewPosition, nodeHeight: viewNodeHeight, nodeRowHeight, nodeVariablePins: viewNodeVariablePins,
    variableCompatibleWithPin, variableCompatibleWithInstanceInput, instanceRunCards: viewInstanceRunCards,
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

  let handleEmptyVariableDrop: (connection: any, point: { x: number; y: number }) => boolean = () => false;
  const Connections = createCanvasConnections({
    state, graph, worldPoint, render, snapshot, mutate, connect, disconnect, variableConnectionTargetAt,
    nodeById, instanceRunCards, variableCompatibleWithPin, variableCompatibleWithInstanceInput,
    variableLinks, displayNameOfDefinition, variableDisplayNameOf, toast: (message, error) => toast(message, error),
    referenceConnectionTargetAt, referenceMissAt, fieldLabel, showMenu,
    referenceDisplayNameOf: (ref) => referenceDisplayName(ref), variableCardList,
    onEmptyVariableDrop: (connection, point) => handleEmptyVariableDrop(connection, point),
  });
  const {
    startConnection, startConnectionFromInput, captureConnectionPointer: capturePointerFromConnections,
    cancelConnection, finishConnection, startVariableConnectionFromCard, startVariableConnectionFromPin,
    startVariableConnectionFromInstanceInput, cancelVariableConnection, finishVariableConnection,
    connectVariableToPin, disconnectVariableFromPin, connectVariableToInstanceInput, disconnectVariableFromInstanceInput,
    startReferenceConnection, cancelReferenceConnection, finishReferenceConnection,
    connectReferenceToPin, disconnectReferenceFromPin,
  } = Connections;
  captureConnectionPointer = (event: any) => capturePointerFromConnections(event);

  const Pointer = createCanvasPointer({
    state, graph, wrap, measurement: wrapMeasurement, worldPoint, position: viewPosition, nodeById: viewNodeById, nodes: viewNodes, nodeHeight: viewNodeHeight, snapshot, render, hideMenus,
    clearVariableCardSelection, layout, variableCards, variableCardList, connectionTargetAt,
    variableConnectionTargetAt, referenceConnectionTargetAt,
    finishConnection, cancelConnection, finishVariableConnection, finishReferenceConnection, setDirty,
    coalesce: (flags) => renderPieces?.coalesce(flags ?? { viewport: true, interaction: true }),
    // 框选矩形要跟着指针走：走带标记的同步重绘，不延后到下一帧。
    renderWith: (flags) => renderPieces?.render(flags),
    // 重连旋钮靠 setPointerCapture 捕获后续事件；没有原生指针标识就不挂这条交互。
    pointerCapture: (event) => (Number.isInteger((event as any).pointerId) ? (event as any).pointerId : null),
    nodeWidth: NODE_W, variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { startNodeDrag, onPointerDown, onPointerMove, onPointerUp, contextMenuSuppressedByPan } = Pointer;

  const CanvasHelpers = createCanvasHelpers({
    state, $, nodes: viewNodes, worldPoint, render,
    contextMenuSuppressedByPan,
    setVariableCardSelection, wrap, measurement: wrapMeasurement,
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
    state, $, svgEl, bounds, nodes: viewNodes, position: viewPosition, nodeHeight: viewNodeHeight, instanceRunCards: viewInstanceRunCards, variableCardList,
    wrap, measurement: wrapMeasurement,
    nodeWidth: NODE_W, runCardWidth: RUN_CARD_W, variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
  });
  const { renderMinimap } = Minimap;

  const Edges = createCanvasEdges({
    state, svgEl, bezier, nodes: viewNodes, nodeById: viewNodeById, referenceSourceById: viewReferenceSourceById,
    edgeRunTargetIds: NodeGroups.viewEdgeRunTargetIds,
    position: viewPosition, nodeHeight: viewNodeHeight, nodeRowHeight, instanceRunCards: viewInstanceRunCards, instanceRunInputPosition,
    variableCardList, nodeVariablePins: viewNodeVariablePins, variablePinPosition, disconnect,
    disconnectVariableFromPin, disconnectVariableFromInstanceInput, disconnectReferenceFromPin,
    mutate, requestInspector, render,
    worldPoint, captureConnectionPointer: (event) => captureConnectionPointer(event),
    nodeWidth: NODE_W, runCardWidth: RUN_CARD_W, baseHeight: BASE_H, runVariableHeight: RUN_VARIABLE_H,
    variableCardWidth: VARIABLE_CARD_W, variableCardPortY: VARIABLE_CARD_PORT_Y, variablePinX: VARIABLE_PIN_X,
    taskOutputPortY: TASK_OUTPUT_PORT_Y,
  });
  const {
    renderVariableEdges, renderEdge, renderInstanceRunEdge, renderConnection,
    renderVariableConnection, renderReferenceConnection, renderReferenceEdges, referencePortPosition,
    patchEdge, patchInstanceRunEdge, patchNodeDataEdges, patchRunEdgeStates, resetPatchRegistry, edgeBounds,
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
    variableCardWidth: VARIABLE_CARD_W, variableCardPortY: VARIABLE_CARD_PORT_Y,
    nodeGroupPinMenu: pinMenuEntry,
  });
  const {
    nodeInputPortMenuItems, nodeOutputPortMenuItems, nodeReferencePortMenuItems, nodeVariablePinMenuItems,
    instanceRunPinMenuItems, variableCardPortMenuItems, promotePinToVariable,
  } = PortMenu;
  handleEmptyVariableDrop = (connection, point) => {
    if (connection?.direction !== 'from-pin') return false;
    const node = nodeById(String(connection.nodeId || ''));
    const pin = node && nodeVariablePins(node).find((item: any) => item.param === connection.param);
    if (!node || !pin) return false;
    // 组内的“空白落点”代表把成员参数暴露到组变量接口；不创建工作流级变量。
    if (currentGroup()) return setPinExposed(node.id, connection.param, true);
    promotePinToVariable(node.id, connection.param, pin, point);
    return true;
  };

  /** 详情面板 ⇄ 各详情渲染器互调：面板先建，内容渲染器构造后填表。 */
  const inspectorRenderers: InspectorRenderers = {
    renderTaskInspector: () => {}, renderCompositeInspector: () => {}, renderDecorators: () => {},
    renderWorkflowInspector: () => {}, renderVariablesInspector: () => {}, renderInstanceRunInspector: () => {}, renderEdgeInspector: () => {},
  };
  const InspectorPanel = createInspectorPanel({
    state, UI, $, el, nodeById: (id) => viewNodeById(id) || nodeById(id), hideAssetPathPreview, types: TYPES, typeNames: TYPE_NAMES, typeLabels: TYPE_LABEL,
    renameNode, renameNodeGroup: renameGroup, changeNodeType, mutate, deleteSelection,
    renderers: inspectorRenderers,
  });
  const {
    clearInspector, section, field, textInput, selectInput, segmentedInput, checkbox, renderInspector,
  } = InspectorPanel;

  const StudioToolbar = createEditorToolbar({
    state, $, el, UI, vscode, showMenu, zoomAt, setDirty, toast, nodes: viewNodes, focusNode,
    currentNodeGroup: currentGroup, leaveNodeGroup: leaveGroup, groupSelection,
  });
  const { renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, bindToolbar, searchNodeByName, setWorkflow, setInstance } = StudioToolbar;
  renderNodeGroupBreadcrumb = renderWorkflowBreadcrumb;
  bridge.setTopbarControls({ setWorkflow, setInstance, setRuntimeEdgePreview });

  const StudioExport = createEditorExport({
    state, graph, vscode, bounds, wrap, toast, NS,
    setRenderAll: (value: boolean) => renderPieces?.setRenderAll(value),
  });
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
    runtimeInstanceLabel, workflowInputs, resolveWorkflowRef,
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
    fieldLabel, actionLabel, disconnect, bindAssetPreview,
    openAssetBrowser, openWorkflowBrowser,
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
    requestOpenWorkflowReference, openWorkflowBrowser, render, contextMenuSuppressedByPan,
    removeInstanceRun, removeVariableCard, setVariableCardSelection, variableCardList, worldPoint, snapshot,
    runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H, runVariableHeight: RUN_VARIABLE_H, portRadius: PORT_R,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H, variableCardPortY: VARIABLE_CARD_PORT_Y,
  });
  const { renderInstanceRunCard, renderVariableCard, registerCardPress } = Cards;

  const InlineEditor = createCanvasInlineEditor({
    state, wrap, el, mutate, clearParameterLiteralCache, rememberParameterLiteral, variableLinks,
    showMenu, nodeVariablePinMenuItems, requestInspector,
    toast: (message, error) => toast(message, error), enumOption, fieldLabel,
    openAssetBrowser, openWorkflowBrowser, requestRoi,
  });
  const { openParamEditor, closeInlineEditor, setParamLiteral, refreshInlineEditor } = InlineEditor;
  const NodeNameEditor = createNodeNameEditor({
    state, wrap, el, position: viewPosition, renameGroup,
    renameNode: (id, value) => {
      const node = nodeById(id);
      if (!node) return false;
      const name = String(value || '').trim();
      mutate(() => { if (name) node.name = name; else delete node.name; });
      return true;
    },
    nodeWidth: NODE_W,
  });

  const NodeCard = createNodeCardRenderer({
    state, svgEl, nodeCards, position: viewPosition, nodeHeight: viewNodeHeight, nodeRowHeight,
    subWorkflowRef, templatePreview,
    compositeSubtitle, variableDisplayNameOf, referenceDisplayNameOf: (ref) => referenceDisplayName(ref),
    nodeIssueInfo, issueTitle,
    decoratorLabel, nodeVariablePins: viewNodeVariablePins, openLightbox,
    disconnectVariableFromPin, startVariableConnectionFromPin,
    openPortContextMenu, showMenu,
    nodeVariablePinMenuItems, nodeInputPortMenuItems, nodeOutputPortMenuItems,
    startConnectionFromInput, startConnection, startReferenceConnection,
    nodeReferencePortMenuItems, nodeGroupVariableMenuItems: candidateMenu,
    startNodeDrag,
    registerCardPress, requestInspector, requestOpenSubWorkflow, render,
    enterNodeGroup: enterGroup, ungroupNodeGroup: ungroup, groupSelection,
    focusNodeDetail,
    contextMenuSuppressedByPan,
    copySelection, cutSelection, deleteSelection,
    paramRowInfo, toggleParamRows, paramRowMenuItems,
    openParamEditor,
    compactValue,
    typeIcons: TYPE_ICON, typeNames: TYPE_NAMES, runLabels: RUN_LABEL,
    nodeGroupRunSummary,
    nodeWidth: NODE_W, baseHeight: BASE_H, portRadius: PORT_R, decoratorHeight: DECO_H,
    runVariableHeight: RUN_VARIABLE_H, variablePinX: VARIABLE_PIN_X, taskOutputPortY: TASK_OUTPUT_PORT_Y, preview: PREVIEW,
  });
  const { renderNode, patchNodeRuntime } = NodeCard;

  const RenderEntry = createRenderEntry({
    state, $, graph, wrap, measurement: wrapMeasurement, svgEl, UI, nodes: viewNodes, nodeById: viewNodeById, position: viewPosition, nodeHeight: viewNodeHeight, nodeRowHeight, nodeVariablePins: viewNodeVariablePins,
    instanceRunCards: viewInstanceRunCards, variableCardList,
    renderNode, renderInstanceRunCard, renderVariableCard,
    renderEdge, renderInstanceRunEdge, renderConnection,
    renderVariableConnection, renderReferenceConnection, renderReferenceEdges, renderVariableEdges,
    renderMinimap: () => refreshMinimap(),
    renderInspector,
    postSidebarState, updateIssueBadge,
    ensureLayout, syncLegacyInputParameters, syncLegacyVariableCards, setDirty,
    // 变量卡片按文档里的绝对坐标绘制，裁剪与空间索引也读同一对坐标——
    // 这里刻意不再注入位置函数：`CanvasWorkflowModel.variableCardPosition(node, index)`
    // 是「把卡片放到某节点某一行旁边」的节点侧算法，用在卡片上会让所有卡片塌到同一个点。
    nodeIssueInfo: (node) => nodeIssueInfo(node),
    nodeRunStatus: (node) => node?._nodeGroup
      ? String(nodeGroupRunSummary(String(node._nodeGroupId || node.id))?.status || '')
      : String(state.run.get(node.id)?.status || ''),
    patchNodeRuntime,
    // 校验错误的整份指纹：一次遍历把所有节点的错误数折叠成一个字符串，
    // 避免每张卡片各查一次（500 节点首帧的主要开销就在这里）。
    issueFingerprint: () => {
      const map = documentIssues();
      if (!map.size) return '';
      const parts: string[] = [];
      for (const [id, info] of map) {
        let params = 0;
        if (info && info.params && typeof info.params.forEach === 'function') {
          info.params.forEach((items: any[]) => { params += (items || []).length; });
        }
        parts.push(`${id}:${(info && info.node ? info.node.length : 0)}/${params}`);
      }
      return parts.sort().join(',');
    },
    referenceSourceIds: (node) => {
      const ids: string[] = [];
      for (const pin of nodeVariablePins(node)) {
        const ref = pin && pin.value && typeof pin.value === 'object' && !Array.isArray(pin.value) && typeof pin.value.ref === 'string'
          ? pin.value.ref
          : '';
        const match = /^nodes\.([^\.]+)\.output/.exec(ref);
        if (match && match[1] !== node.id) ids.push(match[1]);
      }
      return ids;
    },
    patchers: {
      // 拖动节点：只更新这个节点的 transform 与相邻连线路径，不重建整张画布。
      nodeEdges: (id) => {
        if (state.variableConnect || state.referenceConnect || state.connect) return; // 拖临时连线时数据边本来就要重画
        // 使用当前画布投影而不是原始运行节点：拖动节点组时，组卡本身只存在于投影视图中。
        for (const edge of adjacentEdges(id)) patchEdge(edge.parent, edge.childId, edge.order);
        for (const card of viewInstanceRunCards()) {
          if (card.node.id !== id) continue;
          patchInstanceRunEdge(card);
        }
        patchNodeDataEdges(id);
      },
    },
    beforeEdgeRebuild: () => resetPatchRegistry(),
    afterRender: () => { refreshInlineEditor(); NodeNameEditor.refresh(); },
    nodeWidth: NODE_W,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
    runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H,
  });
  renderPieces = RenderEntry;

  /** 小地图结构签名：只有布局/结构变化时才重建缩略矩形，平移缩放只更新视口框。 */
  let minimapStructureSeen = '';
  function minimapStructureKey(): string {
    const parts: string[] = [];
    for (const node of viewNodes()) {
      const pos = viewPosition(node);
      parts.push(`${node.id}:${pos.x},${pos.y},${viewNodeHeight(node)}`);
    }
    for (const card of viewInstanceRunCards()) parts.push(`r${card.key}:${card.x},${card.y},${card.height}`);
    for (const card of variableCardList()) parts.push(`v${card.id}:${card.x},${card.y}`);
    return parts.join('|');
  }
  const refreshMinimap = (): void => {
    const key = minimapStructureKey();
    const structure = key !== minimapStructureSeen;
    minimapStructureSeen = key;
    renderMinimap({ structure });
  };

  const RunEvents = createRunEvents({
    state, nodes, nodeById, clone, render, patchRunEdgeStates, deleteSelection, removeVariableCards, removeVariableCard,
    removeInstanceRun, removeVariable,
  });
  const { handleRunEvent, deleteCurrentSelection } = RunEvents;

  const EditorCommandDispatch = createEditorCommandDispatch({
    convertInputToVariable: VariableInspectors.convertInputToVariable,
    requestInspectorRename,
    renameVariable: VariableInspectors.renameVariable,
    state, mutate, nodes, nodeById, selectionNodeById: (id) => viewNodeById(id) || nodeById(id), undo, redo, fitView, autoLayout, copySelection, cutSelection,
    pasteClipboard, deleteSelection, addNode, render: renderGraph, focusNode, searchNodeByName, exportFullCanvasImage,
    addVariable, clearVariableCardSelection, deleteCurrentSelection, renderInspector, addVariableCardCommand,
    deleteVariable,
    showVariableReferences: VariableInspectors.showVariableReferences,
    disconnectVariableReference: VariableInspectors.disconnectVariableReference,
    disconnectAllVariableReferences: VariableInspectors.disconnectAllVariableReferences,
    confirmPendingRename: VariableInspectors.confirmPendingRename,
    cancelPendingRename: VariableInspectors.cancelPendingRename,
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
  // 滚轮缩放：事件可以远高于帧率，累积到本帧只做一次视口更新。
  graph.addEventListener('wheel', (event) => {
    event.preventDefault();
    wheelZoom *= event.deltaY < 0 ? 1.12 : 1 / 1.12;
    wheelPoint = { x: event.clientX, y: event.clientY };
    if (wheelScheduled) return;
    wheelScheduled = true;
    requestAnimationFrame(() => {
      wheelScheduled = false;
      const factor = wheelZoom;
      const point = wheelPoint;
      wheelZoom = 1;
      zoomAt(factor, point?.x, point?.y);
    });
  }, { passive: false });
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
    if (state.clipboard && state.clipboard.nodes.length > 0) {
      items.push({ label: `粘贴 (Ctrl+V) · ${state.clipboard.nodes.length} 个节点`, run: () => pasteClipboard(point) });
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
    openNodeNameEditor: (node) => {
      closeInlineEditor();
      return NodeNameEditor.open(node);
    },
    undo, redo, fitView, nodeById: viewNodeById, position: viewPosition, nodeHeight: viewNodeHeight, nodeWidth: NODE_W, bounds,
  });
  InputBridge.install();
  const CanvasMessages = createCanvasMessages({
    state, $, mutate, nodeById, normalizeRaw, clearVariableCardSelection, setDirty, render, fitView, ensureLayout,
    renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, renderInspector, renderAssetBrowser,
    renderWorkflowBrowser, resolveWorkflowRef,
    closeAssetBrowser, renderTemplateCheck, restoreAssetBrowserAfterRoi, openRoiPicker, requestAssetInventory,
    normalizedAssetPath, handleRunEvent, patchRunEdgeStates, setExportBusy,
    replaceDocument: (text: string, record?: boolean) => { closeInlineEditor(); NodeNameEditor.close(); replaceDocument(text, record); },
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
  const benchmark: CanvasBenchmarkApi = {
    stats: () => renderPieces?.stats() ?? null,
    domCounts: () => {
      const layer = renderPieces?.controller.getLayer();
      const count = (parent: any): number => {
        if (!parent) return 0;
        if (Array.isArray(parent.children)) return parent.children.length;
        if (typeof parent.childElementCount === 'number') return parent.childElementCount;
        return 0;
      };
      const nodes = count(layer?.cards);
      const edges = count(layer?.wires);
      const variableEdges = count(layer?.variableEdges) + count(layer?.referenceEdges);
      const variableCards = count(layer?.variableCards);
      return {nodes, edges, variableEdges, variableCards, total: nodes + edges + variableEdges + variableCards};
    },
    panBy: (dx, dy) => { state.panX += dx; state.panY += dy; render({ viewport: true }); },
    zoomBy: (factor) => { zoomAt(factor); },
    selectNode: (id) => {
      const target = id || nodes()[0]?.id || null;
      if (!target || !nodeById(target)) return null;
      state.selected = new Set([target]);
      state.selectedEdge = null;
      state.selectedRun = null;
      state.inspector = 'node';
      render({ selection: true, panels: true });
      return target;
    },
    dragSelected: (dx, dy) => {
      const ids = [...state.selected];
      if (!ids.length) return;
      const origins: Record<string, { x: number; y: number }> = {};
      for (const id of ids) {
        const node = nodeById(id);
        if (!node) continue;
        const pos = position(node);
        origins[id] = { x: pos.x, y: pos.y };
        layout()[id] = { x: Math.round(pos.x + dx), y: Math.round(pos.y + dy) };
      }
      // 与真实拖拽一致：只走视口 + 交互标记，不重建卡片。
      state.drag = { kind: 'nodes', start: { x: 0, y: 0 }, origins, before: '', moved: true };
      render({ viewport: true, interaction: true });
    },
    endDrag: () => { state.drag = null; },
    flushViewport: () => render({ viewport: true }),
    activeNodeCount: () => renderPieces?.controller.activeNodeIds().length ?? 0,
    detailLevel: () => renderPieces?.detailLevel() ?? null,
  };
  const handle: CanvasEditorHandle = {
    state, connect, disconnect, autoLayout, render, exportFullCanvasImage, copySelection, cutSelection, pasteClipboard,
    snapshot: () => JSON.stringify(state.raw), collectExportTemplatePaths, applyInlineThumbnails, placeVariableCard, variableCardList,
    nodeVariablePins, collectNodeCardVariableRefs, connectVariableToPin, referenceFieldsForPin, nodeOutputFields,
    removeVariable, deleteVariable, renderInspector,
    benchmark,
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
    if (node && pin && paramRowKindOf(pin, pin.definition) === 'rect') {
      items.push({ label: '在当前画面上框选区域…', run: () => requestRoi(nodeId, String(pin.param), 'rect') });
    }
    if (pin && pin.configured) {
      items.push({ label: '恢复默认值', run: () => { if (node) setParamLiteral(node, String(pin.param), undefined); } });
    }
    items.push({ label: '在详情栏编辑', run: () => requestInspector({ kind: 'node', nodeId }) });
    return items;
  }

  /** 重绘入口占位：RenderEntry 就绪后赋值（模块直接引用 render/focusNode 函数本身）。 */
  function render(flags?: RenderFlags): void {
    // 无标记的 `render()` 是「刷新画面」：卡片内容按内容签名对账，
    // 但平移/缩放等高频路径必须显式传标记，否则会触发多余的连线重建。
    const next: RenderFlags = flags ?? { graph: true, minimap: true, panels: true, selection: true };
    renderPieces?.render(next);
  }
  function focusNode(id: string, param?: string): void {
    renderPieces?.focusNode(id, param);
  }
  /** 双击节点：自动聚焦并放大到完整卡片档。 */
  function focusNodeDetail(id: string): void {
    renderPieces?.focusNodeDetail(id);
  }
  /**
   * 文档结构变化后的重绘：节点/连线与面板都要对账。
   * 历史与命令层走这里，避免它们各自猜标记。
   */
  function renderGraph(): void {
    renderPieces?.render({ graph: true, minimap: true, panels: true, selection: true });
  }
}
