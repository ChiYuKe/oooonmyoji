/**
 * 编辑器 iframe → 壳层的消息契约：以 type 区分的联合类型。
 * 壳层在通信边界用 parseEditorMessage 收窄 unknown，未识别的消息直接忽略。
 * 迁移中的画布 (legacy workflow-editor.js) 与未来的 TypeScript 画布共用这份类型。
 */

/** 结构树节点（画布投影给壳层展示）。 */
export interface SidebarNode {
  id: string;
  name: string;
  type: string;
  meta: string;
  children: string[];
}

/** 变量列表条目（画布投影给壳层展示）。 */
export interface SidebarVariable {
  name: string;
  displayName?: string;
  group?: string;
  type: string;
  scope: 'inputs' | 'variables';
  public?: boolean;
  onCard?: boolean;
}

/** 详细信息面板的选中项（画布投影给壳层转发）。 */
export interface InspectorSelection {
  kind: 'none' | 'node' | 'run' | 'edge' | 'variables' | 'workflow';
  nodeId?: string;
  index?: number;
  parent?: string;
  child?: string;
  name?: string;
  scope?: 'inputs' | 'variables';
}

export interface ReadyMessage {
  type: 'ready';
}

export interface CreateVariableNodeMessage {
  type: 'createVariableNode';
  name?: unknown;
  scope?: unknown;
}

export interface DocumentStateChangedMessage {
  type: 'documentStateChanged';
  text?: unknown;
  dirty?: unknown;
}

export interface InspectorRequestedMessage {
  type: 'inspectorRequested';
  inspectorSelection?: unknown;
}

/** F2 重命名：文档画布请宿主把「聚焦详情栏名称输入框」转给详细信息镜像。 */
export interface InspectorRenameRequestedMessage {
  type: 'inspectorRenameRequested';
}

export interface SidebarStateChangedMessage {
  type: 'sidebarStateChanged';
  nodes?: unknown;
  variables?: unknown;
  selectedVariable?: unknown;
  selectedVariableScope?: unknown;
  selectedNode?: unknown;
  inspectorSelection?: unknown;
}

export interface SaveMessage {
  type: 'save';
  text?: unknown;
}

export interface SwitchWorkflowMessage {
  type: 'switchWorkflow';
  uri?: unknown;
  saveText?: unknown;
}

export interface OpenSubWorkflowMessage {
  type: 'openSubWorkflow';
  reference?: unknown;
  nodeId?: unknown;
  saveText?: unknown;
}

export interface GoBackWorkflowMessage {
  type: 'goBackWorkflow';
  saveText?: unknown;
}

export interface NavigateWorkflowTrailMessage {
  type: 'navigateWorkflowTrail';
  index?: unknown;
  saveText?: unknown;
}

export interface ReloadRequestMessage {
  type: 'reloadRequest';
}

export interface RunWorkflowMessage {
  type: 'runWorkflow';
  text?: unknown;
  instanceId?: unknown;
}

export interface StopWorkflowMessage {
  type: 'stopWorkflow';
}

export interface SelectInstanceMessage {
  type: 'selectInstance';
  instanceId?: unknown;
}

export interface PickRoiMessage {
  type: 'pickRoi';
  requestId?: unknown;
  nodeId?: unknown;
  stepId?: unknown;
  key?: unknown;
  mode?: unknown;
  targetPath?: unknown;
  instanceId?: unknown;
  referenceResolution?: unknown;
}

export interface CheckTemplateMessage {
  type: 'checkTemplate';
  template?: unknown;
  roi?: unknown;
  threshold?: unknown;
  maxResults?: unknown;
  scaleSearch?: unknown;
  referenceResolution?: unknown;
  instanceId?: unknown;
  requestId?: unknown;
}

export interface ListAssetImagesMessage {
  type: 'listAssetImages';
  requestId?: unknown;
}

export interface RequestAssetDataMessage {
  type: 'requestAssetData';
  paths?: unknown;
  requestId?: unknown;
}

export interface SaveTemplateMessage {
  type: 'saveTemplate';
  targetPath?: unknown;
  filename?: unknown;
  dataUrl?: unknown;
  requestId?: unknown;
  nodeId?: unknown;
  stepId?: unknown;
  key?: unknown;
}

export interface SaveCanvasImageMessage {
  type: 'saveCanvasImage';
  filename?: unknown;
  dataUrl?: unknown;
}

export interface NewWorkflowMessage {
  type: 'newWorkflow';
}

export interface OpenFileMessage {
  type: 'openFile';
}

export interface OpenWorkflowPickerMessage {
  type: 'openWorkflowPicker';
}

export interface OpenWorkflowTreeMessage {
  type: 'openWorkflowTree';
}

export interface OpenReferencesMessage {
  type: 'openReferences';
}

/** 删除被引用的变量时，把引用清单交给壳层的「变量引用」面板。 */
export interface VariableReferencesRequestedMessage {
  type: 'variableReferencesRequested';
  scope: 'inputs' | 'variables';
  name: string;
  displayName?: string;
  entries?: unknown;
}

export interface EditorErrorMessage {
  type: 'error';
  message?: unknown;
}

/** 画布要一次最新的脚本目录（打开子工作流选择器时）。 */
export interface RefreshWorkflowsMessage {
  type: 'refreshWorkflows';
}

/** 剪贴板里被节点引用到的输入/变量定义（粘贴到别的文档时按需补过去）。 */
export interface CanvasClipboardVariable {
  scope: 'inputs' | 'variables';
  name: string;
  definition: Record<string, unknown>;
}

/** 这些变量在源画布上的卡片位置（目标文档没有该变量的卡片时才补）。 */
export interface CanvasClipboardCard {
  scope: 'inputs' | 'variables';
  name: string;
  x: number;
  y: number;
}

/**
 * 画布剪贴板：节点卡片连同它们引用到的输入/变量与变量卡片一起搬运。
 * 存在壳层里，所以同一窗口的任意画布（含弹出到独立窗口的面板）共用同一份剪贴板。
 */
export interface CanvasClipboardPayload {
  /** 结构版本；换结构时同步改 parseCanvasClipboard。 */
  version: 1;
  /** 复制来源文档 URI：同文档粘贴不补变量/卡片（源文档里本来就有）。 */
  sourceUri: string;
  /** 被复制的节点（含子树）。节点结构由画布侧宽松处理，这里只保证是对象数组。 */
  nodes: any[];
  /** 节点 id → 世界坐标。 */
  layout: Record<string, { x: number; y: number }>;
  /** 被复制节点引用到的输入/变量定义。 */
  variables: CanvasClipboardVariable[];
  /** 这些变量在源画布上的卡片。 */
  cards: CanvasClipboardCard[];
}

/** 画布 → 壳层：把刚复制的卡片交给壳层保管（并广播给其他画布）。 */
export interface ClipboardWriteMessage {
  type: 'clipboardWrite';
  clipboard?: unknown;
}

/** 壳层 → 画布：当前剪贴板内容（复制后广播，以及新画布握手时补发）。 */
export interface ClipboardMessage {
  type: 'clipboard';
  clipboard?: unknown;
}

export type EditorMessage =
  | ReadyMessage
  | CreateVariableNodeMessage
  | DocumentStateChangedMessage
  | InspectorRequestedMessage
  | InspectorRenameRequestedMessage
  | SidebarStateChangedMessage
  | SaveMessage
  | SwitchWorkflowMessage
  | OpenSubWorkflowMessage
  | GoBackWorkflowMessage
  | NavigateWorkflowTrailMessage
  | ReloadRequestMessage
  | RunWorkflowMessage
  | StopWorkflowMessage
  | SelectInstanceMessage
  | PickRoiMessage
  | CheckTemplateMessage
  | ListAssetImagesMessage
  | RequestAssetDataMessage
  | SaveTemplateMessage
  | SaveCanvasImageMessage
  | NewWorkflowMessage
  | OpenFileMessage
  | OpenWorkflowPickerMessage
  | OpenWorkflowTreeMessage
  | OpenReferencesMessage
  | VariableReferencesRequestedMessage
  | EditorErrorMessage
  | RefreshWorkflowsMessage
  | ClipboardWriteMessage;

export const EDITOR_MESSAGE_TYPES = [
  'ready',
  'createVariableNode',
  'documentStateChanged',
  'inspectorRequested',
  'inspectorRenameRequested',
  'sidebarStateChanged',
  'save',
  'switchWorkflow',
  'openSubWorkflow',
  'goBackWorkflow',
  'navigateWorkflowTrail',
  'reloadRequest',
  'refreshWorkflows',
  'runWorkflow',
  'stopWorkflow',
  'selectInstance',
  'pickRoi',
  'checkTemplate',
  'listAssetImages',
  'requestAssetData',
  'saveTemplate',
  'saveCanvasImage',
  'newWorkflow',
  'openFile',
  'openWorkflowPicker',
  'openWorkflowTree',
  'openReferences',
  'variableReferencesRequested',
  'error',
  'clipboardWrite',
] as const;

export type EditorMessageType = (typeof EDITOR_MESSAGE_TYPES)[number];

/** 通信边界校验：只放行带已知 type 的对象消息。 */
export function parseEditorMessage(value: unknown): EditorMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !(EDITOR_MESSAGE_TYPES as readonly string[]).includes(type)) return undefined;
  return value as EditorMessage;
}

function isClipboardVariable(value: unknown): value is CanvasClipboardVariable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record.scope === 'inputs' || record.scope === 'variables')
    && typeof record.name === 'string' && record.name.length > 0
    && Boolean(record.definition) && typeof record.definition === 'object' && !Array.isArray(record.definition);
}

function isClipboardCard(value: unknown): value is CanvasClipboardCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record.scope === 'inputs' || record.scope === 'variables')
    && typeof record.name === 'string' && record.name.length > 0
    && Number.isFinite(record.x) && Number.isFinite(record.y);
}

/**
 * 通信边界校验：壳层转发过来的剪贴板必须是本版本的结构。
 * 缺字段就补齐、非法条目直接丢掉，画布只管用它粘贴，不再自己判结构。
 */
export function parseCanvasClipboard(value: unknown): CanvasClipboardPayload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return undefined;
  if (!Array.isArray(record.nodes) || record.nodes.length === 0) return undefined;
  const layout = record.layout && typeof record.layout === 'object' && !Array.isArray(record.layout)
    ? record.layout as Record<string, { x: number; y: number }>
    : {};
  return {
    version: 1,
    sourceUri: typeof record.sourceUri === 'string' ? record.sourceUri : '',
    nodes: record.nodes as any[],
    layout,
    variables: Array.isArray(record.variables) ? record.variables.filter(isClipboardVariable) : [],
    cards: Array.isArray(record.cards) ? record.cards.filter(isClipboardCard) : [],
  };
}
