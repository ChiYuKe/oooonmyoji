/**
 * 文档健康检查：旧格式迁移与布局异常体检。
 *
 * 两条原则：
 * 1. **迁移只改能被 v4 解释的那几个字段**（废弃的 `public`、缺 schema_version/version），
 *    不猜测用户的意图；调用方把它包进 `mutate`，所以迁移本身可以 Ctrl+Z 撤销。
 * 2. **布局异常只重建布局**：绝不因为坐标坏了就动节点/参数/连线数据——那些是用户的劳动成果。
 */

export interface MigrationOutcome {
  /** 是否真的改了东西。 */
  changed: boolean;
  /** 每条迁移的人话说明（提示与撤销说明都用它）。 */
  steps: string[];
}

/** schema v4 支持的版本号。 */
export const WORKFLOW_SCHEMA_VERSION = 4;
export const WORKFLOW_SCHEMA_REVISION = '4.0.0';

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 旧格式就地迁移（幂等）：
 * - 缺 `schema_version` 或小于 4 → 补成 4（v4 之前的结构在字段层面是兼容的）；
 * - 缺 `version` → 补 `4.0.0`；
 * - 定义上的 `public` 字段（v4 已移除，运行时按 additionalProperties 拒绝）→ 删掉，
 *   并在定义上留 `_migratedPublic` 说明来处，方便用户回查。
 */
export function migrateDocument(raw: any): MigrationOutcome {
  const steps: string[] = [];
  if (!isRecord(raw)) return { changed: false, steps };
  if (raw.schema_version !== WORKFLOW_SCHEMA_VERSION) {
    const previous = raw.schema_version;
    raw.schema_version = WORKFLOW_SCHEMA_VERSION;
    steps.push(`schema_version ${previous === undefined ? '缺失' : String(previous)} → ${WORKFLOW_SCHEMA_VERSION}`);
  }
  if (typeof raw.version !== 'string' || !raw.version) {
    raw.version = WORKFLOW_SCHEMA_REVISION;
    steps.push(`补上 version = ${WORKFLOW_SCHEMA_REVISION}`);
  }
  let publicFields = 0;
  for (const scope of ['inputs', 'variables'] as const) {
    const definitions = raw[scope];
    if (!isRecord(definitions)) continue;
    for (const definition of Object.values(definitions)) {
      if (!isRecord(definition)) continue;
      if (!Object.prototype.hasOwnProperty.call(definition, 'public')) continue;
      const wasPublic = definition.public === true;
      delete definition.public;
      // 只有「曾经公开」的定义才留痕：手写的 public:false 直接删掉就是。
      if (wasPublic) definition._migratedPublic = true;
      publicFields += 1;
    }
  }
  if (publicFields) steps.push(`移除 ${publicFields} 处 schema v4 已废弃的 public 字段`);
  return { changed: steps.length > 0, steps };
}

export type LayoutAnomalyKind = 'missing' | 'invalid' | 'absurd' | 'orphan';

export interface LayoutHealth {
  /** 节点缺少坐标。 */
  missing: string[];
  /** 坐标不是有限数。 */
  invalid: string[];
  /** 坐标量级离谱（多半是坏合并/坏合并产生的垃圾值）。 */
  absurd: string[];
  /** `_layout` 里指向不存在节点的残留项。 */
  orphan: string[];
  /** 需要重建布局（missing/invalid/absurd 任一非空）。 */
  needsRebuild: boolean;
  /** 需要清理残留项（orphan 非空）。 */
  needsPrune: boolean;
  /** 一句话摘要，给提示用。 */
  summary: string;
}

/** 坐标量级上限：超过它基本可以断定不是人放的位置。 */
export const LAYOUT_COORDINATE_LIMIT = 1_000_000;

/** 体检当前布局：只读，不改文档。 */
export function inspectLayout(raw: any): LayoutHealth {
  const layout = isRecord(raw?._layout) ? raw._layout : {};
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const ids = new Set<string>();
  const missing: string[] = [];
  const invalid: string[] = [];
  const absurd: string[] = [];
  for (const node of nodes) {
    const id = String(node?.id ?? '');
    if (!id) continue;
    ids.add(id);
    const value = layout[id];
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (!value || typeof value !== 'object') { missing.push(id); continue; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) { invalid.push(id); continue; }
    if (Math.abs(x) > LAYOUT_COORDINATE_LIMIT || Math.abs(y) > LAYOUT_COORDINATE_LIMIT) absurd.push(id);
  }
  const orphan = Object.keys(layout).filter((id) => !ids.has(id));
  const parts: string[] = [];
  if (missing.length) parts.push(`${missing.length} 个节点没有坐标`);
  if (invalid.length) parts.push(`${invalid.length} 个节点坐标不是有效数字`);
  if (absurd.length) parts.push(`${absurd.length} 个节点坐标量级异常`);
  if (orphan.length) parts.push(`${orphan.length} 条坐标残留指向不存在的节点`);
  return {
    missing, invalid, absurd, orphan,
    needsRebuild: Boolean(missing.length || invalid.length || absurd.length),
    needsPrune: orphan.length > 0,
    summary: parts.join('、'),
  };
}

/** 清掉指向不存在节点的坐标残留；返回删掉的条数。 */
export function pruneOrphanLayout(raw: any): number {
  const layout = isRecord(raw?._layout) ? raw._layout : null;
  if (!layout) return 0;
  const ids = new Set<string>();
  for (const node of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    const id = String(node?.id ?? '');
    if (id) ids.add(id);
  }
  let removed = 0;
  for (const key of Object.keys(layout)) {
    if (ids.has(key)) continue;
    delete layout[key];
    removed += 1;
  }
  return removed;
}
