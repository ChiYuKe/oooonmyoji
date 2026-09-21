/**
 * 侧边栏状态：把变量列表、节点树与当前选中项推送给宿主窗口。
 * 原 `editor-sidebar-state.js`；主编辑器通过工厂注入依赖，迁移期由 main.ts 以旧全局名挂载。
 */
import type { SidebarNode, SidebarVariable } from '../../shared/editor-messages';

export interface SidebarDefinitionSource {
  display_name?: unknown;
  group?: unknown;
  type?: unknown;
  _autoPublished?: unknown;
  initial_from?: unknown;
  [key: string]: unknown;
}

export interface SidebarNodeSource {
  id: string;
  name?: unknown;
  type?: unknown;
  action?: unknown;
  params?: { workflow?: unknown };
  runs?: unknown[];
  children?: unknown[];
}

export interface SidebarStateSource {
  raw: {
    inputs?: Record<string, SidebarDefinitionSource>;
    variables?: Record<string, SidebarDefinitionSource>;
    root?: unknown;
    [key: string]: unknown;
  } | null;
  selectedVariableScope: 'inputs' | 'variables';
  inspector?: string;
  selectedVariableCardIds?: Set<string>;
  selectedVariableCardId?: string;
  selectedVariable?: string;
  selected: Set<string>;
}

export interface SidebarStateDeps {
  state: SidebarStateSource;
  collectNodeCardVariableRefs(): Set<string>;
  nodes(): SidebarNodeSource[];
  currentInspectorSelection(): unknown;
  /** 变量引用处数：参数引用 + 初始化输入；`collectNodeCardVariableRefs` 之外的画布连线按引用计数计入。 */
  references(scope: 'inputs' | 'variables', name: string): unknown[];
  vscode: { postMessage(message: unknown): void };
}

export interface SidebarStateController {
  postSidebarState(): void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createSidebarState(deps: SidebarStateDeps): SidebarStateController {
  const { state, collectNodeCardVariableRefs, nodes, currentInspectorSelection, vscode, references } = deps;
  let lastSidebarState = '';

  function postSidebarState(): void {
    const inputs = asRecord(state.raw?.inputs);
    const nodeCardVariableRefs = collectNodeCardVariableRefs();
    const workflowInputs: SidebarVariable[] = Object.entries(inputs)
      .filter(([, rawDefinition]) => !asRecord(rawDefinition)._autoPublished)
      .map(([name, rawDefinition]) => {
        const definition = asRecord(rawDefinition);
        return {
          name,
          displayName: typeof definition.display_name === 'string' ? definition.display_name : name,
          group: typeof definition.group === 'string' ? definition.group : '',
          type: typeof definition.type === 'string' ? definition.type : 'any',
          scope: 'inputs',
          public: true,
          onCard: nodeCardVariableRefs.has(`inputs.${name}`),
          refCount: references('inputs', name).length,
        };
      });
    const runtimeVariables = asRecord(state.raw?.variables);
    const variables: SidebarVariable[] = Object.entries(runtimeVariables).map(([name, rawDefinition]) => {
      const definition = asRecord(rawDefinition);
      return {
        name,
        displayName: typeof definition.display_name === 'string' ? definition.display_name : name,
        group: typeof definition.group === 'string' ? definition.group : '',
        type: typeof definition.type === 'string' ? definition.type : 'any',
        scope: 'variables',
        public: Boolean(definition.initial_from),
        onCard: nodeCardVariableRefs.has(`variables.${name}`),
        refCount: references('variables', name).length,
      };
    });
    const selectedDefinitions = state.selectedVariableScope === 'variables' ? runtimeVariables : inputs;
    const canvasVariableCardSelected = state.inspector === 'variables'
      && ((state.selectedVariableCardIds instanceof Set && state.selectedVariableCardIds.size > 0) || Boolean(state.selectedVariableCardId));
    const selectedVariable = state.inspector === 'variables' && !canvasVariableCardSelected
      && Object.prototype.hasOwnProperty.call(selectedDefinitions, state.selectedVariable ?? '')
      ? state.selectedVariable ?? ''
      : '';
    const sidebarNodes: SidebarNode[] = nodes().map((node) => {
      const subRef = node.type === 'task' && node.action === 'workflow.run' && typeof node.params?.workflow === 'string'
        ? String(node.params.workflow).split(/[\\/]/).pop() ?? ''
        : '';
      const meta = node.type === 'task'
        ? (subRef ? `⇢ ${subRef}` : typeof node.action === 'string' ? node.action : 'task')
        : node.type === 'instance_parallel' && Array.isArray(node.runs)
          ? `${node.runs.length} 个实例`
          : String(node.type ?? '');
      return {
        id: node.id,
        name: String(node.name || node.id),
        type: typeof node.type === 'string' ? node.type : 'task',
        meta,
        children: Array.isArray(node.children) ? node.children.filter((child): child is string => typeof child === 'string') : [],
      };
    });
    const selectedNode = state.inspector === 'node' && state.selected.size === 1 ? [...state.selected][0] : '';
    const payload = {
      variables: [...workflowInputs, ...variables],
      selectedVariable,
      selectedVariableScope: state.selectedVariableScope,
      nodes: sidebarNodes,
      root: String(state.raw?.root || ''),
      selectedNode,
      inspectorSelection: currentInspectorSelection(),
    };
    const signature = JSON.stringify(payload);
    if (signature === lastSidebarState) return;
    lastSidebarState = signature;
    vscode.postMessage({ type: 'sidebarStateChanged', ...payload });
  }

  return { postSidebarState };
}
