/**
 * 分组头部（标签栏）兜底修复：让「标签页标签不见了」这件事自己恢复。
 *
 * 现象有两种来源：
 *  1. `hideHeader`：dockview 只在按 JSON 恢复布局时才可能用它建分组（恢复前已由
 *     `stripHiddenGroupHeaders` 清掉，这里再兜一层：发现标签栏被隐藏就放回来）。
 *  2. 面板内容层错位：面板内容渲染在宿主级的 `.dv-render-overlay` 里，靠测量参考容器
 *     的矩形来定位；拖动/弹出搬窗口之后这个测量可能停留在旧值，内容层就被画到分组
 *     顶部、把整条标签栏盖住。dockview 只在**宿主尺寸变化**时重排并重定位这些层
 *     （`updateAllPositions`），所以这里做两件事：重新测量分组布局（`relayout()`），
 *     以及必要时把宿主尺寸抖 1px 一帧，逼它重定位内容层。
 *
 * 除了结构性变更（拖放收尾、弹出、收回、按 JSON 恢复布局）之外，还有一秒一次的看门狗：
 * 真的坏掉了就地修好，不需要重启应用。
 */
import type { DockviewApi } from 'dockview';

export interface GroupRelayout {
  /** 立即重新测量并重排所有分组；发现标签栏被藏/被盖一并修掉。 */
  relayoutNow(): void;
  /** 延后一拍重排；同一轮里的多次请求会合并成一次。 */
  requestRelayout(): void;
  dispose(): void;
}

export function installGroupRelayout(
  api: DockviewApi,
  container?: HTMLElement | null,
  delayMs = 20,
): GroupRelayout {
  let timer: number | undefined;
  let watchdog: number | undefined;
  let disposed = false;

  const domGroups = (): HTMLElement[] => container
    ? Array.from(container.querySelectorAll<HTMLElement>('.dv-groupview')).filter(group => group.closest('.dv-dockview') === container)
    : [];

  const headerOf = (group: HTMLElement): HTMLElement | null =>
    group.querySelector<HTMLElement>(':scope > .dv-tabs-and-actions-container');

  /** 标签栏那一点最上层是不是被面板内容层（`.dv-render-overlay`）盖住了。 */
  const stripCovered = (group: HTMLElement): boolean => {
    const header = headerOf(group);
    if (!header) return false;
    const rect = header.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 4) return false;
    const x = rect.left + Math.min(60, rect.width / 2);
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    return document.elementsFromPoint(x, y).slice(0, 5).some((node) => {
      if (!(node instanceof Element)) return false;
      const overlay = node.closest('.dv-render-overlay');
      // 内层停靠区本身位于外层内容层里；外层祖先不是覆盖内层标签的故障。
      return overlay?.closest('.dv-dockview') === group.closest('.dv-dockview');
    });
  };

  const needsRepair = (): boolean => {
    for (const group of api.groups) {
      try {
        if (group.header?.hidden) return true;
      } catch {
        // 分组可能正好在被销毁或迁移到独立窗口。
      }
    }
    return domGroups().some((group) => {
      const header = headerOf(group);
      if (!header) return false;
      return header.getBoundingClientRect().height < 4 || stripCovered(group);
    });
  };

  /** 把宿主尺寸抖 1px 一帧：dockview 的 ResizeObserver 会重排并重定位内容层。 */
  const nudgeHost = (): void => {
    if (!container) return;
    const previous = container.style.paddingRight;
    container.style.paddingRight = previous === '1px' ? '0px' : '1px';
    window.requestAnimationFrame(() => {
      container.style.paddingRight = previous;
    });
  };

  const relayoutNow = (): void => {
    if (disposed) return;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    for (const group of api.groups) {
      try {
        // `header.hidden` 是 dockview 的公开接口；标签栏被隐藏时分组的标签栏高度是 0，
        // 面板内容会顶到分组顶部。这里先放回来，再重新测量高度并重排。
        if (group.header?.hidden) group.header.hidden = false;
      } catch {
        // 分组可能正好在被销毁或迁移到独立窗口，跳过就好。
      }
      try {
        group.relayout();
      } catch {
        // 同上。
      }
    }
    // 内容层错位不在分组布局里，得靠宿主尺寸变化逼 dockview 重定位。
    if (domGroups().some((group) => stripCovered(group))) nudgeHost();
  };

  const requestRelayout = (): void => {
    if (disposed) return;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      relayoutNow();
    }, delayMs);
  };

  const disposables: Array<() => void> = [
    api.onDidAddPopoutGroup(requestRelayout),
    api.onDidRemovePopoutGroup(requestRelayout),
    api.onDidLayoutFromJSON(requestRelayout),
    api.onDidMovePanel(requestRelayout),
    api.onDidMutateLayout(requestRelayout),
  ].map((disposable) => () => disposable.dispose());

  // 拖拽收尾信号：原生拖放被丢到窗口外时事件不一定回到源元素，所以和窗口失焦一起听。
  const settleEvents = ['dragend', 'drop'] as const;
  for (const type of settleEvents) document.addEventListener(type, requestRelayout, true);
  window.addEventListener('blur', requestRelayout);
  window.addEventListener('focus', requestRelayout);
  disposables.push(() => {
    for (const type of settleEvents) document.removeEventListener(type, requestRelayout, true);
    window.removeEventListener('blur', requestRelayout);
    window.removeEventListener('focus', requestRelayout);
  });

  // 看门狗：标签栏被藏起来或被内容层盖住就地修好，不用重启应用。
  watchdog = window.setInterval(() => {
    if (!disposed && needsRepair()) relayoutNow();
  }, 1000);

  // 安装后立刻扫一次：布局刚恢复完时可能已经带着坏状态。
  requestRelayout();

  return {
    relayoutNow,
    requestRelayout,
    dispose: () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      if (watchdog !== undefined) {
        window.clearInterval(watchdog);
        watchdog = undefined;
      }
      for (const dispose of disposables) dispose();
    },
  };
}
