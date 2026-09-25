/**
 * 把已删除的 `condition` 装饰器升级成判断节点（幂等）。
 *
 * 判断节点取代了原 `condition` 装饰器：`N[condition]` ≡ `判断(真口 → N)`。
 * 一个节点上若挂了多个条件装饰器（旧引擎按顺序全部成立才放行），升级后串成一条链：
 * `判断(c1, 真 → 判断(c2, 真 → N))`，语义一致。
 *
 * 与 `scripts/migrate_condition_decorators.py` 同一套规则，区别只是这份在编辑器里
 * 载入文档时就地跑（`migrateDocument`），让老文件"能打开也能直接保存/运行"。
 */

const CONDITION = 'condition';
/** 与「判断节点落在父与子之间」的同一套落点规则。 */
const MIDPOINT_Y_OFFSET = 24;

interface MigrationPoint {
  x: number;
  y: number;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueId(nodeId: string, used: Set<string>): string {
  const base = `${nodeId}_cond`;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function layoutPoint(raw: Record<string, any>, nodeId: string): MigrationPoint {
  const layout = isRecord(raw._layout) ? raw._layout : {};
  const entry = layout[nodeId];
  return isRecord(entry) && Number.isFinite(entry.x) && Number.isFinite(entry.y)
    ? { x: Number(entry.x), y: Number(entry.y) }
    : { x: 0, y: 0 };
}

/** 就地升级；返回迁移掉的条件装饰器个数（0 表示这份文档已经干净）。 */
export function upgradeConditionDecorators(raw: unknown): number {
  if (!isRecord(raw) || !Array.isArray(raw.nodes)) return 0;
  const nodes = raw.nodes;
  const byId = new Map<string, Record<string, any>>();
  for (const node of nodes) if (isRecord(node) && typeof node.id === 'string') byId.set(node.id, node);
  const usedIds = new Set(byId.keys());
  const layout = isRecord(raw._layout) ? raw._layout : null;
  let migrated = 0;

  for (const node of [...nodes]) {
    if (!isRecord(node) || !Array.isArray(node.decorators)) continue;
    const conditions = node.decorators.filter((item: unknown) => isRecord(item) && item.type === CONDITION);
    if (!conditions.length) continue;
    const remaining = node.decorators.filter((item: unknown) => !conditions.includes(item));
    const parent = nodes.find((candidate: unknown) => isRecord(candidate) && Array.isArray(candidate.children) && candidate.children.includes(node.id));
    if (!isRecord(parent)) continue;

    const nodeId = String(node.id);
    const baseName = typeof node.name === 'string' && node.name ? node.name : nodeId;
    // 多个条件装饰器串成链：从后往前建，最内层先接上 N。
    let childId = nodeId;
    for (let index = conditions.length - 1; index >= 0; index -= 1) {
      const decorator = conditions[index];
      const judgeId = uniqueId(conditions.length === 1 ? nodeId : `${nodeId}_c${index + 1}`, usedIds);
      const judge: Record<string, any> = {
        id: judgeId,
        type: CONDITION,
        name: conditions.length === 1 ? `${baseName} · 判断` : `${baseName} · 判断 ${index + 1}`,
        expression: decorator.expression,
        children: [childId],
        ports: ['true'],
      };
      const anchor = byId.get(childId);
      const anchorIndex = anchor ? nodes.indexOf(anchor) : -1;
      nodes.splice(anchorIndex >= 0 ? anchorIndex : nodes.length, 0, judge);
      byId.set(judgeId, judge);
      if (layout) {
        const parentPoint = layoutPoint(raw, String(parent.id));
        const childPoint = layoutPoint(raw, childId);
        layout[judgeId] = {
          x: Math.round((parentPoint.x + childPoint.x) / 2),
          y: Math.round((parentPoint.y + childPoint.y) / 2) - MIDPOINT_Y_OFFSET,
        };
      }
      childId = judgeId;
    }

    // 父节点的 children 换成链首的判断节点；switch 的 cases 指向一起改。
    if (Array.isArray(parent.children)) {
      parent.children = parent.children.map((child: unknown) => (child === node.id ? childId : child));
    }
    if (Array.isArray(parent.cases)) {
      for (const item of parent.cases) if (isRecord(item) && item.child === node.id) item.child = childId;
    }

    if (remaining.length) node.decorators = remaining;
    else delete node.decorators;
    migrated += conditions.length;
  }

  return migrated;
}
