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

export type ParamRowKind = 'enum' | 'boolean' | 'integer' | 'number' | 'duration' | 'string' | 'key' | 'color' | 'point' | 'asset' | 'rect' | 'tuple' | 'complex';

/** 固定长度数组在卡片上最多拆成几个输入格（再多就回详情栏）：一格最多容纳三格。 */
export const PARAM_TUPLE_MAX = 3;

/** 能按元素行内编辑的标量类型：固定长度数组只有这些才拆成输入格。 */
const TUPLE_ITEM_KINDS: ReadonlySet<ParamRowKind> = new Set<ParamRowKind>([
  'enum', 'boolean', 'integer', 'number', 'duration', 'string', 'key', 'color', 'point',
]);

export interface ParamRowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParamRowGeometry {
  /** 行顶边（与上一行分隔线重合）。 */
  y: number;
  /** 行中心，引脚位置由它推导。 */
  centerY: number;
  portX: number;
  labelX: number;
  labelWidth: number;
  valueLeft: number;
  valueRight: number;
  valueWidth: number;
  /** 值区/整行的点击热区（世界坐标）。 */
  hit: ParamRowRect;
  /** 标签文字基线（单行样式下与 valueY 相同）。 */
  labelY: number;
  /** 值文字基线。 */
  valueY: number;
}

export interface ParamRowValueView {
  text: string;
  tone: 'bound' | 'literal' | 'default' | 'unset' | 'complex';
  title: string;
}

export type ParsedParamLiteral =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * 固定长度标量数组的元素个数：`min_items == max_items` 优先，其次看默认值的长度。
 * 返回 null 表示这是「长度不定的列表」，卡片上只给摘要、点击回详情栏。
 */
export function paramTupleLength(definition: ParamRowDefinition | null | undefined): number | null {
  const def = definition || {};
  if (def.type !== 'array') return null;
  const min = typeof def.min_items === 'number' ? def.min_items : null;
  const max = typeof def.max_items === 'number' ? def.max_items : null;
  const itemKind = paramRowKind(def.items);
  if (!TUPLE_ITEM_KINDS.has(itemKind)) return null;
  if (min !== null && max !== null) {
    return min === max && min >= 1 && min <= PARAM_TUPLE_MAX ? min : null;
  }
  if (min === null && max === null && Array.isArray(def.default)) {
    const length = def.default.length;
    return length >= 1 && length <= PARAM_TUPLE_MAX ? length : null;
  }
  return null;
}

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
  if (def.type === 'rect') return 'rect';
  if (def.type === 'asset' || def.type === 'path') return 'asset';
  if (def.type === 'array' && paramTupleLength(def) !== null) return 'tuple';
  return 'complex';
}

/**
 * 是否支持卡片内就地编辑。资源用素材浏览器/截图截取，区域用框选或四坐标输入，
 * 都在卡片上完成；只有真正无法在行内编辑的结构体（对象/数组）回详情栏。
 */
export function paramRowEditable(kind: ParamRowKind): boolean {
  return kind !== 'complex';
}

/**
 * 清单 `card.rows[].control` → 行内控件类型；未列出的 control 返回 null。
 * 卡片声明用它把「参数类型」与「用哪种控件」解耦（例如数组参数用区域框选）。
 */
const CONTROL_KINDS: Record<string, ParamRowKind> = {
  asset: 'asset',
  rect: 'rect',
  toggle: 'boolean',
  enum: 'enum',
  number: 'number',
  integer: 'integer',
  duration: 'duration',
  string: 'string',
  key: 'key',
  color: 'color',
  point: 'point',
  tuple: 'tuple',
  inspector: 'complex',
};

export function paramRowKindFromControl(control: unknown): ParamRowKind | null {
  const name = typeof control === 'string' ? control : '';
  return (name && CONTROL_KINDS[name]) || null;
}

/** 值区文字相对输入框的左右内边距（与 `.inline-param-editor` 的 border + padding 对齐）。 */
export const PARAM_FIELD_PADDING = 9;

/** 固定长度数组相邻输入格之间的间距（重叠时行内浮层用同一个值）。 */
export const PARAM_FIELD_GAP = 4;

/** 卡片值区的列数：每个值框占一列，于是「一格」= (整行 − 间距) / 列数。 */
export const PARAM_FIELD_COLUMNS = 2;

/**
 * 值输入格的宽度。卡片的值区是一套固定网格：每个值框占一格（(整行 − 间距) / 2），
 * 固定长度数组在**自己这一格**里再均分——整行宽度永远不超过一个值框。
 * 不做取整：小数宽度让「数组小格」和行内浮层的 flex 分格逐像素对齐。
 */
export function paramFieldWidth(rowWidth: number, columns: number = PARAM_FIELD_COLUMNS): number {
  const count = Math.max(1, Math.round(columns) || 1);
  return Math.max(24, (rowWidth - (count - 1) * PARAM_FIELD_GAP) / count);
}

/** 需要展开选择器/菜单/详情栏的行：卡片上给一个 `›` 提示，光标也换成手型。 */
export function paramRowOpensPicker(kind: ParamRowKind): boolean {
  return kind === 'asset' || kind === 'rect' || kind === 'enum' || kind === 'key' || kind === 'color' || kind === 'point' || kind === 'complex';
}

export function paramRowGeometry(options: {
  nodeWidth: number;
  baseHeight: number;
  rowHeight: number;
  index: number;
  pinX?: number;
  /** 双行行样式：标签一行、值一行（值行是可见的输入框/控件）。 */
  twoLine?: boolean;
}): ParamRowGeometry {
  const { nodeWidth, baseHeight, rowHeight, index } = options;
  const pinX = options.pinX ?? 10;
  const y = baseHeight + index * rowHeight;
  const valueRight = nodeWidth - 12;
  if (options.twoLine) {
    const labelX = pinX + 12;
    // 值行是一个可见的输入框/控件：行内浮层就贴在同一个矩形上，点上去像「框获得焦点」。
    return {
      y,
      centerY: y + rowHeight / 2,
      portX: pinX,
      labelX,
      labelWidth: Math.max(24, valueRight - labelX),
      valueLeft: labelX,
      valueRight,
      valueWidth: Math.max(24, valueRight - labelX),
      hit: { x: labelX, y: y + 19, width: paramFieldWidth(valueRight - labelX), height: 18 },
      // 标签在自己的 19px 带内视觉居中（字高 10 → 基线抬高 3.6px），与值框组成匀称的一对。
      labelY: y + 13,
      valueY: y + 31,
    };
  }
  const valueLeft = Math.round(nodeWidth * 0.46);
  const baseline = y + rowHeight / 2 + 4;
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
    labelY: baseline,
    valueY: baseline,
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

/** 区域：`[x, y, w, h]`；非法值返回空串。 */
export function paramRectParts(value: unknown): [number, number, number, number] | null {
  const list = Array.isArray(value) ? value : null;
  if (!list || list.length !== 4) return null;
  const parts = list.map((item) => (typeof item === 'number' ? item : Number(item)));
  if (parts.some((item) => !Number.isFinite(item))) return null;
  return [parts[0], parts[1], parts[2], parts[3]].map((item) => Math.round(item)) as [number, number, number, number];
}

/** 区域显示文本：`x,y 宽×高`（值框只有一格宽，逗号后不留空格）。 */
export function paramRectText(value: unknown): string {
  const rect = paramRectParts(value);
  if (!rect) return '';
  return `${rect[0]},${rect[1]} ${rect[2]}×${rect[3]}`;
}

/** 区域的完整文本（悬停提示用）：带空格更好读。 */
export function paramRectFullText(value: unknown): string {
  const rect = paramRectParts(value);
  if (!rect) return '';
  return `${rect[0]}, ${rect[1]} ${rect[2]}×${rect[3]}`;
}

/** 资源路径显示文本：卡片里只留文件名，完整路径放悬停提示。 */
export function paramAssetName(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  const parts = text.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || text;
}

/** 固定长度数组的元素类型（用于每个输入格的解析与显示）。 */
export function paramTupleItemKind(definition: ParamRowDefinition | null | undefined): ParamRowKind {
  return paramRowKind((definition || {}).items);
}

/** 一个输入格里的文字：标量按类型给可读形式，时长不带单位（单位在端点名里）。 */
export function paramTupleElementText(itemKind: ParamRowKind, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (itemKind === 'duration') {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? String(Number.isInteger(number) ? number : Math.round(number * 1000) / 1000) : String(value);
  }
  if (itemKind === 'point') return paramPointText(value);
  if (itemKind === 'color') return paramColorText(value);
  if (itemKind === 'key') return paramKeyText(value);
  if (itemKind === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return safeJson(value);
  return String(value);
}

/** 固定长度数组铺成 N 个输入格的当前值：缺元素补 undefined，多余的截掉。 */
export function paramTupleCells(definition: ParamRowDefinition | null | undefined, value: unknown): unknown[] {
  const length = paramTupleLength(definition) ?? 0;
  const list = Array.isArray(value) ? value : [];
  const cells: unknown[] = [];
  for (let index = 0; index < length; index += 1) cells.push(list[index]);
  return cells;
}

/** 固定长度数组的整行文本：元素逐个显示（`0.2, 0.6`）。 */
export function paramTupleText(definition: ParamRowDefinition | null | undefined, value: unknown): string {
  const itemKind = paramTupleItemKind(definition);
  const cells = paramTupleCells(definition, value);
  if (!cells.length) return '';
  return cells.map((cell) => paramTupleElementText(itemKind, cell) || '—').join(', ');
}

/** 值文本：按类型给出可读形式（数值/文本回落到 compact）。 */
function paramValueText(kind: ParamRowKind, value: unknown, compact: (value: unknown, max?: number) => string, definition?: ParamRowDefinition | null): string {
  if (kind === 'point') return paramPointText(value);
  if (kind === 'duration') return paramDurationText(value);
  if (kind === 'rect') return paramRectText(value);
  if (kind === 'tuple') return paramTupleText(definition, value);
  if (kind === 'asset') return paramAssetName(value);
  if (kind === 'color') return compact(paramColorText(value) || '未设置', 18);
  if (kind === 'key') return compact(paramKeyText(value) || '未设置', 18);
  return compact(value, 18);
}

/** 值的完整文本（悬停提示用）。 */
export function paramValueFullText(kind: ParamRowKind, value: unknown, definition?: ParamRowDefinition | null): string {
  if (kind === 'point') return paramPointText(value);
  if (kind === 'duration') return `${paramDurationText(value)}（秒）`;
  if (kind === 'rect') return paramRectFullText(value) || '未设置';
  if (kind === 'tuple') return paramTupleText(definition, value) || '未设置';
  if (kind === 'asset') return typeof value === 'string' ? value : safeJson(value);
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
  const kind = paramRowKindOf(row, definition);
  // 绑定值（变量或节点输出引用）都用同一个「已绑定」样式；显示名由调用方给出。
  const boundRef = !row.variable && row.value && typeof row.value === 'object' && !Array.isArray(row.value)
    && typeof (row.value as { ref?: unknown }).ref === 'string'
    ? String((row.value as { ref: string }).ref)
    : '';
  if (row.variable || boundRef) {
    return {
      text: `← ${variableName || row.variable || boundRef}`,
      tone: 'bound',
      title: row.variable ? `${param}：绑定 ${row.scope}.${row.variable}` : `${param}：引用 ${variableName ? `${variableName}（${boundRef}）` : boundRef}`,
    };
  }
  const configured = row.configured === true || (row.configured === undefined && row.value !== undefined);
  if (configured) {
    if (kind === 'complex') {
      const summary = paramRowComplexSummary(row.value);
      return { text: summary, tone: 'complex', title: `${param} = ${safeJson(row.value)}（点击在详情栏编辑）` };
    }
    if (kind === 'asset') {
      return { text: compact(paramAssetName(row.value) || '未设置', 26), tone: 'complex', title: `${param} = ${String(row.value ?? '')}（点击选择模板图）` };
    }
    if (kind === 'rect' && !paramRectParts(row.value)) {
      return { text: compact(row.value, 26), tone: 'complex', title: `${param} = ${safeJson(row.value)}（点击框选或手输四坐标）` };
    }
    return { text: paramValueText(kind, row.value, compact, definition), tone: 'literal', title: `${param} = ${paramValueFullText(kind, row.value, definition)}` };
  }
  if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
    const fallback = definition.default;
    const text = kind === 'complex' ? paramRowComplexSummary(fallback) : paramValueText(kind, fallback, compact, definition);
    const shown = kind === 'rect' ? (paramRectText(fallback) || '未设置') : text;
    return { text: shown, tone: 'default', title: `${param}：默认值 ${paramValueFullText(kind, fallback, definition)}（点击编辑）` };
  }
  return { text: '未设置', tone: 'unset', title: `${param}：未设置（点击编辑）` };
}

/**
 * 行的控件类型：卡片声明的显式 control 优先，否则按参数定义推断。
 * 卡片行会带上 `control` 字段（见 canvas-workflow-model 的端点构造）。
 */
export function paramRowKindOf(row: ParamRowLike, definition: ParamRowDefinition | null | undefined): ParamRowKind {
  const control = typeof row.control === 'string' ? row.control : '';
  return (control && paramRowKindFromControl(control)) || paramRowKind(definition);
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
export function paramLiteralText(kind: ParamRowKind, value: unknown, definition?: ParamRowDefinition | null): string {
  if (value === undefined || value === null) return '';
  if (kind === 'boolean') return value ? 'true' : 'false';
  if (kind === 'point') return paramPointText(value);
  if (kind === 'rect') {
    const rect = paramRectParts(value);
    return rect ? rect.join(', ') : '';
  }
  if (kind === 'tuple') return paramTupleText(definition, value);
  if (kind === 'color') return paramColorText(value);
  if (kind === 'key') return paramKeyText(value);
  if (kind === 'duration') return typeof value === 'number' ? String(value) : String(Number(value));
  if (kind === 'complex' || kind === 'asset') return typeof value === 'string' ? value : safeJson(value);
  return String(value);
}

/**
 * 固定长度数组的整行提交：每个输入格按元素类型单独校验，任一格非法就整行不写入。
 * `texts` 是各格的文本，顺序与卡片上的输入格一致。
 */
export function parseParamTuple(
  definition: ParamRowDefinition | null | undefined,
  texts: unknown[],
): ParsedParamLiteral {
  const def = definition || {};
  const length = paramTupleLength(def) ?? texts.length;
  if (texts.length !== length) return { ok: false, error: `需要 ${length} 个数值` };
  const itemKind = paramTupleItemKind(def);
  const itemDefinition: ParamRowDefinition = { ...(def.items || {}), type: (def.items || {}).type || 'string' };
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const parsed = parseParamLiteral(itemKind, String(texts[index] ?? ''), itemDefinition);
    if (!parsed.ok) return { ok: false, error: `第 ${index + 1} 项：${parsed.error}` };
    values.push(parsed.value);
  }
  return { ok: true, value: values };
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
  if (kind === 'rect') {
    // 接受 "x, y, 宽, 高"、"[x y w h]" 与 "w×h" 写法；x/X 留给数值解析（不能当分隔符）。
    const parts = trimmed.replace(/[()\[\]]/g, ' ').replace(/[×*]/g, ' ').split(/[\s,;]+/).filter(Boolean);
    if (parts.length !== 4) return { ok: false, error: '需要四个数值：x, y, 宽, 高' };
    const values = parts.map((part) => Number(part));
    if (values.some((item) => !Number.isFinite(item))) return { ok: false, error: '区域需要数值' };
    if (values[2] < 0 || values[3] < 0) return { ok: false, error: '区域宽高不能为负' };
    return { ok: true, value: values.map((item) => Math.round(item)) };
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

export type ParamEditorAction = 'binding-menu' | 'toggle' | 'enum-menu' | 'input' | 'asset-menu' | 'roi-menu' | 'inspector';

/**
 * 点击行内值区时该做什么：绑定变量 → 端口菜单；布尔 → 直接切换；
 * 枚举 → 选项菜单；数值/文本/时长/按键/颜色/坐标点/区域 → 行内控件；
 * 资源 → 素材浏览器与截图截取菜单；结构体 → 详情栏。
 */
export function paramEditorAction(pin: ParamRowLike): ParamEditorAction {
  if (pin.variable) return 'binding-menu';
  const kind = paramRowKindOf(pin, pin.definition || {});
  if (kind === 'boolean') return 'toggle';
  if (kind === 'enum') return 'enum-menu';
  if (kind === 'asset') return 'asset-menu';
  if (kind === 'rect') return 'roi-menu';
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