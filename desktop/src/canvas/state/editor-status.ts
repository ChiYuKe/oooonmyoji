/**
 * 编辑器状态与详情请求：脏标记广播、当前选中项描述、打开详情面板请求。
 * 原 `workflow-editor.js` 的 setDirty 至 requestInspector 区间。
 */
import type { CanvasState } from '../state/canvas-state';
import { documentText } from './document-text';

export interface EditorStatusDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  vscode: any;
  $(id: string): HTMLElement;
}

export function createEditorStatus(deps: EditorStatusDeps) {
  const { state, vscode, $ } = deps;
  function setDirty(value: boolean = true): void {
    state.dirty = value;
    $('dirty-badge').classList.toggle('hidden', !value);
    vscode.setState({ dirty: value });
    if (value && state.raw) {
      vscode.postMessage({
        type: 'documentStateChanged',
        text: documentText(state),
        dirty: true,
      });
    }
  }

  let lastSidebarState = '';

  function currentInspectorSelection(): any {
    if (state.inspector === 'workflow') return { kind: 'workflow' };
    if (state.inspector === 'variables') return { kind: 'variables', name: state.selectedVariable || '', scope: state.selectedVariableScope };
    if (state.selectedRun) return { kind: 'run', nodeId: state.selectedRun.nodeId, index: state.selectedRun.index };
    if (state.selectedEdge) return { kind: 'edge', parent: state.selectedEdge.parent, child: state.selectedEdge.child };
    if (state.selected.size === 1) return { kind: 'node', nodeId: [...state.selected][0] };
    return { kind: 'none' };
  }

  function requestInspector(selection: any = currentInspectorSelection()): void {
    vscode.postMessage({ type: 'inspectorRequested', inspectorSelection: selection });
  }

  /**
   * F2 重命名：详情栏是独立的镜像画布，可见的输入框在它那边；
   * 文档画布只负责把「聚焦名称输入框」的请求转给宿主。
   */
  function requestInspectorRename(selection: any = currentInspectorSelection()): void {
    vscode.postMessage({ type: 'inspectorRenameRequested', inspectorSelection: selection });
  }

  return { setDirty, currentInspectorSelection, requestInspector, requestInspectorRename };
}
