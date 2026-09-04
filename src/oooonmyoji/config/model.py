"""Typed application configuration loaded from JSON."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class InstanceConfig:
    id: str
    backend: str = "mumu"
    mumu_index: int = 0
    adb_serial: str | None = None
    package: str | None = None
    enabled: bool = True
    display_name: str | None = None


@dataclass(frozen=True)
class OcrConfig:
    enabled: bool = True
    language: str = "ch"
    workers: int = 1
    request_timeout_seconds: float = 15.0
    min_confidence: float = 0.6
    use_gpu: bool = False


@dataclass(frozen=True)
class RetryConfig:
    connection_attempts: int = 3
    capture_attempts: int = 3
    ocr_attempts: int = 2
    task_attempts: int = 1
    base_delay_seconds: float = 0.25
    max_delay_seconds: float = 3.0


@dataclass(frozen=True)
class DebugConfig:
    enabled: bool = False
    annotate_screenshots: bool = True


@dataclass(frozen=True)
class JobConfig:
    id: str
    workflow: str
    instance: str
    inputs: dict[str, Any] = field(default_factory=dict)
    schedule: dict[str, Any] = field(default_factory=lambda: {"type": "manual"})
    enabled: bool = True
    retry_enabled: bool = False


@dataclass(frozen=True)
class AppConfig:
    schema_version: int
    timezone: str
    config_path: Path
    root_dir: Path
    mumu_path: Path | None
    adb_path: Path | None
    workflow_dir: Path
    action_dir: Path
    discover_mumu_instances: bool
    instances: tuple[InstanceConfig, ...]
    ocr: OcrConfig
    jobs: tuple[JobConfig, ...]
    scheduler: dict[str, Any]
    retry: RetryConfig
    log_dir: Path
    artifact_dir: Path
    save_screenshots: bool
    debug: DebugConfig
    raw: dict[str, Any] = field(repr=False)

    @cached_property
    def _instance_index(self) -> dict[str, InstanceConfig]:
        """Index instances once while preserving first-entry semantics."""

        index: dict[str, InstanceConfig] = {}
        for item in self.instances:
            index.setdefault(item.id, item)
        return index

    @cached_property
    def _job_index(self) -> dict[str, JobConfig]:
        """Index jobs once while preserving first-entry semantics."""

        index: dict[str, JobConfig] = {}
        for item in self.jobs:
            index.setdefault(item.id, item)
        return index

    def instance(self, instance_id: str) -> InstanceConfig:
        try:
            return self._instance_index[instance_id]
        except KeyError as exc:
            raise StopIteration from exc

    def job(self, job_id: str) -> JobConfig:
        try:
            return self._job_index[job_id]
        except KeyError as exc:
            raise StopIteration from exc

    def workflow_path(self, workflow: str) -> Path:
        candidate = Path(workflow)
        if candidate.suffix.lower() != ".json":
            candidate = candidate.with_suffix(".json")
        return (self.workflow_dir / candidate).resolve()


__all__ = [
    "AppConfig",
    "DebugConfig",
    "InstanceConfig",
    "JobConfig",
    "OcrConfig",
    "RetryConfig",
]
