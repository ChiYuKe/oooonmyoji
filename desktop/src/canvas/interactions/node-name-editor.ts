import type { CanvasState } from '../state/canvas-state';
import { worldRectToScreen } from '../render/param-rows';
import { isGroupVariablesNode, isProjectedGroupNode } from '../model/node-groups';

export interface NodeNameEditorDeps {
  state: CanvasState;
  wrap: HTMLElement;
  el(tag: string, className?: string, text?: string): HTMLElement;
  position(node: any): { x: number; y: number };
  renameGroup(groupId: string, name: string): boolean;
  renameNode(nodeId: string, name: string): boolean;
  /**
   * 值卡片的类型派生标题（`Break 识别结果` / `等于`）：输入框留空时的占位提示。
   * 清空输入框提交 = 删掉手动设的 `name`，标题回到派生结果。
   */
  derivedTitle?(node: any): string;
  nodeWidth: number;
}

export interface CanvasNodeNameEditor {
  open(node: any): boolean;
  close(): void;
  refresh(): void;
  isOpen(): boolean;
}

interface ActiveNameEditor {
  node: any;
  targetId: string;
  group: boolean;
  initial: string;
  shell: HTMLElement;
  input: HTMLInputElement;
  closed: boolean;
}

/**
 * F2 节点标题编辑器：HTML 输入框覆盖 SVG 标题。
 * 只写显示名 `name`（稳定节点 ID 不动），输入框里放的就是手动设过的名字；
 * 没设过的值卡片留空，占位提示给出类型派生标题（`Break 识别结果` / `等于`）。
 */
export function createNodeNameEditor(deps: NodeNameEditorDeps): CanvasNodeNameEditor {
  const { state, wrap, el, position, renameGroup, renameNode, nodeWidth } = deps;
  let active: ActiveNameEditor | null = null;

  function detach(editor: ActiveNameEditor): void {
    if (editor.closed) return;
    editor.closed = true;
    editor.shell.remove();
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    window.removeEventListener('blur', onWindowBlur);
    if (active === editor) active = null;
  }

  function close(): void {
    if (active) detach(active);
  }

  function commit(editor: ActiveNameEditor): void {
    if (editor.closed) return;
    const name = editor.input.value.trim();
    detach(editor);
    if (name === editor.initial) return;
    if (editor.group) {
      if (name) renameGroup(editor.targetId, name);
    } else renameNode(editor.targetId, name);
  }

  function positionEditor(editor: ActiveNameEditor): void {
    const pos = position(editor.node);
    const titleWidth = isGroupVariablesNode(editor.node) ? nodeWidth - 80 : nodeWidth - 53;
    const wrapRect = wrap.getBoundingClientRect();
    const screen = worldRectToScreen({
      x: pos.x + 36,
      y: pos.y + 4,
      width: titleWidth,
      height: 25,
    }, {
      left: wrapRect.left,
      top: wrapRect.top,
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
    });
    editor.shell.style.left = `${Math.round(screen.left)}px`;
    editor.shell.style.top = `${Math.round(screen.top)}px`;
    editor.shell.style.width = `${Math.round(screen.width)}px`;
    editor.shell.style.height = `${Math.round(screen.height)}px`;
  }

  function refresh(): void {
    if (active) positionEditor(active);
  }

  function isOpen(): boolean {
    return Boolean(active);
  }

  function onDocumentPointerDown(event: Event): void {
    const editor = active;
    if (!editor) return;
    const target = event.target as Node | null;
    if (target && editor.shell.contains(target)) return;
    commit(editor);
  }

  function onWindowBlur(): void {
    close();
  }

  function open(node: any): boolean {
    const group = isProjectedGroupNode(node);
    const targetId = String(group ? (node?._nodeGroupId || node?.id || '') : (node?.id || ''));
    if (!targetId) return false;
    close();

    const shell = el('div', 'inline-node-name-editor');
    const input = document.createElement('input');
    // 标题编辑器贴在卡片表头上，不能复用全局 ui-input（它会带入面板表单的亮边框与背景）。
    input.className = 'inline-node-name-input';
    input.type = 'text';
    input.value = group
      ? String(node.name || '').replace(/\s+(?:接口|变量)$/, '')
      : String(node.name || '');
    if (!group) {
      // 值卡片没设过名字时，占位提示就是卡片现在显示的派生标题（清空=回到它）。
      input.placeholder = String(deps.derivedTitle?.(node) || node.id || '');
    }
    input.spellcheck = false;
    input.setAttribute('aria-label', '节点组名称');
    shell.appendChild(input);
    const editor: ActiveNameEditor = { node, targetId, group, initial: input.value.trim(), shell, input, closed: false };
    document.body.appendChild(shell);
    active = editor;
    positionEditor(editor);

    input.addEventListener('keydown', (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        commit(editor);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        detach(editor);
      }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!editor.closed && !shell.contains(document.activeElement)) commit(editor);
      }, 0);
    });
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    window.addEventListener('blur', onWindowBlur);
    input.focus();
    input.select();
    return true;
  }

  return { open, close, refresh, isOpen };
}
