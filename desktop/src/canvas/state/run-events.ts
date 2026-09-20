/**
 * 运行事件与选择删除：运行状态写回、旧文档规范化、按选中项删除。
 * 原 `workflow-editor.js` 的 handleRunEvent 至 deleteCurrentSelection 区间。
 *
 * 运行事件只更新状态与卡片；删除通过命令入口提交历史。
 */
import type { CanvasState } from '../state/canvas-state';

export interface RunEventsDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  nodes(): any[];
  nodeById(id: string): any;
  clone<T>(value: T): T;
  render(flags?: { selection?: boolean; panels?: boolean }): void;
  /** 只改运行态连线 class，不重建整层；省略 id 表示运行开始时清空全部旧状态。 */
  patchRunEdgeStates?(nodeId?: string): number;
  deleteSelection(): void;
  removeVariableCards(ids: any): void;
  removeVariableCard(id: string): void;
  removeInstanceRun(node: any, index: number): void;
  removeVariable(scope: string, name: string): void;
}

export function createRunEvents(deps: RunEventsDeps) {
  const { state, nodes, nodeById, clone, render, patchRunEdgeStates, deleteSelection, removeVariableCards, removeVariableCard, removeInstanceRun, removeVariable } = deps;

  /**
   * 循环再次经过同一段结构时，后续节点还带着上一轮的 succeeded/failed。
   * 当前节点一进入 running，就把它内部与各级“后续兄弟”整棵子树的旧状态清掉；
   * 当前节点之前的兄弟属于本轮已经走过的路径，继续保留。
   */
  function clearPendingRunStates(stepId: string): boolean {
    const all = nodes();
    const parentByChild = new Map<string, any>();
    for (const node of all) {
      for (const childId of Array.isArray(node?.children) ? node.children : []) {
        if (!parentByChild.has(String(childId))) parentByChild.set(String(childId), node);
      }
    }
    const pending = new Set<string>();
    const addTree = (id: string): void => {
      if (!id || pending.has(id)) return;
      pending.add(id);
      const node = nodeById(id);
      for (const childId of Array.isArray(node?.children) ? node.children : []) addTree(String(childId));
    };

    const current = nodeById(stepId);
    for (const childId of Array.isArray(current?.children) ? current.children : []) addTree(String(childId));

    const visited = new Set<string>();
    let cursor = stepId;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const parent = parentByChild.get(cursor);
      if (!parent) break;
      const siblings = Array.isArray(parent.children) ? parent.children.map(String) : [];
      const index = siblings.indexOf(cursor);
      if (index >= 0) for (const siblingId of siblings.slice(index + 1)) addTree(siblingId);
      cursor = String(parent.id || '');
    }

    let changed = false;
    for (const id of pending) changed = state.run.delete(id) || changed;
    return changed;
  }

  function handleRunEvent(event: any): void {
    if (!event || typeof event !== 'object') return;
    let resetRunEdges = false;
    let patchAllRunEdges = false;
    let changedNodeId = '';
    if (event.type === 'run_started') {
      state.variableSnapshots ||= {}; delete state.variableSnapshots[event.instance_id || 'default'];
      if(!event.instance_id || !state.instanceId || event.instance_id===state.instanceId){state.run.clear(); state.variableValues = null; resetRunEdges = true;}
    }
    if (event.type === 'step' && event.step_id) {
      const step = event.step || {};
      const workflowId = typeof step.workflow_id === 'string' ? step.workflow_id : '';
      if (workflowId && state.raw && workflowId !== state.raw.id) return;
      if(step.variable_values){state.variableSnapshots ||= {};state.variableSnapshots[event.instance_id || 'default']=clone(step.variable_values);}
      if(event.instance_id && state.instanceId && event.instance_id!==state.instanceId)return;
      if (step.variable_values) state.variableValues = clone(step.variable_values);
      let status = String(step.status || '');
      if (status === 'succeeded' && step.action === 'vision.match_template') status = 'matched';
      if (status === 'failed' && step.error_category === 'not_matched') status = 'not_matched';
      if (status === 'running') patchAllRunEdges = clearPendingRunStates(String(event.step_id));
      state.run.set(String(event.step_id), {
        status,
        engineStatus: step.status,
        duration: step.duration_ms,
        error: step.error,
        errorCategory: step.error_category,
        thumbnail: event.thumbnail,
        screenshot: event.screenshot,
      });
      changedNodeId = String(event.step_id);
    }
    if (resetRunEdges || patchAllRunEdges) patchRunEdgeStates?.();
    else if (changedNodeId) patchRunEdgeStates?.(changedNodeId);
    render({ selection: true, panels: true });
  }

  /**
   * 删除当前选区：实例运行项 → 变量 → 连线/节点。
   * 画布 Delete 键、详情面板 Delete 键与标题栏“删除所选”命令都走这一入口，保证行为一致。
   */
  function deleteCurrentSelection(): void {
    if (state.selectedRun) {
      const selection = state.selectedRun;
      const node = nodeById(selection.nodeId);
      if (node && Array.isArray(node.runs) && node.runs[selection.index]) removeInstanceRun(node, selection.index);
      else { state.selectedRun = null; render(); }
      return;
    }
    if (state.inspector === 'variables' && state.selectedVariableCardIds instanceof Set && state.selectedVariableCardIds.size) {
      removeVariableCards([...state.selectedVariableCardIds]);
      return;
    }
    if (state.inspector === 'variables' && state.selectedVariableCardId) {
      removeVariableCard(state.selectedVariableCardId);
      return;
    }
    if (state.inspector === 'variables' && state.selectedVariable) {
      removeVariable(state.selectedVariableScope === 'variables' ? 'variables' : 'inputs', state.selectedVariable);
      return;
    }
    deleteSelection();
  }

  return { handleRunEvent, deleteCurrentSelection };
}
