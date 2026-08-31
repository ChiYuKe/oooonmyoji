"""Cross-check the extension's Behavior Tree v3 assumptions with Python."""
from __future__ import annotations

import copy
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
PROJECT_ROOT = HERE.parents[2]
SRC = PROJECT_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from oooonmyoji.actions.registry import build_action_registry
from oooonmyoji.exceptions import ConfigError
from oooonmyoji.workflows.resolver import ReferenceResolver
from oooonmyoji.workflows.validator import validate_workflow

REGISTRY = build_action_registry(PROJECT_ROOT / "plugins" / "actions")
FIXTURE = {
    "schema_version": 3,
    "id": "fixture_tree",
    "version": "3.0.0",
    "resolution": [1920, 1080],
    "root": "root",
    "blackboard": {
        "launch_x": {"type": "integer", "default": 1204},
        "hold_ms": {"type": "integer", "default": 50},
    },
    "nodes": [
        {"id": "root", "type": "root", "children": ["main"]},
        {"id": "main", "type": "sequence", "children": ["capture", "selector"]},
        {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
        {"id": "selector", "type": "selector", "children": ["tap", "log"]},
        {
            "id": "tap",
            "type": "task",
            "action": "input.tap",
            "params": {"x": {"ref": "blackboard.launch_x"}, "y": 895},
            "decorators": [{"type": "condition", "expression": {"eq": [{"ref": "blackboard.hold_ms"}, 50]}}],
        },
        {"id": "log", "type": "task", "action": "core.log", "params": {"message": "fallback"}},
    ],
}


def verdict(raw: dict[str, object]) -> str:
    try:
        validate_workflow(raw, Path("crosscheck.json"), REGISTRY, project_root=PROJECT_ROOT)
        return "accept"
    except ConfigError:
        return "reject"


def main() -> int:
    failures = 0
    expected_actions = {
        "core.assert", "core.capture", "core.log", "core.save_frame", "core.sleep",
        "input.tap", "input.tap_match", "stats.enqueue_reward", "vision.match_template", "vision.ocr",
        "vision.wait_template", "vision.wait_text", "workflow.run", "workflow.select", "workflow.sequence",
    }
    checks: list[tuple[str, bool]] = [("shared Action catalog", set(REGISTRY.names()) == expected_actions)]
    checks.append(("valid v3 tree", verdict(FIXTURE) == "accept"))

    duplicate = copy.deepcopy(FIXTURE); duplicate["nodes"].append(copy.deepcopy(duplicate["nodes"][2]))
    checks.append(("duplicate ids rejected", verdict(duplicate) == "reject"))
    orphan = copy.deepcopy(FIXTURE); orphan["nodes"][1]["children"] = ["capture"]
    checks.append(("orphan rejected", verdict(orphan) == "reject"))
    unknown_child = copy.deepcopy(FIXTURE); unknown_child["nodes"][1]["children"][0] = "missing"
    checks.append(("unknown child rejected", verdict(unknown_child) == "reject"))
    old_ref = copy.deepcopy(FIXTURE); old_ref["nodes"][4]["params"]["x"] = {"ref": "inputs.launch_x"}
    checks.append(("old ref namespace rejected", verdict(old_ref) == "reject"))
    unsafe_retry = copy.deepcopy(FIXTURE); unsafe_retry["nodes"][4]["decorators"].append({"type": "retry", "attempts": 2})
    checks.append(("unsafe retry rejected", verdict(unsafe_retry) == "reject"))
    do_once = copy.deepcopy(FIXTURE); do_once["nodes"][4]["decorators"].append({"type": "do_once"})
    checks.append(("do_once decorator accepted", verdict(do_once) == "accept"))
    do_once_reset = copy.deepcopy(FIXTURE); do_once_reset["nodes"][4]["decorators"].append({"type": "do_once", "reset_on_failure": True})
    checks.append(("do_once reset_on_failure accepted", verdict(do_once_reset) == "accept"))
    duplicate_do_once = copy.deepcopy(FIXTURE); duplicate_do_once["nodes"][4]["decorators"].extend([{"type": "do_once"}, {"type": "do_once"}])
    checks.append(("duplicate do_once rejected", verdict(duplicate_do_once) == "reject"))
    old_schema = copy.deepcopy(FIXTURE); old_schema["schema_version"] = 2
    checks.append(("schema v2 rejected", verdict(old_schema) == "reject"))

    resolver = ReferenceResolver({"launch_x": 1, "hold_ms": 50}, {"capture": {"width": 1920}})
    checks.append(("blackboard condition", resolver.condition({"eq": [{"ref": "blackboard.hold_ms"}, 50]})))
    checks.append(("node output reference", resolver.reference("nodes.capture.output.width") == 1920))
    checks.append(("missing exists is false", not resolver.condition({"exists": {"ref": "nodes.capture.output.missing"}})))

    for name, ok in checks:
        print(f"[{'OK' if ok else 'FAIL'}] {name}")
        failures += 0 if ok else 1
    print("cross-check passed" if failures == 0 else f"{failures} cross-checks failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
