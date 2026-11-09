"""Paths for runtime output, grouped by emulator instance."""

from pathlib import Path

from ..naming import safe_name


def instance_artifact_dir(root: Path, instance_id: str) -> Path:
    name = safe_name(instance_id).strip(".") or "unknown"
    # Keep instance output separate from shared runtime services.
    if name.lower() in {"runs", "locks", "signals", "live", "tests", "reward-stats", "mcp-runs"}:
        name = f"instance-{name}"
    return root / name


def run_artifact_dir(root: Path, instance_id: str, run_id: str) -> Path:
    return instance_artifact_dir(root, instance_id) / run_id
