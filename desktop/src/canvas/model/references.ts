/**
 * 画布引用助手：参数默认值、节点可引用输出集合与引用候选计算。
 * 原 `workflow-editor.js` 的 defaultValue/guaranteedOutputIds/availableOutputIds/
 * possibleOutputIdsInSubtree/possiblyAvailableOutputIds/allRefs/referenceLabel。
 *
 * 只读文档与目录，不修改状态；schema 解析与变量可见性由注入的模块提供。
 */
import type { CanvasState } from '../state/canvas-state';
import { actionLabel, outputFieldLabel } from '../ui/labels';

export interface CanvasReferencesDeps {
  state: CanvasState;
  clone<T>(value: T): T;
  nodes(): any[];
  definitionSchema(definition: any): any;
  compatibleRefType(expected: any, actual: any): boolean;
  appendNestedRefs(ref: string, schema: any, candidates: any[]): void;
  variableSystem: {
    visible(raw: any, owner: any, nodeId: any): boolean;
    referenceLabel(raw: any, ref: string): string;
  };
  catalogByName(name: string): any;
}

export interface CanvasReferences {
  defaultValue(definition: any): any;
  guaranteedOutputIds(nodeId: string, map: Map<string, any>, visiting?: Set<string>): Set<string>;
  availableOutputIds(targetNodeId: string): Set<string>;
  possibleOutputIdsInSubtree(nodeId: string, map: Map<string, any>, visiting?: Set<string>): Set<string>;
  possiblyAvailableOutputIds(targetNodeId: string): Set<string>;
  allRefs(node: any, definition: any, includePossible?: boolean): string[];
  referenceLabel(ref: string): string;
}

export function createCanvasReferences(deps: CanvasReferencesDeps): CanvasReferences {
  const { state, clone, nodes, definitionSchema, compatibleRefType, appendNestedRefs, variableSystem, catalogByName } = deps;

  function defaultValue(definition: any): any {
    if (definition.default !== undefined) return clone(definition.default);
    if (definition.type === 'boolean') return false;
    if (definition.type === 'number' || definition.type === 'integer' || definition.type === 'duration') return 0;
    if (definition.type === 'rect') return [0, 0, 100, 100];
    if (definition.type === 'point') return { x: 0, y: 0 };
    if (definition.type === 'color') return '#000000';
    if (definition.type === 'enum') return Array.isArray(definition.enum) && definition.enum.length ? clone(definition.enum[0]) : '';
    if (definition.type === 'array') return [];
    if (definition.type === 'object') return {};
    return '';
  }

  function guaranteedOutputIds(nodeId: string, map: Map<string, any>, visiting = new Set<string>()): Set<string> {
    if (visiting.has(nodeId)) return new Set();
    const node = map.get(nodeId);
    if (!node) return new Set();
    if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
    const nested = new Set(visiting);
    nested.add(nodeId);
    if (node.type === 'root' && Array.isArray(node.children) && node.children.length === 1) {
      return guaranteedOutputIds(node.children[0], map, nested);
    }
    if (node.type === 'sequence') {
      const result = new Set<string>();
      for (const child of node.children || []) for (const id of guaranteedOutputIds(child, map, nested)) result.add(id);
      return result;
    }
    if (node.type === 'selector' && Array.isArray(node.children) && node.children.length === 1) {
      return guaranteedOutputIds(node.children[0], map, nested);
    }
    if (node.type === 'simple_parallel' && Array.isArray(node.children) && node.children.length === 2) {
      return guaranteedOutputIds(node.children[0], map, nested);
    }
    return new Set();
  }

  function availableOutputIds(targetNodeId: string): Set<string> {
    const map = new Map(nodes().filter((node) => node && node.id).map((node) => [node.id, node]));
    const parents = new Map<string, string[]>();
    for (const parent of nodes()) {
      for (const child of parent.children || []) {
        const entries = parents.get(child) || [];
        entries.push(parent.id);
        parents.set(child, entries);
      }
    }
    const result = new Set<string>();
    const visited = new Set<string>();
    let current = targetNodeId;
    while (!visited.has(current)) {
      visited.add(current);
      const parentIds = parents.get(current) || [];
      if (parentIds.length !== 1) break;
      const parent = map.get(parentIds[0]);
      if (!parent) break;
      if (parent.type === 'sequence') {
        const index = (parent.children || []).indexOf(current);
        for (const sibling of (parent.children || []).slice(0, Math.max(0, index))) {
          for (const id of guaranteedOutputIds(sibling, map)) result.add(id);
        }
      }
      current = parent.id;
    }
    return result;
  }

  function possibleOutputIdsInSubtree(nodeId: string, map: Map<string, any>, visiting = new Set<string>()): Set<string> {
    if (visiting.has(nodeId)) return new Set();
    const node = map.get(nodeId);
    if (!node) return new Set();
    if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
    const nested = new Set(visiting);
    nested.add(nodeId);
    const result = new Set<string>();
    for (const child of node.children || []) for (const id of possibleOutputIdsInSubtree(child, map, nested)) result.add(id);
    return result;
  }

  function possiblyAvailableOutputIds(targetNodeId: string): Set<string> {
    const map = new Map(nodes().filter((node) => node && node.id).map((node) => [node.id, node]));
    const parents = new Map<string, string[]>();
    for (const parent of nodes()) {
      for (const child of parent.children || []) {
        const entries = parents.get(child) || [];
        entries.push(parent.id);
        parents.set(child, entries);
      }
    }
    const result = availableOutputIds(targetNodeId);
    const visited = new Set<string>();
    let current = targetNodeId;
    while (!visited.has(current)) {
      visited.add(current);
      const parentIds = parents.get(current) || [];
      if (parentIds.length !== 1) break;
      const parent = map.get(parentIds[0]);
      if (!parent) break;
      if (parent.type === 'sequence' || parent.type === 'selector') {
        const index = (parent.children || []).indexOf(current);
        for (const sibling of (parent.children || []).slice(0, Math.max(0, index))) {
          for (const id of possibleOutputIdsInSubtree(sibling, map)) result.add(id);
        }
      }
      current = parent.id;
    }
    return result;
  }

  function allRefs(node: any, definition: any, includePossible = false): string[] {
    const expected = definition ? definitionSchema(definition) : undefined;
    const candidates: Array<{ ref: string; schema: any }> = [];
    const inputs = state.raw && state.raw.inputs && typeof state.raw.inputs === 'object' && !Array.isArray(state.raw.inputs)
      ? state.raw.inputs
      : {};
    for (const [name, rawDefinition] of Object.entries(inputs)) {
      const schema = definitionSchema(rawDefinition);
      const ref = `inputs.${name}`;
      candidates.push({ ref, schema });
      appendNestedRefs(ref, schema, candidates);
    }
    const variables = state.raw && state.raw.variables && typeof state.raw.variables === 'object' && !Array.isArray(state.raw.variables)
      ? state.raw.variables
      : {};
    for (const [name, rawDefinition] of Object.entries(variables)) {
      if ((rawDefinition as any).owner && !variableSystem.visible(state.raw, (rawDefinition as any).owner, node?.id)) continue;
      const schema = definitionSchema(rawDefinition);
      const ref = `variables.${name}`;
      candidates.push({ ref, schema });
      appendNestedRefs(ref, schema, candidates);
    }
    const available = node
      ? includePossible ? possiblyAvailableOutputIds(node.id) : availableOutputIds(node.id)
      : null;
    for (const source of nodes()) {
      if (!source || !source.id || !source.action || (available && !available.has(source.id))) continue;
      const spec = catalogByName(source.action);
      if (spec && spec.outputSchema) appendNestedRefs(`nodes.${source.id}.output`, spec.outputSchema, candidates);
    }
    return candidates.filter((candidate) => compatibleRefType(expected, candidate.schema)).map((candidate) => candidate.ref);
  }

  /**
   * id → 节点 索引。只在节点数组的引用或长度变化时重建：改名、改参数读到的都是同一个
   * 对象，所以不会过期；增删节点会改变长度，因此也能及时失效。
   */
  let nodeIndexSource: any[] | null = null;
  let nodeIndexSize = -1;
  let nodeIndexMap = new Map<string, any>();
  function nodeIndex(): Map<string, any> {
    const list = nodes();
    if (nodeIndexSource !== list || nodeIndexSize !== list.length) {
      nodeIndexSource = list;
      nodeIndexSize = list.length;
      nodeIndexMap = new Map(list.filter((item) => item && item.id).map((item) => [item.id, item]));
    }
    return nodeIndexMap;
  }

  /**
   * 把 `nodes.<节点id>.output.<字段>` 渲染成「节点名 › 字段名」。
   * 原始路径对新手是天书，但 id 是唯一稳定的锚点，所以节点名缺失时逐级回退到
   * 动作中文名、再到 id——任何时候都不会返回一个看不懂的裸路径。
   */
  function nodeReferenceLabel(ref: string): string {
    const [, nodeId, slot, ...tail] = ref.split('.');
    const source = nodeIndex().get(nodeId);
    const sourceName = (source && source.name)
      || (source && source.action ? actionLabel(source.action) : '')
      || nodeId;
    if (slot !== 'output') return `${sourceName}（${nodeId}）`;
    const segments = tail.map((part) => (/^\d+$/.test(part) ? `第 ${Number(part) + 1} 项` : outputFieldLabel(part)));
    return `${sourceName} › ${segments.length ? segments.join(' › ') : '输出'}`;
  }

  function referenceLabel(ref: string | null | undefined): string {
    if (!ref) return '无可用引用';
    if (ref.startsWith('inputs.') || ref.startsWith('variables.')) return variableSystem.referenceLabel(state.raw, ref);
    if (ref.startsWith('nodes.')) return nodeReferenceLabel(ref);
    return ref;
  }

  return { defaultValue, guaranteedOutputIds, availableOutputIds, possibleOutputIdsInSubtree, possiblyAvailableOutputIds, allRefs, referenceLabel };
}
