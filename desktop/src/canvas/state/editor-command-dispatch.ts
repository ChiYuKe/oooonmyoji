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
  /** 当前投影里的节点解析；节点组等合成卡不在运行时 nodeById 中。 */
  selectionNodeById?(id: string): any;
  undo(): void;
  redo(): void;
  fitView(): void;
  autoLayout(): void;
  /** 自动排列预览：范围 = 全部 / 选中 / 当前组；返回是否真的生成了预览。 */
  previewArrange(scope: 'all' | 'selected' | 'group'): boolean;
  /** 确认排列预览：一次历史记录写入。 */
  confirmArrangePreview(): void;
  /** 取消排列预览：丢弃虚影，不写文档。 */
  cancelArrangePreview(): void;
  /** 锁定/解锁节点位置（缺省用当前单选节点）。 */
  toggleNodeLock(id?: string): void;
  viewportBack(): boolean;
  viewportForward(): boolean;
  /** 按状态/类型临时隐藏的单项开关。 */
  toggleNodeFilter(kind: 'status' | 'type', value: string): void;
  clearNodeFilter(): void;
  /** 保存：先做「只拦真正跑不起来的错误」的把关。 */
  requestSave(): void;
  /** 用户在确认框里坚持保存（带错误写盘）。 */
  forceSave(): void;
  /** 上一个 / 下一个问题（校验错误与提醒一起走）。 */
  gotoIssue(step: 1 | -1): boolean;
  /** 折叠组内部问题汇总（点组卡徽标进入并定位用）。 */
  groupIssueSummary(groupId: string): { errors: number; warnings: number; first: string };
  /** 连线上的问题（连线涂红 + 悬停说明）。 */
  edgeIssues(parentId: string, childId: string): any[];
  /** 布局体检与修复：只重建布局（可撤销）。 */
  repairLayout(record?: boolean): boolean;
  copySelection(): void;
  cutSelection(): void;
  pasteClipboard(): void;
  deleteSelection(): void;
  addNode(...args: any[]): void;
  render(): void;
  focusNode(id: string, param?: string): void;
  searchNodeByName(...args: any[]): void;
  exportFullCanvasImage(...args: any[]): void;
  addVariable(scope?: string): void;
  /** 「变量引用」面板确认后的强制删除：引用一并清掉。 */
  deleteVariable(scope: string, name: string): void;
  /** 计算并把变量引用清单交给宿主面板。 */
  showVariableReferences(scope: string, name: string): void;
  /** 断开面板里的单条引用（参数回落，初始化解除）；走一次历史记录。 */
  disconnectVariableReference(entry: unknown): void;
  /** 批量断开全部引用；合并为一次历史记录。 */
  disconnectAllVariableReferences(scope: string, name: string): void;
  clearVariableCardSelection(): void;
  deleteCurrentSelection(): void;
  renderInspector(): void;
  /** F2 在文档画布里按下时：请宿主把聚焦请求转给详细信息镜像。 */
  requestInspectorRename(selection?: unknown): void;
  /** 左侧变量列表的行内改名：与详情栏改「变量命名」同一条路径（含公开镜像同步）。 */
  renameVariable(scope: string, oldName: string, name: string): void;
  /** 改名影响范围确认后：按暂存的名字真正执行改名。 */
  confirmPendingRename(): void;
  /** 改名影响范围被取消：丢弃暂存请求。 */
  cancelPendingRename(): void;
  addVariableCardCommand(value: any): void;
  VariableSystem: any;
  convertInputToVariable(name: string): void;
}

export function createEditorCommandDispatch(deps: EditorCommandDispatchDeps) {
  const {
    state, mutate, nodes, nodeById, undo, redo, fitView, autoLayout, copySelection, cutSelection,
    pasteClipboard, deleteSelection, addNode, render, focusNode, searchNodeByName, exportFullCanvasImage,
    addVariable, clearVariableCardSelection, deleteCurrentSelection, renderInspector, addVariableCardCommand,
    deleteVariable, showVariableReferences, requestInspectorRename, renameVariable,
    disconnectVariableReference, disconnectAllVariableReferences, confirmPendingRename, cancelPendingRename,
    previewArrange, confirmArrangePreview, cancelArrangePreview, toggleNodeLock, viewportBack, viewportForward,
    toggleNodeFilter, clearNodeFilter,
    requestSave, forceSave, gotoIssue, repairLayout,    VariableSystem,
  } = deps;
  const selectionNodeById = deps.selectionNodeById ?? nodeById;
  function executeEditorCommand(command: string, value?: any): any {
    if (command === 'undo') undo();
    else if (command === 'redo') redo();
    else if (command === 'cut') cutSelection();
    else if (command === 'copy') copySelection();
    else if (command === 'paste') pasteClipboard();
    else if (command === 'deleteSelection') deleteCurrentSelection();
    else if (command === 'requestRenameSelection') {
      // 文档画布里的 F2：可见的详情栏是独立的镜像画布，把聚焦请求转给宿主。
      requestInspectorRename(value);
    }
    else if (command === 'renameNodeName') {
      // 左侧结构树的行内改名：改的是显示名（节点 id 保持稳定，连线与参数引用都按 id 走）。
      const nodeId = String(value?.nodeId ?? '');
      const name = String(value?.name ?? '').trim();
      const node = nodeId ? nodeById(nodeId) : undefined;
      if (!node) return;
      mutate(() => { if (name) node.name = name; else delete node.name; });
    }
    else if (command === 'renameVariable') {
      // 左侧变量列表的行内改名：走详情栏同一个实现，公开镜像输入一起同步。
      const scope = value?.scope === 'inputs' ? 'inputs' : 'variables';
      const oldName = String(value?.oldName ?? '');
      const name = String(value?.name ?? '').trim();
      if (oldName && name) renameVariable(scope, oldName, name);
    }
    else if (command === 'confirmRenameVariable') confirmPendingRename();
    else if (command === 'cancelRenameVariable') cancelPendingRename();
    else if (command === 'renameSelection') {
      // 详情栏镜像里的 F2：聚焦它自己那份可见的名称输入框。
      if (state.inspector === 'variables' && state.selectedVariable) {
        renderInspector();
        const variableInput = document.getElementById('inspector-variable-name') as HTMLInputElement | null;
        variableInput?.focus();
        variableInput?.select();
        return;
      }
      const selected = [...state.selected];
      if (selected.length !== 1) return;
      const node = selectionNodeById(selected[0]);
      if (!node) return;
      state.selectedEdge = null;
      state.selectedRun = null;
      state.inspector = 'node';
      renderInspector();
      const nameInput = document.getElementById('inspector-node-name') as HTMLInputElement | null;
      nameInput?.focus();
      nameInput?.select();
    }
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
    else if (command === 'previewArrange') {
      // 自动排列先出预览：范围由载荷给出（全部 / 选中 / 当前组）。
      const scope = value === 'selected' || value === 'group' ? value : 'all';
      previewArrange(scope);
    }
    else if (command === 'confirmArrangePreview') confirmArrangePreview();
    else if (command === 'cancelArrangePreview') cancelArrangePreview();
    else if (command === 'toggleNodeLock') toggleNodeLock(value?.nodeId ?? value);
    else if (command === 'viewportBack') viewportBack();
    else if (command === 'viewportForward') viewportForward();
    else if (command === 'toggleNodeFilter') {
      const kind = value?.kind === 'type' ? 'type' : 'status';
      const item = String(value?.value ?? '');
      if (item) toggleNodeFilter(kind, item);
    }
    else if (command === 'clearNodeFilter') clearNodeFilter();
    else if (command === 'save') requestSave();
    else if (command === 'forceSave') forceSave();
    else if (command === 'nextIssue') gotoIssue(1);
    else if (command === 'previousIssue') gotoIssue(-1);
    else if (command === 'repairLayout') repairLayout(true);
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
    else if (command === 'showVariableReferences') {
      const scope = value?.scope === 'inputs' ? 'inputs' : 'variables';
      const name = String(value?.name ?? '');
      if (name) showVariableReferences(scope, name);
    }
    else if (command === 'disconnectVariableReference') {
      // 「变量引用」面板里的单条断开：参数回落到字面量 / 初始化解除，一次历史记录。
      disconnectVariableReference(value?.entry);
    }
    else if (command === 'disconnectAllVariableReferences') {
      const scope = value?.scope === 'inputs' ? 'inputs' : 'variables';
      const name = String(value?.name ?? '');
      if (name) disconnectAllVariableReferences(scope, name);
    }
    else if (command === 'addVariableCard') addVariableCardCommand(value);
    else if (command === 'searchNodeByName') searchNodeByName(value);
    else if (command === 'focusNode') {
      // 兼容两种载荷：面板定位带 `{nodeId, param}`，搜索/结构树定位传裸 id。
      const id = String(value && typeof value === 'object' ? value.nodeId ?? '' : value ?? '');
      const param = String(value && typeof value === 'object' ? value.param ?? '' : '');
      const node = nodeById(id);
      if (!node) return;
      state.selected = new Set([id]);
      state.selectedEdge = null;
      state.selectedRun = null;
      state.inspector = 'node';
      focusNode(id, param);
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
        if (selectionNodeById(id)) state.selected.add(id);
      } else state.inspector = 'node';
      render();
    }
  }

  return { executeEditorCommand };
}
