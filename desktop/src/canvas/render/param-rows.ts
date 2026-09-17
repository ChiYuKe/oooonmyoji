/**
 * 卡片参数行：UE 风格参数行的几何、类型分类、值文本与字面量解析。
 * 纯计算，供节点卡渲染与就地编辑共用；不读写文档、不碰 DOM。
 *
 * 行的纵向排布必须与 nodeHeight（BASE_H + 行数 * RUN_VARIABLE_H）保持一致，
 * 否则连线端点、命中测试与小地图会与画面错位。
 */

export interface ParamRowDefinition {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  required?: boolean;
  min?: number;
  max?: number;
  description?: string;
  [key: string]: any;
}

export interface ParamRowLike {
  param: string;
  label?: string;
  type?: string;
  scope?: 'inputs' | 'variables';
  variable?: string;
  definition?: ParamRowDefinition | null;
  configured?: boolean;
  value?: unknown;
  required?: boolean;
  [key: string]: any;
}

export type ParamRowKind = 'enum' | 'boolean' | 'integer' | 'number' | 'duration' | 'string' | 'key' | 'color' | 'point' | 'asset' | 'complex';

export interface ParamRowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParamRowGeometry {
  /** 行顶边（与上一行分隔线重合）。 */
  y: number;
  /** 行中心，引脚与文字基线由它推导。 */
  centerY: number;
  portX: number;
  labelX: number;
  labelWidth: number;
  valueLeft: number;
  valueRight: number;
  valueWidth: number;
  /** 值区点击热区（世界坐标）。 */
  hit: ParamRowRect;
}

export interface ParamRowValueView {
  text: string;
  tone: 'bound' | 'literal' | 'default' | 'unset' | 'complex';
  title: string;
}

export type ParsedParamLiteral =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** 参数定义 → 就地编辑控件类型。无法就地编辑的归入 complex（走详情栏）。 */
export function paramRowKind(definition: ParamRowDefinition | null | undefined): ParamRowKind {
  const def = definition || {};
  if (Array.isArray(def.enum) && def.enum.length) return 'enum';
  if (def.type === 'boolean') return 'boolean';
  if (def.type === 'integer') return 'integer';
  if (def.type === 'number') return 'number';
  if (def.type === 'duration') return 'duration';
  if (def.type === 'string') return 'string';
  if (def.type === 'key') return 'key';
  if (def.type === 'color') return 'color';
  if (def.type === 'point') return 'point';
  if (def.type === 'asset' || def.type === 'path') return 'asset';
  return 'complex';
}

/** 是否支持卡片内就地编辑（资源与结构体仍回详情栏）。 */
export function paramRowEditable(kind: ParamRowKind): boolean {
  return kind !== 'asset' && kind !== 'complex';
}

export function paramRowGeometry(options: {
  nodeWidth: number;
  baseHeight: number;
  rowHeight: number;
  index: number;
  pinX?: number;
}): ParamRowGeometry {
  const { nodeWidth, baseHeight, rowHeight, index } = options;
  const pinX = options.pinX ?? 10;
  const y = baseHeight + index * rowHeight;
  const valueRight = nodeWidth - 12;
  const valueLeft = Math.round(nodeWidth * 0.46);
  return {
    y,
    centerY: y + rowHeight / 2,
    portX: pinX,
    labelX: pinX + 12,
    labelWidth: Math.max(24, valueLeft - pinX - 18),
    valueLeft,
    valueRight,
    valueWidth: Math.max(24, valueRight - valueLeft),
    hit: { x: valueLeft - 6, y: y + 3, width: nodeWidth - valueLeft - 4, height: rowHeight - 6 },
  };
}

/** 结构体/列表在行内的紧凑摘要：UE 也只用展开箭头代替内容。 */
export function paramRowComplexSummary(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length} 项]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length ? `{${keys.length} 字段}` : '{}';
  }
  return String(value ?? '');
}

/** 颜色值：`#rrggbb`（非法值原样显示，避免掩盖数据问题）。 */
export function paramColorText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** 颜色值是否可作为色块填充（`#rrggbb`）。 */
export function paramColorSwatch(value: unknown): string | null {
  const text = paramColorText(value);
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : null;
}

/** 坐标点：`(x, y)`；缺字段时按 0 补齐。 */
export function paramPointText(value: unknown): string {
  const point = paramPointParts(value);
  return `(${point.x}, ${point.y})`;
}

/** 坐标点分量：容忍 `{x, y}`、`[x, y]` 与非法值。 */
export function paramPointParts(value: unknown): { x: number; y: number } {
  const toNumber = (item: unknown): number => {
    const number = typeof item === 'number' ? item : Number(item);
    return Number.isFinite(number) ? Math.round(number) : 0;
  };
  if (Array.isArray(value)) return { x: toNumber(value[0]), y: toNumber(value[1]) };
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return { x: toNumber(record.x), y: toNumber(record.y) };
  }
  return { x: 0, y: 0 };
}

/** 时长：数值后带秒单位。 */
export function paramDurationText(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return `${Number.isInteger(number) ? number : Math.round(number * 1000) / 1000}s`;
}

/** 按键名：Android keyevent 令牌原样显示。 */
export function paramKeyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 值文本：按类型给出可读形式（数值/文本回落到 compact）。 */
function paramValueText(kind: ParamRowKind, value: unknown, compact: (value: unknown, max?: number) => string): string {
  if (kind === 'point') return paramPointText(value);
  if (kind === 'duration') return paramDurationText(value);
  if (kind === 'color') return compact(paramColorText(value) || '未设置', 18);
  if (kind === 'key') return compact(paramKeyText(value) || '未设置', 18);
  return compact(value, 18);
}

/** 值的完整文本（悬停提示用）。 */
export function paramValueFullText(kind: ParamRowKind, value: unknown): string {
  if (kind === 'point') return paramPointText(value);
  if (kind === 'duration') return `${paramDurationText(value)}（秒）`;
  if (kind === 'color') return paramColorText(value);
  if (kind === 'key') return paramKeyText(value);
  return safeJson(value);
}

/**
 * 行内值文本：绑定变量优先，其次已配置字面量，再次定义默认值，最后是未设置。
 * `variableName` 由调用方用变量显示名替换，避免卡片里出现过长的内部引用。
 */
export function paramRowValueView(
  row: ParamRowLike,
  compact: (value: unknown, max?: number) => string,
  variableName?: string,
): ParamRowValueView {
  const param = row.param || '';
  const definition: ParamRowDefinition = row.definition || {};
  const kind = paramRowKind(definition);
  if (row.variable) {
    return {
      text: `← ${variableName || row.variable}`,
      tone: 'bound',
      title: `${param}：绑定 ${row.scope}.${row.variable}`,
    };
  }
  const configured = row.configured === true || (row.configured === undefined && row.value !== undefined);
  if (configured) {
    if (kind === 'complex') {
      const summary = paramRowComplexSummary(row.value);
      return { text: summary, tone: 'complex', title: `${param} = ${safeJson(row.value)}（点击在详情栏编辑）` };
    }
    if (kind === 'asset') {
      return { text: compact(row.value, 18), tone: 'complex', title: `${param} = ${String(row.value ?? '')}（点击在详情栏编辑）` };
    }
    return { text: paramValueText(kind, row.value, compact), tone: 'literal', title: `${param} = ${paramValueFullText(kind, row.value)}` };
  }
  if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
    const fallback = definition.default;
    const text = kind === 'complex' ? paramRowComplexSummary(fallback) : paramValueText(kind, fallback, compact);
    return { text, tone: 'default', title: `${param}：默认值 ${paramValueFullText(kind, fallback)}（点击编辑）` };
  }
  return { text: '未设置', tone: 'unset', title: `${param}：未设置（点击编辑）` };
}

function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

/** 就地编辑输入框的初始文本。 */
export function paramLiteralText(kind: ParamRowKind, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (kind === 'boolean') return value ? 'true' : 'false';
  if (kind === 'point') return paramPointText(value);
  if (kind === 'color') return paramColorText(value);
  if (kind === 'key') return paramKeyText(value);
  if (kind === 'duration') return typeof value === 'number' ? String(value) : String(Number(value));
  if (kind === 'complex' || kind === 'asset') return typeof value === 'string' ? value : safeJson(value);
  return String(value);
}

/** 输入文本 → 参数值；带范围校验，避免写入非法数值。 */
export function parseParamLiteral(
  kind: ParamRowKind,
  text: string,
  definition?: ParamRowDefinition | null,
): ParsedParamLiteral {
  const def = definition || {};
  const raw = String(text ?? '');
  const trimmed = raw.trim();
  if (kind === 'string') return { ok: true, value: raw };
  if (kind === 'key') {
    if (!trimmed) return { ok: false, error: '需要按键名' };
    if (!/^[A-Za-z0-9_]+$/.test(trimmed)) return { ok: false, error: '按键名只能是字母/数字/下划线' };
    if (typeof def.min === 'number' && trimmed.length < def.min) return { ok: false, error: `长度不能小于 ${def.min}` };
    return { ok: true, value: trimmed };
  }
  if (kind === 'color') {
    if (!trimmed) return { ok: false, error: '需要颜色值' };
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return { ok: false, error: '需要 #rrggbb' };
    return { ok: true, value: trimmed.toLowerCase() };
  }
  if (kind === 'point') {
    const parts = trimmed.replace(/[()]/g, '').split(/[\s,;]+/).filter(Boolean);
    if (parts.length !== 2) return { ok: false, error: '需要两个数值，如 100, 200' };
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: '坐标需要数值' };
    return { ok: true, value: { x: Math.round(x), y: Math.round(y) } };
  }
  if (kind === 'boolean') return { ok: true, value: trimmed === 'true' || trimmed === '1' || trimmed === '是' };
  if (kind === 'integer' || kind === 'number' || kind === 'duration') {
    if (!trimmed) return { ok: false, error: '需要数值' };
    const value = kind === 'integer' ? (/^[+-]?\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN) : Number(trimmed);
    if (!Number.isFinite(value)) return { ok: false, error: kind === 'integer' ? '需要整数' : '需要数值' };
    if (typeof def.min === 'number' && value < def.min) return { ok: false, error: `不能小于 ${def.min}` };
    if (typeof def.max === 'number' && value > def.max) return { ok: false, error: `不能大于 ${def.max}` };
    return { ok: true, value };
  }
  return { ok: false, error: '该参数不支持卡片内编辑' };
}

/** enum 选项：值与显示名成对给出，菜单与详情栏共用同一套标签。 */
export function paramEnumOptions(
  definition: ParamRowDefinition | null | undefined,
  label: (value: string) => string,
): Array<{ value: unknown; label: string }> {
  const values = Array.isArray(definition?.enum) ? definition!.enum! : [];
  return values.map((value) => ({ value, label: label(String(value)) }));
}

export type ParamEditorAction = 'binding-menu' | 'toggle' | 'enum-menu' | 'input' | 'inspector';

/**
 * 点击行内值区时该做什么：绑定变量 → 端口菜单；布尔 → 直接切换；
 * 枚举 → 选项菜单；数值/文本/时长/按键/颜色/坐标点 → 行内控件；资源与结构体 → 详情栏。
 */
export function paramEditorAction(pin: ParamRowLike): ParamEditorAction {
  if (pin.variable) return 'binding-menu';
  const kind = paramRowKind(pin.definition);
  if (kind === 'boolean') return 'toggle';
  if (kind === 'enum') return 'enum-menu';
  if (paramRowEditable(kind)) return 'input';
  return 'inspector';
}

/** 行内编辑器当前应显示的值：已配置优先，其次定义默认值。 */
export function paramEditorCurrentValue(pin: ParamRowLike): unknown {
  if (pin.configured) return pin.value;
  const definition = pin.definition || {};
  return Object.prototype.hasOwnProperty.call(definition, 'default') ? definition.default : undefined;
}

/** 世界坐标 → 视口坐标（行内浮层与画布共用同一套 pan/zoom）。 */
export function worldRectToScreen(
  rect: { x: number; y: number; width: number; height: number },
  view: { left: number; top: number; zoom: number; panX: number; panY: number },
): { left: number; top: number; width: number; height: number } {
  const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
  return {
    left: view.left + rect.x * zoom + view.panX,
    top: view.top + rect.y * zoom + view.panY,
    width: Math.max(88, rect.width * zoom),
    height: Math.max(18, rect.height * zoom),
  };
}