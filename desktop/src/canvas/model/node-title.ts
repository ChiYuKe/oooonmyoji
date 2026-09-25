/**
 * UE 风格的节点标题：值卡片（布尔判断 / 拆分）的标题由类型派生，
 * 而不是把内部节点 ID 当名字显示。
 *
 * 对齐 UE Blueprint 的两类值节点：
 * - 比较节点（`K2Node_PromotableOperator`）的标题就是运算符名（Equal / Greater …），
 *   这里用同一套中文动词（等于 / 大于 …）。
 * - Break 结构体节点（`K2Node_BreakStruct`）的标题是 `Break <Struct>`，
 *   这里写 `Break <来源显示名>`；来源的原始引用仍由副标题整句回读。
 *
 * 三层优先级：手动设过的 `name` > 类型派生标题 > 节点 ID。
 * `name` 是本项目特有的覆盖层（UE 没有逐个改名的能力），没设过时标题永远是可读的
 * 类型/来源派生文本，ID 只留在悬停提示与引用文本里。
 *
 * 纯计算、无 DOM 依赖，画布卡片、结构树、浮动编辑器共用同一份标题。
 */

/**
 * 运算符 → 中文名。与条件回读（subworkflow 的 `conditionToText`）共用同一张表：
 * 卡片的标题与判断节点的回读整句说的必须是同一种话。
 */
export const OPERATOR_LABELS: Record<string, string> = {
  eq: '等于', ne: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', contains: '包含',
  and: '并且', or: '或者', not: '不是', exists: '存在',
};

export interface NodeTitleDeps {
  /**
   * 引用路径 → 标题里的短名（`nodes.classify.output` → `识别结果`）。
   * 缺省时保留原始引用文本，调用方注入（画布给中文名，纯逻辑调用方给原文）。
   */
  referenceTitle?(ref: string): string;
}

function operatorKey(expression: any): string {
  if (typeof expression === 'boolean') return expression ? '__always_true' : '__always_false';
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return '';
  return Object.keys(expression)[0] || '';
}

/**
 * 布尔判断卡片的派生标题：UE 的运算符节点标题。
 * 认不出的表达式（例如整卡引用另一个 bool）退回类型名「布尔判断」。
 */
export function boolJudgeTitle(expression: any): string {
  const key = operatorKey(expression);
  if (key === '__always_true') return '始终满足';
  if (key === '__always_false') return '始终不满足';
  return OPERATOR_LABELS[key] || '布尔判断';
}

/** 拆分卡片的派生标题：UE 的 `Break <Struct>`；没绑来源时只说类型。 */
export function breakTitle(node: any, deps: NodeTitleDeps = {}): string {
  const reference = node && node.ref && typeof node.ref === 'object' && !Array.isArray(node.ref) && typeof node.ref.ref === 'string'
    ? node.ref.ref
    : '';
  if (!reference) return 'Break';
  const label = deps.referenceTitle ? deps.referenceTitle(reference) : '';
  return `Break ${label || reference}`;
}

/** 类型派生标题；没有派生规则的节点类型返回空串（交由调用方继续回退）。 */
export function derivedNodeTitle(node: any, deps: NodeTitleDeps = {}): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'bool_judge') return boolJudgeTitle(node.expression);
  if (node.type === 'break') return breakTitle(node, deps);
  return '';
}

/**
 * 卡片标题：`name` 覆盖 > 类型派生标题 > 节点 ID；**值卡片例外**。
 *
 * 布尔判断 / 拆分是 UE 的「纯数据节点」：标题只说类型语义（比较节点显示运算符、
 * Break 显示 `Break`），**不显示用户自定义的实例名**——这样一眼扫过去能分清「数据类型卡」
 * 与「业务步骤卡」。实例名不会丢：它仍出现在条件回读整句里，也是 F2 改名框的占位提示
 * （见 `derivedNodeTitle`），稳定 ID 留在悬停提示里。
 */
export function nodeDisplayTitle(node: any, deps: NodeTitleDeps = {}): string {
  if (node?.type === 'bool_judge' || node?.type === 'break') {
    return node.type === 'break' ? 'Break' : derivedNodeTitle(node, deps) || String(node?.id || '');
  }
  const name = typeof node?.name === 'string' ? node.name.trim() : '';
  return name || derivedNodeTitle(node, deps) || String(node?.id || '');
}
