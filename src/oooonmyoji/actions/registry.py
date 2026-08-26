"""Static registry for built-in and trusted local Actions."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

from ..exceptions import ActionError, ConfigError
from .base import Action, ActionSpec
from .builtin import BUILTIN_ACTIONS


ACTION_MANIFEST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["name", "version", "entry", "input_schema"],
    "properties": {
        "name": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "entry": {"type": "string", "pattern": r"^[^:]+:[A-Za-z_]\w*$"},
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "retry_safe": {"type": "boolean"},
        "side_effect": {"type": "boolean"},
    },
    "additionalProperties": False,
}


def _validate(value: object, schema: dict[str, Any], path: str) -> None:
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise ConfigError("jsonschema is required for Action validation", cause=exc) from exc
    error = next(iter(Draft202012Validator(schema).iter_errors(value)), None)
    if error is not None:
        location = ".".join(str(item) for item in error.absolute_path)
        raise ConfigError(f"{path}{('.' + location) if location else ''}: {error.message}")


class ActionRegistry:
    def __init__(self) -> None:
        self._actions: dict[str, ActionSpec] = {}

    def register(self, spec: ActionSpec) -> None:
        if not spec.name or spec.name in self._actions:
            raise ActionError(f"duplicate Action name: {spec.name}")
        if spec.action.name != spec.name:
            raise ActionError(f"Action class name mismatch for {spec.name}")
        self._actions[spec.name] = spec

    def get(self, name: str) -> ActionSpec:
        try:
            return self._actions[name]
        except KeyError as exc:
            raise ConfigError(f"unknown Action: {name}") from exc

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._actions))

    def specs(self) -> tuple[ActionSpec, ...]:
        return tuple(self._actions[name] for name in self.names())


def _safe_entry(directory: Path, entry: str) -> tuple[Path, str]:
    if ":" not in entry:
        raise ActionError("Action entry must be 'module.py:ClassName'")
    module_name, class_name = entry.split(":", 1)
    candidate = Path(module_name)
    if candidate.is_absolute() or ".." in candidate.parts or not class_name.isidentifier():
        raise ActionError(f"invalid Action entry: {entry}")
    path = (directory / candidate).resolve()
    if path.suffix != ".py":
        path = path.with_suffix(".py")
    try:
        path.relative_to(directory.resolve())
    except ValueError as exc:
        raise ActionError(f"Action entry escapes directory: {entry}") from exc
    if not path.is_file():
        raise ActionError(f"Action entry does not exist: {path}")
    return path, class_name


def _load_custom(directory: Path, manifest: dict[str, Any]) -> ActionSpec:
    path, class_name = _safe_entry(directory, manifest["entry"])
    module_name = f"oooonmyoji_action_{manifest['name'].replace('.', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ActionError(f"unable to load Action module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    candidate = getattr(module, class_name, None)
    if not isinstance(candidate, type) or not issubclass(candidate, Action):
        raise ActionError(f"Action entry is not an Action subclass: {manifest['entry']}")
    try:
        from jsonschema import Draft202012Validator
        Draft202012Validator.check_schema(manifest["input_schema"])
        if "output_schema" in manifest:
            Draft202012Validator.check_schema(manifest["output_schema"])
    except ImportError as exc:
        raise ActionError("jsonschema is required for Action validation", cause=exc) from exc
    except Exception as exc:
        raise ActionError(f"invalid Action schema for {manifest['name']}: {exc}", cause=exc) from exc
    return ActionSpec(
        name=manifest["name"],
        version=manifest["version"],
        action=candidate(),
        input_schema=manifest["input_schema"],
        output_schema=manifest.get("output_schema", {}),
        retry_safe=manifest.get("retry_safe", False),
        side_effect=manifest.get("side_effect", False),
        source=str(path),
    )


def build_action_registry(action_dir: Path | str) -> ActionRegistry:
    root = Path(action_dir).resolve()
    if not root.is_dir():
        raise ActionError(f"Action directory does not exist: {root}")
    registry = ActionRegistry()
    for action, input_schema, output_schema, retry_safe, side_effect in BUILTIN_ACTIONS:
        registry.register(ActionSpec(action.name, "1.0.0", action, input_schema, output_schema, retry_safe, side_effect))
    for directory in sorted(path for path in root.iterdir() if path.is_dir()):
        manifest_path = directory / "action.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ActionError(f"unable to read Action manifest: {manifest_path}", cause=exc) from exc
        _validate(manifest, ACTION_MANIFEST_SCHEMA, str(manifest_path))
        registry.register(_load_custom(directory, manifest))
    return registry


__all__ = ["ACTION_MANIFEST_SCHEMA", "ActionRegistry", "build_action_registry"]
