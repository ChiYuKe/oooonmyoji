import { nodeOutputSchema } from './graph';
import { parameterToSchema } from './parameters';
import { schemaAtPath } from './schema-path';
import type { WorkflowInfo, ActionCatalogLike } from './types';

/** Child workflows return a map of node outputs. Describe that actual runtime contract. */
export function functionOutputSchema(info: WorkflowInfo, catalog: ActionCatalogLike): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const lookup = (id: string) => info.nodes.find(node => node.id === id);
  const resolve = (ref: string) => {
    const parts = ref.split('.');
    const definition = parts[0] === 'inputs' ? info.inputs[parts[1]] : parts[0] === 'variables' ? info.variables[parts[1]] : undefined;
    return definition ? schemaAtPath(parameterToSchema(definition), parts.slice(2)) : undefined;
  };
  for (const node of info.nodes) {
    const schema = nodeOutputSchema(node, catalog, lookup, resolve);
    if (schema) properties[node.id] = { ...schema, title: node.name || node.id };
  }
  // Conditional branches may not execute, so no output field is required.
  return { type: 'object', properties, additionalProperties: true };
}
