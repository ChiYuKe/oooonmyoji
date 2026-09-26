/** `.owf` 的标量、字符串、引用与行内集合语法。 */
import type { SourceLine } from './errors';
import { isRecord, pyRepr, pyStrip } from './support';

/** 行内列表整行超过这个长度就换成块写法。 */
export const INLINE_WIDTH = 96;

const INT_RE = /^-?[0-9]+$/;
// Python 会把很小的浮点数写成科学计数法；解析器必须支持，否则会静默丢失精度。
const FLOAT_RE = /^-?(?:[0-9]+\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?$/;
const BARE_STOP = new Set(' \t\r\n#",:[]{}'.split(''));
const REF_PREFIXES = ['nodes.', 'inputs.', 'variables.'];
const ESCAPES = new Map<string, string>([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['"', '"'],
  ['\\', '\\'],
]);

/** 这个裸词是不是节点、输入或变量引用。 */
export function isRefToken(token: string): boolean {
  return REF_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/** 判断裸词会被解析成哪一种值。 */
export function tokenKind(token: string): string {
  if (INT_RE.test(token)) return 'int';
  if (FLOAT_RE.test(token)) return 'float';
  if (token === 'true' || token === 'false') return 'bool';
  if (token === 'null') return 'null';
  if (isRefToken(token)) return 'ref';
  return 'string';
}

/** 把一个裸词转换成运行时值。 */
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

/** 从开引号开始解析转义字符串，返回字符串值和结束位置。 */
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

/** 按顶层逗号或空白切开行内列表，引号和括号内的分隔符不参与切分。 */
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

/** 只按逗号切开；表达式中的空白需要保留在同一项里。 */
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

/** 解析一段标量、引用或行内列表。 */
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

/** 判断文本能否作为裸标识符写出。 */
export function isBareWord(text: string): boolean {
  if (!text || text[0] === '-') return false;
  for (const char of text) if (BARE_STOP.has(char)) return false;
  return true;
}

/** 解析键、id、类型名等一定表示字符串的记号。 */
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

/** 输出键、id、类型名等标识符。 */
export function renderIdentifier(value: string): string {
  return isBareWord(value) ? value : quoteString(value);
}

/** 转义并输出双引号字符串。 */
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

/** 判断字符串是否必须加引号才能无歧义地往返。 */
export function needsQuote(value: string): boolean {
  if (!value || value[0] === '-') return true;
  for (const char of value) if (BARE_STOP.has(char)) return true;
  return tokenKind(value) !== 'string';
}

const EXPR_KEYWORDS = new Set(['and', 'or', 'not', 'contains', 'exists']);

/** 输出字符串标量；表达式关键字在表达式内强制加引号。 */
export function renderScalar(value: string, options: { expression?: boolean } = {}): string {
  if (needsQuote(value) || (options.expression && EXPR_KEYWORDS.has(value))) return quoteString(value);
  return value;
}

function decimalDigits(value: number): { sign: string; digits: string; exp: number } {
  const text = Math.abs(value).toExponential();
  const [mantissa, exponent] = text.split('e');
  return {
    sign: value < 0 ? '-' : '',
    digits: mantissa.replace('.', ''),
    exp: Number.parseInt(exponent, 10),
  };
}

function plainDecimal(value: number): string {
  const { sign, digits, exp } = decimalDigits(value);
  if (exp >= 0) {
    const integer = digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits + '0'.repeat(exp + 1 - digits.length);
    const fraction = digits.length > exp + 1 ? digits.slice(exp + 1) : '';
    return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
  }
  return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
}

/** 模拟 Python `repr(float)` 的最短往返格式和指数阈值。 */
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
    const integer = digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits + '0'.repeat(exp + 1 - digits.length);
    const fraction = digits.length > exp + 1 ? digits.slice(exp + 1) : '0';
    return `${sign}${integer}.${fraction}`;
  }
  return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
}

/** 浮点数按与 Python 一致的最短往返形式输出。 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const text = pythonReprFloat(value);
  return Number(text) === value ? text : String(value);
}

export function renderNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) {
    const text = String(value);
    return /[eE]/.test(text) ? plainDecimal(value) : text;
  }
  return formatNumber(value);
}

/** 把值渲染成单行文本；无法安全单行表示时返回 `null`。 */
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

/** 多行字符串块的正文行。 */
export function renderStringBlock(value: string): string[] {
  return value.split('\n');
}
