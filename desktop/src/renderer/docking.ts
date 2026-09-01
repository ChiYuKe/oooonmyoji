import {
  createDockview,
  DockviewGroupPanel,
  themeVisualStudio,
  type DockviewApi,
  type DockviewDidDropEvent,
  type GroupPanelPartInitParameters,
  type IDockviewGroupPanel,
  type IGroupHeaderProps,
  type IContentRenderer,
  type IHeaderActionsRenderer,
  type IDockviewPanel,
  type ITabRenderer,
  type PanelTransfer,
  type Position,
  type TabPartInitParameters,
  positionToDirection,
} from 'dockview';
import { createElement, ExternalLink } from 'lucide';

export type DockPanelId = 'structure' | 'palette' | 'variables' | 'editor' | 'details' | 'runtime' | 'contentBrowser';
export type SharedDockPanelId = 'contentBrowser' | 'runtime';
export type WorkbenchPanelId = 'workflow' | SharedDockPanelId;

export type SharedDockSurface = 'inner' | 'outer';

interface DockPanelDefinition {
  title: string;
  moduleElementId: string;
  reference?: DockPanelId | WorkbenchPanelId;
  direction?: 'within' | 'left' | 'right' | 'above' | 'below';
  initialWidth?: number;
  initialHeight?: number;
  minimumWidth?: number;
  minimumHeight?: number;
  inactive?: boolean;
}

export interface DockingController {
  readonly dockviewApi: DockviewApi;
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
  toggle(panelId: SharedDockPanelId): void;
  resetSurfaces(): void;
  dispose(): void;
}

const LAYOUT_STORAGE_KEY = 'onmyoji-studio.dock-layout.v6';
const WORKBENCH_LAYOUT_STORAGE_KEY = 'onmyoji-studio.workbench-layout.v4';
const SHARED_PANEL_SURFACE_KEYS: Record<SharedDockPanelId, string> = {
  contentBrowser: 'onmyoji-studio.content-browser-dock-surface',
  runtime: 'onmyoji-studio.runtime-dock-surface',
};

const DEFAULT_SHARED_PANEL_SURFACES: Record<SharedDockPanelId, SharedDockSurface> = {
  contentBrowser: 'outer',
  runtime: 'inner',
};

const SHARED_PANEL_DEFINITIONS: Record<SharedDockPanelId, DockPanelDefinition> = {
  contentBrowser: {
    title: '内容浏览器',
    moduleElementId: 'module-content-browser',
    minimumWidth: 280,
    minimumHeight: 140,
  },
  runtime: {
    title: '运行日志',
    moduleElementId: 'module-runtime',
    minimumWidth: 320,
    minimumHeight: 110,
  },
};

const PANEL_DEFINITIONS: Record<DockPanelId, DockPanelDefinition> = {
  editor: {
    title: '工作流画布',
    moduleElementId: 'module-editor',
    minimumWidth: 420,
    minimumHeight: 260,
  },
  details: {
    title: '详细信息',
    moduleElementId: 'module-details',
    reference: 'editor',
    direction: 'right',
    initialWidth: 340,
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
    reference: 'editor',
    direction: 'below',
    initialHeight: 230,
  },
};

const DEFAULT_PANEL_ORDER: DockPanelId[] = ['editor', 'structure', 'palette', 'variables', 'details', 'runtime'];

const WORKBENCH_PANEL_DEFINITIONS: Record<WorkbenchPanelId, DockPanelDefinition> = {
  workflow: {
    title: '工作流编辑器',
    moduleElementId: 'module-workbench',
    minimumWidth: 480,
    minimumHeight: 360,
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

const DEFAULT_WORKBENCH_PANEL_ORDER: WorkbenchPanelId[] = ['workflow', 'contentBrowser'];

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

function groupContainsWorkflow(group: IDockviewGroupPanel): boolean {
  return group.panels.some((panel) => panel.api.id === 'workflow');
}

class PopoutHeaderAction implements IHeaderActionsRenderer {
  readonly element = document.createElement('div');
  private button = document.createElement('button');
  private params?: IGroupHeaderProps;
  private locationDisposable?: { dispose(): void };
  private layoutDisposable?: { dispose(): void };

  constructor(private readonly canPopout: (group: IDockviewGroupPanel) => boolean = () => true) {
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

function registerOutsidePopoutGesture(
  api: DockviewApi,
  container: HTMLElement,
  onPopoutFailure?: () => void,
  canPopout: (item: DockviewGroupPanel | IDockviewPanel) => boolean = () => true,
): { markHandled(): void; dispose(): void } {
  let draggedItem: DockviewGroupPanel | IDockviewPanel | undefined;
  let dragUsesHtml5 = false;
  let dragWasHandled = false;
  let removeDragEndListener: (() => void) | undefined;

  const clearDrag = (): void => {
    draggedItem = undefined;
    dragUsesHtml5 = false;
    dragWasHandled = false;
    removeDragEndListener?.();
    removeDragEndListener = undefined;
  };

  const finishDrag = (event: Pick<MouseEvent, 'clientX' | 'clientY' | 'screenX' | 'screenY'>, wasHandled = false): void => {
    const item = draggedItem;
    clearDrag();
    if (wasHandled) return;

    const ownerWindow = container.ownerDocument.defaultView ?? window;
    const root = container.getBoundingClientRect();
    const screenLeft = ownerWindow.screenX + root.left;
    const screenTop = ownerWindow.screenY + root.top;
    const releasedOutside = event.screenX < screenLeft || event.screenX > screenLeft + root.width
      || event.screenY < screenTop || event.screenY > screenTop + root.height;

    let popoutItem = item;
    if (!popoutItem || !releasedOutside) {
      popoutItem = api.groups.find((group) => {
        if (group.api.location.type !== 'floating') return false;
        const box = group.api.boundingBox;
        return Boolean(box && (box.left < -8 || box.top < -8
          || box.left + box.width > container.clientWidth + 8
          || box.top + box.height > container.clientHeight + 8));
      });
    }
    if (!popoutItem || !canPopout(popoutItem) || popoutItem.api.location.type === 'popout') return;

    const group = popoutItem instanceof DockviewGroupPanel ? popoutItem : popoutItem.group;
    const box = group.api.boundingBox;
    const width = Math.max(320, box?.width ?? 720);
    const height = Math.max(220, box?.height ?? 520);
    const position = releasedOutside ? {
      left: event.screenX - 42,
      top: event.screenY - 14,
      width,
      height,
    } : undefined;
    window.setTimeout(() => {
      if (popoutItem.api.location.type === 'popout') return;
      void api.addPopoutGroup(popoutItem, { popoutUrl: '/popout.html', position }).then((opened) => {
        if (!opened) onPopoutFailure?.();
      });
    });
  };

  const rememberDrag = (
    item: DockviewGroupPanel | IDockviewPanel,
    nativeEvent: DragEvent | PointerEvent,
  ): void => {
    clearDrag();
    if (!canPopout(item)) {
      nativeEvent.preventDefault();
      return;
    }
    draggedItem = item;
    dragUsesHtml5 = 'dataTransfer' in nativeEvent;
    if (!dragUsesHtml5) return;

    const source = nativeEvent.target as EventTarget | null;
    if (!source) return;
    const dragEndListener = (event: Event): void => {
      const dragEvent = event as DragEvent;
      const dropEffect = dragEvent.dataTransfer?.dropEffect;
      finishDrag(dragEvent, dragWasHandled || dropEffect !== undefined && dropEffect !== 'none');
    };
    source.addEventListener('dragend', dragEndListener, { once: true });
    removeDragEndListener = () => source.removeEventListener('dragend', dragEndListener);
  };

  const panelDragDisposable = api.onWillDragPanel((event) => {
    rememberDrag(event.panel, event.nativeEvent);
  });
  const groupDragDisposable = api.onWillDragGroup((event) => {
    rememberDrag(event.group, event.nativeEvent);
  });
  const panelMoveDisposable = api.onDidMovePanel(() => {
    if (draggedItem && dragUsesHtml5) dragWasHandled = true;
  });
  const pointerCancelListener = (): void => {
    if (!dragUsesHtml5) clearDrag();
  };
  const pointerUpListener = (event: PointerEvent): void => {
    if (dragUsesHtml5) return;
    finishDrag(event);
  };

  document.addEventListener('pointerup', pointerUpListener);
  document.addEventListener('pointercancel', pointerCancelListener);
  return {
    markHandled: () => {
      if (draggedItem) dragWasHandled = true;
    },
    dispose: () => {
      panelDragDisposable.dispose();
      groupDragDisposable.dispose();
      panelMoveDisposable.dispose();
      clearDrag();
      document.removeEventListener('pointerup', pointerUpListener);
      document.removeEventListener('pointercancel', pointerCancelListener);
    },
  };
}

export function createDockingWorkspace(onLayoutChange?: () => void, onPopoutFailure?: () => void): DockingController {
  const container = document.querySelector<HTMLElement>('#dock-workspace')!;
  const moduleStore = document.querySelector<HTMLElement>('#dock-module-store')!;
  const modules = new Map<string, HTMLElement>();
  for (const definition of Object.values(PANEL_DEFINITIONS)) {
    modules.set(definition.moduleElementId, document.querySelector<HTMLElement>(`#${definition.moduleElementId}`)!);
  }

  const api = createDockview(container, {
    theme: themeVisualStudio,
    className: 'onmyoji-dockview onmyoji-inner-dockview',
    defaultRenderer: 'always',
    popoutUrl: '/popout.html',
    floatingGroupDragHandle: 'titlebar',
    dndStrategy: 'auto',
    createRightHeaderActionComponent: () => new PopoutHeaderAction(),
    createComponent: () => new ExistingModuleRenderer(modules, moduleStore),
  });

  let suspendPersistence = true;

  const addPanel = (panelId: DockPanelId): void => {
    if (api.getPanel(panelId)) return;
    const definition = PANEL_DEFINITIONS[panelId];
    const reference = definition.reference ? api.getPanel(definition.reference) : undefined;
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
      position: reference && definition.direction
        ? { referencePanel: reference, direction: definition.direction }
        : undefined,
    });
  };

  const saveLayout = (): void => {
    if (suspendPersistence) return;
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
    onLayoutChange?.();
  };

  const resetLayout = (): void => {
    suspendPersistence = true;
    api.clear();
    DEFAULT_PANEL_ORDER.forEach(addPanel);
    suspendPersistence = false;
    saveLayout();
    window.requestAnimationFrame(() => {
      api.getPanel('structure')?.api.group.api.setSize({ width: 260 });
      api.getPanel('variables')?.api.group.api.setSize({ width: 260, height: 250 });
      api.getPanel('details')?.api.group.api.setSize({ width: 340 });
      api.getPanel('runtime')?.api.group.api.setSize({ height: 240 });
    });
  };

  let restored = false;
  const savedLayout = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
  if (savedLayout) {
    try {
      api.fromJSON(JSON.parse(savedLayout) as ReturnType<DockviewApi['toJSON']>);
      restored = api.totalPanels > 0;
    } catch {
      window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
    }
  }
  if (!restored) resetLayout();
  suspendPersistence = false;

  const layoutDisposable = api.onDidLayoutChange(saveLayout);
  const panelDisposable = api.onDidActivePanelChange(() => onLayoutChange?.());

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

  return {
    dockviewApi: api,
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
      layoutDisposable.dispose();
      panelDisposable.dispose();
      popoutFailureDisposable.dispose();
      outsidePopoutDisposable.dispose();
      api.dispose();
    },
  };
}

export function createWorkbenchFrame(onLayoutChange?: () => void, onPopoutFailure?: () => void): WorkbenchFrameController {
  const container = document.querySelector<HTMLElement>('#workbench-frame')!;
  const moduleStore = document.querySelector<HTMLElement>('#workbench-module-store')!;
  const modules = new Map<string, HTMLElement>();
  for (const definition of Object.values(WORKBENCH_PANEL_DEFINITIONS)) {
    modules.set(definition.moduleElementId, document.querySelector<HTMLElement>(`#${definition.moduleElementId}`)!);
  }

  const api = createDockview(container, {
    theme: themeVisualStudio,
    className: 'onmyoji-dockview onmyoji-workbench-dockview',
    defaultRenderer: 'always',
    popoutUrl: '/popout.html',
    floatingGroupDragHandle: 'titlebar',
    dndStrategy: 'auto',
    createRightHeaderActionComponent: () => new PopoutHeaderAction((group) => !groupContainsWorkflow(group)),
    createTabComponent: ({ name }) => name === 'fixed-workbench' ? new FixedWorkbenchTab() : undefined,
    createComponent: () => new ExistingModuleRenderer(modules, moduleStore),
  });

  let suspendPersistence = true;

  const addPanel = (panelId: WorkbenchPanelId): void => {
    if (api.getPanel(panelId)) return;
    const definition = WORKBENCH_PANEL_DEFINITIONS[panelId];
    const reference = definition.reference ? api.getPanel(definition.reference) : undefined;
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
      position: reference && definition.direction
        ? { referencePanel: reference, direction: definition.direction }
        : undefined,
    });
  };

  const saveLayout = (): void => {
    if (suspendPersistence) return;
    window.localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
    onLayoutChange?.();
  };

  const resetLayout = (): void => {
    suspendPersistence = true;
    api.clear();
    DEFAULT_WORKBENCH_PANEL_ORDER.forEach(addPanel);
    suspendPersistence = false;
    saveLayout();
    window.requestAnimationFrame(() => {
      api.getPanel('contentBrowser')?.api.group.api.setSize({ height: 230 });
    });
  };

  let restored = false;
  const savedLayout = window.localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY);
  if (savedLayout) {
    try {
      api.fromJSON(JSON.parse(savedLayout) as ReturnType<DockviewApi['toJSON']>);
      restored = api.totalPanels > 0;
    } catch {
      window.localStorage.removeItem(WORKBENCH_LAYOUT_STORAGE_KEY);
    }
  }
  if (!restored) resetLayout();
  else if (!api.getPanel('workflow')) addPanel('workflow');
  suspendPersistence = false;

  const layoutDisposable = api.onDidLayoutChange(saveLayout);
  const panelDisposable = api.onDidActivePanelChange(() => onLayoutChange?.());

  const show = (panelId: WorkbenchPanelId): void => {
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
    void api.addPopoutGroup(panel, { popoutUrl: '/popout.html' }).then((opened) => {
      if (!opened) onPopoutFailure?.();
    });
  };

  const popoutFailureDisposable = api.onDidOpenPopoutWindowFail(() => onPopoutFailure?.());
  const outsidePopoutDisposable = registerOutsidePopoutGesture(api, container, onPopoutFailure, (item) => {
    if (item instanceof DockviewGroupPanel) return !groupContainsWorkflow(item);
    return item.api.id !== 'workflow';
  });

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
      layoutDisposable.dispose();
      panelDisposable.dispose();
      popoutFailureDisposable.dispose();
      outsidePopoutDisposable.dispose();
      api.dispose();
    },
  };
}

function isSharedDockPanelId(panelId: string | null | undefined): panelId is SharedDockPanelId {
  return panelId === 'contentBrowser' || panelId === 'runtime';
}

function getTransferredSharedPanelId(
  data: PanelTransfer | undefined,
  sourceApi: DockviewApi,
): SharedDockPanelId | undefined {
  if (!data || data.viewId !== sourceApi.id) return undefined;
  if (isSharedDockPanelId(data.panelId)) return data.panelId;
  if (data.panelId !== null) return undefined;
  const group = sourceApi.getGroup(data.groupId);
  if (group?.panels.length !== 1) return undefined;
  const panelId = group.panels[0]?.api.id;
  return isSharedDockPanelId(panelId) ? panelId : undefined;
}

function addSharedPanelAtDrop(
  api: DockviewApi,
  panelId: SharedDockPanelId,
  position: Position,
  referencePanel?: IDockviewPanel,
): void {
  const definition = SHARED_PANEL_DEFINITIONS[panelId];
  const panel = api.addPanel({
    id: panelId,
    title: definition.title,
    component: 'existing-module',
    params: { moduleElementId: definition.moduleElementId },
    renderer: 'always',
    minimumWidth: definition.minimumWidth,
    minimumHeight: definition.minimumHeight,
    position: referencePanel
      ? { referencePanel, direction: positionToDirection(position) }
      : undefined,
  });
  panel.api.setActive();
  panel.focus();
}

export function connectSharedPanelDocking(
  docking: DockingController,
  workbenchFrame: WorkbenchFrameController,
  onLayoutChange?: () => void,
): SharedPanelDockBridge {
  const innerApi = docking.dockviewApi;
  const outerApi = workbenchFrame.dockviewApi;

  const transfer = (
    sourceApi: DockviewApi,
    targetApi: DockviewApi,
    sourceController: DockingController | WorkbenchFrameController,
    surface: SharedDockSurface,
    event: DockviewDidDropEvent,
    position = event.position,
  ): void => {
    const data = event.getData();
    const panelId = getTransferredSharedPanelId(data, sourceApi);
    if (!panelId || targetApi.getPanel(panelId)) return;
    const sourcePanel = sourceApi.getPanel(panelId);
    if (!sourcePanel) return;

    sourceController.markDragHandled();
    const referencePanel = event.panel ?? event.group?.activePanel ?? targetApi.activePanel;
    sourceApi.removePanel(sourcePanel);
    addSharedPanelAtDrop(targetApi, panelId, position, referencePanel);
    window.localStorage.setItem(SHARED_PANEL_SURFACE_KEYS[panelId], surface);
    onLayoutChange?.();
  };

  const acceptInnerDisposable = innerApi.onUnhandledDragOver((event) => {
    if (getTransferredSharedPanelId(event.getData(), outerApi)) event.accept();
  });
  const acceptOuterDisposable = outerApi.onUnhandledDragOver((event) => {
    if (getTransferredSharedPanelId(event.getData(), innerApi)) event.accept();
  });
  const dropInnerDisposable = innerApi.onDidDrop((event) => {
    transfer(outerApi, innerApi, workbenchFrame, 'inner', event, event.panel ? 'center' : event.position);
  });
  const dropOuterDisposable = outerApi.onDidDrop((event) => {
    transfer(innerApi, outerApi, docking, 'outer', event, event.panel ? 'center' : event.position);
  });
  const revealWorkflowOnSharedDragDisposable = outerApi.onWillDragPanel((event) => {
    const panelId = event.panel.api.id;
    if (isSharedDockPanelId(panelId) && groupContainsWorkflow(event.panel.group)) {
      outerApi.getPanel('workflow')?.api.setActive();
    }
  });
  const outerOverlayDisposable = outerApi.onWillShowOverlay((event) => {
    const target = event.nativeEvent.target;
    const innerContainer = document.querySelector<HTMLElement>('#dock-workspace');
    if (!(target instanceof Node) || !innerContainer?.contains(target)) return;

    const frameBounds = document.querySelector<HTMLElement>('#workbench-frame')?.getBoundingClientRect();
    if (!frameBounds) {
      event.preventDefault();
      return;
    }

    const { clientX, clientY } = event.nativeEvent;
    const outerEdgeSize = 32;
    const isAtOuterEdge = clientX <= frameBounds.left + outerEdgeSize
      || clientX >= frameBounds.right - outerEdgeSize
      || clientY <= frameBounds.top + outerEdgeSize
      || clientY >= frameBounds.bottom - outerEdgeSize;
    if (!isAtOuterEdge) event.preventDefault();
  });

  const preferredSurface = (panelId: SharedDockPanelId): SharedDockSurface => {
    const stored = window.localStorage.getItem(SHARED_PANEL_SURFACE_KEYS[panelId]);
    return stored === 'inner' || stored === 'outer' ? stored : DEFAULT_SHARED_PANEL_SURFACES[panelId];
  };

  const surface = (panelId: SharedDockPanelId): SharedDockSurface | undefined => innerApi.getPanel(panelId)
    ? 'inner'
    : outerApi.getPanel(panelId)
      ? 'outer'
      : undefined;

  for (const panelId of Object.keys(SHARED_PANEL_DEFINITIONS) as SharedDockPanelId[]) {
    const innerPanel = innerApi.getPanel(panelId);
    const outerPanel = outerApi.getPanel(panelId);
    if (innerPanel && outerPanel) {
      innerApi.removePanel(innerPanel);
      outerApi.removePanel(outerPanel);
      if (preferredSurface(panelId) === 'inner') docking.showPanel(panelId);
      else workbenchFrame.show(panelId);
    } else if (innerPanel || outerPanel) {
      window.localStorage.setItem(SHARED_PANEL_SURFACE_KEYS[panelId], innerPanel ? 'inner' : 'outer');
    }
  }

  return {
    surface,
    toggle: (panelId) => {
      const currentSurface = surface(panelId);
      if (currentSurface === 'inner') docking.togglePanel(panelId);
      else if (currentSurface === 'outer') workbenchFrame.toggle(panelId);
      else if (preferredSurface(panelId) === 'inner') docking.showPanel(panelId);
      else workbenchFrame.show(panelId);
    },
    resetSurfaces: () => {
      for (const panelId of Object.keys(DEFAULT_SHARED_PANEL_SURFACES) as SharedDockPanelId[]) {
        window.localStorage.setItem(SHARED_PANEL_SURFACE_KEYS[panelId], DEFAULT_SHARED_PANEL_SURFACES[panelId]);
      }
    },
    dispose: () => {
      acceptInnerDisposable.dispose();
      acceptOuterDisposable.dispose();
      dropInnerDisposable.dispose();
      dropOuterDisposable.dispose();
      revealWorkflowOnSharedDragDisposable.dispose();
      outerOverlayDisposable.dispose();
    },
  };
}
