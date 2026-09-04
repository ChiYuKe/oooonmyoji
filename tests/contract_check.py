"""Check the Python and TypeScript workflow/status contracts stay aligned."""
from __future__ import annotations

import re
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC = PROJECT_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from oooonmyoji.runtime.records import RunStatus
from oooonmyoji.workflows.model import DECORATOR_TYPES, INSTANCE_PARALLEL_WAIT_MODES, NODE_TYPES, PARALLEL_FINISH_MODES


def _exported_values(source: str, name: str) -> tuple[str, ...]:
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.S)
    if match is None:
        raise AssertionError(f"missing TypeScript contract: {name}")
    return tuple(re.findall(r"['\"]([^'\"]+)['\"]", match.group(1)))


def main() -> int:
    desktop = (PROJECT_ROOT / "desktop/src/main/core/workflow.ts").read_text(encoding="utf-8")
    vscode = (PROJECT_ROOT / "vscode-onmyoji-workflow/src/workflow.ts").read_text(encoding="utf-8")
    checks = {
        "desktop NODE_TYPES": _exported_values(desktop, "NODE_TYPES") == tuple(NODE_TYPES),
        "vscode NODE_TYPES": _exported_values(vscode, "NODE_TYPES") == tuple(NODE_TYPES),
        "desktop DECORATOR_TYPES": _exported_values(desktop, "DECORATOR_TYPES") == tuple(DECORATOR_TYPES),
        "vscode DECORATOR_TYPES": _exported_values(vscode, "DECORATOR_TYPES") == tuple(DECORATOR_TYPES),
        "desktop PARALLEL_FINISH_MODES": _exported_values(desktop, "PARALLEL_FINISH_MODES") == tuple(PARALLEL_FINISH_MODES),
        "vscode PARALLEL_FINISH_MODES": _exported_values(vscode, "PARALLEL_FINISH_MODES") == tuple(PARALLEL_FINISH_MODES),
        "desktop INSTANCE_PARALLEL_WAIT_MODES": _exported_values(desktop, "INSTANCE_PARALLEL_WAIT_MODES") == tuple(INSTANCE_PARALLEL_WAIT_MODES),
        "vscode INSTANCE_PARALLEL_WAIT_MODES": _exported_values(vscode, "INSTANCE_PARALLEL_WAIT_MODES") == tuple(INSTANCE_PARALLEL_WAIT_MODES),
    }
    expected_statuses = {"queued", "running", "retrying", "succeeded", "failed", "cancelled", "interrupted"}
    checks["Python runtime statuses"] = {status.value for status in RunStatus} == expected_statuses
    for path in (PROJECT_ROOT / "desktop/public/runtime-log/run-log.js", PROJECT_ROOT / "vscode-onmyoji-workflow/media/run-log.js"):
        source = path.read_text(encoding="utf-8")
        checks[f"status mapping {path.parent.parent.name}"] = all(
            re.search(rf"\b{re.escape(status)}\s*:", source) for status in expected_statuses
        )
    failures = [name for name, ok in checks.items() if not ok]
    for name, ok in checks.items():
        print(f"[{'OK' if ok else 'FAIL'}] {name}")
    if failures:
        print(f"{len(failures)} contract checks failed")
        return 1
    print("contract checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

