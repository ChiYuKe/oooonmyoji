"""端到端：运行时把“眼中的画面”按观看请求写进 artifacts/live。

复用 test_subworkflow 的配置与假设备搭好一个真实运行的 runner，验证整条链路：
``TaskContext.capture`` → ``LiveViewSink`` → ``live-<instance>.json/.jpg``。
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from src.oooonmyoji.config import load_config
from src.oooonmyoji.config.model import JobConfig
from src.oooonmyoji.runtime import runner as runner_module
from src.oooonmyoji.runtime.live_view import REQUEST_FILENAME
from src.oooonmyoji.runtime.runner import TaskRunner

from .test_subworkflow import StubDevice, _write_config, _write_workflow


def _run_tapping_workflow(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, live_directory: Path) -> None:
    config_path = _write_config(tmp_path)
    _write_workflow(
        tmp_path,
        "live",
        [
            {"id": "cap", "action": "core.capture"},
            {"id": "tap", "action": "input.tap", "params": {"x": 960, "y": 540, "hold_ms": 30}},
        ],
    )
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="run-live",
        workflow="live",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    TaskRunner(load_config(config_path)).execute(job, load_config(config_path).instance("fake"))


def _request(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / REQUEST_FILENAME).write_text(
        json.dumps({"ts": time.time(), "instance_id": "fake"}),
        encoding="utf-8",
    )


def test_running_workflow_writes_live_snapshot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    live_directory = tmp_path / "artifacts" / "live"
    _request(live_directory)
    monkeypatch.setenv("OOONMYOJI_LIVE_VIEW_DIR", str(live_directory))
    monkeypatch.setenv("OOONMYOJI_LIVE_VIEW_INTERVAL_MS", "0")

    _run_tapping_workflow(tmp_path, monkeypatch, live_directory)

    meta_path = live_directory / "live-fake.json"
    frame_path = live_directory / "live-fake.jpg"
    assert meta_path.is_file(), "运行时应当把预览帧写到观看请求指定的目录"
    assert frame_path.is_file()
    assert frame_path.stat().st_size > 0

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["instance_id"] == "fake"
    assert meta["reference_width"] == 1920
    assert meta["reference_height"] == 1080
    assert meta["frame_width"] > 0 and meta["frame_height"] > 0
    # 状态条数据来自最后一步：点击。
    assert meta["step"]["action"] == "input.tap"
    assert meta["step"]["status"] == "succeeded"
    assert meta["overlay"]["clicks"], "点击这一步应当把点击轨迹写给桌面端"
    click = meta["overlay"]["clicks"][0]
    assert click["reference"] == [960, 540]
    assert len(click["actual"]) == 2

    # 桌面端靠索引找到快照文件名，不必自己猜文件名清洗规则。
    index = json.loads((live_directory / "index.json").read_text(encoding="utf-8"))
    assert index["instances"]["fake"]["meta"] == "live-fake.json"
    assert index["instances"]["fake"]["frame"] == "live-fake.jpg"


def test_without_viewing_request_nothing_is_written(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    live_directory = tmp_path / "artifacts" / "live"
    live_directory.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("OOONMYOJI_LIVE_VIEW_DIR", str(live_directory))

    _run_tapping_workflow(tmp_path, monkeypatch, live_directory)

    assert not (live_directory / "live-fake.json").exists(), "没人观看时预览通道不能产生任何写盘"
    assert not (live_directory / "live-fake.jpg").exists()


def test_viewer_interval_does_not_block_the_step_flush(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """观看端选了很慢的刷新率时，步骤收尾的强制写入仍要落盘。"""

    live_directory = tmp_path / "artifacts" / "live"
    _request(live_directory)
    monkeypatch.setenv("OOONMYOJI_LIVE_VIEW_DIR", str(live_directory))
    monkeypatch.setenv("OOONMYOJI_LIVE_VIEW_INTERVAL_MS", "4000")

    _run_tapping_workflow(tmp_path, monkeypatch, live_directory)

    meta_path = live_directory / "live-fake.json"
    assert meta_path.is_file()
    assert json.loads(meta_path.read_text(encoding="utf-8"))["overlay"]["clicks"]
