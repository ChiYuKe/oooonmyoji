/**
 * 子节点执行顺序拖拽：在结构树/子节点列表上拖动行调整 children 顺序。
 * 原 `child-order-dnd.js`；以显式安装函数运行，通过桥接发送文档变更。
 * 编辑器句柄经 `getEditor` 惰性取得（安装早于画布启动），不再读 window 全局。
 */

export interface ChildOrderEditor {
  state: {
    raw: Record<string, any> | null;
    selected: Set<string>;
    undo: string[];
    redo: string[];
    dirty: boolean;
  };
  render(): void;
}

export interface ChildOrderDnd {
  dispose(): void;
}

const ROW_SELECTOR = '.child-row';

export function installChildOrderDnd(
  postMessage: (message: unknown) => void,
  getEditor: () => ChildOrderEditor | undefined,
): ChildOrderDnd {
  let draggedChildId = '';

  function clearDropIndicators(): void {
    document.querySelectorAll(`${ROW_SELECTOR}.drop-before, ${ROW_SELECTOR}.drop-after`).forEach((row) => {
      row.classList.remove('drop-before', 'drop-after');
    });
  }

  function postDocumentChanged(editor: ChildOrderEditor): void {
    const state = editor.state;
    state.dirty = true;
    editor.render();
    postMessage({
      type: 'documentStateChanged',
      text: `${JSON.stringify(state.raw, null, 2)}\n`,
      dirty: true,
    });
  }

  function bindRows(): void {
    const editor = getEditor();
    if (!editor || !editor.state?.raw) return;
    const selected = [...editor.state.selected];
    if (selected.length !== 1) return;
    const node = editor.state.raw.nodes?.find((item: any) => item && item.id === selected[0]);
    if (!node || !Array.isArray(node.children)) return;

    document.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach((row, index) => {
      if (row.dataset.childOrderDndBound === 'true') return;
      const childId = node.children![index];
      if (!childId) return;
      row.dataset.childOrderDndBound = 'true';
      row.draggable = true;
      row.dataset.tooltip = row.dataset.tooltip || '拖动以调整执行顺序';

      row.addEventListener('dragstart', (event) => {
        if (event.target instanceof HTMLElement && event.target.closest('button')) {
          event.preventDefault();
          return;
        }
        draggedChildId = childId;
        row.classList.add('dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', childId);
        }
      });

      row.addEventListener('dragover', (event) => {
        if (!draggedChildId || draggedChildId === childId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        clearDropIndicators();
        const before = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
        row.classList.add(before ? 'drop-before' : 'drop-after');
      });

      row.addEventListener('dragleave', (event) => {
        if (!row.contains(event.relatedTarget as Node | null)) row.classList.remove('drop-before', 'drop-after');
      });

      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const sourceId = draggedChildId || event.dataTransfer?.getData('text/plain') || '';
        const sourceIndex = node.children!.indexOf(sourceId);
        const targetIndex = node.children!.indexOf(childId);
        if (!sourceId || sourceIndex < 0 || targetIndex < 0 || sourceId === childId) return;

        const before = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
        const insertionIndex = before ? targetIndex : targetIndex + 1;
        const snapshot = JSON.stringify(editor.state.raw);
        editor.state.undo.push(snapshot);
        if (editor.state.undo.length > 80) editor.state.undo.shift();
        editor.state.redo = [];
        node.children!.splice(sourceIndex, 1);
        node.children!.splice(sourceIndex < insertionIndex ? insertionIndex - 1 : insertionIndex, 0, sourceId);
        draggedChildId = '';
        clearDropIndicators();
        postDocumentChanged(editor);
      });

      row.addEventListener('dragend', () => {
        draggedChildId = '';
        row.classList.remove('dragging');
        clearDropIndicators();
      });
    });
  }

  const observer = new MutationObserver(bindRows);
  observer.observe(document.body, { childList: true, subtree: true });
  bindRows();

  return {
    dispose() {
      observer.disconnect();
    },
  };
}
