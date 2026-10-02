import { toGraphDocument } from './workflow/graph-document';

export const AI_CONTEXT_LIMIT = 32000;
export const AI_IMAGE_LIMIT = 6;
const secretField = /api.?key|password|secret|token|authorization/i;

/** Only local image assets are candidates, never URLs or arbitrary local files. */
export function aiTemplatePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512) return;
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!/^assets\/.+\.(png|jpe?g|webp)$/i.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')
    || /[:?#\x00-\x1f]/.test(normalized)) return;
  return normalized;
}

export function aiWorkflowContext(raw: any, selected: any, catalog: any[], count = 3) {
  const graph = toGraphDocument(raw);
  const nodes: any[] = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges: any[] = (Array.isArray(graph?.edges) ? graph.edges : []).map((edge: any) => ({
    from: edge.from?.node, to: edge.to?.node, fromPin: edge.from?.pin, toPin: edge.to?.pin,
    relation: edge.from?.pin?.startsWith('out') ? 'data-dependency' : 'execution',
  }));
  // Also connect the last steps inside a nested child to its next sibling. Without
  // this, a task at the end of a nested sequence would appear to have no downstream.
  const execution = new Map<string, string[]>();
  for (const edge of edges) if (edge.relation === 'execution') execution.set(edge.from, [...(execution.get(edge.from) || []), edge.to]);
  function exits(id: string, seen = new Set<string>()): string[] {
    if (seen.has(id)) return [];
    const visited = new Set(seen); visited.add(id);
    const node = byId.get(id);
    const children = execution.get(id) || [];
    if (!children.length) return [id];
    const next = node?.type === 'sequence' ? children.slice(-1) : children;
    return next.flatMap(child => exits(child, visited)).slice(0, 12);
  }
  // A sequence's children execute in order even though its canvas wires share a parent.
  for (const parent of raw?.nodes || []) if (parent.type === 'sequence' && Array.isArray(parent.children)) {
    parent.children.slice(1).forEach((id: string, index: number) => {
      const previous = parent.children[index];
      const sources = [...new Set([...exits(previous), previous])];
      edges.unshift(...sources.map(from => ({ from, to: id, relation: 'sequence-order' })));
    });
  }
  const limit = Math.max(0, Math.min(5, Number.isFinite(count) ? Math.floor(count) : 3));
  function neighbors(direction: 'upstream' | 'downstream'): any[] {
    const visited = new Set([selected.id]), queue = [selected.id], result: any[] = [];
    while (queue.length && result.length < limit) {
      const id = queue.shift();
      for (const edge of edges) {
        if ((direction === 'upstream' ? edge.to : edge.from) !== id) continue;
        const next = direction === 'upstream' ? edge.from : edge.to;
        if (!byId.has(next) || visited.has(next)) continue;
        visited.add(next); queue.push(next); result.push(byId.get(next));
        if (result.length === limit) break;
      }
    }
    return result;
  }
  const upstream = neighbors('upstream'), downstream = neighbors('downstream');
  function card(node: any): any {
    node = raw?.nodes?.find((item: any) => item.id === node.id) || node;
    const action = catalog.find(item => item.name === node.action);
    // Deliberately omit implementation paths, layout, history and unrelated workflow variables.
    const { id, type, name, action: implementation, params, condition, states, cases, ref, runs, wait_for, finish_mode, decorators } = node;
    return { id, type, name, action: implementation, params, condition, states, cases, ref, runs, wait_for, finish_mode, decorators,
      actionDescription: action && { description: action.description, parameters: action.parameters, inputSchema: action.inputSchema, outputSchema: action.outputSchema } };
  }
  const cards = [card(byId.get(selected.id) || selected), ...upstream.map(card), ...downstream.map(card)];
  const ids = new Set(cards.map(node => node.id));
  const safe = JSON.parse(JSON.stringify({ selected: cards[0], upstream: cards.slice(1, 1 + upstream.length), downstream: cards.slice(1 + upstream.length),
    connections: edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)),
    scope: '仅包含相连的局部节点；sequence-order 表示顺序执行，其余连线包含执行或数据依赖。不要假定这是完整流程。',
  }, (key, value) => secretField.test(key) ? '[已隐藏]' : value));
  const templates = new Map<string, Set<string>>();
  function findTemplates(value: any, owner: string) {
    const relative = aiTemplatePath(value);
    if (relative) { if (!templates.has(relative)) templates.set(relative, new Set()); templates.get(relative)!.add(owner); }
    else if (value && typeof value.ref === 'string') {
      const match = /^(inputs|variables)\.([^.]+)$/.exec(value.ref);
      if (match && !secretField.test(match[2])) {
        const definition = raw?.[match[1]]?.[match[2]];
        const resolved = aiTemplatePath(definition?.default ?? definition?.value ?? definition);
        if (resolved) findTemplates(resolved, owner);
      }
    }
    else if (Array.isArray(value)) value.forEach(child => findTemplates(child, owner));
    else if (value && typeof value === 'object') Object.values(value).forEach(child => findTemplates(child, owner));
  }
  // Search node payloads only: action schema examples are not images used by the node.
  [safe.selected, ...safe.upstream, ...safe.downstream].forEach(node => {
    const { actionDescription, ...payload } = node; findTemplates(payload, node.id);
  });
  const templateItems = [...templates].map(([path, owners]) => ({ path, nodeIds: [...owners] }));
  safe.templates = templateItems.slice(0, AI_IMAGE_LIMIT);
  safe.omittedTemplateCount = Math.max(0, templateItems.length - AI_IMAGE_LIMIT);
  const context = JSON.stringify(safe);
  if (context.length > AI_CONTEXT_LIMIT) throw new Error('节点内容过长，请减少上下游节点数量后重试');
  return { context, upstream, downstream, templates: templateItems.slice(0, AI_IMAGE_LIMIT), omittedTemplateCount: safe.omittedTemplateCount };
}

/** The dragged endpoint, rather than incidental selection, determines creation context. */
export function aiCreationContext(raw: any, catalog: any[], creation: { connection?: any; reference?: any }, selectedId?: string) {
  const connection = creation.connection, reference = creation.reference;
  const anchorId = reference?.nodeId || (connection?.direction === 'from-input' ? connection.child : connection?.parent) || selectedId;
  const anchor = raw?.nodes?.find((node: any) => node.id === anchorId);
  if (anchorId && !anchor) throw new Error('参考节点已删除，请重新打开节点选择器');
  const bundle = anchor ? aiWorkflowContext(raw, anchor, catalog, 3) : {
    context: JSON.stringify({ selected: null, upstream: [], downstream: [], connections: [], templates: [] }), upstream: [], downstream: [], templates: [], omittedTemplateCount: 0,
  };
  const data = JSON.parse(bundle.context);
  data.creation = {
    direction: reference ? 'data-consumer' : connection ? connection.direction === 'from-input' ? 'before' : 'after' : 'standalone',
    anchorId: anchor?.id, branchSlot: connection?.slot, previousTarget: connection?.oldChild, outputField: reference?.field,
    note: '候选均已通过本地连线兼容性检查；推荐后由用户选择，再按原有创建逻辑连接。',
  };
  const context = JSON.stringify(data);
  if (context.length > AI_CONTEXT_LIMIT) throw new Error('参考节点内容过长，请精简参数后重试');
  return { ...bundle, context, anchor, direction: data.creation.direction as string };
}
