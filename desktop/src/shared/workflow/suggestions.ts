/** 绑定引用建议：按目标节点可用输出与期望类型过滤 inputs / variables / nodes 引用。 */
import { bindingTypesCompatible } from './bindings';
import { availableOutputNodeIds, nodeOutputSchema } from './graph';
import { parameterToSchema } from './parameters';
import { isObject } from './guards';
import type { ActionCatalogLike, WorkflowInfo } from './types';

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
  catalog: ActionCatalogLike,
  targetNodeId?: string,
  expectedSchema?: Record<string, unknown>,
): { inputs: string[]; variables: string[]; nodes: string[] } {
  const inputCandidates: RefCandidate[] = [];
  for (const name of info.inputProps) {
    const prefix = `inputs.${name}`;
    const schema = parameterToSchema(info.inputs[name]);
    inputCandidates.push({ ref: prefix, schema });
    nestedRefCandidates(prefix, schema, inputCandidates);
  }
  const variableCandidates: RefCandidate[] = [];
  for (const name of info.variableProps) {
    const prefix = `variables.${name}`;
    const schema = parameterToSchema(info.variables[name]);
    variableCandidates.push({ ref: prefix, schema });
    nestedRefCandidates(prefix, schema, variableCandidates);
  }
  const nodeCandidates: RefCandidate[] = [];
  const available = targetNodeId ? availableOutputNodeIds(info, targetNodeId) : undefined;
  const lookup = (id: string) => info.nodes.find((node) => node.id === id);
  for (const node of info.nodes) {
    if (!node.id || (available && !available.has(node.id))) continue;
    const schema = nodeOutputSchema(node, catalog, lookup);
    if (schema) nestedRefCandidates(`nodes.${node.id}.output`, schema, nodeCandidates);
  }
  const compatible = (candidate: RefCandidate): boolean => bindingTypesCompatible(expectedSchema, candidate.schema);
  return {
    inputs: inputCandidates.filter(compatible).map((candidate) => candidate.ref),
    variables: variableCandidates.filter(compatible).map((candidate) => candidate.ref),
    nodes: nodeCandidates.filter(compatible).map((candidate) => candidate.ref),
  };
}
