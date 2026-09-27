/**
 * `.owf` 的**行级符号扫描**：在解析器之外补一层「位置 ↔ 符号」的映射。
 *
 * 为什么需要它：解析器产出的图文档里只有节点 id / 类型 / 坐标，没有行号——而大纲、
 * 跳转定义、悬停提示都需要行号。权威语法决定了这层扫描可以非常薄：
 *
 * - 缩进每层 2 空格，结构关键字（`node` / `var` / `group` / `comment`）只出现在行首；
 * - 变量节点的 id 由 `var <scope>.<key>` 派生（`var__<scope>__<key>`），所以看见
 *   `var` 就等于看见了 id；
 * - 顶层边表是 `源[:引脚] -> 目标[:引脚]`，一行一条。
 *
 * 因此这里**只做行级正则**，不重复实现缩进语义：真正的语法判断（缩进跳级、键重复、
 * 连线写错位置……）全部交给解析器，扫描结果永远不会取代解析诊断。
 */
'use strict';

/** 只在不含 `#` 注释与引号错乱的行上做匹配：先切掉行尾注释。 */
function stripComment(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '\\') index += 1;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

/** 缩进宽度（空格数）；Tab 会让解析器报错，这里按 1 列处理避免越界。 */
function indentOf(line) {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0].length : 0;
}

/** 去掉一层引号；不是引号串就原样返回。 */
function unquote(text) {
  if (text && text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(.)/g, (_, char) => (
      char === 'n' ? '\n' : char === 't' ? '\t' : char
    ));
  }
  return text;
}

/**
 * 切开 `节点[:引脚]`。引脚按**第一个**冒号切（节点 id 里不允许有冒号）；空串返回 null。
 *
 * 之所以不用一条正则一次切完：`\S+?` 配 `$` 在长裸词上会触发灾难性回溯（见节点头行注释），
 * 而这里按位置切是线性复杂度，且 `node:pin:extra` 这种写坏的行会被解析器报错，不会被静默吞掉。
 * @param {string} text 片段，如 `round_state_selector:then.0`。
 * @returns {{node: string, pin: string}|null} 切分结果。
 */
function splitNodePin(text) {
  if (!text) return null;
  const colon = text.indexOf(':');
  if (colon < 0) return { node: text, pin: '' };
  return { node: text.slice(0, colon), pin: text.slice(colon + 1) };
}

/**
 * 扫描一份 `.owf` 文本。
 * @param {string} text 文件全文。
 * @returns {ScanResult} 符号表与引用表。
 */
function scan(text) {
  const lines = text.split(/\r\n|\n|\r/);
  /** @type {NodeSymbol[]} */
  const nodes = [];
  /** @type {VarSymbol[]} */
  const variables = [];
  /** @type {BlockSymbol[]} */
  const groups = [];
  /** @type {BlockSymbol[]} */
  const comments = [];
  /** @type {EdgeSymbol[]} */
  const edges = [];
  /** @type {KeySymbol[]} */
  const documentKeys = [];
  /** @type {ContainerSymbol[]} */
  const containers = [];
  /** @type {Map<string, NodeSymbol|VarSymbol>} */
  const byId = new Map();

  /** 当前所在的通用块（`inputs` / `variables` / `nodeTypes`）与它下属键的缩进。 */
  let container = null;
  /** 当前所在的 `edges:` 块，用来判断 `waypoints` 是否属于上一条边。 */
  let edgeIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const indent = indentOf(raw);
    const body = stripComment(raw).trim();
    if (body === '') continue;
    const lineNumber = index + 1;

    // 通用块结束：回到不比块内更深的层级时，块上下文失效（同一缩进或更浅）。
    if (container && indent <= container.indent) container = null;
    if (edgeIndent >= 0 && indent <= edgeIndent && !/^waypoints\s*:/.test(body)) edgeIndent = -1;

    // 头行：`workflow <id>`
    let match = /^workflow\s+(\S+)\s*$/.exec(body);
    if (match) {
      documentKeys.push({ key: 'workflow', value: match[1], line: lineNumber, indent });
      continue;
    }

    // 节点头行：`node <id> <type> ["显示名"]`
    //
    // 这里**刻意不用** `/^node\s+(\S+)\s+(\S+)(?:\s+(".*"))?\s*$/`：末尾的 `$` 配合前面两个
    // 贪婪 `\S+` 会让引擎在「显示名是裸词」（`node root root 入口`）时做指数级回溯，
    // 在部分 Node 版本上直接匹配失败（实测 Node 24）。改成「取前两个 token，余下自己解析」，
    // 复杂度是线性的，且显示名是裸词（非法但可解析）时也能定位到行。
    match = /^node\s+(\S+)\s+(\S+)([\s\S]*)$/.exec(body);
    if (match) {
      const rest = match[3].trim();
      const symbol = {
        kind: 'node',
        id: match[1],
        type: match[2],
        // 显示名按格式规范必须加引号；裸词留着让解析器去报错，这里只如实记录。
        label: rest.startsWith('"') && rest.endsWith('"') ? unquote(rest) : rest,
        line: lineNumber,
        indent,
        container: container ? container.key : null,
      };
      nodes.push(symbol);
      if (!byId.has(symbol.id)) byId.set(symbol.id, symbol);
      continue;
    }

    // 变量节点：`var <scope>.<key>`
    match = /^var\s+(inputs|variables)\.(\S+)\s*$/.exec(body);
    if (match) {
      const scope = match[1];
      const key = match[2];
      const symbol = {
        kind: 'variable',
        id: `var__${scope}__${key}`,
        scope,
        name: key,
        line: lineNumber,
        indent,
      };
      variables.push(symbol);
      if (!byId.has(symbol.id)) byId.set(symbol.id, symbol);
      continue;
    }

    // 分组 / 注释框：`group <id> ["标题"]`、`comment <id> ["标题"]`
    // 同样避开「贪婪 `\S+` + `$`」的回溯陷阱（见节点头行的说明）。
    match = /^(group|comment)\s+(\S+)([\s\S]*)$/.exec(body);
    if (match) {
      const rest = match[3].trim();
      const symbol = {
        kind: match[1],
        id: match[2],
        label: rest.startsWith('"') && rest.endsWith('"') ? unquote(rest) : rest,
        line: lineNumber,
        indent,
      };
      if (match[1] === 'group') groups.push(symbol);
      else comments.push(symbol);
      continue;
    }

    // 顶层边表行：`源[:引脚] -> 目标[:引脚]`
    // 左右两侧都拆成「先取节点名，再单独切引脚」，不用 `\S+?` 配 `$` 的回溯写法。
    if (body.includes('->')) {
      const arrow = body.indexOf('->');
      const from = splitNodePin(body.slice(0, arrow).trim());
      const to = splitNodePin(body.slice(arrow + 2).trim());
      if (from && to) {
        edges.push({
          from: from.node,
          fromPin: from.pin || 'then.0',
          to: to.node,
          toPin: to.pin || 'in',
          line: lineNumber,
          indent,
        });
        continue;
      }
    }

    // `edges:` 块头
    if (/^edges\s*:/.test(body)) {
      edgeIndent = indent;
      continue;
    }

    // 通用块头：`inputs:` / `variables:` / `nodeTypes:` / `limits:` / `_inputParams:` …
    //
    // 判据是「键 + 冒号 + 无值」，**并且缩进不比当前块更深**：`inputs:` 下面那层
    // `v_3a3d…:` 也是「键 + 冒号 + 无值」，但它比 `inputs` 深，属于块内条目而不是新块。
    // 顺序也不能反：块内条目只认「当前块缩进更深」的行，块头只认「不比你深」的行。
    const isBlockHead = /^([^\s#":,\[\]{}|]+)\s*:\s*$/.test(body);
    if (isBlockHead && (!container || indent <= container.indent)) {
      const key = /^([^\s#":,\[\]{}|]+)/.exec(body)[1];
      container = { key, line: lineNumber, indent, entries: [] };
      containers.push(container);
      continue;
    }

    // 通用块内的条目：`<键>:` 或 `<键>: <值>`（值也可能是 `|` 长文本块或行内列表）
    match = /^(".*"|[^\s#":,\[\]{}|]+)\s*:([\s\S]*)$/.exec(body);
    if (match) {
      const key = unquote(match[1]);
      const value = match[2].trim();
      if (container && indent > container.indent) {
        container.entries.push({ key, value, line: lineNumber });
      } else if (indent === 0 || indent === 2) {
        documentKeys.push({ key, value, line: lineNumber, indent });
      }
    }
  }

  return {
    lines,
    nodes,
    variables,
    groups,
    comments,
    edges,
    documentKeys,
    containers,
    byId,
    idsByName: buildNameIndex(nodes, variables),
  };
}

/**
 * 建立「名字 → 符号」索引，供 `nodes.<id>` 这类引用解析用。
 * 变量节点的 id 有两种写法：派生 id（`var__inputs__键`）与人类可读的 `inputs.键`。
 * @param {NodeSymbol[]} nodes 节点符号。
 * @param {VarSymbol[]} variables 变量符号。
 * @returns {Map<string, NodeSymbol|VarSymbol>} 索引。
 */
function buildNameIndex(nodes, variables) {
  const index = new Map();
  for (const node of nodes) index.set(node.id, node);
  for (const variable of variables) {
    index.set(variable.id, variable);
    index.set(`${variable.scope}.${variable.name}`, variable);
  }
  return index;
}

/**
 * 在一个文档里找出 `nodes.<id>` / `variables.<id>` / `inputs.<键>` 形式的引用。
 * 只认「裸词引用」：加引号的写法按字符串处理（与格式规范一致）。
 * @param {string} text 文件全文。
 * @returns {ReferenceHit[]} 引用命中列表（按行升序）。
 */
function findReferences(text) {
  const lines = text.split(/\r\n|\n|\r/);
  /** @type {ReferenceHit[]} */
  const hits = [];
  const pattern = /\b(nodes|variables|inputs)\.([\w\u4e00-\u9fff.-]+)/g;

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripComment(lines[index]);
    // 引号内的内容不算引用：逐段跳过字符串。
    const skip = quotedRanges(line);
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      if (skip.some(([start, end]) => match.index >= start && match.index < end)) continue;
      hits.push({
        scope: match[1],
        name: match[2],
        text: match[0],
        line: index + 1,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return hits;
}

/**
 * 找出一行里所有引号串的区间（含引号本身），用于把字符串排除在引用识别之外。
 * @param {string} line 一行原文。
 * @returns {Array<[number, number]>} `[起, 止)` 区间。
 */
function quotedRanges(line) {
  /** @type {Array<[number, number]>} */
  const ranges = [];
  let open = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\') { index += 1; continue; }
    if (char !== '"') continue;
    if (open < 0) open = index;
    else {
      ranges.push([open, index + 1]);
      open = -1;
    }
  }
  if (open >= 0) ranges.push([open, line.length]);
  return ranges;
}

/**
 * @typedef {object} NodeSymbol
 * @property {'node'} kind
 * @property {string} id
 * @property {string} type
 * @property {string} label 显示名（运行时字段 `name`），可为空。
 * @property {number} line 1 基行号。
 * @property {number} indent 缩进宽度。
 * @property {string|null} container 所属通用块键（变量卡节点会在 `variables:` 块里）。
 */

/**
 * @typedef {object} VarSymbol
 * @property {'variable'} kind
 * @property {string} id 派生 id（`var__<scope>__<key>`）。
 * @property {string} scope `inputs` 或 `variables`。
 * @property {string} name 变量键。
 * @property {number} line
 * @property {number} indent
 */

/**
 * @typedef {object} BlockSymbol
 * @property {'group'|'comment'} kind
 * @property {string} id
 * @property {string} label
 * @property {number} line
 * @property {number} indent
 */

/**
 * @typedef {object} EdgeSymbol
 * @property {string} from
 * @property {string} fromPin
 * @property {string} to
 * @property {string} toPin
 * @property {number} line
 * @property {number} indent
 */

/**
 * @typedef {object} KeySymbol
 * @property {string} key
 * @property {string} value
 * @property {number} line
 * @property {number} indent
 */

/**
 * @typedef {object} ContainerSymbol
 * @property {string} key
 * @property {number} line
 * @property {number} indent
 * @property {Array<{key: string, value: string, line: number}>} [entries]
 */

/**
 * @typedef {object} ReferenceHit
 * @property {'nodes'|'variables'|'inputs'} scope
 * @property {string} name 引用里的名字部分。
 * @property {string} text 完整引用文本。
 * @property {number} line 1 基行号。
 * @property {number} start 0 基起始列。
 * @property {number} end 0 基结束列。
 */

/**
 * @typedef {object} ScanResult
 * @property {string[]} lines
 * @property {NodeSymbol[]} nodes
 * @property {VarSymbol[]} variables
 * @property {BlockSymbol[]} groups
 * @property {BlockSymbol[]} comments
 * @property {EdgeSymbol[]} edges
 * @property {KeySymbol[]} documentKeys
 * @property {ContainerSymbol[]} containers
 * @property {Map<string, NodeSymbol|VarSymbol>} byId
 * @property {Map<string, NodeSymbol|VarSymbol>} idsByName
 */

module.exports = { scan, findReferences, stripComment, unquote };
