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

export interface EditorErrorMessage {
  type: 'error';
  message?: unknown;
}

export type EditorMessage =
  | ReadyMessage
  | CreateVariableNodeMessage
  | DocumentStateChangedMessage
  | InspectorRequestedMessage
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
  | EditorErrorMessage;

export const EDITOR_MESSAGE_TYPES = [
  'ready',
  'createVariableNode',
  'documentStateChanged',
  'inspectorRequested',
  'sidebarStateChanged',
  'save',
  'switchWorkflow',
  'openSubWorkflow',
  'goBackWorkflow',
  'navigateWorkflowTrail',
  'reloadRequest',
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
  'error',
] as const;

export type EditorMessageType = (typeof EDITOR_MESSAGE_TYPES)[number];

/** 通信边界校验：只放行带已知 type 的对象消息。 */
export function parseEditorMessage(value: unknown): EditorMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !(EDITOR_MESSAGE_TYPES as readonly string[]).includes(type)) return undefined;
  return value as EditorMessage;
}
