/** Behavior Tree v3 parsing, semantic validation, schema, and references. */
import Ajv2020 from 'ajv/dist/2020';
import {
  ActionCatalog,
  ParameterInfo,
  applyParameterDefaults,
  parameterToSchema,
  parseParameterDefinition,
} from './catalog';

export const NODE_TYPES = ['root', 'selector', 'sequence', 'simple_parallel', 'task'] as const;
export const DECORATOR_TYPES = ['condition', 'cooldown', 'timeout', 'retry', 'repeat'] as const;
export const PARALLEL_FINISH_MODES = ['abort_background', 'wait_for_background'] as const;
export const CONDITION_OPERATORS = ['exists', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'and', 'or', 'not'] as const;

export type NodeType = typeof NODE_TYPES[number];
export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  severity: Severity;
  code?: string;
}

export interface DecoratorInfo {
  type: string;
  expression?: unknown;
  seconds?: number;
  attempts?: number;
  delaySeconds?: number;
  count?: number;
  raw: Record<string, unknown>;
}

export interface NodeInfo {
  id: string;
  type: NodeType;
  index: number;
  name?: string;
  action?: string;
  params: Record<string, unknown>;
  children: string[];
  decorators: DecoratorInfo[];
  finishMode: 'abort_background' | 'wait_for_background';
}

export interface WorkflowInfo {
  raw: Record<string, unknown> | null;
  id?: string;
  version?: string;
  description?: string;
  root?: string;
  resolution?: number[];
  limits?: Record<string, unknown>;
  blackboard: Record<string, ParameterInfo>;
  blackboardProps: string[];
  nodes: NodeInfo[];
  nodeIds: string[];
  rawNodes: unknown[];
}

const workflowAjv = new Ajv2020({ allErrors: true, strict: false });
const BINDING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['ref'],
  properties: { ref: { type: 'string', minLength: 1 } },
  additionalProperties: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsedDecorator(raw: unknown): DecoratorInfo | undefined {
  if (!isObject(raw)) return undefined;
  const out: DecoratorInfo = { type: typeof raw.type === 'string' ? raw.type : '', raw };
  if (raw.expression !== undefined) out.expression = raw.expression;
  if (typeof raw.seconds === 'number') out.seconds = raw.seconds;
  if (typeof raw.attempts === 'number') out.attempts = raw.attempts;
  if (typeof raw.delay_seconds === 'number') out.delaySeconds = raw.delay_seconds;
  if (typeof raw.count === 'number') out.count = raw.count;
  return out;
}

export function parseWorkflow(raw: unknown): WorkflowInfo {
  const info: WorkflowInfo = {
    raw: null,
    blackboard: {},
    blackboardProps: [],
    nodes: [],
    nodeIds: [],
    rawNodes: [],
  };
  if (!isObject(raw)) return info;
  info.raw = raw;
  if (typeof raw.id === 'string') info.id = raw.id;
  if (typeof raw.version === 'string') info.version = raw.version;
  if (typeof raw.description === 'string') info.description = raw.description;
  if (typeof raw.root === 'string') info.root = raw.root;
  if (Array.isArray(raw.resolution)) info.resolution = raw.resolution as number[];
  if (isObject(raw.limits)) info.limits = raw.limits;
  if (isObject(raw.blackboard)) {
    for (const [key, value] of Object.entries(raw.blackboard)) {
      try {
        info.blackboard[key] = parseParameterDefinition(value, `blackboard.${key}`);
      } catch {
        info.blackboard[key] = { type: isObject(value) ? String(value.type ?? '') : '' };
      }
    }
    info.blackboardProps = Object.keys(info.blackboard);
  }
  if (Array.isArray(raw.nodes)) {
    info.rawNodes = raw.nodes;
    info.nodes = raw.nodes.map((item, index): NodeInfo => {
      const object = isObject(item) ? item : {};
      const type = (NODE_TYPES as readonly string[]).includes(String(object.type)) ? object.type as NodeType : 'task';
      return {
        id: typeof object.id === 'string' ? object.id : '',
        type,
        index,
        name: typeof object.name === 'string' ? object.name : undefined,
        action: typeof object.action === 'string' ? object.action : undefined,
        params: isObject(object.params) ? object.params : {},
        children: Array.isArray(object.children) ? object.children.filter((child): child is string => typeof child === 'string') : [],
        decorators: Array.isArray(object.decorators) ? object.decorators.flatMap((decorator) => parsedDecorator(decorator) ?? []) : [],
        finishMode: object.finish_mode === 'wait_for_background' ? 'wait_for_background' : 'abort_background',
      };
    });
  }
  info.nodeIds = info.nodes.filter((node) => node.id).map((node) => node.id);
  return info;
}

interface RefContext {
  info: WorkflowInfo;
  catalog: ActionCatalog;
  nodeIds: Set<string>;
}

function guaranteedOutputNodeIds(
  nodeId: string,
  nodeMap: Map<string, NodeInfo>,
  visiting = new Set<string>(),
): Set<string> {
  if (visiting.has(nodeId)) return new Set();
  const node = nodeMap.get(nodeId);
  if (!node) return new Set();
  if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
  const nested = new Set(visiting);
  nested.add(nodeId);
  if (node.type === 'root' && node.children.length === 1) {
    return guaranteedOutputNodeIds(node.children[0], nodeMap, nested);
  }
  if (node.type === 'sequence') {
    const result = new Set<string>();
    for (const child of node.children) {
      for (const id of guaranteedOutputNodeIds(child, nodeMap, nested)) result.add(id);
    }
    return result;
  }
  if (node.type === 'selector' && node.children.length === 1) {
    return guaranteedOutputNodeIds(node.children[0], nodeMap, nested);
  }
  if (node.type === 'simple_parallel' && node.children.length === 2) {
    // Parallel success is determined by the main (first) task. The background
    // branch can still be running, fail, or be cancelled, so it contributes no
    // guaranteed outputs.
    return guaranteedOutputNodeIds(node.children[0], nodeMap, nested);
  }
  return new Set();
}

/** Outputs guaranteed to exist immediately before targetNodeId starts. */
export function availableOutputNodeIds(info: WorkflowInfo, targetNodeId: string): Set<string> {
  const nodeMap = new Map(info.nodes.filter((node) => node.id).map((node) => [node.id, node]));
  const parents = new Map<string, string[]>();
  for (const node of info.nodes) {
    for (const child of node.children) {
      const entries = parents.get(child) ?? [];
      entries.push(node.id);
      parents.set(child, entries);
    }
  }
  const result = new Set<string>();
  const visited = new Set<string>();
  let current = targetNodeId;
  while (!visited.has(current)) {
    visited.add(current);
    const parentIds = parents.get(current) ?? [];
    if (parentIds.length !== 1) break;
    const parent = nodeMap.get(parentIds[0]);
    if (!parent) break;
    if (parent.type === 'sequence') {
      const currentIndex = parent.children.indexOf(current);
      for (const sibling of parent.children.slice(0, Math.max(0, currentIndex))) {
        for (const id of guaranteedOutputNodeIds(sibling, nodeMap)) result.add(id);
      }
    }
    current = parent.id;
  }
  return result;
}

function possibleOutputNodeIdsInSubtree(
  nodeId: string,
  nodeMap: Map<string, NodeInfo>,
  visiting = new Set<string>(),
): Set<string> {
  if (visiting.has(nodeId)) return new Set();
  const node = nodeMap.get(nodeId);
  if (!node) return new Set();
  if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
  const nested = new Set(visiting);
  nested.add(nodeId);
  const result = new Set<string>();
  for (const child of node.children) {
    for (const id of possibleOutputNodeIdsInSubtree(child, nodeMap, nested)) result.add(id);
  }
  return result;
}

/** Outputs that may have been produced before targetNodeId, for safe exists checks. */
export function possiblyAvailableOutputNodeIds(info: WorkflowInfo, targetNodeId: string): Set<string> {
  const nodeMap = new Map(info.nodes.filter((node) => node.id).map((node) => [node.id, node]));
  const parents = new Map<string, string[]>();
  for (const node of info.nodes) {
    for (const child of node.children) {
      const entries = parents.get(child) ?? [];
      entries.push(node.id);
      parents.set(child, entries);
    }
  }
  const result = availableOutputNodeIds(info, targetNodeId);
  const visited = new Set<string>();
  let current = targetNodeId;
  while (!visited.has(current)) {
    visited.add(current);
    const parentIds = parents.get(current) ?? [];
    if (parentIds.length !== 1) break;
    const parent = nodeMap.get(parentIds[0]);
    if (!parent) break;
    if (parent.type === 'sequence' || parent.type === 'selector') {
      const currentIndex = parent.children.indexOf(current);
      for (const sibling of parent.children.slice(0, Math.max(0, currentIndex))) {
        for (const id of possibleOutputNodeIdsInSubtree(sibling, nodeMap)) result.add(id);
      }
    }
    current = parent.id;
  }
  return result;
}

function schemaAtPath(schema: Record<string, unknown>, segments: string[]): Record<string, unknown> | undefined {
  let current = schema;
  for (const segment of segments) {
    if (Object.keys(current).length === 0) return {};
    if (current.type === 'object') {
      const properties = isObject(current.properties) ? current.properties : {};
      if (isObject(properties[segment])) {
        current = properties[segment] as Record<string, unknown>;
        continue;
      }
      if (current.additionalProperties === false) return undefined;
      current = isObject(current.additionalProperties) ? current.additionalProperties : {};
      continue;
    }
    if (current.type === 'array') {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return undefined;
      const prefixItems = Array.isArray(current.prefixItems) ? current.prefixItems : [];
      if (isObject(prefixItems[index])) {
        current = prefixItems[index] as Record<string, unknown>;
        continue;
      }
      if (current.items === false) return undefined;
      current = isObject(current.items) ? current.items : {};
      continue;
    }
    return undefined;
  }
  return current;
}

function schemaTypes(schema: Record<string, unknown> | undefined): Set<string> {
  if (!schema) return new Set();
  if (typeof schema.type === 'string') return new Set([schema.type]);
  if (Array.isArray(schema.type)) return new Set(schema.type.filter((item): item is string => typeof item === 'string'));
  return new Set();
}

function bindingTypesCompatible(expected: Record<string, unknown> | undefined, actual: Record<string, unknown>): boolean {
  const expectedTypes = schemaTypes(expected);
  const actualTypes = schemaTypes(actual);
  if (expectedTypes.size === 0 || actualTypes.size === 0) return true;
  if (expectedTypes.has('number') && actualTypes.has('integer')) actualTypes.add('number');
  return [...expectedTypes].some((type) => actualTypes.has(type));
}

function resolveRefSchema(
  ref: string,
  context: RefContext,
  path: (string | number)[],
  issues: ValidationIssue[],
  availableNodeIds?: Set<string>,
): Record<string, unknown> | undefined {
  const parts = ref.split('.');
  if (parts.length >= 2 && parts[0] === 'blackboard' && parts.slice(1).every(Boolean)) {
    const parameter = context.info.blackboard[parts[1]];
    const resolved = parameter ? schemaAtPath(parameterToSchema(parameter), parts.slice(2)) : undefined;
    if (resolved) return resolved;
    issues.push({ path, message: `绑定引用了未声明的黑板键：${ref}`, severity: 'error', code: 'unknown-ref' });
    return undefined;
  }
  if (parts.length >= 4 && parts[0] === 'nodes' && parts[2] === 'output' && context.nodeIds.has(parts[1]) && parts.slice(3).every(Boolean)) {
    if (availableNodeIds && !availableNodeIds.has(parts[1])) {
      issues.push({ path, message: `绑定引用了执行到此节点时尚不可用的输出：${ref}`, severity: 'error', code: 'unavailable-ref' });
      return undefined;
    }
    const source = context.info.nodes.find((node) => node.id === parts[1]);
    const spec = source?.action ? context.catalog.byName(source.action) : undefined;
    const resolved = spec ? schemaAtPath(spec.outputSchema, parts.slice(3)) : undefined;
    if (resolved) return resolved;
    issues.push({ path, message: `绑定引用了不存在的 Action 输出：${ref}`, severity: 'error', code: 'unknown-ref' });
    return undefined;
  }
  issues.push({ path, message: `无效的绑定引用：${ref}`, severity: 'error', code: 'invalid-ref' });
  return undefined;
}

function schemaChild(schema: Record<string, unknown> | undefined, key: string | number): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  if (typeof key === 'string' && schema.type === 'object' && isObject(schema.properties)) {
    return isObject(schema.properties[key]) ? schema.properties[key] as Record<string, unknown> : undefined;
  }
  if (typeof key === 'number' && schema.type === 'array') {
    const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    if (isObject(prefixItems[key])) return prefixItems[key] as Record<string, unknown>;
    return isObject(schema.items) ? schema.items : undefined;
  }
  return undefined;
}

function validateBindings(
  value: unknown,
  context: RefContext,
  path: (string | number)[],
  issues: ValidationIssue[],
  condition = false,
  expectedSchema?: Record<string, unknown>,
  availableNodeIds?: Set<string>,
  possiblyAvailableNodeIds?: Set<string>,
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateBindings(child, context, [...path, index], issues, condition, schemaChild(expectedSchema, index), availableNodeIds, possiblyAvailableNodeIds));
    return;
  }
  if (!isObject(value)) {
    if (condition && typeof value !== 'boolean') issues.push({ path, message: '条件必须是布尔值或条件对象', severity: 'error', code: 'invalid-condition' });
    return;
  }
  if ('ref' in value) {
    if (Object.keys(value).length !== 1 || typeof value.ref !== 'string') {
      issues.push({ path, message: '绑定对象必须只含字符串 ref', severity: 'error', code: 'invalid-binding' });
      return;
    }
    const actual = resolveRefSchema(value.ref, context, [...path, 'ref'], issues, availableNodeIds);
    if (actual && !bindingTypesCompatible(expectedSchema, actual)) {
      issues.push({ path, message: `绑定类型与 Action 参数不兼容：${value.ref}`, severity: 'error', code: 'binding-type' });
    }
    return;
  }
  if (condition) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || !(CONDITION_OPERATORS as readonly string[]).includes(keys[0])) {
      issues.push({ path, message: '条件必须恰好使用一个受支持的操作符', severity: 'error', code: 'invalid-condition' });
      return;
    }
    const op = keys[0];
    const operand = value[op];
    if (op === 'and' || op === 'or') {
      if (!Array.isArray(operand) || operand.length === 0) {
        issues.push({ path: [...path, op], message: `${op} 必须是非空数组`, severity: 'error', code: 'invalid-condition' });
      } else operand.forEach((child, index) => validateBindings(child, context, [...path, op, index], issues, true, undefined, availableNodeIds, possiblyAvailableNodeIds));
    } else if (op === 'not') {
      validateBindings(operand, context, [...path, op], issues, true, undefined, availableNodeIds, possiblyAvailableNodeIds);
    } else if (op === 'exists') {
      if (!isObject(operand) || Object.keys(operand).length !== 1 || typeof operand.ref !== 'string') {
        issues.push({ path: [...path, op], message: 'exists 需要绑定引用', severity: 'error', code: 'invalid-condition' });
      } else resolveRefSchema(operand.ref, context, [...path, op, 'ref'], issues, possiblyAvailableNodeIds ?? availableNodeIds);
    } else if (!Array.isArray(operand) || operand.length !== 2) {
      issues.push({ path: [...path, op], message: `${op} 需要两个操作数`, severity: 'error', code: 'invalid-condition' });
    } else operand.forEach((child, index) => validateBindings(child, context, [...path, op, index], issues, false, undefined, availableNodeIds, possiblyAvailableNodeIds));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    validateBindings(child, context, [...path, key], issues, false, schemaChild(expectedSchema, key), availableNodeIds, possiblyAvailableNodeIds);
  }
}

function allowBinding(schema: Record<string, unknown>): Record<string, unknown> {
  const literal = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  if (isObject(literal.properties)) literal.properties = Object.fromEntries(Object.entries(literal.properties).map(([key, child]) => [key, isObject(child) ? allowBinding(child) : child]));
  if (isObject(literal.items)) literal.items = allowBinding(literal.items);
  if (Array.isArray(literal.prefixItems)) literal.prefixItems = literal.prefixItems.map((child) => isObject(child) ? allowBinding(child) : child);
  return { anyOf: [literal, BINDING_SCHEMA] };
}

function bindingAwareParameterSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  if (isObject(result.properties)) result.properties = Object.fromEntries(Object.entries(result.properties).map(([key, child]) => [key, isObject(child) ? allowBinding(child) : child]));
  return result;
}

function issue(path: (string | number)[], message: string, code: string): ValidationIssue {
  return { path, message, severity: 'error', code };
}

function validateDecorator(
  item: Record<string, unknown>,
  path: (string | number)[],
  context: RefContext,
  issues: ValidationIssue[],
  availableNodeIds: Set<string>,
  possiblyAvailableNodeIds: Set<string>,
): void {
  const type = item.type;
  if (typeof type !== 'string' || !(DECORATOR_TYPES as readonly string[]).includes(type)) {
    issues.push(issue([...path, 'type'], `未知装饰器类型：${String(type)}`, 'invalid-decorator'));
    return;
  }
  const allowed: Record<string, string[]> = {
    condition: ['type', 'expression'], cooldown: ['type', 'seconds'], timeout: ['type', 'seconds'],
    retry: ['type', 'attempts', 'delay_seconds'], repeat: ['type', 'count'],
  };
  const required: Record<string, string[]> = {
    condition: ['expression'], cooldown: ['seconds'], timeout: ['seconds'], retry: ['attempts'], repeat: ['count'],
  };
  const extras = Object.keys(item).filter((key) => !allowed[type].includes(key));
  if (extras.length) issues.push(issue(path, `装饰器包含未知字段：${extras.join(', ')}`, 'invalid-decorator'));
  for (const key of required[type]) if (!(key in item)) issues.push(issue(path, `装饰器缺少 ${key}`, 'invalid-decorator'));
  if (type === 'condition') validateBindings(item.expression, context, [...path, 'expression'], issues, true, undefined, availableNodeIds, possiblyAvailableNodeIds);
  if ((type === 'cooldown' || type === 'timeout') && (typeof item.seconds !== 'number' || item.seconds <= 0)) issues.push(issue([...path, 'seconds'], 'seconds 必须大于 0', 'invalid-decorator'));
  if (type === 'retry' && (!Number.isInteger(item.attempts) || Number(item.attempts) < 1)) issues.push(issue([...path, 'attempts'], 'attempts 必须是正整数', 'invalid-decorator'));
  if (type === 'retry' && item.delay_seconds !== undefined && (typeof item.delay_seconds !== 'number' || item.delay_seconds < 0)) issues.push(issue([...path, 'delay_seconds'], 'delay_seconds 不能小于 0', 'invalid-decorator'));
  if (type === 'repeat' && (!Number.isInteger(item.count) || Number(item.count) < 1)) issues.push(issue([...path, 'count'], 'count 必须是正整数', 'invalid-decorator'));
}

export function validateWorkflow(raw: unknown, catalog: ActionCatalog): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const info = parseWorkflow(raw);
  if (!info.raw) return [issue([], '工作流必须是一个 JSON 对象', 'not-object')];
  const root = info.raw;
  if (root.schema_version !== 3) issues.push(issue(['schema_version'], '仅支持 schema_version 3', 'schema-version'));
  if (typeof root.id !== 'string' || !root.id) issues.push(issue(['id'], '缺少 id', 'missing-id'));
  if (typeof root.version !== 'string' || !root.version) issues.push(issue(['version'], '缺少 version', 'missing-version'));
  if (root.description !== undefined && typeof root.description !== 'string') issues.push(issue(['description'], 'description 必须是字符串', 'invalid-description'));
  if (typeof root.root !== 'string' || !root.root) issues.push(issue(['root'], '缺少 root', 'missing-root'));
  if (!Array.isArray(root.resolution) || root.resolution.length !== 2 || !root.resolution.every((value) => Number.isInteger(value) && Number(value) > 0)) issues.push(issue(['resolution'], 'resolution 必须包含两个正整数', 'invalid-resolution'));
  if (!Array.isArray(root.nodes) || root.nodes.length < 2) issues.push(issue(['nodes'], 'Behavior Tree 至少需要 Root 和一个子节点', 'invalid-nodes'));
  if (root.blackboard !== undefined && !isObject(root.blackboard)) {
    issues.push(issue(['blackboard'], 'blackboard 必须是参数定义对象', 'invalid-blackboard'));
  } else if (isObject(root.blackboard)) {
    for (const [name, definition] of Object.entries(root.blackboard)) {
      try { parseParameterDefinition(definition, `blackboard.${name}`); }
      catch (error) { issues.push(issue(['blackboard', name], (error as Error).message, 'invalid-blackboard-definition')); }
    }
  }

  const ids = new Set(info.nodeIds);
  if (ids.size !== info.nodeIds.length) issues.push(issue(['nodes'], '存在重复的节点 ID', 'duplicate-node'));
  const context: RefContext = { info, catalog, nodeIds: ids };
  const parents = new Map<string, number>(info.nodeIds.map((id) => [id, 0]));
  const nodeMap = new Map(info.nodes.map((node) => [node.id, node]));

  (root.nodes as unknown[] | undefined)?.forEach((rawNode, index) => {
    const path = ['nodes', index];
    if (!isObject(rawNode)) { issues.push(issue(path, '节点必须是对象', 'invalid-node')); return; }
    const node = info.nodes[index];
    const availableNodeIds = availableOutputNodeIds(info, node.id);
    const possiblyAvailableNodeIds = possiblyAvailableOutputNodeIds(info, node.id);
    if (!node.id) issues.push(issue([...path, 'id'], '节点缺少 id', 'missing-node-id'));
    if (!(NODE_TYPES as readonly string[]).includes(String(rawNode.type))) issues.push(issue([...path, 'type'], `未知节点类型：${String(rawNode.type)}`, 'invalid-node-type'));
    const decoratorsRaw = rawNode.decorators;
    const singletons = new Set<string>();
    if (decoratorsRaw !== undefined && !Array.isArray(decoratorsRaw)) issues.push(issue([...path, 'decorators'], 'decorators 必须是数组', 'invalid-decorator'));
    if (Array.isArray(decoratorsRaw)) decoratorsRaw.forEach((decorator, decoratorIndex) => {
      if (!isObject(decorator)) { issues.push(issue([...path, 'decorators', decoratorIndex], '装饰器必须是对象', 'invalid-decorator')); return; }
      validateDecorator(decorator, [...path, 'decorators', decoratorIndex], context, issues, availableNodeIds, possiblyAvailableNodeIds);
      if (decorator.type !== 'condition' && typeof decorator.type === 'string') {
        if (singletons.has(decorator.type)) issues.push(issue([...path, 'decorators', decoratorIndex], `重复的 ${decorator.type} 装饰器`, 'duplicate-decorator'));
        singletons.add(decorator.type);
      }
    });
    if (node.type === 'task') {
      if ('children' in rawNode || 'finish_mode' in rawNode) issues.push(issue(path, 'Task 不能定义 children 或 finish_mode', 'invalid-task'));
      if (typeof rawNode.action !== 'string' || !rawNode.action) issues.push(issue([...path, 'action'], 'Task 必须定义 Action', 'invalid-action'));
      else {
        const spec = catalog.byName(rawNode.action);
        if (!spec) issues.push(issue([...path, 'action'], `未知 Action：${rawNode.action}`, 'unknown-action'));
        else {
          const params = rawNode.params === undefined ? {} : rawNode.params;
          if (!isObject(params)) issues.push(issue([...path, 'params'], 'params 必须是对象', 'invalid-params'));
          else {
            validateBindings(params, context, [...path, 'params'], issues, false, spec.inputSchema, availableNodeIds);
            const validate = workflowAjv.compile(bindingAwareParameterSchema(spec.inputSchema));
            const normalized = applyParameterDefaults(spec.parameters, params);
            if (!validate(normalized)) {
              const primary = validate.errors?.find((error) => ['required', 'additionalProperties', 'type', 'enum', 'minimum', 'maximum'].includes(error.keyword)) ?? validate.errors?.[0];
              issues.push(issue([...path, 'params'], `Action ${rawNode.action} 参数无效：${primary?.instancePath || '/'} ${primary?.message || 'validation failed'}`, 'invalid-params'));
            }
            const retry = node.decorators.find((decorator) => decorator.type === 'retry' && Number(decorator.attempts) > 1);
            if (retry && !spec.retrySafe && root.retry_safe !== true) issues.push(issue([...path, 'decorators'], `Action ${rawNode.action} 不可安全重试`, 'unsafe-retry'));
          }
        }
      }
    } else {
      if ('action' in rawNode || 'params' in rawNode) issues.push(issue(path, `${node.type} 不能定义 action 或 params`, 'invalid-composite'));
      if (node.type === 'root' && node.decorators.length) issues.push(issue([...path, 'decorators'], 'Root 不能挂装饰器', 'invalid-root'));
      if (!Array.isArray(rawNode.children)) issues.push(issue([...path, 'children'], `${node.type} 必须定义 children`, 'invalid-children'));
      if (node.type === 'root' && node.children.length !== 1) issues.push(issue([...path, 'children'], 'Root 必须恰好连接一个子节点', 'root-child-count'));
      if ((node.type === 'selector' || node.type === 'sequence') && node.children.length < 1) issues.push(issue([...path, 'children'], `${node.type} 至少需要一个子节点`, 'composite-child-count'));
      if (node.type === 'simple_parallel') {
        if (node.children.length !== 2) issues.push(issue([...path, 'children'], 'Simple Parallel 必须恰好有两个子节点', 'parallel-child-count'));
        if (node.children[0] && nodeMap.get(node.children[0])?.type !== 'task') issues.push(issue([...path, 'children', 0], 'Simple Parallel 的第一个子节点必须是主 Task', 'parallel-main-task'));
      } else if ('finish_mode' in rawNode) issues.push(issue([...path, 'finish_mode'], 'finish_mode 只适用于 Simple Parallel', 'invalid-finish-mode'));
    }
    for (const [childIndex, child] of node.children.entries()) {
      if (!ids.has(child)) issues.push(issue([...path, 'children', childIndex], `未知子节点：${child}`, 'unknown-child'));
      else parents.set(child, (parents.get(child) ?? 0) + 1);
    }
  });

  const rootNode = typeof root.root === 'string' ? nodeMap.get(root.root) : undefined;
  if (typeof root.root === 'string' && !rootNode) issues.push(issue(['root'], `root 指向不存在的节点：${root.root}`, 'unknown-root'));
  else if (rootNode?.type !== 'root') issues.push(issue(['root'], 'root 必须指向 Root 类型节点', 'invalid-root'));
  if (rootNode && (parents.get(rootNode.id) ?? 0) !== 0) issues.push(issue(['root'], 'Root 不能有父节点', 'root-parent'));
  for (const node of info.nodes) {
    if (rootNode && node.id !== rootNode.id && (parents.get(node.id) ?? 0) !== 1) issues.push(issue(['nodes', node.index], `节点 ${node.id} 必须恰好有一个父节点`, 'parent-count'));
  }

  if (rootNode && !issues.some((entry) => ['duplicate-node', 'unknown-child'].includes(entry.code ?? ''))) {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) { issues.push(issue(['nodes', nodeMap.get(id)?.index ?? 0], `检测到环：${id}`, 'cycle')); return; }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const child of nodeMap.get(id)?.children ?? []) visit(child);
      visiting.delete(id);
      visited.add(id);
    };
    visit(rootNode.id);
    for (const node of info.nodes) if (!visited.has(node.id)) issues.push(issue(['nodes', node.index], `存在不可达节点：${node.id}`, 'unreachable-node'));
  }
  return issues;
}

export function buildWorkflowSchema(info: WorkflowInfo, catalog: ActionCatalog): Record<string, unknown> {
  return {
    type: 'object',
    required: ['schema_version', 'id', 'version', 'resolution', 'root', 'nodes'],
    properties: {
      schema_version: { const: 3 },
      id: { type: 'string', minLength: 1 },
      version: { type: 'string', minLength: 1 },
      description: { type: 'string', description: '工作流用途说明，会显示在子工作流选择器中' },
      resolution: { type: 'array', prefixItems: [{ type: 'integer', minimum: 1 }, { type: 'integer', minimum: 1 }], minItems: 2, maxItems: 2 },
      root: { type: 'string', enum: info.nodeIds },
      blackboard: { type: 'object' },
      retry_safe: { type: 'boolean' },
      limits: { type: 'object', properties: { timeout_seconds: { type: 'number', exclusiveMinimum: 0 }, max_steps: { type: 'integer', minimum: 1 } }, additionalProperties: false },
      nodes: {
        type: 'array', minItems: 2,
        items: {
          type: 'object', required: ['id', 'type'],
          properties: {
            id: { type: 'string', minLength: 1 }, type: { enum: [...NODE_TYPES] }, name: { type: 'string', minLength: 1 },
            action: { type: 'string', enum: catalog.names() }, params: { type: 'object' },
            children: { type: 'array', items: { type: 'string', enum: info.nodeIds }, uniqueItems: true },
            decorators: { type: 'array', items: { type: 'object', required: ['type'], properties: { type: { enum: [...DECORATOR_TYPES] }, expression: {}, seconds: { type: 'number', exclusiveMinimum: 0 }, attempts: { type: 'integer', minimum: 1 }, delay_seconds: { type: 'number', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
            finish_mode: { enum: [...PARALLEL_FINISH_MODES] },
          },
          additionalProperties: false,
        },
      },
    },
    patternProperties: { '^_': {} },
    additionalProperties: false,
  };
}

interface RefCandidate {
  ref: string;
  schema: Record<string, unknown>;
}

function nestedRefCandidates(
  prefix: string,
  schema: Record<string, unknown>,
  out: RefCandidate[],
  depth = 0,
): void {
  if (depth >= 12) return;
  if (schema.type === 'object' && isObject(schema.properties)) {
    for (const [name, rawChild] of Object.entries(schema.properties)) {
      if (!isObject(rawChild)) continue;
      const ref = `${prefix}.${name}`;
      out.push({ ref, schema: rawChild });
      nestedRefCandidates(ref, rawChild, out, depth + 1);
    }
  }
  if (schema.type === 'array') {
    const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    const item = isObject(prefixItems[0]) ? prefixItems[0] as Record<string, unknown>
      : isObject(schema.items) ? schema.items as Record<string, unknown>
        : {};
    const ref = `${prefix}.0`;
    out.push({ ref, schema: item });
    nestedRefCandidates(ref, item, out, depth + 1);
  }
}

export function collectRefSuggestions(
  info: WorkflowInfo,
  catalog: ActionCatalog,
  targetNodeId?: string,
  expectedSchema?: Record<string, unknown>,
): { blackboard: string[]; nodes: string[] } {
  const blackboardCandidates: RefCandidate[] = [];
  for (const name of info.blackboardProps) {
    const prefix = `blackboard.${name}`;
    const schema = parameterToSchema(info.blackboard[name]);
    blackboardCandidates.push({ ref: prefix, schema });
    nestedRefCandidates(prefix, schema, blackboardCandidates);
  }
  const nodeCandidates: RefCandidate[] = [];
  const available = targetNodeId ? availableOutputNodeIds(info, targetNodeId) : undefined;
  for (const node of info.nodes) {
    if (!node.id || !node.action || (available && !available.has(node.id))) continue;
    const spec = catalog.byName(node.action);
    if (spec) nestedRefCandidates(`nodes.${node.id}.output`, spec.outputSchema, nodeCandidates);
  }
  const compatible = (candidate: RefCandidate): boolean => bindingTypesCompatible(expectedSchema, candidate.schema);
  return {
    blackboard: blackboardCandidates.filter(compatible).map((candidate) => candidate.ref),
    nodes: nodeCandidates.filter(compatible).map((candidate) => candidate.ref),
  };
}

export interface WorkflowFileDescriptor {
  uri: string;
  name: string;
  rel: string;
  description?: string;
}

/**
 * 把 workflow.run 的子工作流引用（工作流 ID、JSON 文件名或 workflows/ 下的路径）
 * 匹配到具体工作流文件。ID 匹配需要读取文件内容，由调用方在找不到时逐文件比对 id。
 */
export function matchWorkflowReference(reference: string, files: WorkflowFileDescriptor[]): string | undefined {
  const ref = String(reference ?? '').trim();
  if (!ref) return undefined;
  const norm = ref.replace(/\\/g, '/');
  const withExt = norm.toLowerCase().endsWith('.json') ? norm : `${norm}.json`;
  for (const file of files) {
    if (file.name === norm || file.name === withExt) return file.uri;
    const rel = file.rel.replace(/\\/g, '/');
    if (rel === norm || rel === withExt || rel.endsWith(`/${norm}`) || rel.endsWith(`/${withExt}`)) return file.uri;
  }
  return undefined;
}

/** 结构树节点（按 children 嵌套，前端逐层渲染）。 */
export interface TreeNodePayload {
  id: string;
  name: string;
  type: string;
  meta: string;
  children: TreeNodePayload[];
}

/**
 * 把工作流 JSON 递归构建为结构树；根取 `raw.root` 指定或第一个 `type==='root'` 的节点。
 * 纯解析函数（不依赖 vscode），供独立结构树窗口与测试使用。
 * @param raw - 已解析的工作流对象。
 * @returns 单根数组（无根时为空数组）。
 */
export function buildTreeNode(raw: unknown): TreeNodePayload[] {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of raw.nodes) {
    if (isObject(item) && typeof item.id === 'string') byId.set(item.id, item);
  }
  const rootId = typeof raw.root === 'string' ? raw.root : '';
  const root = byId.get(rootId) || [...byId.values()].find((item) => item.type === 'root');
  if (!root) return [];
  const out: TreeNodePayload[] = [];
  buildNode(root, out);
  return out;

  function buildNode(node: Record<string, unknown>, target: TreeNodePayload[]): void {
    const type = typeof node.type === 'string' ? node.type : 'task';
    const id = typeof node.id === 'string' ? node.id : '';
    const params = isObject(node.params) ? node.params : {};
    const subRef = type === 'task' && node.action === 'workflow.run' && typeof params.workflow === 'string'
      ? String(params.workflow).split(/[\\/]/).pop()
      : '';
    const meta = type === 'task'
      ? (subRef ? `⇢ ${subRef}` : typeof node.action === 'string' ? node.action : 'task')
      : type;
    const entry: TreeNodePayload = {
      id,
      name: typeof node.name === 'string' && node.name.trim() ? node.name.trim() : id,
      type,
      meta,
      children: [],
    };
    if (Array.isArray(node.children)) {
      for (const childId of node.children) {
        const child = byId.get(String(childId));
        if (child) buildNode(child, entry.children);
      }
    }
    target.push(entry);
  }
}

/** 一个 workflow.run 节点对子工作流的一次引用（引用原文 `params.workflow`）。 */
export interface WorkflowRunReference {
  /** 引用节点 id。 */
  nodeId: string;
  /** 引用节点 name（未命名时缺省）。 */
  nodeName?: string;
  /** `params.workflow` 的原始引用值（工作流 ID、JSON 文件名或 workflows/ 下路径）。 */
  reference: string;
}

/**
 * 收集一个工作流 JSON 里全部 `workflow.run` 节点引用。
 * @param raw - 已解析的工作流对象。
 * @returns 按节点出现顺序排列的引用条目。
 */
export function collectWorkflowRunReferences(raw: unknown): WorkflowRunReference[] {
  const out: WorkflowRunReference[] = [];
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return out;
  for (const item of raw.nodes) {
    if (!isObject(item)) continue;
    if (String(item.type) !== 'task' || String(item.action) !== 'workflow.run') continue;
    const params = isObject(item.params) ? item.params : {};
    const reference = typeof params.workflow === 'string' ? params.workflow.trim() : '';
    if (!reference) continue;
    out.push({
      nodeId: typeof item.id === 'string' ? item.id : '',
      nodeName: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
      reference,
    });
  }
  return out;
}

/**
 * 把 workflow.run 的子工作流引用（工作流 ID、JSON 文件名或 workflows/ 下的路径）
 * 解析到具体工作流文件 URI。先按文件名/路径匹配；未命中时把引用当作工作流 ID，
 * 通过 `readText` 读取各文件内容逐文件比对 `id`。
 * @param reference - 引用原文（节点 `params.workflow`）。
 * @param files - 项目内全部工作流文件描述。
 * @param readText - 读取指定 URI 文件文本的异步回调。
 * @returns 命中文件的 URI，找不到时返回 undefined。
 */
export async function resolveWorkflowReference(
  reference: string,
  files: WorkflowFileDescriptor[],
  readText: (uri: string) => Promise<string>,
): Promise<string | undefined> {
  const byPath = matchWorkflowReference(reference, files);
  if (byPath) return byPath;
  const ref = String(reference ?? '').trim();
  if (!ref) return undefined;
  for (const file of files) {
    try {
      const raw = JSON.parse(await readText(file.uri)) as { id?: unknown };
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.id === ref) return file.uri;
    } catch {
      // 忽略读取/解析失败的文件；下一个候选仍可继续匹配。
    }
  }
  return undefined;
}
