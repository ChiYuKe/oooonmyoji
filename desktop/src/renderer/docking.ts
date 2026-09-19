/**
 * 停靠布局：工作流 Dockview（内层）与工作台 Dockview（外层）的组装。
 *
 * 拆分为按职责的模块，本文件只保留类型、面板定义、渲染器类与两个创建函数：
 * - `docking/layout.ts`：布局存储键与读写、标签拖放覆盖模型；
 * - `docking/documents.ts`：工作流文档面板（画布容器、标签、未保存圆点）；
 * - `docking/gestures.ts`：拖回主窗口/拖出弹窗/拖拽让位/标签条拖动区切换手势；
 * - `docking/shared-panels.ts`：共享面板定义、层选择与跨层转移桥接。
 * 对外导出面不变（本文件再导出拆分出的符号），外部引用无需改动。
 */
import {
  createDockview,
  DockviewGroupPanel,
  themeVisualStudio,
  type DockviewApi,
  type GroupPanelPartInitParameters,
  type IGroupHeaderProps,
  type IContentRenderer,
  type IHeaderActionsRenderer,
  type IDockviewGroupPanel,
  type IDockviewPanel,
  type ITabRenderer,
  type TabPartInitParameters,
} from 'dockview';
import { createElement, ExternalLink } from 'lucide';
import {
  LAYOUT_STORAGE_KEY,
  WORKBENCH_LAYOUT_STORAGE_KEY,
  persistLayout,
  readPersistedLayout,
  resolveDropOverlayModel,
} from './docking/layout';
import {
  DOCUMENT_COMPONENT,
  DOCUMENT_TAB_COMPONENT,
  WorkflowCanvasRenderer,
  WorkflowDocumentTab,
  documentPanelId,
  documentUriFromPanelId,
  groupContainsWorkflow,
} from './docking/documents';
import {
  registerDockBackGesture,
  registerDraggedSourceGroupVacancy,
  registerOutsidePopoutGesture,
  installTabStripWindowDragToggle,
} from './docking/gestures';
import { SHARED_PANEL_DEFINITIONS } from './docking/shared-panels';

export type DockPanelId = 'structure' | 'palette' | 'variables' | 'details' | 'runtime' | 'contentBrowser' | 'variableReferences';
export type SharedDockPanelId = 'contentBrowser' | 'runtime' | 'variableReferences';
export type WorkbenchPanelId = 'workflow' | 'overview' | 'settings' | 'referenceViewer' | SharedDockPanelId;

export type SharedDockSurface = 'inner' | 'outer';

/** “工作流画布”面板的引用占位符：实际指向当前打开的第一个文档面板。 */
type PanelReference = DockPanelId | WorkbenchPanelId | 'editor';

export interface DockPanelDefinition {
  title: string;
  moduleElementId: string;
  reference?: PanelReference;
  direction?: 'within' | 'left' | 'right' | 'above' | 'below';
  initialWidth?: number;
  initialHeight?: number;
  minimumWidth?: number;
  minimumHeight?: number;
  inactive?: boolean;
}

/** 壳层为每个工作流文档建立画布时注入的宿主回调。 */
export interface DocumentPanelHooks {
  onFrameCreated(panelId: string, uri: string, frame: HTMLIFrameElement): void;
  onFrameDisposed(panelId: string): void;
  onCloseRequested(uri: string): void;
}

export interface DockingController {
  readonly dockviewApi: DockviewApi;
  /** 补齐缺失的固定面板；有传参时顺带保证至少有一个文档面板。 */
  ensureLayout(fallbackDocument?: { uri: string; title: string }): void;
  openDocument(uri: string, title: string): void;
  closeDocument(uri: string): void;
  /** 把已打开的文档面板设为激活项（不存在时返回 false）。 */
  focusDocument(uri: string): boolean;
  isDocumentOpen(uri: string): boolean;
  documentUris(): string[];
  activeDocumentUri(): string | undefined;
  onDidRemoveDocument(listener: (uri: string) => void): { dispose(): void };
  isOpen(panelId: DockPanelId): boolean;
  showPanel(panelId: DockPanelId): void;
  togglePanel(panelId: DockPanelId): void;
  popoutPanel(panelId: DockPanelId): void;
  popoutActivePanel(): void;
  resetLayout(): void;
  markDragHandled(): void;
  dispose(): void;
}

export interface WorkbenchFrameController {
  readonly dockviewApi: DockviewApi;
  isOpen(panelId: WorkbenchPanelId): boolean;
  show(panelId: WorkbenchPanelId): void;
  toggle(panelId: WorkbenchPanelId): void;
  popout(panelId: WorkbenchPanelId): void;
  activePanelId(): WorkbenchPanelId | undefined;
  resetLayout(): void;
  markDragHandled(): void;
  dispose(): void;
}

export interface SharedPanelDockBridge {
  surface(panelId: SharedDockPanelId): SharedDockSurface | undefined;
  show(panelId: SharedDockPanelId): void;
  toggle(panelId: SharedDockPanelId): void;
  /** 关掉面板（不论它此刻在哪一层）。 */
  close(panelId: SharedDockPanelId): void;
  resetSurfaces(): void;
  dispose(): void;
}

const PANEL_DEFINITIONS: Record<DockPanelId, DockPanelDefinition> = {
  details: {
    title: '详细信息',
    moduleElementId: 'module-details',
    // 不相对某一个局部面板拆分，而是在工作流内部网格的最右侧建立整高列。
    direction: 'right',
    initialWidth: 320,
    minimumWidth: 280,
    minimumHeight: 260,
  },
  structure: {
    title: '结构',
    moduleElementId: 'module-structure',
    reference: 'editor',
    direction: 'left',
    initialWidth: 260,
    minimumWidth: 190,
    minimumHeight: 180,
  },
  palette: {
    title: '节点',
    moduleElementId: 'module-palette',
    reference: 'structure',
    direction: 'within',
    minimumWidth: 190,
    minimumHeight: 180,
    inactive: true,
  },
  variables: {
    title: '变量',
    moduleElementId: 'module-variables',
    reference: 'structure',
    direction: 'below',
    initialHeight: 250,
    minimumWidth: 190,
    minimumHeight: 150,
  },
  runtime: {
    ...SHARED_PANEL_DEFINITIONS.runtime,
    reference: 'editor',
    direction: 'below',
    initialHeight: 180,
  },
  contentBrowser: {
    ...SHARED_PANEL_DEFINITIONS.contentBrowser,
    reference: 'runtime',
    direction: 'within',
  },
  variableReferences: {
    ...SHARED_PANEL_DEFINITIONS.variableReferences,
    // 与内容浏览器叠成同一个标签组（和运行日志同一套路）：这就是它的默认位置。
    reference: 'contentBrowser',
    direction: 'within',
  },
};

const DEFAULT_PANEL_ORDER: DockPanelId[] = ['structure', 'palette', 'variables', 'runtime', 'contentBrowser', 'details'];

const WORKBENCH_PANEL_DEFINITIONS: Record<WorkbenchPanelId, DockPanelDefinition> = {
  workflow: {
    title: '工作流编辑器',
    moduleElementId: 'module-workbench',
    minimumWidth: 480,
    minimumHeight: 360,
  },
  overview: {
    title: '概览',
    moduleElementId: 'module-overview',
    reference: 'workflow',
    direction: 'within',
    minimumWidth: 480,
    minimumHeight: 360,
    inactive: true,
  },
  settings: {
    title: '设置',
    moduleElementId: 'module-settings',
    reference: 'workflow',
    direction: 'within',
    minimumWidth: 300,
    minimumHeight: 220,
  },
  referenceViewer: {
    title: '引用查看器',
    moduleElementId: 'module-reference-viewer',
    reference: 'workflow',
    direction: 'right',
    initialWidth: 680,
    minimumWidth: 420,
    minimumHeight: 300,
  },
  variableReferences: {
    ...SHARED_PANEL_DEFINITIONS.variableReferences,
    // 共享面板：默认开在内层、与内容浏览器叠成同一个标签组；被拖到外层时同样叠在
    // 内容浏览器旁边（外层定义与内层保持一致），所以两层都写 `within`。
    reference: 'contentBrowser',
    direction: 'within',
  },
  contentBrowser: {
    ...SHARED_PANEL_DEFINITIONS.contentBrowser,
    reference: 'workflow',
    direction: 'below',
    initialHeight: 230,
  },
  runtime: {
    ...SHARED_PANEL_DEFINITIONS.runtime,
    reference: 'workflow',
    direction: 'below',
    initialHeight: 180,
  },
};

const DEFAULT_WORKBENCH_PANEL_ORDER: WorkbenchPanelId[] = ['workflow', 'overview'];

// Remove the source tab from its old slot for the duration of a drag. The
// drag ghost remains visible under the pointer and the real tab returns only
// when the drop (or cancellation) completes.
const ONMYOJI_DOCKVIEW_THEME = {
  ...themeVisualStudio,
  tabAnimation: 'smooth' as const,
};

class ExistingModuleRenderer implements IContentRenderer {
  readonly element = document.createElement('div');
  private moduleElement?: HTMLElement;

  constructor(
    private readonly modules: Map<string, HTMLElement>,
    private readonly moduleStore: HTMLElement,
  ) {
    this.element.className = 'dock-module-host';
  }

  init(parameters: GroupPanelPartInitParameters): void {
    const moduleElementId = String(parameters.params.moduleElementId ?? '');
    const moduleElement = this.modules.get(moduleElementId);
    if (!moduleElement) throw new Error(`未找到停靠模块：${moduleElementId}`);
    this.moduleElement = moduleElement;
    this.element.appendChild(moduleElement);
  }

  dispose(): void {
    if (this.moduleElement?.parentElement === this.element) this.moduleStore.appendChild(this.moduleElement);
  }
}

class FixedWorkbenchTab implements ITabRenderer {
  readonly element = document.createElement('div');
  private content = document.createElement('div');
  private titleDisposable?: { dispose(): void };
  private frameId?: number;

  constructor() {
    this.element.className = 'dv-default-tab fixed-workbench-tab';
    this.content.className = 'dv-default-tab-content';
    this.element.appendChild(this.content);
  }

  init(params: TabPartInitParameters): void {
    this.content.textContent = params.title;
    const ownerWindow = this.element.ownerDocument.defaultView ?? window;
    if (this.frameId !== undefined) ownerWindow.cancelAnimationFrame(this.frameId);
    this.frameId = ownerWindow.requestAnimationFrame(() => {
      const tab = this.element.closest<HTMLElement>('.dv-tab');
      if (!tab) return;
      tab.draggable = false;
      tab.title = '固定根模块';
      tab.dataset.fixedWorkbench = 'true';
    });
    this.titleDisposable?.dispose();
    this.titleDisposable = params.api.onDidTitleChange((event) => {
      this.content.textContent = event.title;
    });
  }

  dispose(): void {
    const ownerWindow = this.element.ownerDocument.defaultView ?? window;
    if (this.frameId !== undefined) ownerWindow.cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
    this.titleDisposable?.dispose();
    this.titleDisposable = undefined;
  }
}

class PopoutHeaderAction implements IHeaderActionsRenderer {
  readonly element = document.createElement('div');
  private button = document.createElement('button');
  private params?: IGroupHeaderProps;
  private locationDisposable?: { dispose(): void };
  private layoutDisposable?: { dispose(): void };

  constructor(
    private readonly canPopout: (group: IDockviewGroupPanel) => boolean = () => true,
  ) {
    this.element.className = 'dock-header-actions';
    this.button.type = 'button';
    this.button.className = 'dock-popout-action';
    this.button.title = '移到独立窗口';
    this.button.setAttribute('aria-label', '移到独立窗口');
    this.button.appendChild(createElement(ExternalLink, { width: '13', height: '13', 'aria-hidden': 'true' }));
    this.button.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      const params = this.params;
      if (!params || params.api.location.type === 'popout' || !this.canPopout(params.group)) return;
      void params.containerApi.addPopoutGroup(params.group as DockviewGroupPanel, { popoutUrl: '/popout.html' });
    });
    this.element.appendChild(this.button);
  }

  init(params: IGroupHeaderProps): void {
    this.params = params;
    const update = (): void => {
      const isPopout = params.api.location.type === 'popout';
      const isFixed = !this.canPopout(params.group);
      this.button.disabled = isPopout || isFixed;
      this.element.style.display = isPopout || isFixed ? 'none' : '';
      this.button.title = isPopout ? '已在独立窗口' : isFixed ? '固定模块不可移出' : '移到独立窗口';
      this.button.setAttribute('aria-label', this.button.title);
    };
    this.locationDisposable?.dispose();
    this.layoutDisposable?.dispose();
    this.locationDisposable = params.api.onDidLocationChange(update);
    this.layoutDisposable = params.containerApi.onDidLayoutChange(update);
    update();
  }

  dispose(): void {
    this.locationDisposable?.dispose();
    this.layoutDisposable?.dispose();
    this.locationDisposable = undefined;
    this.layoutDisposable = undefined;
    this.params = undefined;
    this.button.replaceChildren();
  }
}

export function createDockingWorkspace(
  onLayoutChange?: () => void,
  onPopoutFailure?: () => void,
  hooks?: Partial<DocumentPanelHooks>,
): DockingController {
  const container = document.querySelector<HTMLElement>('#dock-workspace')!;
  const moduleStore = document.querySelector<HTMLElement>('#dock-module-store')!;
  const documentHooks: DocumentPanelHooks = {
    onFrameCreated: hooks?.onFrameCreated ?? (() => undefined),
    onFrameDisposed: hooks?.onFrameDisposed ?? (() => undefined),
    onCloseRequested: hooks?.onCloseRequested ?? (() => undefined),
  };
  const modules = new Map<string, HTMLElement>();
  for (const definition of Object.values(PANEL_DEFINITIONS)) {
    modules.set(definition.moduleElementId, document.querySelector<HTMLElement>(`#${definition.moduleElementId}`)!);
  }

  const api = createDockview(container, {
    theme: ONMYOJI_DOCKVIEW_THEME,
    className: 'onmyoji-dockview onmyoji-inner-dockview',
    defaultRenderer: 'always',
    popoutUrl: '/popout.html',
    floatingGroupDragHandle: 'titlebar',
    dndStrategy: 'auto',
    dndEdges: false,
    // 关闭 dockview 的 tab 溢出下拉（组头部右侧的“∨ 数量”角标）。
    disableTabsOverflowList: true,
    dropOverlayModel: ({ location }) => resolveDropOverlayModel(location),
    createRightHeaderActionComponent: () => new PopoutHeaderAction(() => true),
    createComponent: ({ name }) => name === DOCUMENT_COMPONENT
      ? new WorkflowCanvasRenderer(documentHooks)
      : new ExistingModuleRenderer(modules, moduleStore),
    createTabComponent: ({ name }) => name === DOCUMENT_TAB_COMPONENT
      ? new WorkflowDocumentTab((panelId) => {
        const uri = documentUriFromPanelId(panelId);
        if (uri) documentHooks.onCloseRequested(uri);
      })
      : undefined,
  });

  let suspendPersistence = true;
  let temporaryDragLayout = false;

  const isDocumentPanel = (panel: IDockviewPanel): boolean => Boolean(documentUriFromPanelId(panel.api.id));

  const documentPanels = (): IDockviewPanel[] => api.panels.filter(isDocumentPanel);

  /** 文档面板始终作为同一组的标签加入，保证打开新工作流时复用标签栏。 */
  const anchorDocumentPanel = (): IDockviewPanel | undefined => documentPanels()[0]
    ?? api.panels[0];

  /** “editor” 是占位引用，实际落在第一个打开的文档面板上。 */
  const resolveReference = (reference?: PanelReference): IDockviewPanel | undefined => {
    if (!reference) return undefined;
    if (reference === 'editor') return documentPanels()[0];
    return api.getPanel(reference) ?? undefined;
  };

  const addPanel = (panelId: DockPanelId): void => {
    if (api.getPanel(panelId)) return;
    const definition = PANEL_DEFINITIONS[panelId];
    const reference = resolveReference(definition.reference);
    api.addPanel({
      id: panelId,
      title: definition.title,
      component: 'existing-module',
      params: { moduleElementId: definition.moduleElementId },
      renderer: 'always',
      initialWidth: definition.initialWidth,
      initialHeight: definition.initialHeight,
      minimumWidth: definition.minimumWidth,
      minimumHeight: definition.minimumHeight,
      inactive: definition.inactive,
      position: definition.direction
        ? reference
          ? { referencePanel: reference, direction: definition.direction }
          // 「within」必须有参照面板：参照当前不在（例如内容浏览器被拖到了外层）时，
          // 交给 Dockview 放进当前活动分组，别凭空多出一个独立分组——那样面板看着
          // 就像“跑到了别处”，而不是叠在它该在的标签组里。
          : definition.direction === 'within'
            ? undefined
            : { direction: definition.direction }
        : undefined,
    });
  };

  const openDocument = (uri: string, title: string): void => {
    if (!uri) return;
    const panelId = documentPanelId(uri);
    const existing = api.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const anchor = anchorDocumentPanel();
    api.addPanel({
      id: panelId,
      title,
      component: DOCUMENT_COMPONENT,
      tabComponent: DOCUMENT_TAB_COMPONENT,
      params: { uri },
      renderer: 'always',
      minimumWidth: 420,
      minimumHeight: 260,
      position: anchor ? { referencePanel: anchor, direction: 'within' } : undefined,
    });
  };

  const closeDocument = (uri: string): void => {
    api.getPanel(documentPanelId(uri))?.api.close();
  };

  const focusDocument = (uri: string): boolean => {
    const panel = api.getPanel(documentPanelId(uri));
    if (!panel) return false;
    panel.api.setActive();
    panel.focus();
    return true;
  };

  const saveLayout = (): void => {
    if (suspendPersistence || temporaryDragLayout) return;
    persistLayout(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
    onLayoutChange?.();
  };

  const applyDefaultSizes = (): void => {
    api.getPanel('structure')?.api.group.api.setSize({ width: 260 });
    api.getPanel('variables')?.api.group.api.setSize({ width: 260, height: 400 });
    api.getPanel('details')?.api.group.api.setSize({ width: 320 });
    api.getPanel('runtime')?.api.group.api.setSize({ height: 260 });
  };

  // 布局恢复只负责重建面板；文档由壳层根据会话逐条打开。
  const savedLayout = readPersistedLayout(LAYOUT_STORAGE_KEY);
  if (savedLayout) {
    try {
      api.fromJSON(JSON.parse(savedLayout) as ReturnType<DockviewApi['toJSON']>);
    } catch {
      window.onmyoji.writeLayout(LAYOUT_STORAGE_KEY, null);
      window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
    }
  }
  suspendPersistence = false;

  const ensureLayout = (fallbackDocument?: { uri: string; title: string }): void => {
    suspendPersistence = true;
    if (documentPanels().length === 0 && fallbackDocument) openDocument(fallbackDocument.uri, fallbackDocument.title);
    if (documentPanels().length === 0) {
      suspendPersistence = false;
      saveLayout();
      return;
    }
    const hadScaffolding = DEFAULT_PANEL_ORDER.some((panelId) => api.getPanel(panelId));
    DEFAULT_PANEL_ORDER.forEach(addPanel);
    suspendPersistence = false;
    saveLayout();
    if (!hadScaffolding) window.requestAnimationFrame(applyDefaultSizes);
  };

  const resetLayout = (): void => {
    const documents = documentPanels().map((panel) => ({
      uri: documentUriFromPanelId(panel.api.id)!,
      title: panel.title ?? '',
    }));
    const activeUri = api.activePanel ? documentUriFromPanelId(api.activePanel.api.id) : undefined;
    const document = documents[0] ?? (activeUri ? { uri: activeUri, title: '' } : undefined);
    suspendPersistence = true;
    api.clear();
    if (document) openDocument(document.uri, document.title);
    DEFAULT_PANEL_ORDER.forEach(addPanel);
    suspendPersistence = false;
    saveLayout();
    if (activeUri) focusDocument(activeUri);
    window.requestAnimationFrame(applyDefaultSizes);
  };

  const layoutDisposable = api.onDidLayoutChange(saveLayout);
  const panelDisposable = api.onDidActivePanelChange(() => {
    // 切换激活标签页/激活组也属于布局状态（activeView/activeGroup 参与序列化），
    // 与结构变化一起持久化，保证重启后恢复最后激活的标签页。
    saveLayout();
    onLayoutChange?.();
  });

  const showPanel = (panelId: DockPanelId): void => {
    addPanel(panelId);
    const panel = api.getPanel(panelId);
    panel?.api.setActive();
    panel?.focus();
    onLayoutChange?.();
  };

  const popoutPanel = (panelId: DockPanelId): void => {
    const panel = api.getPanel(panelId);
    if (!panel || panel.api.location.type === 'popout') return;
    void api.addPopoutGroup(panel, { popoutUrl: '/popout.html' }).then((opened) => {
      if (!opened) onPopoutFailure?.();
    });
  };

  const popoutActivePanel = (): void => {
    const panel = api.activePanel;
    if (!panel) return;
    popoutPanel(panel.api.id as DockPanelId);
  };

  const popoutFailureDisposable = api.onDidOpenPopoutWindowFail(() => onPopoutFailure?.());
  const outsidePopoutDisposable = registerOutsidePopoutGesture(api, container, onPopoutFailure);
  const dockBackDisposable = registerDockBackGesture(api);
  const sourceGroupVacancyDisposable = registerDraggedSourceGroupVacancy(api, (active) => {
    temporaryDragLayout = active;
    if (!active) saveLayout();
  });

  return {
    dockviewApi: api,
    ensureLayout,
    openDocument,
    closeDocument,
    focusDocument,
    isDocumentOpen: (uri) => Boolean(api.getPanel(documentPanelId(uri))),
    documentUris: () => documentPanels().map((panel) => documentUriFromPanelId(panel.api.id)!),
    activeDocumentUri: () => {
      const active = api.activePanel;
      return active ? documentUriFromPanelId(active.api.id) : undefined;
    },
    onDidRemoveDocument: (listener) => {
      const disposable = api.onDidRemovePanel((panel) => {
        const uri = documentUriFromPanelId(panel.api.id);
        if (uri) listener(uri);
      });
      return { dispose: () => disposable.dispose() };
    },
    isOpen: (panelId) => Boolean(api.getPanel(panelId)),
    showPanel,
    togglePanel: (panelId) => {
      const panel = api.getPanel(panelId);
      if (panel) panel.api.close();
      else showPanel(panelId);
    },
    popoutPanel,
    popoutActivePanel,
    resetLayout,
    markDragHandled: outsidePopoutDisposable.markHandled,
    dispose: () => {
      sourceGroupVacancyDisposable.dispose();
      dockBackDisposable.dispose();
      saveLayout();
      layoutDisposable.dispose();
      panelDisposable.dispose();
      popoutFailureDisposable.dispose();
      outsidePopoutDisposable.dispose();
      api.dispose();
    },
  };
}

export function createWorkbenchFrame(onLayoutChange?: () => void, onPopoutFailure?: () => void): WorkbenchFrameController {
  installTabStripWindowDragToggle();
  const container = document.querySelector<HTMLElement>('#workbench-frame')!;
  const moduleStore = document.querySelector<HTMLElement>('#workbench-module-store')!;
  const modules = new Map<string, HTMLElement>();
  for (const definition of Object.values(WORKBENCH_PANEL_DEFINITIONS)) {
    modules.set(definition.moduleElementId, document.querySelector<HTMLElement>(`#${definition.moduleElementId}`)!);
  }

  const api = createDockview(container, {
    theme: ONMYOJI_DOCKVIEW_THEME,
    className: 'onmyoji-dockview onmyoji-workbench-dockview',
    defaultRenderer: 'always',
    popoutUrl: '/popout.html',
    floatingGroupDragHandle: 'titlebar',
    dndStrategy: 'auto',
    dndEdges: false,
    // 关闭 dockview 的 tab 溢出下拉（组头部右侧的“∨ 数量”角标）。
    disableTabsOverflowList: true,
    dropOverlayModel: ({ location }) => resolveDropOverlayModel(location),
    createRightHeaderActionComponent: () => new PopoutHeaderAction((group) => !groupContainsWorkflow(group)),
    createTabComponent: ({ name }) => name === 'fixed-workbench' ? new FixedWorkbenchTab() : undefined,
    createComponent: () => new ExistingModuleRenderer(modules, moduleStore),
  });

  let suspendPersistence = true;
  let temporaryDragLayout = false;

  const addPanel = (panelId: WorkbenchPanelId): void => {
    if (api.getPanel(panelId)) return;
    const definition = WORKBENCH_PANEL_DEFINITIONS[panelId];
    // 参照面板可能还没打开（例如内容浏览器被拖到了外侧容器）：按回退链挑第一个
    // 存在的，全都找不到时才退回工作流编辑器，避免面板静默地不出现。
    // 本来就没有参照面板的（工作流编辑器本身）不参与这条链，否则会去参照自己。
    const reference = definition.reference
      ? api.getPanel(definition.reference)
        ?? api.getPanel('contentBrowser')
        ?? api.getPanel('runtime')
        ?? api.getPanel('workflow')
      : undefined;
    api.addPanel({
      id: panelId,
      title: definition.title,
      component: 'existing-module',
      tabComponent: panelId === 'workflow' ? 'fixed-workbench' : undefined,
      params: { moduleElementId: definition.moduleElementId },
      renderer: 'always',
      initialWidth: definition.initialWidth,
      initialHeight: definition.initialHeight,
      minimumWidth: definition.minimumWidth,
      minimumHeight: definition.minimumHeight,
      inactive: definition.inactive,
      position: reference && definition.direction
        ? { referencePanel: reference, direction: definition.direction }
        : undefined,
    });
  };

  const saveLayout = (): void => {
    if (suspendPersistence || temporaryDragLayout) return;
    persistLayout(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
    onLayoutChange?.();
  };

  const resetLayout = (): void => {
    suspendPersistence = true;
    api.clear();
    DEFAULT_WORKBENCH_PANEL_ORDER.forEach(addPanel);
    suspendPersistence = false;
    saveLayout();
  };

  let restored = false;
  const savedLayout = readPersistedLayout(WORKBENCH_LAYOUT_STORAGE_KEY);
  if (savedLayout) {
    try {
      api.fromJSON(JSON.parse(savedLayout) as ReturnType<DockviewApi['toJSON']>);
      restored = api.totalPanels > 0;
    } catch {
      window.onmyoji.writeLayout(WORKBENCH_LAYOUT_STORAGE_KEY, null);
      window.localStorage.removeItem(WORKBENCH_LAYOUT_STORAGE_KEY);
    }
  }
  if (!restored) resetLayout();
  else {
    if (!api.getPanel('workflow')) addPanel('workflow');
    if (!api.getPanel('overview')) addPanel('overview');
  }
  suspendPersistence = false;

  // 设置默认与工作流编辑器叠在同一行标签；若持久化布局把它恢复成右侧独立
  // 分组或浮动/弹出窗口，先关闭，打开时再作为标签加入（见 settings.direction）。
  const settingsTabbedWithWorkflow = (): boolean => {
    const settings = api.getPanel('settings');
    const workflow = api.getPanel('workflow');
    return Boolean(settings && workflow && settings.group === workflow.group);
  };
  const restoredSettings = api.getPanel('settings');
  if (restoredSettings && !settingsTabbedWithWorkflow()) restoredSettings.api.close();
  // 引用查看器的内容依赖本次会话的当前目标；不要恢复成空白面板。
  const restoredReferenceViewer = api.getPanel('referenceViewer');
  if (restoredReferenceViewer) restoredReferenceViewer.api.close();
  // 「变量引用」同理（它现在可以停在内层或外层），由 connectSharedPanelDocking 统一清理。

  const layoutDisposable = api.onDidLayoutChange(saveLayout);
  const panelDisposable = api.onDidActivePanelChange(() => {
    // 切换激活标签页/激活组也属于布局状态（activeView/activeGroup 参与序列化），
    // 与结构变化一起持久化，保证重启后恢复最后激活的标签页。
    saveLayout();
    onLayoutChange?.();
  });

  const show = (panelId: WorkbenchPanelId): void => {
    if (panelId === 'settings' && !settingsTabbedWithWorkflow()) {
      api.getPanel('settings')?.api.close();
    }
    addPanel(panelId);
    const panel = api.getPanel(panelId);
    panel?.api.setActive();
    panel?.focus();
    onLayoutChange?.();
  };

  const popout = (panelId: WorkbenchPanelId): void => {
    if (panelId === 'workflow') return;
    const panel = api.getPanel(panelId);
    if (!panel || panel.api.location.type === 'popout') return;
    const position = panelId === 'referenceViewer' ? {
      left: window.screenX + 72,
      top: window.screenY + 56,
      width: Math.min(1280, Math.max(820, window.screen.availWidth - 144)),
      height: Math.min(820, Math.max(560, window.screen.availHeight - 112)),
    } : panelId === 'settings' ? {
      left: window.screenX + 120,
      top: window.screenY + 72,
      width: Math.min(760, Math.max(520, window.screen.availWidth - 160)),
      height: Math.min(560, Math.max(440, window.screen.availHeight - 144)),
    } : undefined;
    void api.addPopoutGroup(panel, { popoutUrl: '/popout.html', position }).then((opened) => {
      if (!opened) onPopoutFailure?.();
    });
  };

  const popoutFailureDisposable = api.onDidOpenPopoutWindowFail(() => onPopoutFailure?.());
  const outsidePopoutDisposable = registerOutsidePopoutGesture(api, container, onPopoutFailure, (item) => {
    if (item instanceof DockviewGroupPanel) return !groupContainsWorkflow(item);
    return item.api.id !== 'workflow';
  });
  const sourceGroupVacancyDisposable = registerDraggedSourceGroupVacancy(api, (active) => {
    temporaryDragLayout = active;
    if (!active) saveLayout();
  });
  const dockBackDisposable = registerDockBackGesture(api);

  return {
    dockviewApi: api,
    isOpen: (panelId) => Boolean(api.getPanel(panelId)),
    show,
    toggle: (panelId) => {
      if (panelId === 'workflow') return;
      const panel = api.getPanel(panelId);
      if (panel) panel.api.close();
      else show(panelId);
    },
    popout,
    activePanelId: () => api.activePanel?.api.id as WorkbenchPanelId | undefined,
    resetLayout,
    markDragHandled: outsidePopoutDisposable.markHandled,
    dispose: () => {
      sourceGroupVacancyDisposable.dispose();
      dockBackDisposable.dispose();
      saveLayout();
      layoutDisposable.dispose();
      panelDisposable.dispose();
      popoutFailureDisposable.dispose();
      outsidePopoutDisposable.dispose();
      api.dispose();
    },
  };
}

// 再导出拆分出的符号，保持对外导入面不变。
export { documentPanelId, documentUriForPanelId, documentUriFromPanelId, setDocumentPanelDirty, groupContainsWorkflow } from './docking/documents';
export { isSharedDockPanelId, connectSharedPanelDocking } from './docking/shared-panels';
export { registerDockBackGesture, registerOutsidePopoutGesture, registerDraggedSourceGroupVacancy, installTabStripWindowDragToggle } from './docking/gestures';
export { LAYOUT_STORAGE_KEY, WORKBENCH_LAYOUT_STORAGE_KEY, readPersistedLayout, persistLayout, resolveDropOverlayModel } from './docking/layout';
export { SHARED_PANEL_DEFINITIONS, DEFAULT_SHARED_PANEL_SURFACES, COMPANION_SHARED_PANELS, SHARED_PANEL_SURFACE_KEYS } from './docking/shared-panels';
