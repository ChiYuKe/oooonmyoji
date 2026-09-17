/**
 * 画布历史与命令包装：快照语义、一次用户操作的历史边界、撤销重做与文档替换。
 * 原 `workflow-editor.js` 的 snapshot/mutate/restore/replaceDocument/undo/redo。
 *
 * 保留既有快照语义（不引入事件溯源）；连续拖拽等由调用方合并为一次 mutate。
 */
import type { CanvasState } from './canvas-state';

export interface HistoryDeps {
  state: CanvasState;
  /** 变量公开输入的最后引用解除后清理（VariableSystem.cleanupReleased）。 */
  cleanupReleased(raw: Record<string, any> | null, before: Record<string, any>): string[];
  clearVariableCardSelection(): void;
  nodeById(id: string): any;
  /** 载入/外部变更时的工作流规范化（原 normalizeRaw）。 */
  normalizeRaw(raw: unknown): Record<string, any>;
  setDirty(value?: boolean): void;
  render(): void;
}

export interface EditorHistory {
  snapshot(): string;
  mutate(fn: () => void, options?: { render?: boolean }): void;
  restore(text: string): void;
  replaceDocument(text: string, recordHistory?: boolean): void;
  undo(): void;
  redo(): void;
}

const MAX_HISTORY = 80;

export function createEditorHistory(deps: HistoryDeps): EditorHistory {
  const { state, cleanupReleased, clearVariableCardSelection, nodeById, normalizeRaw, setDirty, render } = deps;

  function snapshot(): string {
    return JSON.stringify(state.raw);
  }

  function pushUndo(before: string): void {
    state.undo.push(before);
    if (state.undo.length > MAX_HISTORY) state.undo.shift();
    state.redo = [];
  }

  function mutate(fn: () => void, options: { render?: boolean } = {}): void {
    const before = snapshot();
    fn();
    cleanupReleased(state.raw, JSON.parse(before));
    if (snapshot() === before) return;
    pushUndo(before);
    setDirty();
    if (options.render !== false) render();
  }

  function restore(text: string): void {
    state.raw = JSON.parse(text);
    state.selected.clear();
    state.selectedEdge = null;
    state.selectedRun = null;
    clearVariableCardSelection();
    render();
  }

  function replaceDocument(text: string, recordHistory = false): void {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return; }
    const before = snapshot();
    const next = normalizeRaw(parsed);
    if (JSON.stringify(next) === before) return;
    if (recordHistory) pushUndo(before);
    state.raw = next;
    state.selected = new Set([...state.selected].filter((id) => nodeById(id)));
    if (state.selectedEdge) {
      const parent = nodeById(state.selectedEdge.parent);
      if (!parent || !Array.isArray(parent.children) || !parent.children.includes(state.selectedEdge.child)) state.selectedEdge = null;
    }
    if (state.selectedRun) {
      const node = nodeById(state.selectedRun.nodeId);
      if (!node || !Array.isArray(node.runs) || !node.runs[state.selectedRun.index]) state.selectedRun = null;
    }
    if (state.inspector === 'variables' && !Object.prototype.hasOwnProperty.call(state.raw?.[state.selectedVariableScope] || {}, state.selectedVariable)) {
      state.selectedVariable = '';
    }
    render();
  }

  function undo(): void {
    const value = state.undo.pop();
    if (!value) return;
    state.redo.push(snapshot());
    restore(value);
    setDirty();
  }

  function redo(): void {
    const value = state.redo.pop();
    if (!value) return;
    state.undo.push(snapshot());
    restore(value);
    setDirty();
  }

  return { snapshot, mutate, restore, replaceDocument, undo, redo };
}
