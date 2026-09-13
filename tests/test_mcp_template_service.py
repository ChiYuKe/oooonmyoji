from __future__ import annotations

import base64
import json
import subprocess
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np

from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.mcp.service import ProjectContextService


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config" / "config.example.json"


class FakeCaptureDevice:
    width = 8
    height = 6
    instance_id = "mumu-0"

    def __init__(self) -> None:
        image = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        image[1:5, 2:6] = (30, 120, 220)
        encoded, payload = cv2.imencode(".png", image)
        assert encoded
        self.frame = DeviceFrame(self.width, self.height, payload.tobytes(), format="png")
        self.closed = False

    def capture(self) -> DeviceFrame:
        return self.frame

    def close(self) -> None:
        self.closed = True


def minimal_workflow(action: str = "core.log") -> dict[str, object]:
    return {
        "schema_version": 4,
        "id": "mcp-test",
        "version": "1.0.0",
        "description": "MCP service test workflow",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["log"]},
            {
                "id": "log",
                "type": "task",
                "action": action,
                "params": {"message": "MCP test"},
            },
        ],
    }


def test_readonly_context_lists_actions_and_assets() -> None:
    service = ProjectContextService(CONFIG_PATH)

    actions = service.list_actions()
    assets = service.list_assets()

    assert actions["count"] > 0
    assert any(item["name"] == "core.log" for item in actions["actions"])
    assert assets["count"] > 0
    assert all(not Path(item["path"]).is_absolute() for item in assets["assets"])


def test_workflow_validation_accepts_minimal_workflow() -> None:
    service = ProjectContextService(CONFIG_PATH)

    result = service.validate_workflow(minimal_workflow())

    assert result["ok"] is True
    assert result["errors"] == []
    assert result["workflow"]["node_count"] == 2


def test_workflow_validation_reports_unknown_action() -> None:
    service = ProjectContextService(CONFIG_PATH)

    result = service.validate_workflow(minimal_workflow("test.missing"))

    assert result["ok"] is False
    assert result["errors"][0]["code"] == "unknown_action"


def test_save_rejects_unsafe_name_without_writing() -> None:
    service = ProjectContextService(CONFIG_PATH)

    result = service.save_workflow(minimal_workflow(), "../escape")

    assert result["ok"] is False
    assert result["saved"] is False
    assert result["errors"][0]["code"] == "invalid_name"


def test_save_validates_before_writing_and_rejects_duplicate(tmp_path: Path) -> None:
    service = ProjectContextService(CONFIG_PATH)
    service.config = replace(
        service.config,
        root_dir=tmp_path,
        workflow_dir=tmp_path / "workflows",
    )

    first = service.save_workflow(minimal_workflow(), "mcp-test")
    second = service.save_workflow(minimal_workflow(), "mcp-test")

    target = tmp_path / "workflows" / "generated" / "mcp-test.json"
    assert first["ok"] is True
    assert first["saved"] is True
    assert target.is_file()
    assert json.loads(target.read_text(encoding="utf-8"))["id"] == "mcp-test"
    assert second["ok"] is False
    assert second["errors"][0]["code"] == "file_exists"


def test_invalid_workflow_is_not_saved(tmp_path: Path) -> None:
    service = ProjectContextService(CONFIG_PATH)
    service.config = replace(
        service.config,
        root_dir=tmp_path,
        workflow_dir=tmp_path / "workflows",
    )

    result = service.save_workflow(minimal_workflow("test.missing"), "invalid")

    assert result["ok"] is False
    assert result["saved"] is False
    assert not (tmp_path / "workflows" / "generated" / "invalid.json").exists()


def test_capture_screen_is_read_only_and_returns_mcp_ready_png(monkeypatch) -> None:
    service = ProjectContextService(CONFIG_PATH)
    fake_device = FakeCaptureDevice()

    def fake_connect(*_args, **_kwargs):
        return fake_device, True

    monkeypatch.setattr("src.oooonmyoji.mcp.service.expand_runtime_instances", lambda config: config)
    monkeypatch.setattr("src.oooonmyoji.mcp.service.ensure_runtime_instance", lambda config, _instance: config)
    monkeypatch.setattr("src.oooonmyoji.mcp.service.connect_at_task_boundary", fake_connect)

    result = service.capture_screen("mumu-0")

    decoded = base64.b64decode(result["image_base64"])
    image = cv2.imdecode(np.frombuffer(decoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert result["instance"] == "mumu-0"
    assert result["backend"] == "adb"
    assert result["width"] == 8
    assert result["height"] == 6
    assert image is not None
    assert image.shape[:2] == (6, 8)
    assert fake_device.closed is True


def test_create_template_asset_crops_capture_and_is_path_bounded(tmp_path: Path, monkeypatch) -> None:
    service = ProjectContextService(CONFIG_PATH)
    service.config = replace(
        service.config,
        root_dir=tmp_path,
        workflow_dir=tmp_path / "workflows",
    )
    service.asset_root = tmp_path / "assets" / "templates"
    fake_device = FakeCaptureDevice()

    monkeypatch.setattr("src.oooonmyoji.mcp.service.expand_runtime_instances", lambda config: config)
    monkeypatch.setattr("src.oooonmyoji.mcp.service.ensure_runtime_instance", lambda config, _instance: config)
    monkeypatch.setattr(
        "src.oooonmyoji.mcp.service.connect_at_task_boundary",
        lambda *_args, **_kwargs: (fake_device, True),
    )
    captured = service.capture_screen("mumu-0")

    result = service.create_template_asset(captured["capture_id"], [2, 1, 4, 4], "orange_button")

    target = tmp_path / "assets" / "templates" / "generated" / "orange_button.png"
    decoded = base64.b64decode(result["image_base64"])
    image = cv2.imdecode(np.frombuffer(decoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert result["ok"] is True
    assert result["saved"] is True
    assert result["path"] == "assets/templates/generated/orange_button.png"
    assert result["dimensions"] == [4, 4]
    assert target.is_file()
    assert image is not None
    assert image.shape[:2] == (4, 4)

    duplicate = service.create_template_asset(captured["capture_id"], [2, 1, 4, 4], "orange_button")
    assert duplicate["ok"] is False
    assert duplicate["code"] == "file_exists"


def test_create_template_asset_rejects_invalid_roi_and_unsafe_name() -> None:
    service = ProjectContextService(CONFIG_PATH)
    device = FakeCaptureDevice()
    service._captures["capture"] = {
        "png_bytes": device.frame.pixels,
        "width": 8,
        "height": 6,
        "instance": "mumu-0",
        "backend": "adb",
    }

    try:
        service.create_template_asset("capture", [0, 0, 0, 2], "bad")
    except ValueError as exc:
        assert "positive size" in str(exc)
    else:  # pragma: no cover - assertion branch
        raise AssertionError("invalid ROI should be rejected")

    try:
        service.create_template_asset("capture", [0, 0, 2, 2], "../escape")
    except ValueError as exc:
        assert "name must match" in str(exc)
    else:  # pragma: no cover - assertion branch
        raise AssertionError("unsafe asset name should be rejected")


def test_select_roi_invokes_existing_picker_with_cached_image_only(monkeypatch) -> None:
    service = ProjectContextService(CONFIG_PATH)
    fake_device = FakeCaptureDevice()

    def fake_connect(*_args, **_kwargs):
        return fake_device, True

    monkeypatch.setattr("src.oooonmyoji.mcp.service.expand_runtime_instances", lambda config: config)
    monkeypatch.setattr("src.oooonmyoji.mcp.service.ensure_runtime_instance", lambda config, _instance: config)
    monkeypatch.setattr("src.oooonmyoji.mcp.service.connect_at_task_boundary", fake_connect)
    captured = service.capture_screen("mumu-0")
    observed: dict[str, object] = {}

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed["kwargs"] = kwargs
        result_path = Path(command[command.index("--result-file") + 1])
        result_path.write_text(
            json.dumps({
                "image_rect": [2, 1, 4, 4],
                "reference_rect": [2, 1, 4, 4],
                "image_size": [8, 6],
                "reference_resolution": [8, 6],
            }),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr("src.oooonmyoji.mcp.service.subprocess.run", fake_run)

    result = service.select_roi(captured["capture_id"], timeout_seconds=30)

    command = observed["command"]
    assert isinstance(command, list)
    assert "--image" in command
    assert "--select-roi" in command
    assert "--config" not in command
    assert result["ok"] is True
    assert result["image_rect"] == [2, 1, 4, 4]
    assert result["reference_rect"] == [2, 1, 4, 4]
    assert result["capture_id"] == captured["capture_id"]
    assert fake_device.closed is True
