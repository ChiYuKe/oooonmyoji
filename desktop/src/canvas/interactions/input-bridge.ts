/**
 * 画布输入桥：变量卡片拖放、快捷键分派与小地图点击导航。
 * 原 `workflow-editor.js` 的 dropGhost 至 minimap 点击区间。
 *
 * 监听器只在 `install()` 时注册，便于测试在不具备 DOM 的环境下直接验证分派函数。
 */
import type { CanvasState } from '../state/canvas-state';
import { isProjectedGroupNode } from '../model/node-groups';

export interface InputBridgeDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  $(id: string): HTMLElement;
  el(tag: string, className?: string, text?: string): any;
  wrap: HTMLElement;
  worldPoint(event: any): { x: number; y: number };
  placeVariableCard(scope: string, name: string, point: { x: number; y: number }): void;
  variableDragMime: string;
  getShortcuts(): any;
  cancelConnection(): void;
  cancelVariableConnection(): void;
  /** 取消「节点输出引用」拖拽（Esc）。 */
  cancelReferenceConnection(): void;
  hideMenus(): void;
  closeAssetBrowser(): void;
  closeTemplateCheck(): void;
  render(): void;
  deleteCurrentSelection(): void;
  copySelection(): void;
  cutSelection(): void;
  pasteClipboard(): void;
  executeEditorCommand(command: string, value?: any): any;
  /** 节点 F2：直接在画布卡片标题上编辑。返回 true 表示已接管。 */
  openNodeNameEditor?(node: any): boolean;
  undo(): void;
  redo(): void;
  fitView(): void;
  nodeById(id: string): any;
  position(node: any): { x: number; y: number };
  nodeHeight(node: any): number;
  nodeWidth: number;
  bounds(): { minX: number; minY: number; maxX: number; maxY: number };
}

export function createInputBridge(deps: InputBridgeDeps) {
  const {
    state, $, el, wrap, worldPoint, placeVariableCard, variableDragMime, getShortcuts,
    cancelConnection, cancelVariableConnection, cancelReferenceConnection, hideMenus, closeAssetBrowser, closeTemplateCheck, render,
    deleteCurrentSelection, copySelection, cutSelection, pasteClipboard, executeEditorCommand, undo, redo,
    fitView, nodeById, position, nodeHeight, nodeWidth: NODE_W, bounds,
  } = deps;

  let dropGhost: HTMLElement | null = null;

  const variableDragAccepted = (event: any): boolean => Boolean(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes(variableDragMime));
  const hideVariableDropGhost = (): void => { if (dropGhost) dropGhost.classList.add('hidden'); };

  /** 读取当前配置的绑定；由桌面壳层通过 StudioShortcuts 共享。 */
  function matchesShortcut(event: any, id: string): boolean {
    const api = getShortcuts();
    if (!api || typeof api.matchesById !== 'function') return false;
    return api.matchesById(event, id);
  }

  function install(): void {
    wrap.addEventListener('dragover', (event: any) => {
      if (!variableDragAccepted(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (!dropGhost) dropGhost = el('div', 'variable-drop-ghost');
      const rect = wrap.getBoundingClientRect();
      dropGhost!.textContent = '＋ 变量卡片';
      dropGhost!.style.left = `${event.clientX - rect.left + 14}px`;
      dropGhost!.style.top = `${event.clientY - rect.top + 12}px`;
      dropGhost!.classList.remove('hidden');
    });
    wrap.addEventListener('dragleave', (event: any) => {
      if (!event.relatedTarget || !wrap.contains(event.relatedTarget)) hideVariableDropGhost();
    });
    wrap.addEventListener('drop', (event: any) => {
      hideVariableDropGhost();
      if (!variableDragAccepted(event)) return;
      event.preventDefault();
      const payload = event.dataTransfer.getData(variableDragMime);
      let name = payload;
      let scope = 'inputs';
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object') {
          name = String(parsed.name || '');
          scope = parsed.scope === 'variables' ? 'variables' : 'inputs';
        }
      } catch { /* Older drag payloads contain only the input name. */ }
      if (!name) return;
      const point = worldPoint(event);
      placeVariableCard(scope, name, point);
    });
    wrap.addEventListener('pointerdown', hideVariableDropGhost);
    window.addEventListener('keydown', (event: any) => {
      const tag = event.target && event.target.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (event.key === 'Escape') { if (state.connect) cancelConnection(); if (state.variableConnect) cancelVariableConnection(); if (state.referenceConnect) cancelReferenceConnection(); state.drag = null; state.marquee = null; hideMenus(); const lightbox = $('lightbox'); if (lightbox) lightbox.classList.add('hidden'); closeAssetBrowser(); closeTemplateCheck(); render(); }
      if (!editing && matchesShortcut(event, 'editor.delete')) {
        event.preventDefault();
        deleteCurrentSelection();
      }
      // F2 重命名：可见的名称输入框在详细信息镜像里，由宿主转过去聚焦。
      if (!editing && matchesShortcut(event, 'editor.rename') && state.selected.size === 1) {
        event.preventDefault();
        const selectedId = String([...state.selected][0] || '');
        const selectedNode = selectedId ? nodeById(selectedId) : null;
        if (selectedNode && deps.openNodeNameEditor?.(selectedNode)) return;
        // 组内接口卡/变量卡都是编辑器投影，F2 应编辑所属组，而不是合成卡自己的标题。
        const nodeId = String(isProjectedGroupNode(selectedNode) ? (selectedNode._nodeGroupId || selectedId) : selectedId);
        executeEditorCommand('requestRenameSelection', { kind: 'node', nodeId });
      }
      if (!editing && matchesShortcut(event, 'editor.copy')) { event.preventDefault(); copySelection(); }
      if (!editing && matchesShortcut(event, 'editor.cut')) { event.preventDefault(); cutSelection(); }
      if (!editing && matchesShortcut(event, 'editor.paste')) { event.preventDefault(); pasteClipboard(); }
      if (!editing && matchesShortcut(event, 'editor.selectAll')) { event.preventDefault(); executeEditorCommand('selectAll'); }
      if (!editing && matchesShortcut(event, 'editor.save')) { event.preventDefault(); $('btn-save')?.click(); }
      if (!editing && matchesShortcut(event, 'editor.undo')) { event.preventDefault(); undo(); }
      if (!editing && matchesShortcut(event, 'editor.redo')) { event.preventDefault(); redo(); }
      if (!editing && matchesShortcut(event, 'editor.fitView')) { event.preventDefault(); fitView(); }
      if (!editing && matchesShortcut(event, 'editor.focusNode') && state.selected.size === 1) {
        const node = nodeById([...state.selected][0]);
        const pos = position(node);
        const rect = wrap.getBoundingClientRect();
        state.panX = rect.width / 2 - (pos.x + NODE_W / 2) * state.zoom;
        state.panY = rect.height / 2 - (pos.y + nodeHeight(node) / 2) * state.zoom;
        render();
      }
    });
    $('minimap').addEventListener('click', (event: any) => {
      const mini = $('minimap');
      const rect = mini.getBoundingClientRect();
      const box = bounds();
      const x = box.minX + (event.clientX - rect.left) / rect.width * (box.maxX - box.minX);
      const y = box.minY + (event.clientY - rect.top) / rect.height * (box.maxY - box.minY);
      const canvas = wrap.getBoundingClientRect();
      state.panX = canvas.width / 2 - x * state.zoom;
      state.panY = canvas.height / 2 - y * state.zoom;
      render();
    });
  }

  return { install, matchesShortcut, variableDragAccepted, hideVariableDropGhost };
}
