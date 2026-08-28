from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.oooonmyoji.actions import build_action_registry
from src.oooonmyoji.actions.manifest import (
    ActionDefinition,
    ParameterDefinition,
    apply_parameter_defaults,
    compile_parameters,
)
from src.oooonmyoji.config import load_config
from src.oooonmyoji.exceptions import ConfigError
from src.oooonmyoji.workflows.loader import WorkflowLoader


def _write_config(path: Path, *, tasks: list[dict] | None = None) -> Path:
    config_dir = path / "config"
    config_dir.mkdir()
    (path / "workflows").mkdir()
    (path / "plugins" / "actions").mkdir(parents=True)
    (path / "workflows" / "simple.json").write_text(json.dumps({
        "schema_version": 3,
        "id": "simple",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [
            {"id": "root", "type": "root", "children": ["capture"]},
            {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
        ],
    }), encoding="utf-8")
    config_path = config_dir / "config.json"
    config_path.write_text(json.dumps({
        "schema_version": 2,
        "instances": [{"id": "one", "backend": "adb", "adb_serial": "serial"}],
        "workflow_dir": "workflows",
        "action_dir": "plugins/actions",
        "tasks": tasks or [{"id": "check", "workflow": "simple", "instance": "one"}],
    }), encoding="utf-8")
    return config_path


def test_config_and_workflow_manifest_validate(tmp_path: Path) -> None:
    config = load_config(_write_config(tmp_path))
    registry = build_action_registry(config.action_dir)
    workflows = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir).discover()
    assert config.instance("one").backend == "adb"
    assert config.discover_mumu_instances is False
    assert workflows["simple"].resolution == (1920, 1080)


def test_config_rejects_unknown_instance_reference(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="unknown instance"):
        load_config(_write_config(tmp_path, tasks=[{"id": "bad", "workflow": "simple", "instance": "missing"}]))


def test_config_rejects_missing_explicit_mumu_path(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    raw["mumu_path"] = str(tmp_path / "missing-mumu")
    config_path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ConfigError, match="mumu_path does not exist"):
        load_config(config_path)


def test_schema_version_one_is_rejected(tmp_path: Path) -> None:
    config_path = _write_config(tmp_path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    raw["schema_version"] = 1
    config_path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ConfigError, match="schema_version 1"):
        load_config(config_path)


def test_action_loader_rejects_duplicate_names(tmp_path: Path) -> None:
    root = tmp_path / "actions"
    root.mkdir()
    for name in ("one", "two"):
        directory = root / name
        directory.mkdir()
        (directory / "action.json").write_text(json.dumps({
            "schema_version": 2,
            "name": "custom.same",
            "version": "1.0.0",
            "entry": "action.py:Example",
            "parameters": {},
        }), encoding="utf-8")
        (directory / "action.py").write_text(
            "from src.oooonmyoji.actions.base import Action, ActionResult\n"
            "class Example(Action):\n"
            "    name = 'custom.same'\n"
            "    def execute(self, context, arguments):\n"
            "        return ActionResult.succeeded({})\n",
            encoding="utf-8",
        )
    with pytest.raises(Exception, match="duplicate Action name"):
        build_action_registry(root)


def test_parameter_definitions_apply_nested_constraints_and_defaults() -> None:
    options = ParameterDefinition.parse(
        "options",
        {
            "type": "object",
            "default": {},
            "properties": {
                "enabled": {"type": "boolean", "required": True, "default": True},
                "items": {
                    "type": "array",
                    "default": [{}],
                    "items": {
                        "type": "object",
                        "properties": {"count": {"type": "integer", "required": True, "default": 2}},
                    },
                },
            },
        },
    )
    nullable = ParameterDefinition.parse("nullable", {"type": "any", "default": None})
    schema = compile_parameters({"options": options, "nullable": nullable})
    assert schema["properties"]["options"]["required"] == ["enabled"]
    assert schema["properties"]["nullable"]["default"] is None
    assert apply_parameter_defaults({"options": options, "nullable": nullable}, {}) == {
        "options": {"enabled": True, "items": [{"count": 2}]},
        "nullable": None,
    }


@pytest.mark.parametrize(
    "manifest, message",
    [
        (
            {"schema_version": 2, "name": "bad.range", "entry": "x.py:X", "parameters": {"count": {"type": "integer", "min": 10, "max": 1}}},
            "min must be <= max",
        ),
        (
            {"schema_version": 2, "name": "bad.default", "entry": "x.py:X", "parameters": {"count": {"type": "integer", "default": "one"}}},
            "default",
        ),
        (
            {"schema_version": 2, "name": "bad.output", "entry": "x.py:X", "parameters": {}, "outputs": {"type": "not-a-type"}},
            "outputs is not a valid JSON Schema",
        ),
    ],
)
def test_action_definition_rejects_invalid_manifest_semantics(manifest: dict[str, object], message: str) -> None:
    with pytest.raises(ConfigError, match=message):
        ActionDefinition.parse(manifest)
