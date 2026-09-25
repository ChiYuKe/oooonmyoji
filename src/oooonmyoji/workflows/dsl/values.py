"""v6 文本格式的标量与行内值规则（解析与序列化共用）。

三种值在这里定死，文档解析器与表达式解析器都读它：

- **标量**：整数、浮点、布尔、``null``、裸词字符串；整数与浮点**不做归一化**
  （``1`` 与 ``1.0`` 是两个不同的值，这两份工作流里 ``delay_seconds`` 就同时有整数与浮点）。
- **引用**：以 ``nodes.`` / ``inputs.`` / ``variables.`` 开头的裸词自动成为 ``{"ref": …}``；
  要当普通字符串就加引号。这条规则让连线两侧与表达式操作数都能直接写路径。
- **行内容器**：``[a, b, c]`` 与空对象 ``{}`` / 空数组 ``[]``；非空对象一律写子块。
"""

from __future__ import annotations

import re
from typing import Any

from .errors import SourceLine

_INT_RE = re.compile(r"^-?[0-9]+$")
#: 浮点：允许科学计数法（`repr(float)` 对很小的数会写成 `1e-20`，不支持就等于静默丢数据）。
_FLOAT_RE = re.compile(r"^-?(?:[0-9]+\.[0-9]+|[0-9]+)(?:[eE][-+]?[0-9]+)?$")

#: 裸词里不允许出现的字符：空白、注释符 `#`、引号与所有分隔符。
_BARE_STOP = frozenset(' \t\r\n#",:[]{}')

#: 引用前缀：这三个作用域开头的裸词是引用而不是字符串。
_REF_PREFIXES = ("nodes.", "inputs.", "variables.")

_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\"}

#: 行内列表整行超过这个长度就换块写（人读得下去的宽度）。
INLINE_WIDTH = 96


def is_ref_token(token: str) -> bool:
    """这个裸词是不是引用（``nodes.`` / ``inputs.`` / ``variables.`` 开头）。"""

    return token.startswith(_REF_PREFIXES)


def token_kind(token: str) -> str:
    """裸词的归类：``int`` / ``float`` / ``bool`` / ``null`` / ``ref`` / ``string``。"""

    if _INT_RE.match(token):
        return "int"
    if _FLOAT_RE.match(token):
        return "float"
    if token in ("true", "false"):
        return "bool"
    if token == "null":
        return "null"
    if is_ref_token(token):
        return "ref"
    return "string"


def parse_token(token: str, line: SourceLine, column: int) -> Any:
    """裸词 → Python 值。"""

    kind = token_kind(token)
    if kind == "int":
        return int(token)
    if kind == "float":
        return float(token)
    if kind == "bool":
        return token == "true"
    if kind == "null":
        return None
    if kind == "ref":
        return {"ref": token}
    for ch in token:
        if ch in _BARE_STOP:
            raise line.error(f"裸词里不能出现 {ch!r}；含空格或分隔符的字符串请加引号", column + token.index(ch))
    return token


def parse_quoted(text: str, start: int, line: SourceLine) -> tuple[str, int]:
    """从 ``text[start] == '"'`` 开始解析一个带转义的字符串，返回（值, 结束下标）。"""

    out: list[str] = []
    index = start + 1
    while index < len(text):
        char = text[index]
        if char == "\\":
            if index + 1 >= len(text):
                raise line.error("转义符后面没有字符", index + 1)
            escape = text[index + 1]
            if escape not in _ESCAPES:
                raise line.error(f"不支持的转义 \\{escape}", index + 1, hint="支持 \\n \\t \\r \\\" \\\\")
            out.append(_ESCAPES[escape])
            index += 2
            continue
        if char == '"':
            return "".join(out), index + 1
        out.append(char)
        index += 1
    raise line.error("字符串没有闭合的引号", start + 1)


def split_elements(body: str, line: SourceLine, offset: int) -> list[tuple[str, int]]:
    """按顶层逗号/空白切开行内列表体，返回 [（元素文本, 列号）]。"""

    elements: list[tuple[str, int]] = []
    depth = 0
    start: int | None = None
    index = 0
    quoted = False
    while index < len(body):
        char = body[index]
        if quoted:
            if char == "\\":
                index += 2
                continue
            if char == '"':
                quoted = False
            index += 1
            continue
        if char == '"':
            quoted = True
            if start is None:
                start = index
            index += 1
            continue
        if char in "[{":
            depth += 1
            if start is None:
                start = index
            index += 1
            continue
        if char in "]}":
            depth -= 1
            if depth < 0:
                raise line.error("括号不匹配", offset + index + 1)
            index += 1
            continue
        if depth == 0 and char in ", \t":
            if start is not None:
                elements.append((body[start:index], offset + start))
                start = None
            index += 1
            continue
        if start is None:
            start = index
        index += 1
    if quoted:
        raise line.error("字符串没有闭合的引号", offset + len(body))
    if depth != 0:
        raise line.error("括号不匹配", offset + len(body))
    if start is not None:
        elements.append((body[start:], offset + start))
    return elements


def split_commas(body: str, line: SourceLine, offset: int) -> list[tuple[str, int]]:
    """只按**逗号**切开（空白保留在元素里）：表达式不能把空格当分隔符。

    ``[a == 1, b == 2]`` 里的 ``a == 1`` 是一整项；表达式文法里没有逗号，
    所以按逗号切是无歧义的。
    """

    elements: list[tuple[str, int]] = []
    start: int | None = None
    index = 0
    quoted = False
    while index < len(body):
        char = body[index]
        if quoted:
            if char == "\\":
                index += 2
                continue
            if char == '"':
                quoted = False
            index += 1
            continue
        if char == '"':
            quoted = True
            if start is None:
                start = index
            index += 1
            continue
        if char == ",":
            if start is not None:
                elements.append((body[start:index].strip(), offset + start))
                start = None
            index += 1
            continue
        if start is None and not char.isspace():
            start = index
        index += 1
    if quoted:
        raise line.error("字符串没有闭合的引号", offset + len(body))
    if start is not None:
        elements.append((body[start:].strip(), offset + start))
    return [element for element in elements if element[0]]


def parse_inline(text: str, line: SourceLine, offset: int = 1) -> Any:
    """解析一段行内值：标量 / 引用 / ``[…]`` / ``{}`` / ``[]``。"""

    stripped = text.strip()
    if not stripped:
        raise line.error("缺少值", offset + len(text))
    lead = text.index(stripped[0])
    column = offset + lead
    if stripped == "{}":
        return {}
    if stripped == "[]":
        return []
    if stripped.startswith("["):
        if not stripped.endswith("]"):
            raise line.error("行内列表缺少右括号 ]", column)
        inner = stripped[1:-1]
        if not inner.strip():
            return []
        return [parse_inline(item, line, item_column) for item, item_column in split_elements(inner, line, column + 1)]
    if stripped.startswith("{"):
        raise line.error("行内对象只支持空对象 {}", column, hint="非空对象写成子块：键: 后换行缩进")
    if stripped.startswith('"'):
        value, end = parse_quoted(stripped, 0, line)
        if stripped[end:].strip():
            raise line.error("字符串后面还有多余内容", column + end)
        return value
    return parse_token(stripped, line, column)


def is_bare_word(text: str) -> bool:
    """这个文本能不能当裸词写（键、id、引脚、引用）：没有分隔符、不以 ``-`` 开头。"""

    if not text or text[0] == "-":
        return False
    return not any(char in _BARE_STOP for char in text)


def parse_text(text: str, line: SourceLine, column: int = 1) -> str:
    """解析一个「一定是字符串」的记号：引号字符串，或没有任何分隔符的裸词。

    用于键、id、类型名、引脚、显示名、版本号这类**标识符**：它们不该被当成数字或引用。
    """

    stripped = text.strip()
    if not stripped:
        raise line.error("缺少内容", column)
    if stripped.startswith('"'):
        value, end = parse_quoted(stripped, 0, line)
        if stripped[end:].strip():
            raise line.error("字符串后面还有多余内容", column + end)
        return value
    for ch in stripped:
        if ch in _BARE_STOP:
            raise line.error(f"裸词里不能出现 {ch!r}；要写这种内容请加引号", column + stripped.index(ch))
    return stripped


def render_identifier(value: str) -> str:
    """标识符（键、id、类型名、引脚）→ 文本：只要没有分隔符就裸写。

    标识符**不**按值的规则判定，所以 ``true`` / ``false`` 引脚、``5`` 这样的键名照样裸写。
    """

    return value if is_bare_word(value) else quote_string(value)


def quote_string(value: str) -> str:
    """按需转义后加上引号。"""

    out = ['"']
    for char in value:
        if char == "\\":
            out.append("\\\\")
        elif char == '"':
            out.append('\\"')
        elif char == "\n":
            out.append("\\n")
        elif char == "\t":
            out.append("\\t")
        elif char == "\r":
            out.append("\\r")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def needs_quote(value: str) -> bool:
    """这个字符串能不能裸写。"""

    if not value:
        return True
    if value[0] == "-":
        return True
    if any(char in _BARE_STOP for char in value):
        return True
    return token_kind(value) != "string"


def render_scalar(value: str, *, expression: bool = False) -> str:
    """字符串 → 文本。表达式里 ``and`` / ``or`` 这类关键字必须加引号，否则会被当成运算符。"""

    if needs_quote(value) or (expression and value in _EXPR_KEYWORDS):
        return quote_string(value)
    return value


_EXPR_KEYWORDS = frozenset({"and", "or", "not", "contains", "exists"})


def format_number(value: float) -> str:
    """浮点 → 文本：用 Python 的最短往返表示（``repr``）。

    ``repr`` 对整数型浮点会写成 ``1.0``（看得见小数点），对很小/很大的数写成 ``1e-20`` /
    ``1e+20``——**必须照原样写**：早先用 ``%.17f`` 再剪尾零会把 ``1e-20`` 写成 ``0.0``，
    那是静默丢数据。数字文法因此支持科学计数法。
    """

    text = repr(float(value))
    if float(text) != value:  # pragma: no cover - repr 保证往返，这里只是兜底
        text = f"{value:.17g}"
    return text


def render_inline(value: Any, *, expression: bool = False) -> str | None:
    """把值渲染成一行文本；做不到（非空对象、太长、嵌套太深）返回 ``None``。"""

    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return format_number(value)
    if isinstance(value, str):
        return render_scalar(value, expression=expression)
    if isinstance(value, dict):
        if not value:
            return "{}"
        if set(value) == {"ref"} and isinstance(value["ref"], str):
            ref = value["ref"]
            return ref if is_ref_token(ref) and is_bare_word(ref) else None
        return None
    if isinstance(value, list):
        if not value:
            return "[]"
        parts: list[str] = []
        for item in value:
            text = render_inline(item, expression=expression)
            if text is None:
                return None
            parts.append(text)
        joined = "[" + ", ".join(parts) + "]"
        return joined if len(joined) <= INLINE_WIDTH else None
    return None


def render_string_block(value: str) -> list[str]:
    """多行字符串 → ``|`` 文本块的正文行。"""

    return value.split("\n")


__all__ = [
    "INLINE_WIDTH",
    "format_number",
    "is_bare_word",
    "is_ref_token",
    "needs_quote",
    "parse_inline",
    "parse_quoted",
    "parse_text",
    "parse_token",
    "quote_string",
    "render_identifier",
    "render_inline",
    "render_scalar",
    "render_string_block",
    "split_commas",
    "split_elements",
    "token_kind",
]
