// 本文件由 extensions/vscode-owf/scripts/build-parser.mjs 生成，请勿手工编辑。
// 入口：desktop/src/shared/workflow/graph-dsl.ts
// 权威语法：docs/workflow-dsl-v6.md
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../desktop/src/shared/workflow/graph-dsl.ts
var graph_dsl_exports = {};
__export(graph_dsl_exports, {
  DOCUMENT_SCHEMA_VERSION: () => DOCUMENT_SCHEMA_VERSION,
  DslError: () => DslError,
  INDENT: () => INDENT,
  INLINE_WIDTH: () => INLINE_WIDTH,
  SourceLine: () => SourceLine,
  WORKFLOW_SUFFIX: () => WORKFLOW_SUFFIX,
  emitDocument: () => emitDocument,
  emitRuntimeDocument: () => emitRuntimeDocument,
  formatNumber: () => formatNumber,
  isBareWord: () => isBareWord,
  isRefToken: () => isRefToken,
  needsQuote: () => needsQuote,
  normalizeDocument: () => normalizeDocument,
  parseDocument: () => parseDocument,
  parseExpression: () => parseExpression,
  parseInline: () => parseInline,
  parseQuoted: () => parseQuoted,
  parseText: () => parseText,
  parseToken: () => parseToken,
  quoteString: () => quoteString,
  readDocumentId: () => readDocumentId,
  renderExpression: () => renderExpression,
  renderIdentifier: () => renderIdentifier,
  renderInline: () => renderInline,
  renderNumber: () => renderNumber,
  renderScalar: () => renderScalar,
  renderStringBlock: () => renderStringBlock,
  splitCommas: () => splitCommas,
  splitElements: () => splitElements,
  tokenKind: () => tokenKind,
  tokenize: () => tokenize
});
module.exports = __toCommonJS(graph_dsl_exports);

// ../../desktop/src/shared/workflow/types.ts
var NODE_TYPES = ["root", "selector", "sequence", "simple_parallel", "parallel", "repeat_until", "branch", "switch", "instance_parallel", "condition", "bool_judge", "break", "task", "group_entry", "group_exit"];

// ../../desktop/src/shared/workflow/graph-document.ts
var GRAPH_SCHEMA_VERSION = 6;
var BUILTIN_NODE_TYPES = new Set(NODE_TYPES);
var CUSTOM_TYPE_MARKER = "_nodeType";
var VARIABLE_NODE_TYPE = "variable";
var VARIABLE_SCOPES = ["inputs", "variables"];
var NODE_STRUCTURE_KEYS = ["children", "ports", "default_child"];
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function cloneValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (isRecord(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = cloneValue(child);
    return out;
  }
  return value;
}
function isGraphDocument(raw) {
  return isRecord(raw) && raw.schema_version === GRAPH_SCHEMA_VERSION;
}
function variableNodeId(scope, name, usedIds) {
  let candidate = `var__${scope}__${name}`;
  while (usedIds.has(candidate)) candidate += "_";
  usedIds.add(candidate);
  return candidate;
}
var GROUP_INTERFACE_PREFIX = "__node_group_interface__:";
var GROUP_VARIABLES_PREFIX = "__node_group_variables__:";
var EDGE_WAYPOINTS_KEY = "_edgeWaypoints";
function canonicalPin(pin) {
  return pin === "then" ? "then.0" : pin;
}
function edgeIdentity(edge) {
  const from = edge?.from;
  const to = edge?.to;
  if (!isRecord(from) || !isRecord(to)) return "";
  if (typeof from.node !== "string" || typeof from.pin !== "string") return "";
  if (typeof to.node !== "string" || typeof to.pin !== "string") return "";
  return `${from.node}\0${canonicalPin(from.pin)}\0${to.node}\0${to.pin}`;
}
function readWaypoints(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isPosition(item)).map((item) => ({ x: Math.trunc(item.x), y: Math.trunc(item.y) }));
}
function isPosition(value) {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}
var BOOL_JUDGE_OPERANDS = ["left", "right"];
function boolJudgeOperator(node) {
  const expression = node?.expression;
  if (!isRecord(expression)) return null;
  const keys = Object.keys(expression);
  if (keys.length !== 1) return null;
  const operator = keys[0];
  const operands = expression[operator];
  if (operator === "ref" || !Array.isArray(operands) || operands.length !== 2) return null;
  return operator;
}
function payloadPathToPin(node, path) {
  const type = node?.type;
  if (path.length === 0) return null;
  const head = path[0];
  if (head === "params") {
    const rest = path.slice(1);
    if (rest.length === 0) return null;
    if (rest[0] === "inputs" && rest.length > 1) return `inputs.${rest.slice(1).join(".")}`;
    return rest.join(".");
  }
  if (head === "expression") {
    if (path.length === 1) {
      if (type === "condition" || type === "bool_judge") return "condition";
      if (type === "switch") return "expression";
      return null;
    }
    if (type === "bool_judge" && path.length === 3 && /^\d+$/.test(String(path[2]))) {
      if (boolJudgeOperator(node) !== String(path[1])) return null;
      const index = Number(path[2]);
      if (index >= 0 && index < BOOL_JUDGE_OPERANDS.length) return BOOL_JUDGE_OPERANDS[index];
    }
    return null;
  }
  if (head === "condition" && type === "repeat_until" && path.length === 1) return "condition";
  if (head === "ref" && type === "break" && path.length === 1) return "ref";
  if (head === "conditions" && type === "branch" && path.length === 2) return `conditions.${path[1]}`;
  if (head === "runs" && type === "instance_parallel" && path.length >= 4 && path[2] === "inputs") {
    return `runs.${path[1]}.inputs.${path.slice(3).join(".")}`;
  }
  if (head === "decorators" && path.length === 3) return `decorators.${path[1]}.${path[2]}`;
  return null;
}
function iterNodeRefs(value, path = []) {
  const found = [];
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const ref = value.ref;
    if (keys.length === 1 && keys[0] === "ref" && typeof ref === "string") {
      if (ref.startsWith("nodes.")) found.push([path, ref]);
      return found;
    }
    for (const key of keys) found.push(...iterNodeRefs(value[key], [...path, key]));
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => found.push(...iterNodeRefs(child, [...path, index])));
  }
  return found;
}
function iterVariableRefs(value, path = []) {
  const found = [];
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const ref = value.ref;
    if (keys.length === 1 && keys[0] === "ref" && typeof ref === "string") {
      if (ref.startsWith("inputs.") || ref.startsWith("variables.")) found.push([path, ref]);
      return found;
    }
    for (const key of keys) found.push(...iterVariableRefs(value[key], [...path, key]));
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => found.push(...iterVariableRefs(child, [...path, index])));
  }
  return found;
}
function resolveSegment(container, segment) {
  if (Array.isArray(container) && typeof segment === "string" && /^\d+$/.test(segment)) return Number(segment);
  return segment;
}
function deleteAtPath(target, path) {
  let current = target;
  for (const rawSegment of path.slice(0, -1)) {
    const segment = resolveSegment(current, rawSegment);
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return;
      current = current[segment];
    } else {
      if (!isRecord(current) || !(segment in current)) return;
      current = current[segment];
    }
  }
  const last = resolveSegment(current, path[path.length - 1]);
  if (typeof last === "number") {
    if (Array.isArray(current) && last < current.length) current[last] = null;
  } else if (isRecord(current)) {
    delete current[last];
  }
}
function toGraphDocument(raw) {
  if (isGraphDocument(raw)) return raw;
  if (!isRecord(raw)) return raw;
  const document = raw;
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const layout = isRecord(document._layout) ? document._layout : {};
  const locks = new Set((Array.isArray(document._layoutLocks) ? document._layoutLocks : []).map(String));
  const converted = nodes.map((node) => {
    const payload = {};
    for (const [key, value] of Object.entries(node || {})) {
      if (NODE_STRUCTURE_KEYS.includes(key)) continue;
      if (key === CUSTOM_TYPE_MARKER) continue;
      if (key === "cases" && Array.isArray(value)) {
        payload.cases = value.map((entry) => isRecord(entry) ? { value: cloneValue(entry.value) } : { value: cloneValue(entry) });
        continue;
      }
      payload[key] = cloneValue(value);
    }
    const customType = node?.[CUSTOM_TYPE_MARKER];
    if (typeof customType === "string" && customType) payload.type = customType;
    const at = layout[String(node?.id)];
    if (isRecord(at) && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      payload.at = { x: Math.trunc(at.x), y: Math.trunc(at.y) };
    }
    if (locks.has(String(node?.id))) payload.locked = true;
    return payload;
  });
  const usedNodeIds = new Set(nodes.map((node) => String(node?.id)));
  const variableNodes = /* @__PURE__ */ new Map();
  const variableNodeFor = (scope, name) => {
    const key = `${scope}\0${name}`;
    const existing = variableNodes.get(key);
    if (existing) return existing;
    const node = {
      id: variableNodeId(scope, name, usedNodeIds),
      type: VARIABLE_NODE_TYPE,
      scope,
      name
    };
    variableNodes.set(key, node);
    return node;
  };
  const cards = isRecord(document._variableCards) ? document._variableCards : {};
  for (const card of Object.values(cards)) {
    if (!isRecord(card)) continue;
    const name = typeof card.name === "string" ? card.name : "";
    if (!name) continue;
    const scope = card.scope === "variables" ? "variables" : "inputs";
    const node = variableNodeFor(scope, name);
    if (!("at" in node) && Number.isFinite(card.x) && Number.isFinite(card.y)) {
      node.at = { x: Math.trunc(card.x), y: Math.trunc(card.y) };
    }
  }
  const edges = [];
  const waypointTable = /* @__PURE__ */ new Map();
  for (const entry of Array.isArray(document[EDGE_WAYPOINTS_KEY]) ? document[EDGE_WAYPOINTS_KEY] : []) {
    const key = edgeIdentity(entry);
    const waypoints = readWaypoints(entry?.waypoints);
    if (key && waypoints.length) waypointTable.set(key, waypoints);
  }
  const attachWaypoints = (edge) => {
    const waypoints = waypointTable.get(edgeIdentity(edge));
    if (waypoints) edge.waypoints = cloneValue(waypoints);
  };
  const link = (sourceId, pin, targetId) => {
    if (typeof sourceId !== "string" || typeof targetId !== "string") return;
    const edge = { from: { node: sourceId, pin }, to: { node: targetId, pin: "in" } };
    attachWaypoints(edge);
    edges.push(edge);
  };
  nodes.forEach((node, index) => {
    const payload = converted[index];
    const extractions = iterNodeRefs(payload).map(([path, ref]) => ({ path, ref, pin: payloadPathToPin(node, path) })).filter((item) => item.pin !== null);
    for (const item of extractions) {
      const parts = item.ref.split(".");
      const outputField = parts.slice(3).join(".");
      const edge = {
        from: { node: parts[1], pin: outputField ? `out.${outputField}` : "out" },
        to: { node: String(node?.id), pin: item.pin }
      };
      attachWaypoints(edge);
      edges.push(edge);
      deleteAtPath(payload, item.path);
    }
    for (const [path, ref] of iterVariableRefs(payload)) {
      const pin = payloadPathToPin(node, path);
      if (pin === null) continue;
      const [scope, ...rest] = ref.split(".");
      if (!VARIABLE_SCOPES.includes(scope) || rest.length === 0) continue;
      const [name, ...nested] = rest;
      const source = variableNodeFor(scope, name);
      const edge = {
        from: { node: source.id, pin: nested.length ? `out.${nested.join(".")}` : "out" },
        to: { node: String(node?.id), pin }
      };
      attachWaypoints(edge);
      edges.push(edge);
      deleteAtPath(payload, path);
    }
  });
  for (const node of nodes) {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (node?.type === "condition") {
      const declared = Array.isArray(node?.ports) ? node.ports : [];
      const used = /* @__PURE__ */ new Set();
      children.forEach((child, position) => {
        let port = typeof declared[position] === "string" ? declared[position] : "";
        if (port !== "true" && port !== "false" || used.has(port)) port = used.has("true") ? "false" : "true";
        used.add(port);
        link(node?.id, port, child);
      });
    } else if (node?.type === "switch") {
      const cases = Array.isArray(node?.cases) ? node.cases : [];
      cases.forEach((entry, index) => {
        if (isRecord(entry) && typeof entry.child === "string") link(node?.id, `case.${index}`, entry.child);
      });
      if (typeof node?.default_child === "string") link(node?.id, "default", node.default_child);
    } else {
      children.forEach((child, position) => link(node?.id, `then.${position}`, child));
    }
  }
  const groups = [];
  const nodeGroups = isRecord(document._nodeGroups) ? document._nodeGroups : {};
  for (const [groupId, value] of Object.entries(nodeGroups)) {
    if (!isRecord(value)) continue;
    const members = (Array.isArray(value.nodeIds) ? value.nodeIds : []).filter((id) => typeof id === "string");
    if (!members.length) continue;
    const entry = { id: groupId };
    if (typeof value.name === "string" && value.name) entry.name = value.name;
    entry.nodeIds = members;
    if (Array.isArray(value.pins)) entry.pins = cloneValue(value.pins);
    if (typeof value.pinPolicy === "string") entry.pinPolicy = value.pinPolicy;
    for (const [key, layoutKey] of [
      ["at", groupId],
      ["interfaceAt", `${GROUP_INTERFACE_PREFIX}${groupId}`],
      ["variablesAt", `${GROUP_VARIABLES_PREFIX}${groupId}`]
    ]) {
      if (isPosition(layout[layoutKey])) {
        entry[key] = { x: Math.trunc(layout[layoutKey].x), y: Math.trunc(layout[layoutKey].y) };
      }
    }
    groups.push(entry);
  }
  const result = { schema_version: GRAPH_SCHEMA_VERSION };
  for (const [key, value] of Object.entries(document)) {
    if (key === "schema_version" || key === "nodes" || key === "edges") continue;
    if (key === "_layout" || key === "_layoutLocks") continue;
    if (key === "_variableCards" || key === "_variableLinks") continue;
    if (key === "_nodeGroups") continue;
    if (key === EDGE_WAYPOINTS_KEY) continue;
    result[key] = value;
  }
  result.nodes = [...converted, ...variableNodes.values()];
  result.edges = edges;
  if (groups.length) result.groups = groups;
  return result;
}

// ../../desktop/src/shared/workflow/dsl/errors.ts
var DslError = class extends Error {
  line;
  column;
  source;
  path;
  hint;
  constructor(message, options = {}) {
    super(message);
    this.name = "DslError";
    this.line = options.line ?? null;
    this.column = options.column ?? null;
    this.source = options.source ?? null;
    this.path = options.path ?? null;
    this.hint = options.hint ?? null;
  }
  /** 与 Python `DslError.render()` 同形的多行信息：定位头、原文行、插入符、提示。 */
  render() {
    const where = this.path || "<text>";
    const head = this.line === null ? `${where}: ${this.message}` : `${where}:${this.line}:${this.column || 1}: ${this.message}`;
    const parts = [head];
    if (this.source !== null) {
      parts.push(`  ${String(this.line).padStart(4)} | ${this.source}`);
      if (this.column) parts.push(`       | ${" ".repeat(Math.max(0, this.column - 1))}^`);
    }
    if (this.hint) parts.push(`  提示：${this.hint}`);
    return parts.join("\n");
  }
  toString() {
    return this.render();
  }
};
var SourceLine = class {
  constructor(path, number, text) {
    this.path = path;
    this.number = number;
    this.text = text;
  }
  error(message, column = 1, hint) {
    return new DslError(message, {
      line: this.number,
      column: Math.max(1, column),
      source: this.text,
      path: this.path,
      hint: hint ?? null
    });
  }
};

// ../../desktop/src/shared/workflow/dsl/support.ts
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function setKey(target, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    return;
  }
  target[key] = value;
}
function oneKeyDict(key, value) {
  const result = {};
  setKey(result, key, value);
  return result;
}
function deepClone(value) {
  if (Array.isArray(value)) return value.map((item) => deepClone(item));
  if (isRecord2(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) setKey(out, key, deepClone(child));
    return out;
  }
  return value;
}
var PY_SPACE = " \\t\\n\\r\\v\\f\\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
var STRIP_END = new RegExp(`[${PY_SPACE}]+$`);
var STRIP_START = new RegExp(`^[${PY_SPACE}]+`);
function pyStrip(text) {
  return text.replace(STRIP_START, "").replace(STRIP_END, "");
}
function lstripWs(text) {
  return text.replace(STRIP_START, "");
}
function rstripWs(text) {
  return text.replace(STRIP_END, "");
}
function splitLines(text) {
  const lines = text.split(/\r\n|[\n\r\v\f\u001c\u001d\u001e\u0085\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function pyRepr(value) {
  if (value === null || value === void 0) return "None";
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => pyRepr(item)).join(", ")}]`;
  if (isRecord2(value)) {
    return `{${Object.entries(value).map(([key, child]) => `${pyRepr(key)}: ${pyRepr(child)}`).join(", ")}}`;
  }
  return String(value);
}
function isNumber(value) {
  return typeof value === "number";
}
function pyTruthy(value) {
  if (value === null || value === void 0 || value === false) return false;
  if (value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord2(value)) return Object.keys(value).length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  return true;
}
function pyIterable(value) {
  if (Array.isArray(value)) return value;
  if (!pyTruthy(value)) return [];
  if (typeof value === "string") return value.split("");
  if (isRecord2(value)) return Object.keys(value);
  return [];
}

// ../../desktop/src/shared/workflow/dsl/values.ts
var INLINE_WIDTH = 96;
var INT_RE = /^-?[0-9]+$/;
var FLOAT_RE = /^-?(?:[0-9]+\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?$/;
var BARE_STOP = new Set(' 	\r\n#",:[]{}'.split(""));
var REF_PREFIXES = ["nodes.", "inputs.", "variables."];
var ESCAPES = /* @__PURE__ */ new Map([
  ["n", "\n"],
  ["t", "	"],
  ["r", "\r"],
  ['"', '"'],
  ["\\", "\\"]
]);
function isRefToken(token) {
  return REF_PREFIXES.some((prefix) => token.startsWith(prefix));
}
function tokenKind(token) {
  if (INT_RE.test(token)) return "int";
  if (FLOAT_RE.test(token)) return "float";
  if (token === "true" || token === "false") return "bool";
  if (token === "null") return "null";
  if (isRefToken(token)) return "ref";
  return "string";
}
function parseToken(token, line, column) {
  const kind = tokenKind(token);
  if (kind === "int") return Number.parseInt(token, 10);
  if (kind === "float") return Number.parseFloat(token);
  if (kind === "bool") return token === "true";
  if (kind === "null") return null;
  if (kind === "ref") return { ref: token };
  for (const char of token) {
    if (BARE_STOP.has(char)) {
      throw line.error(`裸词里不能出现 ${pyRepr(char)}；含空格或分隔符的字符串请加引号`, column + token.indexOf(char));
    }
  }
  return token;
}
function parseQuoted(text, start, line) {
  let out = "";
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      if (index + 1 >= text.length) throw line.error("转义符后面没有字符", index + 1);
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
  throw line.error("字符串没有闭合的引号", start + 1);
}
function splitElements(body, line, offset) {
  const elements = [];
  let depth = 0;
  let start = null;
  let index = 0;
  let quoted = false;
  while (index < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === "\\") {
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
    if (char === "[" || char === "{") {
      depth += 1;
      if (start === null) start = index;
      index += 1;
      continue;
    }
    if (char === "]" || char === "}") {
      depth -= 1;
      if (depth < 0) throw line.error("括号不匹配", offset + index + 1);
      index += 1;
      continue;
    }
    if (depth === 0 && (char === "," || char === " " || char === "	")) {
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
  if (quoted) throw line.error("字符串没有闭合的引号", offset + body.length);
  if (depth !== 0) throw line.error("括号不匹配", offset + body.length);
  if (start !== null) elements.push({ text: body.slice(start), column: offset + start });
  return elements;
}
function splitCommas(body, line, offset) {
  const elements = [];
  let start = null;
  let index = 0;
  let quoted = false;
  while (index < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === "\\") {
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
    if (char === ",") {
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
  if (quoted) throw line.error("字符串没有闭合的引号", offset + body.length);
  if (start !== null) elements.push({ text: pyStrip(body.slice(start)), column: offset + start });
  return elements.filter((element) => element.text);
}
function parseInline(text, line, offset = 1) {
  const stripped = pyStrip(text);
  if (!stripped) throw line.error("缺少值", offset + text.length);
  const column = offset + text.indexOf(stripped[0]);
  if (stripped === "{}") return {};
  if (stripped === "[]") return [];
  if (stripped.startsWith("[")) {
    if (!stripped.endsWith("]")) throw line.error("行内列表缺少右括号 ]", column);
    const inner = stripped.slice(1, -1);
    if (!pyStrip(inner)) return [];
    return splitElements(inner, line, column + 1).map((element) => parseInline(element.text, line, element.column));
  }
  if (stripped.startsWith("{")) {
    throw line.error("行内对象只支持空对象 {}", column, "非空对象写成子块：键: 后换行缩进");
  }
  if (stripped.startsWith('"')) {
    const [value, end] = parseQuoted(stripped, 0, line);
    if (pyStrip(stripped.slice(end))) throw line.error("字符串后面还有多余内容", column + end);
    return value;
  }
  return parseToken(stripped, line, column);
}
function isBareWord(text) {
  if (!text || text[0] === "-") return false;
  for (const char of text) if (BARE_STOP.has(char)) return false;
  return true;
}
function parseText(text, line, column = 1) {
  const stripped = pyStrip(text);
  if (!stripped) throw line.error("缺少内容", column);
  if (stripped.startsWith('"')) {
    const [value, end] = parseQuoted(stripped, 0, line);
    if (pyStrip(stripped.slice(end))) throw line.error("字符串后面还有多余内容", column + end);
    return value;
  }
  for (const char of stripped) {
    if (BARE_STOP.has(char)) {
      throw line.error(`裸词里不能出现 ${pyRepr(char)}；要写这种内容请加引号`, column + stripped.indexOf(char));
    }
  }
  return stripped;
}
function renderIdentifier(value) {
  return isBareWord(value) ? value : quoteString(value);
}
function quoteString(value) {
  let out = '"';
  for (const char of value) {
    if (char === "\\") out += "\\\\";
    else if (char === '"') out += '\\"';
    else if (char === "\n") out += "\\n";
    else if (char === "	") out += "\\t";
    else if (char === "\r") out += "\\r";
    else out += char;
  }
  return `${out}"`;
}
function needsQuote(value) {
  if (!value || value[0] === "-") return true;
  for (const char of value) if (BARE_STOP.has(char)) return true;
  return tokenKind(value) !== "string";
}
var EXPR_KEYWORDS = /* @__PURE__ */ new Set(["and", "or", "not", "contains", "exists"]);
function renderScalar(value, options = {}) {
  if (needsQuote(value) || options.expression && EXPR_KEYWORDS.has(value)) return quoteString(value);
  return value;
}
function decimalDigits(value) {
  const text = Math.abs(value).toExponential();
  const [mantissa, exponent] = text.split("e");
  return {
    sign: value < 0 ? "-" : "",
    digits: mantissa.replace(".", ""),
    exp: Number.parseInt(exponent, 10)
  };
}
function plainDecimal(value) {
  const { sign, digits, exp } = decimalDigits(value);
  if (exp >= 0) {
    const integer = digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits + "0".repeat(exp + 1 - digits.length);
    const fraction = digits.length > exp + 1 ? digits.slice(exp + 1) : "";
    return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
  }
  return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
}
function pythonReprFloat(value) {
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "inf";
  if (value === Number.NEGATIVE_INFINITY) return "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const { sign, digits, exp } = decimalDigits(value);
  if (exp <= -5 || exp >= 16) {
    const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${mantissa}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  if (exp >= 0) {
    const integer = digits.length > exp + 1 ? digits.slice(0, exp + 1) : digits + "0".repeat(exp + 1 - digits.length);
    const fraction = digits.length > exp + 1 ? digits.slice(exp + 1) : "0";
    return `${sign}${integer}.${fraction}`;
  }
  return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
}
function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  const text = pythonReprFloat(value);
  return Number(text) === value ? text : String(value);
}
function renderNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) {
    const text = String(value);
    return /[eE]/.test(text) ? plainDecimal(value) : text;
  }
  return formatNumber(value);
}
function renderInline(value, options = {}) {
  const expression = options.expression ?? false;
  if (value === null || value === void 0) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return renderNumber(value);
  if (typeof value === "string") return renderScalar(value, { expression });
  if (isRecord2(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return "{}";
    if (keys.length === 1 && keys[0] === "ref" && typeof value.ref === "string") {
      const ref = value.ref;
      return isRefToken(ref) && isBareWord(ref) ? ref : null;
    }
    return null;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const parts = [];
    for (const item of value) {
      const text = renderInline(item, { expression });
      if (text === null) return null;
      parts.push(text);
    }
    const joined = `[${parts.join(", ")}]`;
    return joined.length <= INLINE_WIDTH ? joined : null;
  }
  return null;
}
function renderStringBlock(value) {
  return value.split("\n");
}

// ../../desktop/src/shared/workflow/dsl/expression.ts
var COMPARISONS = /* @__PURE__ */ new Map([
  ["==", "eq"],
  ["!=", "ne"],
  [">", "gt"],
  [">=", "gte"],
  ["<", "lt"],
  ["<=", "lte"],
  ["contains", "contains"]
]);
var ARITY_TWO = /* @__PURE__ */ new Set(["eq", "ne", "gt", "gte", "lt", "lte", "contains"]);
var KNOWN_OPERATORS = /* @__PURE__ */ new Set([...ARITY_TWO, "and", "or", "not", "exists"]);
var PRECEDENCE = { or: 1, and: 2, not: 3, exists: 3 };
var COMPARISON_PRECEDENCE = 4;
var WORD_STOP = new Set(' 	()"=!<>'.split(""));
function tokenize(text, line, offset = 1) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === " " || char === "	") {
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ kind: "lp", value: "(", column: offset + index });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "rp", value: ")", column: offset + index });
      index += 1;
      continue;
    }
    if (char === '"') {
      const [value, end2] = parseQuoted(text, index, line);
      tokens.push({ kind: "literal", value, column: offset + index });
      index = end2;
      continue;
    }
    let matched = null;
    for (const symbol of ["==", "!=", ">=", "<=", ">", "<"]) {
      if (text.startsWith(symbol, index)) {
        matched = symbol;
        break;
      }
    }
    if (matched !== null) {
      tokens.push({ kind: "op", value: matched, column: offset + index });
      index += matched.length;
      continue;
    }
    if (char === "=" || char === "!") {
      throw line.error("比较要写 == / !=（单个 = 不是运算符）", offset + index, "等于：a == b；不等于：a != b");
    }
    let end = index;
    while (end < text.length && !WORD_STOP.has(text[end])) end += 1;
    const word = text.slice(index, end);
    if (!word) throw line.error(`表达式里读不懂的字符 ${pyRepr(char)}`, offset + index);
    if (word === "contains") {
      tokens.push({ kind: "op", value: "contains", column: offset + index });
    } else if (word === "and" || word === "or" || word === "not" || word === "exists") {
      tokens.push({ kind: "kw", value: word, column: offset + index });
    } else {
      tokens.push({ kind: "literal", value: parseToken(word, line, offset + index), column: offset + index });
    }
    index = end;
  }
  return tokens;
}
var ExpressionParser = class {
  constructor(tokens, line) {
    this.tokens = tokens;
    this.line = line;
  }
  index = 0;
  peek() {
    return this.index < this.tokens.length ? this.tokens[this.index] : null;
  }
  take() {
    const token = this.peek();
    if (token === null) throw this.line.error("表达式没有写完", this.line.text.length + 1);
    this.index += 1;
    return token;
  }
  matchKeyword(word) {
    const token = this.peek();
    if (token !== null && token.kind === "kw" && token.value === word) {
      this.index += 1;
      return true;
    }
    return false;
  }
  parse() {
    const node = this.parseOr();
    const leftover = this.peek();
    if (leftover !== null) throw this.line.error(`表达式里有多余的内容 ${pyRepr(leftover.value)}`, leftover.column);
    return node;
  }
  parseOr() {
    const items = [this.parseAnd()];
    while (this.matchKeyword("or")) items.push(this.parseAnd());
    return items.length === 1 ? items[0] : { or: items };
  }
  parseAnd() {
    const items = [this.parseNot()];
    while (this.matchKeyword("and")) items.push(this.parseNot());
    return items.length === 1 ? items[0] : { and: items };
  }
  parseNot() {
    if (this.matchKeyword("not")) return { not: this.parseNot() };
    if (this.matchKeyword("exists")) {
      const operand = this.parseOperand();
      if (!(isRecord2(operand) && Object.keys(operand).length === 1 && Object.hasOwn(operand, "ref"))) {
        throw this.line.error("exists 的操作数必须是一条引用（nodes.x.output.y）", 1);
      }
      return { exists: operand };
    }
    return this.parseComparison();
  }
  parseComparison() {
    const left = this.parseOperand();
    const token = this.peek();
    if (token === null || token.kind !== "op") return left;
    this.index += 1;
    const right = this.parseOperand();
    const chained = this.peek();
    if (chained !== null && chained.kind === "op") {
      throw this.line.error("表达式不支持链式比较", chained.column, "写成 a < b and b < c");
    }
    return oneKeyDict(COMPARISONS.get(token.value), [left, right]);
  }
  parseOperand() {
    const token = this.take();
    if (token.kind === "lp") {
      const node = this.parseOr();
      const closing = this.peek();
      if (closing === null || closing.kind !== "rp") throw this.line.error("括号没有闭合", token.column);
      this.index += 1;
      return node;
    }
    if (token.kind === "literal") return token.value;
    throw this.line.error(`表达式的操作数位置出现了 ${pyRepr(token.value)}`, token.column);
  }
};
function parseExpression(text, line = null, offset = 1) {
  const source = line ?? new SourceLine(null, 1, text);
  return new ExpressionParser(tokenize(text, source, offset), source).parse();
}
function wrap(text, precedence, parentPrecedence) {
  return precedence < parentPrecedence ? `(${text})` : text;
}
function renderNode(node, parentPrecedence) {
  if (isRecord2(node) && Object.keys(node).length === 1 && KNOWN_OPERATORS.has(Object.keys(node)[0])) {
    const operator = Object.keys(node)[0];
    const operands = node[operator];
    if (ARITY_TWO.has(operator)) {
      if (!Array.isArray(operands) || operands.length !== 2) return null;
      const left = renderNode(operands[0], COMPARISON_PRECEDENCE);
      const right = renderNode(operands[1], COMPARISON_PRECEDENCE);
      if (left === null || right === null) return null;
      let symbol = null;
      for (const [key, value] of COMPARISONS) {
        if (value === operator) {
          symbol = key;
          break;
        }
      }
      if (symbol === null) return null;
      return wrap(`${left} ${symbol} ${right}`, COMPARISON_PRECEDENCE, parentPrecedence);
    }
    if (operator === "and" || operator === "or") {
      if (!Array.isArray(operands) || operands.length < 2) return null;
      const parts = operands.map((item) => renderNode(item, PRECEDENCE[operator]));
      if (parts.some((part) => part === null)) return null;
      const joiner = operator === "and" ? " and " : " or ";
      return wrap(parts.join(joiner), PRECEDENCE[operator], parentPrecedence);
    }
    if (operator === "not") {
      const inner = renderNode(operands, PRECEDENCE.not);
      if (inner === null) return null;
      return wrap(`not ${inner}`, PRECEDENCE.not, parentPrecedence);
    }
    if (operator === "exists") {
      if (!(isRecord2(operands) && Object.keys(operands).length === 1 && Object.hasOwn(operands, "ref"))) return null;
      const reference = renderInline(operands);
      if (reference === null) return null;
      return wrap(`exists ${reference}`, PRECEDENCE.exists, parentPrecedence);
    }
    return null;
  }
  return renderInline(node, { expression: true });
}
function renderExpression(node) {
  return renderNode(node, 0);
}

// ../../desktop/src/shared/workflow/dsl/syntax.ts
var INDENT = 2;
var DOCUMENT_SCHEMA_VERSION = GRAPH_SCHEMA_VERSION;
var DEFAULT_EXEC_OUT_PIN = "then.0";
var EXEC_OUT_PIN = "then";
var EXEC_IN_PIN = "in";
var POSITION_KEYS = ["at", "interfaceAt", "variablesAt"];
var SIZE_KEYS = ["size"];

// ../../desktop/src/shared/workflow/dsl/geometry.ts
function decodePosition(value) {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
    return { x: value[0], y: value[1] };
  }
  return value;
}
function decodeSize(value) {
  if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
    return { w: value[0], h: value[1] };
  }
  return value;
}
function decodePositions(mapping) {
  for (const key of POSITION_KEYS) {
    const value = mapping[key];
    if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
      setKey(mapping, key, decodePosition(value));
    }
  }
  for (const key of SIZE_KEYS) {
    const value = mapping[key];
    if (Array.isArray(value) && value.length === 2 && value.every((item) => isNumber(item))) {
      setKey(mapping, key, decodeSize(value));
    }
  }
  return mapping;
}
function pointsToPairs(waypoints) {
  if (!Array.isArray(waypoints)) return null;
  const pairs = [];
  for (const point of waypoints) {
    if (!isRecord2(point) || Object.keys(point).length !== 2 || !Object.hasOwn(point, "x") || !Object.hasOwn(point, "y") || !isNumber(point.x) || !isNumber(point.y)) {
      return null;
    }
    pairs.push([point.x, point.y]);
  }
  return pairs;
}
function pairsToPoints(value) {
  if (!Array.isArray(value)) return value;
  const points = [];
  for (const pair of value) {
    if (!(Array.isArray(pair) && pair.length === 2 && pair.every((item) => isNumber(item)))) return value;
    points.push({ x: pair[0], y: pair[1] });
  }
  return points;
}

// ../../desktop/src/shared/workflow/dsl/normalize.ts
var EXPRESSION_KEYS = ["expression", "condition"];
function normalizeDocument(document) {
  if (!isRecord2(document)) throw new DslError("图文档不是对象");
  const result = deepClone(document);
  setKey(result, "schema_version", GRAPH_SCHEMA_VERSION);
  for (const key of ["inputs", "variables"]) {
    if (!isRecord2(result[key])) setKey(result, key, {});
  }
  const nodes = result.nodes;
  if (!Array.isArray(nodes)) throw new DslError("图文档缺少 nodes 数组");
  const edges = result.edges;
  if (Array.isArray(edges) && edges.length) {
    setKey(result, "edges", edges.map((edge) => normalizeEdge(edge)));
  } else {
    delete result.edges;
  }
  for (const key of ["groups", "comments"]) {
    if (Array.isArray(result[key]) && !result[key].length) delete result[key];
  }
  for (const node of nodes) {
    if (isRecord2(node)) normalizeNodeExpressions(node);
  }
  return result;
}
function normalizeEdge(edge) {
  const normalized = deepClone(edge);
  if (!isRecord2(normalized)) return normalized;
  for (const side of ["from", "to"]) {
    const binding = normalized[side];
    if (isRecord2(binding) && binding.pin === "then") setKey(binding, "pin", "then.0");
  }
  if (Array.isArray(normalized.waypoints) && !normalized.waypoints.length) delete normalized.waypoints;
  return normalized;
}
function normalizeNodeExpressions(node) {
  for (const key of EXPRESSION_KEYS) {
    if (Object.hasOwn(node, key)) setKey(node, key, normalizeExpression(node[key]));
  }
  if (Array.isArray(node.conditions)) {
    setKey(node, "conditions", node.conditions.map((item) => normalizeExpression(item)));
  }
}
function normalizeExpression(value) {
  if (!isRecord2(value) || Object.keys(value).length !== 1) return value;
  const operator = Object.keys(value)[0];
  const operands = value[operator];
  if ((operator === "and" || operator === "or") && Array.isArray(operands)) {
    const flattened = [];
    for (const raw of operands) {
      const operand = normalizeExpression(raw);
      if (isRecord2(operand) && Object.keys(operand).length === 1 && Object.hasOwn(operand, operator) && Array.isArray(operand[operator])) {
        flattened.push(...operand[operator]);
      } else {
        flattened.push(operand);
      }
    }
    return oneKeyDict(operator, flattened);
  }
  if (operator === "not") return oneKeyDict("not", normalizeExpression(operands));
  if (operator === "exists") return oneKeyDict("exists", operands);
  if (Array.isArray(operands)) return oneKeyDict(operator, operands.map((item) => normalizeExpression(item)));
  return oneKeyDict(operator, normalizeExpression(operands));
}

// ../../desktop/src/shared/workflow/graph-dsl.ts
var WORKFLOW_SUFFIX = ".owf";
var HEADER_ORDER = ["version", "description", "resolution", "root", "retry_safe", "limits"];
var CONTAINER_ORDER = ["inputs", "variables", "nodeTypes"];
var STRUCTURAL_TOP_KEYS = ["id", "schema_version", "nodes", "edges", "groups", "comments", "workflow"];
var NODE_KEY_ORDER = [
  "at",
  "size",
  "locked",
  "comment",
  "action",
  "params",
  "expression",
  "condition",
  "conditions",
  "cases",
  "decorators",
  "runs",
  "wait_for",
  "cancel_on_failure",
  "finish_mode",
  "max_iterations",
  "ref",
  "fields"
];
var EXPRESSION_KEYS2 = ["expression", "condition"];
var EDIT_FORM_FIELDS = ["children", "ports", "default_child"];
var Entry = class {
  constructor(indent, body, column, line) {
    this.indent = indent;
    this.body = body;
    this.column = column;
    this.line = line;
  }
};
function stripComment(raw) {
  let quoted = false;
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (quoted) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === "#") {
      return raw.slice(0, index);
    }
    index += 1;
  }
  return raw;
}
function findColon(body) {
  let quoted = false;
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ":") {
      return index;
    }
    index += 1;
  }
  return -1;
}
function isItem(body) {
  return body === "-" || body.startsWith("- ");
}
function findArrow(body) {
  let quoted = false;
  let index = 0;
  while (index + 1 < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === "-" && body[index + 1] === ">") {
      return index;
    }
    index += 1;
  }
  return -1;
}
function splitWords(text) {
  const words = [];
  let current = "";
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
    if (char === " " || char === "	") {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}
var Parser = class {
  rawLines;
  path;
  index = 0;
  constructor(text, path) {
    this.rawLines = splitLines(text);
    this.path = path;
  }
  // ---- 行工具 -----------------------------------------------------------------------
  source(index) {
    return new SourceLine(this.path, index + 1, this.rawLines[index]);
  }
  skipNoise() {
    while (this.index < this.rawLines.length) {
      const raw = this.rawLines[this.index];
      const stripped = pyStrip(raw);
      if (!stripped || stripped.startsWith("#")) {
        this.index += 1;
        continue;
      }
      return;
    }
  }
  peekEntry() {
    for (; ; ) {
      this.skipNoise();
      if (this.index >= this.rawLines.length) return null;
      const raw = this.rawLines[this.index];
      let indent = 0;
      for (const char of raw) {
        if (char === " ") indent += 1;
        else if (char === "	") {
          throw this.source(this.index).error("缩进不能用 Tab", indent + 1, `每层用 ${INDENT} 个空格`);
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
  takeEntry(indent) {
    const entry = this.peekEntry();
    if (entry === null) return null;
    if (entry.indent < indent) return null;
    if (entry.indent > indent) {
      throw entry.line.error(
        `缩进跳级：这一层是 ${indent} 个空格，本行是 ${entry.indent} 个`,
        entry.column,
        `子块正好比父行多 ${INDENT} 个空格`
      );
    }
    this.index += 1;
    return entry;
  }
  rawIndent(raw) {
    let count = 0;
    for (const char of raw) {
      if (char === " ") count += 1;
      else break;
    }
    return count;
  }
  // ---- 通用块 -----------------------------------------------------------------------
  parseContainer(indent) {
    const entry = this.peekEntry();
    if (entry !== null && entry.indent === indent && isItem(entry.body)) return this.parseList(indent);
    return this.parseMap(indent);
  }
  parseChild(indent, line) {
    const entry = this.peekEntry();
    if (entry === null || entry.indent <= indent) return {};
    if (entry.indent !== indent + INDENT) {
      throw entry.line.error(
        `子块缩进要正好比父行多 ${INDENT} 个空格（父行 ${indent}，本行 ${entry.indent}）`,
        entry.column
      );
    }
    return this.parseContainer(entry.indent);
  }
  parseMap(indent, first = null) {
    const result = {};
    let entry = first;
    for (; ; ) {
      if (entry === null) {
        entry = this.takeEntry(indent);
        if (entry === null) break;
      } else if (isItem(entry.body)) {
        throw entry.line.error("这一层不能把列表项与键混在一起", entry.column);
      }
      const { key, rest, column } = this.splitKey(entry);
      if (Object.hasOwn(result, key)) throw entry.line.error(`键重复：${key}`, entry.column);
      setKey(result, key, this.parseValue(rest, column, indent, entry.line));
      entry = null;
    }
    return result;
  }
  parseList(indent) {
    const items = [];
    for (; ; ) {
      const entry = this.takeEntry(indent);
      if (entry === null) break;
      if (!isItem(entry.body)) throw entry.line.error("这一层不能把键与列表项混在一起", entry.column);
      const body = lstripWs(entry.body.slice(1));
      const column = body ? entry.column + entry.body.indexOf(body) : entry.column + 1;
      if (!body) {
        items.push(this.parseChild(indent, entry.line));
        continue;
      }
      if (body === "|") {
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
  looksLikeEntry(body) {
    const colon = findColon(body);
    if (colon <= 0) return false;
    const key = body.slice(0, colon);
    return key === rstripWs(key) && !/[ \t]/.test(key);
  }
  splitKey(entry) {
    const colon = findColon(entry.body);
    if (colon < 0) throw entry.line.error("这一行缺少 :（键与值之间要写冒号）", entry.column);
    const rawKey = entry.body.slice(0, colon);
    if (rawKey !== rstripWs(rawKey)) throw entry.line.error("键与冒号之间不能有空格", entry.column + colon);
    if (!rawKey) throw entry.line.error("缺少键名", entry.column);
    const key = parseText(rawKey, entry.line, entry.column);
    const rest = lstripWs(entry.body.slice(colon + 1));
    const column = entry.column + colon + 1 + (entry.body.length - colon - 1 - rest.length);
    return { key, rest, column };
  }
  parseValue(rest, column, indent, line) {
    if (!rest) return this.parseChild(indent, line);
    if (rest === "|") return this.parseTextBlock(indent);
    return parseInline(rest, line, column);
  }
  parseTextBlock(indent) {
    const collected = [];
    while (this.index < this.rawLines.length) {
      const raw = this.rawLines[this.index];
      if (!pyStrip(raw)) {
        collected.push("");
        this.index += 1;
        continue;
      }
      if (this.rawIndent(raw) <= indent) break;
      collected.push(raw);
      this.index += 1;
    }
    while (collected.length && !pyStrip(collected[collected.length - 1])) collected.pop();
    if (!collected.length) return "";
    let cut = Number.POSITIVE_INFINITY;
    for (const item of collected) {
      if (pyStrip(item)) cut = Math.min(cut, this.rawIndent(item));
    }
    return collected.map((item) => pyStrip(item) ? item.slice(cut) : "").join("\n");
  }
  parseExpressionValue(rest, column, indent, line) {
    if (rest) return parseExpression(rest, line, column);
    const value = this.parseChild(indent, line);
    if (!isRecord2(value)) throw line.error("表达式要么写成中缀，要么写成操作数对象的子块", column);
    return value;
  }
  parseExpressionList(rest, column, indent, line) {
    if (rest) {
      const stripped = pyStrip(rest);
      if (!stripped.startsWith("[")) {
        throw line.error("条件列表要么写 [a == 1, b == 2]，要么用缩进的 - 项", column);
      }
      if (!stripped.endsWith("]")) {
        throw line.error("条件列表缺少右括号 ]", column, "每一项是一段中缀表达式，用逗号分隔");
      }
      const inner = stripped.slice(1, -1);
      if (!pyStrip(inner)) return [];
      return splitCommas(inner, line, column + 1).map(
        (element) => parseExpression(element.text, line, element.column)
      );
    }
    const items = [];
    for (; ; ) {
      const entry = this.takeEntry(indent + INDENT);
      if (entry === null) break;
      if (!isItem(entry.body)) throw entry.line.error("条件列表的每一项都要以 - 开头", entry.column);
      const body = lstripWs(entry.body.slice(1));
      const itemColumn = body ? entry.column + entry.body.indexOf(body) : entry.column + 1;
      if (!body) throw entry.line.error("条件列表项不能为空", entry.column);
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
  parse() {
    const entry = this.peekEntry();
    if (entry === null) throw new DslError("文档是空的", { path: this.path });
    if (entry.indent !== 0) throw entry.line.error("第一行不能缩进", entry.column);
    const words = splitWords(entry.body);
    if (!words.length || words[0] !== "workflow") {
      throw entry.line.error("第一行必须写成 workflow <id>", entry.column);
    }
    if (words.length !== 2) {
      throw entry.line.error("workflow 头行只接受一个 id：workflow <id>", entry.column);
    }
    this.index += 1;
    const document = {
      schema_version: DOCUMENT_SCHEMA_VERSION,
      id: parseText(words[1], entry.line, entry.column + "workflow ".length)
    };
    const nodes = [];
    const edges = [];
    const groups = [];
    const comments = [];
    let sawEdges = false;
    for (; ; ) {
      const item = this.takeEntry(INDENT);
      if (item === null) break;
      const body = item.body;
      const head = body.split(" ", 1)[0];
      if (head === "node") {
        nodes.push(this.parseNode(item));
      } else if (head === "var") {
        nodes.push(this.parseVar(item));
      } else if (head === "group") {
        groups.push(this.parseDeclared(item, "group"));
      } else if (head === "comment") {
        comments.push(this.parseDeclared(item, "comment"));
      } else {
        const { key, rest, column } = this.splitKey(item);
        if (key === "workflow") throw item.line.error("workflow 头行只能出现一次", item.column);
        if (key === "edges") {
          if (sawEdges) throw item.line.error("edges 块只能写一次", item.column);
          if (rest) throw item.line.error("edges 下面直接写连线，不要在同一行写值", column);
          this.parseEdges(item, edges);
          sawEdges = true;
          continue;
        }
        if (key === "schema_version") {
          throw item.line.error("schema_version 由格式决定，不要在文档里写", item.column);
        }
        if (Object.hasOwn(document, key)) {
          throw item.line.error(`顶层键重复：${key}`, item.column);
        }
        if (key === "version" || key === "description") {
          setKey(document, key, rest ? this.parseTextValue(rest, column, item.line) : "");
        } else if (key === "root") {
          setKey(document, key, parseText(rest, item.line, column));
        } else {
          setKey(document, key, this.parseValue(rest, column, INDENT, item.line));
        }
      }
    }
    if (!Object.hasOwn(document, "version")) {
      throw new DslError("文档缺少 version：工作流版本号", { path: this.path });
    }
    if (!Object.hasOwn(document, "resolution")) {
      throw new DslError("文档缺少 resolution：[宽, 高]", { path: this.path });
    }
    if (!Object.hasOwn(document, "root")) {
      throw new DslError("文档缺少 root：根节点 id", { path: this.path });
    }
    if (!Object.hasOwn(document, "inputs")) setKey(document, "inputs", {});
    if (!Object.hasOwn(document, "variables")) setKey(document, "variables", {});
    setKey(document, "nodes", nodes);
    if (edges.length) setKey(document, "edges", edges);
    if (groups.length) setKey(document, "groups", groups);
    if (comments.length) setKey(document, "comments", comments);
    return document;
  }
  parseTextValue(rest, column, line) {
    if (rest === "|") return this.parseTextBlock(INDENT);
    return parseText(rest, line, column);
  }
  /** `group` / `comment` 这类「位置参数 + 通用块」的声明。 */
  parseDeclared(entry, keyword) {
    const words = splitWords(pyStrip(entry.body.slice(keyword.length)));
    if (!words.length) throw entry.line.error(`${keyword} 后面要写 id`, entry.column);
    if (words.length > 2) throw entry.line.error(`${keyword} 只接受 id 与可选的显示名`, entry.column);
    const declared = {
      id: parseText(words[0], entry.line, entry.column + keyword.length + 1)
    };
    if (words.length === 2) {
      setKey(declared, keyword === "group" ? "name" : "text", this.parseTextToken(words[1], entry.line));
    }
    const mapping = this.parseMap(entry.indent + INDENT);
    Object.assign(declared, decodePositions(mapping));
    return declared;
  }
  parseTextToken(token, line) {
    if (token.startsWith('"')) {
      const [value] = parseQuoted(token, 0, line);
      return value;
    }
    return parseText(token, line, 1);
  }
  parseNode(entry) {
    const words = splitWords(pyStrip(entry.body.slice("node".length)));
    if (words.length < 2) {
      throw entry.line.error('node 头行要写 node <id> <类型> ["显示名"]', entry.column);
    }
    if (words.length > 3) {
      throw entry.line.error("node 头行最多三个位置参数：id、类型、显示名", entry.column);
    }
    const node = {
      id: parseText(words[0], entry.line, entry.column + "node ".length),
      type: parseText(words[1], entry.line, entry.column + "node ".length + words[0].length + 1)
    };
    if (words.length === 3) setKey(node, "name", this.parseTextToken(words[2], entry.line));
    this.parseNodeBody(entry, node);
    return node;
  }
  parseVar(entry) {
    const rest = pyStrip(entry.body.slice("var".length));
    const dot = rest.indexOf(".");
    const scope = dot < 0 ? rest : rest.slice(0, dot);
    const keyToken = dot < 0 ? "" : rest.slice(dot + 1);
    if (dot < 0 || !keyToken) {
      throw entry.line.error("变量节点要写 var <inputs|variables>.<键>", entry.column + "var ".length);
    }
    if (scope !== "inputs" && scope !== "variables") {
      throw entry.line.error(
        `变量节点的作用域只能是 inputs / variables，读到 ${pyRepr(scope)}`,
        entry.column + "var ".length
      );
    }
    const key = parseText(keyToken, entry.line, entry.column + "var ".length + scope.length + 1);
    const node = {
      id: `var__${scope}__${key}`,
      type: "variable",
      scope,
      name: key
    };
    this.parseNodeBody(entry, node);
    return node;
  }
  parseEdges(entry, edges) {
    const indent = entry.indent + INDENT;
    for (; ; ) {
      const item = this.takeEntry(indent);
      if (item === null) return;
      if (isItem(item.body)) throw item.line.error("edges 里的连线不加 - 前缀", item.column);
      if (findArrow(item.body) < 0) {
        throw item.line.error(
          "连线要写成 <源节点>[:源引脚] -> <目标节点>[:目标引脚]",
          item.column,
          "例如 root -> round 或 round:then.1 -> pick"
        );
      }
      edges.push(this.parseWire(item, indent));
    }
  }
  parseNodeBody(entry, node) {
    const indent = entry.indent + INDENT;
    const seen = /* @__PURE__ */ new Set();
    for (; ; ) {
      const item = this.takeEntry(indent);
      if (item === null) break;
      if (findArrow(item.body) >= 0) {
        throw item.line.error(
          `连线不写在节点块里：节点 ${node.id} 的连线要写到顶层 edges 块`,
          item.column,
          "字面量里真的要写 -> 时请加引号"
        );
      }
      if (item.body === "decorator" || item.body.startsWith("decorator ")) {
        if (!Object.hasOwn(node, "decorators")) setKey(node, "decorators", []);
        const decorators = node.decorators;
        if (!Array.isArray(decorators)) throw item.line.error("decorators 必须是列表", item.column);
        decorators.push(this.parseDecorator(item, indent));
        continue;
      }
      const { key, rest, column } = this.splitKey(item);
      if (key === "decorator") throw item.line.error("装饰器要写成 decorator <类型>", item.column);
      if (seen.has(key)) throw item.line.error(`键重复：${key}`, item.column);
      seen.add(key);
      if (key === "id" || key === "type") {
        throw item.line.error(`${key} 写在 node 头行上，不要在块里重复`, item.column);
      }
      if (key === "name") {
        if (Object.hasOwn(node, "name")) throw item.line.error("显示名重复（头行已经写过）", item.column);
        setKey(node, "name", rest ? this.parseTextValue(rest, column, item.line) : "");
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
      if (EXPRESSION_KEYS2.includes(key)) {
        setKey(node, key, this.parseExpressionValue(rest, column, indent, item.line));
        continue;
      }
      if (key === "conditions") {
        setKey(node, key, this.parseExpressionList(rest, column, indent, item.line));
        continue;
      }
      setKey(node, key, this.parseValue(rest, column, indent, item.line));
    }
  }
  parseDecorator(entry, indent) {
    const rest = pyStrip(entry.body.slice("decorator".length));
    if (!rest) {
      throw entry.line.error("decorator 后面要写类型（cooldown / timeout / retry / repeat / do_once）", entry.column);
    }
    const decorator = {
      type: parseText(rest, entry.line, entry.column + "decorator ".length)
    };
    const extra = this.parseMap(indent + INDENT);
    if (Object.hasOwn(extra, "type")) throw entry.line.error("decorator 的类型写在头行上", entry.column);
    Object.assign(decorator, extra);
    return decorator;
  }
  parseWire(entry, indent) {
    const body = entry.body;
    const arrow = findArrow(body);
    const left = pyStrip(body.slice(0, arrow));
    const right = pyStrip(body.slice(arrow + 2));
    if (!left) throw entry.line.error("连线缺少源节点", entry.column);
    if (!right) throw entry.line.error("连线缺少目标节点", entry.column + arrow + 2);
    const [sourceNode, sourcePin] = this.splitEndpoint(left, DEFAULT_EXEC_OUT_PIN, entry, entry.column);
    const [targetNode, targetPin] = this.splitEndpoint(
      right,
      EXEC_IN_PIN,
      entry,
      entry.column + arrow + 2
    );
    const edge = {
      from: { node: sourceNode, pin: sourcePin },
      to: { node: targetNode, pin: targetPin }
    };
    const child = this.parseChild(indent, entry.line);
    if (child && (!Array.isArray(child) || child.length)) {
      const unknown = Array.isArray(child) ? Array.from(new Set(child.map((item) => String(item)))) : Object.keys(child).filter((key) => key !== "waypoints");
      if (unknown.length) {
        throw entry.line.error(`连线块里只支持 waypoints，读到 ${pyRepr(unknown.sort())}`, entry.column);
      }
      if (!Array.isArray(child)) {
        const waypoints = child.waypoints;
        if (waypoints !== void 0 && waypoints !== null) edge.waypoints = pairsToPoints(waypoints);
      }
    }
    return edge;
  }
  splitEndpoint(text, defaultPin, entry, column) {
    const stripped = pyStrip(text);
    if (stripped.startsWith('"')) {
      const [node2, end] = parseQuoted(stripped, 0, entry.line);
      const rest = pyStrip(stripped.slice(end));
      if (!rest) return [node2, defaultPin];
      if (!rest.startsWith(":")) {
        throw entry.line.error("引号节点 id 后面只能接 :引脚", column + end);
      }
      return [node2, pyStrip(rest.slice(1)) || defaultPin];
    }
    const separator = stripped.indexOf(":");
    const node = pyStrip(separator < 0 ? stripped : stripped.slice(0, separator));
    let pin = separator < 0 ? defaultPin : pyStrip(stripped.slice(separator + 1));
    if (!node) throw entry.line.error("连线的端点缺少节点 id", column);
    if (!pin) pin = defaultPin;
    return [parseText(node, entry.line, column), parseText(pin, entry.line, column + node.length + 1)];
  }
};
function parseDocument(text, path) {
  return new Parser(text, path ?? null).parse();
}
function readDocumentId(text) {
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const stripped = pyStrip(stripComment(raw));
    if (!stripped || stripped.startsWith("#")) continue;
    const words = splitWords(stripped);
    if (words.length !== 2 || words[0] !== "workflow") return null;
    try {
      return parseText(words[1], new SourceLine(null, index + 1, raw), raw.indexOf(words[1]) + 1);
    } catch (error) {
      if (error instanceof DslError) return null;
      throw error;
    }
  }
  return null;
}
var Writer = class {
  lines = [];
  line(depth, text) {
    this.lines.push(text ? " ".repeat(depth * INDENT) + text : "");
  }
  render() {
    while (this.lines.length && !this.lines[this.lines.length - 1]) this.lines.pop();
    return `${this.lines.join("\n")}
`;
  }
};
function requireField(node, key, label) {
  if (!isRecord2(node) || !Object.hasOwn(node, key)) {
    throw new DslError(`${label} 缺少字段 ${key}，写不成 .owf`);
  }
  return node[key];
}
function emitEntry(writer, depth, key, value) {
  const name = renderIdentifier(key);
  if (typeof value === "string" && value.includes("\n")) {
    writer.line(depth, `${name}: |`);
    for (const textLine of value.split("\n")) writer.line(depth + 1, textLine);
    return;
  }
  const inline = renderInline(value);
  if (inline !== null) {
    writer.line(depth, `${name}: ${inline}`);
    return;
  }
  if (isRecord2(value)) {
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
function emitList(writer, depth, items) {
  for (const item of items) emitListItem(writer, depth, item);
}
function emitListItem(writer, depth, value) {
  if (typeof value === "string" && value.includes("\n")) {
    writer.line(depth, "- |");
    for (const textLine of value.split("\n")) writer.line(depth + 1, textLine);
    return;
  }
  const inline = renderInline(value);
  if (inline !== null) {
    writer.line(depth, `- ${inline}`);
    return;
  }
  if (isRecord2(value)) {
    const keys = Object.keys(value);
    if (!keys.length) {
      writer.line(depth, "- {}");
      return;
    }
    emitItemHead(writer, depth, keys[0], value[keys[0]]);
    for (const key of keys.slice(1)) emitEntry(writer, depth + 1, key, value[key]);
    return;
  }
  if (Array.isArray(value)) {
    writer.line(depth, "-");
    emitList(writer, depth + 1, value);
    return;
  }
  throw new DslError(`列表项写不成 .owf：${pyRepr(value)}`);
}
function emitItemHead(writer, depth, key, value) {
  const name = renderIdentifier(key);
  if (typeof value === "string" && value.includes("\n")) {
    writer.line(depth, `- ${name}: |`);
    for (const textLine of value.split("\n")) writer.line(depth + 2, textLine);
    return;
  }
  const inline = renderInline(value);
  if (inline !== null) {
    writer.line(depth, `- ${name}: ${inline}`);
    return;
  }
  if (isRecord2(value)) {
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
function emitExpressionEntry(writer, depth, key, value) {
  const name = renderIdentifier(key);
  const text = renderExpression(value);
  if (text !== null) {
    writer.line(depth, `${name}: ${text}`);
    return;
  }
  if (isRecord2(value)) {
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
function emitExpressionList(writer, depth, key, items) {
  const name = renderIdentifier(key);
  if (!items.length) {
    writer.line(depth, `${name}: []`);
    return;
  }
  const rendered = items.map((item) => renderExpression(item));
  if (rendered.every((text) => text !== null)) {
    const inline = `[${rendered.join(", ")}]`;
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
function emitDecorators(writer, depth, decorators) {
  if (!decorators.length) {
    writer.line(depth, "decorators: []");
    return;
  }
  for (const decorator of decorators) {
    if (!isRecord2(decorator) || !Object.hasOwn(decorator, "type")) {
      throw new DslError(`装饰器缺少 type：${pyRepr(decorator)}`);
    }
    writer.line(depth, `decorator ${renderIdentifier(String(decorator.type))}`);
    for (const [key, value] of Object.entries(decorator)) {
      if (key === "type") continue;
      emitEntry(writer, depth + 1, key, value);
    }
  }
}
function emitPosition(writer, depth, key, value) {
  if (POSITION_KEYS.includes(key) && isRecord2(value) && Object.keys(value).length === 2 && Object.hasOwn(value, "x") && Object.hasOwn(value, "y") && isNumber(value.x) && isNumber(value.y)) {
    writer.line(depth, `${renderIdentifier(key)}: [${renderNumber(value.x)}, ${renderNumber(value.y)}]`);
    return true;
  }
  if (SIZE_KEYS.includes(key) && isRecord2(value) && Object.keys(value).length === 2 && Object.hasOwn(value, "w") && Object.hasOwn(value, "h") && isNumber(value.w) && isNumber(value.h)) {
    writer.line(depth, `${renderIdentifier(key)}: [${renderNumber(value.w)}, ${renderNumber(value.h)}]`);
    return true;
  }
  return false;
}
function emitWire(writer, depth, edge, ids) {
  const source = isRecord2(edge) && isRecord2(edge.from) ? edge.from : {};
  const target = isRecord2(edge) && isRecord2(edge.to) ? edge.to : {};
  const sourceNode = String(source.node || "");
  const targetNode = String(target.node || "");
  if (!sourceNode || !targetNode) throw new DslError(`连线缺少端点：${pyRepr(edge)}`);
  if (!ids.has(sourceNode)) throw new DslError(`连线的源节点不存在：${sourceNode}`);
  if (!ids.has(targetNode)) throw new DslError(`连线指向了不存在的节点：${targetNode}`);
  let sourcePin = String(source.pin || EXEC_OUT_PIN);
  if (sourcePin === EXEC_OUT_PIN) sourcePin = DEFAULT_EXEC_OUT_PIN;
  const targetPin = String(target.pin || EXEC_IN_PIN);
  const head = sourcePin === DEFAULT_EXEC_OUT_PIN ? renderIdentifier(sourceNode) : `${renderIdentifier(sourceNode)}:${renderIdentifier(sourcePin)}`;
  const tail = targetPin === EXEC_IN_PIN ? renderIdentifier(targetNode) : `${renderIdentifier(targetNode)}:${renderIdentifier(targetPin)}`;
  writer.line(depth, `${head} -> ${tail}`);
  const waypoints = isRecord2(edge) ? edge.waypoints : void 0;
  if (pyTruthy(waypoints)) {
    const pairs = pointsToPairs(waypoints);
    if (pairs === null) {
      emitEntry(writer, depth + 1, "waypoints", waypoints);
      return;
    }
    const inline = renderInline(pairs);
    if (inline !== null) {
      writer.line(depth + 1, `waypoints: ${inline}`);
      return;
    }
    writer.line(depth + 1, "waypoints:");
    emitList(writer, depth + 2, pairs);
  }
}
function emitNode(writer, depth, node) {
  const nodeId = String(requireField(node, "id", "节点"));
  const nodeType = String(requireField(node, "type", "节点"));
  const handled = /* @__PURE__ */ new Set(["id", "type", "name"]);
  if (nodeType === "variable") {
    const scope = node.scope;
    const name = node.name;
    if (scope !== "inputs" && scope !== "variables" || typeof name !== "string" || !name) {
      throw new DslError(`变量节点 ${nodeId} 缺少 scope / name，写不成 var 行`);
    }
    const expected = `var__${scope}__${name}`;
    if (nodeId !== expected) {
      throw new DslError(`变量节点 ${nodeId} 与派生 id ${expected} 不一致（v6 要求 id 由作用域与键派生）`);
    }
    writer.line(depth, `var ${scope}.${renderIdentifier(name)}`);
    handled.add("scope");
  } else {
    let header = `node ${renderIdentifier(nodeId)} ${renderIdentifier(nodeType)}`;
    if (Object.hasOwn(node, "name")) header += ` ${renderScalar(String(node.name))}`;
    writer.line(depth, header);
  }
  const body = depth + 1;
  for (const key of NODE_KEY_ORDER) {
    if (!Object.hasOwn(node, key)) continue;
    const value = node[key];
    handled.add(key);
    if (emitPosition(writer, body, key, value)) continue;
    if (key === "expression" || key === "condition") {
      emitExpressionEntry(writer, body, key, value);
      continue;
    }
    if (key === "conditions") {
      emitExpressionList(writer, body, key, Array.isArray(value) ? value : [value]);
      continue;
    }
    if (key === "decorators") {
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
function emitDeclared(writer, depth, keyword, declared, nameKey) {
  const identifier = String(requireField(declared, "id", keyword));
  let header = `${keyword} ${renderIdentifier(identifier)}`;
  if (Object.hasOwn(declared, nameKey) && declared[nameKey] !== null && declared[nameKey] !== void 0) {
    header += ` ${renderScalar(String(declared[nameKey]))}`;
  }
  writer.line(depth, header);
  for (const [key, value] of Object.entries(declared)) {
    if (key === "id" || key === nameKey) continue;
    if (emitPosition(writer, depth + 1, key, value)) continue;
    emitEntry(writer, depth + 1, key, value);
  }
}
function emitDocument(document) {
  if (!isRecord2(document)) throw new DslError("要写盘的文档不是对象");
  const nodes = document.nodes;
  if (!Array.isArray(nodes)) throw new DslError("图文档缺少 nodes 数组");
  for (const node of nodes) {
    for (const field of EDIT_FORM_FIELDS) {
      if (isRecord2(node) && Object.hasOwn(node, field)) {
        throw new DslError(`节点 ${node.id} 带着 ${field}：这是编辑形态（v4），要先转成图文档`);
      }
    }
  }
  const version = document.schema_version;
  if (version !== null && version !== void 0 && version !== 5 && version !== DOCUMENT_SCHEMA_VERSION) {
    throw new DslError(`只支持图文档（v5/v6）写盘，读到 schema_version=${pyRepr(version)}`);
  }
  const missing = ["version", "resolution", "root"].filter((key) => !Object.hasOwn(document, key));
  if (missing.length) {
    throw new DslError(`图文档缺少必需字段，写不成 .owf：${missing.join("、")}`);
  }
  const ids = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    if (isRecord2(node)) ids.add(String(node.id));
  }
  const edges = document.edges || [];
  const writer = new Writer();
  writer.line(0, `workflow ${renderIdentifier(String(requireField(document, "id", "文档")))}`);
  for (const key of HEADER_ORDER) {
    if (Object.hasOwn(document, key)) emitEntry(writer, 1, key, document[key]);
  }
  for (const key of CONTAINER_ORDER) {
    if (key === "inputs" || key === "variables") {
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
    if (!isRecord2(node)) throw new DslError(`nodes 里出现了不是对象的项：${pyRepr(node)}`);
    emitNode(writer, 1, node);
  }
  if (pyTruthy(edges)) {
    writer.line(1, "edges:");
    if (!Array.isArray(edges)) throw new DslError("edges 必须是数组，写不成顶层边表");
    for (const edge of edges) emitWire(writer, 2, edge, ids);
  }
  for (const group of pyIterable(document.groups)) emitDeclared(writer, 1, "group", group, "name");
  for (const comment of pyIterable(document.comments)) emitDeclared(writer, 1, "comment", comment, "text");
  return writer.render();
}
function emitRuntimeDocument(document) {
  return emitDocument(toGraphDocument(document));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DOCUMENT_SCHEMA_VERSION,
  DslError,
  INDENT,
  INLINE_WIDTH,
  SourceLine,
  WORKFLOW_SUFFIX,
  emitDocument,
  emitRuntimeDocument,
  formatNumber,
  isBareWord,
  isRefToken,
  needsQuote,
  normalizeDocument,
  parseDocument,
  parseExpression,
  parseInline,
  parseQuoted,
  parseText,
  parseToken,
  quoteString,
  readDocumentId,
  renderExpression,
  renderIdentifier,
  renderInline,
  renderNumber,
  renderScalar,
  renderStringBlock,
  splitCommas,
  splitElements,
  tokenKind,
  tokenize
});
