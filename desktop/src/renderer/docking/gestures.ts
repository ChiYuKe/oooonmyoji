/**
 * 停靠拖拽手势：把独立窗口分组拖回主窗口、拖出工作区弹成独立窗口、
 * 拖拽期间让出源分组位置，以及外层标签条拖动区与原生拖放的切换。
 * 原 `docking.ts` 的四个 `register*` 函数，依赖全部以参数注入，可独立测试。
 */
import { DockviewGroupPanel, type DockviewApi, type IDockviewPanel } from 'dockview';

/**
 * 把独立窗口里的分组拖回主窗口。
 *
 * 跨窗口的拖放本身不成立：两个窗口各有自己的 DOM、指针事件与拖拽数据，主窗口收不到
 * 来自弹窗的拖拽，dockview 也没有跨窗口的投放目标（所以「拖到某个标签槽位」没法直接实现）。
 * 但可以走对称的那一半：在**弹窗自己的文档**上监听指针/拖拽事件，用屏幕坐标判断松手点
 * 是否落在该窗口之外；是则调用 `api.removeGroup(group)`——这个 dockview 构建在移除弹出
 * 分组时会把分组重新加回主窗口网格（`doRemoveGroup` 的 popout 分支），也就是「拖回来」。
 * 回到主窗口后分组停靠在网格首个位置，再在窗口内拖一次就能放到想要的槽位。
 */
export function registerDockBackGesture(api: DockviewApi): { dispose(): void } {
  const disposables: Array<() => void> = [];

  const watch = (popout: { window: Window; group: DockviewGroupPanel }): void => {
    const win = popout.window;
    const doc = win && win.document;
    if (!doc) return;
    let start: { x: number; y: number } | undefined;
    const markDown = (event: PointerEvent | DragEvent): void => { start = { x: event.screenX, y: event.screenY }; };
    const handleUp = (event: Event): void => {
      const from = start;
      start = undefined;
      if (!from) return;
      const pointer = event as PointerEvent & DragEvent;
      if (!Number.isFinite(pointer.screenX) || !Number.isFinite(pointer.screenY)) return;
      // 只认真正的拖拽：点一下（或窗口内的小幅拖动）不触发回停靠。
      if (Math.abs(pointer.screenX - from.x) + Math.abs(pointer.screenY - from.y) < 8) return;
      const left = win.screenX;
      const top = win.screenY;
      const right = left + win.outerWidth;
      const bottom = top + win.outerHeight;
      const outside = pointer.screenX < left - 4 || pointer.screenX > right + 4
        || pointer.screenY < top - 4 || pointer.screenY > bottom + 4;
      if (!outside) return;
      const group = popout.group;
      if (!group || group.api.location.type !== 'popout') return;
      // 等这次指针事件收尾再动布局，避免在 dockview 自己的拖拽回调里移除分组。
      win.setTimeout(() => {
        try {
          api.removeGroup(group);
        } catch {
          // 窗口可能正好在关闭；此时分组已经不存在，忽略即可。
        }
      }, 0);
    };
    doc.addEventListener('pointerdown', markDown, true);
    doc.addEventListener('pointerup', handleUp, true);
    doc.addEventListener('dragend', handleUp, true);
    disposables.push(() => {
      doc.removeEventListener('pointerdown', markDown, true);
      doc.removeEventListener('pointerup', handleUp, true);
      doc.removeEventListener('dragend', handleUp, true);
    });
  };

  for (const popout of api.getPopouts()) watch(popout as { window: Window; group: DockviewGroupPanel });
  const added = api.onDidAddPopoutGroup((popout) => watch(popout as { window: Window; group: DockviewGroupPanel }));
  return {
    dispose: () => {
      added.dispose();
      for (const dispose of disposables) dispose();
    },
  };
}

export function registerOutsidePopoutGesture(
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

/**
 * Vacate the source presentation while a panel is being dragged. A single-tab
 * group is hidden so neighbouring groups occupy its space; in a multi-tab
 * group another tab is activated so the dragged panel's content is no longer
 * left behind. Cancellation restores the original presentation.
 */
export function registerDraggedSourceGroupVacancy(
  api: DockviewApi,
  onTemporaryLayoutChange: (active: boolean) => void,
): { dispose(): void } {
  let sourceGroup: DockviewGroupPanel | undefined;
  let sourcePanelId: string | undefined;
  let sourceWasVisible = false;
  let sourceWasActive = false;
  let dragGeneration = 0;
  let finishTimer: number | undefined;
  let removeEndListeners: (() => void) | undefined;

  const finish = (): void => {
    dragGeneration += 1;
    if (finishTimer !== undefined) {
      window.clearTimeout(finishTimer);
      finishTimer = undefined;
    }
    removeEndListeners?.();
    removeEndListeners = undefined;

    const group = sourceGroup;
    const panelId = sourcePanelId;
    sourceGroup = undefined;
    sourcePanelId = undefined;
    if (!group || !panelId) return;

    const currentPanel = api.getPanel(panelId);
    const groupStillExists = api.groups.some((candidate) => candidate === group);
    if (groupStillExists && currentPanel?.group === group) {
      if (sourceWasVisible && !group.api.isVisible) group.api.setVisible(true);
      if (sourceWasActive) currentPanel.api.setActive();
    }
    sourceWasVisible = false;
    sourceWasActive = false;
    onTemporaryLayoutChange(false);
  };

  const finishAfterDockview = (): void => {
    if (finishTimer !== undefined) return;
    finishTimer = window.setTimeout(finish, 0);
  };

  const dragDisposable = api.onWillDragPanel((event) => {
    finish();
    const group = event.panel.group;
    const location = group.api.location.type;
    const canHideWholeGroup = group.panels.length === 1 && location !== 'popout' && location !== 'edge';
    const replacementPanel = group.panels.length > 1 && group.activePanel === event.panel
      ? group.panels.find((panel) => panel !== event.panel)
      : undefined;
    if (!canHideWholeGroup && !replacementPanel) return;

    const panelId = event.panel.api.id;
    const replacementPanelId = replacementPanel?.api.id;
    const generation = ++dragGeneration;
    const ownerDocument = group.api.getWindow().document;
    const eventTarget = event.nativeEvent.target;
    const usesHtml5Drag = 'dataTransfer' in event.nativeEvent;
    const endEvents = usesHtml5Drag ? ['dragend'] : ['pointerup', 'pointercancel'];
    const listener = (): void => finishAfterDockview();
    for (const eventName of endEvents) {
      ownerDocument.addEventListener(eventName, listener, true);
      if (eventTarget instanceof EventTarget) eventTarget.addEventListener(eventName, listener, true);
    }
    removeEndListeners = () => {
      for (const eventName of endEvents) {
        ownerDocument.removeEventListener(eventName, listener, true);
        if (eventTarget instanceof EventTarget) eventTarget.removeEventListener(eventName, listener, true);
      }
    };

    group.api.getWindow().requestAnimationFrame(() => {
      if (generation !== dragGeneration || api.getPanel(panelId)?.group !== group) return;
      sourceGroup = group;
      sourcePanelId = panelId;
      sourceWasVisible = group.api.isVisible;
      sourceWasActive = group.activePanel === event.panel;
      if (canHideWholeGroup && !sourceWasVisible) return;
      onTemporaryLayoutChange(true);
      if (canHideWholeGroup) {
        group.api.setVisible(false);
      } else if (replacementPanelId) {
        const currentReplacement = api.getPanel(replacementPanelId);
        if (currentReplacement?.group === group) currentReplacement.api.setActive();
      }
    });
  });

  return {
    dispose: () => {
      dragDisposable.dispose();
      finish();
    },
  };
}

let tabStripWindowDragInstalled = false;

/**
 * 外层工作区标签条空白处平时作为窗口拖动区（-webkit-app-region: drag），
 * 但 Electron 会在该区域吞掉原生拖放事件，导致面板无法拖回这里停靠。
 * 因此在原生拖拽进行期间给 body 加 dockview-dragging 类临时关闭拖动区。
 */
export function installTabStripWindowDragToggle(): void {
  if (tabStripWindowDragInstalled) return;
  tabStripWindowDragInstalled = true;
  const setActive = (active: boolean): void => {
    document.body.classList.toggle('dockview-dragging', active);
  };
  document.addEventListener('dragstart', () => setActive(true), true);
  document.addEventListener('dragenter', () => setActive(true), true);
  document.addEventListener('dragover', () => setActive(true), true);
  document.addEventListener('drop', () => setActive(false), true);
  document.addEventListener('dragend', () => setActive(false), true);
  document.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) setActive(false);
  }, true);
  window.addEventListener('blur', () => setActive(false));
}
