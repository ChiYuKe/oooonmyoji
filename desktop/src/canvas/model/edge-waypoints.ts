/**
 * 手工折线（UE Knot）在画布侧的存取。
 *
 * 文档里折点挂在边上（`edges[].waypoints`），但画布的边是从 `children` 现推出来的、
 * 没有对象可以挂东西，所以边界转换（`shared/workflow/graph-document.ts`）把它寄存在
 * `_edgeWaypoints` 旁表里，键就是边自身的身份（from/to 的节点与引脚）。
 *
 * 这里只处理**执行边**：`then.<下标>` / `true` / `false` / `case.<下标>` / `default`。
 * 数据边（节点输出引用、变量连线）目前不参与手工走线，但它们的折点照样原样保存在文件里
 * ——边界只搬运、不解释。
 */

import { isExecOutPin } from '../../shared/workflow/graph-document';

export interface EdgeWaypoint {
  x: number;
  y: number;
}

interface EdgeWaypointEntry {
  from: { node: string; pin: string };
  to: { node: string; pin: string };
  waypoints: EdgeWaypoint[];
}

/** 旁表键：与 `graph-document.ts` 的 `edgeIdentity` 同一套规则。 */
export const EDGE_WAYPOINTS_KEY = '_edgeWaypoints';

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** `then` 是 `then.0` 的别名，统一成规范写法，别名写法不会丢折点。 */
function canonicalPin(pin: string): string {
  return pin === 'then' ? 'then.0' : pin;
}

function table(raw: any, create: boolean): EdgeWaypointEntry[] | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw[EDGE_WAYPOINTS_KEY])) {
    if (!create) return null;
    raw[EDGE_WAYPOINTS_KEY] = [];
  }
  return raw[EDGE_WAYPOINTS_KEY];
}

function isStructuralEntry(entry: unknown, parentId: string, childId: string): boolean {
  if (!isRecord(entry) || !isRecord(entry.from) || !isRecord(entry.to)) return false;
  return entry.from.node === parentId
    && entry.to.node === childId
    && entry.to.pin === 'in'
    && typeof entry.from.pin === 'string'
    && isExecOutPin(canonicalPin(entry.from.pin));
}

function entryFor(raw: any, parentId: string, childId: string): EdgeWaypointEntry | null {
  const entries = table(raw, false);
  if (!entries) return null;
  const existing = entries.find((entry) => isStructuralEntry(entry, parentId, childId));
  return existing ? (existing as EdgeWaypointEntry) : null;
}

/** 这条执行边上的折点（没有就返回空数组）。 */
export function structuralWaypoints(raw: any, parentId: string, childId: string): EdgeWaypoint[] {
  const entry = entryFor(raw, parentId, childId);
  if (!entry || !Array.isArray(entry.waypoints)) return [];
  return entry.waypoints.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
}

/** 追加一个折点（写进文档旁表；调用方负责包在 mutate 里）。 */
export function addStructuralWaypoint(raw: any, parentId: string, childId: string, point: EdgeWaypoint): boolean {
  if (!isRecord(raw) || !parentId || !childId) return false;
  const next = { x: Math.round(point.x / 8) * 8, y: Math.round(point.y / 8) * 8 };
  const entries = table(raw, true);
  if (!entries) return false;
  let entry = entryFor(raw, parentId, childId);
  if (!entry) {
    // 新条目的引脚：执行边的来源口按父节点的类型推导（判断节点用 true / false）。
    const parent = (Array.isArray(raw.nodes) ? raw.nodes : []).find((node: any) => node?.id === parentId);
    entry = { from: { node: parentId, pin: structuralPinOf(parent, childId) }, to: { node: childId, pin: 'in' }, waypoints: [] };
    entries.push(entry);
  }
  entry.waypoints = [...(entry.waypoints || []), next];
  return true;
}

/** 删掉这条边的所有折点（没有可删的返回 false）。 */
export function clearStructuralWaypoints(raw: any, parentId: string, childId: string): boolean {
  const entries = table(raw, false);
  if (!entries) return false;
  const index = entries.findIndex((entry) => isStructuralEntry(entry, parentId, childId));
  if (index < 0) return false;
  entries.splice(index, 1);
  if (!entries.length) delete raw[EDGE_WAYPOINTS_KEY];
  return true;
}

/** 删掉其中一个折点（下标越界返回 false）。 */
export function removeStructuralWaypoint(raw: any, parentId: string, childId: string, pointIndex: number): boolean {
  const entry = entryFor(raw, parentId, childId);
  if (!entry || !Array.isArray(entry.waypoints) || pointIndex < 0 || pointIndex >= entry.waypoints.length) return false;
  entry.waypoints.splice(pointIndex, 1);
  if (!entry.waypoints.length) return clearStructuralWaypoints(raw, parentId, childId);
  return true;
}

/** 移动其中一个折点。 */
export function moveStructuralWaypoint(raw: any, parentId: string, childId: string, pointIndex: number, point: EdgeWaypoint): boolean {
  const entry = entryFor(raw, parentId, childId);
  if (!entry || !Array.isArray(entry.waypoints) || pointIndex < 0 || pointIndex >= entry.waypoints.length) return false;
  entry.waypoints[pointIndex] = { x: Math.round(point.x / 8) * 8, y: Math.round(point.y / 8) * 8 };
  return true;
}

/**
 * 执行边的来源引脚：与 `graph-document.ts` 写回时的规则一致。
 * 判断节点按它在 `children` 里的位置配 `ports`；其余节点是 `then.<下标>`。
 */
export function structuralPinOf(parent: any, childId: string): string {
  const children = Array.isArray(parent?.children) ? parent.children : [];
  const index = children.indexOf(childId);
  const position = index < 0 ? 0 : index;
  if (parent?.type === 'condition') {
    const declared = Array.isArray(parent?.ports) ? parent.ports : [];
    const port = declared[position];
    if (port === 'true' || port === 'false') return port;
    return position === 0 ? 'true' : 'false';
  }
  if (parent?.type === 'switch') {
    const cases = Array.isArray(parent?.cases) ? parent.cases : [];
    const caseIndex = cases.findIndex((entry: any) => isRecord(entry) && entry.child === childId);
    if (caseIndex >= 0) return `case.${caseIndex}`;
    if (parent?.default_child === childId) return 'default';
  }
  return `then.${position}`;
}
