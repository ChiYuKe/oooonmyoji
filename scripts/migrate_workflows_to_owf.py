"""把工作流 JSON（v4 运行时形态或 v5 图文档）迁移成 v6 文本 `.owf`。

迁移是**语义零变化**的：v4 先按既有规则反编译成图文档，图文档再按 v6 语法写盘；
写盘前把文本解析回来编译一遍，与原文的运行时文档逐字段比对（v4 来源忽略下划线编辑器旁表），
比对不过就**不写盘**。默认只预览，`--apply` 才写盘（并删掉旧 `.json`）。

用法：
    python scripts/migrate_workflows_to_owf.py workflows/*.json
    python scripts/migrate_workflows_to_owf.py --apply workflows/*.json
    python scripts/migrate_workflows_to_owf.py --apply --keep-json workflows/*.json
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC = PROJECT_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from oooonmyoji.workflows.dsl import WORKFLOW_SUFFIX, emit_document, normalize_document, parse_document  # noqa: E402
from oooonmyoji.workflows.graph_compile import compile_graph, decompile_workflow  # noqa: E402
from oooonmyoji.workflows.graph_schema import GRAPH_SCHEMA_VERSION  # noqa: E402


def _runtime_view(raw: dict[str, Any]) -> dict[str, Any]:
    """只留下运行时关心的顶层键，用于迁移前后的等价比对（下划线旁表是编辑器状态）。"""

    return {key: value for key, value in raw.items() if not key.startswith("_")}


def _is_graph_source(raw: dict[str, Any]) -> bool:
    """源文件已经是图文档（v5 的 JSON 落盘格式，或已经是 v6）。

    `is_graph_document` 只认**当前**版本（v6），迁移脚本要能读已被取代的 v5 JSON，
    所以这里单独判断。
    """

    return raw.get("schema_version") in (5, GRAPH_SCHEMA_VERSION)


def migrate_document(raw: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """一份 JSON 文档 → （`.owf` 文本, 图文档, 运行时基线）。不等价时抛 SystemExit。"""

    if _is_graph_source(raw):
        graph = {**raw, "schema_version": GRAPH_SCHEMA_VERSION}
        baseline = _runtime_view(compile_graph(graph))
        source = "图文档 JSON"
    else:
        graph = decompile_workflow(raw)
        baseline = _runtime_view(raw)
        source = "v4 运行时文档"

    text = emit_document(normalize_document(graph))
    parsed = parse_document(text)
    if emit_document(parsed) != text:
        raise SystemExit(f"迁移失败：写出来的文本不是不动点（来源：{source}）")
    after = _runtime_view(compile_graph(parsed))
    if baseline != after:
        keys_before = sorted(baseline)
        keys_after = sorted(after)
        raise SystemExit(
            "迁移前后语义不一致，已放弃写入：\n"
            f"  原文键：{keys_before}\n"
            f"  迁移键：{keys_after}\n"
            "这是编译器或文本层的问题，请先修再迁移文件。"
        )
    return text, graph, baseline


def expand_paths(patterns: list[str]) -> list[Path]:
    """展开命令行里的通配符（PowerShell 不会替外部程序展开 `*.json`）。"""

    result: list[Path] = []
    for pattern in patterns:
        matches = [Path(item) for item in glob.glob(pattern)]
        if not matches:
            matches = [Path(pattern)]
        for path in matches:
            if path not in result:
                result.append(path)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="把工作流 JSON 迁移成 .owf 文本")
    parser.add_argument("paths", nargs="*", default=["workflows/*.json"], help="要迁移的工作流 JSON（支持通配符）")
    parser.add_argument("--apply", action="store_true", help="真的写盘（默认只预览）")
    parser.add_argument("--keep-json", action="store_true", help="保留旧 .json（默认迁移后删掉）")
    args = parser.parse_args(argv)

    paths = expand_paths(args.paths)
    if not paths:
        print("没有找到要迁移的 JSON。")
        return 0

    migrated = 0
    for path in paths:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise SystemExit(f"{path} 不是对象，跳过")
        text, graph, baseline = migrate_document(raw)
        target = path.with_suffix(WORKFLOW_SUFFIX)
        nodes = [node for node in graph.get("nodes", []) if isinstance(node, dict)]
        edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []
        print(
            f"[{'写入' if args.apply else '预览'}] {path} → {target.name}："
            f"{len(nodes)} 个节点 / {len(edges)} 条边 / {len(text.splitlines())} 行"
            f"（源：{'图文档 JSON' if _is_graph_source(raw) else 'v4 运行时文档'}，"
            f"运行时文档 {len(baseline.get('nodes', []))} 个节点一致）"
        )
        if args.apply:
            # newline="" 之外显式用 "\n"：Windows 上 write_text 默认会把 \n 翻译成 \r\n，
            # 而规范定的落盘换行是 LF（否则编辑器每次保存都会重写整个文件）。
            target.write_text(text, encoding="utf-8", newline="\n")
            if not args.keep_json:
                path.unlink()
        migrated += 1

    if args.apply:
        print(f"\n迁移完成：{migrated} 个文件。")
    else:
        print(f"\n预览完成：{migrated} 个文件待迁移。加 --apply 才会写盘。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
