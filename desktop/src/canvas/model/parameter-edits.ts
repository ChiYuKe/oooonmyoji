import Ajv2020 from 'ajv/dist/2020';
import { allowBinding, bindingTypesCompatible, isBindingValue, resolveRefSchema } from '../../shared/workflow/bindings';
import { parameterToSchema, type ParameterInfo } from '../../shared/workflow/parameters';
import { parseWorkflow } from '../../shared/workflow/parse';
import type { ActionCatalogLike } from '../../shared/workflow/types';
import { availableOutputNodeIds } from '../../shared/workflow/graph';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
export type ReferenceAccepted = (ref: string, definition: ParameterInfo) => boolean;

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
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    validators.set(key, validate);
  }
  if (!validate(value)) return false;
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
