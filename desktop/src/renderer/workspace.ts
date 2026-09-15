/**
 * 文档工作区核心（阶段 1：消息路由 + 文档运行时注册表）。
 *
 * 持有每个工作流文档的画布运行时与帧→URI 映射，并提供统一的 postMessage 路由。
 * 主窗口通过 createWorkspace(deps) 注入实时状态读取器。
 */
import type { WorkflowEditorInit } from '../shared/contracts';

export interface SidebarNode {
  id: string;
  name: string;
  type: string;
  meta: string;
  children: string[];
}

export interface SidebarVariable {
  name: string;
  displayName?: string;
  group?: string;
  type: string;
  scope: 'inputs' | 'variables';
  public?: boolean;
  onCard?: boolean;
}

export interface InspectorSelection {
  kind: 'none' | 'node' | 'run' | 'edge' | 'variables' | 'workflow';
  nodeId?: string;
  index?: number;
  parent?: string;
  child?: string;
  name?: string;
  scope?: 'inputs' | 'variables';
}

/** 一个工作流文档对应的画布运行时：各自的 iframe、初始化和侧栏状态。 */
export interface DocumentRuntime {
  panelId: string;
  frame: HTMLIFrameElement;
  ready: boolean;
  init?: WorkflowEditorInit;
  sidebarNodes: SidebarNode[];
  sidebarVariables: SidebarVariable[];
  selectedNode: string;
  selectedVariable: string;
  selectedVariableScope: 'inputs' | 'variables';
  collapsedTreeNodes: Set<string>;
  inspectorSelection?: InspectorSelection;
}

export interface WorkspaceDeps {
  detailsFrame: HTMLIFrameElement;
  getCurrentUri: () => string;
}

export interface Workspace {
  getDocumentRuntimes(): Map<string, DocumentRuntime>;
  activeRuntime(): DocumentRuntime | undefined;
  runtimeForUri(uri: string): DocumentRuntime | undefined;
  runtimeForFrame(frame: HTMLIFrameElement): DocumentRuntime | undefined;
  frameUriForFrame(frame: HTMLIFrameElement): string | undefined;
  postToFrame(frame: HTMLIFrameElement, payload: Record<string, unknown>): void;
  postToEditor(payload: Record<string, unknown>): void;
  postToEditors(payload: Record<string, unknown>): void;
  postToAllEditors(payload: Record<string, unknown>): void;
  editorCommand(command: string, value?: unknown): void;
  registerDocumentFrame(panelId: string, uri: string, frame: HTMLIFrameElement): void;
  unregisterDocumentFrame(panelId: string): void;
  displayFileUri(uri: string): string;
}

export function createWorkspace(deps: WorkspaceDeps): Workspace {
  const { detailsFrame, getCurrentUri } = deps;
  const documentRuntimes = new Map<string, DocumentRuntime>();
  const documentFrameUris = new WeakMap<HTMLIFrameElement, string>();

  function activeRuntime(): DocumentRuntime | undefined {
    return documentRuntimes.get(getCurrentUri());
  }

  function runtimeForUri(uri: string): DocumentRuntime | undefined {
    return documentRuntimes.get(uri);
  }

  function runtimeForFrame(frame: HTMLIFrameElement): DocumentRuntime | undefined {
    const uri = documentFrameUris.get(frame);
    return uri ? documentRuntimes.get(uri) : undefined;
  }

  function postToFrame(frame: HTMLIFrameElement, payload: Record<string, unknown>): void {
    frame.contentWindow?.postMessage({ source: 'desktop-shell', payload }, '*');
  }

  function postToEditor(payload: Record<string, unknown>): void {
    const frame = activeRuntime()?.frame;
    if (frame) postToFrame(frame, payload);
  }

  function postToEditors(payload: Record<string, unknown>): void {
    const frame = activeRuntime()?.frame;
    if (frame) postToFrame(frame, payload);
    postToFrame(detailsFrame, payload);
  }

  /** 广播到所有画布（实例列表、运行事件、连通性探测等）。 */
  function postToAllEditors(payload: Record<string, unknown>): void {
    for (const runtime of documentRuntimes.values()) postToFrame(runtime.frame, payload);
    postToFrame(detailsFrame, payload);
  }

  function editorCommand(command: string, value?: unknown): void {
    postToEditor({ type: 'editorCommand', command, value });
  }

  /** Dockview 为文档面板创建独立画布时登记运行时，供消息路由与状态恢复使用。 */
  function registerDocumentFrame(panelId: string, uri: string, frame: HTMLIFrameElement): void {
    const existing = documentRuntimes.get(uri);
    if (existing && existing.frame === frame) {
      existing.panelId = panelId;
      return;
    }
    documentRuntimes.set(uri, {
      panelId,
      frame,
      ready: false,
      sidebarNodes: [],
      sidebarVariables: [],
      selectedNode: '',
      selectedVariable: '',
      selectedVariableScope: 'inputs',
      collapsedTreeNodes: new Set(),
    });
    documentFrameUris.set(frame, uri);
  }

  function unregisterDocumentFrame(panelId: string): void {
    for (const [uri, runtime] of documentRuntimes) {
      if (runtime.panelId !== panelId) continue;
      documentRuntimes.delete(uri);
      documentFrameUris.delete(runtime.frame);
      return;
    }
  }

  function displayFileUri(uri: string): string {
    try {
      const parsed = new URL(uri);
      return decodeURIComponent(parsed.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1');
    } catch {
      return uri;
    }
  }

  return {
    getDocumentRuntimes: () => documentRuntimes,
    activeRuntime,
    runtimeForUri,
    runtimeForFrame,
    frameUriForFrame: (frame) => documentFrameUris.get(frame),
    postToFrame,
    postToEditor,
    postToEditors,
    postToAllEditors,
    editorCommand,
    registerDocumentFrame,
    unregisterDocumentFrame,
    displayFileUri,
  };
}
