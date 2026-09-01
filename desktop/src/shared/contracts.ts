export interface ParameterInfo {
  type: string;
  public?: boolean;
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
  variables?: Array<{
    name: string;
    public: boolean;
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
  catalog: ActionSpec[];
  refs: {
    blackboard: string[];
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
  bootstrap(): Promise<BootstrapData>;
  getWorkflowInit(uri: string, selectedInstance: string, canGoBack: boolean): Promise<WorkflowEditorInit>;
  saveWorkflow(uri: string, text: string): Promise<void>;
  createWorkflow(): Promise<string | undefined>;
  openWorkflowFile(uri: string): Promise<void>;
  openContentItem(path: string): Promise<void>;
  getReferenceGraph(target: string): Promise<ReferenceGraph>;
  runWorkflow(request: RunWorkflowRequest): Promise<void>;
  stopWorkflow(): Promise<void>;
  listInstances(): Promise<RuntimeInstance[]>;
  listAssets(): Promise<AssetImage[]>;
  readAssetData(paths: string[]): Promise<Array<{ path: string; dataUrl: string }>>;
  saveTemplate(request: SaveTemplateRequest): Promise<string>;
  saveCanvas(request: SaveCanvasRequest): Promise<string | undefined>;
  captureRoi(request: RoiCaptureRequest): Promise<RoiCaptureResult>;
  checkTemplate(request: TemplateCheckRequest): Promise<TemplateCheckResult>;
  onRuntimeOutput(listener: (event: RuntimeOutputEvent) => void): () => void;
  onRuntimeState(listener: (event: RuntimeStateEvent) => void): () => void;
  onRunEvent(listener: (event: Record<string, unknown>) => void): () => void;
  onWindowMaximized(listener: (maximized: boolean) => void): () => void;
}
