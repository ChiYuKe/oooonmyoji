"""测试用的工作流落盘助手。

磁盘上只有 `.owf` 文本一种工作流格式，而测试里构造的通常是**内存文档**（v4 编辑/运行时
形态，或图文档）。这里统一换算，避免每个用例自己拼文本：

    from tests.workflow_files import write_workflow

    write_workflow(path / "workflows" / "wf.owf", {"schema_version": 4, ...})
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.oooonmyoji.workflows.dsl import WORKFLOW_SUFFIX, emit_runtime_document


def workflow_text(document: dict[str, Any]) -> str:
    """内存文档 → `.owf` 文本（v4 文档先升级成图文档再写）。"""

    return emit_runtime_document(document)


def write_workflow(path: Path | str, document: dict[str, Any]) -> Path:
    """把内存文档写盘成 `.owf`，返回**实际写入的路径**（后缀会换成 `.owf`）。

    换行固定用 LF：规范定的落盘换行是 LF，Windows 上默认的 `\r\n` 会让「文本是不是不动点」
    这类断言在与桌面端对比时出现假差异。
    """

    candidate = Path(path)
    target = candidate if candidate.suffix == WORKFLOW_SUFFIX else candidate.with_suffix(WORKFLOW_SUFFIX)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(emit_runtime_document(document), encoding="utf-8", newline="\n")
    return target


__all__ = ["workflow_text", "write_workflow"]
