"""Command line control for the automation runtime."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

from .actions import ActionRegistry, build_action_registry
from .config import load_config
from .devices.factory import resolve_adb_path
from .devices.mumu import discover_mumu_path
from .exceptions import AutomationError, ConfigError
from .runtime.control import ControlServer, send_control
from .runtime.records import AtomicJsonStore
from .runtime.scheduler import Scheduler
from .runtime.supervisor import Supervisor
from .workflows.loader import WorkflowLoader


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = PROJECT_ROOT / "config" / "config.json"


def _config_path(value: str | None) -> Path:
    if value:
        return Path(value).resolve()
    if DEFAULT_CONFIG.is_file():
        return DEFAULT_CONFIG.resolve()
    return (PROJECT_ROOT / "config" / "config.example.json").resolve()


def _load_validated(path: Path) -> tuple[Any, ActionRegistry, WorkflowLoader, dict[str, Any]]:
    config = load_config(path)
    registry = build_action_registry(config.action_dir)
    loader = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir)
    workflows = loader.discover()
    for job in config.jobs:
        workflow = loader.load(job.workflow)
        inputs = loader.normalize_inputs(workflow, job.inputs)
        loader.validate_input_paths(workflow, inputs)
    return config, registry, loader, workflows


def _print(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


def command_validate(args: argparse.Namespace) -> int:
    config, registry, _, workflows = _load_validated(_config_path(args.config))
    _print({
        "valid": True,
        "config": str(config.config_path),
        "instances": len(config.instances),
        "tasks": len(config.jobs),
        "workflows": sorted(workflows),
        "actions": list(registry.names()),
    })
    return 0


def command_list_workflows(args: argparse.Namespace) -> int:
    _, _, _, workflows = _load_validated(_config_path(args.config))
    _print({workflow_id: {
        "version": spec.version,
        "file": str(spec.path),
        "file_hash": spec.file_hash,
        "reference_resolution": list(spec.reference_resolution),
        "steps": [step.id for step in spec.steps],
    } for workflow_id, spec in sorted(workflows.items())})
    return 0


def command_show_workflow(args: argparse.Namespace) -> int:
    _, _, _, workflows = _load_validated(_config_path(args.config))
    try:
        spec = workflows[args.workflow]
    except KeyError as exc:
        raise ConfigError(f"unknown workflow: {args.workflow}") from exc
    _print(spec.raw)
    return 0


def command_list_actions(args: argparse.Namespace) -> int:
    _, registry, _, _ = _load_validated(_config_path(args.config))
    _print({spec.name: {
        "version": spec.version,
        "input_schema": spec.input_schema,
        "output_schema": spec.output_schema,
        "retry_safe": spec.retry_safe,
        "side_effect": spec.side_effect,
        "source": spec.source,
    } for spec in registry.specs()})
    return 0


def command_doctor(args: argparse.Namespace) -> int:
    checks: dict[str, Any] = {
        "config": "failed",
        "workflows": "failed",
        "actions": "failed",
        "opencv": "not_checked",
        "paddleocr": "not_checked",
        "paddlepaddle": "not_checked",
        "mumu_path": "not_checked",
        "adb_path": "not_checked",
    }
    try:
        config, registry, _, workflows = _load_validated(_config_path(args.config))
        checks["config"] = "ok"
        checks["workflows"] = f"ok ({len(workflows)})"
        checks["actions"] = f"ok ({len(registry.names())})"
        try:
            import cv2  # noqa: F401
            checks["opencv"] = "ok"
        except ImportError:
            checks["opencv"] = "missing"
        try:
            import paddleocr  # noqa: F401
            checks["paddleocr"] = "ok"
        except ImportError:
            checks["paddleocr"] = "missing"
        try:
            import paddle  # noqa: F401
            checks["paddlepaddle"] = "ok"
        except ImportError:
            checks["paddlepaddle"] = "missing"

        mumu_required = any(instance.backend == "mumu" for instance in config.instances)
        resolved_mumu = config.mumu_path or discover_mumu_path()
        checks["mumu_path"] = str(resolved_mumu) if resolved_mumu is not None and Path(resolved_mumu).is_dir() else "missing"
        adb_required = any(instance.backend == "adb" or instance.adb_serial is not None for instance in config.instances)
        adb_path = resolve_adb_path(config)
        adb_available = Path(adb_path).is_file() if Path(adb_path).is_absolute() else shutil.which(adb_path) is not None
        checks["adb_path"] = adb_path if adb_available else "missing"
        dependencies_ok = checks["opencv"] == "ok" and (
            not config.ocr.enabled or (checks["paddleocr"] == "ok" and checks["paddlepaddle"] == "ok")
        )
        devices_ok = (not mumu_required or checks["mumu_path"] != "missing") and (not adb_required or adb_available)
        _print(checks)
        return 0 if dependencies_ok and devices_ok else 2
    except AutomationError as exc:
        checks["error"] = str(exc)
        _print(checks)
        return 2


def _run_local(config_path: Path, job_id: str) -> int:
    config, _, _, _ = _load_validated(config_path)
    supervisor = Supervisor(config)
    try:
        run_id = supervisor.run(job_id, wait=True)
        record = AtomicJsonStore(config.artifact_dir / "runs" / f"{run_id}.json").read(default={})
        _print({"run_id": run_id, "status": record.get("status") if isinstance(record, dict) else None})
        return 0 if isinstance(record, dict) and record.get("status") == "succeeded" else 1
    finally:
        supervisor.stop()


def command_run(args: argparse.Namespace) -> int:
    path = _config_path(args.config)
    try:
        response = send_control({"command": "run", "job_id": args.job})
        _print(response)
        return 0 if response.get("ok", False) else 2
    except (OSError, EOFError, TimeoutError):
        return _run_local(path, args.job)


def command_cancel(args: argparse.Namespace) -> int:
    try:
        response = send_control({"command": "cancel", "run_id": args.run_id})
        _print(response)
        return 0 if response.get("ok", False) else 2
    except (OSError, EOFError, TimeoutError) as exc:
        _print({"ok": False, "error": f"supervisor is not running: {exc}"})
        return 2


def command_status(args: argparse.Namespace) -> int:
    try:
        response = send_control({"command": "status"})
        _print(response)
        return 0
    except (OSError, EOFError, TimeoutError):
        config = load_config(_config_path(args.config))
        state = AtomicJsonStore(config.artifact_dir / "scheduler-state.json").read(default={})
        _print({"running": False, "scheduler": state})
        return 0


def command_serve(args: argparse.Namespace) -> int:
    config, _, loader, _ = _load_validated(_config_path(args.config))
    safe_retry_jobs = {
        job.id for job in config.jobs
        if job.retry_enabled and loader.load(job.workflow).retry_safe
    }
    scheduler = Scheduler(config.jobs, config.artifact_dir / "scheduler-state.json", timezone_name=config.timezone)
    scheduler.recover(retry_safe_job_ids=safe_retry_jobs)
    supervisor = Supervisor(config)
    supervisor.start()
    pending: dict[str, str] = {}

    def handler(request: dict[str, Any]) -> dict[str, Any]:
        command = request.get("command")
        if command == "run":
            run_id = supervisor.run(str(request["job_id"]), wait=False)
            pending[run_id] = str(request["job_id"])
            return {"ok": True, "run_id": run_id}
        if command == "cancel":
            supervisor.cancel(str(request["run_id"]))
            return {"ok": True}
        if command == "status":
            return {"ok": True, "scheduler": scheduler.status(), "workers": {key: worker.process.is_alive() for key, worker in supervisor.workers.items()}}
        if command == "stop":
            return {"ok": True}
        return {"ok": False, "error": f"unknown command: {command}"}

    control = ControlServer(handler)
    import threading
    control_thread = threading.Thread(target=control.serve_forever, daemon=True)
    control_thread.start()
    try:
        while True:
            supervisor.check_workers()
            for due in scheduler.tick():
                run_id = supervisor.run(due.job.id, wait=False)
                pending[run_id] = due.job.id
            try:
                event_queue = supervisor.event_queue
                assert event_queue is not None
                event = event_queue.get(timeout=0.25)
            except Exception:
                event = None
            if event:
                record = supervisor.handle_event(event)
            else:
                record = None
            if event and event.get("type") == "result":
                run_id = event.get("run_id")
                job_id = pending.pop(run_id, None)
                if job_id:
                    scheduler.mark_finished(job_id)
    except KeyboardInterrupt:
        return 0
    finally:
        control.close()
        supervisor.stop()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="oooonmyoji", description=__doc__)
    parser.add_argument("--config", default=None, help=f"JSON configuration path (default: {DEFAULT_CONFIG.name}, then config.example.json)")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("serve").set_defaults(function=command_serve)
    subparsers.add_parser("status").set_defaults(function=command_status)
    run = subparsers.add_parser("run")
    run.add_argument("job")
    run.set_defaults(function=command_run)
    cancel = subparsers.add_parser("cancel")
    cancel.add_argument("run_id")
    cancel.set_defaults(function=command_cancel)
    subparsers.add_parser("validate").set_defaults(function=command_validate)
    subparsers.add_parser("doctor").set_defaults(function=command_doctor)
    subparsers.add_parser("list-workflows").set_defaults(function=command_list_workflows)
    show = subparsers.add_parser("show-workflow")
    show.add_argument("workflow")
    show.set_defaults(function=command_show_workflow)
    subparsers.add_parser("list-actions").set_defaults(function=command_list_actions)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.function(args))
    except AutomationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
