/**
 * 画布工作流模型：文档数据访问、节点关系与编辑器私有元数据（原 workflow-editor.js 的模型层）。
 *
 * 边界类型暂时保持宽松，待命令/历史等模块收紧后统一定义 WorkflowDocument 类型。
 */

export interface CanvasModelState {
  raw: Record<string, any> | null;
  [key: string]: any;
}

export interface WorkflowModel {
  nodes(): any[];
  nodeById(id: string): any;
  layout(): Record<string, any>;
  position(node: { id: string }): { x: number; y: number };
  variableCards(): Record<string, any>;
  variableLinks(): Record<string, any>;
  nextVariableCardId(): string;
  variableCardList(): Array<{ id: string; name: string; scope: 'inputs' | 'variables'; x: number; y: number }>;
  clearVariableCardSelection(): void;
  setVariableCardSelection(ids: unknown): void;
  inputParameterMetadata(): Record<string, any>;
  displayNameOfDefinition(definition: unknown, fallback?: string): string;
  variableDisplayNameOf(scope: 'inputs' | 'variables', name: string, fallback?: string): string;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createWorkflowModel(state: CanvasModelState): WorkflowModel {
  const nodes = (): any[] => {
    const raw = state.raw;
    return Array.isArray(raw && raw.nodes) ? raw!.nodes as any[] : [];
  };
  const nodeById = (id: string): any => nodes().find((node) => node && node.id === id) || null;

  const layout = (): Record<string, any> => {
    const raw = state.raw;
    if (!raw) return {};
    if (!isRecord(raw._layout)) raw._layout = {};
    return raw._layout;
  };

  const position = (node: { id: string }): { x: number; y: number } => {
    const value = layout()[node.id];
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : { x: 0, y: 0 };
  };

  /** 变量卡片位置表，随文档保存（schema 允许 `_` 前缀的编辑器私有键）。 */
  function variableCards(): Record<string, any> {
    const raw = state.raw;
    if (!raw || typeof raw !== 'object') return {};
    if (!isRecord(raw._variableCards)) raw._variableCards = {};
    return raw._variableCards;
  }

  function variableLinks(): Record<string, any> {
    const raw = state.raw;
    if (!raw || typeof raw !== 'object') return {};
    if (!isRecord(raw._variableLinks)) raw._variableLinks = {};
    return raw._variableLinks;
  }

  function nextVariableCardId(): string {
    const cards = variableCards();
    let index = 1;
    while (Object.prototype.hasOwnProperty.call(cards, `card_${index}`)) index += 1;
    return `card_${index}`;
  }

  function variableCardList(): Array<{ id: string; name: string; scope: 'inputs' | 'variables'; x: number; y: number }> {
    const raw = state.raw;
    if (!raw) return [];
    return Object.entries(variableCards())
      .map(([id, value]) => ({
        id,
        name: value && typeof value.name === 'string' && value.name ? value.name : id,
        scope: value && value.scope === 'variables' ? 'variables' as const : 'inputs' as const,
        x: value && Number.isFinite(value.x) ? value.x : 0,
        y: value && Number.isFinite(value.y) ? value.y : 0,
      }))
      .filter((card) => Object.prototype.hasOwnProperty.call(raw[card.scope] || {}, card.name));
  }

  function clearVariableCardSelection(): void {
    state.selectedVariableCardId = '';
    state.selectedVariableCardIds = new Set();
  }

  function setVariableCardSelection(ids: unknown): void {
    const selected = new Set(Array.isArray(ids) ? ids : []);
    state.selectedVariableCardIds = selected;
    state.selectedVariableCardId = selected.size === 1 ? [...selected][0] : '';
  }

  function inputParameterMetadata(): Record<string, any> {
    const raw = state.raw;
    if (!raw || typeof raw !== 'object') return {};
    if (!isRecord(raw._inputParams)) raw._inputParams = {};
    return raw._inputParams;
  }

  function displayNameOfDefinition(definition: unknown, fallback = ''): string {
    const record = isRecord(definition) ? definition : undefined;
    const label = record && record.display_name ? String(record.display_name) : String(fallback || '');
    return record && record._autoPublished === true ? label.replace(/\s*·\s*初始值\s*$/, '') : label;
  }

  function variableDisplayNameOf(scope: 'inputs' | 'variables', name: string, fallback = ''): string {
    const raw = state.raw;
    const rawName = String(name || '');
    const topLevelName = rawName.split('.')[0];
    const definition = raw && raw[scope] ? raw[scope][topLevelName] : undefined;
    const displayName = displayNameOfDefinition(definition);
    if (!displayName) return rawName || fallback;
    return rawName === topLevelName || !rawName ? displayName : `${displayName}.${rawName.slice(topLevelName.length + 1)}`;
  }

  return {
    nodes,
    nodeById,
    layout,
    position,
    variableCards,
    variableLinks,
    nextVariableCardId,
    variableCardList,
    clearVariableCardSelection,
    setVariableCardSelection,
    inputParameterMetadata,
    displayNameOfDefinition,
    variableDisplayNameOf,
  };
}
