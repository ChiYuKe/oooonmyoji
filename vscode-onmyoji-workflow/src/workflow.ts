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

function resolveRefSchema(ref: string, context: RefContext, path: (string | number)[], issues: ValidationIssue[]): Record<string, unknown> | undefined {
  const parts = ref.split('.');
  if (parts.length >= 2 && parts[0] === 'blackboard' && parts.slice(1).every(Boolean)) {
    const parameter = context.info.blackboard[parts[1]];
    const resolved = parameter ? schemaAtPath(parameterToSchema(parameter), parts.slice(2)) : undefined;
    if (resolved) return resolved;
    issues.push({ path, message: `绑定引用了未声明的黑板键：${ref}`, severity: 'error', code: 'unknown-ref' });
    return undefined;
  }
  if (parts.length >= 4 && parts[0] === 'nodes' && parts[2] === 'output' && context.nodeIds.has(parts[1]) && parts.slice(3).every(Boolean)) {
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
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateBindings(child, context, [...path, index], issues, condition, schemaChild(expectedSchema, index)));
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
    const actual = resolveRefSchema(value.ref, context, [...path, 'ref'], issues);
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
      } else operand.forEach((child, index) => validateBindings(child, context, [...path, op, index], issues, true));
    } else if (op === 'not') {
      validateBindings(operand, context, [...path, op], issues, true);
    } else if (op === 'exists') {
      if (!isObject(operand) || Object.keys(operand).length !== 1 || typeof operand.ref !== 'string') {
        issues.push({ path: [...path, op], message: 'exists 需要绑定引用', severity: 'error', code: 'invalid-condition' });
      } else resolveRefSchema(operand.ref, context, [...path, op, 'ref'], issues);
    } else if (!Array.isArray(operand) || operand.length !== 2) {
      issues.push({ path: [...path, op], message: `${op} 需要两个操作数`, severity: 'error', code: 'invalid-condition' });
    } else operand.forEach((child, index) => validateBindings(child, context, [...path, op, index], issues));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    validateBindings(child, context, [...path, key], issues, false, schemaChild(expectedSchema, key));
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

function validateDecorator(item: Record<string, unknown>, path: (string | number)[], context: RefContext, issues: ValidationIssue[]): void {
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
  if (type === 'condition') validateBindings(item.expression, context, [...path, 'expression'], issues, true);
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
    if (!node.id) issues.push(issue([...path, 'id'], '节点缺少 id', 'missing-node-id'));
    if (!(NODE_TYPES as readonly string[]).includes(String(rawNode.type))) issues.push(issue([...path, 'type'], `未知节点类型：${String(rawNode.type)}`, 'invalid-node-type'));
    const decoratorsRaw = rawNode.decorators;
    const singletons = new Set<string>();
    if (decoratorsRaw !== undefined && !Array.isArray(decoratorsRaw)) issues.push(issue([...path, 'decorators'], 'decorators 必须是数组', 'invalid-decorator'));
    if (Array.isArray(decoratorsRaw)) decoratorsRaw.forEach((decorator, decoratorIndex) => {
      if (!isObject(decorator)) { issues.push(issue([...path, 'decorators', decoratorIndex], '装饰器必须是对象', 'invalid-decorator')); return; }
      validateDecorator(decorator, [...path, 'decorators', decoratorIndex], context, issues);
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
            validateBindings(params, context, [...path, 'params'], issues, false, spec.inputSchema);
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

function parameterPaths(prefix: string, parameter: ParameterInfo, out: string[]): void {
  if (parameter.type !== 'object' || !parameter.properties) return;
  for (const [key, child] of Object.entries(parameter.properties)) {
    const next = `${prefix}.${key}`;
    out.push(next);
    parameterPaths(next, child, out);
  }
}

export function collectRefSuggestions(info: WorkflowInfo, catalog: ActionCatalog): { blackboard: string[]; nodes: string[] } {
  const blackboard: string[] = [];
  for (const name of info.blackboardProps) {
    const prefix = `blackboard.${name}`;
    blackboard.push(prefix);
    parameterPaths(prefix, info.blackboard[name], blackboard);
  }
  const nodes: string[] = [];
  for (const node of info.nodes) {
    if (!node.id || !node.action) continue;
    const spec = catalog.byName(node.action);
    if (spec) for (const field of spec.outputFields) nodes.push(`nodes.${node.id}.output.${field}`);
  }
  return { blackboard, nodes };
}
