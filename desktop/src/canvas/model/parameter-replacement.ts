import { isBindingValue } from '../../shared/workflow/bindings';
import type { ActionCatalogLike } from '../../shared/workflow/types';
import { nodeReferenceValidator, parameterValueAccepted } from './parameter-edits';

export interface ParameterReplacement {
  nodeId: string; action: string; param: string; before: unknown; after: unknown; count: number; error?: string;
}
export interface ReplacementOptions {
  find: string; replacement: string; mode: 'exact' | 'text'; action?: string; param?: string;
}
export function planParameterReplacement(raw: any, nodes: any[], catalog: ActionCatalogLike, options: ReplacementOptions): ParameterReplacement[] {
  if (!options.find) return [];
  const result: ParameterReplacement[] = [];
  for (const node of nodes) {
    if (node.type !== 'task' || (options.action && node.action !== options.action)) continue;
    const definitions = catalog.byName(node.action)?.parameters || {};
    for (const [param, before] of Object.entries(node.params || {})) {
      if (options.param && param !== options.param) continue;
      let count = 0, conversionError = false;
      const visit = (value: any): any => {
        if (isBindingValue(value)) return value;
        if (Array.isArray(value)) return value.map(visit);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
        if (options.mode === 'text') {
          if (typeof value !== 'string' || !value.includes(options.find)) return value;
          const parts = value.split(options.find); count += parts.length - 1;
          return parts.join(options.replacement);
        }
        if (String(value) !== options.find || value === null || value === undefined) return value;
        count++;
        if (typeof value === 'number') {
          if (!options.replacement.trim() || !Number.isFinite(Number(options.replacement))) conversionError = true;
          return Number(options.replacement);
        }
        if (typeof value === 'boolean') {
          if (!['true', 'false'].includes(options.replacement)) conversionError = true;
          return options.replacement === 'true';
        }
        return options.replacement;
      };
      const after = visit(before);
      if (!count || (!conversionError && JSON.stringify(before) === JSON.stringify(after))) continue;
      const accepted = definitions[param] && !conversionError && parameterValueAccepted(definitions[param], after, nodeReferenceValidator(raw, catalog, node.id));
      result.push({ nodeId: node.id, action: node.action, param, before, after, count, ...(!accepted ? { error: '替换后的值不符合参数要求' } : {}) });
    }
  }
  return result;
}

export function replacementStillCurrent(nodes: any[], plan: ParameterReplacement[]): boolean {
  return plan.every((entry) => {
    const node = nodes.find((item) => item.id === entry.nodeId);
    return node && node.action === entry.action && JSON.stringify(node.params?.[entry.param]) === JSON.stringify(entry.before);
  });
}
