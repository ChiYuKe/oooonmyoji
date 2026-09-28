from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from src.oooonmyoji.config import load_config
from src.oooonmyoji.config.model import JobConfig
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.runtime import runner as runner_module
from src.oooonmyoji.runtime.runner import TaskRunner
from tests.workflow_files import write_workflow

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class StubDevice:
    width = 1920
    height = 1080

    def capture(self) -> DeviceFrame:
        return DeviceFrame(self.width, self.height, TINY_PNG, format="png")

    def tap(self, x: int, y: int, hold_ms: int = 0) -> None:
        return None

    def close(self) -> None:
        return None


def _write_config(
    path: Path,
    *,
    save_screenshots: bool | None = None,
    debug: dict[str, bool] | None = None,
) -> Path:
    (path / "config").mkdir()
    (path / "workflows").mkdir()
    (path / "plugins" / "actions").mkdir(parents=True)
    write_workflow(path / "workflows" / "wf.owf", {
        "schema_version": 4,
        "id": "wf",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["cap"]},
            {"id": "cap", "type": "task", "action": "core.capture", "params": {}},
        ],
    })
    config_path = path / "config" / "config.json"
    config = {
        "schema_version": 2,
        "timezone": "Asia/Shanghai",
        "workflow_dir": "workflows",
        "action_dir": "plugins/actions",
        "instances": [{"id": "fake", "backend": "adb", "adb_serial": "not-connected"}],
        "ocr": {"enabled": False},
        "tasks": [],
        "retry": {"connection_attempts": 1, "capture_attempts": 1, "ocr_attempts": 1, "task_attempts": 1},
        "log_dir": "logs",
        "artifact_dir": "artifacts",
    }
    if save_screenshots is not None:
        config["save_screenshots"] = save_screenshots
    if debug is not None:
        config["debug"] = debug
    config_path.write_text(json.dumps(config), encoding="utf-8")
    return config_path


def test_run_events_file_omits_screenshot_artifacts_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    events_path = tmp_path / "artifacts" / "runs" / "events-latest.jsonl"
    record = TaskRunner(config).execute(job, config.instance("fake"), events_file=events_path)

    assert record.status.value == "succeeded"
    assert events_path.is_file()
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert lines[0]["type"] == "run_started"
    assert lines[0]["run_id"] == record.run_id
    assert lines[-1]["type"] == "run_finished"
    assert lines[-1]["status"] == "succeeded"

    step_lines = [line for line in lines if line["type"] == "step" and line["step_id"] == "cap"]
    statuses = [line["step"]["status"] for line in step_lines]
    assert "running" in statuses
    assert "succeeded" in statuses
    done = step_lines[-1]
    assert "screenshot" not in done
    assert "thumbnail" not in done
    assert "last_frame" not in record.details
    assert not list((tmp_path / "artifacts").rglob("*.png"))


def test_run_events_file_can_keep_screenshot_artifacts_when_enabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path, save_screenshots=True))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    events_path = tmp_path / "artifacts" / "runs" / "events-latest.jsonl"
    record = TaskRunner(config).execute(job, config.instance("fake"), events_file=events_path)

    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    done = [line for line in lines if line["type"] == "step" and line["step_id"] == "cap" and line["step"]["status"] == "succeeded"][-1]
    assert Path(done["screenshot"]).is_file()
    assert Path(record.details["last_frame"]).is_file()
    try:
        import cv2  # noqa: F401
    except ImportError:
        pass
    else:
        assert isinstance(done["thumbnail"], str)
        assert len(done["thumbnail"]) > 16


def test_debug_mode_saves_annotated_task_screenshot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path, debug={"enabled": True, "annotate_screenshots": True}))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    events_path = tmp_path / "artifacts" / "runs" / "events-debug.jsonl"

    record = TaskRunner(config).execute(job, config.instance("fake"), run_id="run-debug", events_file=events_path)

    assert record.status.value == "succeeded"
    screenshots = list((tmp_path / "artifacts" / "run-debug" / "debug").glob("*.png"))
    assert [path.name for path in screenshots] == ["000001-wf-cap-succeeded.png"]
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    done = [line for line in lines if line.get("step_id") == "cap" and line["step"]["status"] == "succeeded"][-1]
    assert done["debug_screenshot"] == str(screenshots[0])
    assert done["screenshot"] == str(screenshots[0])


def test_step_screenshots_only_cover_steps_that_touch_the_screen(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """只有任务节点才存逐步截图：容器与值卡片自己没碰屏幕，存下来只是上一帧的复制品。

    一次 8 个步骤的运行（根 / 顺序 / 选择 / 判断 / 拆分 / 两个任务）会留下 5 张完全一样的图，
    每张约 1 MB。带标注的 `debug/` 一直只存任务节点（`runtime/debug.py` 里
    `node_kind != "task"` 直接返回），这里与它对齐。
    """

    config = load_config(_write_config(tmp_path, save_screenshots=True))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run", workflow="wf", instance="fake", inputs={},
        schedule={"type": "manual"}, enabled=True, retry_enabled=False,
    )
    events_path = tmp_path / "artifacts" / "runs" / "events-shots.jsonl"

    TaskRunner(config).execute(job, config.instance("fake"), events_file=events_path)

    # 工作流是 root → cap：root 是容器，不该有自己的截图。
    names = sorted(path.name for path in (tmp_path / "artifacts").rglob("step-*.png"))
    assert names == ["step-cap.png"], names
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    shot_steps = {line["step_id"] for line in lines if line.get("type") == "step" and line.get("screenshot")}
    assert shot_steps == {"cap"}, shot_steps


def test_screenshot_switches_write_different_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """「保存步骤截图」与「Debug 逐步截图」是两份输出，关掉一个不会顺手关掉另一个。

    这正是最容易踩的一跤：桌面端设置页曾经只有 Debug 开关，于是关掉它之后
    `step-*.png` / `last-frame.png` 照样出现（它们归 `save_screenshots` 管）。
    """

    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))

    def run(name: str, *, save_screenshots: bool, debug: dict[str, bool]) -> Path:
        root = tmp_path / name
        root.mkdir()
        config = load_config(_write_config(root, save_screenshots=save_screenshots, debug=debug))
        job = JobConfig(
            id=f"wf-{name}", workflow="wf", instance="fake", inputs={},
            schedule={"type": "manual"}, enabled=True, retry_enabled=False,
        )
        artifact_root = root / "artifacts"
        TaskRunner(config).execute(job, config.instance("fake"), events_file=artifact_root / "runs" / "events.jsonl")
        return artifact_root

    only_step_frames = run("steps", save_screenshots=True, debug={"enabled": False, "annotate_screenshots": False})
    assert list(only_step_frames.rglob("step-*.png")), "保存步骤截图开着就该有 step-*.png"
    assert list(only_step_frames.rglob("last-frame.png"))
    assert not list(only_step_frames.rglob("debug/*.png")), "Debug 关着就不该有 debug/ 截图"

    only_debug_frames = run("debug", save_screenshots=False, debug={"enabled": True, "annotate_screenshots": True})
    assert list(only_debug_frames.rglob("debug/*.png")), "Debug 开着就该有带标注的截图"
    assert not list(only_debug_frames.rglob("step-*.png")), "保存步骤截图关着就不该有 step-*.png"
    assert not list(only_debug_frames.rglob("last-frame.png"))


def test_run_events_file_truncates_on_new_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    events_path = tmp_path / "artifacts" / "runs" / "events-latest.jsonl"
    runner = TaskRunner(config)
    runner.execute(job, config.instance("fake"), events_file=events_path)
    first_run_id = json.loads(events_path.read_text(encoding="utf-8").splitlines()[0])["run_id"]
    runner.execute(job, config.instance("fake"), events_file=events_path)
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert lines[0]["type"] == "run_started"
    assert lines[0]["run_id"] != first_run_id
    assert lines[-1]["type"] == "run_finished"


def test_run_uses_run_specific_events_file_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )

    record = TaskRunner(config).execute(job, config.instance("fake"), run_id="run-default-events")

    events_path = tmp_path / "artifacts" / "runs" / "events-run-default-events.jsonl"
    assert record.details["events_file"] == str(events_path)
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert lines[0]["type"] == "run_started"
    assert lines[-1]["type"] == "run_finished"


def test_run_record_checkpoints_are_batched(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config_path = _write_config(tmp_path)
    task_ids = [f"log-{index}" for index in range(30)]
    write_workflow(tmp_path / "workflows" / "wf.owf", {
        "schema_version": 4,
        "id": "wf",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["batch"]},
            {"id": "batch", "type": "sequence", "children": task_ids},
            *[
                {"id": task_id, "type": "task", "action": "core.log", "params": {"message": task_id}}
                for task_id in task_ids
            ],
        ],
    })
    config = load_config(config_path)
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    original_write = runner_module.AtomicJsonStore.write
    state_writes = 0

    def counting_write(store: runner_module.AtomicJsonStore, value: object) -> None:
        nonlocal state_writes
        if store.path.name == "run-batched.json":
            state_writes += 1
        original_write(store, value)

    monkeypatch.setattr(runner_module.AtomicJsonStore, "write", counting_write)
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )

    record = TaskRunner(config).execute(job, config.instance("fake"), run_id="run-batched")

    assert record.status.value == "succeeded"
    assert record.step_history_total == 32
    assert state_writes == 5


def test_recovered_selector_branch_does_not_save_failure_frames(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = _write_config(tmp_path)
    write_workflow(tmp_path / "workflows" / "wf.owf", {
        "schema_version": 4,
        "id": "wf",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["choice"]},
            {"id": "choice", "type": "selector", "children": ["attempt", "fallback"]},
            {"id": "attempt", "type": "sequence", "children": ["capture", "reject"]},
            {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
            {"id": "reject", "type": "task", "action": "core.assert", "params": {"value": False}},
            {"id": "fallback", "type": "task", "action": "core.log", "params": {"message": "recovered"}},
        ],
    })
    config = load_config(config_path)
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )

    record = TaskRunner(config).execute(job, config.instance("fake"), run_id="run-recovered")

    assert record.status.value == "succeeded"
    assert not list((tmp_path / "artifacts" / "run-recovered").glob("failure-*.png"))


def test_failed_run_saves_one_final_failure_frame(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = _write_config(tmp_path)
    write_workflow(tmp_path / "workflows" / "wf.owf", {
        "schema_version": 4,
        "id": "wf",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["main"]},
            {"id": "main", "type": "sequence", "children": ["capture", "reject"]},
            {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
            {"id": "reject", "type": "task", "action": "core.assert", "params": {"value": False}},
        ],
    })
    config = load_config(config_path)
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )

    record = TaskRunner(config).execute(job, config.instance("fake"), run_id="run-failed")

    failure_frames = list((tmp_path / "artifacts" / "run-failed").glob("failure-*.png"))
    assert record.status.value == "failed"
    assert [path.name for path in failure_frames] == ["failure-last-frame.png"]
    assert str(failure_frames[0]) in record.artifacts
