/**
 * 停靠布局持久化：布局存储键、布局读写与标签拖放的投放覆盖模型。
 * 原 `docking.ts` 的常量与布局读写函数，抽出供 docking/shared-panels 共用。
 */
import type { DroptargetOverlayModel } from 'dockview';

/** 详细信息恢复为工作流内部的整高停靠列，旧布局层级不再兼容，
 * 因此通过版本号让这次结构调整使用新的默认布局。 */
export const LAYOUT_STORAGE_KEY = 'onmyoji-studio.dock-layout.v10';
export const WORKBENCH_LAYOUT_STORAGE_KEY = 'onmyoji-studio.workbench-layout.v10';
/** 独立弹窗「顶置」偏好：面板 id → 是否总在最前。 */
export const POPOUT_ALWAYS_ON_TOP_STORAGE_KEY = 'onmyoji-studio.popout-always-on-top';

// A tab is one merge target. Dockview still uses the cursor's left/right half
// internally to decide the insertion order, but a half-width preview makes it
// look as though the tab itself can be split into two panes.
const WHOLE_TAB_DROP_OVERLAY_MODEL: DroptargetOverlayModel = {
  size: { value: 100, type: 'percentage' },
  activationSize: { value: 50, type: 'percentage' },
  smallWidthBoundary: 0,
  smallHeightBoundary: 0,
};

export function resolveDropOverlayModel(location: string): DroptargetOverlayModel | undefined {
  return location === 'tab' ? WHOLE_TAB_DROP_OVERLAY_MODEL : undefined;
}

export function readPersistedLayout(key: string): string | null {
  const stored = window.onmyoji.readLayout(key);
  return stored ?? window.localStorage.getItem(key);
}

export function persistLayout(key: string, value: string): void {
  window.onmyoji.writeLayout(key, value);
}

/** 丢掉一份坏掉或不再兼容的布局：主进程存储与 localStorage 回退副本一起清。 */
export function clearPersistedLayout(key: string): void {
  window.onmyoji.writeLayout(key, null);
  window.localStorage.removeItem(key);
}

/**
 * 抹掉布局里残留的「隐藏分组标签栏」（`hideHeader`）与竖排标签栏（`headerPosition`）。
 *
 * dockview 只在按 JSON 恢复布局时才可能用 `hideHeader` 建分组：布局一旦带上它，恢复出来
 * 的分组就没有标签栏——面板内容直接顶到分组顶部，用户看到的现象就是「标签页标签都不见了」，
 * 而且此后每次 `toJSON()` 都会把它原样写回去，自己不会恢复（实测：布局里给两个叶子加上
 * `hideHeader: true` 后，两个分组的标签栏高度都是 0，内容容器起点从 60 变成 32）。
 * 这个应用没有任何「隐藏标签栏」的用法，所以恢复前统一清掉，坏存档也不会再传染。
 */
export function stripHiddenGroupHeaders(layout: unknown): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if ('hideHeader' in record) delete record.hideHeader;
    if (record.headerPosition !== undefined && record.headerPosition !== 'top') delete record.headerPosition;
    for (const item of Object.values(record)) visit(item);
  };
  visit(layout);
}

/** 社区页面并入配装模块后，清理旧独立面板，保留其余布局与弹出窗口。 */
export function mergeCommunityComparisonLayout(layout: unknown): boolean {
  if (!layout || typeof layout !== 'object') return false;
  const record = layout as Record<string, any>;
  const source = 'soulCommunityComparison', target = 'soulOptimizer';
  const groups: Array<Record<string, any>> = [];
  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(collect); return; }
    const node = value as Record<string, any>;
    if (Array.isArray(node.views)) { groups.push(node); return; }
    Object.values(node).forEach(collect);
  };
  for (const key of ['grid', 'floatingGroups', 'popoutGroups', 'edgeGroups']) collect(record[key]);
  const sourceGroups = groups.filter(group => group.views.includes(source));
  if (!sourceGroups.length) {
    if (record.panels && typeof record.panels === 'object') delete record.panels[source];
    return false;
  }
  let anchor = groups.find(group => group.views.includes(target));
  if (!anchor) {
    anchor = sourceGroups[0];
    anchor.views.splice(anchor.views.indexOf(source), 0, target);
    record.panels ??= {};
    record.panels[target] = { id: target, contentComponent: 'existing-module', title: '御魂配装', params: { moduleElementId: 'module-soul-optimizer' } };
  }
  for (const group of sourceGroups) {
    group.views = group.views.filter((view: unknown) => view !== source);
    if (group.activeView === source) {
      group.activeView = group.views.includes(target) ? target : group.views[0];
      if (record.activeGroup === group.id) {
        anchor.activeView = target; record.activeGroup = anchor.id;
      }
    }
  }
  if (record.panels && typeof record.panels === 'object') delete record.panels[source];
  const prune = (node: any, root = false): any => {
    if (!node || typeof node !== 'object') return node;
    if (node.type === 'leaf') return Array.isArray(node.data?.views) && !node.data.views.length ? undefined : node;
    if (node.type === 'branch' && Array.isArray(node.data)) {
      node.data = node.data.map((child: any) => prune(child)).filter((child: any) => child !== undefined);
      if (!root && !node.data.length) return undefined;
    }
    return node;
  };
  if (record.grid) record.grid.root = prune(record.grid.root, true);
  for (const key of ['floatingGroups', 'popoutGroups']) {
    if (!Array.isArray(record[key])) continue;
    record[key] = record[key].filter((group: any) => {
      const grid = group?.grid ?? group?.data?.grid;
      if (grid) { grid.root = prune(grid.root); return grid.root !== undefined; }
      return !Array.isArray(group?.data?.views) || group.data.views.length > 0;
    });
  }
  if (record.activeGroup && !groups.some(group => group.views.length && group.id === record.activeGroup)) record.activeGroup = anchor.id;
  return true;
}

/**
 * 把某个面板挪到另一个面板所在的标签行（同一个分组）里。
 *
 * 用途：「社区方案比对」要与「御魂配装」共用同一行标签——就像「运行日志」跟
 * 「内容浏览器」那样并排在同一行里，而不是单独停在外面一个分组。旧布局里它可能
 * 孤零零占一个分组（甚至整列），恢复时先把它挪到参照面板旁边，空出来的分组剪掉。
 * 面板本来就没打开过（布局里没有它）时什么都不做：关闭就是关闭。
 *
 * 两个坑：剪枝不会把「只剩一个子节点」的分支收上去（dockview 要求根节点必须是
 * branch，收窄它会以 `root must be of type branch` 拒绝整份布局）；也不动
 * `activeView`（除非它指向被挪走的面板）。
 */
export function moveLayoutPanel(layout: unknown, panelId: string, anchorPanelId: string): void {
  if (!layout || typeof layout !== 'object' || panelId === anchorPanelId) return;
  const target = layout as { grid?: unknown; floatingGroups?: unknown };

  interface LeafData { views?: unknown; activeView?: unknown }
  const leaves: LeafData[] = [];
  let present = false;
  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: unknown; data?: unknown };
    if (node.type === 'leaf') {
      const data = (node.data ?? {}) as LeafData;
      if (Array.isArray(data.views)) {
        if (data.views.includes(panelId)) present = true;
        leaves.push(data);
      }
      return;
    }
    if (node.type === 'branch' && Array.isArray(node.data)) for (const child of node.data) collect(child);
  };
  const gridRoots: Array<{ root?: unknown }> = [];
  const floatingGrids: Array<{ root?: unknown }> = [];
  if (target.grid && typeof target.grid === 'object') gridRoots.push(target.grid as { root?: unknown });
  if (Array.isArray(target.floatingGroups)) {
    for (const group of target.floatingGroups) {
      const grid = (group as { data?: { grid?: { root?: unknown } } } | undefined)?.data?.grid;
      if (grid && typeof grid === 'object') {
        gridRoots.push(grid);
        floatingGrids.push(grid);
      }
    }
  }
  for (const grid of gridRoots) collect(grid.root);
  if (!present) return;
  const anchor = leaves.find((data) => Array.isArray(data.views) && data.views.includes(anchorPanelId));
  if (!anchor) return;

  for (const data of leaves) {
    const views = data.views as string[];
    const index = views.indexOf(panelId);
    if (index < 0) continue;
    views.splice(index, 1);
    if (data.activeView === panelId) data.activeView = views[0];
  }
  const anchorViews = anchor.views as string[];
  anchorViews.splice(anchorViews.indexOf(anchorPanelId) + 1, 0, panelId);

  // 剪掉空出来的分组（根节点保持 branch，见上）。
  const pruneNode = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    const node = value as { type?: unknown; data?: unknown };
    if (node.type === 'leaf') {
      const data = (node.data ?? {}) as LeafData;
      return Array.isArray(data.views) && data.views.length === 0 ? undefined : node;
    }
    if (node.type === 'branch' && Array.isArray(node.data)) {
      node.data = node.data.map(pruneNode).filter((child) => child !== undefined);
      return node;
    }
    return node;
  };
  for (const grid of floatingGrids) {
    // 浮动分组空掉就整个丢掉（置 undefined，下面直接过滤掉）。
    grid.root = pruneNode(grid.root);
  }
  if (target.grid && typeof target.grid === 'object') {
    // 主网格的根节点必须留着（dockview 要求 root 是 branch），空面板由应用退回默认布局。
    const mainGrid = target.grid as { root?: unknown };
    const root = pruneNode(mainGrid.root);
    if (root !== undefined) mainGrid.root = root;
  }
  if (Array.isArray(target.floatingGroups)) {
    target.floatingGroups = target.floatingGroups.filter((group) => {
      const grid = (group as { data?: { grid?: { root?: unknown } } } | undefined)?.data?.grid;
      return grid && typeof grid === 'object' ? grid.root !== undefined : true;
    });
  }
}
