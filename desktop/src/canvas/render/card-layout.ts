/**
 * Action 清单固定的卡片布局：`card.rows` 的规整化、端点顺序与行控件解析。
 * 纯计算，供节点卡渲染、行几何与就地编辑共用；不读写文档、不碰 DOM。
 *
 * 清单里 `card.rows` 的顺序就是卡片端点的顺序，声明即权威：
 * 声明了卡片的 Action 不再按「必填 + 已配置」过滤，也不再有折叠箭头。
 * 没声明卡片的 Action 返回 null，调用方退回旧行为。
 */
import type { CardControl } from '../../shared/parameter-types';
import type { ParamRowDefinition, ParamRowKind } from './param-rows';
import { paramRowKind, paramRowKindFromControl } from './param-rows';

/** 清单里的一行卡片端点（与 shared/parameter-types.ts 的 ActionCardRow 同形）。 */
export interface CardRowSpec {
  param: string;
  label?: string;
  control?: CardControl | string;
  hidden?: boolean;
  on_label?: string;
  off_label?: string;
}

/** 目录里的 Action 规格：只需要 name/parameters/card 三个字段。 */
export interface CardActionSpec {
  name?: string;
  parameters?: Record<string, ParamRowDefinition> | null;
  card?: CardRowSpec[] | null;
  [key: string]: any;
}

/** 声明里的有效行（必须有 param）。 */
function specRows(spec: CardActionSpec | null | undefined): CardRowSpec[] {
  const rows = spec && Array.isArray(spec.card) ? spec.card : [];
  return rows.filter((row): row is CardRowSpec => Boolean(row && typeof row.param === 'string' && row.param));
}

/** 声明了固定卡片的 Action 才有布局；否则返回 null（旧卡片行为）。 */
export function hasCardLayout(spec: CardActionSpec | null | undefined): boolean {
  return specRows(spec).length > 0;
}

/**
 * 卡片端点名（按清单顺序）。隐藏行不参与渲染，但仍留在声明里，
 * 便于把「暂时收起的可选参数」记在清单上。
 */
export function cardRowParams(spec: CardActionSpec | null | undefined): string[] | null {
  const rows = specRows(spec);
  if (!rows.length) return null;
  return rows.filter((row) => row.hidden !== true).map((row) => row.param);
}

/** 某个参数在卡片声明里的行；未声明返回 null。 */
export function cardRowOf(spec: CardActionSpec | null | undefined, param: string): CardRowSpec | null {
  return specRows(spec).find((row) => row.param === param) || null;
}

/** 行控件：清单显式声明优先（例如把数组参数画成区域框选），否则按参数类型推断。 */
export function cardRowControl(
  row: CardRowSpec | null | undefined,
  definition: ParamRowDefinition | null | undefined,
): ParamRowKind {
  const explicit = paramRowKindFromControl(row && row.control);
  return explicit || paramRowKind(definition);
}

/** 行标签：清单 label 覆盖共享字段名。 */
export function cardRowLabel(
  row: CardRowSpec | null | undefined,
  fallback: string,
): string {
  const label = row && typeof row.label === 'string' ? row.label.trim() : '';
  return label || fallback;
}

/** 布尔行的两种状态名；缺省「开 / 关」，卡片声明可给出「等待出现 / 等待消失」。 */
export function cardRowToggleLabels(
  row: CardRowSpec | null | undefined,
  on = '开',
  off = '关',
): { on: string; off: string } {
  const onLabel = row && typeof row.on_label === 'string' && row.on_label.trim() ? row.on_label.trim() : on;
  const offLabel = row && typeof row.off_label === 'string' && row.off_label.trim() ? row.off_label.trim() : off;
  return { on: onLabel, off: offLabel };
}
