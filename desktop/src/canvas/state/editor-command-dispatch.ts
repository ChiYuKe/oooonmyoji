/**
 * 编辑器命令分派：复制/粘贴/删除/布局/搜索/导出等 UI 命令的入口。
 * 原 `workflow-editor.js` 的 executeEditorCommand 函数。
 *
 * 命令只调用已迁移模块的能力，不直接操作 DOM 之外的状态。
 */
import type { CanvasState } from '../state/canvas-state';

export interface EditorCommandDispatchDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  mutate(fn: () => void): void;
  nodes(): any[];
  nodeById(id: string): any;
  undo(): void;
  redo(): void;
  fitView(): void;
  autoLayout(): void;
  copySelection(): void;
  cutSelection(): void;
  pasteClipboard(): void;
  deleteSelection(): void;
  addNode(...args: any[]): void;
  render(): void;
  focusNode(id: string): void;
  searchNodeByName(...args: any[]): void;
  exportFullCanvasImage(...args: any[]): void;
  addVariable(scope?: string): void;
  /** 「变量引用」面板确认后的强制删除：引用一并清掉。 */
  deleteVariable(scope: string, name: string): void;
  clearVariableCardSelection(): void;
  deleteCurrentSelection(): void;
  renderInspector(): void;
  addVariableCardCommand(value: any): void;
  VariableSystem: any;
  convertInputToVariable(name: string): void;
}

export function createEditorCommandDispatch(deps: EditorCommandDispatchDeps) {
  const {
    state, mutate, nodes, nodeById, undo, redo, fitView, autoLayout, copySelection, cutSelection,
    pasteClipboard, deleteSelection, addNode, render, focusNode, searchNodeByName, exportFullCanvasImage,
    addVariable, clearVariableCardSelection, deleteCurrentSelection, renderInspector, addVariableCardCommand,
    deleteVariable,
    VariableSystem,
  } = deps;
  function executeEditorCommand(command: string, value?: any): any {
    if (command === 'undo') undo();
    else if (command === 'redo') redo();
    else if (command === 'cut') cutSelection();
    else if (command === 'copy') copySelection();
    else if (command === 'paste') pasteClipboard();
    else if (command === 'deleteSelection') deleteCurrentSelection();
    else if (command === 'selectAll') {
      state.selected = new Set(nodes().map((node) => node.id));
      state.selectedEdge = null; state.selectedRun = null; state.selectedVariable = ''; clearVariableCardSelection(); state.inspector = 'node'; render();
    }
    else if (command === 'clearSelection') {
      state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; state.selectedVariable = ''; clearVariableCardSelection(); render();
    }
    else if (command === 'addTask') addNode('task');
    else if (command === 'addSelector') addNode('selector');
    else if (command === 'addSequence') addNode('sequence');
    else if (command === 'addParallel') addNode('simple_parallel');
    else if (command === 'addGenericParallel') addNode('parallel');
    else if (command === 'addRepeatUntil') addNode('repeat_until');
    else if (command === 'addBranch') addNode('branch');
    else if (command === 'addSwitch') addNode('switch');
    else if (command === 'addInstanceParallel') addNode('instance_parallel');
    else if (command === 'autoLayout') { autoLayout(); fitView(); }
    else if (command === 'fitView') fitView();
    else if (command === 'exportImage') exportFullCanvasImage();
    else if (command === 'workflowSettings') { state.inspector = 'workflow'; state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; renderInspector(); }
    else if (command === 'variables') {
      const scope = state.raw.inputs && Object.keys(state.raw.inputs).length ? 'inputs' : 'variables';
      state.selectedVariableScope = scope;
      clearVariableCardSelection();
      if (!state.raw[scope][state.selectedVariable]) state.selectedVariable = Object.keys(state.raw[scope])[0] || '';
      state.inspector = 'variables'; state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; render();
    }
    else if (command === 'selectVariable') {
      const scope = value && value.scope === 'variables' ? 'variables' : 'inputs';
      const name = String(value && value.name !== undefined ? value.name : value ?? '');
      if (!state.raw[scope] || !Object.prototype.hasOwnProperty.call(state.raw[scope], name)) return;
      state.selectedVariable = name;
      state.selectedVariableScope = scope;
      clearVariableCardSelection();
      state.inspector = 'variables'; state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; render();
    }
    else if (command === 'setVariablePublic') {
      const name = String(value && value.name !== undefined ? value.name : value ?? '');
      if (value?.scope === 'inputs') {
        if (value.public) return;
        const input = state.raw.inputs?.[name];
        if (!input) return;
        if (input._autoPublished === true) {
          mutate(() => {
            for (const item of Object.values<any>(state.raw.variables || {})) {
              if (item?.initial_from === name) delete item.initial_from;
            }
            delete state.raw.inputs[name];
          });
        } else deps.convertInputToVariable(name);
        return;
      }
      const definition = state.raw.variables && Object.prototype.hasOwnProperty.call(state.raw.variables, name)
        ? state.raw.variables[name]
        : null;
      if (!definition || typeof definition !== 'object') return;
      mutate(() => {
        if (value && value.public) VariableSystem.expose(state.raw, name);
        else delete definition.initial_from;
      });
    }
    else if (command === 'addVariable') addVariable('variables');
    else if (command === 'variablesChanged') {
      // 文档被别处改过（例如「变量引用」面板里删了变量）：重新渲染变量详情。
      renderInspector();
    }
    else if (command === 'deleteVariable') {
      // 「变量引用」面板确认后的强制删除：引用一并清掉，参数回落到动作默认值。
      const scope = value && value.scope === 'inputs' ? 'inputs' : 'variables';
      const name = String(value && value.name !== undefined ? value.name : '');
      if (name) deleteVariable(scope, name);
    }
    else if (command === 'addVariableCard') addVariableCardCommand(value);
    else if (command === 'searchNodeByName') searchNodeByName(value);
    else if (command === 'focusNode') {
      const id = String(value ?? '');
      const node = nodeById(id);
      if (!node) return;
      state.selected = new Set([id]);
      state.selectedEdge = null;
      state.selectedRun = null;
      state.inspector = 'node';
      focusNode(id);
    }
    else if (command === 'setInspectorSelection') {
      const selection = value && typeof value === 'object' ? value : { kind: 'none' };
      state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = null;
      state.selectedVariable = '';
      clearVariableCardSelection();
      if (selection.kind === 'workflow') state.inspector = 'workflow';
      else if (selection.kind === 'variables') {
        state.inspector = 'variables';
        state.selectedVariable = String(selection.name || '');
        state.selectedVariableScope = selection.scope === 'variables' ? 'variables' : 'inputs';
      } else if (selection.kind === 'run') {
        state.inspector = 'node';
        state.selectedRun = { nodeId: String(selection.nodeId || ''), index: Number(selection.index || 0) };
      } else if (selection.kind === 'edge') {
        state.inspector = 'node';
        state.selectedEdge = { parent: String(selection.parent || ''), child: String(selection.child || '') };
      } else if (selection.kind === 'node') {
        state.inspector = 'node';
        const id = String(selection.nodeId || '');
        if (nodeById(id)) state.selected.add(id);
      } else state.inspector = 'node';
      render();
    }
  }

  return { executeEditorCommand };
}