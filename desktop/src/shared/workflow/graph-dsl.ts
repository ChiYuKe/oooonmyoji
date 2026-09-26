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
import { DslError, SourceLine } from './dsl/errors';
import {
  isNumber,
  isRecord,
  lstripWs,
  pyIterable,
  pyRepr,
  pyStrip,
  pyTruthy,
  rstripWs,
  setKey,
  splitLines,
} from './dsl/support';
import {
  INLINE_WIDTH,
  parseInline,
  parseQuoted,
  parseText,
  renderIdentifier,
  renderInline,
  renderNumber,
  renderScalar,
  splitCommas,
} from './dsl/values';
import { parseExpression, renderExpression } from './dsl/expression';
import { normalizeDocument } from './dsl/normalize';
import { decodePosition, decodePositions, decodeSize, pairsToPoints, pointsToPairs } from './dsl/geometry';
import {
  DEFAULT_EXEC_OUT_PIN,
  DOCUMENT_SCHEMA_VERSION,
  EXEC_IN_PIN,
  EXEC_OUT_PIN,
  INDENT,
  POSITION_KEYS,
  SIZE_KEYS,
} from './dsl/syntax';

// 保留原模块的公开入口，调用方无需随内部拆分修改导入路径。
export { DslError, SourceLine } from './dsl/errors';
export type { DslErrorOptions } from './dsl/errors';
export * from './dsl/values';
export * from './dsl/expression';
export { normalizeDocument } from './dsl/normalize';
export { DOCUMENT_SCHEMA_VERSION, INDENT } from './dsl/syntax';

/** 工作流文档的磁盘后缀。磁盘上只有这一种格式，JSON 已退役。 */
export const WORKFLOW_SUFFIX = '.owf';

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
