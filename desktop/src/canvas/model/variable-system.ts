/**
 * 工作流变量的存储键、显示名与可复用值定义；纯模型逻辑，无 DOM/运行时副作用。
 * 迁移期间 main.ts 以 window.VariableSystem 暴露给旧编辑器。
 */

export type VariableScope = 'inputs' | 'variables';

export interface VariableDefinition {
  type?: string;
  display_name?: string;
  default?: unknown;
  initial_from?: string;
  owner?: string;
  _autoPublished?: boolean;
  properties?: Record<string, VariableDefinition>;
  items?: VariableDefinition;
  [key: string]: unknown;
}

export interface WorkflowDocument {
  inputs?: Record<string, VariableDefinition>;
  variables?: Record<string, VariableDefinition>;
  nodes?: Array<{ id?: string; children?: string[] }>;
  _variableCards?: Record<string, { scope?: string; name?: string }>;
  [key: string]: unknown;
}

export interface VariableReference {
  nodeId?: string;
  path: string;
  ref?: string;
  initializer?: boolean;
}

export interface VariableSystem {
  create(raw: WorkflowDocument, scope: VariableScope, name: string, definition: VariableDefinition, value?: unknown): string;
  rename(raw: WorkflowDocument, scope: VariableScope, id: string, name: string): void;
  label(raw: WorkflowDocument, scope: VariableScope, id: string): string;
  references(raw: WorkflowDocument, scope: VariableScope, id: string): VariableReference[];
  expose(raw: WorkflowDocument, id: string): string;
  referenceLabel(raw: WorkflowDocument, ref: string): string;
  presets: Record<string, VariableDefinition>;
  copy<T>(value: T): T;
  visible(raw: WorkflowDocument, owner: string | undefined | null, nodeId: string): boolean;
  defaultAt(raw: WorkflowDocument, ref: string): unknown;
  containsBinding(value: unknown): boolean;
  cleanupReleased(raw: WorkflowDocument, before: WorkflowDocument): string[];
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function own(value: unknown, key: string): boolean {
  const object = asRecord(value);
  return object ? Object.prototype.hasOwnProperty.call(object, key) : false;
}

function binding(value: unknown): value is { ref: string } {
  const object = asRecord(value);
  return Boolean(object) && Object.keys(object!).length === 1 && typeof object!.ref === 'string';
}

const presets: Record<string, VariableDefinition> = {
  retry: { type: 'object', properties: { attempts: { type: 'integer', min: 1, required: true, default: 2 }, delay_seconds: { type: 'number', min: 0, required: true, default: 0 } }, default: { attempts: 2, delay_seconds: 0 } },
  vector2: { type: 'object', properties: { x: { type: 'number', required: true, default: 0 }, y: { type: 'number', required: true, default: 0 } }, default: { x: 0, y: 0 } },
  match: { type: 'object', properties: { x: { type: 'integer', required: true, default: 0 }, y: { type: 'integer', required: true, default: 0 }, width: { type: 'integer', min: 0, required: true, default: 0 }, height: { type: 'integer', min: 0, required: true, default: 0 }, confidence: { type: 'number', min: 0, max: 1, required: true, default: 0 } }, default: { x: 0, y: 0, width: 0, height: 0, confidence: 0 } },
};

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function label(raw: WorkflowDocument, scope: VariableScope, id: string): string {
  const scopeRecord = asRecord(raw[scope]);
  const definition = scopeRecord ? asRecord(scopeRecord[id]) : undefined;
  return typeof definition?.display_name === 'string' ? definition.display_name : id;
}

function entries(raw: WorkflowDocument, scope: VariableScope): Array<[string, VariableDefinition]> {
  const scopeRecord = asRecord(raw[scope]);
  return scopeRecord ? Object.entries(scopeRecord) as Array<[string, VariableDefinition]> : [];
}

function create(raw: WorkflowDocument, scope: VariableScope, name: string, definition: VariableDefinition, value?: unknown): string {
  if (!['inputs', 'variables'].includes(scope)) throw Error('Invalid variable scope');
  raw[scope] ||= {};
  let id = '';
  do {
    id = 'v_' + (globalThis.crypto?.randomUUID?.().replace(/-/g, '') || Math.random().toString(36).slice(2) + Date.now().toString(36));
  } while (own(raw.inputs, id) || own(raw.variables, id));
  const entry = copy(definition) as VariableDefinition;
  entry.display_name = name;
  delete entry.required;
  delete entry.owner;
  delete entry.initial_from;
  if (value !== undefined) entry.default = copy(value);
  raw[scope]![id] = entry;
  return id;
}

function rename(raw: WorkflowDocument, scope: VariableScope, id: string, name: string): void {
  if (!name.trim()) throw Error('名称不能为空');
  if (entries(raw, scope).some(([key]) => key !== id && label(raw, scope, key) === name)) throw Error('名称已存在');
  const definition = asRecord(raw[scope]?.[id]);
  if (definition) definition.display_name = name;
}

function references(raw: WorkflowDocument, scope: VariableScope, id: string): VariableReference[] {
  const prefix = `${scope}.${id}`;
  const found: VariableReference[] = [];
  function walk(value: unknown, path: string, nodeId: string | undefined): void {
    if (!value || typeof value !== 'object') return;
    if (binding(value) && (value.ref === prefix || value.ref.startsWith(prefix + '.'))) found.push({ nodeId, path, ref: value.ref });
    for (const [key, child] of Object.entries(value)) walk(child, path + '.' + key, nodeId);
  }
  for (const node of raw.nodes || []) walk(node, 'nodes.' + node.id, node.id);
  for (const [key, definition] of Object.entries(raw.variables || {})) {
    if (definition.initial_from === id && scope === 'inputs') found.push({ path: `variables.${key}.initial_from`, initializer: true });
  }
  return found;
}

function expose(raw: WorkflowDocument, id: string): string {
  const definition = raw.variables?.[id] as VariableDefinition | undefined;
  if (!definition) throw Error(`变量不存在：${id}`);
  if (definition.initial_from && own(raw.inputs, definition.initial_from)) {
    const existing = asRecord(raw.inputs?.[definition.initial_from]);
    if (existing) {
      if (own(definition, 'default')) existing.default = copy(definition.default);
      else delete existing.default;
    }
    return definition.initial_from;
  }
  const input = copy(definition);
  delete input.initial_from;
  input._autoPublished = true;
  const inputId = create(raw, 'inputs', label(raw, 'variables', id), input, definition.default);
  definition.initial_from = inputId;
  return inputId;
}

function referenceLabel(raw: WorkflowDocument, ref: string): string {
  const [scope, id, ...tail] = ref.split('.');
  if (scope === 'inputs' || scope === 'variables') {
    return `变量 · ${label(raw, scope, id)}${tail.length ? ' › ' + tail.join(' › ') : ''}`;
  }
  return ref;
}

function visible(raw: WorkflowDocument, owner: string | undefined | null, nodeId: string): boolean {
  if (!owner) return true;
  const seen = new Set<string>();
  const pending = [owner];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === nodeId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(raw.nodes?.find((node) => node.id === id)?.children || []));
  }
  return false;
}

function defaultAt(raw: WorkflowDocument, ref: string): unknown {
  const [scope, id, ...parts] = ref.split('.');
  const scopeRecord = asRecord(raw[scope as VariableScope]);
  let value: unknown = scopeRecord ? asRecord(scopeRecord[id])?.default : undefined;
  for (const part of parts) {
    const record = asRecord(value);
    value = record ? record[part] : undefined;
  }
  return value === undefined ? undefined : copy(value);
}

function containsBinding(value: unknown): boolean {
  if (binding(value)) return true;
  if (Array.isArray(value)) return value.some(containsBinding);
  const object = asRecord(value);
  return object ? Object.values(object).some(containsBinding) : false;
}

function cleanupReleased(raw: WorkflowDocument, before: WorkflowDocument): string[] {
  const removed: string[] = [];
  for (const [id, definition] of Object.entries(before.inputs || {})) {
    if (!definition._autoPublished || !raw.inputs?.[id]?._autoPublished) continue;
    if (!references(before, 'inputs', id).length || references(raw, 'inputs', id).length) continue;
    // A manually placed Get card remains a user-owned use of the input.
    if (Object.values(raw._variableCards || {}).some((card) => card.scope !== 'variables' && card.name === id)) continue;
    delete raw.inputs![id];
    removed.push(id);
  }
  return removed;
}

export function createVariableSystem(): VariableSystem {
  return { create, rename, label, references, expose, referenceLabel, presets, copy, visible, defaultAt, containsBinding, cleanupReleased };
}

export { cleanupReleased, containsBinding, copy, create, defaultAt, expose, label, presets, referenceLabel, references, rename, visible };
