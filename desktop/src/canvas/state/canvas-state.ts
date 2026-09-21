/**
 * 画布状态：文档数据、选择、视口与临时交互状态的唯一归属。
 * 原 `workflow-editor.js` 顶部的 state 字面量；每个画布实例创建一份，互不共享。
 *
 * 边界类型暂时保持宽松，待 commands/history/canvas 拆出后按职责收紧。
 */
import type { CanvasClipboardPayload } from '../../shared/editor-messages';

export interface CanvasRefs {
  inputs: string[];
  variables: string[];
  nodes: string[];
}

export interface CanvasNodeSearch {
  query: string;
  ids: string[];
  index: number;
}

/** 视口快照：画布位置前进/后退的最小单位（平移 + 缩放）。 */
export interface CanvasViewportSnapshot {
  panX: number;
  panY: number;
  zoom: number;
}

/** 自动排列预览：确认前只画虚影，不写文档、不进历史。 */
export interface CanvasArrangePreview {
  scope: string;
  nodes: Record<string, { x: number; y: number }>;
}

export interface CanvasState {
  raw: Record<string, any> | null;
  catalog: any[];
  refs: CanvasRefs;
  issues: any[];
  workflows: any[];
  docUri: string;
  documentName: string;
  workflowTrail: any[];
  instances: any[];
  instanceId: string;
  selected: Set<string>;
  selectedEdge: any;
  selectedRun: any;
  selectedVariable: string;
  selectedVariableScope: 'inputs' | 'variables';
  selectedVariableCardId: string;
  selectedVariableCardIds: Set<string>;
  zoom: number;
  panX: number;
  panY: number;
  /** 画布位置历史：平移/缩放/定位后记录，前进/后退在快照之间移动。 */
  viewportHistory: CanvasViewportSnapshot[];
  viewportHistoryIndex: number;
  /** 临时隐藏筛选：命中的运行状态 / 节点类型（null 表示该维度不过滤）。 */
  filterStatus: string[] | null;
  filterTypes: string[] | null;
  /** 最近一次定位/搜索的目标节点：小地图上单独标出来。 */
  searchTargetId: string;
  /** 排列预览（确认前不写文档）。 */
  arrangePreview: CanvasArrangePreview | null;
  drag: any;
  connect: any;
  variableConnect: any;
  /** 从任务卡输出口拖出的「节点输出引用」连线（写入 `nodes.<id>.output.<字段>`）。 */
  referenceConnect: any;
  marquee: any;
  undo: string[];
  redo: string[];
  dirty: boolean;
  /** 文档版本号：每次真正改动文档 +1；卡片错误标记用它给本地校验做缓存键。 */
  docVersion: number;
  inspector: string;
  sectionCollapsed?: Record<string, boolean>;
  run: Map<string, any>;
  roi: any;
  assetBrowser: any;
  assetPaths: Set<string> | null;
  assetInventoryRequestId: string;
  workflowBrowser: any;
  assetsBaseUri: string;
  templateCheck: any;
  exportBusy: boolean;
  nodeSearch: CanvasNodeSearch;
  /** 画布剪贴板：节点连同引用到的输入/变量与变量卡片；由壳层在所有画布之间同步。 */
  clipboard: CanvasClipboardPayload | null;
  paramLiteralCache: Record<string, any>;
  /** 展开全部参数行的节点（默认只显示必填 + 已配置，UE 的收起高级引脚）。 */
  paramRowsExpanded: Set<string>;
  mouse: any;
  /** 当前进入的编辑器节点组；空字符串表示工作流顶层。 */
  nodeGroupId: string;
  [key: string]: any;
}

export function createCanvasState(): CanvasState {
  return {
    raw: null,
    catalog: [],
    refs: { inputs: [], variables: [], nodes: [] },
    issues: [],
    workflows: [],
    docUri: '',
    documentName: '',
    workflowTrail: [],
    instances: [],
    instanceId: '',
    selected: new Set(),
    selectedEdge: null,
    selectedRun: null,
    selectedVariable: '',
    selectedVariableScope: 'inputs',
    selectedVariableCardId: '',
    selectedVariableCardIds: new Set(),
    zoom: 1,
    panX: 80,
    panY: 48,
    viewportHistory: [],
    viewportHistoryIndex: -1,
    filterStatus: null,
    filterTypes: null,
    searchTargetId: '',
    arrangePreview: null,
    drag: null,
    connect: null,
    variableConnect: null,
    referenceConnect: null,
    marquee: null,
    undo: [],
    redo: [],
    dirty: false,
    docVersion: 0,
    inspector: 'node',
    run: new Map(),
    roi: null,
    assetBrowser: null,
    assetPaths: null,
    assetInventoryRequestId: '',
    workflowBrowser: null,
    assetsBaseUri: '',
    templateCheck: null,
    exportBusy: false,
    nodeSearch: { query: '', ids: [], index: -1 },
    clipboard: null,
    paramLiteralCache: {},
    paramRowsExpanded: new Set(),
    mouse: null,
    nodeGroupId: '',
  };
}
