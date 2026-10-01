"""Workflow test sessions: entry points, debugger, assertions and repeat reports."""
from __future__ import annotations

import hashlib
import json
import math
import threading
import time
import uuid
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

from ..actions import ActionStatus, build_action_registry
from ..config.loader import _validate_json_schema
from ..devices.coordinates import CoordinateMapper
from ..devices.factory import connect_at_task_boundary
from ..devices.lock import InstanceLock
from ..devices.protocol import DeviceFrame
from ..exceptions import CancelledError, WorkflowError
from ..vision.image import make_thumbnail_base64
from ..vision.ocr import PaddleOcrEngine
from ..vision.template import TemplateMatcher
from ..workflows.dsl import parse_document
from ..workflows.engine import WorkflowEngine
from ..workflows.graph_compile import compile_graph
from ..workflows.graph_schema import GRAPH_SCHEMA
from ..workflows.loader import WorkflowLoader
from ..workflows.resolver import ReferenceResolver
from ..workflows.validator import validate_workflow
from .context import TaskContextImpl
from .debug import DebugStepRecorder
from .instances import ensure_runtime_instance
from .logging import EventLogger
from .runner import _failed_node_event


class TestDebugger:
    """A task boundary gate; clock stops while the user inspects a breakpoint."""

    __test__ = False

    def __init__(self, cancel: threading.Event, emit: Callable, *, single_step=False, breakpoints=()) -> None:
        self.cancel = cancel
        self.emit = emit
        self.breakpoints = set(breakpoints)
        self.single_step = single_step
        self.pause_requested = False
        self.paused = False
        self._condition = threading.Condition()
        self._pause_started: float | None = None
        self._paused_seconds = 0.0

    def clock(self) -> float:
        with self._condition:
            return (self._pause_started or time.perf_counter()) - self._paused_seconds

    def command(self, command: str) -> None:
        with self._condition:
            if command == "pause":
                self.pause_requested = True
            elif command in {"step", "continue"} and self.paused:
                self.single_step = command == "step"
                self.pause_requested = False
                self.paused = False
            elif command == "stop":
                self.cancel.set()
                self.paused = False
            self._condition.notify_all()

    def before(self, event: dict[str, Any], snapshot: Callable[[], dict[str, Any]]) -> None:
        # Containers are transparent to single stepping; explicit breakpoints may stop them.
        gate = event.get("node_kind") in {"task", "state_machine", "bool_judge", "break"}
        with self._condition:
            if self.cancel.is_set():
                raise CancelledError("test stopped")
            should_pause = event["step_id"] in self.breakpoints or (gate and (self.single_step or self.pause_requested))
            if not should_pause:
                return
            self.paused = True
            self._pause_started = time.perf_counter()
            try:
                self.emit({"type": "paused", "step": event, **snapshot()})
                while self.paused and not self.cancel.is_set():
                    self._condition.wait(0.1)
            finally:
                self._paused_seconds += time.perf_counter() - self._pause_started
                self._pause_started = None
                self.paused = False
            if self.cancel.is_set():
                raise CancelledError("test stopped")


def test_entries(spec: Any, selected: list[str]) -> tuple[str, ...]:
    """Drop selected descendants, preserving execution order from the original tree."""
    if not selected:
        return (spec.root,)
    wanted = set(selected)
    if wanted - set(spec.node_map):
        raise WorkflowError("选择的测试节点已不存在，请重新打开测试台")
    parents = {child: node.id for node in spec.nodes for child in node.children}
    roots = []
    for node_id in selected:
        parent = parents.get(node_id)
        seen = set()
        while parent is not None and parent not in seen and parent not in wanted:
            seen.add(parent)
            parent = parents.get(parent)
        if parent not in wanted and node_id not in roots:
            roots.append(node_id)
    order: list[str] = []

    def visit(node_id: str) -> None:
        if node_id in order:
            return
        order.append(node_id)
        for child in spec.node_map[node_id].children:
            visit(child)

    visit(spec.root)
    return tuple(sorted(roots, key=lambda item: order.index(item) if item in order else len(order) + selected.index(item)))


test_entries.__test__ = False


def reachable_nodes(spec: Any, entries: tuple[str, ...]) -> set[str]:
    reached: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in reached:
            return
        reached.add(node_id)
        for child in spec.node_map[node_id].children:
            visit(child)

    for entry in entries:
        visit(entry)
    return reached


def attach_detached_for_test(raw: dict[str, Any], selected: list[str]) -> None:
    """Give unconnected cards a temporary validation parent without executing it."""
    if not selected:
        return
    nodes = {node["id"]: node for node in raw["nodes"]}
    original_root = nodes.get(raw["root"])
    if original_root is None:
        return  # Normal validation provides the precise diagnostic.
    parents = {child for node in nodes.values() for child in node.get("children", [])}
    detached = [node_id for node_id, node in nodes.items() if node_id != raw["root"] and node_id not in parents and node["type"] not in {"bool_judge", "break"}]
    if not detached and original_root.get("children"):
        return
    root_id, sequence_id = "__test_root", "__test_entries"
    while root_id in nodes or sequence_id in nodes:
        root_id += "_"
        sequence_id += "_"
    # The old root remains an addressable, transparent container. Selecting it
    # still runs only its original children; detached cards run only if selected.
    original_root["type"] = "group_entry" if original_root.get("children") else "sequence"
    raw["nodes"].extend([
        {"id": root_id, "type": "root", "children": [sequence_id]},
        {"id": sequence_id, "type": "sequence", "children": [raw["root"], *detached]},
    ])
    raw["root"] = root_id


def check_expectations(result: Any, expectations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Check actual status or a node's latest output, including failed action output."""
    outputs = deepcopy(result.output)
    for step in result.step_history:
        if step.get("workflow_depth", 0) == 0 and "output" in step and step.get("status") != "succeeded":
            outputs[str(step["step_id"])] = step["output"]
    checks = []
    for rule in expectations:
        actual = None
        error = None
        try:
            path = rule.get("path", "status")
            if path == "status":
                actual = result.status.value
            else:
                actual = ReferenceResolver({}, outputs).reference(path)
            expected = rule.get("value")
            operator = rule.get("operator", "equals")
            if operator == "equals":
                numeric = isinstance(actual, (int, float)) and not isinstance(actual, bool) and isinstance(expected, (int, float)) and not isinstance(expected, bool)
                passed = (type(actual) is type(expected) or numeric) and actual == expected
            elif operator == "contains":
                passed = expected in actual
            elif operator == "at_least":
                passed = not isinstance(actual, bool) and isinstance(actual, (int, float)) and actual >= expected
            elif operator == "count":
                passed = isinstance(actual, (list, dict, str)) and len(actual) == expected
            elif operator == "exists":
                passed = actual is not None
            else:
                raise ValueError(f"unknown expectation operator: {operator}")
        except Exception as exc:
            passed, error = False, str(exc)
        checks.append({**rule, "actual": actual, "passed": passed, "error": error})
    return checks


def summarize_rounds(rounds: list[dict[str, Any]], requested: int) -> dict[str, Any]:
    finished = [item for item in rounds if item["status"] != "cancelled"]
    times = sorted(item["duration_ms"] for item in finished)
    passed = sum(item["passed"] for item in finished)
    failures: dict[str, int] = {}
    for item in finished:
        if not item["passed"]:
            key = item.get("failed_node") or "预期检查"
            failures[key] = failures.get(key, 0) + 1
    return {
        "requested": requested, "completed": len(finished), "passed": passed,
        "cancelled": sum(item["status"] == "cancelled" for item in rounds),
        "success_rate": round(passed / len(finished) * 100, 2) if finished else None,
        "mean_ms": round(sum(times) / len(times), 2) if times else None,
        "p95_ms": times[max(0, math.ceil(len(times) * 0.95) - 1)] if times else None,
        "max_ms": max(times) if times else None, "failures": failures,
    }


class ScreenshotDevice:
    """Read a fixed image, with no connection or possible device input."""

    def __init__(self, path: Path) -> None:
        import cv2
        import numpy as np

        image = cv2.imdecode(np.frombuffer(path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise WorkflowError(f"无法读取截图：{path.name}")
        self.width, self.height = image.shape[1], image.shape[0]
        ok, encoded = cv2.imencode(".png", image)
        if not ok:
            raise WorkflowError("无法解码截图")
        self.frame = DeviceFrame(self.width, self.height, encoded.tobytes(), format="png")

    def capture(self) -> DeviceFrame:
        return self.frame

    def _deny(self, *args: Any, **kwargs: Any) -> None:
        raise WorkflowError("离线测试不执行点击、滑动或输入")

    tap = swipe = key = type_text = _deny

    def close(self) -> None:
        pass


class LazyOcr:
    def __init__(self, settings: Any) -> None:
        self.settings = settings
        self.engine: Any = None
        self._lock = threading.Lock()

    def recognize(self, image: Any) -> list[Any]:
        with self._lock:
            if self.engine is None:
                self.engine = PaddleOcrEngine(language=self.settings.language, use_gpu=self.settings.use_gpu, min_confidence=self.settings.min_confidence)
            return self.engine.recognize(image)

    def close(self) -> None:
        if self.engine is not None:
            self.engine.close()


class TestTaskContext(TaskContextImpl):
    """Carry each workflow's path into its action thread, including parallel calls."""

    __test__ = False

    def begin_action(self) -> threading.Event:
        token = super().begin_action()
        setattr(token, "workflow_path", getattr(self._action_local, "workflow_path", ()))
        return token

    def bind_action(self, token: threading.Event) -> None:
        super().bind_action(token)
        self._action_local.workflow_path = getattr(token, "workflow_path", ())


class WorkflowTestSession:
    def __init__(self, config: Any, request: dict[str, Any], emit: Callable, *, cancel=None, debugger=None) -> None:
        self.config, self.request, self.emit = config, request, emit
        self.cancel = cancel if cancel is not None else threading.Event()
        self.debugger = debugger or TestDebugger(self.cancel, emit, single_step=request.get("singleStep", False), breakpoints=request.get("breakpoints", []))

    def run(self) -> dict[str, Any]:
        request, config = self.request, self.config
        registry = build_action_registry(config.action_dir)
        loader = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir)
        text = request["text"]
        graph = parse_document(text)
        graph.setdefault("edges", [])
        _validate_json_schema(graph, GRAPH_SCHEMA, "测试工作流")
        raw = compile_graph(graph)
        attach_detached_for_test(raw, request.get("nodeIds", []))
        for node_id, params in request.get("parameterOverrides", {}).items():
            node = next((node for node in raw["nodes"] if node["id"] == node_id), None)
            if node is None or node["type"] != "task" or not isinstance(params, dict):
                raise WorkflowError(f"无效的测试参数：{node_id}")
            node["params"] = deepcopy(params)
        spec = validate_workflow(raw, config.workflow_dir / "test-snapshot.owf", registry, project_root=config.root_dir, workflow_dir=config.workflow_dir)
        loader.validate_paths(spec)
        inputs = loader.normalize_inputs(spec, request.get("inputs", {}))
        loader.validate_input_paths(spec, inputs)
        entries = test_entries(spec, request.get("nodeIds", []))
        reached = reachable_nodes(spec, entries)
        interactive = request.get("singleStep", False) or bool(request.get("breakpoints"))
        parallel = {"parallel", "simple_parallel", "instance_parallel"}
        if any(spec.node_map[node].type == "instance_parallel" for node in reached):
            raise WorkflowError("测试台一次测试一个实例，请选择并行容器内的子工作流")
        if interactive and any(spec.node_map[node].type in parallel for node in reached):
            raise WorkflowError("并行分支请分别选择测试，或关闭单步和断点后运行")
        self.debugger.allow_pause = not any(spec.node_map[node].type in parallel for node in reached)
        images = request.get("images", [])
        offline = request.get("mode") == "offline"
        if offline and not images:
            raise WorkflowError("请先选择离线截图")
        if offline:
            for node_id in reached:
                node = spec.node_map[node_id]
                if node.action and (not node.action.startswith("vision.") or registry.get(node.action).side_effect):
                    raise WorkflowError(f"离线测试只运行视觉识别，请移除节点：{node.name or node.id}")
        count = request.get("rounds", 1)
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 100:
            raise WorkflowError("重复次数必须为 1–100")
        if len(images) > 100 or (offline and count * len(images) > 1000):
            raise WorkflowError("一次最多测试 100 张截图、1000 轮")
        session_id = f"test-{uuid.uuid4().hex}"
        folder = config.artifact_dir / "tests" / session_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "snapshot.owf").write_text(text, encoding="utf-8")
        events_file = folder / "events.jsonl"
        raw_emit = self.emit
        events_lock = threading.RLock()

        def emit(event: dict[str, Any]) -> None:
            with events_lock:
                with events_file.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(event, ensure_ascii=False) + "\n")
                raw_emit(event)

        self.debugger.emit = emit
        report: dict[str, Any] = {"id": session_id, "workflow_id": spec.workflow_id, "snapshot_hash": hashlib.sha256(text.encode()).hexdigest(), "request": request, "rounds": []}
        lock = None
        device = None
        ocr = LazyOcr(config.ocr) if config.ocr.enabled else None
        logger = EventLogger(config.log_dir)
        total = count * (len(images) if offline else 1)
        emit({"type": "started", "id": session_id, "total": total, "entries": entries, "canPause": self.debugger.allow_pause})
        try:
            if not offline:
                config = ensure_runtime_instance(config, request.get("instanceId", ""))
                instance = config.instance(request.get("instanceId", ""))
                if not instance.enabled:
                    raise WorkflowError("选择的实例已禁用")
                lock = InstanceLock(config.artifact_dir / "locks", instance.id)
                lock.acquire()
                device, _ = connect_at_task_boundary(config, instance, attempts=config.retry.connection_attempts, base_delay_seconds=config.retry.base_delay_seconds, max_delay_seconds=config.retry.max_delay_seconds)
            for number in range(total):
                if self.cancel.is_set():
                    break
                image = images[number % len(images)] if offline else None
                if offline:
                    device = ScreenshotDevice(Path(image))
                mapper = CoordinateMapper(*spec.resolution, device.width, device.height)
                context = TestTaskContext(device=device, mapper=mapper, template_matcher=TemplateMatcher(mapper), ocr_engine=ocr, artifact_dir=folder / f"round-{number + 1}", template_root=config.root_dir, logger=logger, cancel_event=self.cancel, run_id=session_id, instance_id=request.get("instanceId"))
                recorder = DebugStepRecorder(context)
                before_images: dict[tuple[int, str], str | None] = {}

                def snapshot(engine: Any) -> dict[str, Any]:
                    frame = context.capture()
                    return {"image": make_thumbnail_base64(frame, width=1200), "variables": deepcopy(engine.variables), "outputs": deepcopy(engine.outputs)}

                def on_start(event: dict[str, Any], engine_id: int) -> None:
                    context._action_local.workflow_path = tuple(event["workflow_path"])
                    payload = {"type": "node_started", "round": number + 1, "step": event}
                    if event.get("node_kind") in {"task", "state_machine"}:
                        try:
                            frame = context.capture()
                            key = (engine_id, event["step_id"])
                            before_images[key] = make_thumbnail_base64(frame, width=1200)
                            payload["before_image"] = before_images[key]
                        except CancelledError:
                            raise
                        except Exception:
                            pass
                    emit(payload)

                def on_step(event: dict[str, Any], engine_id: int) -> None:
                    payload = {"type": "step", "round": number + 1, "step": event}
                    if event.get("node_kind") in {"task", "state_machine"}:
                        key = (engine_id, event["step_id"])
                        payload["before_image"] = before_images.pop(key, None)
                        try:
                            saved = recorder.record({**event, "node_kind": "task"})
                            if saved:
                                payload["image"] = make_thumbnail_base64(DeviceFrame(device.width, device.height, saved.read_bytes(), format="png"), width=1200)
                                payload["screenshot"] = str(saved)
                        except Exception as exc:
                            payload["screenshot_error"] = str(exc)
                    emit(payload)

                def execute(child: Any, child_inputs: dict[str, Any], child_entries=None, *, seeds=False, path=None) -> Any:
                    engine = WorkflowEngine(child, registry, context, child_inputs, on_step=lambda event: on_step(event, id(engine)), on_step_start=lambda event: on_start(event, id(engine)), cancel_event=self.cancel, workflow_path=path or (spec.workflow_id,), clock=self.debugger.clock, before_node=lambda event: self.debugger.before(event, lambda: snapshot(engine)))
                    # Unconnected test nodes still get an event index.
                    indices = dict(engine.compiled.execution_index)
                    for node in child.nodes:
                        if node.id not in indices:
                            indices[node.id] = len(indices)
                    engine.compiled = replace(engine.compiled, execution_index=indices)
                    return engine.run(entry_nodes=child_entries, initial_outputs=request.get("outputs", {}) if seeds else None, initial_variables=request.get("variables", {}) if seeds else None)

                def run_subworkflow(reference: str, values: dict[str, Any]) -> tuple[Any, ...]:
                    child = loader.load(reference)
                    path = getattr(context._action_local, "workflow_path", (spec.workflow_id,))
                    if child.workflow_id in path or len(path) >= 4:
                        raise WorkflowError("子工作流递归或嵌套超过 4 层")
                    if interactive and any(node.type in parallel for node in child.nodes):
                        raise WorkflowError("子工作流含并行分支，请关闭单步和断点后运行")
                    result = execute(child, loader.normalize_inputs(child, values, declared_only=True), path=(*path, child.workflow_id))
                    return result.status.value, result.output, result.error, result.error_category

                context.subworkflow_runner = run_subworkflow
                started = self.debugger.clock()
                result = execute(spec, inputs, entries, seeds=True)
                checks = check_expectations(result, request.get("expectations", []))
                failed = _failed_node_event(list(result.step_history)) or {}
                item = {"round": number + 1, "image_source": image, "status": result.status.value, "passed": result.status != ActionStatus.CANCELLED and (all(check["passed"] for check in checks) if checks else result.status == ActionStatus.SUCCEEDED), "duration_ms": round((self.debugger.clock() - started) * 1000, 2), "checks": checks, "failed_node": failed.get("step_id") if result.status == ActionStatus.FAILED else None, "error": result.error, "outputs": result.output}
                report["rounds"].append(item)
                emit({"type": "round", **item, "summary": summarize_rounds(report["rounds"], total)})
                if result.requires_worker_restart:
                    raise WorkflowError("动作未能停止，测试进程需要重启")
                if result.status == ActionStatus.CANCELLED:
                    break
        except CancelledError:
            self.cancel.set()
        except Exception as exc:
            report["error"] = str(exc) or type(exc).__name__
            emit({"type": "error", "message": report["error"]})
        finally:
            for resource, operation in ((device, "close"), (ocr, "close"), (lock, "release")):
                if resource is not None:
                    try:
                        getattr(resource, operation)()
                    except Exception as exc:
                        report.setdefault("cleanup_errors", []).append(str(exc))
            if report.get("cleanup_errors"):
                report["error"] = "关闭测试资源失败：" + "; ".join(report["cleanup_errors"])
            report["summary"] = summarize_rounds(report["rounds"], total)
            report["stopped"] = self.cancel.is_set()
            destination = folder / "report.json"
            destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            emit({"type": "finished", "summary": report["summary"], "stopped": report["stopped"], "error": report.get("error"), "report": str(destination)})
        return report
