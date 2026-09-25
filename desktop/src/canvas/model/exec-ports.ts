/**
 * 执行输出口几何：普通节点只有一个底部输出口（卡片居中）；判断节点有两个
 * （左 = 真口、右 = 假口），每个口最多接一个子节点。
 *
 * 卡片绘制、连线起点、命中吸附与端口菜单共用这一份定义，避免四处各算一套。
 * `ports` 与 `children` 对齐，缺省（老文档没写 ports）按顺序推导：0 = 真、1 = 假。
 */
import { isBindingValue } from '../../shared/workflow/bindings';

export type ConditionPort = 'true' | 'false';
export type BoolJudgeOperand = 'left' | 'right';

/** 口位顺序：真在前、假在后（详情栏槽位与默认推导都用它）。 */
export const CONDITION_PORT_ORDER: readonly ConditionPort[] = ['true', 'false'];

export const CONDITION_PORT_LABELS: Record<ConditionPort, string> = { true: '真', false: '假' };

/** 口在卡片宽度上的相对位置：左真、右假。 */
export const CONDITION_PORT_RATIO: Record<ConditionPort, number> = { true: 0.3, false: 0.7 };

/**
 * 判断节点/布尔判断卡片左侧的布尔数据输入口。它固定在标题/说明区域，不占用参数行高度；
 * X 与普通参数行数据口一致（`variablePinX`，卡片左缘内缩），视觉与命中都和其他卡片的
 * 数据端点统一。
 */
export const CONDITION_INPUT_X = 10;
export const CONDITION_INPUT_Y = 64;

/** bool_judge 左右两个表达式输入口，分别对应该卡片详情栏的左值与右值。 */
export const BOOL_JUDGE_INPUT_X = 10;
export const BOOL_JUDGE_LEFT_INPUT_Y = 64;
export const BOOL_JUDGE_RIGHT_INPUT_Y = 88;
export const BOOL_JUDGE_OPERAND_ORDER: readonly BoolJudgeOperand[] = ['left', 'right'];

export function isBoolJudgeOperand(value: unknown): value is BoolJudgeOperand {
  return value === 'left' || value === 'right';
}

export function isBoolJudgeNode(node: any): boolean {
  return Boolean(node) && node.type === 'bool_judge';
}

/**
 * 值卡片：只带数据端点、靠右侧输出引用口把值交给别的节点的叶子卡片
 * （布尔判断 `bool_judge` 与拆分 `break`）。
 *
 * 它们没有执行流出口，也不在卡片顶部画执行流入口——入口箭头会暗示一条
 * 「父节点连过来」的线，而值卡片的使用方式是别的节点引用它的输出
 * （`nodes.<id>.output...`），顶部那条线对它是噪音。命中测试仍按几何把落点
 * 算在卡片顶边，所以从父节点输出口拖过来的线照样能接上。
 */
export function isValueCardNode(node: any): boolean {
  return Boolean(node) && (node.type === 'bool_judge' || node.type === 'break');
}

export function isBoolJudgeOperandPin(node: any, param: unknown): boolean {
  return isBoolJudgeNode(node) && isBoolJudgeOperand(param);
}

/**
 * 布尔判断卡片上能就地编辑的二元比较运算符：只有这些形态才有两个「操作数」引脚，
 * 才能像 UE 的比较节点那样在卡面上点着改值（其余形态见 `boolJudgeExpressionShape`）。
 */
export const BOOL_JUDGE_COMPARISON_OPERATORS: readonly string[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'];

/**
 * 布尔判断卡片的表达式形态——决定卡面画什么、哪些端点存在：
 *
 * - `comparison`：`{eq|ne|gt|gte|lt|lte|contains: [a, b]}`。UE 的紧凑比较节点：左右两个
 *   操作数引脚 + 卡面操作数格，值点着就地编辑。
 * - `binding`：`{ref: '...'}` / `true` / `false`。整张卡就是那个 bool 值，只留**一个布尔输入口**
 *   （与判断节点的「布尔条件」口同一套语义：只接受 boolean，断开后回到 `{eq: [1, 1]}`）。
 * - `nested`：`and` / `or` / `not` / `exists`，以及认不出的坏形状。卡面只回读整句，
 *   没有操作数格也没有可编辑字段——嵌套逻辑走「嵌套条件（进阶）…」浮层
 *   （`and: [0, 0]` 这类标量操作数在 Python 校验里本来就不合法，卡面不再假装能编辑它们）。
 */
export type BoolJudgeShape = 'comparison' | 'binding' | 'nested';

export function boolJudgeExpressionShape(expression: any): BoolJudgeShape {
  if (typeof expression === 'boolean') return 'binding';
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return 'nested';
  const keys = Object.keys(expression);
  if (keys.length !== 1) return 'nested';
  const operator = keys[0];
  if (operator === 'ref') return isBindingValue(expression) ? 'binding' : 'nested';
  if (!BOOL_JUDGE_COMPARISON_OPERATORS.includes(operator)) return 'nested';
  const operands = (expression as Record<string, unknown>)[operator];
  // 比较运算符要求恰好两个操作数；坏形状退回回读，别在卡面上编出并不存在的引脚。
  return Array.isArray(operands) && operands.length === 2 ? 'comparison' : 'nested';
}

export function boolJudgeShape(node: any): BoolJudgeShape {
  return boolJudgeExpressionShape(node ? node.expression : undefined);
}

export function expressionInputOffset(node: any, param: unknown): { x: number; y: number } | null {
  if (node && node.type === 'condition' && param === 'condition') {
    return { x: CONDITION_INPUT_X, y: CONDITION_INPUT_Y };
  }
  // 整卡绑定一个 bool 来源的布尔判断卡：与判断节点的布尔条件口同一套几何。
  if (isBoolJudgeNode(node) && param === 'condition' && boolJudgeShape(node) === 'binding') {
    return { x: CONDITION_INPUT_X, y: CONDITION_INPUT_Y };
  }
  if (isBoolJudgeOperandPin(node, param)) {
    return {
      x: BOOL_JUDGE_INPUT_X,
      y: param === 'left' ? BOOL_JUDGE_LEFT_INPUT_Y : BOOL_JUDGE_RIGHT_INPUT_Y,
    };
  }
  return null;
}

export function isConditionPort(value: unknown): value is ConditionPort {
  return value === 'true' || value === 'false';
}

/**
 * 带左侧「布尔条件」数据口的节点：判断节点（condition）与布尔判断卡片（bool_judge）。
 *
 * 两者共用同一个端点 param（`condition`）与同一套几何：判断节点拿它决定走真口还是假口，
 * 布尔判断卡片拿它当输入（没绑定时用自己的条件表达式求值）。分支口（真/假）仍然只属于判断节点。
 */
export function isBooleanInputNode(node: any): boolean {
  return Boolean(node) && (node.type === 'condition' || node.type === 'bool_judge');
}

/** 某个端点是不是 condition 的单一布尔条件口。 */
export function isBooleanInputPin(node: any, param: unknown): boolean {
  if (param !== 'condition') return false;
  if (node && node.type === 'condition') return true;
  // 整卡绑定一个 bool 来源的布尔判断卡（`{ref}` / true / false）也只有一个布尔输入口。
  return isBoolJudgeNode(node) && boolJudgeShape(node) === 'binding';
}

/**
 * 布尔判断卡片的布尔口：param 固定是 `condition`（只有绑定形态会在卡面画出来）。
 *
 * 写这个口 = 整卡换成 `{ref}`——比较/嵌套形态被写到这里就是转成绑定形态，
 * 所以读写路径按「布尔口」判断，而不是按当前形态：卡面有没有画这个口由
 * `isBooleanInputPin` + `expressionInputOffset` 决定。
 */
export function isBoolJudgeBoolPin(node: any, param: unknown): boolean {
  return isBoolJudgeNode(node) && param === 'condition';
}

/**
 * 拆分卡片（`break`）的「拆分来源」端点：绑定写在节点顶层的 `ref` 字段上
 * （`{ ref: 'nodes.<id>.output...' }`），不是 params 里的普通参数。
 */
export function isBreakRefPin(node: any, param: unknown): boolean {
  return Boolean(node) && node.type === 'break' && param === 'ref';
}

/** 判断节点的口位表（与 children 对齐）；没写 ports 的位置按「还没被占用的口」补。 */
export function conditionPortsOf(node: any): ConditionPort[] {
  const children = Array.isArray(node && node.children) ? node.children : [];
  const declared = Array.isArray(node && node.ports) ? node.ports : [];
  const used = new Set<ConditionPort>();
  return children.map((_: unknown, index: number) => {
    const value = declared[index];
    // 显式口位优先；缺失或重复时补上剩下的那个口（保证两个口各自唯一）。
    const port: ConditionPort = isConditionPort(value) && !used.has(value) ? value : used.has('true') ? 'false' : 'true';
    used.add(port);
    return port;
  });
}

/** 某个口上挂的子节点 id；那个口空着返回 null。 */
export function conditionChildOf(node: any, port: ConditionPort): string | null {
  const children = Array.isArray(node && node.children) ? node.children : [];
  const index = conditionPortsOf(node).indexOf(port);
  return index >= 0 && index < children.length ? String(children[index]) : null;
}

/** 某个子节点挂在哪个口上；不是这个节点的子节点时返回 null。 */
export function conditionPortOfChild(node: any, childId: string): ConditionPort | null {
  const children = Array.isArray(node && node.children) ? node.children : [];
  const index = children.indexOf(childId);
  if (index < 0) return null;
  return conditionPortsOf(node)[index] || 'true';
}

/** 口在卡片内的 X 偏移（卡片左上角为原点）。 */
export function conditionPortOffset(nodeWidth: number, port: ConditionPort): number {
  return Math.round(nodeWidth * CONDITION_PORT_RATIO[port]);
}

/** 指针落在卡片内的 X 偏移离哪个口更近（连线吸附用）。 */
export function nearestConditionPort(nodeWidth: number, offsetX: number): ConditionPort {
  const middle = (conditionPortOffset(nodeWidth, 'true') + conditionPortOffset(nodeWidth, 'false')) / 2;
  return offsetX < middle ? 'true' : 'false';
}
