from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import threading
from types import SimpleNamespace

import pytest

from src.oooonmyoji.config import load_config
from src.oooonmyoji.runtime.records import AtomicJsonStore
from src.oooonmyoji.runtime.supervisor import Supervisor, _Group
from src.oooonmyoji.workflows.model import InstanceParallelRun, WorkflowNode, WorkflowSpec


def _write_config(path: Path, *, serial: str = "not-connected") -> Path:
    (path / "config").mkdir()
    (path / "workflows").mkdir()
    (path / "plugins" / "actions").mkdir(parents=True)
    (path / "workflows" / "simple.json").write_text(json.dumps({
        "schema_version": 3,
        "id": "simple",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [
            {"id": "root", "type": "root", "children": ["capture"]},
            {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
        ],
    }), encoding="utf-8")
    config_path = path / "config" / "config.json"
    config_path.write_text(json.dumps({
        "schema_version": 2,
        "timezone": "Asia/Shanghai",
        "workflow_dir": "workflows",
        "action_dir": "plugins/actions",
        "instances": [{"id": "fake", "backend": "adb", "adb_serial": serial}],
        "ocr": {"enabled": False},
        "tasks": [{"id": "simple-fake", "workflow": "simple", "instance": "fake"}],
        "retry": {"connection_attempts": 1, "capture_attempts": 1, "ocr_attempts": 1, "task_attempts": 1},
        "log_dir": "logs",
        "artifact_dir": "artifacts",
    }), encoding="utf-8")
    return config_path


def test_supervisor_spawns_instance_worker_and_records_failure(tmp_path: Path) -> None:
    config = load_config(_write_config(tmp_path))
    supervisor = Supervisor(config)
    try:
        run_id = supervisor.run("simple-fake", wait=True)
        record = json.loads((tmp_path / "artifacts" / "runs" / f"{run_id}.json").read_text(encoding="utf-8"))
        assert record["status"] == "failed"
        assert record["error_category"] == "device_connection"
        assert record["workflow_id"] == "simple"
        assert record["workflow_file_hash"]
        assert (tmp_path / "artifacts" / "runs" / f"{run_id}.json").is_file()
        with pytest.raises(KeyError):
            supervisor.cancel(run_id)
    finally:
        supervisor.stop()


def test_wait_for_all_cancels_peer_after_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    supervisor = Supervisor.__new__(Supervisor)
    supervisor.event_queue = queue.Queue()
    supervisor._completed = {}
    supervisor._runs = {"member-run": "mumu-1", "leader-run": "mumu-0"}
    supervisor.workers = {}
    supervisor.check_workers = lambda: None
    cancelled: list[str] = []
    monkeypatch.setattr(supervisor, "cancel", cancelled.append)

    supervisor.event_queue.put({
        "type": "result",
        "run_id": "leader-run",
        "record": {"status": "failed"},
    })
    supervisor.event_queue.put({
        "type": "result",
        "run_id": "member-run",
        "record": {"status": "cancelled"},
    })

    records = supervisor.wait_for_all(["member-run", "leader-run"], timeout_seconds=1)

    assert records["leader-run"] == {"status": "failed"}
    assert records["member-run"] == {"status": "cancelled"}
    assert cancelled == ["member-run"]


def test_concurrent_submission_reserves_instance_once(monkeypatch: pytest.MonkeyPatch) -> None:
    instance = SimpleNamespace(id="mumu-0", enabled=True)
    worker = SimpleNamespace(command_queue=queue.Queue())
    supervisor = Supervisor.__new__(Supervisor)
    supervisor.config = SimpleNamespace(instance=lambda _id: instance)
    supervisor.workers = {instance.id: worker}
    supervisor._runs = {}
    supervisor._group_lock = threading.RLock()
    supervisor._completed = {}
    supervisor._groups = {}
    supervisor._run_groups = {}
    supervisor._stopping = False
    supervisor.event_queue = queue.Queue()
    workflow = WorkflowSpec(
        3, "simple", "1.0.0", "", (1, 1), "root", 10, 10, {},
        (WorkflowNode("root", "root", children=("task",)), WorkflowNode("task", "task", action="core.log")),
        Path("simple.json"), "hash", {},
    )
    monkeypatch.setattr(supervisor, "start", lambda: None)
    monkeypatch.setattr(supervisor, "check_workers", lambda: None)
    monkeypatch.setattr(supervisor, "load_workflow", lambda _reference: workflow)
    results: list[str] = []
    errors: list[Exception] = []
    barrier = threading.Barrier(2)

    def submit() -> None:
        barrier.wait()
        try:
            results.append(supervisor.run_workflow("simple", instance.id, wait=False))
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=submit) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(results) == 1
    assert len(errors) == 1
    assert isinstance(errors[0], RuntimeError)
    assert worker.command_queue.qsize() == 1


def test_instance_parallel_queues_each_instance_and_persists_group(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    instances = tuple(SimpleNamespace(id=f"mumu-{index}", enabled=True) for index in range(3))
    config = SimpleNamespace(
        artifact_dir=tmp_path,
        instances=instances,
        instance=lambda instance_id: next(item for item in instances if item.id == instance_id),
    )
    supervisor = Supervisor.__new__(Supervisor)
    supervisor.config = config
    supervisor.workers = {item.id: object() for item in instances}
    supervisor._runs = {}
    supervisor._completed = {}
    supervisor._groups = {}
    supervisor._run_groups = {}
    supervisor._group_lock = threading.RLock()
    supervisor._stopping = False
    supervisor.event_queue = None
    supervisor._workflow_loader = None
    queued: list[tuple[str, str, dict[str, object] | None, str | None]] = []

    def queue_run(workflow: str, instance: str, inputs: dict[str, object] | None = None, *, events_file: str | None = None, wait: bool = True) -> str:
        run_id = f"{instance}-run"
        queued.append((workflow, instance, inputs, events_file))
        supervisor._runs[run_id] = instance
        return run_id

    monkeypatch.setattr(supervisor, "start", lambda: None)
    monkeypatch.setattr(supervisor, "check_workers", lambda: None)
    monkeypatch.setattr(supervisor, "_queue_workflow_run", queue_run)
    monkeypatch.setattr(supervisor, "load_workflow", lambda _reference: WorkflowSpec(
        3,
        "all-accounts",
        "1.0.0",
        "",
        (1, 1),
        "root",
        10,
        100,
        {},
        (),
        tmp_path / "all-accounts.json",
        "hash",
        {},
    ))
    node = WorkflowNode(
        "run_all",
        "instance_parallel",
        runs=tuple(InstanceParallelRun(item.id, f"{item.id}.json") for item in instances),
    )
    workflow = WorkflowSpec(
        3,
        "all-accounts",
        "1.0.0",
        "",
        (1, 1),
        "root",
        10,
        100,
        {},
        (WorkflowNode("root", "root", children=("run_all",)), node),
        tmp_path / "all-accounts.json",
        "hash",
        {},
    )
    group_id = supervisor._run_instance_parallel(workflow, node, {}, wait=False, events_file=None)
    assert [item[1] for item in queued] == ["mumu-0", "mumu-1", "mumu-2"]
    for _, instance, _, _ in queued:
        AtomicJsonStore(tmp_path / "runs" / f"{instance}-run.json").write({"status": "succeeded"})
    group = supervisor._groups[group_id]
    assert group.done.wait(3)
    record = AtomicJsonStore(tmp_path / "runs" / f"{group_id}.json").read(default={})
    assert record["status"] == "succeeded"
    assert [item["instance"] for item in record["runs"]] == ["mumu-0", "mumu-1", "mumu-2"]


def test_instance_parallel_timeout_persists_failed_group_and_cancels_pending(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    supervisor = Supervisor.__new__(Supervisor)
    supervisor.config = SimpleNamespace(artifact_dir=tmp_path)
    supervisor.event_queue = None
    supervisor._stopping = False
    supervisor._group_lock = threading.RLock()
    cancelled: list[str] = []
    monkeypatch.setattr(supervisor, "cancel", cancelled.append)

    workflow = WorkflowSpec(
        3,
        "parallel",
        "1.0.0",
        "",
        (1, 1),
        "root",
        1,
        10,
        {},
        (WorkflowNode("root", "root"),),
        tmp_path / "parallel.json",
        "hash",
        {},
    )
    node = WorkflowNode("run_all", "instance_parallel", wait_for="all")
    group = _Group(
        "group-timeout",
        workflow,
        node,
        ["run-1", "run-2"],
        [
            {"run_id": "run-1", "instance": "one", "status": "queued"},
            {"run_id": "run-2", "instance": "two", "status": "queued"},
        ],
        {},
        threading.Event(),
    )

    supervisor._wait_group_poll(group, timeout_seconds=0)

    assert cancelled == ["run-1", "run-2"]
    assert group.terminal_status == "failed"
    persisted = AtomicJsonStore(tmp_path / "runs" / "group-timeout.json").read(default={})
    assert persisted["status"] == "failed"


def test_wait_for_all_timeout_requests_cancellation(monkeypatch: pytest.MonkeyPatch) -> None:
    supervisor = Supervisor.__new__(Supervisor)
    supervisor.event_queue = queue.Queue()
    supervisor._completed = {}
    supervisor._runs = {"run-1": "one", "run-2": "two"}
    supervisor.workers = {}
    supervisor.check_workers = lambda: None
    cancelled: list[str] = []
    monkeypatch.setattr(supervisor, "cancel", cancelled.append)

    with pytest.raises(TimeoutError):
        supervisor.wait_for_all(["run-1", "run-2"], timeout_seconds=0)

    assert set(cancelled) == {"run-1", "run-2"}


@pytest.mark.skipif(
    os.environ.get("OOOONMYOJI_RUN_REAL_DEVICES") != "1",
    reason="set OOOONMYOJI_RUN_REAL_DEVICES=1 to run against two local MuMu ADB devices",
)
def test_supervisor_runs_two_real_adb_instances(tmp_path: Path) -> None:
    (tmp_path / "config").mkdir()
    (tmp_path / "workflows").mkdir()
    (tmp_path / "plugins" / "actions").mkdir(parents=True)
    (tmp_path / "workflows" / "simple.json").write_text(json.dumps({
        "schema_version": 3,
        "id": "simple",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [
            {"id": "root", "type": "root", "children": ["capture"]},
            {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
        ],
    }), encoding="utf-8")
    config_path = tmp_path / "config" / "config.json"
    config_path.write_text(json.dumps({
        "schema_version": 2,
        "timezone": "Asia/Shanghai",
        "workflow_dir": "workflows",
        "action_dir": "plugins/actions",
        "instances": [
            {"id": "real-0", "backend": "adb", "adb_serial": "127.0.0.1:16384"},
            {"id": "real-1", "backend": "adb", "adb_serial": "emulator-5554"},
        ],
        "ocr": {"enabled": False},
        "tasks": [
            {"id": "simple-real-0", "workflow": "simple", "instance": "real-0"},
            {"id": "simple-real-1", "workflow": "simple", "instance": "real-1"},
        ],
    }), encoding="utf-8")
    config = load_config(config_path)
    supervisor = Supervisor(config)
    try:
        run_ids = [supervisor.run("simple-real-0", wait=False), supervisor.run("simple-real-1", wait=False)]
        records = [supervisor.wait_for(run_id, timeout_seconds=60) for run_id in run_ids]
        assert all(record is not None and record["status"] == "succeeded" for record in records)
    finally:
        supervisor.stop()
