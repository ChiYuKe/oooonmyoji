from __future__ import annotations

import json
import os
import threading
import time
import queue
import subprocess
import sys
from pathlib import Path

import pytest

from src.oooonmyoji.actions import ActionStatus, build_action_registry
from src.oooonmyoji.config import load_config
from src.oooonmyoji.exceptions import WorkflowError
from src.oooonmyoji.runtime.testing import (
    ScreenshotDevice, TestDebugger, WorkflowTestSession, check_expectations,
    summarize_rounds, test_entries,
)
from src.oooonmyoji.workflows.engine import WorkflowEngine, WorkflowResult
from src.oooonmyoji.workflows.validator import validate_workflow
from tests.test_workflows import Context, EchoAction, action_spec, registry, task, tree, validate
from tests.workflow_files import workflow_text, write_workflow


def test_partial_execution_preserves_order_and_accepts_prior_outputs() -> None:
    actions = registry(action_spec(EchoAction()))
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["a", "b"]},
        task("a", "test.echo", {"value": 7}),
        task("b", "test.echo", {"value": {"ref": "nodes.a.output.value"}}),
    ], "seq")
    spec = validate(raw, actions)
    assert test_entries(spec, ["b", "a"]) == ("a", "b")
    assert test_entries(spec, ["b", "seq", "a"]) == ("seq",)
    with pytest.raises(WorkflowError, match="不存在"):
        test_entries(spec, ["missing"])
    engine = WorkflowEngine(spec, actions, Context(), {})
    missing = engine.run(entry_nodes=("b",))
    assert missing.status == ActionStatus.FAILED
    result = engine.run(entry_nodes=("b",), initial_outputs={"a": {"value": 9}})
    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["b"] == {"value": 9}
    assert [event["step_id"] for event in result.step_history] == ["b"]
    assert engine.run(entry_nodes=("a", "b")).output["b"] == {"value": 7}


def test_variables_reset_each_test_and_can_be_seeded_in_local_scope() -> None:
    actions = registry(action_spec(EchoAction()))
    spec = validate(tree([{"id": "seq", "type": "sequence", "children": ["a"]}, task("a", "test.echo", {"value": {"ref": "variables.counter"}})], "seq", variables={"counter": {"type": "integer", "default": 2, "owner": "seq"}}), actions)
    engine = WorkflowEngine(spec, actions, Context(), {})
    assert engine.run(entry_nodes=("seq",), initial_variables={"counter": 8}).output["a"]["value"] == 8
    assert engine.run(entry_nodes=("seq",)).output["a"]["value"] == 2
    with pytest.raises(WorkflowError, match="unknown test variable"):
        engine.run(initial_variables={"missing": 1})
    with pytest.raises(WorkflowError, match="entry nodes"):
        engine.run(entry_nodes=())


def test_debugger_steps_before_action_and_excludes_pause_from_timeout() -> None:
    actions = registry(action_spec(EchoAction()))
    spec = validate(tree([
        {"id": "seq", "type": "sequence", "children": ["a", "b"]},
        task("a", "test.echo", {"value": 1}), task("b", "test.echo", {"value": 2}),
    ], "seq", limits={"timeout_seconds": 0.06}), actions)
    events = []
    paused = threading.Event()
    cancel = threading.Event()

    def emit(event):
        events.append(event)
        paused.set()

    debug = TestDebugger(cancel, emit, single_step=True)
    results = []
    engine = WorkflowEngine(spec, actions, Context(), {}, cancel_event=cancel, clock=debug.clock, before_node=lambda event: debug.before(event, lambda: {"outputs": dict(engine.outputs)}))
    worker = threading.Thread(target=lambda: results.append(engine.run()))
    worker.start()
    assert paused.wait(1)
    assert events[-1]["step"]["step_id"] == "a"
    assert events[-1]["outputs"] == {}
    paused.clear()
    time.sleep(0.1)  # A pause longer than the complete workflow timeout.
    debug.command("step")
    assert paused.wait(1)
    assert events[-1]["step"]["step_id"] == "b"
    assert events[-1]["outputs"] == {"a": {"value": 1}}
    debug.command("continue")
    worker.join(1)
    assert not worker.is_alive()
    assert results[0].status == ActionStatus.SUCCEEDED


@pytest.mark.parametrize("kind", ["task", "data"])
def test_stop_at_breakpoint_does_not_execute_action(kind) -> None:
    actions = registry(action_spec(EchoAction()))
    spec = validate(tree([task("a", "test.echo"), {"id": "judge", "type": "bool_judge", "expression": True}], "a"), actions)
    target = "a" if kind == "task" else "judge"
    paused = threading.Event()
    cancel = threading.Event()
    debug = TestDebugger(cancel, lambda event: paused.set(), breakpoints=[target])
    engine = WorkflowEngine(spec, actions, Context(), {}, cancel_event=cancel, before_node=lambda event: debug.before(event, lambda: {}))
    results = []
    worker = threading.Thread(target=lambda: results.append(engine.run(entry_nodes=(target,))))
    worker.start()
    assert paused.wait(1)
    debug.command("stop")
    worker.join(1)
    assert results[0].status == ActionStatus.CANCELLED
    assert results[0].output == {}


def test_assertions_check_failed_output_count_types_and_missing_paths() -> None:
    result = WorkflowResult(ActionStatus.FAILED, output={"a": list(range(70))}, step_history=({"step_id": "b", "status": "failed", "output": []},))
    checks = check_expectations(result, [
        {"path": "status", "value": "failed"},
        {"path": "nodes.a.output", "operator": "count", "value": 70},
        {"path": "nodes.b.output", "operator": "count", "value": 0},
        {"path": "nodes.a.output.3", "operator": "at_least", "value": 3},
        {"path": "nodes.a.output.3", "value": 3.0},
        {"path": "nodes.a.output.3", "value": True},
        {"path": "nodes.missing.output", "operator": "exists"},
    ])
    assert [item["passed"] for item in checks] == [True] * 5 + [False, False]
    assert checks[-1]["error"]


def test_cancelled_round_is_excluded_from_success_rate_and_timing() -> None:
    summary = summarize_rounds([
        {"status": "succeeded", "passed": True, "duration_ms": 10},
        {"status": "failed", "passed": False, "failed_node": "tap", "duration_ms": 30},
        {"status": "cancelled", "passed": False, "duration_ms": 1000},
    ], 5)
    assert summary["success_rate"] == 50
    assert summary["mean_ms"] == 20
    assert summary["p95_ms"] == 30
    assert summary["cancelled"] == 1
    assert summary["failures"] == {"tap": 1}
    assert summarize_rounds([], 2)["success_rate"] is None


@pytest.fixture
def offline_project(tmp_path):
    import cv2
    import numpy as np

    root = Path(__file__).resolve().parents[1]
    raw = json.loads((root / "config/config.example.json").read_text(encoding="utf-8"))
    raw.update({"discover_mumu_instances": False, "tasks": [], "action_dir": "plugins/actions", "ocr": {"enabled": False}})
    (tmp_path / "config").mkdir()
    (tmp_path / "workflows").mkdir()
    (tmp_path / "plugins/actions").mkdir(parents=True)
    config_path = tmp_path / "config/config.json"
    config_path.write_text(json.dumps(raw), encoding="utf-8")
    config = load_config(config_path)
    image = np.random.default_rng(3).integers(0, 255, (90, 160, 3), dtype=np.uint8)
    screenshot = tmp_path / "画面.png"
    template = tmp_path / "template.png"
    screenshot.write_bytes(cv2.imencode(".png", image)[1].tobytes())
    template.write_bytes(cv2.imencode(".png", image[20:40, 50:80])[1].tobytes())
    raw_workflow = tree([task("find", "vision.match_template", {"template": "template.png", "threshold": 0.95})], "find", resolution=[160, 90])
    request = {"text": workflow_text(raw_workflow), "nodeIds": ["find"], "mode": "offline", "images": [str(screenshot)], "rounds": 2, "inputs": {}, "expectations": [{"path": "nodes.find.output", "operator": "count", "value": 1}]}
    return config, request, tmp_path


def test_offline_recognition_repeats_and_saves_snapshot_report_images(offline_project) -> None:
    config, request, tmp_path = offline_project
    events = []
    report = WorkflowTestSession(config, request, events.append).run()
    assert report["summary"]["completed"] == 2
    assert report["summary"]["success_rate"] == 100
    steps = [event for event in events if event["type"] == "step"]
    assert all(step["step"]["step_id"] == "find" for step in steps)
    assert all(step["before_image"] and step["image"] for step in steps)
    starts = [event for event in events if event["type"] == "node_started"]
    assert len(starts) == 2
    assert all(event["before_image"] for event in starts)
    assert len({step["screenshot"] for step in steps}) == 2
    assert Path(events[-1]["report"]).is_file()
    assert (Path(events[-1]["report"]).parent / "snapshot.owf").read_text(encoding="utf-8") == request["text"]
    assert list((tmp_path / "workflows").glob("*.owf")) == []


def test_offline_miss_can_be_an_expected_result(offline_project) -> None:
    config, request, _ = offline_project
    request["parameterOverrides"] = {"find": {"template": "template.png", "threshold": 0.99, "roi": [0, 0, 40, 20]}}
    request["expectations"] = [{"path": "status", "value": "failed"}, {"path": "nodes.find.output", "operator": "count", "value": 0}]
    report = WorkflowTestSession(config, request, lambda event: None).run()
    assert report["summary"]["success_rate"] == 100
    assert report["rounds"][0]["status"] == "failed"


def test_selected_detached_node_can_run_before_its_execution_line_is_connected(offline_project) -> None:
    config, request, _ = offline_project
    raw = tree([task("find", "vision.match_template", {"template": "template.png", "threshold": 0.95})], "find", resolution=[160, 90])
    raw["nodes"][0]["children"] = []
    request["text"] = workflow_text(raw)
    events = []
    report = WorkflowTestSession(config, request, events.append).run()
    assert report["summary"]["success_rate"] == 100
    assert {event["step"]["step_id"] for event in events if event["type"] == "step"} == {"find"}


def test_offline_rejects_input_before_opening_any_device(offline_project) -> None:
    config, request, _ = offline_project
    request["text"] = workflow_text(tree([task("tap", "input.tap", {"x": 10, "y": 10})], "tap"))
    request["nodeIds"] = ["tap"]
    with pytest.raises(WorkflowError, match="只运行视觉识别"):
        WorkflowTestSession(config, request, lambda event: None).run()
    device = ScreenshotDevice(Path(request["images"][0]))
    with pytest.raises(WorkflowError, match="不执行点击"):
        device.tap(10, 10)


def test_parallel_debug_reports_limitation_before_execution(offline_project) -> None:
    config, request, _ = offline_project
    raw = tree([
        {"id": "parallel", "type": "parallel", "children": ["a", "b"]},
        task("a", "vision.ocr"), task("b", "vision.ocr"),
    ], "parallel")
    request.update(text=workflow_text(raw), nodeIds=[], singleStep=True)
    with pytest.raises(WorkflowError, match="并行分支"):
        WorkflowTestSession(config, request, lambda event: None).run()


def test_live_session_uses_instance_lock_and_releases_resources(offline_project, monkeypatch) -> None:
    config, request, _ = offline_project
    # Use the same fixed image as a fake connected device: no emulator input is sent.
    device = ScreenshotDevice(Path(request["images"][0]))
    closed = []
    device.close = lambda: closed.append(True)
    monkeypatch.setattr("src.oooonmyoji.runtime.testing.connect_at_task_boundary", lambda *args, **kwargs: (device, False))
    request.update(mode="live", images=[], instanceId="mumu-0")
    report = WorkflowTestSession(config, request, lambda event: None).run()
    assert report["summary"]["success_rate"] == 100
    assert closed


def test_parallel_subworkflows_keep_independent_paths_outputs_and_valid_event_lines(offline_project, monkeypatch) -> None:
    config, request, _ = offline_project
    device = ScreenshotDevice(Path(request["images"][0]))
    monkeypatch.setattr("src.oooonmyoji.runtime.testing.connect_at_task_boundary", lambda *args, **kwargs: (device, False))
    write_workflow(config.workflow_dir / "child.owf", tree([
        {"id": "seq", "type": "sequence", "children": ["wait", "log"]},
        task("wait", "core.sleep", {"seconds": 0.02}),
        task("log", "core.log", {"message": {"ref": "inputs.label"}}),
    ], "seq", id="child", inputs={"label": {"type": "string"}}))
    raw = tree([
        {"id": "parallel", "type": "parallel", "children": ["a", "b"]},
        task("a", "workflow.run", {"workflow": "child", "inputs": {"label": "A"}}),
        task("b", "workflow.run", {"workflow": "child", "inputs": {"label": "B"}}),
    ], "parallel", resolution=[160, 90])
    request.update(text=workflow_text(raw), mode="live", images=[], instanceId="mumu-0", nodeIds=[], expectations=[], rounds=1)
    events = []
    report = WorkflowTestSession(config, request, events.append).run()
    assert report["summary"]["success_rate"] == 100
    assert report["rounds"][0]["outputs"]["a"]["output"]["log"]["message"] == "A"
    assert report["rounds"][0]["outputs"]["b"]["output"]["log"]["message"] == "B"
    child_events = [event for event in events if event["type"] == "step" and event["step"]["workflow_depth"] == 1]
    assert len(child_events) == 8
    assert all(event["step"]["workflow_path"] == ["test", "child"] for event in child_events)
    event_lines = Path(events[-1]["report"]).parent / "events.jsonl"
    assert len([json.loads(line) for line in event_lines.read_text(encoding="utf-8").splitlines()]) == len(events)


def test_output_seed_is_validated_against_action_schema() -> None:
    actions = build_action_registry(Path.cwd() / "plugins/actions")
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["a", "b"]},
        task("a", "vision.ocr"), task("b", "core.log", {"message": "hello"}),
    ], "seq")
    # The engine can reject the seed without evaluating either action.
    spec = validate_workflow(raw, Path("test.owf"), actions, project_root=Path.cwd())
    with pytest.raises(WorkflowError):
        WorkflowEngine(spec, actions, Context(), {}).run(entry_nodes=("b",), initial_outputs={"a": {"wrong": 1}})


def test_desktop_protocol_runs_offline_with_breakpoint_commands(offline_project) -> None:
    config, request, _ = offline_project
    request.update(singleStep=True, rounds=1)
    project = Path(__file__).resolve().parents[1]
    process = subprocess.Popen([sys.executable, "-m", "src.oooonmyoji.tools.workflow_test", "--config", str(config.config_path)], cwd=project, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
    received = queue.Queue()

    def read_events():
        for line in process.stdout:
            received.put(json.loads(line))

    threading.Thread(target=read_events, daemon=True).start()
    try:
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()
        events = []
        while True:
            try:
                event = received.get(timeout=10)
            except queue.Empty:
                process.kill()
                stdout, stderr = process.communicate(timeout=5)
                pytest.fail(f"protocol stalled after {[event['type'] for event in events]}: {stdout} {stderr}")
            events.append(event)
            if event["type"] == "paused":
                assert event["step"]["step_id"] == "find"
                assert event["outputs"] == {}
                assert event["image"]
                process.stdin.write(json.dumps({"command": "step"}) + "\n")
                process.stdin.flush()
            if event["type"] == "finished":
                assert event["summary"]["success_rate"] == 100
                break
        assert any(event["type"] == "paused" for event in events)
        assert any(event["type"] == "step" for event in events)
        process.wait(timeout=5)
        assert process.returncode == 0
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)
