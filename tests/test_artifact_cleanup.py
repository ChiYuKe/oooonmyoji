from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from src.oooonmyoji.runtime.artifact_cleanup import KEEP_LATEST_RUNS, cleanup_artifacts


def _write_run(runs: Path, tmp_path: Path, index: int, now: float, *, instance: str = "mumu-0") -> Path:
    run_id = f"run-{index:02d}"
    (runs / f"{run_id}.json").write_text(json.dumps({
        "instance_id": instance, "status": "succeeded",
        "finished_at": datetime.fromtimestamp(now - 172800 + index, timezone.utc).isoformat(),
    }), encoding="utf-8")
    (tmp_path / instance / run_id / "debug").mkdir(parents=True)
    return tmp_path / instance / run_id


def test_cleanup_keeps_latest_runs_and_prunes_older_outputs(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    runs.mkdir()
    now = time.time()
    total = KEEP_LATEST_RUNS + 5
    outputs = [_write_run(runs, tmp_path, index, now) for index in range(total)]
    active = tmp_path / "mumu-1" / "run-active"
    active.mkdir(parents=True)
    (runs / "run-active.json").write_text(json.dumps({
        "instance_id": "mumu-1", "status": "running",
    }), encoding="utf-8")

    counts = cleanup_artifacts(tmp_path, now=now)

    assert counts["run_records"] == 5
    assert len(list(runs.glob("*.json"))) == KEEP_LATEST_RUNS + 1
    for index, output in enumerate(outputs):
        assert output.exists() == (index >= 5), output
        assert output.exists() == (runs / f"run-{index:02d}.json").exists()
    assert active.is_dir()


def test_cleanup_keeps_newest_runs_when_fewer_than_window(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    runs.mkdir()
    now = time.time()
    _write_run(runs, tmp_path, 0, now)
    _write_run(runs, tmp_path, 1, now)

    cleanup_artifacts(tmp_path, now=now)

    assert sorted(path.stem for path in runs.glob("*.json")) == ["run-00", "run-01"]
    assert (tmp_path / "mumu-0" / "run-00").is_dir()


def test_cleanup_prunes_flat_snapshots_and_scratch_images_and_keeps_run_named_dirs(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    runs.mkdir()
    now = time.time()
    for index in range(KEEP_LATEST_RUNS + 1):
        _write_run(runs, tmp_path, index, now)
    # The task id in runs/run-XX.json doubles as a legacy flat output folder; it stays as
    # long as its record does, and goes with it once the record ages out.
    legacy_kept = tmp_path / f"run-{KEEP_LATEST_RUNS:02d}"
    legacy_kept.mkdir()
    legacy_pruned = tmp_path / "run-00"
    legacy_pruned.mkdir()
    snapshot = tmp_path / "workflow-1-failed"
    snapshot.mkdir()
    (tmp_path / "buff_edge_recheck.png").write_bytes(b"png")

    counts = cleanup_artifacts(tmp_path, now=now)

    assert legacy_kept.is_dir()
    assert not legacy_pruned.exists()
    assert not snapshot.exists()
    assert not (tmp_path / "buff_edge_recheck.png").exists()
    assert counts["failure_dirs"] >= 2
    assert counts["scratch_images"] == 1
