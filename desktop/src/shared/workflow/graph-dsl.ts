/**
 * v6 工作流文本格式（`.owf`）的解析、序列化与规范化。
 *
 * 这是 Python `src/oooonmyoji/workflows/dsl`（`errors.py` / `values.py` / `expr.py` /
 * `document.py` / `convert.py`）的**逐语义移植**：权威语法在 `docs/workflow-dsl-v6.md`，
 * 两端必须写出同一份文本、解析出同一棵树。两条不变量：
 *
 * 1. `parseDocument(emitDocument(doc))` 与 `normalizeDocument(doc)` 深等
 *    （规范化只做有语义无损的三件事：`then` 收敛成 `then.0`、`and`/`or` 扁平化、
 *    删掉空的 `edges`/`groups`/`comments` 与空 `waypoints`；**边的顺序不动**）；
 * 2. `emitDocument(parseDocument(text)) === text`：emit 产出的文本是不动点。
 *
 * 解析产出与图文档（`schemas_version` 6）同形，`graph-document.ts` 的检查与编译链路
 * 直接吃它，运行时零改动。
 */
import { GRAPH_SCHEMA_VERSION, toGraphDocument } from './graph-document';

/** 工作流文档的磁盘后缀。磁盘上只有这一种格式，JSON 已退役。 */
export const WORKFLOW_SUFFIX = '.owf';

/** 落盘文本解析出来的文档版本。与图文档 schema 版本是同一个数（`.owf` 就是格式标记）。 */
export const DOCUMENT_SCHEMA_VERSION = GRAPH_SCHEMA_VERSION;

/** 每层缩进的空格数。 */
export const INDENT = 2;

/** 行内列表整行超过这个长度就换块写（人读得下去的宽度）。 */
export const INLINE_WIDTH = 96;

/** 连线里省略源引脚时的默认口位（`then` 的规范写法就是 `then.0`）。 */
const DEFAULT_EXEC_OUT_PIN = 'then.0';
/** 执行流出口的「别名」写法（与 `src/oooonmyoji/workflows/graph_schema.py` 一致）。 */
const EXEC_OUT_PIN = 'then';
/** 执行流入口的默认口位。 */
const EXEC_IN_PIN = 'in';

/** 位置类字段：`[x, y]` ⇄ `{"x": …, "y": …}`。 */
const POSITION_KEYS = ['at', 'interfaceAt', 'variablesAt'];
/** 尺寸类字段：`[w, h]` ⇄ `{"w": …, "h": …}`。 */
const SIZE_KEYS = ['size'];

/** 文档头里按固定顺序输出的键。 */
const HEADER_ORDER = ['version', 'description', 'resolution', 'root', 'retry_safe', 'limits'];
/** 通用块形式的顶层键（输入/变量/自定义类型定义）。 */
const CONTAINER_ORDER = ['inputs', 'variables', 'nodeTypes'];
/** 结构关键字：不是文档字段，而是 `nodes` / `groups` / `comments` 的入口。 */
const STRUCTURAL_TOP_KEYS = ['id', 'schema_version', 'nodes', 'edges', 'groups', 'comments', 'workflow'];

/** 节点块内的固定输出顺序（其余字段照文档顺序跟在后面）。 */
const NODE_KEY_ORDER = [
  'at',
  'size',
  'locked',
  'comment',
  'action',
  'params',
  'expression',
  'condition',
  'conditions',
  'cases',
  'decorators',
  'runs',
  'wait_for',
  'cancel_on_failure',
  'finish_mode',
  'max_iterations',
  'ref',
  'fields',
];

/** 表达式字段：值写同一行是中缀，写子块是操作数对象。 */
const EXPRESSION_KEYS = ['expression', 'condition'];

/** 编辑形态（v4）的结构字段：落到写盘口说明调用方漏了 `toGraphDocument`。 */
const EDIT_FORM_FIELDS = ['children', 'ports', 'default_child'];

// --------------------------------------------------------------------------------------
// 小工具（与 Python 的内建行为对齐）
// --------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 写一个键。
 *
 * `__proto__` 走 `defineProperty`：文档里的键名来自文件，不能让它去改原型，
 * 也不能悄悄丢字段（`Object.hasOwn` 的重复键检查要看得见它）。
 */
function setKey(target: Record<string, any>, key: string, value: any): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    return;
  }
  target[key] = value;
}

/** 单键对象（表达式节点）：键名同样可能是 `__proto__`。 */
function oneKeyDict(key: string, value: any): Record<string, any> {
  const result: Record<string, any> = {};
  setKey(result, key, value);
  return result;
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) setKey(out, key, deepClone(child));
    return out as unknown as T;
  }
  return value;
}

/** Python 的 `str.isspace()` 认的空白（比 JS 的 `\s` 多 `\x1c`–`\x1f` 与 `\x85`）。 */
const PY_SPACE = ' \\t\\n\\r\\v\\f\\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP_END = new RegExp(`[${PY_SPACE}]+$`);
const STRIP_START = new RegExp(`^[${PY_SPACE}]+`);

/** Python 的 `str.strip()`。 */
function pyStrip(text: string): string {
  return text.replace(STRIP_START, '').replace(STRIP_END, '');
}

/** Python 的 `str.lstrip()`。 */
function lstripWs(text: string): string {
  return text.replace(STRIP_START, '');
}

/** Python 的 `str.rstrip()`。 */
function rstripWs(text: string): string {
  return text.replace(STRIP_END, '');
}

/** Python 的 `str.splitlines()`（含 `\r`、`\r\n`、`\v`、`\f` 与几个 Unicode 换行）。 */
function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\u001c\u001d\u001e\u0085\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 报错文案里的 Python `repr()`（只求可读，不求逐字）。 */
function pyRepr(value: any): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => pyRepr(item)).join(', ')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .map(([key, child]) => `${pyRepr(key)}: ${pyRepr(child)}`)
      .join(', ')}}`;
  }
  return String(value);
}

/** 数字（布尔不算）：坐标是不是整数留给 schema 与编译期报，不在语法层拦。 */
function isNumber(value: any): value is number {
  return typeof value === 'number';
}

/**
 * Python 的真值判断：空的列表/对象/字符串、`0`、`null`、`false`、`NaN` 都是假。
 *
 * 序列化器里逐字用 Python 的 `if value:` 写，不能换成 JS 的真值（`[]` 与 `{}` 在 JS 里是真的，
 * 于是 `waypoints: []` 会被多写一行、`inputs: []` 会被写成 `inputs: []` —— Python 都不写）。
 */
function pyTruthy(value: any): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  return true;
}

/** Python 的 `for item in value`：空值给空，`dict` 遍历键，字符串遍历字符。 */
function pyIterable(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (!pyTruthy(value)) return [];
  if (typeof value === 'string') return value.split('');
  if (isRecord(value)) return Object.keys(value);
  return [];
}

// --------------------------------------------------------------------------------------
// 错误
// --------------------------------------------------------------------------------------

export interface DslErrorOptions {
  line?: number | null;
  column?: number | null;
  source?: string | null;
  path?: string | null;
  hint?: string | null;
}

/** 文本格式的解析或序列化错误：带行号、列号与原文行。 */
export class DslError extends Error {
  readonly line: number | null;
  readonly column: number | null;
  readonly source: string | null;
  readonly path: string | null;
  readonly hint: string | null;

  constructor(message: string, options: DslErrorOptions = {}) {
    super(message);
    this.name = 'DslError';
    this.line = options.line ?? null;
    this.column = options.column ?? null;
    this.source = options.source ?? null;
    this.path = options.path ?? null;
    this.hint = options.hint ?? null;
  }

  /** 与 Python `DslError.render()` 同形的多行信息：定位头、原文行、插入符、提示。 */
  render(): string {
    const where = this.path || '<text>';
    const head =
      this.line === null
        ? `${where}: ${this.message}`
        : `${where}:${this.line}:${this.column || 1}: ${this.message}`;
    const parts = [head];
    if (this.source !== null) {
      parts.push(`  ${String(this.line).padStart(4)} | ${this.source}`);
      if (this.column) parts.push(`       | ${' '.repeat(Math.max(0, this.column - 1))}^`);
    }
    if (this.hint) parts.push(`  提示：${this.hint}`);
    return parts.join('\n');
  }

  override toString(): string {
    return this.render();
  }
}

/** 一行原文，用于把错误定位到具体的列。 */
export class SourceLine {
  readonly path: string | null;
  readonly number: number;
  readonly text: string;

  constructor(path: string | null, number: number, text: string) {
    this.path = path;
    this.number = number;
    this.text = text;
  }

  error(message: string, column = 1, hint?: string | null): DslError {
    return new DslError(message, {
      line: this.number,
      column: Math.max(1, column),
      source: this.text,
      path: this.path,
      hint: hint ?? null,
    });
  }
}

// --------------------------------------------------------------------------------------
// 标量与行内值（values.py）
// --------------------------------------------------------------------------------------

const INT_RE = /^-?[0-9]+$/;
// 浮点：允许科学计数法（Python `repr` 对很小的数会写成 `1e-20`，不支持就等于静默丢数据）。
const FLOAT_RE = /^-?(?:[0-9]+\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?$/;

/** 裸词里不允许出现的字符：空白、注释符 `#`、引号与所有分隔符。 */
const BARE_STOP = new Set(' \t\r\n#",:[]{}'.split(''));

/** 引用前缀：这三个作用域开头的裸词是引用而不是字符串。 */
const REF_PREFIXES = ['nodes.', 'inputs.', 'variables.'];

const ESCAPES = new Map<string, string>([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['"', '"'],
  ['\\', '\\'],
]);

/** 这个裸词是不是引用（`nodes.` / `inputs.` / `variables.` 开头）。 */
export function isRefToken(token: string): boolean {
  return REF_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/** 裸词的归类：`int` / `float` / `bool` / `null` / `ref` / `string`。 */
export function tokenKind(token: string): string {
  if (INT_RE.test(token)) return 'int';
  if (FLOAT_RE.test(token)) return 'float';
  if (token === 'true' || token === 'false') return 'bool';
  if (token === 'null') return 'null';
  if (isRefToken(token)) return 'ref';
  return 'string';
}

/** 裸词 → 值。整数与浮点不做归一化（`1` 与 `1.0` 是两个不同的写法）。 */
export function parseToken(token: string, line: SourceLine, column: number): any {
  const kind = tokenKind(token);
  if (kind === 'int') return Number.parseInt(token, 10);
  if (kind === 'float') return Number.parseFloat(token);
  if (kind === 'bool') return token === 'true';
  if (kind === 'null') return null;
  if (kind === 'ref') return { ref: token };
  for (const char of token) {
    if (BARE_STOP.has(char)) {
      throw line.error(`裸词里不能出现 ${pyRepr(char)}；含空格或分隔符的字符串请加引号`, column + token.indexOf(char));
    }
  }
  return token;
}

/** 从 `text[start] === '"'` 开始解析一个带转义的字符串，返回 [值, 结束下标]。 */
export function parseQuoted(text: string, start: number, line: SourceLine): [string, number] {
  let out = '';
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      if (index + 1 >= text.length) throw line.error('转义符后面没有字符', index + 1);
      const escape = text[index + 1];
      if (!ESCAPES.has(escape)) {
        throw line.error(`不支持的转义 \\${escape}`, index + 1, '支持 \\n \\t \\r \\" \\\\');
      }
      out += ESCAPES.get(escape);
      index += 2;
      continue;
    }
    if (char === '"') return [out, index + 1];
    out += char;
    index += 1;
  }
  throw line.error('字符串没有闭合的引号', start + 1);
}

export interface InlineElement {
  text: string;
  column: number;
}

/** 按顶层逗号/空白切开行内列表体（引号与括号里的分隔符不算）。 */
export function splitElements(body: string, line: SourceLine, offset: number): InlineElement[] {
  const elements: InlineElement[] = [];
  let depth = 0;
  let start: number | null = null;
  let index = 0;
  let quoted = false;
  while (index < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      if (start === null) start = index;
      index += 1;
      continue;
    }
    if (char === '[' || char === '{') {
      depth += 1;
      if (start === null) start = index;
      index += 1;
      continue;
    }
    if (char === ']' || char === '}') {
      depth -= 1;
      if (depth < 0) throw line.error('括号不匹配', offset + index + 1);
      index += 1;
      continue;
    }
    if (depth === 0 && (char === ',' || char === ' ' || char === '\t')) {
      if (start !== null) {
        elements.push({ text: body.slice(start, index), column: offset + start });
        start = null;
      }
      index += 1;
      continue;
    }
    if (start === null) start = index;
    index += 1;
  }
  if (quoted) throw line.error('字符串没有闭合的引号', offset + body.length);
  if (depth !== 0) throw line.error('括号不匹配', offset + body.length);
  if (start !== null) elements.push({ text: body.slice(start), column: offset + start });
  return elements;
}

/**
 * 只按**逗号**切开（空白保留在元素里）：表达式不能把空格当分隔符。
 *
 * `[a == 1, b == 2]` 里的 `a == 1` 是一整项；表达式文法里没有逗号，所以按逗号切无歧义。
 */
export function splitCommas(body: string, line: SourceLine, offset: number): InlineElement[] {
  const elements: InlineElement[] = [];
  let start: number | null = null;
  let index = 0;
  let quoted = false;
  while (index < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      if (start === null) start = index;
      index += 1;
      continue;
    }
    if (char === ',') {
      if (start !== null) {
        elements.push({ text: pyStrip(body.slice(start, index)), column: offset + start });
        start = null;
      }
      index += 1;
      continue;
    }
    if (start === null && !/\s/.test(char)) start = index;
    index += 1;
  }
  if (quoted) throw line.error('字符串没有闭合的引号', offset + body.length);
  if (start !== null) elements.push({ text: pyStrip(body.slice(start)), column: offset + start });
  return elements.filter((element) => element.text);
}

/** 解析一段行内值：标量 / 引用 / `[…]` / `{}` / `[]`。 */
export function parseInline(text: string, line: SourceLine, offset = 1): any {
  const stripped = pyStrip(text);
  if (!stripped) throw line.error('缺少值', offset + text.length);
  const column = offset + text.indexOf(stripped[0]);
  if (stripped === '{}') return {};
  if (stripped === '[]') return [];
  if (stripped.startsWith('[')) {
    if (!stripped.endsWith(']')) throw line.error('行内列表缺少右括号 ]', column);
    const inner = stripped.slice(1, -1);
    if (!pyStrip(inner)) return [];
    return splitElements(inner, line, column + 1).map((element) => parseInline(element.text, line, element.column));
  }
  if (stripped.startsWith('{')) {
    throw line.error('行内对象只支持空对象 {}', column, '非空对象写成子块：键: 后换行缩进');
  }
  if (stripped.startsWith('"')) {
    const [value, end] = parseQuoted(stripped, 0, line);
    if (pyStrip(stripped.slice(end))) throw line.error('字符串后面还有多余内容', column + end);
    return value;
  }
  return parseToken(stripped, line, column);
}

/** 这个文本能不能当裸词写（键、id、引脚、引用）：没有分隔符、不以 `-` 开头。 */
export function isBareWord(text: string): boolean {
  if (!text || text[0] === '-') return false;
  for (const char of text) if (BARE_STOP.has(char)) return false;
  return true;
}

/**
 * 解析一个「一定是字符串」的记号：引号字符串，或没有任何分隔符的裸词。
 *
 * 用于键、id、类型名、引脚、显示名、版本号这类**标识符**：它们不该被当成数字或引用。
 */
export function parseText(text: string, line: SourceLine, column = 1): string {
  const stripped = pyStrip(text);
  if (!stripped) throw line.error('缺少内容', column);
  if (stripped.startsWith('"')) {
    const [value, end] = parseQuoted(stripped, 0, line);
    if (pyStrip(stripped.slice(end))) throw line.error('字符串后面还有多余内容', column + end);
    return value;
  }
  for (const char of stripped) {
    if (BARE_STOP.has(char)) {
      throw line.error(`裸词里不能出现 ${pyRepr(char)}；要写这种内容请加引号`, column + stripped.indexOf(char));
    }
  }
  return stripped;
}

/** 标识符（键、id、类型名、引脚）→ 文本：只要没有分隔符就裸写。 */
export function renderIdentifier(value: string): string {
  return isBareWord(value) ? value : quoteString(value);
}

/** 按需转义后加上引号。 */
export function quoteString(value: string): string {
  let out = '"';
  for (const char of value) {
    if (char === '\\') out += '\\\\';
    else if (char === '"') out += '\\"';
    else if (char === '\n') out += '\\n';
    else if (char === '\t') out += '\\t';
    else if (char === '\r') out += '\\r';
    else out += char;
  }
  return `${out}"`;
}

/** 这个字符串能不能裸写。 */
export function needsQuote(value: string): boolean {
  if (!value) return true;
  if (value[0] === '-') return true;
  for (const char of value) if (BARE_STOP.has(char)) return true;
  return tokenKind(value) !== 'string';
}

const EXPR_KEYWORDS = new Set(['and', 'or', 'not', 'contains', 'exists']);

/** 字符串 → 文本。表达式里 `and` / `or` 这类关键字必须加引号，否则会被当成运算符。 */
export function renderScalar(value: string, options: { expression?: boolean } = {}): string {
  if (needsQuote(value) || (options.expression && EXPR_KEYWORDS.has(value))) return quoteString(value);
  return value;
}

/** 最短往返的十进制位数与指数（value = digits × 10^(exp - digits.length + 1)）。 */
function decimalDigits(value: number): { sign: string; digits: string; exp: number } {
  const text = Math.abs(value).toExponential();
  const [mantissa, exponent] = text.split('e');
  return {
    sign: value < 0 ? '-' : '',
    digits: mantissa.replace('.', ''),
    exp: Number.parseInt(exponent, 10),
  };
}

/** 十进制展开（不带指数），用于 `toFixed` 也拿不到指数的极大值。 */
function plainDecimal(value: number): string {
  const { sign, digits, exp } = decimalDigits(value);
  if (exp >= 0) {
    const integer =
      digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits + '0'.repeat(exp + 1 - digits.length);
    const fraction = digits.length > exp + 1 ? digits.slice(exp + 1) : '';
    return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
  }
  return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
}

/** Python `repr(float)`：最短往返，指数阈值（decpt <= -4 或 > 16）也一致。 */
function pythonReprFloat(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (value === Number.POSITIVE_INFINITY) return 'inf';
  if (value === Number.NEGATIVE_INFINITY) return '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const { sign, digits, exp } = decimalDigits(value);
  if (exp <= -5 || exp >= 16) {
    const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${mantissa}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  if (exp >= 0) {
    const integer =
      digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits + '0'.repeat(exp + 1 - digits.length);
    const fraction = digits.length > exp + 1 ? digits.slice(exp + 1) : '0';
    return `${sign}${integer}.${fraction}`;
  }
  return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
}

/**
 * 浮点 → 文本：用最短往返表示（与 Python `repr(float)` 对齐）。
 *
 * **指数形式必须照原样写**：早先按 Python 的 `%.17f` 展开再剪尾零，会把 `1e-20` 写成 `0.0`，
 * 那是静默丢数据。数字文法因此支持科学计数法。
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const text = pythonReprFloat(value);
  if (Number(text) !== value) return String(value); // 兜底：理论上不会发生
  return text;
}

/** 数字 → 文本：整数不带小数点，浮点走 `formatNumber`（与 Python 的 int/float 分支一致）。 */
function renderNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) {
    const text = String(value);
    return /[eE]/.test(text) ? plainDecimal(value) : text;
  }
  return formatNumber(value);
}

/** 把值渲染成一行文本；做不到（非空对象、太长、嵌套太深）返回 `null`。 */
export function renderInline(value: any, options: { expression?: boolean } = {}): string | null {
  const expression = options.expression ?? false;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return renderNumber(value);
  if (typeof value === 'string') return renderScalar(value, { expression });
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    if (keys.length === 1 && keys[0] === 'ref' && typeof value.ref === 'string') {
      const ref: string = value.ref;
      return isRefToken(ref) && isBareWord(ref) ? ref : null;
    }
    return null;
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const parts: string[] = [];
    for (const item of value) {
      const text = renderInline(item, { expression });
      if (text === null) return null;
      parts.push(text);
    }
    const joined = `[${parts.join(', ')}]`;
    return joined.length <= INLINE_WIDTH ? joined : null;
  }
  return null;
}

/** 多行字符串 → `|` 文本块的正文行。 */
export function renderStringBlock(value: string): string[] {
  return value.split('\n');
}

// --------------------------------------------------------------------------------------
// 表达式（expr.py）
// --------------------------------------------------------------------------------------

/** 中缀符号 → 运行时运算符。 */
const COMPARISONS = new Map<string, string>([
  ['==', 'eq'],
  ['!=', 'ne'],
  ['>', 'gt'],
  ['>=', 'gte'],
  ['<', 'lt'],
  ['<=', 'lte'],
  ['contains', 'contains'],
]);

const ARITY_TWO = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains']);

/** 认得出来的运算符全集：其余单键对象（`{"ref": …}`）是原子而不是表达式。 */
const KNOWN_OPERATORS = new Set<string>([...ARITY_TWO, 'and', 'or', 'not', 'exists']);

/** 渲染时的优先级：or < and < not/exists < 比较 < 原子。 */
const PRECEDENCE: Record<string, number> = { or: 1, and: 2, not: 3, exists: 3 };
const COMPARISON_PRECEDENCE = 4;

const WORD_STOP = new Set(' \t()"=!<>'.split(''));

/** 记号：`lp`/`rp` 括号、`op` 比较符、`kw` 关键字、`literal` 字面量。 */
export interface Token {
  kind: 'lp' | 'rp' | 'op' | 'kw' | 'literal';
  value: any;
  column: number;
}

/** 把一段中缀文本切成记号。 */
export function tokenize(text: string, line: SourceLine, offset = 1): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === ' ' || char === '\t') {
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'lp', value: '(', column: offset + index });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rp', value: ')', column: offset + index });
      index += 1;
      continue;
    }
    if (char === '"') {
      const [value, end] = parseQuoted(text, index, line);
      tokens.push({ kind: 'literal', value, column: offset + index });
      index = end;
      continue;
    }
    let matched: string | null = null;
    for (const symbol of ['==', '!=', '>=', '<=', '>', '<']) {
      if (text.startsWith(symbol, index)) {
        matched = symbol;
        break;
      }
    }
    if (matched !== null) {
      tokens.push({ kind: 'op', value: matched, column: offset + index });
      index += matched.length;
      continue;
    }
    if (char === '=' || char === '!') {
      throw line.error('比较要写 == / !=（单个 = 不是运算符）', offset + index, '等于：a == b；不等于：a != b');
    }
    let end = index;
    while (end < text.length && !WORD_STOP.has(text[end])) end += 1;
    const word = text.slice(index, end);
    if (!word) throw line.error(`表达式里读不懂的字符 ${pyRepr(char)}`, offset + index);
    if (word === 'contains') {
      tokens.push({ kind: 'op', value: 'contains', column: offset + index });
    } else if (word === 'and' || word === 'or' || word === 'not' || word === 'exists') {
      tokens.push({ kind: 'kw', value: word, column: offset + index });
    } else {
      tokens.push({ kind: 'literal', value: parseToken(word, line, offset + index), column: offset + index });
    }
    index = end;
  }
  return tokens;
}

class ExpressionParser {
  private index = 0;

  constructor(private readonly tokens: Token[], private readonly line: SourceLine) {}

  private peek(): Token | null {
    return this.index < this.tokens.length ? this.tokens[this.index] : null;
  }

  private take(): Token {
    const token = this.peek();
    if (token === null) throw this.line.error('表达式没有写完', this.line.text.length + 1);
    this.index += 1;
    return token;
  }

  private matchKeyword(word: string): boolean {
    const token = this.peek();
    if (token !== null && token.kind === 'kw' && token.value === word) {
      this.index += 1;
      return true;
    }
    return false;
  }

  parse(): any {
    const node = this.parseOr();
    const leftover = this.peek();
    if (leftover !== null) {
      throw this.line.error(`表达式里有多余的内容 ${pyRepr(leftover.value)}`, leftover.column);
    }
    return node;
  }

  private parseOr(): any {
    const items = [this.parseAnd()];
    while (this.matchKeyword('or')) items.push(this.parseAnd());
    return items.length === 1 ? items[0] : { or: items };
  }

  private parseAnd(): any {
    const items = [this.parseNot()];
    while (this.matchKeyword('and')) items.push(this.parseNot());
    return items.length === 1 ? items[0] : { and: items };
  }

  private parseNot(): any {
    if (this.matchKeyword('not')) return { not: this.parseNot() };
    if (this.matchKeyword('exists')) {
      const operand = this.parseOperand();
      if (!(isRecord(operand) && Object.keys(operand).length === 1 && Object.hasOwn(operand, 'ref'))) {
        throw this.line.error('exists 的操作数必须是一条引用（nodes.x.output.y）', 1);
      }
      return { exists: operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): any {
    const left = this.parseOperand();
    const token = this.peek();
    if (token === null || token.kind !== 'op') return left;
    this.index += 1;
    const right = this.parseOperand();
    const chained = this.peek();
    if (chained !== null && chained.kind === 'op') {
      throw this.line.error('表达式不支持链式比较', chained.column, '写成 a < b and b < c');
    }
    return oneKeyDict(COMPARISONS.get(token.value) as string, [left, right]);
  }

  private parseOperand(): any {
    const token = this.take();
    if (token.kind === 'lp') {
      const node = this.parseOr();
      const closing = this.peek();
      if (closing === null || closing.kind !== 'rp') throw this.line.error('括号没有闭合', token.column);
      this.index += 1;
      return node;
    }
    if (token.kind === 'literal') return token.value;
    throw this.line.error(`表达式的操作数位置出现了 ${pyRepr(token.value)}`, token.column);
  }
}

/**
 * 中缀文本 → 运行时的操作数对象。
 *
 * `line` / `offset` 与 Python 同形（内部调用传原文行以定位错误）；只给一段文本时
 * 错误信息里的行号是 1、列号按文本内位置算。
 */
export function parseExpression(text: string, line: SourceLine | null = null, offset = 1): any {
  const source = line ?? new SourceLine(null, 1, text);
  return new ExpressionParser(tokenize(text, source, offset), source).parse();
}

function wrap(text: string, precedence: number, parentPrecedence: number): string {
  return precedence < parentPrecedence ? `(${text})` : text;
}

/** 操作数对象 → 中缀文本；表示不了（未知运算符、元数不对）返回 `null`。 */
function renderNode(node: any, parentPrecedence: number): string | null {
  // 单键对象里只有认得出来的运算符才算表达式，其余（典型的 {"ref": …}）当原子。
  if (isRecord(node) && Object.keys(node).length === 1 && KNOWN_OPERATORS.has(Object.keys(node)[0])) {
    const operator = Object.keys(node)[0];
    const operands = node[operator];
    if (ARITY_TWO.has(operator)) {
      if (!Array.isArray(operands) || operands.length !== 2) return null;
      const left = renderNode(operands[0], COMPARISON_PRECEDENCE);
      const right = renderNode(operands[1], COMPARISON_PRECEDENCE);
      if (left === null || right === null) return null;
      let symbol: string | null = null;
      for (const [key, value] of COMPARISONS) {
        if (value === operator) {
          symbol = key;
          break;
        }
      }
      if (symbol === null) return null;
      return wrap(`${left} ${symbol} ${right}`, COMPARISON_PRECEDENCE, parentPrecedence);
    }
    if (operator === 'and' || operator === 'or') {
      if (!Array.isArray(operands) || operands.length < 2) return null;
      const parts = operands.map((item: any) => renderNode(item, PRECEDENCE[operator]));
      if (parts.some((part: string | null) => part === null)) return null;
      const joiner = operator === 'and' ? ' and ' : ' or ';
      return wrap((parts as string[]).join(joiner), PRECEDENCE[operator], parentPrecedence);
    }
    if (operator === 'not') {
      const inner = renderNode(operands, PRECEDENCE.not);
      if (inner === null) return null;
      return wrap(`not ${inner}`, PRECEDENCE.not, parentPrecedence);
    }
    if (operator === 'exists') {
      if (!(isRecord(operands) && Object.keys(operands).length === 1 && Object.hasOwn(operands, 'ref'))) return null;
      const reference = renderInline(operands);
      if (reference === null) return null;
      return wrap(`exists ${reference}`, PRECEDENCE.exists, parentPrecedence);
    }
    return null;
  }
  return renderInline(node, { expression: true });
}

/** 操作数对象 → 中缀文本（规范形式）；表示不了返回 `null`（调用方回退到块写法）。 */
export function renderExpression(node: any): string | null {
  return renderNode(node, 0);
}

// --------------------------------------------------------------------------------------
// 解析器（document.py）
// --------------------------------------------------------------------------------------

/** 一条已经去掉注释、缩进算好的行。 */
class Entry {
  constructor(
    readonly indent: number,
    readonly body: string,
    readonly column: number,
    readonly line: SourceLine,
  ) {}
}

/** `#` 到行尾（引号内不算）。 */
function stripComment(raw: string): string {
  let quoted = false;
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (quoted) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === '#') {
      return raw.slice(0, index);
    }
    index += 1;
  }
  return raw;
}

/** 行内第一个引号外的冒号下标；没有返回 -1。 */
function findColon(body: string): number {
  let quoted = false;
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ':') {
      return index;
    }
    index += 1;
  }
  return -1;
}

function isItem(body: string): boolean {
  return body === '-' || body.startsWith('- ');
}

/** 行内第一个引号外的 `->` 下标；没有返回 -1。 */
function findArrow(body: string): number {
  let quoted = false;
  let index = 0;
  while (index + 1 < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === '-' && body[index + 1] === '>') {
      return index;
    }
    index += 1;
  }
  return -1;
}

/** 按空白切词，引号内的空白不算分隔符（引号保留在词里）。 */
function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text) {
    if (quoted) {
      current += char;
      if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      current += char;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

/** `[x, y]` → `{"x": …, "y": …}`；**其余形状原样留着**，让 schema 去报类型错。 */
function decodePosition(value: any): any {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
    return { x: value[0], y: value[1] };
  }
  return value;
}

function decodeSize(value: any): any {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
    return { w: value[0], h: value[1] };
  }
  return value;
}

/** `group` / `comment` 里的位置与尺寸字段，规则同 `decodePosition`。 */
function decodePositions(mapping: Record<string, any>): Record<string, any> {
  for (const key of POSITION_KEYS) {
    const value = mapping[key];
    if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
      setKey(mapping, key, { x: value[0], y: value[1] });
    }
  }
  for (const key of SIZE_KEYS) {
    const value = mapping[key];
    if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
      setKey(mapping, key, { w: value[0], h: value[1] });
    }
  }
  return mapping;
}

/** `[{x, y}, …]` → `[[x, y], …]`；有一个折点不是 `{x, y}` 数值对就返回 `null`。 */
function pointsToPairs(waypoints: any): number[][] | null {
  if (!Array.isArray(waypoints)) return null;
  const pairs: number[][] = [];
  for (const point of waypoints) {
    if (
      !(
        isRecord(point) &&
        Object.keys(point).length === 2 &&
        Object.hasOwn(point, 'x') &&
        Object.hasOwn(point, 'y') &&
        isNumber(point.x) &&
        isNumber(point.y)
      )
    ) {
      return null;
    }
    pairs.push([point.x, point.y]);
  }
  return pairs;
}

/** `[[x, y], …]` → `[{x, y}, …]`；形状不对就原样返回，交给 schema 报。 */
function pairsToPoints(value: any): any {
  if (!Array.isArray(value)) return value;
  const decoded: Array<{ x: number; y: number }> = [];
  for (const pair of value) {
    if (!(Array.isArray(pair) && pair.length === 2 && pair.every((item) => isNumber(item)))) return value;
    decoded.push({ x: pair[0], y: pair[1] });
  }
  return decoded;
}

class Parser {
  private readonly rawLines: string[];
  private readonly path: string | null;
  private index = 0;

  constructor(text: string, path: string | null) {
    this.rawLines = splitLines(text);
    this.path = path;
  }

  // ---- 行工具 -----------------------------------------------------------------------

  private source(index: number): SourceLine {
    return new SourceLine(this.path, index + 1, this.rawLines[index]);
  }

  private skipNoise(): void {
    while (this.index < this.rawLines.length) {
      const raw = this.rawLines[this.index];
      const stripped = pyStrip(raw);
      if (!stripped || stripped.startsWith('#')) {
        this.index += 1;
        continue;
      }
      return;
    }
  }

  private peekEntry(): Entry | null {
    for (;;) {
      this.skipNoise();
      if (this.index >= this.rawLines.length) return null;
      const raw = this.rawLines[this.index];
      let indent = 0;
      for (const char of raw) {
        if (char === ' ') indent += 1;
        else if (char === '\t') {
          throw this.source(this.index).error('缩进不能用 Tab', indent + 1, `每层用 ${INDENT} 个空格`);
        } else break;
      }
      const body = rstripWs(stripComment(raw.slice(indent)));
      if (!body) {
        this.index += 1;
        continue;
      }
      return new Entry(indent, body, indent + 1, this.source(this.index));
    }
  }

  private takeEntry(indent: number): Entry | null {
    const entry = this.peekEntry();
    if (entry === null) return null;
    if (entry.indent < indent) return null;
    if (entry.indent > indent) {
      throw entry.line.error(
        `缩进跳级：这一层是 ${indent} 个空格，本行是 ${entry.indent} 个`,
        entry.column,
        `子块正好比父行多 ${INDENT} 个空格`,
      );
    }
    this.index += 1;
    return entry;
  }

  private rawIndent(raw: string): number {
    let count = 0;
    for (const char of raw) {
      if (char === ' ') count += 1;
      else break;
    }
    return count;
  }

  // ---- 通用块 -----------------------------------------------------------------------

  private parseContainer(indent: number): any {
    const entry = this.peekEntry();
    if (entry !== null && entry.indent === indent && isItem(entry.body)) return this.parseList(indent);
    return this.parseMap(indent);
  }

  private parseChild(indent: number, line: SourceLine): any {
    const entry = this.peekEntry();
    if (entry === null || entry.indent <= indent) return {};
    if (entry.indent !== indent + INDENT) {
      throw entry.line.error(
        `子块缩进要正好比父行多 ${INDENT} 个空格（父行 ${indent}，本行 ${entry.indent}）`,
        entry.column,
      );
    }
    return this.parseContainer(entry.indent);
  }

  private parseMap(indent: number, first: Entry | null = null): Record<string, any> {
    const result: Record<string, any> = {};
    let entry: Entry | null = first;
    for (;;) {
      if (entry === null) {
        entry = this.takeEntry(indent);
        if (entry === null) break;
      } else if (isItem(entry.body)) {
        throw entry.line.error('这一层不能把列表项与键混在一起', entry.column);
      }
      const { key, rest, column } = this.splitKey(entry);
      if (Object.hasOwn(result, key)) throw entry.line.error(`键重复：${key}`, entry.column);
      setKey(result, key, this.parseValue(rest, column, indent, entry.line));
      entry = null;
    }
    return result;
  }

  private parseList(indent: number): any[] {
    const items: any[] = [];
    for (;;) {
      const entry = this.takeEntry(indent);
      if (entry === null) break;
      if (!isItem(entry.body)) throw entry.line.error('这一层不能把键与列表项混在一起', entry.column);
      const body = lstripWs(entry.body.slice(1));
      const column = body ? entry.column + entry.body.indexOf(body) : entry.column + 1;
      if (!body) {
        items.push(this.parseChild(indent, entry.line));
        continue;
      }
      if (body === '|') {
        items.push(this.parseTextBlock(indent));
        continue;
      }
      if (this.looksLikeEntry(body)) {
        const pseudo = new Entry(indent + INDENT, body, column, entry.line);
        items.push(this.parseMap(indent + INDENT, pseudo));
        continue;
      }
      items.push(parseInline(body, entry.line, column));
    }
    return items;
  }

  private looksLikeEntry(body: string): boolean {
    const colon = findColon(body);
    if (colon <= 0) return false;
    const key = body.slice(0, colon);
    return key === rstripWs(key) && !/[ \t]/.test(key);
  }

  private splitKey(entry: Entry): { key: string; rest: string; column: number } {
    const colon = findColon(entry.body);
    if (colon < 0) throw entry.line.error('这一行缺少 :（键与值之间要写冒号）', entry.column);
    const rawKey = entry.body.slice(0, colon);
    if (rawKey !== rstripWs(rawKey)) throw entry.line.error('键与冒号之间不能有空格', entry.column + colon);
    if (!rawKey) throw entry.line.error('缺少键名', entry.column);
    const key = parseText(rawKey, entry.line, entry.column);
    const rest = lstripWs(entry.body.slice(colon + 1));
    const column = entry.column + colon + 1 + (entry.body.length - colon - 1 - rest.length);
    return { key, rest, column };
  }

  private parseValue(rest: string, column: number, indent: number, line: SourceLine): any {
    if (!rest) return this.parseChild(indent, line);
    if (rest === '|') return this.parseTextBlock(indent);
    return parseInline(rest, line, column);
  }

  private parseTextBlock(indent: number): string {
    const collected: string[] = [];
    while (this.index < this.rawLines.length) {
      const raw = this.rawLines[this.index];
      if (!pyStrip(raw)) {
        collected.push('');
        this.index += 1;
        continue;
      }
      if (this.rawIndent(raw) <= indent) break;
      collected.push(raw);
      this.index += 1;
    }
    while (collected.length && !pyStrip(collected[collected.length - 1])) collected.pop();
    if (!collected.length) return '';
    let cut = Number.POSITIVE_INFINITY;
    for (const item of collected) {
      if (pyStrip(item)) cut = Math.min(cut, this.rawIndent(item));
    }
    return collected.map((item) => (pyStrip(item) ? item.slice(cut) : '')).join('\n');
  }

  private parseExpressionValue(rest: string, column: number, indent: number, line: SourceLine): any {
    if (rest) return parseExpression(rest, line, column);
    const value = this.parseChild(indent, line);
    if (!isRecord(value)) throw line.error('表达式要么写成中缀，要么写成操作数对象的子块', column);
    return value;
  }

  private parseExpressionList(rest: string, column: number, indent: number, line: SourceLine): any[] {
    if (rest) {
      const stripped = pyStrip(rest);
      if (!stripped.startsWith('[')) {
        throw line.error('条件列表要么写 [a == 1, b == 2]，要么用缩进的 - 项', column);
      }
      if (!stripped.endsWith(']')) {
        throw line.error('条件列表缺少右括号 ]', column, '每一项是一段中缀表达式，用逗号分隔');
      }
      const inner = stripped.slice(1, -1);
      if (!pyStrip(inner)) return [];
      return splitCommas(inner, line, column + 1).map((element) =>
        parseExpression(element.text, line, element.column),
      );
    }
    const items: any[] = [];
    for (;;) {
      const entry = this.takeEntry(indent + INDENT);
      if (entry === null) break;
      if (!isItem(entry.body)) throw entry.line.error('条件列表的每一项都要以 - 开头', entry.column);
      const body = lstripWs(entry.body.slice(1));
      const itemColumn = body ? entry.column + entry.body.indexOf(body) : entry.column + 1;
      if (!body) throw entry.line.error('条件列表项不能为空', entry.column);
      if (this.looksLikeEntry(body)) {
        const pseudo = new Entry(indent + 2 * INDENT, body, itemColumn, entry.line);
        items.push(this.parseMap(indent + 2 * INDENT, pseudo));
        continue;
      }
      items.push(parseExpression(body, entry.line, itemColumn));
    }
    return items;
  }

  // ---- 结构 -------------------------------------------------------------------------

  parse(): Record<string, any> {
    const entry = this.peekEntry();
    if (entry === null) throw new DslError('文档是空的', { path: this.path });
    if (entry.indent !== 0) throw entry.line.error('第一行不能缩进', entry.column);
    const words = splitWords(entry.body);
    if (!words.length || words[0] !== 'workflow') {
      throw entry.line.error('第一行必须写成 workflow <id>', entry.column);
    }
    if (words.length !== 2) {
      throw entry.line.error('workflow 头行只接受一个 id：workflow <id>', entry.column);
    }
    this.index += 1;
    const document: Record<string, any> = {
      schema_version: DOCUMENT_SCHEMA_VERSION,
      id: parseText(words[1], entry.line, entry.column + 'workflow '.length),
    };
    const nodes: Array<Record<string, any>> = [];
    const edges: Array<Record<string, any>> = [];
    const groups: Array<Record<string, any>> = [];
    const comments: Array<Record<string, any>> = [];
    let sawEdges = false;
    for (;;) {
      const item = this.takeEntry(INDENT);
      if (item === null) break;
      const body = item.body;
      const head = body.split(' ', 1)[0];
      if (head === 'node') {
        nodes.push(this.parseNode(item));
      } else if (head === 'var') {
        nodes.push(this.parseVar(item));
      } else if (head === 'group') {
        groups.push(this.parseDeclared(item, 'group'));
      } else if (head === 'comment') {
        comments.push(this.parseDeclared(item, 'comment'));
      } else {
        const { key, rest, column } = this.splitKey(item);
        if (key === 'workflow') throw item.line.error('workflow 头行只能出现一次', item.column);
        if (key === 'edges') {
          if (sawEdges) throw item.line.error('edges 块只能写一次', item.column);
          if (rest) throw item.line.error('edges 下面直接写连线，不要在同一行写值', column);
          this.parseEdges(item, edges);
          sawEdges = true;
          continue;
        }
        if (key === 'schema_version') {
          throw item.line.error('schema_version 由格式决定，不要在文档里写', item.column);
        }
        if (Object.hasOwn(document, key)) {
          throw item.line.error(`顶层键重复：${key}`, item.column);
        }
        if (key === 'version' || key === 'description') {
          setKey(document, key, rest ? this.parseTextValue(rest, column, item.line) : '');
        } else if (key === 'root') {
          setKey(document, key, parseText(rest, item.line, column));
        } else {
          setKey(document, key, this.parseValue(rest, column, INDENT, item.line));
        }
      }
    }
    if (!Object.hasOwn(document, 'version')) {
      throw new DslError('文档缺少 version：工作流版本号', { path: this.path });
    }
    if (!Object.hasOwn(document, 'resolution')) {
      throw new DslError('文档缺少 resolution：[宽, 高]', { path: this.path });
    }
    if (!Object.hasOwn(document, 'root')) {
      throw new DslError('文档缺少 root：根节点 id', { path: this.path });
    }
    if (!Object.hasOwn(document, 'inputs')) setKey(document, 'inputs', {});
    if (!Object.hasOwn(document, 'variables')) setKey(document, 'variables', {});
    setKey(document, 'nodes', nodes);
    if (edges.length) setKey(document, 'edges', edges);
    if (groups.length) setKey(document, 'groups', groups);
    if (comments.length) setKey(document, 'comments', comments);
    return document;
  }

  private parseTextValue(rest: string, column: number, line: SourceLine): string {
    if (rest === '|') return this.parseTextBlock(INDENT);
    return parseText(rest, line, column);
  }

  /** `group` / `comment` 这类「位置参数 + 通用块」的声明。 */
  private parseDeclared(entry: Entry, keyword: string): Record<string, any> {
    const words = splitWords(pyStrip(entry.body.slice(keyword.length)));
    if (!words.length) throw entry.line.error(`${keyword} 后面要写 id`, entry.column);
    if (words.length > 2) throw entry.line.error(`${keyword} 只接受 id 与可选的显示名`, entry.column);
    const declared: Record<string, any> = {
      id: parseText(words[0], entry.line, entry.column + keyword.length + 1),
    };
    if (words.length === 2) {
      setKey(declared, keyword === 'group' ? 'name' : 'text', this.parseTextToken(words[1], entry.line));
    }
    const mapping = this.parseMap(entry.indent + INDENT);
    Object.assign(declared, decodePositions(mapping));
    return declared;
  }

  private parseTextToken(token: string, line: SourceLine): string {
    if (token.startsWith('"')) {
      const [value] = parseQuoted(token, 0, line);
      return value;
    }
    return parseText(token, line, 1);
  }

  private parseNode(entry: Entry): Record<string, any> {
    const words = splitWords(pyStrip(entry.body.slice('node'.length)));
    if (words.length < 2) {
      throw entry.line.error('node 头行要写 node <id> <类型> ["显示名"]', entry.column);
    }
    if (words.length > 3) {
      throw entry.line.error('node 头行最多三个位置参数：id、类型、显示名', entry.column);
    }
    const node: Record<string, any> = {
      id: parseText(words[0], entry.line, entry.column + 'node '.length),
      type: parseText(words[1], entry.line, entry.column + 'node '.length + words[0].length + 1),
    };
    if (words.length === 3) setKey(node, 'name', this.parseTextToken(words[2], entry.line));
    this.parseNodeBody(entry, node);
    return node;
  }

  private parseVar(entry: Entry): Record<string, any> {
    const rest = pyStrip(entry.body.slice('var'.length));
    const dot = rest.indexOf('.');
    const scope = dot < 0 ? rest : rest.slice(0, dot);
    const keyToken = dot < 0 ? '' : rest.slice(dot + 1);
    if (dot < 0 || !keyToken) {
      throw entry.line.error('变量节点要写 var <inputs|variables>.<键>', entry.column + 'var '.length);
    }
    if (scope !== 'inputs' && scope !== 'variables') {
      throw entry.line.error(
        `变量节点的作用域只能是 inputs / variables，读到 ${pyRepr(scope)}`,
        entry.column + 'var '.length,
      );
    }
    const key = parseText(keyToken, entry.line, entry.column + 'var '.length + scope.length + 1);
    const node: Record<string, any> = {
      id: `var__${scope}__${key}`,
      type: 'variable',
      scope,
      name: key,
    };
    this.parseNodeBody(entry, node);
    return node;
  }

  private parseEdges(entry: Entry, edges: Array<Record<string, any>>): void {
    const indent = entry.indent + INDENT;
    for (;;) {
      const item = this.takeEntry(indent);
      if (item === null) return;
      if (isItem(item.body)) throw item.line.error('edges 里的连线不加 - 前缀', item.column);
      if (findArrow(item.body) < 0) {
        throw item.line.error(
          '连线要写成 <源节点>[:源引脚] -> <目标节点>[:目标引脚]',
          item.column,
          '例如 root -> round 或 round:then.1 -> pick',
        );
      }
      edges.push(this.parseWire(item, indent));
    }
  }

  private parseNodeBody(entry: Entry, node: Record<string, any>): void {
    const indent = entry.indent + INDENT;
    const seen = new Set<string>();
    for (;;) {
      const item = this.takeEntry(indent);
      if (item === null) break;
      if (findArrow(item.body) >= 0) {
        throw item.line.error(
          `连线不写在节点块里：节点 ${node.id} 的连线要写到顶层 edges 块`,
          item.column,
          '字面量里真的要写 -> 时请加引号',
        );
      }
      if (item.body === 'decorator' || item.body.startsWith('decorator ')) {
        if (!Object.hasOwn(node, 'decorators')) setKey(node, 'decorators', []);
        const decorators = node.decorators;
        if (!Array.isArray(decorators)) throw item.line.error('decorators 必须是列表', item.column);
        decorators.push(this.parseDecorator(item, indent));
        continue;
      }
      const { key, rest, column } = this.splitKey(item);
      if (key === 'decorator') throw item.line.error('装饰器要写成 decorator <类型>', item.column);
      if (seen.has(key)) throw item.line.error(`键重复：${key}`, item.column);
      seen.add(key);
      if (key === 'id' || key === 'type') {
        throw item.line.error(`${key} 写在 node 头行上，不要在块里重复`, item.column);
      }
      if (key === 'name') {
        if (Object.hasOwn(node, 'name')) throw item.line.error('显示名重复（头行已经写过）', item.column);
        setKey(node, 'name', rest ? this.parseTextValue(rest, column, item.line) : '');
        continue;
      }
      if (POSITION_KEYS.includes(key)) {
        setKey(node, key, decodePosition(this.parseValue(rest, column, indent, item.line)));
        continue;
      }
      if (SIZE_KEYS.includes(key)) {
        setKey(node, key, decodeSize(this.parseValue(rest, column, indent, item.line)));
        continue;
      }
      if (EXPRESSION_KEYS.includes(key)) {
        setKey(node, key, this.parseExpressionValue(rest, column, indent, item.line));
        continue;
      }
      if (key === 'conditions') {
        setKey(node, key, this.parseExpressionList(rest, column, indent, item.line));
        continue;
      }
      setKey(node, key, this.parseValue(rest, column, indent, item.line));
    }
  }

  private parseDecorator(entry: Entry, indent: number): Record<string, any> {
    const rest = pyStrip(entry.body.slice('decorator'.length));
    if (!rest) {
      throw entry.line.error('decorator 后面要写类型（cooldown / timeout / retry / repeat / do_once）', entry.column);
    }
    const decorator: Record<string, any> = {
      type: parseText(rest, entry.line, entry.column + 'decorator '.length),
    };
    const extra = this.parseMap(indent + INDENT);
    if (Object.hasOwn(extra, 'type')) throw entry.line.error('decorator 的类型写在头行上', entry.column);
    Object.assign(decorator, extra);
    return decorator;
  }

  private parseWire(entry: Entry, indent: number): Record<string, any> {
    const body = entry.body;
    const arrow = findArrow(body);
    const left = pyStrip(body.slice(0, arrow));
    const right = pyStrip(body.slice(arrow + 2));
    if (!left) throw entry.line.error('连线缺少源节点', entry.column);
    if (!right) throw entry.line.error('连线缺少目标节点', entry.column + arrow + 2);
    const [sourceNode, sourcePin] = this.splitEndpoint(left, DEFAULT_EXEC_OUT_PIN, entry, entry.column);
    const [targetNode, targetPin] = this.splitEndpoint(
      right,
      EXEC_IN_PIN,
      entry,
      entry.column + arrow + 2,
    );
    const edge: Record<string, any> = {
      from: { node: sourceNode, pin: sourcePin },
      to: { node: targetNode, pin: targetPin },
    };
    const child = this.parseChild(indent, entry.line);
    if (child && (!Array.isArray(child) || child.length)) {
      const unknown = Array.isArray(child)
        ? Array.from(new Set(child.map((item: any) => String(item))))
        : Object.keys(child).filter((key) => key !== 'waypoints');
      if (unknown.length) {
        throw entry.line.error(`连线块里只支持 waypoints，读到 ${pyRepr(unknown.sort())}`, entry.column);
      }
      if (!Array.isArray(child)) {
        const waypoints = child.waypoints;
        if (waypoints !== undefined && waypoints !== null) edge.waypoints = pairsToPoints(waypoints);
      }
    }
    return edge;
  }

  private splitEndpoint(text: string, defaultPin: string, entry: Entry, column: number): [string, string] {
    const stripped = pyStrip(text);
    // 节点 id 可以是引号字符串（例如含 `:` 的 id），所以先按引号解析再找引脚分隔符。
    if (stripped.startsWith('"')) {
      const [node, end] = parseQuoted(stripped, 0, entry.line);
      const rest = pyStrip(stripped.slice(end));
      if (!rest) return [node, defaultPin];
      if (!rest.startsWith(':')) {
        throw entry.line.error('引号节点 id 后面只能接 :引脚', column + end);
      }
      return [node, pyStrip(rest.slice(1)) || defaultPin];
    }
    const separator = stripped.indexOf(':');
    const node = pyStrip(separator < 0 ? stripped : stripped.slice(0, separator));
    let pin = separator < 0 ? defaultPin : pyStrip(stripped.slice(separator + 1));
    if (!node) throw entry.line.error('连线的端点缺少节点 id', column);
    if (!pin) pin = defaultPin;
    return [parseText(node, entry.line, column), parseText(pin, entry.line, column + node.length + 1)];
  }
}

/** `.owf` 文本 → 图文档（`schema_version` 为 6，其余与 v5 同形）。 */
export function parseDocument(text: string, path?: string): any {
  return new Parser(text, path ?? null).parse();
}

/**
 * 只读头行取工作流 id（不解析整份文档）。
 *
 * 「按 id 反查文件」这类场景只需要 id，把整份文档解析一遍既慢又会在无关的语法错误上失败。
 */
export function readDocumentId(text: string): string | null {
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const stripped = pyStrip(stripComment(raw));
    if (!stripped || stripped.startsWith('#')) continue;
    const words = splitWords(stripped);
    if (words.length !== 2 || words[0] !== 'workflow') return null;
    try {
      return parseText(words[1], new SourceLine(null, index + 1, raw), raw.indexOf(words[1]) + 1);
    } catch (error) {
      if (error instanceof DslError) return null;
      throw error;
    }
  }
  return null;
}

// --------------------------------------------------------------------------------------
// 规范化
// --------------------------------------------------------------------------------------

/**
 * 把图文档整理成 `emitDocument` 会产出的形状（语义无损、可比较）。
 *
 * 只做三件事：`then` 别名收敛成 `then.0`、`and` / `or` 扁平化、空的 `edges` / `groups` /
 * `comments` 与空 `waypoints` 删掉。**边的顺序保持不变**。
 */
export function normalizeDocument(document: any): any {
  if (!isRecord(document)) throw new DslError('图文档不是对象');
  const result = deepClone(document);
  setKey(result, 'schema_version', DOCUMENT_SCHEMA_VERSION);
  // `emit` 对 falsy / 非对象的 inputs、variables 一律写 `{}`，规范化必须与它一致，
  // 否则 `parse(emit(doc)) == normalizeDocument(doc)` 会被 `inputs: []` 这种形状破坏。
  for (const key of ['inputs', 'variables']) {
    if (!isRecord(result[key])) setKey(result, key, {});
  }
  const nodes = result.nodes;
  if (!Array.isArray(nodes)) throw new DslError('图文档缺少 nodes 数组');
  const edges = result.edges;
  if (Array.isArray(edges) && edges.length) {
    setKey(result, 'edges', edges.map((edge: any) => normalizeEdge(edge)));
  } else {
    delete result.edges;
  }
  for (const key of ['groups', 'comments']) {
    if (Array.isArray(result[key]) && !result[key].length) delete result[key];
  }
  for (const node of nodes) {
    if (isRecord(node)) normalizeNodeExpressions(node);
  }
  return result;
}

function normalizeEdge(edge: any): any {
  const normalized = deepClone(edge);
  if (!isRecord(normalized)) return normalized;
  for (const side of ['from', 'to']) {
    const binding = normalized[side];
    if (isRecord(binding) && binding.pin === 'then') setKey(binding, 'pin', 'then.0');
  }
  const waypoints = normalized.waypoints;
  if (Array.isArray(waypoints) && !waypoints.length) delete normalized.waypoints;
  return normalized;
}

function normalizeNodeExpressions(node: Record<string, any>): void {
  for (const key of EXPRESSION_KEYS) {
    if (Object.hasOwn(node, key)) setKey(node, key, normalizeExpression(node[key]));
  }
  const conditions = node.conditions;
  if (Array.isArray(conditions)) {
    setKey(node, 'conditions', conditions.map((item: any) => normalizeExpression(item)));
  }
}

function normalizeExpression(value: any): any {
  if (!isRecord(value) || Object.keys(value).length !== 1) return value;
  const operator = Object.keys(value)[0];
  const operands = value[operator];
  if ((operator === 'and' || operator === 'or') && Array.isArray(operands)) {
    const flattened: any[] = [];
    for (const raw of operands) {
      const operand = normalizeExpression(raw);
      if (
        isRecord(operand) &&
        Object.keys(operand).length === 1 &&
        Object.hasOwn(operand, operator) &&
        Array.isArray(operand[operator])
      ) {
        flattened.push(...operand[operator]);
      } else {
        flattened.push(operand);
      }
    }
    return oneKeyDict(operator, flattened);
  }
  if (operator === 'not') return oneKeyDict('not', normalizeExpression(operands));
  if (operator === 'exists') return oneKeyDict('exists', operands);
  if (Array.isArray(operands)) return oneKeyDict(operator, operands.map((item: any) => normalizeExpression(item)));
  return oneKeyDict(operator, normalizeExpression(operands));
}

// --------------------------------------------------------------------------------------
// 序列化
// --------------------------------------------------------------------------------------

class Writer {
  private readonly lines: string[] = [];

  line(depth: number, text: string): void {
    this.lines.push(text ? ' '.repeat(depth * INDENT) + text : '');
  }

  render(): string {
    while (this.lines.length && !this.lines[this.lines.length - 1]) this.lines.pop();
    return `${this.lines.join('\n')}\n`;
  }
}

function requireField(node: any, key: string, label: string): any {
  if (!isRecord(node) || !Object.hasOwn(node, key)) {
    throw new DslError(`${label} 缺少字段 ${key}，写不成 .owf`);
  }
  return node[key];
}

function emitEntry(writer: Writer, depth: number, key: string, value: any): void {
  const name = renderIdentifier(key);
  if (typeof value === 'string' && value.includes('\n')) {
    writer.line(depth, `${name}: |`);
    for (const textLine of value.split('\n')) writer.line(depth + 1, textLine);
    return;
  }
  const inline = renderInline(value);
  if (inline !== null) {
    writer.line(depth, `${name}: ${inline}`);
    return;
  }
  if (isRecord(value)) {
    writer.line(depth, `${name}:`);
    for (const [childKey, childValue] of Object.entries(value)) {
      emitEntry(writer, depth + 1, childKey, childValue);
    }
    return;
  }
  if (Array.isArray(value)) {
    writer.line(depth, `${name}:`);
    emitList(writer, depth + 1, value);
    return;
  }
  throw new DslError(`字段 ${key} 的值写不成 .owf：${pyRepr(value)}`);
}

function emitList(writer: Writer, depth: number, items: any[]): void {
  for (const item of items) emitListItem(writer, depth, item);
}

function emitListItem(writer: Writer, depth: number, value: any): void {
  if (typeof value === 'string' && value.includes('\n')) {
    writer.line(depth, '- |');
    for (const textLine of value.split('\n')) writer.line(depth + 1, textLine);
    return;
  }
  const inline = renderInline(value);
  if (inline !== null) {
    writer.line(depth, `- ${inline}`);
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (!keys.length) {
      writer.line(depth, '- {}');
      return;
    }
    emitItemHead(writer, depth, keys[0], value[keys[0]]);
    for (const key of keys.slice(1)) emitEntry(writer, depth + 1, key, value[key]);
    return;
  }
  if (Array.isArray(value)) {
    writer.line(depth, '-');
    emitList(writer, depth + 1, value);
    return;
  }
  throw new DslError(`列表项写不成 .owf：${pyRepr(value)}`);
}

function emitItemHead(writer: Writer, depth: number, key: string, value: any): void {
  const name = renderIdentifier(key);
  if (typeof value === 'string' && value.includes('\n')) {
    writer.line(depth, `- ${name}: |`);
    for (const textLine of value.split('\n')) writer.line(depth + 2, textLine);
    return;
  }
  const inline = renderInline(value);
  if (inline !== null) {
    writer.line(depth, `- ${name}: ${inline}`);
    return;
  }
  if (isRecord(value)) {
    writer.line(depth, `- ${name}:`);
    for (const [childKey, childValue] of Object.entries(value)) {
      emitEntry(writer, depth + 2, childKey, childValue);
    }
    return;
  }
  if (Array.isArray(value)) {
    writer.line(depth, `- ${name}:`);
    emitList(writer, depth + 2, value);
    return;
  }
  throw new DslError(`列表项的字段 ${key} 写不成 .owf：${pyRepr(value)}`);
}

function emitExpressionEntry(writer: Writer, depth: number, key: string, value: any): void {
  const name = renderIdentifier(key);
  const text = renderExpression(value);
  if (text !== null) {
    writer.line(depth, `${name}: ${text}`);
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (!keys.length) {
      writer.line(depth, `${name}: {}`);
      return;
    }
    writer.line(depth, `${name}:`);
    for (const [childKey, childValue] of Object.entries(value)) {
      emitEntry(writer, depth + 1, childKey, childValue);
    }
    return;
  }
  throw new DslError(`${key} 的表达式既写不成中缀、也不是操作数对象：${pyRepr(value)}`);
}

function emitExpressionList(writer: Writer, depth: number, key: string, items: any[]): void {
  const name = renderIdentifier(key);
  if (!items.length) {
    writer.line(depth, `${name}: []`);
    return;
  }
  const rendered = items.map((item) => renderExpression(item));
  if (rendered.every((text) => text !== null)) {
    const inline = `[${rendered.join(', ')}]`;
    if (inline.length <= INLINE_WIDTH) {
      writer.line(depth, `${name}: ${inline}`);
      return;
    }
  }
  writer.line(depth, `${name}:`);
  items.forEach((item, index) => {
    const text = rendered[index];
    if (text !== null) {
      writer.line(depth + 1, `- ${text}`);
      return;
    }
    emitListItem(writer, depth + 1, item);
  });
}

function emitDecorators(writer: Writer, depth: number, decorators: any[]): void {
  if (!decorators.length) {
    writer.line(depth, 'decorators: []');
    return;
  }
  for (const decorator of decorators) {
    if (!isRecord(decorator) || !Object.hasOwn(decorator, 'type')) {
      throw new DslError(`装饰器缺少 type：${pyRepr(decorator)}`);
    }
    writer.line(depth, `decorator ${renderIdentifier(String(decorator.type))}`);
    for (const [key, value] of Object.entries(decorator)) {
      if (key === 'type') continue;
      emitEntry(writer, depth + 1, key, value);
    }
  }
}

function emitPosition(writer: Writer, depth: number, key: string, value: any): boolean {
  if (
    POSITION_KEYS.includes(key) &&
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, 'x') &&
    Object.hasOwn(value, 'y') &&
    isNumber(value.x) &&
    isNumber(value.y)
  ) {
    writer.line(depth, `${renderIdentifier(key)}: [${renderNumber(value.x)}, ${renderNumber(value.y)}]`);
    return true;
  }
  if (
    SIZE_KEYS.includes(key) &&
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, 'w') &&
    Object.hasOwn(value, 'h') &&
    isNumber(value.w) &&
    isNumber(value.h)
  ) {
    writer.line(depth, `${renderIdentifier(key)}: [${renderNumber(value.w)}, ${renderNumber(value.h)}]`);
    return true;
  }
  return false;
}

function emitWire(writer: Writer, depth: number, edge: any, ids: Set<string>): void {
  const source = isRecord(edge) && isRecord(edge.from) ? edge.from : {};
  const target = isRecord(edge) && isRecord(edge.to) ? edge.to : {};
  const sourceNode = String(source.node || '');
  const targetNode = String(target.node || '');
  if (!sourceNode || !targetNode) throw new DslError(`连线缺少端点：${pyRepr(edge)}`);
  if (!ids.has(sourceNode)) throw new DslError(`连线的源节点不存在：${sourceNode}`);
  if (!ids.has(targetNode)) throw new DslError(`连线指向了不存在的节点：${targetNode}`);
  let sourcePin = String(source.pin || EXEC_OUT_PIN);
  if (sourcePin === EXEC_OUT_PIN) sourcePin = DEFAULT_EXEC_OUT_PIN;
  const targetPin = String(target.pin || EXEC_IN_PIN);
  const head =
    sourcePin === DEFAULT_EXEC_OUT_PIN
      ? renderIdentifier(sourceNode)
      : `${renderIdentifier(sourceNode)}:${renderIdentifier(sourcePin)}`;
  const tail =
    targetPin === EXEC_IN_PIN
      ? renderIdentifier(targetNode)
      : `${renderIdentifier(targetNode)}:${renderIdentifier(targetPin)}`;
  writer.line(depth, `${head} -> ${tail}`);
  const waypoints = isRecord(edge) ? edge.waypoints : undefined;
  if (pyTruthy(waypoints)) {
    const pairs = pointsToPairs(waypoints);
    if (pairs === null) {
      emitEntry(writer, depth + 1, 'waypoints', waypoints);
      return;
    }
    const inline = renderInline(pairs);
    if (inline !== null) {
      writer.line(depth + 1, `waypoints: ${inline}`);
      return;
    }
    writer.line(depth + 1, 'waypoints:');
    emitList(writer, depth + 2, pairs);
  }
}

function emitNode(writer: Writer, depth: number, node: Record<string, any>): void {
  const nodeId = String(requireField(node, 'id', '节点'));
  const nodeType = String(requireField(node, 'type', '节点'));
  const handled = new Set<string>(['id', 'type', 'name']);
  if (nodeType === 'variable') {
    const scope = node.scope;
    const name = node.name;
    if ((scope !== 'inputs' && scope !== 'variables') || typeof name !== 'string' || !name) {
      throw new DslError(`变量节点 ${nodeId} 缺少 scope / name，写不成 var 行`);
    }
    const expected = `var__${scope}__${name}`;
    if (nodeId !== expected) {
      throw new DslError(`变量节点 ${nodeId} 与派生 id ${expected} 不一致（v6 要求 id 由作用域与键派生）`);
    }
    writer.line(depth, `var ${scope}.${renderIdentifier(name)}`);
    handled.add('scope');
  } else {
    let header = `node ${renderIdentifier(nodeId)} ${renderIdentifier(nodeType)}`;
    if (Object.hasOwn(node, 'name')) header += ` ${renderScalar(String(node.name))}`;
    writer.line(depth, header);
  }
  const body = depth + 1;
  for (const key of NODE_KEY_ORDER) {
    if (!Object.hasOwn(node, key)) continue;
    const value = node[key];
    handled.add(key);
    if (emitPosition(writer, body, key, value)) continue;
    if (key === 'expression' || key === 'condition') {
      emitExpressionEntry(writer, body, key, value);
      continue;
    }
    if (key === 'conditions') {
      emitExpressionList(writer, body, key, Array.isArray(value) ? value : [value]);
      continue;
    }
    if (key === 'decorators') {
      emitDecorators(writer, body, Array.isArray(value) ? value : []);
      continue;
    }
    emitEntry(writer, body, key, value);
  }
  for (const [key, value] of Object.entries(node)) {
    if (handled.has(key)) continue;
    emitEntry(writer, body, key, value);
  }
}

function emitDeclared(writer: Writer, depth: number, keyword: string, declared: any, nameKey: string): void {
  const identifier = String(requireField(declared, 'id', keyword));
  let header = `${keyword} ${renderIdentifier(identifier)}`;
  if (Object.hasOwn(declared, nameKey) && declared[nameKey] !== null && declared[nameKey] !== undefined) {
    header += ` ${renderScalar(String(declared[nameKey]))}`;
  }
  writer.line(depth, header);
  for (const [key, value] of Object.entries(declared)) {
    if (key === 'id' || key === nameKey) continue;
    if (emitPosition(writer, depth + 1, key, value)) continue;
    emitEntry(writer, depth + 1, key, value);
  }
}

/** 图文档 → `.owf` 文本（规范形式）。 */
export function emitDocument(document: any): string {
  if (!isRecord(document)) throw new DslError('要写盘的文档不是对象');
  const nodes = document.nodes;
  if (!Array.isArray(nodes)) throw new DslError('图文档缺少 nodes 数组');
  // 编辑形态的检查放在版本检查之前：这条报错更具体，直接告诉调用方该先转格式。
  for (const node of nodes) {
    for (const field of EDIT_FORM_FIELDS) {
      if (isRecord(node) && Object.hasOwn(node, field)) {
        throw new DslError(`节点 ${node.id} 带着 ${field}：这是编辑形态（v4），要先转成图文档`);
      }
    }
  }
  const version = document.schema_version;
  if (version !== null && version !== undefined && version !== 5 && version !== DOCUMENT_SCHEMA_VERSION) {
    throw new DslError(`只支持图文档（v5/v6）写盘，读到 schema_version=${pyRepr(version)}`);
  }
  // 头字段缺了就必须报错：写出去是一份**解析不回来**的文本（解析器要求这三个字段），
  // 那比写盘失败更糟。
  const missing = ['version', 'resolution', 'root'].filter((key) => !Object.hasOwn(document, key));
  if (missing.length) {
    throw new DslError(`图文档缺少必需字段，写不成 .owf：${missing.join('、')}`);
  }
  const ids = new Set<string>();
  for (const node of nodes) {
    if (isRecord(node)) ids.add(String(node.id));
  }
  const edges = document.edges || [];

  const writer = new Writer();
  writer.line(0, `workflow ${renderIdentifier(String(requireField(document, 'id', '文档')))}`);
  for (const key of HEADER_ORDER) {
    if (Object.hasOwn(document, key)) emitEntry(writer, 1, key, document[key]);
  }
  for (const key of CONTAINER_ORDER) {
    if (key === 'inputs' || key === 'variables') {
      emitEntry(writer, 1, key, pyTruthy(document[key]) ? document[key] : {});
    } else if (Object.hasOwn(document, key)) {
      emitEntry(writer, 1, key, document[key]);
    }
  }
  for (const [key, value] of Object.entries(document)) {
    if (HEADER_ORDER.includes(key) || CONTAINER_ORDER.includes(key) || STRUCTURAL_TOP_KEYS.includes(key)) continue;
    emitEntry(writer, 1, key, value);
  }
  for (const node of nodes) {
    if (!isRecord(node)) throw new DslError(`nodes 里出现了不是对象的项：${pyRepr(node)}`);
    emitNode(writer, 1, node);
  }
  if (pyTruthy(edges)) {
    writer.line(1, 'edges:');
    if (!Array.isArray(edges)) throw new DslError('edges 必须是数组，写不成顶层边表');
    for (const edge of edges) emitWire(writer, 2, edge, ids);
  }
  for (const group of pyIterable(document.groups)) emitDeclared(writer, 1, 'group', group, 'name');
  for (const comment of pyIterable(document.comments)) emitDeclared(writer, 1, 'comment', comment, 'text');
  return writer.render();
}

/**
 * 内存文档 → `.owf` 文本。
 *
 * - 图文档（`schema_version` 为 6）直接写盘；
 * - 编辑形态 / 运行时 v4 文档先经 `toGraphDocument`（对应 Python 的 `decompile_workflow`）升级。
 */
export function emitRuntimeDocument(document: any): string {
  return emitDocument(toGraphDocument(document));
}
