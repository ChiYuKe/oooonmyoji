/**
 * 独立弹窗「顶置」（总在最前）：
 * 每个可停靠面板的顶置偏好按面板 id 持久化；弹窗打开（含布局恢复重开）时
 * 把偏好回发给弹窗，由弹窗自己调用窗口 API，弹窗标题栏的顶置按钮再把新状态回报过来。
 * 两套 dockview 实例（内层工作流与外层工作台）各装一份；独立成模块以便单元测试。
 */
import type { DockviewApi, DockviewGroupPanel } from 'dockview';

export interface PopoutTopmostStorage {
  read(): Record<string, boolean>;
  write(flags: Record<string, boolean>): void;
}

interface PopoutGroupView {
  window: Window;
  group: DockviewGroupPanel;
}

export function installPopoutAlwaysOnTop(api: DockviewApi, storage: PopoutTopmostStorage): { dispose(): void } {
  const disposables: Array<() => void> = [];

  const wanted = (popout: PopoutGroupView): boolean => {
    const flags = storage.read();
    return popout.group.panels.some((panel) => flags[panel.api.id]);
  };

  // 弹窗还没加载脚本时这条消息会丢，所以弹窗加载完还会用 popoutReady 再要一次。
  const notify = (popout: PopoutGroupView, flag: boolean): void => {
    try {
      popout.window.postMessage({ source: 'dockview-main', type: 'popoutTopmost', flag }, '*');
    } catch {
      // 窗口可能正好在关闭。
    }
  };

  const findPopout = (source: MessageEventSource | null): PopoutGroupView | undefined => {
    if (!source || source === window) return undefined;
    return (api.getPopouts() as unknown as PopoutGroupView[]).find((popout) => popout.window === source);
  };

  for (const popout of api.getPopouts() as unknown as PopoutGroupView[]) if (wanted(popout)) notify(popout, true);
  const added = api.onDidAddPopoutGroup((popout) => {
    const view = popout as PopoutGroupView;
    if (wanted(view)) notify(view, true);
  });
  disposables.push(() => added.dispose());

  const onMessage = (event: MessageEvent<Record<string, unknown>>): void => {
    const data = event.data;
    if (data?.source !== 'dockview-popout') return;
    const popout = findPopout(event.source);
    if (!popout) return;
    if (data.type === 'popoutReady') {
      notify(popout, wanted(popout));
      return;
    }
    if (data.type === 'popoutAlwaysOnTop') {
      const panelId = popout.group.activePanel?.api.id;
      if (!panelId) return;
      storage.write({ ...storage.read(), [panelId]: Boolean(data.flag) });
    }
  };
  window.addEventListener('message', onMessage);
  disposables.push(() => window.removeEventListener('message', onMessage));

  return {
    dispose(): void {
      for (const dispose of disposables) dispose();
    },
  };
}
