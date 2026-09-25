"""stdio MCP entry point for the oooonmyoji template factory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from mcp.server import MCPServer
from mcp_types import CallToolResult, ImageContent, TextContent

from .service import PROJECT_GUIDE, ProjectContextService


SERVER_NAME = "autoflow-template-factory"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
_project_root = PROJECT_ROOT
_config_path: Path | None = None
_service: ProjectContextService | None = None

mcp = MCPServer(SERVER_NAME)


@mcp.tool()
def server_info() -> dict[str, Any]:
    """Return the MCP server mode and its current project boundary."""

    config_path = _config_path
    result: dict[str, Any] = {
        "server": SERVER_NAME,
        "transport": "stdio",
        "project_root": str(_project_root),
        "config": str(config_path) if config_path is not None else None,
        "write_scope": "workflows/generated/ and assets/templates/generated/",
        "device_read_tools_enabled": True,
        "execution_tools_enabled": False,
        "phase": "template-capture-and-generation",
    }
    if _service is not None:
        result.update(_service.info())
    return result


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


def _image_tool_result(payload: dict[str, Any]) -> CallToolResult:
    image_base64 = payload.get("image_base64")
    if not isinstance(image_base64, str) or not image_base64:
        raise ValueError("image tool result did not contain image_base64")
    metadata = {key: value for key, value in payload.items() if key != "image_base64"}
    return CallToolResult(
        content=[
            TextContent(type="text", text=json.dumps(metadata, ensure_ascii=False, indent=2)),
            ImageContent(type="image", data=image_base64, mime_type="image/png"),
        ],
        structured_content=metadata,
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
def list_actions() -> dict[str, Any]:
    """List the available Actions and their input/output schemas."""

    try:
        return _context().list_actions()
    except Exception as exc:
        return _tool_error(exc)


@mcp.tool()
def get_action(action_name: str) -> dict[str, Any]:
    """Return one Action manifest by its registered name."""

    try:
        return _context().get_action(action_name)
    except Exception as exc:
        return _tool_error(exc)


@mcp.tool()
def list_workflows() -> dict[str, Any]:
    """List validated workflows with input definitions and node summaries."""

    try:
        return _context().list_workflows()
    except Exception as exc:
        return _tool_error(exc)


@mcp.tool()
def get_workflow(workflow: str) -> dict[str, Any]:
    """Return one validated workflow JSON by ID or relative path."""

    try:
        return _context().get_workflow(workflow)
    except Exception as exc:
        return _tool_error(exc)


@mcp.tool()
def list_assets() -> dict[str, Any]:
    """List image and other files below assets/templates."""

    try:
        return _context().list_assets()
    except Exception as exc:
        return _tool_error(exc)


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
) -> dict[str, Any]:
    """Open the project's visual ROI picker for a cached screenshot.

    This opens a local selection window and waits for the user to confirm a
    rectangle. It does not connect to a device or send device input events.
    """

    try:
        return _context().select_roi(capture_id, reference_resolution, timeout_seconds)
    except Exception as exc:
        return _tool_error(exc)


@mcp.tool()
def validate_workflow(workflow_json: dict[str, Any]) -> dict[str, Any]:
    """Validate a complete Behavior Tree v4 workflow without saving it."""

    try:
        return _context().validate_workflow(workflow_json)
    except Exception as exc:
        return _tool_error(exc)


@mcp.tool()
def save_workflow_template(
    workflow_json: dict[str, Any],
    name: str,
    description: str | None = None,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Validate and save a workflow below workflows/generated/."""

    try:
        return _context().save_workflow(workflow_json, name, description, overwrite)
    except Exception as exc:
        return _tool_error(exc)


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
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Start the server over stdio.

    MCP hosts launch this module as a child process and own stdin/stdout.
    Do not print application logs to stdout because stdout is the protocol
    channel.
    """

    global _config_path, _project_root, _service
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
    mcp.run()


if __name__ == "__main__":
    main()
