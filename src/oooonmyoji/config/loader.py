"""Configuration parsing and strict schema validation."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..exceptions import ConfigError
from .model import AppConfig, InstanceConfig, JobConfig, OcrConfig, RetryConfig


APP_CONFIG_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["schema_version", "instances", "tasks"],
    "properties": {
        "schema_version": {"const": 2},
        "timezone": {"type": "string", "minLength": 1},
        "mumu_path": {"type": ["string", "null"]},
        "adb_path": {"type": ["string", "null"]},
        "workflow_dir": {"type": "string", "minLength": 1},
        "action_dir": {"type": "string", "minLength": 1},
        "discover_mumu_instances": {"type": "boolean"},
        "instances": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "backend": {"enum": ["mumu", "adb"]},
                    "mumu_index": {"type": "integer", "minimum": 0},
                    "adb_serial": {"type": ["string", "null"]},
                    "package": {"type": ["string", "null"]},
                    "enabled": {"type": "boolean"},
                },
                "additionalProperties": False,
            },
        },
        "ocr": {
            "type": "object",
            "properties": {
                "enabled": {"type": "boolean"},
                "language": {"type": "string", "minLength": 1},
                "workers": {"type": "integer", "minimum": 1},
                "request_timeout_seconds": {"type": "number", "exclusiveMinimum": 0},
                "min_confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "use_gpu": {"type": "boolean"},
            },
            "additionalProperties": False,
        },
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "workflow", "instance"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "workflow": {"type": "string", "minLength": 1},
                    "instance": {"type": "string", "minLength": 1},
                    "inputs": {"type": "object"},
                    "schedule": {
                        "type": "object",
                        "properties": {
                            "type": {"enum": ["manual", "once", "interval"]},
                            "at": {"type": "string", "minLength": 1},
                            "start_at": {"type": "string", "minLength": 1},
                            "seconds": {"type": "number", "exclusiveMinimum": 0},
                        },
                        "additionalProperties": False,
                    },
                    "enabled": {"type": "boolean"},
                    "retry_enabled": {"type": "boolean"},
                },
                "additionalProperties": False,
            },
        },
        "scheduler": {"type": "object", "additionalProperties": True},
        "retry": {
            "type": "object",
            "properties": {
                "connection_attempts": {"type": "integer", "minimum": 1},
                "capture_attempts": {"type": "integer", "minimum": 1},
                "ocr_attempts": {"type": "integer", "minimum": 1},
                "task_attempts": {"type": "integer", "minimum": 1},
                "base_delay_seconds": {"type": "number", "minimum": 0},
                "max_delay_seconds": {"type": "number", "minimum": 0},
            },
            "additionalProperties": False,
        },
        "log_dir": {"type": "string", "minLength": 1},
        "artifact_dir": {"type": "string", "minLength": 1},
        "save_screenshots": {"type": "boolean"},
    },
    "additionalProperties": False,
}


def _validate_json_schema(value: object, schema: dict[str, Any], path: str = "config") -> None:
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise ConfigError("jsonschema is required for configuration validation", cause=exc) from exc
    error = next(iter(Draft202012Validator(schema).iter_errors(value)), None)
    if error is None:
        return
    location = ".".join(str(item) for item in error.absolute_path)
    prefix = f"{path}.{location}" if location else path
    raise ConfigError(f"{prefix}: {error.message}")


def _object(value: object, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{path} must be an object")
    return value


def _string(value: object, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{path} must be a non-empty string")
    return value


def _bool(value: object, path: str, default: bool) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ConfigError(f"{path} must be a boolean")
    return value


def _int(value: object, path: str, default: int, *, minimum: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ConfigError(f"{path} must be an integer >= {minimum}")
    return value


def _float(value: object, path: str, default: float, *, minimum: float = 0.0, maximum: float | None = None) -> float:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError(f"{path} must be a number")
    number = float(value)
    if number < minimum or (maximum is not None and number > maximum):
        raise ConfigError(f"{path} is outside the allowed range")
    return number


def _path(value: object, path: str, base: Path, *, must_exist: bool = False, directory: bool = False, file: bool = False) -> Path | None:
    if value is None:
        return None
    resolved = Path(_string(value, path))
    if not resolved.is_absolute():
        resolved = base / resolved
    resolved = resolved.resolve()
    if must_exist and (not resolved.exists() or (directory and not resolved.is_dir()) or (file and not resolved.is_file())):
        raise ConfigError(f"{path} does not exist: {resolved}")
    return resolved


def _workflow_path(workflow_dir: Path, reference: str, *, require_file: bool) -> Path:
    candidate = Path(reference)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ConfigError(f"workflow reference escapes workflow_dir: {reference}")
    if candidate.suffix.lower() != ".json":
        candidate = candidate.with_suffix(".json")
    path = (workflow_dir / candidate).resolve()
    try:
        path.relative_to(workflow_dir.resolve())
    except ValueError as exc:
        raise ConfigError(f"workflow reference escapes workflow_dir: {reference}") from exc
    if require_file and not path.is_file():
        # Workflows are organized in nested folders. Keep bare IDs and file
        # names convenient by resolving a unique recursive match as a fallback.
        matches = [item for item in workflow_dir.rglob("*.json") if item.name == candidate.name]
        if len(matches) == 1:
            path = matches[0].resolve()
        elif not matches:
            for item in workflow_dir.rglob("*.json"):
                try:
                    value = json.loads(item.read_text(encoding="utf-8"))
                except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if isinstance(value, dict) and value.get("id") == candidate.stem:
                    matches.append(item)
            if len(matches) == 1:
                path = matches[0].resolve()
        if not path.is_file():
            raise ConfigError(f"workflow does not exist: {path}")
    return path


def _project_child(path: Path, root: Path, field: str) -> Path:
    try:
        path.relative_to(root.resolve())
    except ValueError as exc:
        raise ConfigError(f"{field} must stay below the project root: {path}") from exc
    return path


def load_config(path: Path | str) -> AppConfig:
    config_path = Path(path).resolve()
    if not config_path.is_file():
        raise ConfigError(f"configuration file does not exist: {config_path}")
    try:
        raw_value = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"unable to read JSON config {config_path}: {exc}", cause=exc) from exc
    raw = _object(raw_value, "config")
    version = raw.get("schema_version")
    if version == 1:
        raise ConfigError("schema_version 1 is no longer supported; migrate tasks.plugin/params to tasks.workflow/inputs and set schema_version to 2")
    _validate_json_schema(raw, APP_CONFIG_SCHEMA)
    root_dir = config_path.parent.parent if config_path.parent.name == "config" else config_path.parent
    timezone = _string(raw.get("timezone", "Asia/Shanghai"), "timezone")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise ConfigError(f"timezone is not available: {timezone}") from exc
    mumu_path = _path(raw.get("mumu_path"), "mumu_path", root_dir, must_exist=True, directory=True)
    adb_path = _path(raw.get("adb_path"), "adb_path", root_dir, must_exist=True, file=True)
    workflow_dir = _path(raw.get("workflow_dir", "workflows"), "workflow_dir", root_dir, must_exist=True, directory=True)
    action_dir = _path(raw.get("action_dir", "plugins/actions"), "action_dir", root_dir, must_exist=True, directory=True)
    assert workflow_dir is not None and action_dir is not None
    workflow_dir = _project_child(workflow_dir, root_dir, "workflow_dir")
    action_dir = _project_child(action_dir, root_dir, "action_dir")
    log_dir = _path(raw.get("log_dir", "logs"), "log_dir", root_dir)
    artifact_dir = _path(raw.get("artifact_dir", "artifacts"), "artifact_dir", root_dir)
    assert log_dir is not None and artifact_dir is not None

    instance_values = raw["instances"]
    assert isinstance(instance_values, list)
    instances: list[InstanceConfig] = []
    instance_ids: set[str] = set()
    for index, value in enumerate(instance_values):
        data = _object(value, f"instances[{index}]")
        instance_id = _string(data.get("id"), f"instances[{index}].id")
        if instance_id in instance_ids:
            raise ConfigError(f"duplicate instance id: {instance_id}")
        instance_ids.add(instance_id)
        backend = _string(data.get("backend", "mumu"), f"instances[{index}].backend")
        adb_serial = data.get("adb_serial")
        if adb_serial is not None:
            adb_serial = _string(adb_serial, f"instances[{index}].adb_serial")
        if backend == "adb" and not adb_serial:
            raise ConfigError(f"instances[{index}].adb_serial is required for ADB backend")
        package = data.get("package")
        if package is not None:
            package = _string(package, f"instances[{index}].package")
        instances.append(InstanceConfig(
            id=instance_id,
            backend=backend,
            mumu_index=_int(data.get("mumu_index"), f"instances[{index}].mumu_index", 0),
            adb_serial=adb_serial,
            package=package,
            enabled=_bool(data.get("enabled"), f"instances[{index}].enabled", True),
        ))

    ocr_data = _object(raw.get("ocr", {}), "ocr")
    ocr = OcrConfig(
        enabled=_bool(ocr_data.get("enabled"), "ocr.enabled", True),
        language=_string(ocr_data.get("language", "ch"), "ocr.language"),
        workers=_int(ocr_data.get("workers"), "ocr.workers", 1, minimum=1),
        request_timeout_seconds=_float(ocr_data.get("request_timeout_seconds"), "ocr.request_timeout_seconds", 15.0, minimum=0.1),
        min_confidence=_float(ocr_data.get("min_confidence"), "ocr.min_confidence", 0.6, minimum=0.0, maximum=1.0),
        use_gpu=_bool(ocr_data.get("use_gpu"), "ocr.use_gpu", False),
    )

    retry_data = _object(raw.get("retry", {}), "retry")
    retry = RetryConfig(
        connection_attempts=_int(retry_data.get("connection_attempts"), "retry.connection_attempts", 3, minimum=1),
        capture_attempts=_int(retry_data.get("capture_attempts"), "retry.capture_attempts", 3, minimum=1),
        ocr_attempts=_int(retry_data.get("ocr_attempts"), "retry.ocr_attempts", 2, minimum=1),
        task_attempts=_int(retry_data.get("task_attempts"), "retry.task_attempts", 1, minimum=1),
        base_delay_seconds=_float(retry_data.get("base_delay_seconds"), "retry.base_delay_seconds", 0.25, minimum=0.0),
        max_delay_seconds=_float(retry_data.get("max_delay_seconds"), "retry.max_delay_seconds", 3.0, minimum=0.0),
    )
    if retry.max_delay_seconds < retry.base_delay_seconds:
        raise ConfigError("retry.max_delay_seconds must be >= base_delay_seconds")

    job_values = raw["tasks"]
    assert isinstance(job_values, list)
    jobs: list[JobConfig] = []
    job_ids: set[str] = set()
    for index, value in enumerate(job_values):
        data = _object(value, f"tasks[{index}]")
        job_id = _string(data.get("id"), f"tasks[{index}].id")
        if job_id in job_ids:
            raise ConfigError(f"duplicate task id: {job_id}")
        job_ids.add(job_id)
        instance = _string(data.get("instance"), f"tasks[{index}].instance")
        if instance not in instance_ids:
            raise ConfigError(f"tasks[{index}].instance references unknown instance '{instance}'")
        workflow = _string(data.get("workflow"), f"tasks[{index}].workflow")
        _workflow_path(workflow_dir, workflow, require_file=True)
        inputs = data.get("inputs", {})
        assert isinstance(inputs, dict)
        schedule = data.get("schedule", {"type": "manual"})
        assert isinstance(schedule, dict)
        schedule_type = schedule.get("type", "manual")
        if schedule_type not in {"manual", "once", "interval"}:
            raise ConfigError(f"tasks[{index}].schedule.type is invalid")
        if schedule_type == "interval" and _float(schedule.get("seconds"), f"tasks[{index}].schedule.seconds", 0, minimum=0.001) <= 0:
            raise ConfigError(f"tasks[{index}].schedule.seconds must be positive")
        if schedule_type == "once" and not isinstance(schedule.get("at"), str):
            raise ConfigError(f"tasks[{index}].schedule.at is required for one-shot tasks")
        for schedule_key in ("at", "start_at"):
            schedule_value = schedule.get(schedule_key)
            if schedule_value is not None:
                try:
                    datetime.fromisoformat(str(schedule_value).replace("Z", "+00:00"))
                except ValueError as exc:
                    raise ConfigError(f"tasks[{index}].schedule.{schedule_key} is not a valid ISO-8601 time") from exc
        jobs.append(JobConfig(
            id=job_id,
            workflow=workflow,
            instance=instance,
            inputs=inputs,
            schedule=schedule,
            enabled=_bool(data.get("enabled"), f"tasks[{index}].enabled", True),
            retry_enabled=_bool(data.get("retry_enabled"), f"tasks[{index}].retry_enabled", False),
        ))
    scheduler = _object(raw.get("scheduler", {}), "scheduler")
    return AppConfig(
        schema_version=2,
        timezone=timezone,
        config_path=config_path,
        root_dir=root_dir,
        mumu_path=mumu_path,
        adb_path=adb_path,
        workflow_dir=workflow_dir,
        action_dir=action_dir,
        discover_mumu_instances=_bool(raw.get("discover_mumu_instances"), "discover_mumu_instances", False),
        instances=tuple(instances),
        ocr=ocr,
        jobs=tuple(jobs),
        scheduler=scheduler,
        retry=retry,
        log_dir=log_dir,
        artifact_dir=artifact_dir,
        save_screenshots=_bool(raw.get("save_screenshots"), "save_screenshots", False),
        raw=raw,
    )


def resolve_workflow_path(workflow_dir: Path, reference: str, *, require_file: bool = True) -> Path:
    return _workflow_path(workflow_dir, reference, require_file=require_file)


__all__ = ["APP_CONFIG_SCHEMA", "load_config", "resolve_workflow_path"]
