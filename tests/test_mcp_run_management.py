from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from dataclasses import replace
from pathlib import Path

import pytest

from src.oooonmyoji.mcp import server
from src.oooonmyoji.mcp.approval import ApprovalBroker, MODE_DENY
from src.oooonmyoji.mcp.runs import RunManager
from src.oooonmyoji.mcp.service import ProjectContextService

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def await_finished(manager: RunManager, run_id: str) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = manager.status(run_id)
        if result["status"] not in ("running", "cancelling"):
            return result
        time.sleep(0.01)
    pytest.fail("background run did not finish")


def test_background_progress_and_completion() -> None:
    manager = RunManager()
    release = threading.Event()

    def operation(run_id: str) -> dict:
        assert release.wait(5)
        return {"ok": True, "status": "succeeded", "run_id": "runtime-id"}

    started = manager.run(operation, workflow="example", instance="mumu-0", wait=False)
    run_id = started["mcp_run_id"]
    try:
        assert manager.status(run_id)["status"] == "running"
        assert manager.status()["runs"][0]["workflow"] == "example"
    finally:
        release.set()
    result = await_finished(manager, run_id)
    assert result["result"]["run_id"] == "runtime-id"
    assert manager.cancel(run_id)["already_finished"] is True
    assert manager.cancel("unowned-pid")["code"] == "run_not_found"


def test_cancel_before_process_registration() -> None:
    manager = RunManager()
    release = threading.Event()
    processes = []

    def operation(run_id: str) -> dict:
        assert release.wait(5)
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                   start_new_session=os.name != "nt", stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        processes.append(process)
        manager.bind(run_id, process, "events.jsonl")
        process.communicate(timeout=10)
        return {"ok": False}

    run_id = manager.run(operation, workflow="example", instance="mumu-0", wait=False)["mcp_run_id"]
    try:
        assert manager.cancel(run_id)["status"] == "cancelling"
        release.set()
        assert await_finished(manager, run_id)["status"] == "cancelled"
        assert processes[0].poll() is not None
    finally:
        release.set()
        manager.close()


def test_shutdown_stops_owned_process() -> None:
    manager = RunManager()
    bound = threading.Event()

    def operation(run_id: str) -> dict:
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                   start_new_session=os.name != "nt", stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        manager.bind(run_id, process, "events.jsonl")
        bound.set()
        process.communicate(timeout=10)
        return {"ok": process.returncode == 0}

    run_id = manager.run(operation, workflow="example", instance="mumu-0", wait=False)["mcp_run_id"]
    try:
        assert bound.wait(5)
    finally:
        manager.close()
    assert await_finished(manager, run_id)["result"]["code"] == "run_cancelled"


def test_status_versions_and_policy_survive_context_initialization(monkeypatch, tmp_path: Path) -> None:
    class Context:
        def info(self):
            return {"execution_tools_enabled": False, "write_scope": "old scope"}
    monkeypatch.setattr(server, "_service", Context())
    monkeypatch.setattr(server, "_approval", ApprovalBroker(project_root=tmp_path, mode=MODE_DENY))
    info = server.server_info()
    assert info["server_version"] == server.SERVER_VERSION
    assert info["mcp_version"]
    assert info["mcp_types_version"]
    assert info["python_version"]
    assert info["execution_tools_enabled"] is True
    assert "approval-gated" in info["write_scope"]


def test_doctor_handles_broken_config_without_context(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(server, "_config_path", tmp_path / "broken.json")
    monkeypatch.setattr(server, "_project_root", tmp_path)
    monkeypatch.setattr(server, "_context", lambda: pytest.fail("doctor must not initialize context"))
    monkeypatch.setattr(ProjectContextService, "diagnose", lambda *_: {"ok": False, "checks": {"config": "failed"}})
    result = server.doctor()
    assert result.is_error
    assert result.structured_content["checks"]["config"] == "failed"


def test_list_instances_reuses_runtime_discovery(monkeypatch) -> None:
    service = ProjectContextService(PROJECT_ROOT / "config/config.example.json")
    instance = service.config.instances[0]
    monkeypatch.setattr("src.oooonmyoji.mcp.service.discover_runtime_instances", lambda config: (instance,))
    result = service.list_instances()
    assert result["count"] == 1
    assert result["instances"][0]["id"] == instance.id
    assert result["instances"][0]["backend"] == instance.backend


@pytest.mark.parametrize("wait", [True, False])
def test_workflow_cli_result_is_tracked(monkeypatch, tmp_path: Path, wait: bool) -> None:
    service = ProjectContextService(PROJECT_ROOT / "config/config.example.json")
    service.config = replace(service.config, artifact_dir=tmp_path)
    popen = subprocess.Popen
    commands = []

    def cli(command, **kwargs):
        commands.append(command)
        return popen([sys.executable, "-c", 'print(\'{"status":"succeeded","run_id":"runtime-test"}\')'], **kwargs)

    monkeypatch.setattr("src.oooonmyoji.mcp.service.subprocess.Popen", cli)
    started = service.run_workflow("example", inputs={"number": 3}, wait=wait)
    run_id = started["mcp_run_id"]
    try:
        result = await_finished(service.runs, run_id)
        assert result["result"]["ok"] is True
        assert result["result"]["run_id"] == "runtime-test"
        assert service.get_run_status(run_id)["steps_tail"] == []
        inputs_path = Path(commands[0][commands[0].index("--inputs") + 1])
        assert not inputs_path.exists()
        assert "--events-file" in commands[0]
    finally:
        service.runs.close()


def test_background_failure_is_reported() -> None:
    manager = RunManager()

    def broken(run_id):
        raise ValueError("bad workflow")

    started = manager.run(broken, workflow="bad", instance="mumu-0", wait=False)
    result = await_finished(manager, started["mcp_run_id"])
    assert result["status"] == "failed"
    assert result["result"]["code"] == "run_error"
    assert result["result"]["error"] == "bad workflow"


def test_diagnose_cli_exit_code_and_timeout(monkeypatch) -> None:
    def completed(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 2, '{"config":"failed"}', "diagnostic detail")

    monkeypatch.setattr("src.oooonmyoji.mcp.service.subprocess.run", completed)
    result = ProjectContextService.diagnose(Path("broken.json"), PROJECT_ROOT)
    assert result["ok"] is False
    assert result["checks"]["config"] == "failed"

    def timed_out(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], kwargs["timeout"])

    monkeypatch.setattr("src.oooonmyoji.mcp.service.subprocess.run", timed_out)
    assert ProjectContextService.diagnose(Path("broken.json"), PROJECT_ROOT)["code"] == "doctor_timeout"


def test_registered_tools_expose_new_schemas_and_versions(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(server, "_service", None)
    monkeypatch.setattr(server, "_approval", ApprovalBroker(project_root=tmp_path, mode=MODE_DENY))

    tools = {tool.name: tool for tool in server.mcp._tool_manager.list_tools()}
    assert len(tools) == 27
    assert {"list_instances", "doctor", "get_run_status", "cancel_run"} <= tools.keys()
    assert tools["run_workflow"].parameters["properties"]["wait"]["default"] is True
    info = server.server_info()
    assert info["mcp_version"]
    assert info["execution_tools_enabled"] is True
