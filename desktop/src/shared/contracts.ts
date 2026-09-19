import type { AppearanceTheme } from './appearance';
import type { ActionCardRow } from './parameter-types';

export interface ParameterInfo {
  type: string;
  display_name?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  editor?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  enum?: unknown[];
  minItems?: number;
  maxItems?: number;
  items?: ParameterInfo;
  properties?: Record<string, ParameterInfo>;
}

export interface WorkflowDescriptor {
  uri: string;
  name: string;
  rel: string;
  id?: string;
  description?: string;
  source?: 'generated' | 'project';
  validationStatus?: 'valid' | 'invalid' | 'unknown';
  updatedAt?: number;
  inputs?: Array<{
    name: string;
    definition: ParameterInfo;
  }>;
}

export interface RuntimeInstance {
  id: string;
  backend?: string;
  adbSerial?: string;
  mumuIndex?: number;
  displayName?: string;
}

export interface ActionSpec {
  name: string;
  version: string;
  entry: string;
  description: string;
  parameters: Record<string, ParameterInfo>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  outputFields: string[];
  retry: string;
  retrySafe: boolean;
  sideEffect: boolean;
  source: string;
  /** 清单声明的固定卡片端点（有序）；未声明时为空，编辑器退回「必填 + 已配置」卡片。 */
  card?: ActionCardRow[];
}

export interface ValidationIssue {
  path: Array<string | number>;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code?: string;
}

export interface BootstrapData {
  projectRoot: string;
  workflows: WorkflowDescriptor[];
  instances: RuntimeInstance[];
  catalog: ActionSpec[];
  defaultWorkflow?: string;
}

export interface WorkflowEditorInit {
  type: 'init';
  document: {
    uri: string;
    name: string;
    text: string;
  };
  workflows: WorkflowDescriptor[];
  canGoBack: boolean;
  workflowTrail?: Array<{ uri: string; name: string }>;
  catalog: ActionSpec[];
  refs: {
    inputs: string[];
    variables: string[];
    nodes: string[];
  };
  issues: ValidationIssue[];
  projectRoot: string;
  assetsBaseUri: string;
  instances: RuntimeInstance[];
  selectedInstance: string;
}

export interface RuntimeOutputEvent {
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  timestamp: number;
}

export interface RuntimeStateEvent {
  state: 'idle' | 'running' | 'stopping' | 'succeeded' | 'failed';
  label: string;
  workflow?: string;
  instance?: string;
  exitCode?: number | null;
  startedAt?: number;
  sources?: Array<{
    id: string;
    label: string;
    workflow: string;
    instance: string;
    startedAt: number;
    status: string;
  }>;
}

export interface AssetImage {
  path: string;
  uri: string;
}

export interface MoveContentRequest {
  /** 要移动的项目相对文件路径（正斜杠）。 */
  sourcePath: string;
  /** 目标文件夹的项目相对路径（不含文件名）。 */
  targetFolder: string;
}

export interface ContentRewriteDetail {
  /** 被改写引用的文件项目相对路径（正斜杠）。 */
  path: string;
  /** 该文件内被替换掉的引用处数。 */
  references: number;
}

export interface MoveContentResult {
  sourcePath: string;
  targetPath: string;
  updatedFiles: number;
  updatedReferences: number;
  /** 被改写引用的文件明细，按引用处数降序；没有引用需要改写时为空数组。 */
  rewritten: ContentRewriteDetail[];
}

export interface CreateContentFolderRequest {
  /** 父文件夹的项目相对路径，只允许位于 assets 或 workflows 下。 */
  parentPath: string;
  /** 新文件夹名称，不包含路径分隔符。 */
  name: string;
}

export interface RenameContentRequest {
  /** 要重命名的文件或文件夹项目相对路径。 */
  sourcePath: string;
  /** 新名称，不包含路径分隔符。 */
  newName: string;
}

export interface RoiCaptureRequest {
  instanceId?: string;
  referenceResolution: [number, number];
}

export interface RoiCaptureResult {
  dataUrl: string;
  width: number;
  height: number;
}

export interface TemplateCheckRequest {
  template: string;
  roi?: [number, number, number, number];
  threshold: number;
  maxResults: number;
  scaleSearch: boolean;
  referenceResolution: [number, number];
  instanceId?: string;
}

export interface TemplateCheckResult extends RoiCaptureResult {
  roi: [number, number, number, number];
  matches: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  }>;
}

export interface RunWorkflowRequest {
  uri: string;
  instanceId: string;
  text: string;
  inputs?: Record<string, unknown>;
}

/** 模拟器画面测试工具：后端推流事件（JSON 行协议透传，附带 type 字段）。 */
export type VisionStreamEvent = {
  type: string;
  [key: string]: unknown;
};

/** 模拟器画面测试工具：发给后端流服务的一条命令。 */
export type VisionCommand = {
  type: string;
  id?: number;
  [key: string]: unknown;
};

/** 实时视觉监视窗口：参考坐标下的一个高亮框。 */
export interface LiveViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LiveViewRoi {
  label: string;
  box: number[];
}

export interface LiveViewMatch {
  confidence: number;
  box: number[];
  template: string | null;
  threshold: number | null;
}

export interface LiveViewOcr {
  text: string;
  confidence: number;
  box: number[];
}

/** 一次点击：参考起点 → 实际落点（都是参考分辨率坐标）。 */
export interface LiveViewClick {
  reference: number[];
  actual: number[];
  hold_ms: number;
}

export interface LiveViewOverlay {
  rois: LiveViewRoi[];
  matches: LiveViewMatch[];
  ocr: LiveViewOcr[];
  clicks: LiveViewClick[];
}

/** 运行时步骤事件里状态条需要的字段。 */
export interface LiveViewStep {
  step_id?: string | null;
  name?: string | null;
  action?: string | null;
  node_kind?: string | null;
  status?: string | null;
  workflow_id?: string | null;
  workflow_path?: string[] | null;
  workflow_depth?: number | null;
  duration_ms?: number | null;
  error?: string | null;
  error_category?: string | null;
}

/** 运行时写给桌面端的一帧“眼中的画面”。 */
export interface LiveViewFrame {
  seq: number;
  ts: number;
  instance_id: string;
  step: LiveViewStep;
  overlay: LiveViewOverlay;
  /** 预览帧自身的像素尺寸。 */
  frame_width: number;
  frame_height: number;
  /** 标注框所在坐标系（参考分辨率）。 */
  reference_width: number;
  reference_height: number;
  /** 预览帧的 JPEG base64。 */
  image: string;
}

export type LiveViewPollResult =
  | { status: 'frame'; frame: LiveViewFrame }
  | { status: 'unchanged'; seq: number }
  | { status: 'idle'; message: string };

export interface RuntimeDebugSettings {
  enabled: boolean;
  annotateScreenshots: boolean;
}

export interface SaveTemplateRequest {
  targetPath?: string;
  filename: string;
  dataUrl: string;
}

export interface SaveCanvasRequest {
  filename: string;
  dataUrl: string;
}

/** 引用查看器：引用图中一个节点（工作流 / 模板图片 / 奖励目录 / 其他）。 */
export type ReferenceTargetKind = 'workflow' | 'asset' | 'catalog' | 'other';

export interface ReferenceNode {
  kind: ReferenceTargetKind;
  /** 项目相对路径（正斜杠）。 */
  path: string;
  /** 显示名（文件基名）。 */
  name: string;
  workflowId?: string;
  description?: string;
  /** 目标文件当前是否存在于磁盘。 */
  exists: boolean;
}

/** 一次具体引用发生的位置 / 方式。 */
export type ReferenceContextKind = 'workflow.run' | 'instance_parallel' | 'template' | 'template-binding' | 'asset-default' | 'catalog-entry';

export interface ReferenceContext {
  kind: ReferenceContextKind;
  /** 人类可读说明（节点名 / 变量名 / 目录条目名）。 */
  label: string;
  nodeId?: string;
  nodeName?: string;
  variable?: string;
  /** 引用原文。 */
  reference: string;
}

/** 引用图中一个条目：某个被引用 / 引用方节点 + 它身上的若干处引用。 */
export interface ReferenceItem {
  target: ReferenceNode;
  contexts: ReferenceContext[];
}

/** 引用图：目标节点 + 谁引用了我（incoming）+ 我引用了谁（outgoing）。 */
export interface ReferenceGraph {
  target: ReferenceNode;
  referencedBy: ReferenceItem[];
  references: ReferenceItem[];
}

export interface OnmyojiDesktopApi {
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<boolean>;
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  readLayout(key: string): string | null;
  getTheme(): AppearanceTheme;
  setTheme(theme: AppearanceTheme): AppearanceTheme;
  onThemeChanged(listener: (theme: AppearanceTheme) => void): () => void;
  writeLayout(key: string, value: string | null): void;
  bootstrap(): Promise<BootstrapData>;
  getWorkflowInit(uri: string, selectedInstance: string, canGoBack: boolean): Promise<WorkflowEditorInit>;
  saveWorkflow(uri: string, text: string): Promise<void>;
  createWorkflow(): Promise<string | undefined>;
  openWorkflowFile(uri: string): Promise<void>;
  openContentItem(path: string): Promise<void>;
  moveContent(request: MoveContentRequest): Promise<MoveContentResult>;
  listContentFolders(): Promise<string[]>;
  createContentFolder(request: CreateContentFolderRequest): Promise<string>;
  renameContent(request: RenameContentRequest): Promise<MoveContentResult>;
  deleteContent(path: string): Promise<void>;
  getReferenceGraph(target: string): Promise<ReferenceGraph>;
  runWorkflow(request: RunWorkflowRequest): Promise<void>;
  stopWorkflow(): Promise<void>;
  getDebugSettings(): Promise<RuntimeDebugSettings>;
  updateDebugSettings(settings: RuntimeDebugSettings): Promise<RuntimeDebugSettings>;
  listInstances(): Promise<RuntimeInstance[]>;
  listAssets(): Promise<AssetImage[]>;
  readAssetData(paths: string[]): Promise<Array<{ path: string; dataUrl: string }>>;
  saveTemplate(request: SaveTemplateRequest): Promise<string>;
  saveCanvas(request: SaveCanvasRequest): Promise<string | undefined>;
  captureRoi(request: RoiCaptureRequest): Promise<RoiCaptureResult>;
  checkTemplate(request: TemplateCheckRequest): Promise<TemplateCheckResult>;
  /** 打开（或聚焦）独立的模拟器画面测试工具窗口。 */
  openVisionTest(instanceId: string): Promise<void>;
  /** 打开（或聚焦）独立的实时视觉监视窗口。 */
  openLiveView(instanceId: string): Promise<void>;
  /** 实时视觉窗口内调用：开启/关闭对运行时预览帧的轮询。 */
  liveViewWatch(watching: boolean): Promise<void>;
  /** 实时视觉窗口内调用：设置刷新间隔（毫秒），会下发给正在运行的预览通道。 */
  liveViewSetInterval(intervalMs: number): Promise<number>;
  /** 实时视觉窗口内调用：取一帧最新画面（无新帧时返回 unchanged）。 */
  liveViewPoll(): Promise<LiveViewPollResult>;
  /** 用系统默认程序打开项目 README 使用说明。 */
  openReadme(): Promise<void>;
  /** 工具窗口页面内调用：开始画面推流并订阅事件。 */
  visionStart(): Promise<void>;
  /** 工具窗口页面内调用：向推流服务发送一条命令。 */
  visionCommand(command: VisionCommand): Promise<void>;
  /** 工具窗口页面内调用：停止画面推流。 */
  visionStop(): Promise<void>;
  onVisionEvent(listener: (event: VisionStreamEvent) => void): () => void;
  onRuntimeOutput(listener: (event: RuntimeOutputEvent) => void): () => void;
  onRuntimeState(listener: (event: RuntimeStateEvent) => void): () => void;
  onRunEvent(listener: (event: Record<string, unknown>) => void): () => void;
  onWindowMaximized(listener: (maximized: boolean) => void): () => void;
}
