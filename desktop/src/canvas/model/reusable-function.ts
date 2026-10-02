import { isBindingValue, breakTargetSchema } from '../../shared/workflow/bindings';
import { parseWorkflow } from '../../shared/workflow/parse';
import { validateWorkflow } from '../../shared/workflow/validate';
import { nextNodeId } from '../../shared/workflow/node-identifiers';
import type { ActionCatalogLike } from '../../shared/workflow/types';
import { reconcileVariableLinks } from './variable-links';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const pure = (node: any) => node?.type === 'bool_judge' || node?.type === 'break';
const persistentDecorator = (item: any) => item.type === 'do_once' || item.type === 'cooldown';

/** Walk only structured bindings; log messages and literal text must remain intact. */
function rewrite(value: any, ref: (value: string) => string): any {
  if (isBindingValue(value)) return { ref: ref(value.ref) };
  if (Array.isArray(value)) return value.map(item => rewrite(item, ref));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, ref)]));
  return value;
}

function refs(value: any): string[] {
  const found: string[] = [];
  rewrite(value, ref => { found.push(ref); return ref; });
  return found;
}

function parameterFromSchema(schema: Record<string, any>): Record<string, any> {
  const type = typeof schema.type === 'string' ? schema.type : 'any';
  const result: Record<string, any> = { type };
  if (type === 'array') result.items = parameterFromSchema(schema.items || {});
  if (type === 'object' && schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, parameterFromSchema(value as any)]));
  return result;
}

export interface ReusableFunctionPlan {
  parent: Record<string, any>;
  child: Record<string, any>;
  nodeId: string;
  nodeCount: number;
  inputs: Array<{ name: string; source: string }>;
}

/** Extract a complete execution subtree. Never modify the source before the file is created. */
export function planReusableFunction(raw: Record<string, any>, rootId: string, name: string, id: string, reference: string, catalog: ActionCatalogLike): ReusableFunctionPlan {
  const source = clone(raw);
  const byId = new Map<string, any>((source.nodes || []).map((node: any) => [node.id, node]));
  const entry = byId.get(rootId);
  if (!entry || ['root', 'instance_parallel', 'group_entry', 'group_exit'].includes(entry.type) || pure(entry)) throw new Error('请选择一个任务或流程节点作为功能入口');
  const errors = validateWorkflow(source, catalog).filter(issue => issue.severity === 'error');
  if (errors.length) throw new Error(`请先修正工作流：${errors[0].message}`);

  const execution = new Set<string>();
  const visit = (nodeId: string) => {
    if (execution.has(nodeId)) return;
    const node = byId.get(nodeId);
    if (!node) throw new Error('流程中存在缺失的节点');
    if (node.type === 'instance_parallel') throw new Error('实例并行应保留在入口工作流中');
    execution.add(nodeId);
    for (const child of node.children || []) visit(child);
  };
  visit(rootId);
  if ((entry.decorators || []).some((item: any) => item.type === 'force_success') && (entry.decorators || []).some((item: any) => item.type === 'do_once')) {
    throw new Error('入口同时使用一次执行和强制成功时，请先将它们分到不同层级再封装');
  }
  const included = new Set(execution);
  // Pull in lazy data dependencies so references retain their evaluation semantics.
  for (const nodeId of included) {
    const node = clone(byId.get(nodeId));
    if (nodeId === rootId) node.decorators = (node.decorators || []).filter((item: any) => !persistentDecorator(item));
    for (const ref of refs(node)) {
      const target = /^nodes\.([^.]+)\.output(?:\.|$)/.exec(ref)?.[1];
      if (target && pure(byId.get(target))) included.add(target);
    }
  }
  for (const nodeId of execution) {
    if (nodeId !== rootId && (byId.get(nodeId).decorators || []).some((item: any) => ['do_once', 'cooldown'].includes(item.type))) {
      throw new Error('内部的一次执行或冷却装饰器会跨调用保存状态，请先将它移到功能入口再封装');
    }
  }
  const groups: Record<string, any> = {};
  for (const [groupId, group] of Object.entries<any>(source._nodeGroups || {})) {
    const members: string[] = group.nodeIds || [];
    if (!members.some(member => included.has(member))) continue;
    if (!members.every(member => included.has(member))) throw new Error('功能不能截断折叠图，请选择包含整个折叠图的上级节点');
    groups[groupId] = clone(group);
  }

  // Data cards still used outside the function stay in the parent, with rewritten sources.
  const retained = new Set<string>();
  for (const ref of refs((entry.decorators || []).filter(persistentDecorator))) {
    const target = /^nodes\.([^.]+)\.output(?:\.|$)/.exec(ref)?.[1];
    if (target && included.has(target) && pure(byId.get(target))) retained.add(target);
  }
  for (const node of source.nodes) {
    if (included.has(node.id)) continue;
    for (const ref of refs(node)) {
      const target = /^nodes\.([^.]+)\.output(?:\.|$)/.exec(ref)?.[1];
      if (target && included.has(target) && pure(byId.get(target))) retained.add(target);
    }
  }
  for (const nodeId of retained) for (const ref of refs(byId.get(nodeId))) {
    const target = /^nodes\.([^.]+)\.output(?:\.|$)/.exec(ref)?.[1];
    if (target && included.has(target) && pure(byId.get(target))) retained.add(target);
  }
  const removed = new Set([...included].filter(nodeId => !retained.has(nodeId)));
  const info = parseWorkflow(source);
  const context = { info, catalog, nodeIds: new Set(info.nodeIds), pureDataNodeIds: new Set(info.nodes.filter(pure).map(node => node.id)) };
  const inputs: Record<string, any> = {};
  const arguments_: Record<string, any> = {};
  const inputSources: Array<{ name: string; source: string }> = [];
  const inputNames = new Map<string, string>();
  const variables: Record<string, any> = {};
  const promote = (ref: string, definition: Record<string, any>, preferred: string) => {
    if (inputNames.has(ref)) return inputNames.get(ref)!;
    let key = preferred, index = 2;
    while (Object.hasOwn(inputs, key)) key = `${preferred}_${index++}`;
    const def = clone(definition);
    delete def.owner; delete def.initial_from;
    def.required = true;
    inputs[key] = def;
    arguments_[key] = { ref };
    inputSources.push({ name: key, source: ref });
    inputNames.set(ref, key);
    return key;
  };
  const childRef = (ref: string): string => {
    if (ref.startsWith('runtime.')) throw new Error('循环上下文引用需要先提升为明确的输入参数，再封装功能');
    const scope = /^(inputs|variables)\.([^.]+)(.*)$/.exec(ref);
    if (scope) {
      const [_, table, key, suffix] = scope;
      const definition = source[table]?.[key];
      if (!definition) throw new Error(`引用缺少定义：${ref}`);
      if (table === 'variables' && execution.has(definition.owner)) {
        variables[key] = clone(definition);
        if (definition.initial_from) {
          const input = definition.initial_from;
          variables[key].initial_from = promote(`inputs.${input}`, source.inputs[input], input);
        }
        return ref;
      }
      return `inputs.${promote(`${table}.${key}`, definition, table === 'inputs' ? key : `变量_${key}`)}${suffix}`;
    }
    const target = /^nodes\.([^.]+)\.output(?:\.(.+))?$/.exec(ref);
    if (!target || included.has(target[1])) return ref;
    if (!target[2]) throw new Error('外部节点的整体输出请先拆分为字段，再封装功能');
    const schema = breakTargetSchema(ref, context, [], []);
    if (!schema) throw new Error(`无法识别输入来源：${ref}`);
    const key = promote(ref, { ...parameterFromSchema(schema), display_name: `${byId.get(target[1])?.name || target[1]} · ${target[2]}` }, `输入_${inputSources.length + 1}`);
    return `inputs.${key}`;
  };
  const childNodes = source.nodes.filter((node: any) => included.has(node.id)).map((node: any) => {
    const value = clone(node);
    // Keep repeat/retry/timeout/result rewriting together; only persistent state lives on the call.
    if (node.id === rootId) value.decorators = (value.decorators || []).filter((item: any) => !persistentDecorator(item));
    return rewrite(value, childRef);
  });
  const childRoot = nextNodeId('root', included);
  const child: Record<string, any> = {
    schema_version: 4, id, version: '1.0.0', description: name, resolution: clone(source.resolution),
    root: childRoot, inputs, variables, _reusable: true,
    nodes: [{ id: childRoot, type: 'root', children: [rootId] }, ...childNodes],
    _layout: Object.fromEntries([...included].map(nodeId => [nodeId, clone(source._layout?.[nodeId] || { x: 0, y: 0 })])),
  };
  const point = source._layout?.[rootId] || { x: 0, y: 0 };
  child._layout[childRoot] = { x: point.x, y: point.y - 240 };
  if (source.limits) child.limits = clone(source.limits);
  if (source.retry_safe === true) child.retry_safe = true;
  if (source.nodeTypes) child.nodeTypes = clone(source.nodeTypes);
  if (Object.keys(groups).length) child._nodeGroups = groups;
  child._edgeWaypoints = (source._edgeWaypoints || []).filter((edge: any) => included.has(edge.from.node) && included.has(edge.to.node));

  const call: Record<string, any> = { id: rootId, type: 'task', name, action: 'workflow.run', params: { workflow: reference, inputs: arguments_ } };
  if (entry.decorators) call.decorators = clone(entry.decorators.filter(persistentDecorator));
  const parentRef = (ref: string) => {
    const target = /^nodes\.([^.]+)\.output(.*)$/.exec(ref);
    return target && removed.has(target[1]) ? `nodes.${rootId}.output.output.${target[1]}${target[2]}` : ref;
  };
  const parent = clone(source);
  parent.nodes = source.nodes.flatMap((node: any) => node.id === rootId ? [call] : removed.has(node.id) ? [] : [rewrite(node, parentRef)]);
  for (const nodeId of removed) {
    if (nodeId !== rootId) delete parent._layout?.[nodeId];
    delete parent._inputParams?.[nodeId];
  }
  for (const key of Object.keys(groups)) delete parent._nodeGroups?.[key];
  for (const [key, definition] of Object.entries<any>(parent.variables || {})) if (execution.has(definition.owner)) delete parent.variables[key];
  for (const [key, card] of Object.entries<any>(parent._variableCards || {})) if (card.scope === 'variables' && !Object.hasOwn(parent.variables || {}, card.name)) delete parent._variableCards[key];
  if (Array.isArray(parent._nodeLocks)) parent._nodeLocks = parent._nodeLocks.filter((nodeId: string) => nodeId === rootId || !removed.has(nodeId));
  parent._edgeWaypoints = (parent._edgeWaypoints || []).filter((edge: any) => (!removed.has(edge.from.node) || edge.from.node === rootId) && (!removed.has(edge.to.node) || edge.to.node === rootId));
  reconcileVariableLinks(parent);
  for (const document of [child, parent]) {
    const issue = validateWorkflow(document, catalog).find(item => item.severity === 'error');
    if (issue) throw new Error(`这段流程无法独立封装：${issue.message}`);
  }
  return { parent, child, nodeId: rootId, nodeCount: childNodes.length, inputs: inputSources };
}
