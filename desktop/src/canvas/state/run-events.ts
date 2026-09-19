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
  render(): void;
  deleteSelection(): void;
  removeVariableCards(ids: any): void;
  removeVariableCard(id: string): void;
  removeInstanceRun(node: any, index: number): void;
  removeVariable(scope: string, name: string): void;
}

export function createRunEvents(deps: RunEventsDeps) {
  const { state, nodes, nodeById, clone, render, deleteSelection, removeVariableCards, removeVariableCard, removeInstanceRun, removeVariable } = deps;
  function handleRunEvent(event: any): void {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'run_started') {
      state.variableSnapshots ||= {}; delete state.variableSnapshots[event.instance_id || 'default'];
      if(!event.instance_id || !state.instanceId || event.instance_id===state.instanceId){state.run.clear(); state.variableValues = null;}
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
      state.run.set(String(event.step_id), {
        status,
        engineStatus: step.status,
        duration: step.duration_ms,
        error: step.error,
        errorCategory: step.error_category,
        thumbnail: event.thumbnail,
        screenshot: event.screenshot,
      });
    }
    render();
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