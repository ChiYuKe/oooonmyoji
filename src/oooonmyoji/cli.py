"""Command line control for the automation runtime."""

from __future__ import annotations

import argparse
from dataclasses import replace
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
from .runtime.instances import ensure_runtime_instance, expand_runtime_instances
from .runtime.records import AtomicJsonStore
from .runtime.scheduler import Scheduler
from .runtime.supervisor import Supervisor
from .workflows.loader import WorkflowLoader


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = PROJECT_ROOT / "config" / "config.json"
PARTY_SOULS_LEADER_WORKFLOW = "mumu_0_souls_party_leader.json"
PARTY_SOULS_MEMBER_WORKFLOW = "mumu_1_souls_party_member.json"


def _config_path(value: str | None) -> Path:
    if value:
        return Path(value).resolve()
    if DEFAULT_CONFIG.is_file():
        return DEFAULT_CONFIG.resolve()
    return (PROJECT_ROOT / "config" / "config.example.json").resolve()


def _load_validated(path: Path) -> tuple[Any, ActionRegistry, WorkflowLoader, dict[str, Any]]:
    config, registry, loader = _load_runtime(path)
    workflows = loader.discover()
    for job in config.jobs:
        workflow = loader.load(job.workflow)
        inputs = loader.normalize_inputs(workflow, job.inputs)
        loader.validate_input_paths(workflow, inputs)
    return config, registry, loader, workflows


def _load_runtime(path: Path) -> tuple[Any, ActionRegistry, WorkflowLoader]:
    config = expand_runtime_instances(load_config(path))
    registry = build_action_registry(config.action_dir)
    loader = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir)
    return config, registry, loader


def _workflow_reference(config: Any, value: str) -> str:
    """Accept a workflow ID, workflow filename, or path below workflows/."""

    requested = Path(value)
    candidates = [requested]
    if not requested.is_absolute():
        candidates.extend((config.root_dir / requested, config.workflow_dir / requested))
    for candidate in candidates:
        with_suffix = candidate if candidate.suffix.lower() == ".json" else candidate.with_suffix(".json")
        if not with_suffix.is_file():
            continue
        try:
            relative = with_suffix.resolve().relative_to(config.workflow_dir.resolve())
        except ValueError as exc:
            raise ConfigError(f"workflow must stay below the workflow directory: {value}") from exc
        return relative.as_posix()
    return value


def _workflow_inputs(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConfigError(f"unable to read workflow inputs {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ConfigError(f"workflow inputs must be a JSON object: {path}")
    return value


def _prepare_workflow_run(
    config_path: Path,
    workflow_value: str,
    instance_id: str,
    inputs_path: Path | None,
) -> tuple[str, dict[str, Any]]:
    config, _, loader = _load_runtime(config_path)
    config = ensure_runtime_instance(config, instance_id)
    try:
        config.instance(instance_id)
    except StopIteration as exc:
        raise ConfigError(f"instance does not exist: {instance_id}") from exc
    workflow_reference = _workflow_reference(config, workflow_value)
    workflow = loader.load(workflow_reference)
    inputs = loader.normalize_inputs(workflow, _workflow_inputs(inputs_path))
    loader.validate_input_paths(workflow, inputs)
    return workflow_reference, inputs


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
        "description": spec.description,
        "file": str(spec.path),
        "file_hash": spec.file_hash,
        "resolution": list(spec.resolution),
        "nodes": [node.id for node in spec.nodes],
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


def command_list_instances(args: argparse.Namespace) -> int:
    config = expand_runtime_instances(load_config(_config_path(args.config)))
    _print({"instances": [{
        "id": instance.id,
        "backend": instance.backend,
        "mumu_index": instance.mumu_index,
        "adb_serial": instance.adb_serial,
        "display_name": instance.display_name,
    } for instance in config.instances if instance.enabled]})
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


def _run_workflow_local(
    config_path: Path,
    workflow: str,
    instance: str,
    inputs: dict[str, Any],
    events_file: Path | None = None,
) -> int:
    config = ensure_runtime_instance(expand_runtime_instances(load_config(config_path)), instance)
    config = replace(config, instances=(config.instance(instance),))
    supervisor = Supervisor(config)
    try:
        run_id = supervisor.run_workflow(workflow, instance, inputs, wait=True, events_file=str(events_file) if events_file else None)
        record = AtomicJsonStore(config.artifact_dir / "runs" / f"{run_id}.json").read(default={})
        _print({"run_id": run_id, "status": record.get("status") if isinstance(record, dict) else None})
        return 0 if isinstance(record, dict) and record.get("status") == "succeeded" else 1
    finally:
        supervisor.stop()


def _run_party_souls_local(
    config_path: Path,
    leader_instance: str,
    member_instance: str,
    rounds: int,
    leader_events_file: Path | None = None,
    member_events_file: Path | None = None,
) -> int:
    config = expand_runtime_instances(load_config(config_path))
    config = ensure_runtime_instance(config, leader_instance)
    config = ensure_runtime_instance(config, member_instance)
    if leader_instance == member_instance:
        raise ConfigError("party leader and member must use different instances")
    try:
        leader = config.instance(leader_instance)
        member = config.instance(member_instance)
    except StopIteration as exc:
        raise ConfigError("party leader or member instance does not exist") from exc
    config = replace(config, instances=(leader, member))
    supervisor = Supervisor(config)
    try:
        member_run_id = supervisor.run_workflow(
            PARTY_SOULS_MEMBER_WORKFLOW,
            member_instance,
            {"rounds": rounds},
            wait=False,
            events_file=str(member_events_file) if member_events_file else None,
        )
        leader_run_id = supervisor.run_workflow(
            PARTY_SOULS_LEADER_WORKFLOW,
            leader_instance,
            {"rounds": rounds},
            wait=False,
            events_file=str(leader_events_file) if leader_events_file else None,
        )
        records = supervisor.wait_for_all(
            [member_run_id, leader_run_id],
            timeout_seconds=1209700,
            cancel_on_failure=True,
        )
        member_record = records.get(member_run_id)
        leader_record = records.get(leader_run_id)
        statuses = {
            "member": member_record.get("status") if isinstance(member_record, dict) else None,
            "leader": leader_record.get("status") if isinstance(leader_record, dict) else None,
        }
        _print({
            "runs": {"member": member_run_id, "leader": leader_run_id},
            "statuses": statuses,
        })
        return 0 if all(status == "succeeded" for status in statuses.values()) else 1
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


def command_run_workflow(args: argparse.Namespace) -> int:
    path = _config_path(args.config)
    workflow, inputs = _prepare_workflow_run(path, args.workflow, args.instance, args.inputs)
    event_file_value = str(args.events_file) if args.events_file is not None else None
    try:
        response = send_control({
            "command": "run-workflow",
            "workflow": workflow,
            "instance": args.instance,
            "inputs": inputs,
            "events_file": event_file_value,
        })
        _print(response)
        return 0 if response.get("ok", False) else 2
    except (OSError, EOFError, TimeoutError):
        return _run_workflow_local(path, workflow, args.instance, inputs, args.events_file)


def command_run_party_souls(args: argparse.Namespace) -> int:
    path = _config_path(args.config)
    leader_workflow, _ = _prepare_workflow_run(path, PARTY_SOULS_LEADER_WORKFLOW, args.leader_instance, None)
    member_workflow, _ = _prepare_workflow_run(path, PARTY_SOULS_MEMBER_WORKFLOW, args.member_instance, None)
    if args.leader_instance == args.member_instance:
        raise ConfigError("party leader and member must use different instances")
    try:
        response = send_control({
            "command": "run-party-souls",
            "leader_workflow": leader_workflow,
            "leader_instance": args.leader_instance,
            "member_workflow": member_workflow,
            "member_instance": args.member_instance,
            "rounds": args.rounds,
            "leader_events_file": str(args.leader_events_file) if args.leader_events_file else None,
            "member_events_file": str(args.member_events_file) if args.member_events_file else None,
        })
        _print(response)
        return 0 if response.get("ok", False) else 2
    except (OSError, EOFError, TimeoutError):
        return _run_party_souls_local(
            path,
            args.leader_instance,
            args.member_instance,
            args.rounds,
            args.leader_events_file,
            args.member_events_file,
        )


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
        if command == "run-workflow":
            runtime_config = ensure_runtime_instance(
                expand_runtime_instances(load_config(config.config_path)),
                str(request["instance"]),
            )
            supervisor.ensure_instance(runtime_config.instance(str(request["instance"])))
            run_id = supervisor.run_workflow(
                str(request["workflow"]),
                str(request["instance"]),
                request.get("inputs", {}),
                wait=False,
                events_file=request.get("events_file"),
            )
            return {"ok": True, "run_id": run_id}
        if command == "run-party-souls":
            leader_instance = str(request["leader_instance"])
            member_instance = str(request["member_instance"])
            rounds = int(request.get("rounds", 9999))
            if rounds not in {1, 9999}:
                return {"ok": False, "error": "party rounds must be 1 or 9999"}
            if leader_instance == member_instance:
                return {"ok": False, "error": "party leader and member must use different instances"}
            runtime_config = expand_runtime_instances(load_config(config.config_path))
            runtime_config = ensure_runtime_instance(runtime_config, leader_instance)
            runtime_config = ensure_runtime_instance(runtime_config, member_instance)
            supervisor.ensure_instance(runtime_config.instance(leader_instance))
            supervisor.ensure_instance(runtime_config.instance(member_instance))
            member_run_id = supervisor.run_workflow(
                str(request["member_workflow"]),
                member_instance,
                {"rounds": rounds},
                wait=False,
                events_file=request.get("member_events_file"),
            )
            try:
                leader_run_id = supervisor.run_workflow(
                    str(request["leader_workflow"]),
                    leader_instance,
                    {"rounds": rounds},
                    wait=False,
                    events_file=request.get("leader_events_file"),
                )
            except Exception:
                supervisor.cancel(member_run_id)
                raise
            return {
                "ok": True,
                "runs": {"member": member_run_id, "leader": leader_run_id},
            }
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
    run_workflow = subparsers.add_parser(
        "run-workflow",
        help="直接运行 workflows/ 下的 JSON，不需要在 config.tasks 中注册",
    )
    run_workflow.add_argument("workflow", help="工作流 ID、JSON 文件名或 workflows/ 下的路径")
    run_workflow.add_argument("--instance", default="mumu-0", help="实例 ID，默认 mumu-0")
    run_workflow.add_argument("--inputs", type=Path, help="可选的工作流输入 JSON 文件")
    run_workflow.add_argument("--events-file", type=Path, help="可选的运行事件 JSONL 输出文件（编辑器用它显示步骤缩略图）")
    run_workflow.set_defaults(function=command_run_workflow)
    run_party_souls = subparsers.add_parser(
        "run-party-souls",
        help="mumu-0 发起御魂组队邀请，mumu-1 接受并协同刷 9999 次",
    )
    run_party_souls.add_argument("--leader-instance", default="mumu-0", help="队长实例 ID，默认 mumu-0")
    run_party_souls.add_argument("--member-instance", default="mumu-1", help="队员实例 ID，默认 mumu-1")
    run_party_souls.add_argument("--rounds", type=int, choices=(1, 9999), default=9999, help="运行 1 轮验证或连续运行 9999 轮")
    run_party_souls.add_argument("--leader-events-file", type=Path, help="可选的队长运行事件 JSONL 输出文件")
    run_party_souls.add_argument("--member-events-file", type=Path, help="可选的队员运行事件 JSONL 输出文件")
    run_party_souls.set_defaults(function=command_run_party_souls)
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
    subparsers.add_parser("list-instances").set_defaults(function=command_list_instances)
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
