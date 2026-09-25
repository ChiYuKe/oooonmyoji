"""v6 的表达式语言：中缀文本 ⇄ 运行时的操作数对象。

运行时（``resolver.ReferenceResolver.condition``）只认一种形状：

    {"<运算符>": 操作数}     操作数是字面量、{"ref": …}、或嵌套的同类对象

运算符与元数（``bindings.CONDITION_OPERATORS``）：``exists`` 收一个引用；
``eq`` / ``ne`` / ``gt`` / ``gte`` / ``lt`` / ``lte`` / ``contains`` 收**恰好两个**操作数；
``and`` / ``or`` 收任意多个（落盘扁平化）；``not`` 收一个。

中缀只是**写法**：解析时降级成上面那棵树，序列化时反向渲染。位置寻址
（``expression.eq.0`` 对应 ``bool_judge`` 的 ``left`` 引脚）因此逐字不变——
文件里那个 ``null`` 就是「这个操作数被一条连线占着」的占位。
"""

from __future__ import annotations

from typing import Any

from .errors import SourceLine
from .values import parse_quoted, parse_token, render_inline

#: 中缀符号 → 运行时运算符。
_COMPARISONS: dict[str, str] = {
    "==": "eq",
    "!=": "ne",
    ">": "gt",
    ">=": "gte",
    "<": "lt",
    "<=": "lte",
    "contains": "contains",
}

_ARITY_TWO = frozenset({"eq", "ne", "gt", "gte", "lt", "lte", "contains"})

#: 认得出来的运算符全集：其余单键对象（``{"ref": …}``）是原子而不是表达式。
_KNOWN_OPERATORS = frozenset({*_ARITY_TWO, "and", "or", "not", "exists"})

#: 渲染时的优先级：or < and < not/exists < 比较 < 原子。
_PRECEDENCE = {"or": 1, "and": 2, "not": 3, "exists": 3}
_COMPARISON_PRECEDENCE = 4

_WORD_STOP = frozenset(' \t()"=!<>')


def tokenize(text: str, line: SourceLine, offset: int = 1) -> list[tuple[str, Any, int]]:
    """把一段中缀文本切成记号：``("literal", 值, 列)`` / ``("op", 符号, 列)`` / ``("kw", 词, 列)`` / 括号。"""

    tokens: list[tuple[str, Any, int]] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char in " \t":
            index += 1
            continue
        if char == "(":
            tokens.append(("lp", "(", offset + index))
            index += 1
            continue
        if char == ")":
            tokens.append(("rp", ")", offset + index))
            index += 1
            continue
        if char == '"':
            value, end = parse_quoted(text, index, line)
            tokens.append(("literal", value, offset + index))
            index = end
            continue
        matched = None
        for symbol in ("==", "!=", ">=", "<=", ">", "<"):
            if text.startswith(symbol, index):
                matched = symbol
                break
        if matched is not None:
            tokens.append(("op", matched, offset + index))
            index += len(matched)
            continue
        if char in "=!":
            raise line.error(
                "比较要写 == / !=（单个 = 不是运算符）",
                offset + index,
                hint="等于：a == b；不等于：a != b",
            )
        end = index
        while end < len(text) and text[end] not in _WORD_STOP:
            end += 1
        word = text[index:end]
        if not word:
            raise line.error(f"表达式里读不懂的字符 {char!r}", offset + index)
        if word == "contains":
            tokens.append(("op", "contains", offset + index))
        elif word in ("and", "or", "not", "exists"):
            tokens.append(("kw", word, offset + index))
        else:
            tokens.append(("literal", parse_token(word, line, offset + index), offset + index))
        index = end
    return tokens


class _ExpressionParser:
    def __init__(self, tokens: list[tuple[str, Any, int]], line: SourceLine) -> None:
        self.tokens = tokens
        self.line = line
        self.index = 0

    def _peek(self) -> tuple[str, Any, int] | None:
        return self.tokens[self.index] if self.index < len(self.tokens) else None

    def _take(self) -> tuple[str, Any, int]:
        token = self._peek()
        if token is None:
            raise self.line.error("表达式没有写完", len(self.line.text) + 1)
        self.index += 1
        return token

    def _match_keyword(self, word: str) -> bool:
        token = self._peek()
        if token is not None and token[0] == "kw" and token[1] == word:
            self.index += 1
            return True
        return False

    def parse(self) -> Any:
        node = self._parse_or()
        leftover = self._peek()
        if leftover is not None:
            raise self.line.error(f"表达式里有多余的内容 {leftover[1]!r}", leftover[2])
        return node

    def _parse_or(self) -> Any:
        items = [self._parse_and()]
        while self._match_keyword("or"):
            items.append(self._parse_and())
        return items[0] if len(items) == 1 else {"or": items}

    def _parse_and(self) -> Any:
        items = [self._parse_not()]
        while self._match_keyword("and"):
            items.append(self._parse_not())
        return items[0] if len(items) == 1 else {"and": items}

    def _parse_not(self) -> Any:
        if self._match_keyword("not"):
            return {"not": self._parse_not()}
        if self._match_keyword("exists"):
            operand = self._parse_operand()
            if not (isinstance(operand, dict) and set(operand) == {"ref"}):
                raise self.line.error("exists 的操作数必须是一条引用（nodes.x.output.y）", 1)
            return {"exists": operand}
        return self._parse_comparison()

    def _parse_comparison(self) -> Any:
        left = self._parse_operand()
        token = self._peek()
        if token is None or token[0] != "op":
            return left
        self.index += 1
        right = self._parse_operand()
        chained = self._peek()
        if chained is not None and chained[0] == "op":
            raise self.line.error("表达式不支持链式比较", chained[2], hint="写成 a < b and b < c")
        return {_COMPARISONS[token[1]]: [left, right]}

    def _parse_operand(self) -> Any:
        token = self._take()
        if token[0] == "lp":
            node = self._parse_or()
            closing = self._peek()
            if closing is None or closing[0] != "rp":
                raise self.line.error("括号没有闭合", token[2])
            self.index += 1
            return node
        if token[0] == "literal":
            return token[1]
        raise self.line.error(f"表达式的操作数位置出现了 {token[1]!r}", token[2])


def parse_expression(text: str, line: SourceLine, offset: int = 1) -> Any:
    """中缀文本 → 运行时的操作数对象。"""

    return _ExpressionParser(tokenize(text, line, offset), line).parse()


def _wrap(text: str, precedence: int, parent_precedence: int) -> str:
    return f"({text})" if precedence < parent_precedence else text


def _render(node: Any, parent_precedence: int) -> str | None:
    """操作数对象 → 中缀文本；表示不了（未知运算符、元数不对）返回 ``None``。"""

    # 单键对象里只有认得出来的运算符才算表达式，其余（典型的 {"ref": …}）当原子。
    if isinstance(node, dict) and len(node) == 1 and next(iter(node)) in _KNOWN_OPERATORS:
        operator, operands = next(iter(node.items()))
        if operator in _ARITY_TWO:
            if not isinstance(operands, list) or len(operands) != 2:
                return None
            left = _render(operands[0], _COMPARISON_PRECEDENCE)
            right = _render(operands[1], _COMPARISON_PRECEDENCE)
            if left is None or right is None:
                return None
            symbol = next((key for key, value in _COMPARISONS.items() if value == operator), None)
            if symbol is None:
                return None
            return _wrap(f"{left} {symbol} {right}", _COMPARISON_PRECEDENCE, parent_precedence)
        if operator in ("and", "or"):
            if not isinstance(operands, list) or len(operands) < 2:
                return None
            parts = [_render(item, _PRECEDENCE[operator]) for item in operands]
            if any(part is None for part in parts):
                return None
            joiner = " and " if operator == "and" else " or "
            return _wrap(joiner.join(parts), _PRECEDENCE[operator], parent_precedence)  # type: ignore[arg-type]
        if operator == "not":
            inner = _render(operands, _PRECEDENCE["not"])
            if inner is None:
                return None
            return _wrap(f"not {inner}", _PRECEDENCE["not"], parent_precedence)
        if operator == "exists":
            if not (isinstance(operands, dict) and set(operands) == {"ref"}):
                return None
            reference = render_inline(operands)
            if reference is None:
                return None
            return _wrap(f"exists {reference}", _PRECEDENCE["exists"], parent_precedence)
        return None
    text = render_inline(node, expression=True)
    return text


def render_expression(node: Any) -> str | None:
    """操作数对象 → 中缀文本（规范形式）；表示不了返回 ``None``（调用方回退到块写法）。"""

    return _render(node, 0)


__all__ = ["parse_expression", "render_expression", "tokenize"]
