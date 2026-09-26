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
  /**
   * 上一次真正上报出去的脏标记与正文。
   *
   * 去重是**协议层**的需要，不是优化：画布里存在读路径上的派生补齐（例如节点组的执行引脚名，
   * 见 `model/node-groups.ts`），它会在每次缓存失效时把文档标脏；如果每次标脏都原样上报，
   * 壳层就会把正文回灌 `replaceDocument` 回来，文档版本 +1 又让缓存失效 —— 形成静置状态下
   * 40~180 条/秒的自转环，主线程 90% 以上耗在 postMessage 上，整个应用被压到 ~9 fps。
   */
  let lastPostedText = '';
  let lastPostedDirty: boolean | null = null;

  function setDirty(value: boolean = true): void {
    state.dirty = value;
    $('dirty-badge').classList.toggle('hidden', !value);
    // 状态包只带 dirty 一个字段：值没变就不必再发一条 legacy-editor-state。
    if (lastPostedDirty !== value) {
      lastPostedDirty = value;
      vscode.setState({ dirty: value });
    }
    if (!value || !state.raw) {
      // 落盘/丢弃后清掉去重基准：之后即使改回同一份正文，也要如实再上报一次。
      lastPostedText = '';
      return;
    }
    const text = documentText(state);
    if (text === lastPostedText) return;
    lastPostedText = text;
    vscode.postMessage({
      type: 'documentStateChanged',
      text,
      dirty: true,
    });
  }

  let lastSidebarState = '';

  /**
   * 当前选中项给详情栏镜像用的描述。
   *
   * 注意：**可见的「详细信息」面板是另一份镜像画布**（`canvas.html?mode=details`），
   * 画布自己的 `#inspector` 在 `desktop-canvas-mode` 下是 `display: none`。
   * 所以任何新的选中类型（例如注释框）都必须在这里投影出来，否则面板永远是空的。
   */
  function currentInspectorSelection(): any {
    if (state.inspector === 'workflow') return { kind: 'workflow' };
    if (state.inspector === 'variables') return { kind: 'variables', name: state.selectedVariable || '', scope: state.selectedVariableScope };
    if (state.inspector === 'comment') return { kind: 'comment', commentId: state.selectedCommentId || '' };
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
