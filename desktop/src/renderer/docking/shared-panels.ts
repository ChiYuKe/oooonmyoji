/**
 * 共享面板（内容浏览器/运行日志/变量引用）的内外层停靠：定义、层选择、
 * 跨层转移与桥接控制器。原 `docking.ts` 的共享面板部分。
 *
 * 共享面板可能同时存在于内层（工作流 Dockview）与外层（工作台 Dockview），
 * 或仅在一层；`connectSharedPanelDocking` 统一处理拖拽转移、去重与层记忆。
 */
import {
  positionToDirection,
  type DockviewApi,
  type DockviewDidDropEvent,
  type IDockviewPanel,
  type PanelTransfer,
  type Position,
} from 'dockview';
import type { DockingController, DockPanelDefinition, SharedDockPanelId, SharedDockSurface, SharedPanelDockBridge, WorkbenchFrameController } from '../docking';
import { groupContainsWorkflow } from './documents';
import { persistLayout, readPersistedLayout } from './layout';

export const SHARED_PANEL_SURFACE_KEYS: Record<SharedDockPanelId, string> = {
  contentBrowser: 'onmyoji-studio.content-browser-dock-surface',
  runtime: 'onmyoji-studio.runtime-dock-surface',
  variableReferences: 'onmyoji-studio.variable-references-dock-surface',
};

export const DEFAULT_SHARED_PANEL_SURFACES: Record<SharedDockPanelId, SharedDockSurface> = {
  contentBrowser: 'inner',
  runtime: 'inner',
  // 「变量引用」是「内容浏览器」的伴生面板：默认跟它同层，才能叠成同一个标签组。
  variableReferences: 'inner',
};

/**
 * 伴生面板：自身没有固定归属的层，跟着另一个共享面板走。
 * 「变量引用」列的是「谁在引用某个变量」，用户下一步多半就是去内容浏览器里找那个工作流，
 * 所以内容浏览器在哪一层，它就默认开在哪一层——两边都声明了 `reference: contentBrowser`，
 * 于是不管在哪一层打开，它都叠在内容浏览器旁边。
 */
export const COMPANION_SHARED_PANELS: Partial<Record<SharedDockPanelId, SharedDockPanelId>> = {
  variableReferences: 'contentBrowser',
};

export const SHARED_PANEL_DEFINITIONS: Record<SharedDockPanelId, DockPanelDefinition> = {
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
  variableReferences: {
    title: '变量引用',
    moduleElementId: 'module-variable-references',
    minimumWidth: 300,
    minimumHeight: 240,
  },
};

export function isSharedDockPanelId(panelId: string | null | undefined): panelId is SharedDockPanelId {
  return panelId === 'contentBrowser' || panelId === 'runtime' || panelId === 'variableReferences';
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
    if (!panelId) return;
    const sourcePanel = sourceApi.getPanel(panelId);
    if (!sourcePanel) return;

    // A stale layout can leave the same shared panel on both surfaces. When a
    // duplicate is dragged across, keep the existing target instance and drop
    // the source so the shared module remains single-instanced.
    if (targetApi.getPanel(panelId)) {
      sourceController.markDragHandled();
      sourceApi.removePanel(sourcePanel);
      return;
    }

    sourceController.markDragHandled();
    const referencePanel = event.panel ?? event.group?.activePanel ?? targetApi.activePanel;
    sourceApi.removePanel(sourcePanel);
    addSharedPanelAtDrop(targetApi, panelId, position, referencePanel);
    persistLayout(SHARED_PANEL_SURFACE_KEYS[panelId], surface);
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
    const stored = readPersistedLayout(SHARED_PANEL_SURFACE_KEYS[panelId]);
    return stored === 'inner' || stored === 'outer' ? stored : DEFAULT_SHARED_PANEL_SURFACES[panelId];
  };

  const surface = (panelId: SharedDockPanelId): SharedDockSurface | undefined => innerApi.getPanel(panelId)
    ? 'inner'
    : outerApi.getPanel(panelId)
      ? 'outer'
      : undefined;

  const reconcileSharedPanel = (panelId: SharedDockPanelId): void => {
    const innerPanel = innerApi.getPanel(panelId);
    const outerPanel = outerApi.getPanel(panelId);
    if (innerPanel && outerPanel) {
      const keepInner = preferredSurface(panelId) === 'inner';
      if (keepInner) outerApi.removePanel(outerPanel);
      else innerApi.removePanel(innerPanel);
      persistLayout(SHARED_PANEL_SURFACE_KEYS[panelId], keepInner ? 'inner' : 'outer');
    } else if (innerPanel || outerPanel) {
      persistLayout(SHARED_PANEL_SURFACE_KEYS[panelId], innerPanel ? 'inner' : 'outer');
    }
  };

  for (const panelId of Object.keys(SHARED_PANEL_DEFINITIONS) as SharedDockPanelId[]) {
    reconcileSharedPanel(panelId);
  }

  // 「变量引用」列的是本次会话里某个变量的引用者，没有目标就没有内容：
  // 恢复布局时一律关掉（内层/外层都可能残留），要用时再叠到内容浏览器旁边。
  for (const surfaceApi of [innerApi, outerApi]) {
    surfaceApi.getPanel('variableReferences')?.api.close();
  }

  /** 开面板时该选哪一层：伴生面板跟着它的宿主面板走，其余按上次记住的层。 */
  const targetSurface = (panelId: SharedDockPanelId): SharedDockSurface => {
    const companion = COMPANION_SHARED_PANELS[panelId];
    const companionSurface = companion ? surface(companion) : undefined;
    return companionSurface ?? preferredSurface(panelId);
  };

  return {
    surface,
    show: (panelId) => {
      reconcileSharedPanel(panelId);
      const currentSurface = surface(panelId);
      if (currentSurface === 'inner') docking.showPanel(panelId);
      else if (currentSurface === 'outer') workbenchFrame.show(panelId);
      else if (targetSurface(panelId) === 'inner') docking.showPanel(panelId);
      else workbenchFrame.show(panelId);
    },
    toggle: (panelId) => {
      const currentSurface = surface(panelId);
      if (currentSurface === 'inner') docking.togglePanel(panelId);
      else if (currentSurface === 'outer') workbenchFrame.toggle(panelId);
      else if (targetSurface(panelId) === 'inner') docking.showPanel(panelId);
      else workbenchFrame.show(panelId);
    },
    close: (panelId) => {
      innerApi.getPanel(panelId)?.api.close();
      outerApi.getPanel(panelId)?.api.close();
    },
    resetSurfaces: () => {
      for (const panelId of Object.keys(DEFAULT_SHARED_PANEL_SURFACES) as SharedDockPanelId[]) {
        persistLayout(SHARED_PANEL_SURFACE_KEYS[panelId], DEFAULT_SHARED_PANEL_SURFACES[panelId]);
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
