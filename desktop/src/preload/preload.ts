import { contextBridge, ipcRenderer } from 'electron';
import type {
  OnmyojiDesktopApi,
  RoiCaptureRequest,
  RunWorkflowRequest,
  RuntimeOutputEvent,
  RuntimeStateEvent,
  SaveCanvasRequest,
  SaveTemplateRequest,
  TemplateCheckRequest,
} from '../shared/contracts';

const api: OnmyojiDesktopApi = {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  bootstrap: () => ipcRenderer.invoke('project:bootstrap'),
  getWorkflowInit: (uri, selectedInstance, canGoBack) => ipcRenderer.invoke('project:get-workflow-init', uri, selectedInstance, canGoBack),
  saveWorkflow: (uri, text) => ipcRenderer.invoke('project:save-workflow', uri, text),
  createWorkflow: () => ipcRenderer.invoke('project:create-workflow'),
  openWorkflowFile: (uri) => ipcRenderer.invoke('project:open-workflow-file', uri),
  openContentItem: (path) => ipcRenderer.invoke('project:open-content-item', path),
  runWorkflow: (request: RunWorkflowRequest) => ipcRenderer.invoke('runtime:run-workflow', request),
  stopWorkflow: () => ipcRenderer.invoke('runtime:stop-workflow'),
  listInstances: () => ipcRenderer.invoke('runtime:list-instances'),
  listAssets: () => ipcRenderer.invoke('project:list-assets'),
  readAssetData: (paths) => ipcRenderer.invoke('project:read-asset-data', paths),
  saveTemplate: (request: SaveTemplateRequest) => ipcRenderer.invoke('project:save-template', request),
  saveCanvas: (request: SaveCanvasRequest) => ipcRenderer.invoke('project:save-canvas', request),
  captureRoi: (request: RoiCaptureRequest) => ipcRenderer.invoke('runtime:capture-roi', request),
  checkTemplate: (request: TemplateCheckRequest) => ipcRenderer.invoke('runtime:check-template', request),
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
  onRunEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: Record<string, unknown>): void => listener(value);
    ipcRenderer.on('runtime:run-event', wrapped);
    return () => ipcRenderer.removeListener('runtime:run-event', wrapped);
  },
  onWindowMaximized: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, maximized: boolean): void => listener(maximized);
    ipcRenderer.on('window:maximized', wrapped);
    return () => ipcRenderer.removeListener('window:maximized', wrapped);
  },
};

contextBridge.exposeInMainWorld('onmyoji', api);
