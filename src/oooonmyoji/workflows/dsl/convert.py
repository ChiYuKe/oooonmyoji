"""内存里的文档 ⇄ `.owf` 文本的换算入口。

编辑器与 MCP 手里拿的是**内存形态**：编辑形态（v4，带 `children` / `_layout`）或图文档
（v6）。磁盘上只有一种：`.owf` 文本。这里把内存形态统一转成文本，供写盘一侧调用。
"""

from __future__ import annotations

from typing import Any

from ..graph_compile import decompile_workflow
from .document import emit_document
from ..graph_schema import is_graph_document


def emit_runtime_document(document: dict[str, Any]) -> str:
    """内存文档 → ``.owf`` 文本。

    - 图文档（``schema_version`` 为 6）直接写盘；
    - 编辑形态 / 运行时 v4 文档先 ``decompile_workflow`` 升级成图文档再写。
    """

    if is_graph_document(document):
        return emit_document(document)
    return emit_document(decompile_workflow(document))


__all__ = ["emit_runtime_document"]
