"""Backend construction and task-boundary fallback policy."""

from __future__ import annotations

from pathlib import Path
import shutil
import time

from ..config.model import AppConfig, InstanceConfig
from ..exceptions import DeviceConnectionError
from .adb import AdbDevice
from .mumu import MumuDevice, discover_mumu_path
from .protocol import DeviceBackend


def create_backend(config: AppConfig, instance: InstanceConfig, *, backend_name: str | None = None) -> DeviceBackend:
    name = backend_name or instance.backend
    if name == "adb":
        if not instance.adb_serial:
            raise DeviceConnectionError(f"instance '{instance.id}' has no adb_serial")
        return AdbDevice(instance.adb_serial, adb_path=resolve_adb_path(config), instance_id=instance.id)
    if name != "mumu":
        raise DeviceConnectionError(f"unsupported device backend: {name}")
    return MumuDevice(config.mumu_path, instance.mumu_index, instance.package)


def connect_at_task_boundary(
    config: AppConfig,
    instance: InstanceConfig,
    *,
    attempts: int = 3,
    base_delay_seconds: float = 0.25,
    max_delay_seconds: float = 3.0,
) -> tuple[DeviceBackend, bool]:
    """Connect the configured backend and optionally fall back to ADB.

    The returned boolean reports whether ADB was selected. The fallback is
    evaluated before the task starts and is never attempted in the middle of it.
    """

    backend: DeviceBackend | None = None
    if instance.backend == "adb":
        backend = create_backend(config, instance, backend_name="adb")
        return backend.connect(), True
    last_error: BaseException | None = None
    for attempt in range(attempts):
        backend = None
        try:
            backend = create_backend(config, instance, backend_name="mumu")
            return backend.connect(), False
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            last_error = exc
            if backend is not None:
                backend.close()
            if attempt + 1 < attempts:
                time.sleep(min(max_delay_seconds, base_delay_seconds * (2**attempt)))
    if instance.adb_serial:
        backend = create_backend(config, instance, backend_name="adb")
        return backend.connect(), True
    raise DeviceConnectionError(f"native backend failed after {attempts} attempts", cause=last_error)


__all__ = ["connect_at_task_boundary", "create_backend", "resolve_adb_path"]


def resolve_adb_path(config: AppConfig) -> str:
    if config.adb_path is not None:
        return str(config.adb_path)
    mumu_path = config.mumu_path or discover_mumu_path()
    if mumu_path is not None:
        candidates = (
            mumu_path / "shell" / "adb.exe",
            mumu_path / "nx_main" / "adb.exe",
            mumu_path / "nx_device" / "12.0" / "shell" / "adb.exe",
            mumu_path / "nx_device" / "15.0" / "shell" / "adb.exe",
            mumu_path / "adb.exe",
        )
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
    return shutil.which("adb") or "adb"
