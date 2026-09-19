/**
 * 画布状态：文档数据、选择、视口与临时交互状态的唯一归属。
 * 原 `workflow-editor.js` 顶部的 state 字面量；每个画布实例创建一份，互不共享。
 *
 * 边界类型暂时保持宽松，待 commands/history/canvas 拆出后按职责收紧。
 */

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
  clipboard: any;
  clipboardLayout: Record<string, any> | null;
  paramLiteralCache: Record<string, any>;
  /** 展开全部参数行的节点（默认只显示必填 + 已配置，UE 的收起高级引脚）。 */
  paramRowsExpanded: Set<string>;
  mouse: any;
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
    clipboardLayout: null,
    paramLiteralCache: {},
    paramRowsExpanded: new Set(),
    mouse: null,
  };
}
