/** `.owf` 中缀表达式与运行时操作数对象之间的双向转换。 */
import { SourceLine } from './errors';
import { isRecord, oneKeyDict, pyRepr } from './support';
import { parseQuoted, parseToken, renderInline } from './values';

/** 中缀比较符到运行时运算符的映射。 */
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
const KNOWN_OPERATORS = new Set<string>([...ARITY_TWO, 'and', 'or', 'not', 'exists']);
const PRECEDENCE: Record<string, number> = { or: 1, and: 2, not: 3, exists: 3 };
const COMPARISON_PRECEDENCE = 4;
const WORD_STOP = new Set(' \t()"=!<>'.split(''));

/** 表达式词法记号。 */
export interface Token {
  kind: 'lp' | 'rp' | 'op' | 'kw' | 'literal';
  value: any;
  column: number;
}

/** 把中缀表达式切成带列号的词法记号。 */
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

/** 按 `or → and → not/exists → 比较 → 原子` 的优先级递归下降解析。 */
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
    if (leftover !== null) throw this.line.error(`表达式里有多余的内容 ${pyRepr(leftover.value)}`, leftover.column);
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

/** 把中缀文本解析成运行时操作数对象。 */
export function parseExpression(text: string, line: SourceLine | null = null, offset = 1): any {
  const source = line ?? new SourceLine(null, 1, text);
  return new ExpressionParser(tokenize(text, source, offset), source).parse();
}

function wrap(text: string, precedence: number, parentPrecedence: number): string {
  return precedence < parentPrecedence ? `(${text})` : text;
}

/** 把操作数对象递归渲染成中缀表达式。 */
function renderNode(node: any, parentPrecedence: number): string | null {
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

/** 把运行时操作数对象输出为规范中缀表达式；无法表示时返回 `null`。 */
export function renderExpression(node: any): string | null {
  return renderNode(node, 0);
}
