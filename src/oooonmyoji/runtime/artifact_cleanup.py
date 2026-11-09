"""Prune aged runtime records and known disposable UI smoke outputs."""

from __future__ import annotations

import json
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .artifact_paths import run_artifact_dir


KEEP_LATEST_RUNS = 15
DISPOSABLE_SMOKE_DIRS = {
    "hero-panels",
    "icon-resources",
    "lineup-diagnosis",
    "lineup-probe",
    "lineup-search-smoke",
    "soul-extension",
    "soul-popout",
    "soul-ui",
    "tool-menus",
}
TERMINAL_STATUSES = {"succeeded", "failed", "cancelled", "interrupted"}
COUNTERS = ("run_records", "event_logs", "temporary_inputs", "failure_dirs", "smoke_dirs", "scratch_images")


def _timestamp(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, OverflowError):
        return None


def _remove_file(path: Path, root: Path) -> bool:
    try:
        if path.is_symlink() or path.resolve().parent != root.resolve():
            return False
        path.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def _remove_directory(path: Path, root: Path) -> bool:
    try:
        if path.is_symlink() or path.resolve().parent != root.resolve():
            return False
        shutil.rmtree(path)
        return True
    except OSError:
        return False


def cleanup_artifacts(artifact_dir: Path, *, now: float | None = None) -> dict[str, int]:
    """Remove only old terminal run records and allowlisted disposable outputs."""

    root = artifact_dir.resolve()
    if not root.is_dir():
        return dict.fromkeys(COUNTERS, 0)
    now = time.time() if now is None else now
    counts = dict.fromkeys(COUNTERS, 0)
    runs_dir = root / "runs"
    retained_ids: set[str] = set()

    if runs_dir.is_dir() and not runs_dir.is_symlink():
        records: list[tuple[float, Path, dict[str, Any]]] = []
        for record_path in runs_dir.glob("*.json"):
            if record_path.is_symlink():
                continue
            try:
                value = json.loads(record_path.read_text(encoding="utf-8"))
                if not isinstance(value, dict) or value.get("status") not in TERMINAL_STATUSES:
                    continue
                timestamp = _timestamp(value.get("finished_at") or value.get("created_at"))
                if timestamp is None:
                    timestamp = record_path.stat().st_mtime
                records.append((timestamp, record_path, value))
            except (OSError, json.JSONDecodeError):
                continue

        # Keep ties at the window edge: slicing alone can strand every record when timestamps
        # compare equal, so compare against the cutoff instead of relying on slice order.
        ordered = sorted(records, key=lambda item: item[0], reverse=True)
        cutoff = ordered[KEEP_LATEST_RUNS - 1][0] if len(ordered) >= KEEP_LATEST_RUNS else None
        newest = {path for stamp, path, _ in ordered if cutoff is None or stamp >= cutoff}
        retained_event_files: set[Path] = set()
        retained_ids = {path.stem for path in newest}
        for _, record_path, record in records:
            if record_path in newest:
                details = record.get("details")
                events_file = details.get("events_file") if isinstance(details, dict) else None
                if isinstance(events_file, str):
                    event_path = Path(events_file)
                    if not event_path.is_absolute():
                        event_path = root / event_path
                    try:
                        if event_path.resolve().parent == runs_dir.resolve():
                            retained_event_files.add(event_path.resolve())
                    except OSError:
                        pass
        for timestamp, record_path, record in records:
            if record_path in newest:
                continue
            removed = _remove_file(record_path, runs_dir)
            if not removed:
                continue
            counts["run_records"] += 1
            details = record.get("details")
            events_file = details.get("events_file") if isinstance(details, dict) else None
            if isinstance(events_file, str):
                event_path = Path(events_file)
                if not event_path.is_absolute():
                    event_path = root / event_path
                try:
                    if event_path.resolve().parent == runs_dir.resolve() and event_path.suffix == ".jsonl":
                        counts["event_logs"] += int(_remove_file(event_path, runs_dir))
                except OSError:
                    pass
            legacy_output = root / record_path.stem
            if legacy_output.is_dir() and not legacy_output.is_symlink():
                if _remove_directory(legacy_output, root):
                    counts["failure_dirs"] += 1
            instance_id = record.get("instance_id")
            if isinstance(instance_id, str) and instance_id and (root / instance_id).name == instance_id:
                run_output = run_artifact_dir(root, instance_id, record_path.stem)
                if run_output.parent.is_symlink():
                    continue
                if run_output.is_dir() and _remove_directory(run_output, run_output.parent):
                    counts["failure_dirs"] += 1

        # Preserve event streams referenced by the newest 15 records. Unreferenced streams
        # are disposable, except those belonging to a currently active (non-terminal) run.
        active_event_files: set[Path] = set()
        for record_path in runs_dir.glob("*.json"):
            if record_path.is_symlink():
                continue
            try:
                record = json.loads(record_path.read_text(encoding="utf-8"))
                if not isinstance(record, dict) or record.get("status") in TERMINAL_STATUSES:
                    continue
                details = record.get("details")
                events_file = details.get("events_file") if isinstance(details, dict) else None
                if isinstance(events_file, str):
                    event_path = Path(events_file)
                    if not event_path.is_absolute():
                        event_path = root / event_path
                    if event_path.resolve().parent == runs_dir.resolve():
                        active_event_files.add(event_path.resolve())
            except (OSError, json.JSONDecodeError):
                continue
        for event_path in runs_dir.glob("*.jsonl"):
            try:
                if event_path.resolve() not in retained_event_files | active_event_files:
                    counts["event_logs"] += int(_remove_file(event_path, runs_dir))
            except OSError:
                continue
        for input_path in runs_dir.glob("desktop-inputs-*.json"):
            try:
                if input_path.stat().st_mtime < now - 24 * 60 * 60:
                    counts["temporary_inputs"] += int(_remove_file(input_path, runs_dir))
            except OSError:
                continue

    # Workflow failure snapshots duplicate information in the retained run record.
    for failure_dir in root.glob("workflow-*-*"):
        if not failure_dir.is_dir() or failure_dir.is_symlink():
            continue
        if not failure_dir.name.startswith("workflow-"):
            continue
        try:
            if failure_dir.name not in retained_ids:
                counts["failure_dirs"] += int(_remove_directory(failure_dir, root))
        except OSError:
            continue

    # Ad-hoc screenshots dumped at the artifact root (``*.png``/``*.jpg``) are scratch:
    # runs keep their own pictures under their step/failure folders.
    for pattern in ("*.png", "*.jpg", "*.jpeg"):
        for image in root.glob(pattern):
            try:
                if image.is_file() and not image.is_symlink():
                    counts["scratch_images"] += int(_remove_file(image, root))
            except OSError:
                continue

    # These folders are produced by UI smoke scripts and are cleared during each sweep.
    for name in DISPOSABLE_SMOKE_DIRS:
        smoke_dir = root / name
        if not smoke_dir.is_dir() or smoke_dir.is_symlink():
            continue
        try:
            counts["smoke_dirs"] += int(_remove_directory(smoke_dir, root))
        except OSError:
            continue

    return counts
