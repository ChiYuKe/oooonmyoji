"""文件名与标识符清洗工具。

运行产物、调试截图和实例锁都需要把任意字符串转换成可安全用作
文件名或目录名的形式。这里集中提供唯一的实现，避免各处正则不一致。
"""

from __future__ import annotations

import re

_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9_.-]+")


def safe_name(value: object, *, fallback: str = "unknown") -> str:
    """把任意值清洗成可安全用作文件名的字符串。

    只保留字母、数字、下划线、点和连字符，其余字符折叠为一个下划线；
    清洗结果为空时返回 ``fallback``。
    """

    cleaned = _UNSAFE_NAME.sub("_", str(value if value else fallback))
    return cleaned or fallback


__all__ = ["safe_name"]
