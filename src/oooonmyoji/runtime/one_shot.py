"""Run a single Action outside a workflow, for interactive use.

The MCP server needs "click this one spot" without authoring a workflow file.
Rather than re-implementing the runtime, this module assembles the same pieces
``TaskRunner`` uses — instance lock, device connection, coordinate mapper,
``TaskContextImpl``, ``EventLogger`` — and invokes one Action through it, so
coordinates, timing, retries and logging behave exactly like they do in a run.

Deliberately out of scope: OCR-backed Actions (``vision.ocr`` / ``vision.wait_text``)
and ``workflow.run``.  OCR needs the worker's shared Paddle pool, and nested
workflows need the workflow engine; both are available through ``run_workflow``
instead of a one-shot call.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from ..actions.base import ActionSpec
from ..actions.manifest import apply_parameter_defaults
from ..actions.registry import ActionRegistry, build_action_registry
from ..config.model import AppConfig
from ..devices.coordinates import CoordinateMapper
from ..devices.factory import connect_at_task_boundary
from ..devices.lock import InstanceLock, InstanceLockError
from ..exceptions import ConfigError
from ..runtime.context import TaskContextImpl
from ..runtime.instances import ensure_runtime_instance, expand_runtime_instances
from ..runtime.logging import EventLogger
from ..vision.template import TemplateMatcher

DEFAULT_REFERENCE_RESOLUTION = (1920, 1080)


@dataclass
class ActionRunResult:
    """Outcome of one Action invocation."""

    action: str
    instance: str
    status: str
    output: Any = None
    error: str | None = None
    error_category: str | None = None
    backend: str = ""
    reference_resolution: tuple[int, int] = DEFAULT_REFERENCE_RESOLUTION
    device_resolution: tuple[int, int] = (0, 0)
    run_id: str = ""
    artifact_dir: str = ""
    duration_ms: int = 0
    arguments: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "succeeded"

    def as_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": self.ok,
            "action": self.action,
            "instance": self.instance,
            "status": self.status,
            "backend": self.backend,
            "reference_resolution": list(self.reference_resolution),
            "device_resolution": list(self.device_resolution),
            "run_id": self.run_id,
            "artifact_dir": self.artifact_dir,
            "duration_ms": self.duration_ms,
            "arguments": self.arguments,
        }
        if self.ok:
            payload["output"] = self.output
        else:
            payload["error"] = self.error
            payload["error_category"] = self.error_category
        return payload


def resolve_arguments(spec: ActionSpec, params: dict[str, Any] | None) -> dict[str, Any]:
    """Fill manifest defaults into the caller's parameters."""

    return apply_parameter_defaults(spec.definition.parameters, dict(params or {}))


def run_single_action(
    config: AppConfig,
    *,
    instance_id: str,
    action_name: str,
    params: dict[str, Any] | None = None,
    reference_resolution: tuple[int, int] | None = None,
    registry: ActionRegistry | None = None,
    logger: EventLogger | None = None,
    ocr_engine: Any | None = None,
) -> ActionRunResult:
    """Execute one Action against one instance and always release the device."""

    if not isinstance(action_name, str) or not action_name.strip():
        raise ConfigError("action_name must be a non-empty string")
    action_registry = registry or build_action_registry(config.action_dir)
    spec = action_registry.get(action_name)
    arguments = resolve_arguments(spec, params)

    runtime_config = expand_runtime_instances(config)
    runtime_config = ensure_runtime_instance(runtime_config, instance_id)
    try:
        instance = runtime_config.instance(instance_id)
    except StopIteration as exc:
        raise ConfigError(f"unknown runtime instance: {instance_id}") from exc
    if not instance.enabled:
        raise ConfigError(f"runtime instance is disabled: {instance_id}")

    width, height = reference_resolution or DEFAULT_REFERENCE_RESOLUTION
    if width < 1 or height < 1:
        raise ConfigError("reference_resolution must be positive")

    run_id = uuid.uuid4().hex
    artifact_dir = config.artifact_dir / f"one-shot-{run_id}"
    event_logger = logger or EventLogger(config.log_dir)
    device: Any | None = None
    lock = InstanceLock(config.artifact_dir / "locks", instance.id)
    result = ActionRunResult(
        action=action_name,
        instance=instance.id,
        status="failed",
        reference_resolution=(int(width), int(height)),
        run_id=run_id,
        artifact_dir=str(artifact_dir),
        arguments=arguments,
    )
    started = time.perf_counter()
    try:
        lock.acquire()
    except InstanceLockError as exc:
        raise ConfigError(f"instance '{instance.id}' is busy with another run: {exc}") from exc
    try:
        device, used_adb = connect_at_task_boundary(
            runtime_config,
            instance,
            attempts=runtime_config.retry.connection_attempts,
            base_delay_seconds=runtime_config.retry.base_delay_seconds,
            max_delay_seconds=runtime_config.retry.max_delay_seconds,
        )
        result.backend = "adb" if used_adb else "mumu"
        result.device_resolution = (int(device.width), int(device.height))
        mapper = CoordinateMapper(int(width), int(height), device.width, device.height)
        context = TaskContextImpl(
            device=device,
            mapper=mapper,
            template_matcher=TemplateMatcher(mapper),
            ocr_engine=ocr_engine,
            artifact_dir=artifact_dir,
            template_root=config.root_dir,
            logger=event_logger,
            capture_attempts=runtime_config.retry.capture_attempts,
            ocr_attempts=runtime_config.retry.ocr_attempts,
            retry_base_delay=runtime_config.retry.base_delay_seconds,
            retry_max_delay=runtime_config.retry.max_delay_seconds,
            run_id=run_id,
            instance_id=instance.id,
            signals_dir=config.artifact_dir / "signals",
        )
        event_logger.emit("mcp.action_started", run_id=run_id, instance_id=instance.id, action=action_name)
        try:
            outcome = spec.action.execute(context, arguments)
        except Exception as exc:  # noqa: BLE001 - surface every Action failure as a payload
            result.status = "failed"
            result.error = str(exc)
            result.error_category = type(exc).__name__
        else:
            result.status = getattr(outcome.status, "value", str(outcome.status))
            result.output = outcome.output
            result.error = outcome.error
            result.error_category = outcome.error_category
        event_logger.emit(
            "mcp.action_finished",
            run_id=run_id,
            instance_id=instance.id,
            action=action_name,
            status=result.status,
            error=result.error,
        )
    finally:
        if device is not None:
            try:
                device.close()
            except Exception:  # noqa: BLE001 - cleanup must not mask the outcome
                pass
        lock.release()
        result.duration_ms = int((time.perf_counter() - started) * 1000)
    return result


__all__ = ["ActionRunResult", "DEFAULT_REFERENCE_RESOLUTION", "resolve_arguments", "run_single_action"]
