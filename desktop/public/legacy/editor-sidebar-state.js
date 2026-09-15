/*
 * 侧边栏状态：把变量列表、节点树与当前选中项推送给宿主窗口。
 * 主文件通过 window.StudioEditorSidebarState({ ... }) 注入依赖。
 * 注意：postSidebarState 保持 2 空格缩进，sidebar-variable-list.test.cjs 会按函数名切片执行。
 */
(() => {
  'use strict';

  window.StudioEditorSidebarState = function StudioEditorSidebarState(deps) {
  const { state, collectNodeCardVariableRefs, nodes, currentInspectorSelection, vscode } = deps;

  let lastSidebarState = '';

  function postSidebarState() {
    const inputs = state.raw && state.raw.inputs && typeof state.raw.inputs === 'object' && !Array.isArray(state.raw.inputs)
      ? state.raw.inputs
      : {};
    const nodeCardVariableRefs = collectNodeCardVariableRefs();
    const workflowInputs = Object.entries(inputs)
      .filter(([name, rawDefinition]) => !(rawDefinition && rawDefinition._autoPublished))
      .map(([name, rawDefinition]) => {
        const definition = rawDefinition && typeof rawDefinition === 'object' && !Array.isArray(rawDefinition) ? rawDefinition : {};
        return { name, displayName: definition.display_name || name, group: definition.group || '', type: definition.type || 'any', scope: 'inputs', public: true, onCard: nodeCardVariableRefs.has(`inputs.${name}`) };
      });
    const runtimeVariables = state.raw && state.raw.variables && typeof state.raw.variables === 'object' && !Array.isArray(state.raw.variables)
      ? state.raw.variables
      : {};
    const variables = Object.entries(runtimeVariables)
      .map(([name, rawDefinition]) => {
        const definition = rawDefinition && typeof rawDefinition === 'object' && !Array.isArray(rawDefinition) ? rawDefinition : {};
        return { name, displayName: definition.display_name || name, group: definition.group || '', type: definition.type || 'any', scope: 'variables', public: !!definition.initial_from, onCard: nodeCardVariableRefs.has(`variables.${name}`) };
      });
    const selectedDefinitions = state.selectedVariableScope === 'variables' ? runtimeVariables : inputs;
    const canvasVariableCardSelected = state.inspector === 'variables'
      && ((state.selectedVariableCardIds instanceof Set && state.selectedVariableCardIds.size > 0) || state.selectedVariableCardId);
    const selectedVariable = state.inspector === 'variables' && !canvasVariableCardSelected
      && Object.prototype.hasOwnProperty.call(selectedDefinitions, state.selectedVariable)
      ? state.selectedVariable
      : '';
    const sidebarNodes = nodes().map((node) => {
      const subRef = node.type === 'task' && node.action === 'workflow.run' && typeof node.params?.workflow === 'string'
        ? String(node.params.workflow).split(/[\\/]/).pop()
        : '';
      const meta = node.type === 'task'
        ? (subRef ? `⇢ ${subRef}` : node.action || 'task')
        : node.type === 'instance_parallel' && Array.isArray(node.runs)
          ? `${node.runs.length} 个实例`
          : node.type;
      return {
        id: node.id,
        name: String(node.name || node.id),
        type: node.type || 'task',
        meta,
        children: Array.isArray(node.children) ? node.children.slice() : [],
      };
    });
    const selectedNode = state.inspector === 'node' && state.selected.size === 1 ? [...state.selected][0] : '';
    const payload = {
      variables: [...workflowInputs, ...variables],
      selectedVariable,
      selectedVariableScope: state.selectedVariableScope,
      nodes: sidebarNodes,
      root: String(state.raw.root || ''),
      selectedNode,
      inspectorSelection: currentInspectorSelection(),
    };
    const signature = JSON.stringify(payload);
    if (signature === lastSidebarState) return;
    lastSidebarState = signature;
    vscode.postMessage({ type: 'sidebarStateChanged', ...payload });
  }

  return { postSidebarState };
  };
})();
