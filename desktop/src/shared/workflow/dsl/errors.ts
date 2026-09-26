/**
 * 工作流文本格式的错误模型。
 *
 * 解析器、表达式解析器和序列化器共用这一层，以保证所有错误都使用同一种
 * 文件名、行号、列号和提示格式。本模块不依赖具体语法，便于各解析阶段单独测试。
 */

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
  constructor(
    readonly path: string | null,
    readonly number: number,
    readonly text: string,
  ) {}

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
