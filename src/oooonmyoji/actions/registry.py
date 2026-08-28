"""Action registry: built-in and plugin Actions share one manifest loading path."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

from ..exceptions import ActionError, ConfigError
from .base import Action, ActionSpec
from .manifest import ACTION_MANIFEST_SCHEMA, ActionDefinition


def _validate_manifest(value: object, schema: dict[str, Any], path: str) -> dict[str, Any]:
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise ConfigError("jsonschema is required for Action validation", cause=exc) from exc
    if not isinstance(value, dict):
        raise ActionError(f"Action manifest must be an object: {path}")
    error = next(iter(Draft202012Validator(schema).iter_errors(value)), None)
    if error is not None:
        location = ".".join(str(item) for item in error.absolute_path)
        raise ConfigError(f"{path}{('.' + location) if location else ''}: {error.message}")
    return value


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


def _read_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ActionError(f"unable to read Action manifest: {path}", cause=exc) from exc
    return _validate_manifest(value, ACTION_MANIFEST_SCHEMA, str(path))


def _load_builtin_instance(class_name: str) -> Action:
    from . import builtin as builtin_module

    candidate = getattr(builtin_module, class_name, None)
    if not isinstance(candidate, type) or not issubclass(candidate, Action):
        raise ActionError(f"builtin Action entry is not an Action subclass: {class_name}")
    return candidate()


def _safe_entry(directory: Path, entry: str) -> tuple[Path, str]:
    """Resolve a plugin entry ``module.py:ClassName`` to a file below ``directory``."""
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


def _load_plugin_instance(directory: Path, entry: str) -> Action:
    path, class_name = _safe_entry(directory, entry)
    module_name = f"oooonmyoji_action_{path.stem}_{abs(hash(path))}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ActionError(f"unable to load Action module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    candidate = getattr(module, class_name, None)
    if not isinstance(candidate, type) or not issubclass(candidate, Action):
        raise ActionError(f"Action entry is not an Action subclass: {entry}")
    return candidate()


def _load_entry(directory: Path, definition: ActionDefinition) -> Action:
    entry = definition.entry
    if entry.startswith("builtin:"):
        return _load_builtin_instance(entry.split(":", 1)[1])
    return _load_plugin_instance(directory, entry)


def build_action_registry(
    action_dir: Path | str,
    builtin_dir: Path | str | None = None,
) -> ActionRegistry:
    """Build a registry from built-in manifests plus plugin manifests.

    ``action_dir`` is the plugin directory (``plugins/actions``); ``builtin_dir``
    defaults to the built-in manifests shipped inside the package.
    """
    if builtin_dir is None:
        builtin_dir = Path(__file__).parent / "manifests"
    root = Path(action_dir).resolve()
    if not root.is_dir():
        raise ActionError(f"Action directory does not exist: {root}")
    manifests_root = Path(builtin_dir).resolve()
    if not manifests_root.is_dir():
        raise ActionError(f"built-in Action manifest directory does not exist: {manifests_root}")

    registry = ActionRegistry()

    # Built-in manifests live in a shared directory; their entry uses the
    # ``builtin:ClassName`` prefix and the class is resolved from this package.
    for manifest_path in sorted(manifests_root.glob("*.json")):
        manifest = _read_manifest(manifest_path)
        definition = ActionDefinition.parse(manifest)
        registry.register(ActionSpec(definition, _load_entry(manifests_root, definition), source=str(manifest_path)))

    # Plugin manifests use the same v2 format, resolved below plugins/actions.
    for directory in sorted(path for path in root.iterdir() if path.is_dir()):
        manifest_path = directory / "action.json"
        if not manifest_path.is_file():
            continue
        manifest = _read_manifest(manifest_path)
        definition = ActionDefinition.parse(manifest)
        registry.register(ActionSpec(definition, _load_entry(directory, definition), source=str(manifest_path)))

    return registry


__all__ = ["ACTION_MANIFEST_SCHEMA", "ActionRegistry", "build_action_registry"]
