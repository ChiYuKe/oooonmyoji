/**
 * 工作流文档面板：文档面板的组件/id 约定、每个文档的独立画布容器与标签渲染器。
 * 原 `docking.ts` 的文档面板部分，抽出便于单独维护与测试。
 */
import {
  createCloseButton,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
  type IDockviewGroupPanel,
  type ITabRenderer,
  type TabPartInitParameters,
} from 'dockview';
import type { DocumentPanelHooks } from '../docking';

/** 文档面板的组件名与 id 前缀；一个工作流文档对应一个 Dockview 面板。 */
export const DOCUMENT_COMPONENT = 'workflow-canvas';
export const DOCUMENT_TAB_COMPONENT = 'workflow-document-tab';
export const DOCUMENT_PANEL_PREFIX = 'workflow:';

export function documentPanelId(uri: string): string {
  return `${DOCUMENT_PANEL_PREFIX}${uri}`;
}

/** 从面板 id 还原工作流 URI；非文档面板返回 undefined。 */
export function documentUriForPanelId(panelId: string): string | undefined {
  return panelId.startsWith(DOCUMENT_PANEL_PREFIX) ? panelId.slice(DOCUMENT_PANEL_PREFIX.length) : undefined;
}

export function documentUriFromPanelId(panelId: string): string | undefined {
  return documentUriForPanelId(panelId);
}

/** 每个工作流文档面板的独立画布容器；iframe 由壳层注册后接管消息路由。 */
export class WorkflowCanvasRenderer implements IContentRenderer {
  readonly element = document.createElement('section');
  private readonly frame = document.createElement('iframe');
  private panelId = '';
  private uri = '';
  private attached = false;

  constructor(private readonly hooks: DocumentPanelHooks) {
    this.element.className = 'dock-module editor-surface';
    this.frame.className = 'workflow-canvas-frame';
    this.frame.title = '工作流节点画布';
  }

  init(parameters: GroupPanelPartInitParameters): void {
    this.panelId = parameters.api.id;
    this.uri = String(parameters.params?.uri ?? '');
    if (!this.attached) {
      this.attached = true;
      this.frame.id = this.panelId;
      this.frame.src = './canvas.html?mode=canvas';
      this.element.appendChild(this.frame);
    }
    this.hooks.onFrameCreated(this.panelId, this.uri, this.frame);
  }

  dispose(): void {
    this.hooks.onFrameDisposed(this.panelId);
    if (this.frame.parentElement === this.element) this.element.removeChild(this.frame);
    this.attached = false;
  }
}

const documentTabRenderers = new Map<string, WorkflowDocumentTab>();

/** 供壳层更新文档标签的未保存圆点。 */
export function setDocumentPanelDirty(panelId: string, dirty: boolean): void {
  documentTabRenderers.get(panelId)?.setDirty(dirty);
}

export class WorkflowDocumentTab implements ITabRenderer {
  readonly element = document.createElement('div');
  private label = document.createElement('div');
  private dirtyMark = document.createElement('div');
  private closeButton = document.createElement('div');
  private titleDisposable?: { dispose(): void };
  private panelId = '';

  constructor(private readonly onClose: (panelId: string) => void) {
    this.element.className = 'dv-default-tab workflow-document-tab';
    this.label.className = 'dv-default-tab-content workflow-document-tab-label';
    this.dirtyMark.className = 'workflow-document-tab-dirty hidden';
    this.dirtyMark.title = '未保存';
    this.closeButton.className = 'dv-default-tab-action workflow-document-tab-close';
    this.closeButton.setAttribute('role', 'button');
    this.closeButton.tabIndex = -1;
    this.closeButton.title = '关闭工作流画布';
    this.closeButton.appendChild(createCloseButton());
    // Dockview 在标签容器上监听指针拖动，关闭按钮必须隔离该手势才能稳定收到 click。
    this.closeButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.closeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onClose(this.panelId);
    });
    this.element.append(this.label, this.dirtyMark, this.closeButton);
  }

  init(params: TabPartInitParameters): void {
    this.panelId = params.api.id;
    documentTabRenderers.set(this.panelId, this);
    this.label.textContent = params.title;
    this.titleDisposable?.dispose();
    this.titleDisposable = params.api.onDidTitleChange((event) => {
      this.label.textContent = event.title;
    });
  }

  setDirty(dirty: boolean): void {
    this.dirtyMark.classList.toggle('hidden', !dirty);
  }

  dispose(): void {
    documentTabRenderers.delete(this.panelId);
    this.titleDisposable?.dispose();
    this.titleDisposable = undefined;
  }
}

/** 分组里是否含有工作流编辑器（固定根模块）：有则不允许把整个分组弹成独立窗口。 */
export function groupContainsWorkflow(group: IDockviewGroupPanel): boolean {
  return group.panels.some((panel) => panel.api.id === 'workflow');
}
