"""Workflow discovery and immutable file snapshots."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import Any

from ..actions import ActionRegistry
from ..config.loader import resolve_workflow_path
from ..exceptions import ConfigError, WorkflowError
from .model import WorkflowSpec
from .resolver import ReferenceResolver, is_binding
from .validator import validate_workflow


class WorkflowLoader:
    def __init__(self, workflow_dir: Path | str, registry: ActionRegistry, *, project_root: Path | None = None) -> None:
        self.workflow_dir = Path(workflow_dir).resolve()
        self.registry = registry
        self.project_root = (project_root or self.workflow_dir.parent).resolve()

    def path_for(self, reference: str) -> Path:
        return resolve_workflow_path(self.workflow_dir, reference)

    def load(self, reference: str) -> WorkflowSpec:
        path = self.path_for(reference)
        try:
            payload = path.read_bytes()
            raw = json.loads(payload.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise WorkflowError(f"unable to read workflow {path}: {exc}", cause=exc) from exc
        if not isinstance(raw, dict):
            raise ConfigError(f"workflow {path} must be a JSON object")
        spec = validate_workflow(raw, path, self.registry, project_root=self.project_root)
        self.validate_paths(spec)
        return replace(spec, file_hash=hashlib.sha256(payload).hexdigest())

    def validate_inputs(self, workflow: WorkflowSpec, inputs: dict[str, Any]) -> None:
        try:
            from jsonschema import Draft202012Validator
        except ImportError as exc:
            raise ConfigError("jsonschema is required for workflow validation", cause=exc) from exc
        error = next(iter(Draft202012Validator(workflow.blackboard_schema).iter_errors(inputs)), None)
        if error is not None:
            location = ".".join(str(item) for item in error.absolute_path)
            raise ConfigError(f"workflow {workflow.workflow_id} blackboard{('.' + location) if location else ''}: {error.message}")

    def normalize_inputs(self, workflow: WorkflowSpec, inputs: dict[str, Any]) -> dict[str, Any]:
        """Apply JSON Schema defaults after validating the caller's input object."""
        self.validate_inputs(workflow, inputs)
        normalized = deepcopy(inputs)

        def apply(value: Any, schema: Any) -> None:
            if not isinstance(schema, dict):
                return
            properties = schema.get("properties")
            if isinstance(value, dict) and isinstance(properties, dict):
                for name, child_schema in properties.items():
                    if name not in value and isinstance(child_schema, dict) and "default" in child_schema:
                        value[name] = deepcopy(child_schema["default"])
                    if name in value:
                        apply(value[name], child_schema)
            elif isinstance(value, list) and isinstance(schema.get("items"), dict):
                for item in value:
                    apply(item, schema["items"])

        apply(normalized, workflow.blackboard_schema)
        return normalized

    def validate_paths(self, workflow: WorkflowSpec) -> None:
        for node in workflow.nodes:
            if not node.is_task or node.action not in {"vision.match_template", "vision.wait_template"}:
                continue
            template = node.params.get("template")
            if not isinstance(template, str):
                continue
            self._validate_template_path(workflow, template)

    def validate_input_paths(self, workflow: WorkflowSpec, inputs: dict[str, Any]) -> None:
        resolver = ReferenceResolver(inputs, {})
        missing = object()
        for node in workflow.nodes:
            if not node.is_task or node.action not in {"vision.match_template", "vision.wait_template"}:
                continue
            template = node.params.get("template")
            if not (isinstance(template, dict) and is_binding(template)):
                continue
            ref = template.get("ref")
            if not isinstance(ref, str) or not ref.startswith("blackboard."):
                continue
            resolved = resolver.reference(ref, default=missing)
            if resolved is missing:
                continue
            if isinstance(resolved, str):
                self._validate_template_path(workflow, resolved)

    def _validate_template_path(self, workflow: WorkflowSpec, template: str) -> None:
        candidate = Path(template)
        if candidate.is_absolute() or ".." in candidate.parts:
            raise ConfigError(f"workflow {workflow.workflow_id} template escapes project root: {template}")
        path = (self.project_root / candidate).resolve()
        try:
            path.relative_to(self.project_root)
        except ValueError as exc:
            raise ConfigError(f"workflow {workflow.workflow_id} template escapes project root: {template}") from exc
        if not path.is_file():
            raise ConfigError(f"workflow {workflow.workflow_id} template does not exist: {path}")

    def discover(self) -> dict[str, WorkflowSpec]:
        if not self.workflow_dir.is_dir():
            raise WorkflowError(f"workflow directory does not exist: {self.workflow_dir}")
        result: dict[str, WorkflowSpec] = {}
        for path in sorted(self.workflow_dir.glob("*.json")):
            spec = self.load(path.name)
            if spec.workflow_id in result:
                raise ConfigError(f"duplicate workflow id: {spec.workflow_id}")
            result[spec.workflow_id] = spec
        return result


__all__ = ["WorkflowLoader"]
