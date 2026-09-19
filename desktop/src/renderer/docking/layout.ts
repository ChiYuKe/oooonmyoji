/**
 * 停靠布局持久化：布局存储键、布局读写与标签拖放的投放覆盖模型。
 * 原 `docking.ts` 的常量与布局读写函数，抽出供 docking/shared-panels 共用。
 */
import type { DroptargetOverlayModel } from 'dockview';

/** 详细信息恢复为工作流内部的整高停靠列，旧布局层级不再兼容，
 * 因此通过版本号让这次结构调整使用新的默认布局。 */
export const LAYOUT_STORAGE_KEY = 'onmyoji-studio.dock-layout.v10';
export const WORKBENCH_LAYOUT_STORAGE_KEY = 'onmyoji-studio.workbench-layout.v10';

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
