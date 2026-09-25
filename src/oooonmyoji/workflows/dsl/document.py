"""v6 工作流文本（``.owf``）的解析与序列化。

权威语法在 ``docs/workflow-dsl-v6.md``。两条不变量：

1. **解析产出与 v5 图文档同形的 dict**（只把 ``schema_version`` 提到 6），
   于是 ``graph_compile.py`` / ``graph_pins.py`` / ``graph_types.py`` 与整个运行时零改动。
2. **``parse(emit(doc)) == normalize_document(doc)``**：规范化只做三件有语义无损的事——
   边按源节点分组重排、``and`` / ``or`` 扁平化、删掉空的 ``edges`` / ``groups`` / ``comments``。
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .errors import DslError, SourceLine
from .expr import parse_expression, render_expression
from ..graph_schema import EXEC_IN_PIN, EXEC_OUT_PIN, GRAPH_SCHEMA_VERSION
from .values import (
    INLINE_WIDTH,
    parse_inline,
    parse_quoted,
    parse_text,
    render_identifier,
    render_inline,
    render_scalar,
    split_commas,
)

#: 落盘文本解析出来的文档版本。与图文档 schema 版本是同一个数（`.owf` 就是格式标记）。
DOCUMENT_SCHEMA_VERSION = GRAPH_SCHEMA_VERSION

#: 工作流文档的磁盘后缀。磁盘上只有这一种格式，JSON 已退役。
WORKFLOW_SUFFIX = ".owf"

#: 每层缩进的空格数。
INDENT = 2

#: 连线里省略源引脚时的默认口位（``then`` 的规范写法就是 ``then.0``）。
DEFAULT_EXEC_OUT_PIN = "then.0"

#: 位置类字段：``[x, y]`` ⇄ ``{"x": …, "y": …}``。
POSITION_KEYS = ("at", "interfaceAt", "variablesAt")
#: 尺寸类字段：``[w, h]`` ⇄ ``{"w": …, "h": …}``。
SIZE_KEYS = ("size",)

#: 文档头里按固定顺序输出的键。
_HEADER_ORDER = ("version", "description", "resolution", "root", "retry_safe", "limits")
#: 通用块形式的顶层键（输入/变量/自定义类型定义）。
_CONTAINER_ORDER = ("inputs", "variables", "nodeTypes")
#: 结构关键字：不是文档字段，而是 ``nodes`` / ``groups`` / ``comments`` 的入口。
_STRUCTURAL_TOP_KEYS = ("id", "schema_version", "nodes", "edges", "groups", "comments", "workflow")

#: 节点块内的固定输出顺序（其余字段照文档顺序跟在后面）。
_NODE_KEY_ORDER = (
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
    "fields",
)

#: 表达式字段：值写同一行是中缀，写子块是操作数对象。
_EXPRESSION_KEYS = ("expression", "condition")

_EDIT_FORM_FIELDS = ("children", "ports", "default_child")


# --------------------------------------------------------------------------------------
# 解析
# --------------------------------------------------------------------------------------


class _Entry:
    """一条已经去掉注释、缩进算好的行。"""

    __slots__ = ("indent", "body", "column", "line")

    def __init__(self, indent: int, body: str, column: int, line: SourceLine) -> None:
        self.indent = indent
        self.body = body
        self.column = column
        self.line = line


def _strip_comment(raw: str) -> str:
    quoted = False
    index = 0
    while index < len(raw):
        char = raw[index]
        if quoted:
            if char == "\\":
                index += 2
                continue
            if char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == "#":
            return raw[:index]
        index += 1
    return raw


def _find_colon(body: str) -> int:
    """行内第一个引号外的冒号下标；没有返回 -1。"""

    quoted = False
    index = 0
    while index < len(body):
        char = body[index]
        if quoted:
            if char == "\\":
                index += 2
                continue
            if char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == ":":
            return index
        index += 1
    return -1


def _is_item(body: str) -> bool:
    return body == "-" or body.startswith("- ")


def _find_arrow(body: str) -> int:
    quoted = False
    index = 0
    while index + 1 < len(body):
        char = body[index]
        if quoted:
            if char == "\\":
                index += 2
                continue
            if char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == "-" and body[index + 1] == ">":
            return index
        index += 1
    return -1


def _split_words(text: str) -> list[str]:
    """按空白切词，引号内的空白不算分隔符（引号保留在词里）。"""

    words: list[str] = []
    current: list[str] = []
    quoted = False
    for char in text:
        if quoted:
            current.append(char)
            if char == '"':
                quoted = False
            continue
        if char == '"':
            quoted = True
            current.append(char)
            continue
        if char in " \t":
            if current:
                words.append("".join(current))
                current = []
            continue
        current.append(char)
    if current:
        words.append("".join(current))
    return words


class _Parser:
    def __init__(self, text: str, path: str | None) -> None:
        self.raw_lines = text.splitlines()
        self.path = path
        self.index = 0

    # ---- 行工具 ---------------------------------------------------------------------

    def _source(self, index: int) -> SourceLine:
        return SourceLine(self.path, index + 1, self.raw_lines[index])

    def _skip_noise(self) -> None:
        while self.index < len(self.raw_lines):
            raw = self.raw_lines[self.index]
            stripped = raw.strip()
            if not stripped or stripped.startswith("#"):
                self.index += 1
                continue
            return

    def _peek_entry(self) -> _Entry | None:
        while True:
            self._skip_noise()
            if self.index >= len(self.raw_lines):
                return None
            raw = self.raw_lines[self.index]
            indent = 0
            for char in raw:
                if char == " ":
                    indent += 1
                elif char == "\t":
                    raise self._source(self.index).error("缩进不能用 Tab", indent + 1, hint=f"每层用 {INDENT} 个空格")
                else:
                    break
            body = _strip_comment(raw[indent:]).rstrip()
            if not body:
                self.index += 1
                continue
            return _Entry(indent, body, indent + 1, self._source(self.index))

    def _take_entry(self, indent: int) -> _Entry | None:
        entry = self._peek_entry()
        if entry is None:
            return None
        if entry.indent < indent:
            return None
        if entry.indent > indent:
            raise entry.line.error(
                f"缩进跳级：这一层是 {indent} 个空格，本行是 {entry.indent} 个",
                entry.column,
                hint=f"子块正好比父行多 {INDENT} 个空格",
            )
        self.index += 1
        return entry

    @staticmethod
    def _raw_indent(raw: str) -> int:
        count = 0
        for char in raw:
            if char == " ":
                count += 1
            else:
                break
        return count

    # ---- 通用块 ---------------------------------------------------------------------

    def _parse_container(self, indent: int) -> Any:
        entry = self._peek_entry()
        if entry is not None and entry.indent == indent and _is_item(entry.body):
            return self._parse_list(indent)
        return self._parse_map(indent)

    def _parse_child(self, indent: int, line: SourceLine) -> Any:
        entry = self._peek_entry()
        if entry is None or entry.indent <= indent:
            return {}
        if entry.indent != indent + INDENT:
            raise entry.line.error(
                f"子块缩进要正好比父行多 {INDENT} 个空格（父行 {indent}，本行 {entry.indent}）",
                entry.column,
            )
        return self._parse_container(entry.indent)

    def _parse_map(self, indent: int, first: _Entry | None = None) -> dict[str, Any]:
        result: dict[str, Any] = {}
        entry = first
        while True:
            if entry is None:
                entry = self._take_entry(indent)
                if entry is None:
                    break
            elif _is_item(entry.body):
                raise entry.line.error("这一层不能把列表项与键混在一起", entry.column)
            key, rest, value_column = self._split_key(entry)
            if key in result:
                raise entry.line.error(f"键重复：{key}", entry.column)
            result[key] = self._parse_value(rest, value_column, indent, entry.line)
            entry = None
        return result

    def _parse_list(self, indent: int) -> list[Any]:
        items: list[Any] = []
        while True:
            entry = self._take_entry(indent)
            if entry is None:
                break
            if not _is_item(entry.body):
                raise entry.line.error("这一层不能把键与列表项混在一起", entry.column)
            body = entry.body[1:].lstrip()
            column = entry.column + entry.body.index(body) if body else entry.column + 1
            if not body:
                items.append(self._parse_child(indent, entry.line))
                continue
            if body == "|":
                items.append(self._parse_text_block(indent))
                continue
            if self._looks_like_entry(body):
                pseudo = _Entry(indent + INDENT, body, column, entry.line)
                items.append(self._parse_map(indent + INDENT, first=pseudo))
                continue
            items.append(parse_inline(body, entry.line, column))
        return items

    @staticmethod
    def _looks_like_entry(body: str) -> bool:
        colon = _find_colon(body)
        if colon <= 0:
            return False
        key = body[:colon]
        return key == key.rstrip() and not any(char in key for char in " \t")

    def _split_key(self, entry: _Entry) -> tuple[str, str, int]:
        colon = _find_colon(entry.body)
        if colon < 0:
            raise entry.line.error("这一行缺少 :（键与值之间要写冒号）", entry.column)
        raw_key = entry.body[:colon]
        if raw_key != raw_key.rstrip():
            raise entry.line.error("键与冒号之间不能有空格", entry.column + colon)
        if not raw_key:
            raise entry.line.error("缺少键名", entry.column)
        key = parse_text(raw_key, entry.line, entry.column)
        rest = entry.body[colon + 1 :].lstrip()
        value_column = entry.column + colon + 1 + (len(entry.body) - colon - 1 - len(rest))
        return key, rest, value_column

    def _parse_value(self, rest: str, column: int, indent: int, line: SourceLine) -> Any:
        if not rest:
            return self._parse_child(indent, line)
        if rest == "|":
            return self._parse_text_block(indent)
        return parse_inline(rest, line, column)

    def _parse_text_block(self, indent: int) -> str:
        collected: list[str] = []
        while self.index < len(self.raw_lines):
            raw = self.raw_lines[self.index]
            if not raw.strip():
                collected.append("")
                self.index += 1
                continue
            if self._raw_indent(raw) <= indent:
                break
            collected.append(raw)
            self.index += 1
        while collected and not collected[-1].strip():
            collected.pop()
        if not collected:
            return ""
        cut = min(self._raw_indent(item) for item in collected if item.strip())
        return "\n".join(item[cut:] if item.strip() else "" for item in collected)

    def _parse_expression_value(self, rest: str, column: int, indent: int, line: SourceLine) -> Any:
        if rest:
            return parse_expression(rest, line, column)
        value = self._parse_child(indent, line)
        if not isinstance(value, dict):
            raise line.error("表达式要么写成中缀，要么写成操作数对象的子块", column)
        return value

    def _parse_expression_list(self, rest: str, column: int, indent: int, line: SourceLine) -> list[Any]:
        if rest:
            stripped = rest.strip()
            if not stripped.startswith("["):
                raise line.error("条件列表要么写 [a == 1, b == 2]，要么用缩进的 - 项", column)
            if not stripped.endswith("]"):
                raise line.error("条件列表缺少右括号 ]", column, hint="每一项是一段中缀表达式，用逗号分隔")
            inner = stripped[1:-1]
            if not inner.strip():
                return []
            return [parse_expression(item, line, item_column) for item, item_column in split_commas(inner, line, column + 1)]
        items: list[Any] = []
        while True:
            entry = self._take_entry(indent + INDENT)
            if entry is None:
                break
            if not _is_item(entry.body):
                raise entry.line.error("条件列表的每一项都要以 - 开头", entry.column)
            body = entry.body[1:].lstrip()
            item_column = entry.column + entry.body.index(body) if body else entry.column + 1
            if not body:
                raise entry.line.error("条件列表项不能为空", entry.column)
            if self._looks_like_entry(body):
                pseudo = _Entry(indent + 2 * INDENT, body, item_column, entry.line)
                items.append(self._parse_map(indent + 2 * INDENT, first=pseudo))
                continue
            items.append(parse_expression(body, entry.line, item_column))
        return items

    # ---- 结构 -----------------------------------------------------------------------

    def parse(self) -> dict[str, Any]:
        entry = self._peek_entry()
        if entry is None:
            raise DslError("文档是空的", path=self.path)
        if entry.indent != 0:
            raise entry.line.error("第一行不能缩进", entry.column)
        words = _split_words(entry.body)
        if not words or words[0] != "workflow":
            raise entry.line.error("第一行必须写成 workflow <id>", entry.column)
        if len(words) != 2:
            raise entry.line.error("workflow 头行只接受一个 id：workflow <id>", entry.column)
        self.index += 1
        document: dict[str, Any] = {
            "schema_version": DOCUMENT_SCHEMA_VERSION,
            "id": parse_text(words[1], entry.line, entry.column + len("workflow ")),
        }
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        groups: list[dict[str, Any]] = []
        comments: list[dict[str, Any]] = []
        saw_edges = False
        while True:
            item = self._take_entry(INDENT)
            if item is None:
                break
            body = item.body
            head = body.split(" ", 1)[0]
            if head == "node":
                nodes.append(self._parse_node(item))
            elif head == "var":
                nodes.append(self._parse_var(item))
            elif head == "group":
                groups.append(self._parse_declared(item, "group"))
            elif head == "comment":
                comments.append(self._parse_declared(item, "comment"))
            else:
                key, rest, column = self._split_key(item)
                if key == "workflow":
                    raise item.line.error("workflow 头行只能出现一次", item.column)
                if key == "edges":
                    if saw_edges:
                        raise item.line.error("edges 块只能写一次", item.column)
                    if rest:
                        raise item.line.error("edges 下面直接写连线，不要在同一行写值", column)
                    self._parse_edges(item, edges)
                    saw_edges = True
                    continue
                if key in ("schema_version",):
                    raise item.line.error("schema_version 由格式决定，不要在文档里写", item.column)
                if key in document:
                    raise item.line.error(f"顶层键重复：{key}", item.column)
                if key == "version" or key == "description":
                    document[key] = self._parse_text_value(rest, column, item.line) if rest else ""
                elif key == "root":
                    document[key] = parse_text(rest, item.line, column)
                else:
                    document[key] = self._parse_value(rest, column, INDENT, item.line)
        if "version" not in document:
            raise DslError("文档缺少 version：工作流版本号", path=self.path)
        if "resolution" not in document:
            raise DslError("文档缺少 resolution：[宽, 高]", path=self.path)
        if "root" not in document:
            raise DslError("文档缺少 root：根节点 id", path=self.path)
        document.setdefault("inputs", {})
        document.setdefault("variables", {})
        document["nodes"] = nodes
        if edges:
            document["edges"] = edges
        if groups:
            document["groups"] = groups
        if comments:
            document["comments"] = comments
        return document

    def _parse_text_value(self, rest: str, column: int, line: SourceLine) -> str:
        if rest == "|":
            return self._parse_text_block(INDENT)
        return parse_text(rest, line, column)

    def _parse_declared(self, entry: _Entry, keyword: str) -> dict[str, Any]:
        """``group`` / ``comment`` 这类「位置参数 + 通用块」的声明。"""

        words = _split_words(entry.body[len(keyword) :].strip())
        if not words:
            raise entry.line.error(f"{keyword} 后面要写 id", entry.column)
        if len(words) > 2:
            raise entry.line.error(f"{keyword} 只接受 id 与可选的显示名", entry.column)
        declared: dict[str, Any] = {"id": parse_text(words[0], entry.line, entry.column + len(keyword) + 1)}
        if len(words) == 2:
            declared["name" if keyword == "group" else "text"] = self._parse_text_token(words[1], entry.line)
        mapping = self._parse_map(entry.indent + INDENT)
        declared.update(_decode_positions(mapping))
        return declared

    def _parse_text_token(self, token: str, line: SourceLine) -> str:
        if token.startswith('"'):
            value, _ = parse_quoted(token, 0, line)
            return value
        return parse_text(token, line, 1)

    def _parse_node(self, entry: _Entry) -> dict[str, Any]:
        words = _split_words(entry.body[len("node") :].strip())
        if len(words) < 2:
            raise entry.line.error("node 头行要写 node <id> <类型> [\"显示名\"]", entry.column)
        if len(words) > 3:
            raise entry.line.error("node 头行最多三个位置参数：id、类型、显示名", entry.column)
        node: dict[str, Any] = {
            "id": parse_text(words[0], entry.line, entry.column + len("node ")),
            "type": parse_text(words[1], entry.line, entry.column + len("node ") + len(words[0]) + 1),
        }
        if len(words) == 3:
            node["name"] = self._parse_text_token(words[2], entry.line)
        self._parse_node_body(entry, node)
        return node

    def _parse_var(self, entry: _Entry) -> dict[str, Any]:
        rest = entry.body[len("var") :].strip()
        scope, separator, key_token = rest.partition(".")
        if not separator or not key_token:
            raise entry.line.error("变量节点要写 var <inputs|variables>.<键>", entry.column + len("var "))
        if scope not in ("inputs", "variables"):
            raise entry.line.error(f"变量节点的作用域只能是 inputs / variables，读到 {scope!r}", entry.column + len("var "))
        key = parse_text(key_token, entry.line, entry.column + len("var ") + len(scope) + 1)
        node: dict[str, Any] = {
            "id": f"var__{scope}__{key}",
            "type": "variable",
            "scope": scope,
            "name": key,
        }
        self._parse_node_body(entry, node)
        return node

    def _parse_edges(self, entry: _Entry, edges: list[dict[str, Any]]) -> None:
        indent = entry.indent + INDENT
        while True:
            item = self._take_entry(indent)
            if item is None:
                return
            if _is_item(item.body):
                raise item.line.error("edges 里的连线不加 - 前缀", item.column)
            if _find_arrow(item.body) < 0:
                raise item.line.error(
                    "连线要写成 <源节点>[:源引脚] -> <目标节点>[:目标引脚]",
                    item.column,
                    hint="例如 root -> round 或 round:then.1 -> pick",
                )
            edges.append(self._parse_wire(item, indent))

    def _parse_node_body(self, entry: _Entry, node: dict[str, Any]) -> None:
        indent = entry.indent + INDENT
        seen: set[str] = set()
        while True:
            item = self._take_entry(indent)
            if item is None:
                break
            if _find_arrow(item.body) >= 0:
                raise item.line.error(
                    f"连线不写在节点块里：节点 {node['id']} 的连线要写到顶层 edges 块",
                    item.column,
                    hint="字面量里真的要写 -> 时请加引号",
                )
            if item.body == "decorator" or item.body.startswith("decorator "):
                decorators = node.setdefault("decorators", [])
                if not isinstance(decorators, list):  # 防御：decorators 已经被写成非列表
                    raise item.line.error("decorators 必须是列表", item.column)
                decorators.append(self._parse_decorator(item, indent))
                continue
            key, rest, column = self._split_key(item)
            if key == "decorator":
                raise item.line.error("装饰器要写成 decorator <类型>", item.column)
            if key in seen:
                raise item.line.error(f"键重复：{key}", item.column)
            seen.add(key)
            if key in ("id", "type"):
                raise item.line.error(f"{key} 写在 node 头行上，不要在块里重复", item.column)
            if key == "name":
                if "name" in node:
                    raise item.line.error("显示名重复（头行已经写过）", item.column)
                node["name"] = self._parse_text_value(rest, column, item.line) if rest else ""
                continue
            if key in POSITION_KEYS:
                node[key] = _decode_position(self._parse_value(rest, column, indent, item.line), key, item)
                continue
            if key in SIZE_KEYS:
                node[key] = _decode_size(self._parse_value(rest, column, indent, item.line), item)
                continue
            if key in _EXPRESSION_KEYS:
                node[key] = self._parse_expression_value(rest, column, indent, item.line)
                continue
            if key == "conditions":
                node[key] = self._parse_expression_list(rest, column, indent, item.line)
                continue
            node[key] = self._parse_value(rest, column, indent, item.line)

    def _parse_decorator(self, entry: _Entry, indent: int) -> dict[str, Any]:
        rest = entry.body[len("decorator") :].strip()
        if not rest:
            raise entry.line.error("decorator 后面要写类型（cooldown / timeout / retry / repeat / do_once）", entry.column)
        decorator: dict[str, Any] = {"type": parse_text(rest, entry.line, entry.column + len("decorator "))}
        extra = self._parse_map(indent + INDENT)
        if "type" in extra:
            raise entry.line.error("decorator 的类型写在头行上", entry.column)
        decorator.update(extra)
        return decorator

    def _parse_wire(self, entry: _Entry, indent: int) -> dict[str, Any]:
        body = entry.body
        arrow = _find_arrow(body)
        left = body[:arrow].strip()
        right = body[arrow + 2 :].strip()
        if not left:
            raise entry.line.error("连线缺少源节点", entry.column)
        if not right:
            raise entry.line.error("连线缺少目标节点", entry.column + arrow + 2)
        source_node, source_pin = self._split_endpoint(left, DEFAULT_EXEC_OUT_PIN, entry, entry.column)
        target_node, target_pin = self._split_endpoint(right, EXEC_IN_PIN, entry, entry.column + arrow + 2)
        edge: dict[str, Any] = {
            "from": {"node": source_node, "pin": source_pin},
            "to": {"node": target_node, "pin": target_pin},
        }
        child = self._parse_child(indent, entry.line)
        if child:
            unknown = set(child) - {"waypoints"}
            if unknown:
                raise entry.line.error(f"连线块里只支持 waypoints，读到 {sorted(unknown)}", entry.column)
            waypoints = child.get("waypoints")
            if waypoints is not None:
                edge["waypoints"] = _pairs_to_points(waypoints)
        return edge

    def _split_endpoint(self, text: str, default_pin: str, entry: _Entry, column: int) -> tuple[str, str]:
        stripped = text.strip()
        # 节点 id 可以是引号字符串（例如含 `:` 的 id），所以先按引号解析再找引脚分隔符。
        if stripped.startswith('"'):
            node, end = parse_quoted(stripped, 0, entry.line)
            rest = stripped[end:].strip()
            if not rest:
                return node, default_pin
            if not rest.startswith(":"):
                raise entry.line.error("引号节点 id 后面只能接 :引脚", column + end)
            pin = rest[1:].strip() or default_pin
            return node, pin
        node, separator, pin = stripped.partition(":")
        node = node.strip()
        pin = pin.strip() if separator else default_pin
        if not node:
            raise entry.line.error("连线的端点缺少节点 id", column)
        if not pin:
            pin = default_pin
        return parse_text(node, entry.line, column), parse_text(pin, entry.line, column + len(node) + 1)


def _decode_position(value: Any, key: str, entry: _Entry) -> Any:
    """``[x, y]`` → ``{"x": …, "y": …}``；**其余形状原样留着**，让 schema 去报类型错。"""

    if isinstance(value, list) and len(value) == 2 and all(_is_number(item) for item in value):
        return {"x": value[0], "y": value[1]}
    return value


def _decode_size(value: Any, entry: _Entry) -> Any:
    if isinstance(value, list) and len(value) == 2 and all(_is_number(item) for item in value):
        return {"w": value[0], "h": value[1]}
    return value


def _decode_positions(mapping: dict[str, Any]) -> dict[str, Any]:
    """``group`` / ``comment`` 里的位置与尺寸字段，规则同 ``_decode_position``。"""

    for key in POSITION_KEYS:
        value = mapping.get(key)
        if isinstance(value, list) and len(value) == 2 and all(_is_number(item) for item in value):
            mapping[key] = {"x": value[0], "y": value[1]}
    for key in SIZE_KEYS:
        value = mapping.get(key)
        if isinstance(value, list) and len(value) == 2 and all(_is_number(item) for item in value):
            mapping[key] = {"w": value[0], "h": value[1]}
    return mapping


def _points_to_pairs(waypoints: Any) -> list[list[Any]] | None:
    """``[{x, y}, …]`` → ``[[x, y], …]``；有一个折点不是 ``{x, y}`` 数值对就返回 ``None``。"""

    if not isinstance(waypoints, list):
        return None
    pairs: list[list[Any]] = []
    for point in waypoints:
        if not (isinstance(point, dict) and set(point) == {"x", "y"} and all(_is_number(point[item]) for item in ("x", "y"))):
            return None
        pairs.append([point["x"], point["y"]])
    return pairs


def _pairs_to_points(value: Any) -> Any:
    """``[[x, y], …]`` → ``[{x, y}, …]``；形状不对就原样返回，交给 schema 报。"""

    if not isinstance(value, list):
        return value
    decoded: list[dict[str, Any]] = []
    for pair in value:
        if not (isinstance(pair, list) and len(pair) == 2 and all(_is_number(item) for item in pair)):
            return value
        decoded.append({"x": pair[0], "y": pair[1]})
    return decoded


def _is_number(value: Any) -> bool:
    """整数或浮点（布尔不算）。坐标是不是整数留给 schema 与编译期报，不在语法层拦。"""

    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_document(text: str, *, path: str | None = None) -> dict[str, Any]:
    """``.owf`` 文本 → 图文档 dict（``schema_version`` 为 6，其余与 v5 同形）。"""

    return _Parser(text, path).parse()


def read_document_id(text: str) -> str | None:
    """只读头行取工作流 id（不解析整份文档）。

    「按 id 反查文件」这类场景只需要 id，把整份文档解析一遍既慢又会在无关的语法错误上失败。
    """

    for index, raw in enumerate(text.splitlines()):
        stripped = _strip_comment(raw).strip()
        if not stripped or stripped.startswith("#"):
            continue
        words = _split_words(stripped)
        if len(words) != 2 or words[0] != "workflow":
            return None
        try:
            return parse_text(words[1], SourceLine(None, index + 1, raw), raw.index(words[1]) + 1)
        except DslError:
            return None
    return None


# --------------------------------------------------------------------------------------
# 规范化
# --------------------------------------------------------------------------------------


def normalize_document(document: dict[str, Any]) -> dict[str, Any]:
    """把图文档整理成 ``emit`` 会产出的形状（语义无损、可比较）。

    只做三件事：``then`` 别名收敛成 ``then.0``、``and`` / ``or`` 扁平化、
    空的 ``edges`` / ``groups`` / ``comments`` 与空 ``waypoints`` 删掉。
    **边的顺序保持不变**——文本里的边表是忠实转写，报错里的 ``edges[i]`` 下标不会漂。
    """

    result = deepcopy(document)
    result["schema_version"] = DOCUMENT_SCHEMA_VERSION
    # `emit` 对 falsy / 非对象的 inputs、variables 一律写 `{}`，规范化必须与它一致，
    # 否则 `parse(emit(doc)) == normalize_document(doc)` 会被 `inputs: []` 这种形状破坏。
    for key in ("inputs", "variables"):
        if not isinstance(result.get(key), dict):
            result[key] = {}
    nodes = result.get("nodes")
    if not isinstance(nodes, list):
        raise DslError("图文档缺少 nodes 数组")
    edges = result.get("edges")
    if isinstance(edges, list) and edges:
        result["edges"] = [_normalize_edge(edge) for edge in edges]
    else:
        result.pop("edges", None)
    for key in ("groups", "comments"):
        if isinstance(result.get(key), list) and not result[key]:
            result.pop(key, None)
    for node in nodes:
        if isinstance(node, dict):
            _normalize_node_expressions(node)
    return result


def _normalize_edge(edge: Any) -> Any:
    normalized = deepcopy(edge)
    for side in ("from", "to"):
        binding = normalized.get(side)
        if isinstance(binding, dict) and binding.get("pin") == "then":
            binding["pin"] = "then.0"
    if normalized.get("waypoints") == []:
        normalized.pop("waypoints", None)
    return normalized


def _normalize_node_expressions(node: dict[str, Any]) -> None:
    for key in _EXPRESSION_KEYS:
        if key in node:
            node[key] = _normalize_expression(node[key])
    conditions = node.get("conditions")
    if isinstance(conditions, list):
        node["conditions"] = [_normalize_expression(item) for item in conditions]


def _normalize_expression(value: Any) -> Any:
    if not isinstance(value, dict) or len(value) != 1:
        return value
    operator, operands = next(iter(value.items()))
    if operator in ("and", "or") and isinstance(operands, list):
        flattened: list[Any] = []
        for operand in operands:
            operand = _normalize_expression(operand)
            if isinstance(operand, dict) and len(operand) == 1 and operator in operand and isinstance(operand[operator], list):
                flattened.extend(operand[operator])
            else:
                flattened.append(operand)
        return {operator: flattened}
    if operator == "not":
        return {"not": _normalize_expression(operands)}
    if operator == "exists":
        return {"exists": operands}
    if isinstance(operands, list):
        return {operator: [_normalize_expression(item) for item in operands]}
    return {operator: _normalize_expression(operands)}


# --------------------------------------------------------------------------------------
# 序列化
# --------------------------------------------------------------------------------------


class _Writer:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def line(self, depth: int, text: str) -> None:
        self.lines.append(" " * (depth * INDENT) + text if text else "")

    def render(self) -> str:
        while self.lines and not self.lines[-1]:
            self.lines.pop()
        return "\n".join(self.lines) + "\n"


def _require(node: Any, key: str, label: str) -> Any:
    if not isinstance(node, dict) or key not in node:
        raise DslError(f"{label} 缺少字段 {key}，写不成 .owf")
    return node[key]


def _emit_entry(writer: _Writer, depth: int, key: str, value: Any) -> None:
    name = render_identifier(key)
    if isinstance(value, str) and "\n" in value:
        writer.line(depth, f"{name}: |")
        for text_line in value.split("\n"):
            writer.line(depth + 1, text_line)
        return
    inline = render_inline(value)
    if inline is not None:
        writer.line(depth, f"{name}: {inline}")
        return
    if isinstance(value, dict):
        writer.line(depth, f"{name}:")
        for child_key, child_value in value.items():
            _emit_entry(writer, depth + 1, child_key, child_value)
        return
    if isinstance(value, list):
        writer.line(depth, f"{name}:")
        _emit_list(writer, depth + 1, value)
        return
    raise DslError(f"字段 {key} 的值写不成 .owf：{value!r}")


def _emit_list(writer: _Writer, depth: int, items: list[Any]) -> None:
    for item in items:
        _emit_list_item(writer, depth, item)


def _emit_list_item(writer: _Writer, depth: int, value: Any) -> None:
    if isinstance(value, str) and "\n" in value:
        writer.line(depth, "- |")
        for text_line in value.split("\n"):
            writer.line(depth + 1, text_line)
        return
    inline = render_inline(value)
    if inline is not None:
        writer.line(depth, f"- {inline}")
        return
    if isinstance(value, dict):
        if not value:
            writer.line(depth, "- {}")
            return
        keys = list(value)
        _emit_item_head(writer, depth, keys[0], value[keys[0]])
        for key in keys[1:]:
            _emit_entry(writer, depth + 1, key, value[key])
        return
    if isinstance(value, list):
        writer.line(depth, "-")
        _emit_list(writer, depth + 1, value)
        return
    raise DslError(f"列表项写不成 .owf：{value!r}")


def _emit_item_head(writer: _Writer, depth: int, key: str, value: Any) -> None:
    name = render_identifier(key)
    if isinstance(value, str) and "\n" in value:
        writer.line(depth, f"- {name}: |")
        for text_line in value.split("\n"):
            writer.line(depth + 2, text_line)
        return
    inline = render_inline(value)
    if inline is not None:
        writer.line(depth, f"- {name}: {inline}")
        return
    if isinstance(value, dict):
        writer.line(depth, f"- {name}:")
        for child_key, child_value in value.items():
            _emit_entry(writer, depth + 2, child_key, child_value)
        return
    if isinstance(value, list):
        writer.line(depth, f"- {name}:")
        _emit_list(writer, depth + 2, value)
        return
    raise DslError(f"列表项的字段 {key} 写不成 .owf：{value!r}")


def _emit_expression_entry(writer: _Writer, depth: int, key: str, value: Any) -> None:
    name = render_identifier(key)
    text = render_expression(value)
    if text is not None:
        writer.line(depth, f"{name}: {text}")
        return
    if isinstance(value, dict):
        if not value:
            writer.line(depth, f"{name}: {{}}")
            return
        writer.line(depth, f"{name}:")
        for child_key, child_value in value.items():
            _emit_entry(writer, depth + 1, child_key, child_value)
        return
    raise DslError(f"{key} 的表达式既写不成中缀、也不是操作数对象：{value!r}")


def _emit_expression_list(writer: _Writer, depth: int, key: str, items: list[Any]) -> None:
    name = render_identifier(key)
    if not items:
        writer.line(depth, f"{name}: []")
        return
    rendered = [render_expression(item) for item in items]
    if all(text is not None for text in rendered):
        inline = "[" + ", ".join(text for text in rendered if text is not None) + "]"
        if len(inline) <= INLINE_WIDTH:
            writer.line(depth, f"{name}: {inline}")
            return
    writer.line(depth, f"{name}:")
    for item, text in zip(items, rendered):
        if text is not None:
            writer.line(depth + 1, f"- {text}")
            continue
        _emit_list_item(writer, depth + 1, item)


def _emit_decorators(writer: _Writer, depth: int, decorators: list[Any]) -> None:
    if not decorators:
        writer.line(depth, "decorators: []")
        return
    for decorator in decorators:
        if not isinstance(decorator, dict) or "type" not in decorator:
            raise DslError(f"装饰器缺少 type：{decorator!r}")
        writer.line(depth, f"decorator {render_identifier(str(decorator['type']))}")
        for key, value in decorator.items():
            if key == "type":
                continue
            _emit_entry(writer, depth + 1, key, value)


def _emit_position(writer: _Writer, depth: int, key: str, value: Any) -> bool:
    if key in POSITION_KEYS and isinstance(value, dict) and set(value) == {"x", "y"} and all(_is_number(value[item]) for item in ("x", "y")):
        writer.line(depth, f"{render_identifier(key)}: [{_render_number(value['x'])}, {_render_number(value['y'])}]")
        return True
    if key in SIZE_KEYS and isinstance(value, dict) and set(value) == {"w", "h"} and all(_is_number(value[item]) for item in ("w", "h")):
        writer.line(depth, f"{render_identifier(key)}: [{_render_number(value['w'])}, {_render_number(value['h'])}]")
        return True
    return False


def _render_number(value: Any) -> str:
    return render_inline(value) or "null"


def _emit_wire(writer: _Writer, depth: int, edge: dict[str, Any], ids: set[str]) -> None:
    source = edge.get("from") or {}
    target = edge.get("to") or {}
    source_node = str(source.get("node") or "")
    target_node = str(target.get("node") or "")
    if not source_node or not target_node:
        raise DslError(f"连线缺少端点：{edge!r}")
    if source_node not in ids:
        raise DslError(f"连线的源节点不存在：{source_node}")
    if target_node not in ids:
        raise DslError(f"连线指向了不存在的节点：{target_node}")
    source_pin = str(source.get("pin") or EXEC_OUT_PIN)
    if source_pin == EXEC_OUT_PIN:
        source_pin = DEFAULT_EXEC_OUT_PIN
    target_pin = str(target.get("pin") or EXEC_IN_PIN)
    head = (
        render_identifier(source_node)
        if source_pin == DEFAULT_EXEC_OUT_PIN
        else f"{render_identifier(source_node)}:{render_identifier(source_pin)}"
    )
    tail = render_identifier(target_node) if target_pin == EXEC_IN_PIN else f"{render_identifier(target_node)}:{render_identifier(target_pin)}"
    writer.line(depth, f"{head} -> {tail}")
    waypoints = edge.get("waypoints")
    if waypoints:
        pairs = _points_to_pairs(waypoints)
        if pairs is None:
            _emit_entry(writer, depth + 1, "waypoints", waypoints)
        else:
            inline = render_inline(pairs)
            if inline is not None:
                writer.line(depth + 1, f"waypoints: {inline}")
            else:
                writer.line(depth + 1, "waypoints:")
                _emit_list(writer, depth + 2, pairs)


def _emit_node(writer: _Writer, depth: int, node: dict[str, Any]) -> None:
    node_id = str(_require(node, "id", "节点"))
    node_type = str(_require(node, "type", "节点"))
    handled: set[str] = {"id", "type", "name"}
    if node_type == "variable":
        scope = node.get("scope")
        name = node.get("name")
        if scope not in ("inputs", "variables") or not isinstance(name, str) or not name:
            raise DslError(f"变量节点 {node_id} 缺少 scope / name，写不成 var 行")
        expected = f"var__{scope}__{name}"
        if node_id != expected:
            raise DslError(f"变量节点 {node_id} 与派生 id {expected} 不一致（v6 要求 id 由作用域与键派生）")
        writer.line(depth, f"var {scope}.{render_identifier(name)}")
        handled.add("scope")
    else:
        header = f"node {render_identifier(node_id)} {render_identifier(node_type)}"
        if "name" in node:
            header += f" {render_scalar(str(node['name']))}"
        writer.line(depth, header)
    body = depth + 1
    for key in _NODE_KEY_ORDER:
        if key not in node:
            continue
        value = node[key]
        handled.add(key)
        if _emit_position(writer, body, key, value):
            continue
        if key == "expression" or key == "condition":
            _emit_expression_entry(writer, body, key, value)
            continue
        if key == "conditions":
            _emit_expression_list(writer, body, key, value if isinstance(value, list) else [value])
            continue
        if key == "decorators":
            _emit_decorators(writer, body, value if isinstance(value, list) else [])
            continue
        _emit_entry(writer, body, key, value)
    for key, value in node.items():
        if key in handled:
            continue
        _emit_entry(writer, body, key, value)


def _emit_declared(writer: _Writer, depth: int, keyword: str, declared: dict[str, Any], name_key: str) -> None:
    identifier = str(_require(declared, "id", keyword))
    header = f"{keyword} {render_identifier(identifier)}"
    if name_key in declared and declared[name_key] is not None:
        header += f" {render_scalar(str(declared[name_key]))}"
    writer.line(depth, header)
    for key, value in declared.items():
        if key in ("id", name_key):
            continue
        if _emit_position(writer, depth + 1, key, value):
            continue
        _emit_entry(writer, depth + 1, key, value)


def emit_document(document: dict[str, Any]) -> str:
    """图文档 dict → ``.owf`` 文本（规范形式）。"""

    if not isinstance(document, dict):
        raise DslError("要写盘的文档不是对象")
    nodes = document.get("nodes")
    if not isinstance(nodes, list):
        raise DslError("图文档缺少 nodes 数组")
    # 编辑形态的检查放在版本检查之前：这条报错更具体，直接告诉调用方该先转格式。
    for node in nodes:
        for field in _EDIT_FORM_FIELDS:
            if isinstance(node, dict) and field in node:
                raise DslError(f"节点 {node.get('id')} 带着 {field}：这是编辑形态（v4），要先转成图文档")
    version = document.get("schema_version")
    if version is not None and version not in (5, DOCUMENT_SCHEMA_VERSION):
        raise DslError(f"只支持图文档（v5/v6）写盘，读到 schema_version={version!r}")
    # 头字段缺了就必须报错：写出去是一份**解析不回来**的文本（解析器要求这三个字段），
    # 那比写盘失败更糟。
    missing = [key for key in ("version", "resolution", "root") if key not in document]
    if missing:
        raise DslError(f"图文档缺少必需字段，写不成 .owf：{'、'.join(missing)}")
    ids = {str(node.get("id")) for node in nodes if isinstance(node, dict)}
    edges = document.get("edges") or []

    writer = _Writer()
    writer.line(0, f"workflow {render_identifier(str(_require(document, 'id', '文档')))}")
    for key in _HEADER_ORDER:
        if key in document:
            _emit_entry(writer, 1, key, document[key])
    for key in _CONTAINER_ORDER:
        if key in ("inputs", "variables"):
            _emit_entry(writer, 1, key, document.get(key) or {})
        elif key in document:
            _emit_entry(writer, 1, key, document[key])
    for key, value in document.items():
        if key in _HEADER_ORDER or key in _CONTAINER_ORDER or key in _STRUCTURAL_TOP_KEYS:
            continue
        _emit_entry(writer, 1, key, value)
    for node in nodes:
        if not isinstance(node, dict):
            raise DslError(f"nodes 里出现了不是对象的项：{node!r}")
        _emit_node(writer, 1, node)
    if edges:
        writer.line(1, "edges:")
        for edge in edges:
            _emit_wire(writer, 2, edge, ids)
    for group in document.get("groups") or []:
        _emit_declared(writer, 1, "group", group, "name")
    for comment in document.get("comments") or []:
        _emit_declared(writer, 1, "comment", comment, "text")
    return writer.render()


__all__ = [
    "DOCUMENT_SCHEMA_VERSION",
    "INDENT",
    "WORKFLOW_SUFFIX",
    "emit_document",
    "normalize_document",
    "parse_document",
    "read_document_id",
]
