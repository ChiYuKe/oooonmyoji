/**
 * 桌面壳层的重命名快捷键（F2）：复用 `delete-shortcuts` 登记的最近点选目标，
 * 内容条目弹出重命名对话框，画布选区聚焦详情面板的节点名称输入框。
 * 与删除快捷键一致：目标由各面板点击时登记——内容浏览器、目录/面包屑与结构树——
 * F2 只作用于最近一次被点选的目标；队列行没有重命名入口，不拦截按键。
 */
import type { DeleteTarget } from './delete-shortcuts';

export interface RenameShortcutDeps {
  matchesShortcut(event: KeyboardEvent, id: string): boolean;
  /** 读取删除快捷键登记的目标（内容路径/队列行/画布选区），重命名复用同一份登记。 */
  getDeleteTarget(): DeleteTarget | undefined;
  roiPicker: { isOpen(): boolean };
  contentBrowser: {
    /** 把登记的路径解析成当前内容浏览器里的条目（找不到时回退到当前选中项）。 */
    resolveRenameTarget(path: string): { kind?: string; path?: string; name?: string } | undefined;
    isRootFolder(path: string): boolean;
    /** 打开重命名对话框并执行重命名（不替换目标，改名后仍可继续 F2）。 */
    renameItem(item: unknown): void;
    isNameDialogOpen(): boolean;
  };
  /** 左侧面板（结构树 / 变量列表）：选中的行原地变成输入框改名。 */
  panels: {
    renameNode(nodeId: string): void;
    renameVariable(name: string, scope: 'inputs' | 'variables'): void;
  };
  workspace: { editorCommand(command: string, value?: unknown): void };
  showToast(message: string, error?: boolean): void;
}

export interface RenameShortcutController {
  /** 焦点是否落在文本编辑控件里（输入/文本域/选择/可编辑区）。 */
  isTextEditingTarget(target: EventTarget | null): boolean;
  /** 桌面壳层的重命名快捷键；没有登记目标时不拦截按键。 */
  handleRenameShortcut(event: KeyboardEvent): boolean;
}

export function createRenameShortcuts(deps: RenameShortcutDeps): RenameShortcutController {
  const { matchesShortcut, getDeleteTarget, roiPicker, contentBrowser, panels, workspace, showToast } = deps;

  function isTextEditingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
  }

  /** 桌面壳层的重命名快捷键；没有登记目标时不拦截按键。 */
  function handleRenameShortcut(event: KeyboardEvent): boolean {
    if (!matchesShortcut(event, 'global.rename')) return false;
    if (event.defaultPrevented) return false;
    if (isTextEditingTarget(event.target)) return false;
    if (roiPicker.isOpen() || contentBrowser.isNameDialogOpen()) return false;
    const target = getDeleteTarget();
    if (!target) return false;
    if (target.kind === 'content') {
      const item = contentBrowser.resolveRenameTarget(target.path);
      if (!item) return false;
      event.preventDefault();
      if (item.kind === 'folder' && contentBrowser.isRootFolder(String(item.path))) {
        showToast('项目根目录不能重命名', true);
        return true;
      }
      contentBrowser.renameItem(item);
      return true;
    }
    if (target.kind === 'editor') {
      event.preventDefault();
      // 面板行点选的目标：在那一行原地改名（与内容浏览器同一套手感）。
      if (target.variable) {
        panels.renameVariable(target.variable.name, target.variable.scope);
        return true;
      }
      if (target.nodeId) {
        panels.renameNode(target.nodeId);
        return true;
      }
      // 没有面板行信息（画布里的选区）：交给详情栏镜像聚焦名称输入框。
      workspace.editorCommand('renameSelection');
      return true;
    }
    // 队列行没有重命名通道：交回给其它处理（例如浏览器默认行为）。
    return false;
  }

  return { isTextEditingTarget, handleRenameShortcut };
}