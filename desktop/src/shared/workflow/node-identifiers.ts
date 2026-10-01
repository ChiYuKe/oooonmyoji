import { NODE_TYPES } from './types';

/** Persistent IDs use the full built-in type name and a positive decimal index. */
const PREFIXES = new Set<string>([...NODE_TYPES, 'node', 'node_group']);
const ID_PATTERN = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)*)_([1-9][0-9]*)$/;

export function isStandardNodeId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const match = ID_PATTERN.exec(id);
  return Boolean(match && PREFIXES.has(match[1]) && Number.isSafeInteger(Number(match[2])));
}

export function nextNodeId(type: string, used: Iterable<string>): string {
  const prefix = PREFIXES.has(type) ? type : 'node';
  const occupied = new Set(used);
  let index = 1;
  while (occupied.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function record(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Remap identity-bearing fields only; literal text, variable keys and file paths stay intact. */
export function remapNodeIdentifiers(raw: any, mapping: ReadonlyMap<string, string>): void {
  if (!record(raw) || !mapping.size) return;
  const remap = (id: any): any => typeof id === 'string' ? mapping.get(id) ?? id : id;
  const list = (items: any): any => Array.isArray(items) ? items.map(remap) : items;
  const refs = (value: any): void => {
    if (Array.isArray(value)) { value.forEach(refs); return; }
    if (!record(value)) return;
    if (typeof value.ref === 'string') {
      value.ref = value.ref.replace(/^nodes\.([^.]+)\.output(?=\.|$)/, (_: string, id: string) => `nodes.${remap(id)}.output`);
    }
    Object.values(value).forEach(refs);
  };
  refs(raw);
  if (typeof raw.root === 'string') raw.root = remap(raw.root);
  for (const node of Array.isArray(raw.nodes) ? raw.nodes : []) {
    node.id = remap(node.id);
    if (Array.isArray(node.children)) node.children = list(node.children);
    if (typeof node.default_child === 'string') node.default_child = remap(node.default_child);
    for (const entry of Array.isArray(node.cases) ? node.cases : []) {
      if (record(entry) && typeof entry.child === 'string') entry.child = remap(entry.child);
    }
  }
  for (const edge of [...(Array.isArray(raw.edges) ? raw.edges : []), ...(Array.isArray(raw._edgeWaypoints) ? raw._edgeWaypoints : [])]) {
    for (const side of ['from', 'to']) if (record(edge[side])) edge[side].node = remap(edge[side].node);
  }
  const group = (value: any): void => {
    if (!record(value)) return;
    if (typeof value.id === 'string') value.id = remap(value.id);
    if (Array.isArray(value.nodeIds)) value.nodeIds = list(value.nodeIds);
    for (const pin of Array.isArray(value.pins) ? value.pins : []) {
      if (record(pin)) pin.nodeId = remap(pin.nodeId);
    }
  };
  (Array.isArray(raw.groups) ? raw.groups : []).forEach(group);
  if (record(raw._nodeGroups)) {
    const entries = Object.entries(raw._nodeGroups);
    entries.forEach(([, value]) => group(value));
    raw._nodeGroups = Object.fromEntries(entries.map(([id, value]) => [remap(id), value]));
  }
  const layoutId = (id: string): string => {
    for (const prefix of ['__node_group_interface__:', '__node_group_output__:', '__node_group_variables__:']) {
      if (id.startsWith(prefix)) return `${prefix}${remap(id.slice(prefix.length))}`;
    }
    return remap(id);
  };
  for (const key of ['_layout']) {
    if (record(raw[key])) raw[key] = Object.fromEntries(Object.entries(raw[key]).map(([id, value]) => [layoutId(id), value]));
  }
  if (Array.isArray(raw._layoutLocks)) raw._layoutLocks = raw._layoutLocks.map(layoutId);
  if (record(raw._variableLinks)) {
    raw._variableLinks = Object.fromEntries(Object.entries(raw._variableLinks).map(([key, value]) => {
      const colon = key.indexOf(':');
      return [colon < 0 ? key : `${remap(key.slice(0, colon))}${key.slice(colon)}`, value];
    }));
  }
}

/** One-time migration: preserve standard IDs so renaming and changing types cannot churn identity. */
export function normalizeNodeIdentifiers(raw: any): Map<string, string> {
  if (!record(raw)) return new Map();
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const groups = Array.isArray(raw.groups) ? raw.groups
    : record(raw._nodeGroups) ? Object.keys(raw._nodeGroups).map(id => ({ id, type: 'node_group' })) : [];
  const owners = [...nodes, ...groups.map((group: any) => ({ ...group, type: 'node_group' }))];
  const used = new Set<string>();
  for (const owner of owners) {
    if (!record(owner) || typeof owner.id !== 'string' || !owner.id || used.has(owner.id)) {
      throw new Error('节点标识缺失或重复，无法安全迁移引用');
    }
    used.add(owner.id);
  }
  const mapping = new Map<string, string>();
  for (const owner of owners) {
    // v6 variable nodes derive identity from scope/key; they are not execution nodes.
    if (owner.type === 'variable' || isStandardNodeId(owner.id)) continue;
    const type = PREFIXES.has(owner.type) ? owner.type : raw.nodeTypes?.[owner.type]?.base || 'node';
    const id = nextNodeId(type, used);
    used.add(id);
    mapping.set(owner.id, id);
  }
  remapNodeIdentifiers(raw, mapping);
  return mapping;
}
