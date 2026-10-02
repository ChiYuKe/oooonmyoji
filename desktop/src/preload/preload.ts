import type { AppearanceTheme } from '../shared/appearance';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  McpApprovalDecision,
  McpApprovalRequest,
  OnmyojiDesktopApi,
  RoiCaptureRequest,
  RunWorkflowRequest,
  RuntimeDebugSettings,
  RuntimeOutputEvent,
  RuntimeStateEvent,
  RuntimeResourceVariantId,
  SaveCanvasRequest,
  SaveTemplateRequest,
  MoveContentRequest,
  CreateContentFolderRequest,
  RenameContentRequest,
  TemplateCheckRequest,
  VisionCommand,
  VisionStreamEvent,
} from '../shared/contracts';

const api: OnmyojiDesktopApi = {
  getAiSettings: () => ipcRenderer.invoke('ai:settings'),
  saveAiSettings: (value) => ipcRenderer.invoke('ai:save-settings', value),
  testAiConnection: () => ipcRenderer.invoke('ai:test'),
  getAiSuggestions: (value) => ipcRenderer.invoke('ai:suggest', value),
  openWorkflowTest: (init) => ipcRenderer.invoke('test:open', init),
  workflowTestInit: () => ipcRenderer.invoke('test:init'),
  workflowTestImages: () => ipcRenderer.invoke('test:images'),
  workflowTestStart: (request) => ipcRenderer.invoke('test:start', request),
  workflowTestCommand: (command) => ipcRenderer.invoke('test:command', command),
  workflowTestReport: () => ipcRenderer.invoke('test:report'),
  workflowTestTemplate: () => ipcRenderer.invoke('test:template'),
  workflowTestAddNode: (node) => ipcRenderer.invoke('test:add-node', node),
  workflowTestNodeAdded: (result) => ipcRenderer.invoke('test:node-added', result),
  onWorkflowTestAddNode: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, request: import('../shared/workflow-testing').TestNodeTransfer) => listener(request);
    ipcRenderer.on('test:add-node', handler);
    return () => ipcRenderer.removeListener('test:add-node', handler);
  },
  onWorkflowTestEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: import('../shared/workflow-testing').WorkflowTestEvent) => listener(value);
    ipcRenderer.on('test:event', handler);
    return () => ipcRenderer.removeListener('test:event', handler);
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  readLayout: (key) => ipcRenderer.sendSync('layout:read', key),
  getTheme: () => ipcRenderer.sendSync('appearance:read'),
  setTheme: (theme) => ipcRenderer.sendSync('appearance:write', theme),
  onThemeChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, theme: AppearanceTheme) => listener(theme);
    ipcRenderer.on('appearance:changed', handler);
    return () => ipcRenderer.removeListener('appearance:changed', handler);
  },
  onMcpApprovalRequest: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, request: McpApprovalRequest) => listener(request);
    ipcRenderer.on('mcp:approval-request', handler);
    return () => ipcRenderer.removeListener('mcp:approval-request', handler);
  },
  answerMcpApproval: (id: string, decision: McpApprovalDecision) => ipcRenderer.send('mcp:approval-answer', id, decision),
  writeLayout: (key, value) => ipcRenderer.send('layout:write', key, value),
  getRuntimeResourceStatus: () => ipcRenderer.invoke('resources:status'),
  installRuntimeResources: (variant: RuntimeResourceVariantId) => ipcRenderer.invoke('resources:install', variant),
  activateRuntimeResources: (variant: RuntimeResourceVariantId) => ipcRenderer.invoke('resources:activate', variant),
  removeRuntimeResources: (variant: RuntimeResourceVariantId) => ipcRenderer.invoke('resources:remove', variant),
  onRuntimeResourceProgress: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: import('../shared/contracts').RuntimeResourceProgress): void => listener(value);
    ipcRenderer.on('resources:progress', wrapped);
    return () => ipcRenderer.removeListener('resources:progress', wrapped);
  },
  bootstrap: () => ipcRenderer.invoke('project:bootstrap'),
  getWorkflowInit: (uri, selectedInstance, canGoBack) => ipcRenderer.invoke('project:get-workflow-init', uri, selectedInstance, canGoBack),
  getEditingLibrary: () => ipcRenderer.invoke('project:get-editing-library'),
  updateEditingLibrary: (change) => ipcRenderer.invoke('project:update-editing-library', change),
  saveWorkflow: (uri, text) => ipcRenderer.invoke('project:save-workflow', uri, text),
  listWorkflowHistory: (uri) => ipcRenderer.invoke('project:list-workflow-history', uri),
  readWorkflowHistory: (uri, id) => ipcRenderer.invoke('project:read-workflow-history', uri, id),
  createWorkflow: () => ipcRenderer.invoke('project:create-workflow'),
  createReusableFunction: (name, text) => ipcRenderer.invoke('project:create-reusable-function', name, text),
  openWorkflowFile: (uri) => ipcRenderer.invoke('project:open-workflow-file', uri),
  openContentItem: (path) => ipcRenderer.invoke('project:open-content-item', path),
  moveContent: (request: MoveContentRequest) => ipcRenderer.invoke('project:move-content', request),
  copyContent: (request: MoveContentRequest) => ipcRenderer.invoke('project:copy-content', request),
  listContentFolders: () => ipcRenderer.invoke('project:list-content-folders'),
  createContentFolder: (request: CreateContentFolderRequest) => ipcRenderer.invoke('project:create-content-folder', request),
  renameContent: (request: RenameContentRequest) => ipcRenderer.invoke('project:rename-content', request),
  deleteContent: (path) => ipcRenderer.invoke('project:delete-content', path),
  getReferenceGraph: (target) => ipcRenderer.invoke('project:reference-graph', target),
  readContentPreview: (path) => ipcRenderer.invoke('project:read-content-preview', path),
  runWorkflow: (request: RunWorkflowRequest) => ipcRenderer.invoke('runtime:run-workflow', request),
  stopWorkflow: () => ipcRenderer.invoke('runtime:stop-workflow'),
  getDebugSettings: () => ipcRenderer.invoke('runtime:get-debug-settings'),
  updateDebugSettings: (settings: RuntimeDebugSettings) => ipcRenderer.invoke('runtime:update-debug-settings', settings),
  listInstances: () => ipcRenderer.invoke('runtime:list-instances'),
  listAssets: () => ipcRenderer.invoke('project:list-assets'),
  readAssetData: (paths) => ipcRenderer.invoke('project:read-asset-data', paths),
  saveTemplate: (request: SaveTemplateRequest) => ipcRenderer.invoke('project:save-template', request),
  saveCanvas: (request: SaveCanvasRequest) => ipcRenderer.invoke('project:save-canvas', request),
  captureRoi: (request: RoiCaptureRequest) => ipcRenderer.invoke('runtime:capture-roi', request),
  checkTemplate: (request: TemplateCheckRequest) => ipcRenderer.invoke('runtime:check-template', request),
  openVisionTest: (instanceId: string) => ipcRenderer.invoke('tools:open-vision-test', instanceId),
  openLiveView: (instanceId: string) => ipcRenderer.invoke('tools:open-live-view', instanceId),
  liveViewWatch: (watching: boolean) => ipcRenderer.invoke('live-view:watch', watching),
  liveViewSetInterval: (intervalMs: number) => ipcRenderer.invoke('live-view:set-interval', intervalMs),
  liveViewPoll: () => ipcRenderer.invoke('live-view:poll'),
  openReadme: () => ipcRenderer.invoke('help:open-readme'),
  visionStart: () => ipcRenderer.invoke('vision:start'),
  visionCommand: (command: VisionCommand) => ipcRenderer.invoke('vision:command', command),
  visionStop: () => ipcRenderer.invoke('vision:stop'),
  onRuntimeOutput: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: RuntimeOutputEvent): void => listener(value);
    ipcRenderer.on('runtime:output', wrapped);
    return () => ipcRenderer.removeListener('runtime:output', wrapped);
  },
  onRuntimeState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: RuntimeStateEvent): void => listener(value);
    ipcRenderer.on('runtime:state', wrapped);
    return () => ipcRenderer.removeListener('runtime:state', wrapped);
  },
  onRuntimeLogClear: (listener) => {
    const wrapped = (): void => listener();
    ipcRenderer.on('runtime:log-clear', wrapped);
    return () => ipcRenderer.removeListener('runtime:log-clear', wrapped);
  },
  onRunEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: Record<string, unknown>): void => listener(value);
    ipcRenderer.on('runtime:run-event', wrapped);
    return () => ipcRenderer.removeListener('runtime:run-event', wrapped);
  },
  onVisionEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: VisionStreamEvent): void => listener(value);
    ipcRenderer.on('vision:event', wrapped);
    return () => ipcRenderer.removeListener('vision:event', wrapped);
  },
  onWindowMaximized: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, maximized: boolean): void => listener(maximized);
    ipcRenderer.on('window:maximized', wrapped);
    return () => ipcRenderer.removeListener('window:maximized', wrapped);
  },
};

contextBridge.exposeInMainWorld('onmyoji', api);
