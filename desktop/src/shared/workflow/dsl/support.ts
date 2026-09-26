/**
 * TypeScript DSL 实现对齐 Python 行为所需的基础工具。
 *
 * 这里集中处理原型安全写入、Python 风格空白、真值和错误展示值。语法模块只描述
 * 自己的规则，避免每个解析阶段各自实现一套略有差异的兼容逻辑。
 */

export function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 安全写入来自工作流文件的键。
 * `__proto__` 必须成为普通自有属性，不能改变承载对象的原型。
 */
export function setKey(target: Record<string, any>, key: string, value: any): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    return;
  }
  target[key] = value;
}

/** 创建原型安全的单键对象，供表达式节点使用。 */
export function oneKeyDict(key: string, value: any): Record<string, any> {
  const result: Record<string, any> = {};
  setKey(result, key, value);
  return result;
}

export function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) setKey(out, key, deepClone(child));
    return out as unknown as T;
  }
  return value;
}

/** Python 的 `str.isspace()` 认的空白比 JavaScript 的 `\s` 多几个控制字符。 */
const PY_SPACE = ' \\t\\n\\r\\v\\f\\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP_END = new RegExp(`[${PY_SPACE}]+$`);
const STRIP_START = new RegExp(`^[${PY_SPACE}]+`);

export function pyStrip(text: string): string {
  return text.replace(STRIP_START, '').replace(STRIP_END, '');
}

export function lstripWs(text: string): string {
  return text.replace(STRIP_START, '');
}

export function rstripWs(text: string): string {
  return text.replace(STRIP_END, '');
}

/** 与 Python `str.splitlines()` 对齐，并丢弃末尾换行产生的空项。 */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\u001c\u001d\u001e\u0085\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 错误文案里的 Python `repr()`；目标是稳定可读，不追求逐字实现。 */
export function pyRepr(value: any): string {
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

/** 数字（布尔不算）；整数约束由 schema 和编译阶段负责。 */
export function isNumber(value: any): value is number {
  return typeof value === 'number';
}

/** 与 Python 对空容器、零值和 NaN 的真值判断保持一致。 */
export function pyTruthy(value: any): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  return true;
}

/** Python 的 `for item in value` 在本 DSL 支持范围内的等价行为。 */
export function pyIterable(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (!pyTruthy(value)) return [];
  if (typeof value === 'string') return value.split('');
  if (isRecord(value)) return Object.keys(value);
  return [];
}
