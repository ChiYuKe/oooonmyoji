"""v6 工作流文本格式（``.owf``）：解析、序列化与规范化。

    from oooonmyoji.workflows.dsl import emit_document, parse_document

    text = emit_document(graph_document)      # 图文档 dict → .owf 文本
    document = parse_document(text)           # .owf 文本 → 图文档 dict（schema_version 6）

解析产出与 v5 图文档同形，所以 `graph_compile.compile_graph` 直接吃它，运行时零改动。
"""

from .errors import DslError, SourceLine
from .expr import parse_expression, render_expression
from .convert import emit_runtime_document
from .document import (
    DOCUMENT_SCHEMA_VERSION,
    INDENT,
    WORKFLOW_SUFFIX,
    emit_document,
    normalize_document,
    parse_document,
    read_document_id,
)

__all__ = [
    "DOCUMENT_SCHEMA_VERSION",
    "INDENT",
    "WORKFLOW_SUFFIX",
    "DslError",
    "SourceLine",
    "emit_document",
    "emit_runtime_document",
    "normalize_document",
    "parse_document",
    "parse_expression",
    "read_document_id",
    "render_expression",
    "WORKFLOW_SUFFIX",
]
