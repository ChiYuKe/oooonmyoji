"""v6 文本格式的错误类型：带行号、列号与原文行。"""

from __future__ import annotations


class SourceLine:
    """一行原文，用于把错误定位到具体的列。"""

    __slots__ = ("path", "number", "text")

    def __init__(self, path: str | None, number: int, text: str) -> None:
        self.path = path
        self.number = number
        self.text = text

    def error(self, message: str, column: int = 1, hint: str | None = None) -> "DslError":
        return DslError(message, line=self.number, column=max(1, column), source=self.text, path=self.path, hint=hint)


class DslError(Exception):
    """文本格式的解析或序列化错误。"""

    def __init__(
        self,
        message: str,
        *,
        line: int | None = None,
        column: int | None = None,
        source: str | None = None,
        path: str | None = None,
        hint: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.line = line
        self.column = column
        self.source = source
        self.path = path
        self.hint = hint

    def render(self) -> str:
        where = self.path or "<text>"
        if self.line is None:
            head = f"{where}: {self.message}"
        else:
            head = f"{where}:{self.line}:{self.column or 1}: {self.message}"
        parts = [head]
        if self.source is not None:
            parts.append(f"  {self.line:>4} | {self.source}")
            if self.column:
                parts.append(f"       | {' ' * max(0, self.column - 1)}^")
        if self.hint:
            parts.append(f"  提示：{self.hint}")
        return "\n".join(parts)

    def __str__(self) -> str:  # pragma: no cover - 只为方便调试
        return self.render()


__all__ = ["DslError", "SourceLine"]
