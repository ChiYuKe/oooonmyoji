import { createDockview, themeVisualStudio, type DockviewApi, type IHeaderActionsRenderer, type IGroupHeaderProps, type IDockviewGroupPanel } from 'dockview';
import { registerDockBackGesture, registerOutsidePopoutGesture } from '../../../shell/docking/gestures';
import { installGroupRelayout } from '../../../shell/docking/relayout';
import { stripHiddenGroupHeaders } from '../../../shell/docking/layout';

const LAYOUT_KEY = 'onmyoji-studio.souls.workspace-layout';
type Page = 'calculate' | 'community' | 'speed';
interface LayoutStore { readLayout(key: string): string | null; writeLayout(key: string, value: string | null): void }
export interface SoulWorkspace {
  readonly dockviewApi: DockviewApi;
  show(page: Page): void;
  dispose(): void;
}

/** A docked pair inside the single 御魂配装 workbench tab. Moving panels never remounts their controllers. */
export function installSoulWorkspace(host: HTMLElement, calculate: HTMLElement, community: HTMLElement, speed: HTMLElement, storage: LayoutStore): SoulWorkspace {
  const doc = host.ownerDocument;
  const container = doc.createElement('div'); container.className = 'soul-workspace';
  const stash = doc.createElement('div'); stash.hidden = true;
  calculate.id = 'soul-workspace-calculate'; community.id = 'soul-workspace-community'; speed.id = 'soul-workspace-speed';
  calculate.classList.add('soul-workspace-page'); community.classList.add('soul-workspace-page'); speed.classList.add('soul-workspace-page');
  stash.append(calculate, community, speed); host.append(container, stash);
  const modules = { calculate, community, speed };
  let api: DockviewApi;
  const returnToWorkspace = (group: IDockviewGroupPanel): void => {
    for (const panel of [...group.panels]) {
      const page = panel.api.id as Page;
      const other = api.getPanel(page === 'community' ? 'calculate' : page === 'speed' ? 'calculate' : 'community');
      const target = other?.api.location.type === 'grid' ? other.group : api.addGroup();
      panel.api.moveTo({ group: target, position: other?.group === target
        ? page === 'speed' ? 'center' : page === 'community' ? 'right' : 'left'
        : 'center' });
    }
  };
  const popout = async (page: Page): Promise<void> => {
    const panel = api.getPanel(page);
    if (!panel) return;
    if (panel.api.location.type === 'popout') { panel.group.api.getWindow().focus(); return; }
    try {
      const opened = await api.addPopoutGroup(panel, { popoutUrl: '/popout.html' });
      if (!opened) panel.api.setActive();
    } catch { panel.api.setActive(); }
  };
  class Actions implements IHeaderActionsRenderer {
    readonly element = doc.createElement('div');
    private subscriptions: Array<{ dispose(): void }> = [];
    init(params: IGroupHeaderProps): void {
      this.element.className = 'dock-header-actions';
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'dock-popout-action';
      button.textContent = '↗'; button.title = '移到独立窗口'; button.setAttribute('aria-label', button.title);
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('click', event => {
        event.stopPropagation();
        const page = params.group.activePanel?.id as Page | undefined;
        if (params.api.location.type === 'popout') {
          returnToWorkspace(params.group);
        } else if (page) void popout(page);
      });
      const update = (): void => {
        const detached = params.api.location.type === 'popout';
        button.textContent = detached ? '↙' : '↗'; button.title = detached ? '并回御魂配装' : '移到独立窗口'; button.setAttribute('aria-label', button.title);
      };
      this.subscriptions.push(params.api.onDidLocationChange(update));
      update(); this.element.append(button);
    }
    dispose(): void { this.subscriptions.forEach(item => item.dispose()); this.element.replaceChildren(); }
  }
  api = createDockview(container, {
    theme: { ...themeVisualStudio, tabAnimation: 'smooth' }, className: 'onmyoji-dockview onmyoji-soul-dockview',
    defaultRenderer: 'always', popoutUrl: '/popout.html', floatingGroupDragHandle: 'titlebar',
    disableTabsOverflowList: true, dndEdges: false,
    createRightHeaderActionComponent: () => new Actions(),
    createComponent: () => {
      const element = doc.createElement('div'); element.className = 'dock-module-host';
      let content: HTMLElement | undefined;
      return { element,
        init(params) {
          const page = params.params.page as Page;
          content = modules[page]; if (!content) throw new Error('未知御魂页面');
          element.append(content);
        },
        dispose() { if (content?.parentElement === element) stash.append(content); },
      };
    },
  });
  const add = (page: Page): void => {
    if (api.getPanel(page)) return;
    const reference = api.getPanel(page === 'community' ? 'calculate' : page === 'speed' ? 'calculate' : 'community');
    api.addPanel({ id: page, title: page === 'calculate' ? '配装计算' : page === 'speed' ? '速度计算' : '社区御魂配置',
      component: 'soul-page', params: { page }, renderer: 'always', minimumWidth: 220,
      position: reference && reference.api.location.type === 'grid'
        ? { referencePanel: reference, direction: page === 'community' ? 'right' : page === 'speed' ? 'within' : 'left' }
        : undefined });
  };
  let restoring = true, disposed = false;
  const saved = storage.readLayout(LAYOUT_KEY);
  if (saved) {
    try {
      const layout = JSON.parse(saved);
      const panels = Object.keys(layout.panels ?? {});
      if (panels.some(page => page !== 'calculate' && page !== 'community' && page !== 'speed')) throw new Error('未知御魂布局');
      stripHiddenGroupHeaders(layout); api.fromJSON(layout);
    } catch { api.clear(); }
  }
  let balanceInitialPair = !api.totalPanels;
  if (balanceInitialPair) { add('calculate'); add('community'); }
  if (!api.getPanel('speed')) add('speed');
  restoring = false;
  const save = (): void => { if (!restoring && !disposed) storage.writeLayout(LAYOUT_KEY, JSON.stringify(api.toJSON())); };
  const changes = [api.onDidLayoutChange(save), api.onDidActivePanelChange(save)];
  const layout = (): void => {
    if (!disposed && container.clientWidth && container.clientHeight) {
      api.layout(container.clientWidth, container.clientHeight);
      if (balanceInitialPair) {
        balanceInitialPair = false;
        api.getPanel('community')?.group.api.setSize({ width: Math.floor(container.clientWidth / 2) });
      }
    }
  };
  const observer = new ResizeObserver(layout); observer.observe(container); layout();
  const outside = registerOutsidePopoutGesture(api, container);
  const dockBack = registerDockBackGesture(api, returnToWorkspace);
  const relayout = installGroupRelayout(api, container);
  save();
  return { dockviewApi: api,
    show(page) {
      add(page); const panel = api.getPanel(page)!;
      panel.api.setActive();
      if (panel.api.location.type === 'popout') panel.group.api.getWindow().focus();
      else { layout(); panel.focus(); }
    },
    dispose() {
      save(); disposed = true; observer.disconnect(); outside.dispose(); dockBack.dispose(); relayout.dispose();
      changes.forEach(item => item.dispose()); api.dispose(); container.remove(); stash.remove();
    },
  };
}
