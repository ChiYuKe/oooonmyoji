/**
 * 桌面壳层的删除快捷键：登记目标（内容项/队列行/画布选区）的解析与执行。
 *
 * 原 `main.ts` 的 isTextEditingTarget/performDeleteTarget/handleDeleteShortcut/
 * resetDeleteTargetOnPointerDown 与 deleteTarget 状态；Delete/Backspace 只作用于
 * 最近一次被点选的目标，新的一次点击先作废上一次登记。
 * 依赖全部注入（面板句柄经惰性箭头传入，避免构造期互相引用），可独立测试。
 */

/** 桌面壳层的删除键目标：由各面板的点击处理器登记，新的一次点击会先作废上一次登记。
 * editor 表示“结构树/变量列表里选中的东西”，交给画布执行删除。 */
export type DeleteTarget =
  | { kind: 'content'; path: string }
  | { kind: 'queue'; rel: string }
  | { kind: 'editor' };

export interface DeleteShortcutDeps {
  matchesShortcut(event: KeyboardEvent, id: string): boolean;
  overview: {
    isSelected(rel: string): boolean;
    isRunning(): boolean;
    updateSelection(rel: string, checked: boolean): void;
    selectQueueRow(rel: string): void;
  };
  roiPicker: { isOpen(): boolean };
  contentBrowser: {
    resolveDeleteTarget(path: string): { kind?: string; path?: string } | undefined;
    isRootFolder(path: string): boolean;
    deleteItem(item: unknown): void;
    isNameDialogOpen(): boolean;
  };
  workspace: { editorCommand(command: string, value?: unknown): void };
  showToast(message: string, error?: boolean): void;
}

export interface DeleteShortcutController {
  /** 焦点是否落在文本编辑控件里（输入/文本域/选择/可编辑区）。 */
  isTextEditingTarget(target: EventTarget | null): boolean;
  /** 把登记的路径解析成当前内容浏览器里的条目并执行删除；返回是否吃掉了按键。 */
  performDeleteTarget(origin?: KeyboardEvent): boolean;
  /** 桌面壳层的删除快捷键；没有登记目标时不拦截按键。 */
  handleDeleteShortcut(event: KeyboardEvent): boolean;
  /** 新的点击先作废上一次的删除目标，再由具体行/项的点击处理器重新登记。 */
  resetDeleteTargetOnPointerDown(event: PointerEvent): void;
  getDeleteTarget(): DeleteTarget | undefined;
  setDeleteTarget(target: DeleteTarget | undefined): void;
}

export function createDeleteShortcuts(deps: DeleteShortcutDeps): DeleteShortcutController {
  const { matchesShortcut, overview, roiPicker, contentBrowser, workspace, showToast } = deps;
  /** 最近一次被点选的删除目标（内容项、队列行或画布选区）；Delete/Backspace 只作用于它。 */
  let deleteTarget: DeleteTarget | undefined;

  function isTextEditingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
  }

  /**
   * 把登记的路径解析成当前内容浏览器里的条目。
   * 用路径而不是条目对象，重命名/移动后仍能命中最新数据；找不到时回退到当前选中项。
   */
  function performDeleteTarget(origin?: KeyboardEvent): boolean {
    const target = deleteTarget;
    if (!target) return false;
    if (target.kind === 'editor') {
      origin?.preventDefault();
      workspace.editorCommand('deleteSelection');
      return true;
    }
    if (target.kind === 'queue') {
      if (!overview.isSelected(target.rel)) {
        deleteTarget = undefined;
        return false;
      }
      if (overview.isRunning()) {
        showToast('队列运行中，无法移出脚本', true);
        return true;
      }
      origin?.preventDefault();
      deleteTarget = undefined;
      overview.selectQueueRow('');
      overview.updateSelection(target.rel, false);
      return true;
    }
    const item = contentBrowser.resolveDeleteTarget(target.path);
    if (!item) {
      deleteTarget = undefined;
      return false;
    }
    if (item.kind === 'folder' && (!item.path || contentBrowser.isRootFolder(item.path))) {
      showToast('项目根目录不能删除', true);
      return true;
    }
    origin?.preventDefault();
    deleteTarget = undefined;
    void contentBrowser.deleteItem(item);
    return true;
  }

  /** 桌面壳层的删除快捷键；没有登记目标时不拦截按键。 */
  function handleDeleteShortcut(event: KeyboardEvent): boolean {
    if (!matchesShortcut(event, 'global.delete')) return false;
    if (event.defaultPrevented) return false;
    if (isTextEditingTarget(event.target)) return false;
    if (roiPicker.isOpen() || contentBrowser.isNameDialogOpen()) return false;
    return performDeleteTarget(event);
  }

  /** 新的点击先作废上一次的删除目标，再由具体行/项的点击处理器重新登记。 */
  function resetDeleteTargetOnPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    deleteTarget = undefined;
  }

  return {
    isTextEditingTarget,
    performDeleteTarget,
    handleDeleteShortcut,
    resetDeleteTargetOnPointerDown,
    getDeleteTarget: () => deleteTarget,
    setDeleteTarget: (target) => { deleteTarget = target; },
  };
}
