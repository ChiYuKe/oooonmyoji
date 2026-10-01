import { allowBinding, bindingTypesCompatible, isBindingValue, resolveRefSchema } from '../../shared/workflow/bindings';
import { parameterToSchema, type ParameterInfo } from '../../shared/workflow/parameters';
import { parseWorkflow } from '../../shared/workflow/parse';
import type { ActionCatalogLike } from '../../shared/workflow/types';
import { availableOutputNodeIds } from '../../shared/workflow/graph';

export type ReferenceAccepted = (ref: string, definition: ParameterInfo) => boolean;

function equalLiteral(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => equalLiteral(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && equalLiteral(a[key], b[key]));
}

/** Interpret the schema vocabulary emitted by parameterToSchema/allowBinding.
 * Renderer CSP forbids Ajv's runtime Function compilation; keep the same schemas
 * and constraints without generating executable code from them.
 */
function matchesParameterSchema(schema: Record<string, any>, value: unknown): boolean {
  if (schema.anyOf && !schema.anyOf.some((option: Record<string, any>) => matchesParameterSchema(option, value))) return false;
  if (schema.enum && !schema.enum.some((option: unknown) => equalLiteral(option, value))) return false;
  switch (schema.type) {
    case 'string': if (typeof value !== 'string') return false; break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) return false; break;
    case 'integer': if (typeof value !== 'number' || !Number.isInteger(value)) return false; break;
    case 'boolean': if (typeof value !== 'boolean') return false; break;
    case 'array': if (!Array.isArray(value)) return false; break;
    case 'object': if (!value || typeof value !== 'object' || Array.isArray(value)) return false; break;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (schema.minLength !== undefined && length < schema.minLength) return false;
    if (schema.maxLength !== undefined && length > schema.maxLength) return false;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (!value.every((item, index) => {
      const child = schema.prefixItems?.[index] ?? schema.items;
      return !child || matchesParameterSchema(child, item);
    })) return false;
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (schema.required?.some((key: string) => record[key] === undefined)) return false;
    const properties = schema.properties || {};
    if (!Object.keys(record).every((key) => Object.hasOwn(properties, key)
      ? record[key] === undefined || matchesParameterSchema(properties[key], record[key])
      : schema.additionalProperties !== false)) return false;
  }
  return true;
}

export function nodeReferenceValidator(raw: unknown, catalog: ActionCatalogLike, nodeId: string, checkAvailability = false): ReferenceAccepted {
  const info = parseWorkflow(raw);
  const context = { info, catalog, nodeIds: new Set(info.nodeIds), pureDataNodeIds: new Set(info.nodes.filter((node) => node.type === 'bool_judge' || node.type === 'break').map((node) => node.id)) };
  const available = checkAvailability ? availableOutputNodeIds(info, nodeId) : undefined;
  return (ref, definition) => {
    const actual = resolveRefSchema(ref, context, ['nodes', nodeId, 'params'], [], available);
    return Boolean(actual && bindingTypesCompatible(parameterToSchema(definition), actual));
  };
}

/** Validate both literal constraints and the type of each nested reference. */
export function parameterValueAccepted(definition: ParameterInfo, value: unknown, referenceAccepted?: ReferenceAccepted): boolean {
  const schema = allowBinding(parameterToSchema(definition));
  if (!matchesParameterSchema(schema, value)) return false;
  const check = (current: unknown, def: ParameterInfo): boolean => {
    if (isBindingValue(current)) return referenceAccepted ? referenceAccepted(current.ref, def) : false;
    if (Array.isArray(current)) return current.every((item) => check(item, def.items || { type: 'any' }));
    if (current && typeof current === 'object') return Object.entries(current).every(([name, item]) => check(item, def.properties?.[name] || { type: 'any' }));
    return true;
  };
  return check(value, definition);
}

export function planActionParameters(values: Record<string, unknown>, definitions: Record<string, ParameterInfo>, referenceAccepted?: ReferenceAccepted) {
  const params: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (definitions[name] && parameterValueAccepted(definitions[name], value, referenceAccepted)) params[name] = value;
    else removed.push(name);
  }
  return { params, removed };
}

export function commonParameterNames(definitions: Array<Record<string, ParameterInfo>>): string[] {
  if (!definitions.length) return [];
  return Object.keys(definitions[0]).filter((name) => definitions.every((defs) => defs[name]?.type === definitions[0][name].type));
}
