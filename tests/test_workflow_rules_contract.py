"""两端共同的工作流校验规则样例：以 Python 权威实现逐例验证。

样例文件 ``tests/fixtures/workflow-rules/cases.json`` 同时被桌面端测试读取，
保证编辑器诊断与运行时校验在同一批规则上保持一致。
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

import pytest

from src.oooonmyoji.actions import Action, ActionRegistry, ActionSpec
from src.oooonmyoji.actions.manifest import ActionDefinition
from src.oooonmyoji.exceptions import ConfigError
from src.oooonmyoji.workflows.validator import validate_workflow

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "workflow-rules" / "cases.json"


class FixtureAction(Action):
    def execute(self, context: Any, arguments: dict[str, Any]) -> Any:
        raise AssertionError("fixture actions are never executed")


def fixture_registry(actions: dict[str, Any]) -> ActionRegistry:
    registry = ActionRegistry()
    for name, spec in actions.items():
        action = FixtureAction()
        action.name = name
        registry.register(
            ActionSpec(
                ActionDefinition(
                    name=name,
                    version="1.0.0",
                    entry=f"test:{name}",
                    description="",
                    parameters={},
                    output_schema=spec["output_schema"],
                    retry="safe" if spec.get("retry_safe") else "unsafe",
                    side_effect=not spec.get("retry_safe"),
                    input_schema=spec["input_schema"],
                ),
                action,
            )
        )
    return registry


def load_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


DATA = load_fixture()


@pytest.mark.parametrize("case", DATA["cases"], ids=[case["name"] for case in DATA["cases"]])
def test_python_matches_shared_workflow_rules(case: dict[str, Any]) -> None:
    actions = fixture_registry(DATA["actions"])
    workflow = case["workflow"]
    if case["valid"]:
        spec = validate_workflow(workflow, Path("rules.json"), actions, project_root=Path.cwd())
        assert spec.workflow_id == workflow["id"]
        return
    with pytest.raises(ConfigError) as error:
        validate_workflow(workflow, Path("rules.json"), actions, project_root=Path.cwd())
    expected = case.get("python_error")
    if expected:
        assert re.search(expected, str(error.value)), str(error.value)
