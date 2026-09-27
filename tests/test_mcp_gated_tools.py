"""门控工具：未获批准时不得触碰设备、配置或文件；单动作执行的安全前置检查。"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

import src.oooonmyoji.mcp.server as server_module
from src.oooonmyoji.actions import build_action_registry
from src.oooonmyoji.config import load_config
from src.oooonmyoji.exceptions import ConfigError
from src.oooonmyoji.mcp.approval import MODE_ALLOW, MODE_DENY, ApprovalBroker
from src.oooonmyoji.mcp.files import ProjectFiles
from src.oooonmyoji.runtime.one_shot import resolve_arguments, run_single_action

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config" / "config.example.json"


def set_broker(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, mode: str) -> ApprovalBroker:
    broker = ApprovalBroker(project_root=tmp_path, state_dir=tmp_path / "state", mode=mode, timeout_seconds=5.0)
    monkeypatch.setattr(server_module, "_approval", broker)
    return broker


def forbid_service(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode() -> None:  # pragma: no cover - 只应在错误路径触发
        raise AssertionError("denied tools must not reach the service layer")

    monkeypatch.setattr(server_module, "_context", explode)
    monkeypatch.setattr(server_module, "_files", explode)


@pytest.mark.parametrize(
    "tool_name, call",
    [
        ("run_action", lambda: server_module.run_action("input.tap", {"x": 1, "y": 2})),
        ("tap", lambda: server_module.tap(1, 2)),
        ("swipe", lambda: server_module.swipe(1, 2, 3, 4)),
        ("press_key", lambda: server_module.press_key("back")),
        ("type_text", lambda: server_module.type_text("hello")),
        ("run_workflow", lambda: server_module.run_workflow("活动副本")),
        ("read_project_file", lambda: server_module.read_project_file("README.md")),
        ("list_artifacts", lambda: server_module.list_artifacts()),
        ("tail_log", lambda: server_module.tail_log()),
        ("write_project_file", lambda: server_module.write_project_file("x.txt", "x")),
        ("delete_project_file", lambda: server_module.delete_project_file("x.txt")),
    ],
)
def test_gated_tools_refuse_before_touching_anything(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    tool_name: str,
    call: object,
) -> None:
    set_broker(monkeypatch, tmp_path, MODE_DENY)
    forbid_service(monkeypatch)

    result = call()  # type: ignore[operator]

    assert result.is_error is True, tool_name
    assert result.structured_content["code"] == "approval_required", tool_name
    assert result.structured_content["approved"] is False, tool_name


def test_ungated_read_only_tools_still_work_when_approval_is_denied(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    set_broker(monkeypatch, tmp_path, MODE_DENY)

    class FakeService:
        def list_assets(self) -> dict[str, object]:
            return {"assets": [], "count": 0}

    monkeypatch.setattr(server_module, "_context", lambda: FakeService())
    result = server_module.list_assets()

    assert result.is_error is False
    assert result.structured_content["count"] == 0


def test_approved_call_reaches_the_service_layer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    set_broker(monkeypatch, tmp_path, MODE_ALLOW)
    seen: dict[str, object] = {}

    class FakeService:
        def run_action(
            self,
            action_name: str,
            params: dict[str, object] | None,
            *,
            instance_id: str,
            reference_resolution: list[int] | None = None,
        ) -> dict[str, object]:
            seen.update(action=action_name, params=params, instance=instance_id, resolution=reference_resolution)
            return {"ok": True, "action": action_name, "instance": instance_id, "status": "succeeded"}

    monkeypatch.setattr(server_module, "_context", lambda: FakeService())

    direct = server_module.run_action("core.log", {"message": "hi"}, instance_id="mumu-1")
    assert direct.is_error is False
    assert seen == {"action": "core.log", "params": {"message": "hi"}, "instance": "mumu-1", "resolution": None}

    tapped = server_module.tap(10, 20, hold_ms=50, instance_id="mumu-0")
    assert tapped.is_error is False
    assert seen["action"] == "input.tap"
    assert seen["params"] == {"x": 10, "y": 20, "hold_ms": 50}

    swiped = server_module.swipe(1, 2, 3, 4, duration_ms=250)
    assert swiped.is_error is False
    assert seen["action"] == "input.swipe"
    assert seen["params"] == {"x1": 1, "y1": 2, "x2": 3, "y2": 4, "duration_ms": 250}


def test_file_tools_write_and_delete_with_a_backup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    set_broker(monkeypatch, tmp_path, MODE_ALLOW)
    files = ProjectFiles(tmp_path, log_dir=tmp_path / "logs")
    monkeypatch.setattr(server_module, "_files", lambda: files)

    created = server_module.write_project_file("notes/demo.txt", "first")
    assert created.is_error is False
    assert (tmp_path / "notes" / "demo.txt").read_text(encoding="utf-8") == "first"

    refused = server_module.write_project_file("notes/demo.txt", "second")
    assert refused.is_error is True
    assert refused.structured_content["code"] == "file_exists"

    replaced = server_module.write_project_file("notes/demo.txt", "second", overwrite=True)
    assert replaced.is_error is False
    assert (tmp_path / replaced.structured_content["backup"]).read_text(encoding="utf-8") == "first"

    removed = server_module.delete_project_file("notes/demo.txt")
    assert removed.is_error is False
    assert not (tmp_path / "notes" / "demo.txt").exists()

    protected = server_module.write_project_file(".venv/pyvenv.cfg", "nope")
    assert protected.is_error is True
    assert protected.structured_content["code"] == "path_protected"

    escaped = server_module.read_project_file("../outside.txt")
    assert escaped.is_error is True
    assert escaped.structured_content["code"] == "path_outside_project"


def test_run_single_action_rejects_unknown_action_and_instance_before_connecting(tmp_path: Path) -> None:
    config = replace(load_config(CONFIG_PATH), discover_mumu_instances=False, root_dir=tmp_path)

    with pytest.raises(ConfigError, match="unknown Action"):
        run_single_action(config, instance_id="mumu-0", action_name="does.not.exist")

    with pytest.raises(ConfigError, match="unknown runtime instance"):
        run_single_action(config, instance_id="nope-9", action_name="core.log", params={"message": "hi"})


def test_action_defaults_come_from_the_manifest() -> None:
    config = load_config(CONFIG_PATH)
    registry = build_action_registry(config.action_dir)

    tap = resolve_arguments(registry.get("input.tap"), {"x": 1, "y": 2})
    assert tap["hold_ms"] == 0
    assert tap["random_offset"] == 0
    assert tap["random_interval"] == [0, 0]

    swipe = resolve_arguments(registry.get("input.swipe"), {"x1": 1, "y1": 2, "x2": 3, "y2": 4})
    assert swipe["duration_ms"] == 300

    call = resolve_arguments(registry.get("core.log"), {"message": "hello"})
    assert call["message"] == "hello"
