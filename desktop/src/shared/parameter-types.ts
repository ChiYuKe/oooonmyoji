/**
 * 参数/变量类型词汇表：Python `oooonmyoji.actions.manifest.PARAMETER_TYPES` 的桌面侧真源。
 * 无依赖模块，主进程、画布与工作台面板共用；`shared/workflow/parameters.ts` 再导出这些常量。
 *
 * 每个类型都对应一份值形状（由 manifest.py 的 to_schema 与 parameters.ts 的 parameterToSchema 编译）：
 * - point    参考分辨率整数坐标点 `{x, y}`
 * - enum     字符串，取值受定义里的 `enum` 选项限制
 * - key      Android keyevent 令牌（`BACK`、`ENTER`、`4`），不含空白
 * - color    `#rrggbb`
 * - duration 秒数（数值，带 min/max）
 */

export const PARAMETER_TYPES = ['string', 'number', 'integer', 'boolean', 'rect', 'asset', 'path', 'array', 'object', 'any', 'point', 'enum', 'key', 'color', 'duration', 'workflow'] as const;

export type ParameterType = (typeof PARAMETER_TYPES)[number];

/** 类型 → 中文标签（变量详情下拉、侧栏类型名、卡片类型名共用）。 */
export const PARAMETER_TYPE_LABELS: Record<string, string> = {
  string: '字符串',
  number: '数值',
  integer: '整数',
  boolean: '布尔',
  rect: '区域',
  asset: '资源',
  path: '路径',
  array: '列表',
  object: '对象',
  any: '任意',
  point: '坐标点',
  enum: '枚举',
  key: '按键',
  color: '颜色',
  duration: '时长',
  workflow: '工作流',
};

/** `color` 的值形状：`#rrggbb`。 */
export const COLOR_PATTERN = '^#[0-9a-fA-F]{6}$';

/** `key` 的值形状：Android keyevent 令牌，不含空白。 */
export const KEY_PATTERN = '^[A-Za-z0-9_]+$';

/** 接受 min/max 的类型。 */
export const NUMERIC_TYPES = ['number', 'integer', 'duration'] as const;

/** 接受 min_length/max_length 的类型。 */
export const STRING_TYPES = ['string', 'asset', 'path', 'workflow', 'key', 'enum'] as const;

/**
 * Action 清单 `card.rows[].control` 的可选值：Python `manifest.CARD_CONTROLS` 的桌面侧真源。
 * 缺省时按参数类型推断控件，显式声明用于「类型相同但控件不同」的场景（例如数组参数用区域框选）。
 * `tuple` 把固定长度数组拆成 N 个输入格（随机间隔 → 最小值 / 最大值）。
 */
export const CARD_CONTROLS = [
  'asset', 'rect', 'toggle', 'enum', 'number', 'integer', 'duration',
  'string', 'key', 'color', 'point', 'tuple', 'inspector',
] as const;

export type CardControl = (typeof CARD_CONTROLS)[number];

/**
 * Action 清单里的固定卡片行。`rows` 顺序即卡片端点顺序；
 * `label` 覆盖共享字段名，`hidden` 把可选参数挡在卡片外，
 * `on_label`/`off_label` 给布尔行的两种状态起名。
 */
export interface ActionCardRow {
  param: string;
  label?: string;
  control?: CardControl;
  hidden?: boolean;
  on_label?: string;
  off_label?: string;
}

/** 按键选择器候选（Android keyevent 令牌）；设备仍接受清单里声明的任意令牌。 */
export const KEY_NAMES = [
  'BACK', 'HOME', 'APP_SWITCH', 'MENU', 'ENTER', 'DEL', 'TAB', 'SPACE', 'ESCAPE',
  'POWER', 'WAKEUP', 'VOLUME_UP', 'VOLUME_DOWN', 'MUTE',
  'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER',
  'PAGE_UP', 'PAGE_DOWN', 'MOVE_HOME', 'MOVE_END', 'FORWARD_DEL',
] as const;

/** 常用按键的中文说明，选择器里显示成 `BACK · 返回`。 */
export const KEY_LABELS: Record<string, string> = {
  BACK: '返回',
  HOME: '主页',
  APP_SWITCH: '任务切换',
  MENU: '菜单',
  ENTER: '回车',
  DEL: '退格',
  TAB: 'Tab',
  SPACE: '空格',
  ESCAPE: 'Esc',
  POWER: '电源',
  WAKEUP: '唤醒',
  VOLUME_UP: '音量+',
  VOLUME_DOWN: '音量-',
  MUTE: '静音',
  DPAD_UP: '方向上',
  DPAD_DOWN: '方向下',
  DPAD_LEFT: '方向左',
  DPAD_RIGHT: '方向右',
  DPAD_CENTER: '方向中',
  PAGE_UP: '上翻页',
  PAGE_DOWN: '下翻页',
  MOVE_HOME: '行首',
  MOVE_END: '行尾',
  FORWARD_DEL: '删除',
};

/** 数字键码的常见别名（设备同样接受裸数字令牌）。 */
export const KEYCODE_ALIASES: Record<string, string> = {
  '3': '主页',
  '4': '返回',
  '26': '电源',
  '66': '回车',
  '82': '菜单',
  '187': '任务切换',
};

export function parameterTypeLabel(type: unknown): string {
  const key = String(type ?? '');
  return PARAMETER_TYPE_LABELS[key] || key || '任意';
}

export function keyOptionLabel(name: string): string {
  const hint = KEY_LABELS[name] || KEYCODE_ALIASES[name];
  return hint ? `${name} · ${hint}` : name;
}
