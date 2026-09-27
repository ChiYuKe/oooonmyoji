"""stdio MCP entry point for the oooonmyoji template factory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Callable

from mcp.server import MCPServer
from mcp.types import CallToolResult, ImageContent, TextContent

from .approval import (
    CHANNEL_AUTO,
    CHANNELS,
    DEFAULT_TIMEOUT_SECONDS,
    MODE_ASK,
    MODES,
    RISK_DELETE,
    RISK_EXECUTE,
    RISK_READ,
    RISK_WRITE,
    ApprovalBroker,
)
from .files import FileError, ProjectFiles, summarize_payload
from .service import PROJECT_GUIDE, ProjectContextService


SERVER_NAME = "autoflow-template-factory"
SERVER_TITLE = "AutoFlow Studio 模板工厂"
# Mirrors the desktop shell version until the project publishes release tags.
SERVER_VERSION = "0.1.0"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
_project_root = PROJECT_ROOT
_config_path: Path | None = None
_service: ProjectContextService | None = None
_approval: ApprovalBroker | None = None

mcp = MCPServer(
    SERVER_NAME,
    title=SERVER_TITLE,
    version=SERVER_VERSION,
    instructions=PROJECT_GUIDE,
)


@mcp.tool()
def server_info() -> dict[str, Any]:
    """Return the MCP server mode and its current project boundary."""

    config_path = _config_path
    result: dict[str, Any] = {
        "server": SERVER_NAME,
        "transport": "stdio",
        "project_root": str(_project_root),
        "config": str(config_path) if config_path is not None else None,
        "write_scope": "workflows/generated/, assets/templates/generated/, plus approval-gated project writes",
        "device_read_tools_enabled": True,
        "execution_tools_enabled": True,
        "execution_requires_approval": True,
        "phase": "template-capture-and-generation",
    }
    result.update(_broker().info())
    if _service is not None:
        result.update(_service.info())
    return result


def _broker() -> ApprovalBroker:
    """Return the approval gate, creating it on first use."""

    global _approval
    if _approval is None:
        _approval = ApprovalBroker(project_root=_project_root, mode=MODE_ASK, timeout_seconds=DEFAULT_TIMEOUT_SECONDS)
    return _approval


def _files() -> ProjectFiles:
    service = _context()
    return ProjectFiles(service.project_root, log_dir=service.config.log_dir)


def _gate(*, tool: str, risk: str, summary: str, payload: dict[str, Any], allow_session: bool = True) -> CallToolResult | None:
    """Ask the human before a gated tool runs; return a refusal result if denied.

    The answer can only come from the local approval window, so the model cannot
    approve its own request.
    """

    broker = _broker()
    decision = broker.request(tool=tool, risk=risk, summary=summary, payload=payload, allow_session=allow_session)
    if decision.approved:
        return None
    return _structured_result(broker.denial_payload(decision, tool=tool, risk=risk))


def _files_result(operation: Callable[[], dict[str, Any]]) -> CallToolResult:
    try:
        return _structured_result(operation())
    except FileError as exc:
        return _structured_result(exc.payload())
    except Exception as exc:
        return _tool_error_result(exc)


def _context() -> ProjectContextService:
    global _service
    if _service is None:
        if _config_path is None:
            raise RuntimeError("MCP server has not been configured with a project config")
        _service = ProjectContextService(_config_path)
    return _service


def _tool_error(exc: Exception) -> dict[str, Any]:
    return {
        "ok": False,
        "error": str(exc),
        "error_type": type(exc).__name__,
    }


def _tool_error_result(exc: Exception) -> CallToolResult:
    payload = _tool_error(exc)
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False, indent=2))],
        structured_content=payload,
        is_error=True,
    )


def _structured_result(payload: dict[str, Any]) -> CallToolResult:
    """Wrap a tool payload and flag `ok: false` outcomes as tool errors.

    Refusals such as an existing target file or a failed validation report carry
    `ok: false` plus a machine readable `code`; flagging them keeps clients that
    only inspect `is_error` from mistaking a rejection for success.
    """

    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False, indent=2))],
        structured_content=payload,
        is_error=payload.get("ok") is False,
    )


def _image_tool_result(payload: dict[str, Any]) -> CallToolResult:
    image_base64 = payload.get("image_base64")
    metadata = {key: value for key, value in payload.items() if key != "image_base64"}
    if not isinstance(image_base64, str) or not image_base64:
        # Refusals such as an existing target file carry no image; keep the payload
        # instead of replacing it with a misleading "no image" error.
        return _structured_result(metadata)
    return CallToolResult(
        content=[
            TextContent(type="text", text=json.dumps(metadata, ensure_ascii=False, indent=2)),
            ImageContent(type="image", data=image_base64, mime_type="image/png"),
        ],
        structured_content=metadata,
        is_error=metadata.get("ok") is False,
    )


@mcp.tool()
def get_project_guide() -> str:
    """Return concise instructions for generating an oooonmyoji workflow."""

    return PROJECT_GUIDE


@mcp.resource("oooonmyoji://guide")
def project_guide_resource() -> str:
    """Expose the same project guide as a stable MCP resource."""

    return PROJECT_GUIDE


@mcp.tool()
def list_actions() -> CallToolResult:
    """List the available Actions and their input/output schemas."""

    try:
        return _structured_result(_context().list_actions())
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def get_action(action_name: str) -> CallToolResult:
    """Return one Action manifest by its registered name."""

    try:
        return _structured_result(_context().get_action(action_name))
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def list_workflows() -> CallToolResult:
    """List validated workflows with input definitions and node summaries."""

    try:
        return _structured_result(_context().list_workflows())
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def get_workflow(workflow: str) -> CallToolResult:
    """Return one validated workflow JSON by ID or relative path."""

    try:
        return _structured_result(_context().get_workflow(workflow))
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def list_assets() -> CallToolResult:
    """List image and other files below assets/templates."""

    try:
        return _structured_result(_context().list_assets())
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def capture_screen(instance_id: str = "mumu-0") -> CallToolResult:
    """Capture one configured device screen without sending input events.

    The image is returned as an MCP image block. The capture_id can be passed
    to create_template_asset after the model or user chooses an ROI.
    """

    try:
        return _image_tool_result(_context().capture_screen(instance_id))
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def create_template_asset(
    capture_id: str,
    roi: list[int],
    name: str,
    overwrite: bool = False,
) -> CallToolResult:
    """Crop a captured screen by [x, y, width, height] and save a PNG asset."""

    try:
        return _image_tool_result(_context().create_template_asset(capture_id, roi, name, overwrite))
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def select_roi(
    capture_id: str,
    reference_resolution: list[int] | None = None,
    timeout_seconds: int = 600,
) -> CallToolResult:
    """Open the project's visual ROI picker for a cached screenshot.

    This opens a local selection window and waits for the user to confirm a
    rectangle. It does not connect to a device or send device input events.
    """

    try:
        return _structured_result(_context().select_roi(capture_id, reference_resolution, timeout_seconds))
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def validate_workflow(workflow_json: dict[str, Any]) -> CallToolResult:
    """Validate a complete Behavior Tree v4 workflow without saving it."""

    try:
        return _structured_result(_context().validate_workflow(workflow_json))
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def save_workflow_template(
    workflow_json: dict[str, Any],
    name: str,
    description: str | None = None,
    overwrite: bool = False,
) -> CallToolResult:
    """Validate and save a workflow below workflows/generated/."""

    try:
        return _structured_result(_context().save_workflow(workflow_json, name, description, overwrite))
    except Exception as exc:
        return _tool_error_result(exc)


# --------------------------------------------------------------------------
# Approval-gated tools.
#
# These reach beyond the safe read-only scope: they drive the device, read files
# outside the asset catalogue, or modify the project.  Every one of them asks the
# human first through a local window that the model cannot answer; a timeout, a
# closed window or an unavailable display all count as "no".
# --------------------------------------------------------------------------


@mcp.tool()
def run_action(
    action_name: str,
    params: dict[str, Any] | None = None,
    instance_id: str = "mumu-0",
    reference_resolution: list[int] | None = None,
) -> CallToolResult:
    """Execute one Action against one instance after the user approves it.

    Use list_actions / get_action for the parameter schema. Coordinates are in the
    reference resolution (default 1920x1080). OCR-backed Actions (vision.ocr,
    vision.wait_text, vision.wait_any_text) and workflow.run are not available
    here; use run_workflow for whole workflows.
    """

    payload = {
        "action_name": action_name,
        "params": params or {},
        "instance_id": instance_id,
        "reference_resolution": reference_resolution,
    }
    denied = _gate(
        tool="run_action",
        risk=RISK_EXECUTE,
        summary=f"执行 Action {action_name} @ {instance_id}：{summarize_payload(params or {})}",
        payload=payload,
    )
    if denied is not None:
        return denied
    try:
        return _structured_result(
            _context().run_action(
                action_name,
                params,
                instance_id=instance_id,
                reference_resolution=reference_resolution,
            )
        )
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def tap(x: int, y: int, hold_ms: int = 0, instance_id: str = "mumu-0") -> CallToolResult:
    """Tap one point on the device screen after the user approves it."""

    payload = {"x": x, "y": y, "hold_ms": hold_ms, "instance_id": instance_id}
    denied = _gate(
        tool="tap",
        risk=RISK_EXECUTE,
        summary=f"点击 ({x}, {y}){'，按住 ' + str(hold_ms) + 'ms' if hold_ms else ''} @ {instance_id}",
        payload=payload,
    )
    if denied is not None:
        return denied
    try:
        return _structured_result(
            _context().run_action("input.tap", {"x": x, "y": y, "hold_ms": hold_ms}, instance_id=instance_id)
        )
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def swipe(
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    duration_ms: int = 300,
    instance_id: str = "mumu-0",
) -> CallToolResult:
    """Swipe from one point to another after the user approves it."""

    payload = {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "duration_ms": duration_ms, "instance_id": instance_id}
    denied = _gate(
        tool="swipe",
        risk=RISK_EXECUTE,
        summary=f"从 ({x1}, {y1}) 滑动到 ({x2}, {y2})，用时 {duration_ms}ms @ {instance_id}",
        payload=payload,
    )
    if denied is not None:
        return denied
    try:
        return _structured_result(
            _context().run_action(
                "input.swipe",
                {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "duration_ms": duration_ms},
                instance_id=instance_id,
            )
        )
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def press_key(keycode: str, instance_id: str = "mumu-0") -> CallToolResult:
    """Press one device key after the user approves it."""

    payload = {"keycode": keycode, "instance_id": instance_id}
    denied = _gate(
        tool="press_key",
        risk=RISK_EXECUTE,
        summary=f"按键 {keycode} @ {instance_id}",
        payload=payload,
    )
    if denied is not None:
        return denied
    try:
        return _structured_result(_context().run_action("input.key", {"keycode": keycode}, instance_id=instance_id))
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def type_text(text: str, instance_id: str = "mumu-0") -> CallToolResult:
    """Type text into the device after the user approves it."""

    payload = {"text": text, "instance_id": instance_id}
    denied = _gate(
        tool="type_text",
        risk=RISK_EXECUTE,
        summary=f"输入文本 {text!r} @ {instance_id}",
        payload=payload,
    )
    if denied is not None:
        return denied
    try:
        return _structured_result(_context().run_action("input.type_text", {"text": text}, instance_id=instance_id))
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def run_workflow(
    workflow: str,
    instance_id: str = "mumu-0",
    inputs: dict[str, Any] | None = None,
    timeout_seconds: int = 1800,
) -> CallToolResult:
    """Run an existing workflow end to end after the user approves it.

    This is the only reliable way to verify a generated workflow: it uses the
    project's own CLI (supervisor + worker + OCR pool), writes run records and an
    events file, and returns the failure node, the breadcrumb and the last steps.
    """

    payload = {
        "workflow": workflow,
        "instance_id": instance_id,
        "inputs": inputs or {},
        "timeout_seconds": timeout_seconds,
    }
    denied = _gate(
        tool="run_workflow",
        risk=RISK_EXECUTE,
        summary=f"运行工作流 {workflow} @ {instance_id}（最长 {timeout_seconds}s）",
        payload=payload,
    )
    if denied is not None:
        return denied
    try:
        return _structured_result(
            _context().run_workflow(
                workflow,
                instance_id=instance_id,
                inputs=inputs,
                timeout_seconds=timeout_seconds,
            )
        )
    except Exception as exc:
        return _tool_error_result(exc)


@mcp.tool()
def read_project_file(path: str, max_bytes: int = 200000) -> CallToolResult:
    """Read a UTF-8 project file (source, log or run artifact) after approval.

    Paths must stay inside the project root. .git/ and .venv/ are readable but
    never writable.
    """

    denied = _gate(
        tool="read_project_file",
        risk=RISK_READ,
        summary=f"读取项目文件 {path}（最多 {max_bytes} 字节）",
        payload={"path": path, "max_bytes": max_bytes},
    )
    if denied is not None:
        return denied
    return _files_result(lambda: _files().read_text(path, max_bytes=max_bytes))


@mcp.tool()
def list_artifacts(subdir: str | None = None, limit: int = 50) -> CallToolResult:
    """List run artifacts (screenshots, records, events) after approval."""

    denied = _gate(
        tool="list_artifacts",
        risk=RISK_READ,
        summary=f"列出运行产物 artifacts/{subdir or ''}（最多 {limit} 条）",
        payload={"subdir": subdir, "limit": limit},
    )
    if denied is not None:
        return denied
    return _files_result(lambda: _files().list_artifacts(subdir=subdir, limit=limit))


@mcp.tool()
def tail_log(name: str | None = None, lines: int = 200) -> CallToolResult:
    """Read the tail of the newest project log (or a named log) after approval."""

    denied = _gate(
        tool="tail_log",
        risk=RISK_READ,
        summary=f"读取日志 {name or '最新日志'} 末尾 {lines} 行",
        payload={"name": name, "lines": lines},
    )
    if denied is not None:
        return denied
    return _files_result(lambda: _files().tail_log(name=name, lines=lines))


@mcp.tool()
def write_project_file(path: str, content: str, overwrite: bool = False) -> CallToolResult:
    """Write a UTF-8 project file after approval, with an automatic backup.

    .git/, .venv/ and the approval state directory are refused outright; an
    existing file is copied into artifacts/mcp-backups/ before it is replaced.
    """

    payload = {"path": path, "content": content, "overwrite": overwrite}
    denied = _gate(
        tool="write_project_file",
        risk=RISK_WRITE,
        summary=f"写入 {path}（{len(content)} 字符，overwrite={overwrite}）",
        payload=payload,
    )
    if denied is not None:
        return denied
    return _files_result(lambda: _files().write_text(path, content, overwrite=overwrite))


@mcp.tool()
def delete_project_file(path: str) -> CallToolResult:
    """Delete one project file after approval, keeping a backup first."""

    denied = _gate(
        tool="delete_project_file",
        risk=RISK_DELETE,
        summary=f"删除文件 {path}",
        payload={"path": path},
    )
    if denied is not None:
        return denied
    return _files_result(lambda: _files().delete(path))


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Optional project configuration JSON path.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=None,
        help="Optional project root; defaults to the repository root.",
    )
    parser.add_argument(
        "--approval",
        choices=MODES,
        default=MODE_ASK,
        help="How gated tools get approval: ask (default), deny (refuse all), allow (trusted local use).",
    )
    parser.add_argument(
        "--approval-channel",
        choices=CHANNELS,
        default=CHANNEL_AUTO,
        help="Where 'ask' is answered: auto (desktop window when it is running, else the standalone window), desktop, window.",
    )
    parser.add_argument(
        "--approval-timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Seconds to wait for a human answer before denying (default {DEFAULT_TIMEOUT_SECONDS:.0f}).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Start the server over stdio.

    MCP hosts launch this module as a child process and own stdin/stdout.
    Do not print application logs to stdout because stdout is the protocol
    channel.
    """

    global _approval, _config_path, _project_root, _service
    args = _parse_args(argv)
    _project_root = (args.project_root or PROJECT_ROOT).resolve()
    _config_path = (
        args.config.resolve()
        if args.config is not None
        else next(
            (
                candidate.resolve()
                for candidate in (
                    _project_root / "config" / "config.json",
                    _project_root / "config" / "config.example.json",
                )
                if candidate.is_file()
            ),
            None,
        )
    )
    _service = None
    _approval = ApprovalBroker(
        project_root=_project_root,
        mode=args.approval,
        channel=args.approval_channel,
        timeout_seconds=max(5.0, float(args.approval_timeout)),
    )
    mcp.run()


if __name__ == "__main__":
    main()
