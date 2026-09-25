/**
 * 绑定（ref）解析与类型校验：inputs / variables / nodes.<id>.output / runtime 引用。
 * 纯计算模块，供 validate.ts 与 suggestions.ts 共用。
 */
import { isObject } from './guards';
import { nodeOutputSchema } from './graph';
import { parameterToSchema } from './parameters';
import {
  CONDITION_OPERATORS,
  type ActionCatalogLike,
  type ValidationIssue,
  type WorkflowInfo,
} from './types';

export { schemaAtPath } from './schema-path';
import { schemaAtPath } from './schema-path';

export const BINDING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['ref'],
  properties: { ref: { type: 'string', minLength: 1 } },
  additionalProperties: false,
};

export interface RefContext {
  info: WorkflowInfo;
  catalog: ActionCatalogLike;
  nodeIds: Set<string>;
  pureDataNodeIds?: Set<string>;
}

/**
 * 拆分卡片的来源可能是 `inputs.` / `variables.`：按已声明的定义解析出 schema，
 * 让「拆一个区域变量」这类来源也能推导出输出（否则会当成空对象，排不出字段引脚）。
 * 与引用校验走同一套 `parameterToSchema`，两端结论一致。
 */
function referenceSchemaResolver(context: RefContext): (ref: string) => Record<string, unknown> | undefined {
  return (ref: string) => {
    const parts = ref.split('.');
    if (parts.length < 2 || (parts[0] !== 'inputs' && parts[0] !== 'variables') || !parts.slice(1).every(Boolean)) return undefined;
    const parameter = parts[0] === 'inputs' ? context.info.inputs[parts[1]] : context.info.variables[parts[1]];
    return parameter ? schemaAtPath(parameterToSchema(parameter), parts.slice(2)) : undefined;
  };
}

export const RUNTIME_REF_SCHEMAS: Record<string, Record<string, unknown>> = {
  'runtime.repeat.index': { type: 'integer' },
  'runtime.repeat.count': { type: 'integer' },
  'runtime.repeat.final': { type: 'boolean' },
};

/** 判断值是否为绑定对象（`{ ref: string }`，且不含其它字段）。 */
export function isBindingValue(value: unknown): value is { ref: string } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).ref === 'string' && Object.keys(value).length === 1;
}

export function schemaTypes(schema: Record<string, unknown> | undefined): Set<string> {
  if (!schema) return new Set();
  if (typeof schema.type === 'string') return new Set([schema.type]);
  if (Array.isArray(schema.type)) return new Set(schema.type.filter((item): item is string => typeof item === 'string'));
  return new Set();
}

export function bindingTypesCompatible(expected: Record<string, unknown> | undefined, actual: Record<string, unknown>): boolean {
  const expectedTypes = schemaTypes(expected);
  const actualTypes = schemaTypes(actual);
  if (expectedTypes.size === 0 || actualTypes.size === 0) return true;
  if (expectedTypes.has('number') && actualTypes.has('integer')) actualTypes.add('number');
  return [...expectedTypes].some((type) => actualTypes.has(type));
}

export function resolveRefSchema(
  ref: string,
  context: RefContext,
  path: (string | number)[],
  issues: ValidationIssue[],
  availableNodeIds?: Set<string>,
): Record<string, unknown> | undefined {
  const parts = ref.split('.');
  if (RUNTIME_REF_SCHEMAS[ref]) return RUNTIME_REF_SCHEMAS[ref];
  if (parts.length >= 2 && (parts[0] === 'inputs' || parts[0] === 'variables') && parts.slice(1).every(Boolean)) {
    const parameters = parts[0] === 'inputs' ? context.info.inputs : context.info.variables;
    const parameter = parameters[parts[1]];
    const resolved = parameter ? schemaAtPath(parameterToSchema(parameter), parts.slice(2)) : undefined;
    if (resolved) return resolved;
    issues.push({ path, message: `绑定引用了未声明的${parts[0] === 'inputs' ? '输入' : '运行变量'}：${ref}`, severity: 'error', code: 'unknown-ref' });
    return undefined;
  }
  if (parts.length >= 4 && parts[0] === 'nodes' && parts[2] === 'output' && context.nodeIds.has(parts[1]) && parts.slice(3).every(Boolean)) {
    const ownerId = typeof path[1] === 'string' ? path[1] : '';
    if (availableNodeIds && !availableNodeIds.has(parts[1]) && !context.pureDataNodeIds?.has(parts[1]) && !context.pureDataNodeIds?.has(ownerId)) {
      issues.push({ path, message: `绑定引用了执行到此节点时尚不可用的输出：${ref}`, severity: 'error', code: 'unavailable-ref' });
      return undefined;
    }
    const source = context.info.nodes.find((node) => node.id === parts[1]);
    const outputSchema = nodeOutputSchema(source, context.catalog, (id) => context.info.nodes.find((node) => node.id === id), referenceSchemaResolver(context));
    const resolved = outputSchema ? schemaAtPath(outputSchema, parts.slice(3)) : undefined;
    if (resolved) return resolved;
    issues.push({ path, message: `绑定引用了不存在的 Action 输出：${ref}`, severity: 'error', code: 'unknown-ref' });
    return undefined;
  }
  issues.push({ path, message: `无效的绑定引用：${ref}`, severity: 'error', code: 'invalid-ref' });
  return undefined;
}

/**
 * 拆分卡片（`break`）ref 的目标 schema。
 * 拆分允许引用整张卡片的输出 `nodes.<id>.output`（普通引用要求至少带一个字段，
 * 而拆分正是要把它拆开），也允许引用输出里的嵌套对象/数组路径。
 */
export function breakTargetSchema(
  ref: string,
  context: RefContext,
  path: (string | number)[],
  issues: ValidationIssue[],
  availableNodeIds?: Set<string>,
): Record<string, unknown> | undefined {
  const parts = ref.split('.');
  if (parts.length >= 3 && parts[0] === 'nodes' && parts[2] === 'output' && context.nodeIds.has(parts[1]) && parts.slice(1).every(Boolean)) {
    const ownerId = typeof path[1] === 'string' ? path[1] : '';
    if (availableNodeIds && !availableNodeIds.has(parts[1]) && !context.pureDataNodeIds?.has(parts[1]) && !context.pureDataNodeIds?.has(ownerId)) {
      issues.push({ path, message: `绑定引用了执行到此节点时尚不可用的输出：${ref}`, severity: 'error', code: 'unavailable-ref' });
      return undefined;
    }
    const source = context.info.nodes.find((node) => node.id === parts[1]);
    const outputSchema = nodeOutputSchema(source, context.catalog, (id) => context.info.nodes.find((node) => node.id === id), referenceSchemaResolver(context));
    const resolved = outputSchema ? schemaAtPath(outputSchema, parts.slice(3)) : undefined;
    if (resolved) return resolved;
    issues.push({ path, message: `绑定引用了不存在的 Action 输出：${ref}`, severity: 'error', code: 'unknown-ref' });
    return undefined;
  }
  return resolveRefSchema(ref, context, path, issues, availableNodeIds);
}

export function schemaChild(schema: Record<string, unknown> | undefined, key: string | number): Record<string, unknown> | undefined {
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

export function validateBindings(
  value: unknown,
  context: RefContext,
  path: (string | number)[],
  issues: ValidationIssue[],
  condition = false,
  expectedSchema?: Record<string, unknown>,
  availableNodeIds?: Set<string>,
  possiblyAvailableNodeIds?: Set<string>,
  skipAvailability = false,
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
    const actual = resolveRefSchema(value.ref, context, [...path, 'ref'], issues, skipAvailability ? undefined : availableNodeIds);
    const requiredSchema = condition && !expectedSchema ? { type: 'boolean' } : expectedSchema;
    if (actual && !bindingTypesCompatible(requiredSchema, actual)) {
      issues.push({
        path,
        message: condition && !expectedSchema
          ? `条件引用必须是布尔值：${value.ref}`
          : `绑定类型与 Action 参数不兼容：${value.ref}`,
        severity: 'error',
        code: 'binding-type',
      });
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

export function allowBinding(schema: Record<string, unknown>): Record<string, unknown> {
  const literal = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  if (isObject(literal.properties)) literal.properties = Object.fromEntries(Object.entries(literal.properties).map(([key, child]) => [key, isObject(child) ? allowBinding(child) : child]));
  if (isObject(literal.items)) literal.items = allowBinding(literal.items);
  if (Array.isArray(literal.prefixItems)) literal.prefixItems = literal.prefixItems.map((child) => isObject(child) ? allowBinding(child) : child);
  return { anyOf: [literal, BINDING_SCHEMA] };
}

export function bindingAwareParameterSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  if (isObject(result.properties)) result.properties = Object.fromEntries(Object.entries(result.properties).map(([key, child]) => [key, isObject(child) ? allowBinding(child) : child]));
  return result;
}
