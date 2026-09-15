"""Project context and safe screenshot/template operations for the MCP factory."""

from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from base64 import b64encode
from copy import deepcopy
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from ..actions import build_action_registry
from ..config.loader import load_config
from ..devices.factory import connect_at_task_boundary
from ..exceptions import ConfigError
from ..runtime.instances import ensure_runtime_instance, expand_runtime_instances
from ..vision.image import frame_to_bgr
from ..workflows.loader import WorkflowLoader
from ..workflows.validator import WORKFLOW_SCHEMA, validate_workflow


PROJECT_GUIDE = """# oooonmyoji MCP 模板工厂

当前阶段提供项目上下文、只读设备截图、ROI 图片模板生成、工作流校验和受控保存。
截图只读取当前画面，不执行点击、滑动、输入或工作流运行。

工作流必须使用 Behavior Tree schema v4。生成工作流前应先查询 Action 清单、
已有工作流和图片资源；需要新图片时先调用 capture_screen，再用 select_roi 打开项目
自带的框选窗口（或直接提供 ROI），然后用 create_template_asset 按截图实际像素 ROI
生成 PNG，最后使用 validate_workflow 校验完整 JSON。

工作流目录：workflows/
图片模板目录：assets/templates/
生成模板的目标目录：workflows/generated/
新增图片模板的目标目录：assets/templates/generated/

当前可用能力：读取项目说明、Action manifest、工作流 JSON 和图片资源清单，
读取指定实例截图，按 ROI 保存图片模板，校验工作流，并将有效工作流保存到受控目录。
"""

MAX_WORKFLOW_BYTES = 512 * 1024
WORKFLOW_NAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
TEMPLATE_NAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
MAX_CAPTURE_BYTES = 16 * 1024 * 1024
MAX_CAPTURE_CACHE = 4
MAX_TEMPLATE_BYTES = 8 * 1024 * 1024
ROI_EDITOR_TIMEOUT_SECONDS = 10 * 60


class ProjectContextService:
    """Expose project metadata without starting the automation runtime."""

    def __init__(self, config_path: Path | str) -> None:
        self.config_path = Path(config_path).resolve()
        self.config = load_config(self.config_path)
        self.registry = build_action_registry(self.config.action_dir)
        self.loader = WorkflowLoader(
            self.config.workflow_dir,
            self.registry,
            project_root=self.config.root_dir,
        )
        self.asset_root = (self.config.root_dir / "assets" / "templates").resolve()
        self._captures: dict[str, dict[str, Any]] = {}
        self._capture_order: list[str] = []

    @property
    def project_root(self) -> Path:
        return self.config.root_dir

    def _relative(self, path: Path) -> str:
        """Return a project-relative POSIX path for an in-project file."""

        return path.resolve().relative_to(self.project_root).as_posix()

    def info(self) -> dict[str, Any]:
        return {
            "project_root": str(self.project_root),
            "config": self._relative(self.config_path)
            if self.config_path.is_relative_to(self.project_root)
            else str(self.config_path),
            "workflow_dir": self._relative(self.config.workflow_dir),
            "asset_dir": self._relative(self.asset_root),
            "write_scope": "workflows/generated/ and assets/templates/generated/",
            "device_read_tools_enabled": True,
            "execution_tools_enabled": False,
            "phase": "template-capture-and-generation",
        }

    def list_actions(self) -> dict[str, Any]:
        actions: list[dict[str, Any]] = []
        for spec in self.registry.specs():
            actions.append(
                {
                    "name": spec.name,
                    "version": spec.version,
                    "description": spec.description,
                    "input_schema": spec.input_schema,
                    "output_schema": spec.output_schema,
                    "retry_safe": spec.retry_safe,
                    "side_effect": spec.side_effect,
                    "source": self._relative(Path(spec.source))
                    if Path(spec.source).is_relative_to(self.project_root)
                    else spec.source,
                }
            )
        return {"actions": actions, "count": len(actions)}

    def get_action(self, action_name: str) -> dict[str, Any]:
        spec = self.registry.get(action_name)
        return {
            "name": spec.name,
            "version": spec.version,
            "description": spec.description,
            "input_schema": spec.input_schema,
            "output_schema": spec.output_schema,
            "retry_safe": spec.retry_safe,
            "side_effect": spec.side_effect,
            "source": self._relative(Path(spec.source))
            if Path(spec.source).is_relative_to(self.project_root)
            else spec.source,
        }

    def list_workflows(self) -> dict[str, Any]:
        workflows = self.loader.discover()
        values: list[dict[str, Any]] = []
        for workflow_id, spec in sorted(workflows.items()):
            values.append(
                {
                    "id": workflow_id,
                    "version": spec.version,
                    "description": spec.description,
                    "path": self._relative(spec.path),
                    "file_hash": spec.file_hash,
                    "resolution": list(spec.resolution),
                    "inputs": spec.raw.get("inputs", {}),
                    "variables": spec.raw.get("variables", {}),
                    "nodes": [
                        {
                            "id": node.id,
                            "type": node.type,
                            "name": node.name,
                            "action": node.action,
                            "children": list(node.children),
                        }
                        for node in spec.nodes
                    ],
                }
            )
        return {"workflows": values, "count": len(values)}

    def get_workflow(self, workflow: str) -> dict[str, Any]:
        spec = self.loader.load(workflow)
        return {
            "id": spec.workflow_id,
            "version": spec.version,
            "path": self._relative(spec.path),
            "file_hash": spec.file_hash,
            "workflow": spec.raw,
        }

    @staticmethod
    def _image_dimensions(path: Path) -> list[int] | None:
        """Read dimensions for PNG assets without adding an image dependency."""

        try:
            payload = path.read_bytes()
        except OSError:
            return None
        if len(payload) >= 24 and payload[:8] == b"\x89PNG\r\n\x1a\n":
            width = int.from_bytes(payload[16:20], "big")
            height = int.from_bytes(payload[20:24], "big")
            if width > 0 and height > 0:
                return [width, height]
        return None

    def list_assets(self) -> dict[str, Any]:
        if not self.asset_root.is_dir():
            return {"assets": [], "count": 0, "root": self._relative(self.asset_root)}

        assets: list[dict[str, Any]] = []
        for path in sorted(self.asset_root.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            try:
                relative_to_assets = path.resolve().relative_to(self.asset_root)
                relative_to_project = path.resolve().relative_to(self.project_root)
                size = path.stat().st_size
            except (OSError, ValueError):
                continue
            parts = relative_to_assets.parts
            assets.append(
                {
                    "path": relative_to_project.as_posix(),
                    "kind": path.suffix.lower().lstrip(".") or "file",
                    "size_bytes": size,
                    "dimensions": self._image_dimensions(path)
                    if path.suffix.lower() == ".png"
                    else None,
                    "category": parts[0] if parts else "",
                }
            )
        return {"root": self._relative(self.asset_root), "assets": assets, "count": len(assets)}

    @staticmethod
    def _encode_png(image: Any) -> bytes:
        try:
            import cv2
        except ImportError as exc:  # pragma: no cover - declared runtime dependency
            raise ConfigError("OpenCV and numpy are required for device image capture") from exc
        try:
            encoded, payload = cv2.imencode(".png", image.copy())
        except (AttributeError, cv2.error) as exc:
            raise ConfigError("unable to encode device screenshot as PNG") from exc
        if not encoded:
            raise ConfigError("unable to encode device screenshot as PNG")
        return payload.tobytes()

    def _remember_capture(self, capture_id: str, snapshot: dict[str, Any]) -> None:
        self._captures[capture_id] = snapshot
        self._capture_order.append(capture_id)
        while len(self._capture_order) > MAX_CAPTURE_CACHE:
            expired = self._capture_order.pop(0)
            self._captures.pop(expired, None)

    def capture_screen(self, instance_id: str = "mumu-0") -> dict[str, Any]:
        """Capture one device frame without sending any input event."""

        if not isinstance(instance_id, str) or not instance_id.strip():
            raise ValueError("instance_id must be a non-empty string")
        runtime_config = expand_runtime_instances(self.config)
        runtime_config = ensure_runtime_instance(runtime_config, instance_id)
        try:
            instance = runtime_config.instance(instance_id)
        except StopIteration as exc:
            raise ConfigError(f"unknown runtime instance: {instance_id}") from exc
        if not instance.enabled:
            raise ConfigError(f"runtime instance is disabled: {instance_id}")

        device = None
        try:
            device, used_adb = connect_at_task_boundary(
                runtime_config,
                instance,
                attempts=runtime_config.retry.connection_attempts,
                base_delay_seconds=runtime_config.retry.base_delay_seconds,
                max_delay_seconds=runtime_config.retry.max_delay_seconds,
            )
            image = frame_to_bgr(device.capture()).copy()
            height, width = image.shape[:2]
            if width < 1 or height < 1:
                raise ConfigError("device screenshot has invalid dimensions")
            png_bytes = self._encode_png(image)
            if len(png_bytes) > MAX_CAPTURE_BYTES:
                raise ConfigError(f"device screenshot exceeds {MAX_CAPTURE_BYTES} bytes")
        finally:
            if device is not None:
                try:
                    device.close()
                except Exception:
                    pass

        capture_id = secrets.token_urlsafe(18)
        snapshot = {
            "png_bytes": png_bytes,
            "width": int(width),
            "height": int(height),
            "instance": instance_id,
            "backend": "adb" if used_adb else "mumu",
        }
        self._remember_capture(capture_id, snapshot)
        return {
            "capture_id": capture_id,
            "instance": instance_id,
            "backend": snapshot["backend"],
            "width": int(width),
            "height": int(height),
            "reference_resolution": [int(width), int(height)],
            "image_base64": b64encode(png_bytes).decode("ascii"),
        }

    def _template_target(self, name: str) -> tuple[str, Path]:
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name must be a non-empty string")
        value = name.strip().replace("\\", "/")
        if value.lower().endswith(".png"):
            value = value[:-4]
        if TEMPLATE_NAME_PATTERN.fullmatch(value) is None:
            raise ValueError("name must match [a-z0-9][a-z0-9_-]{0,63} and may end with .png")
        generated_dir = (self.asset_root / "generated").resolve()
        try:
            generated_dir.relative_to(self.asset_root)
            generated_dir.relative_to(self.project_root)
        except ValueError as exc:
            raise ConfigError("generated asset directory must stay below the project root") from exc
        target = (generated_dir / f"{value}.png").resolve()
        try:
            target.relative_to(generated_dir)
            target.relative_to(self.asset_root)
        except ValueError as exc:
            raise ConfigError("generated asset path is invalid") from exc
        return f"assets/templates/generated/{value}.png", target

    @staticmethod
    def _validate_roi(roi: Any, width: int, height: int) -> list[int]:
        if not isinstance(roi, (list, tuple)) or len(roi) != 4:
            raise ValueError("roi must contain x, y, width, height")
        values: list[int] = []
        for value in roi:
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError("roi values must be integers")
            values.append(value)
        x, y, roi_width, roi_height = values
        if x < 0 or y < 0 or roi_width < 1 or roi_height < 1:
            raise ValueError("roi must have non-negative origin and positive size")
        if x + roi_width > width or y + roi_height > height:
            raise ValueError(f"roi is outside screenshot: {values}, screenshot={width}x{height}")
        return values

    @staticmethod
    def _validate_reference_resolution(value: Any, default: list[int]) -> list[int]:
        if value is None:
            return default
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            raise ValueError("reference_resolution must contain width and height")
        result: list[int] = []
        for item in value:
            if isinstance(item, bool) or not isinstance(item, int) or item < 1:
                raise ValueError("reference_resolution values must be positive integers")
            result.append(item)
        return result

    def select_roi(
        self,
        capture_id: str,
        reference_resolution: list[int] | None = None,
        timeout_seconds: int = ROI_EDITOR_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        """Open the existing ROI picker against a cached screenshot."""

        if not isinstance(capture_id, str) or not capture_id.strip():
            raise ValueError("capture_id must be a non-empty string")
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, int) or timeout_seconds < 30:
            raise ValueError("timeout_seconds must be an integer >= 30")
        snapshot = self._captures.get(capture_id)
        if snapshot is None:
            raise ValueError("capture_id is unknown or has expired; call capture_screen again")
        reference = self._validate_reference_resolution(
            reference_resolution,
            [snapshot["width"], snapshot["height"]],
        )

        with tempfile.TemporaryDirectory(prefix="oooonmyoji-mcp-roi-") as temporary_dir:
            temporary_root = Path(temporary_dir)
            image_path = temporary_root / "capture.png"
            result_path = temporary_root / "selection.json"
            image_path.write_bytes(snapshot["png_bytes"])
            command = [
                sys.executable,
                "-m",
                "src.oooonmyoji.tools.roi_editor",
                "--image",
                str(image_path),
                "--select-roi",
                "--result-file",
                str(result_path),
                "--reference-width",
                str(reference[0]),
                "--reference-height",
                str(reference[1]),
            ]
            try:
                completed = subprocess.run(
                    command,
                    cwd=str(self.project_root),
                    capture_output=True,
                    text=True,
                    timeout=timeout_seconds,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise ConfigError(f"ROI 选择窗口超过 {timeout_seconds} 秒未完成") from exc
            except OSError as exc:
                raise ConfigError(f"无法启动 ROI 选择工具: {exc}") from exc
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout or "ROI 选择工具退出失败").strip()
                raise ConfigError(detail[-2000:])
            if not result_path.is_file():
                raise ValueError("ROI 选择已取消或未确认；请在窗口中框选并确认")
            try:
                result = json.loads(result_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ConfigError("ROI 选择工具返回了无效结果") from exc
            if not isinstance(result, dict):
                raise ConfigError("ROI 选择工具返回的结果不是对象")
            image_rect = self._validate_roi(
                result.get("image_rect"),
                snapshot["width"],
                snapshot["height"],
            )
            reference_rect = result.get("reference_rect")
            if not isinstance(reference_rect, list) or len(reference_rect) != 4:
                raise ConfigError("ROI 选择工具未返回有效 reference_rect")
            if any(isinstance(item, bool) or not isinstance(item, int) for item in reference_rect):
                raise ConfigError("ROI 选择工具返回的 reference_rect 必须是整数")

        return {
            "ok": True,
            "selected": True,
            "capture_id": capture_id,
            "source_instance": snapshot["instance"],
            "image_rect": image_rect,
            "reference_rect": reference_rect,
            "image_size": [snapshot["width"], snapshot["height"]],
            "reference_resolution": reference,
        }

    @staticmethod
    def _atomic_write_bytes(target: Path, payload: bytes) -> None:
        temporary_path: Path | None = None
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=f".{target.stem}.",
                suffix=".tmp",
                dir=target.parent,
                delete=False,
            ) as temporary:
                temporary.write(payload)
                temporary.flush()
                os.fsync(temporary.fileno())
                temporary_path = Path(temporary.name)
            os.replace(temporary_path, target)
        except OSError:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
            raise

    def create_template_asset(
        self,
        capture_id: str,
        roi: list[int],
        name: str,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Crop an in-memory capture and save it below assets/templates/generated/."""

        if not isinstance(capture_id, str) or not capture_id.strip():
            raise ValueError("capture_id must be a non-empty string")
        if not isinstance(overwrite, bool):
            raise ValueError("overwrite must be a boolean")
        snapshot = self._captures.get(capture_id)
        if snapshot is None:
            raise ValueError("capture_id is unknown or has expired; call capture_screen again")

        try:
            import cv2
            import numpy as np
        except ImportError as exc:  # pragma: no cover - declared runtime dependency
            raise ConfigError("OpenCV and numpy are required for template asset generation") from exc
        encoded = np.frombuffer(snapshot["png_bytes"], dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise ConfigError("stored device screenshot is unreadable")
        values = self._validate_roi(roi, int(image.shape[1]), int(image.shape[0]))
        x, y, width, height = values
        cropped = image[y : y + height, x : x + width].copy()
        png_bytes = self._encode_png(cropped)
        if len(png_bytes) > MAX_TEMPLATE_BYTES:
            raise ConfigError(f"template asset exceeds {MAX_TEMPLATE_BYTES} bytes")

        relative_path, target = self._template_target(name)
        if target.exists() and not overwrite:
            return {
                "ok": False,
                "saved": False,
                "error": "asset already exists",
                "code": "file_exists",
                "path": relative_path,
            }
        try:
            self._atomic_write_bytes(target, png_bytes)
        except OSError as exc:
            return {
                "ok": False,
                "saved": False,
                "error": f"unable to save template asset: {exc}",
                "code": "write_failed",
                "path": relative_path,
            }
        return {
            "ok": True,
            "saved": True,
            "path": relative_path,
            "capture_id": capture_id,
            "source_instance": snapshot["instance"],
            "roi": values,
            "dimensions": [width, height],
            "reference_resolution": [snapshot["width"], snapshot["height"]],
            "size_bytes": len(png_bytes),
            "image_base64": b64encode(png_bytes).decode("ascii"),
        }

    @staticmethod
    def _schema_path(path: Any) -> str:
        result = "workflow"
        for item in path:
            if isinstance(item, int):
                result += f"[{item}]"
            else:
                result += f".{item}"
        return result

    @staticmethod
    def _error_code(message: str) -> str:
        lowered = message.lower()
        if "does not exist" in lowered and "template" in lowered:
            return "asset_not_found"
        if "escapes" in lowered or "must stay below" in lowered:
            return "path_outside_project"
        if "unknown action" in lowered:
            return "unknown_action"
        if "duplicate" in lowered:
            return "duplicate_id"
        if "reference" in lowered or "binding" in lowered:
            return "invalid_reference"
        if "input" in lowered or "variable" in lowered:
            return "input_or_variable_error"
        if "node" in lowered or "root" in lowered or "child" in lowered:
            return "tree_structure_error"
        return "validation_error"

    @classmethod
    def _semantic_error(cls, exc: Exception) -> dict[str, str]:
        message = str(exc)
        node_match = re.search(r"nodes\[\d+\](?:\.[A-Za-z0-9_.\[\]-]+)?", message)
        path = node_match.group(0) if node_match else "workflow"
        return {
            "path": path,
            "code": cls._error_code(message),
            "message": message,
        }

    def _referenced_assets(self, raw: dict[str, Any]) -> list[dict[str, Any]]:
        references: list[tuple[str, str]] = []
        nodes = raw.get("nodes", [])
        if isinstance(nodes, list):
            for index, node in enumerate(nodes):
                if not isinstance(node, dict):
                    continue
                params = node.get("params")
                if not isinstance(params, dict):
                    continue
                template = params.get("template")
                if isinstance(template, str):
                    references.append((template, f"nodes[{index}].params.template"))

        inputs = raw.get("inputs", {})
        if isinstance(inputs, dict):
            for name, definition in inputs.items():
                if not isinstance(definition, dict) or not isinstance(definition.get("default"), str):
                    continue
                if definition.get("type") in {"asset", "path"}:
                    references.append((definition["default"], f"inputs.{name}.default"))

        result: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for value, source in references:
            key = (value, source)
            if key in seen:
                continue
            seen.add(key)
            candidate = Path(value)
            try:
                resolved = candidate.resolve() if candidate.is_absolute() else (self.project_root / candidate).resolve()
                resolved.relative_to(self.project_root)
            except (OSError, ValueError):
                result.append({"path": value, "source": source, "exists": False})
                continue
            result.append(
                {
                    "path": self._relative(resolved),
                    "source": source,
                    "exists": resolved.is_file(),
                }
            )
        return result

    def validate_workflow(self, raw: Any) -> dict[str, Any]:
        """Validate a workflow using the runtime's schema and semantic checks."""

        if not isinstance(raw, dict):
            return {
                "ok": False,
                "errors": [{
                    "path": "workflow",
                    "code": "schema_error",
                    "message": "workflow must be a JSON object",
                }],
                "warnings": [],
                "referenced_assets": [],
            }

        referenced_assets = self._referenced_assets(raw)
        schema_errors = sorted(
            Draft202012Validator(WORKFLOW_SCHEMA).iter_errors(raw),
            key=lambda error: tuple(str(part) for part in error.absolute_path),
        )
        if schema_errors:
            return {
                "ok": False,
                "errors": [
                    {
                        "path": self._schema_path(error.absolute_path),
                        "code": "schema_error",
                        "message": error.message,
                    }
                    for error in schema_errors
                ],
                "warnings": [],
                "referenced_assets": referenced_assets,
            }

        validation_path = self.config.workflow_dir / "__mcp_validation__.json"
        try:
            spec = validate_workflow(
                raw,
                validation_path,
                self.registry,
                project_root=self.project_root,
                workflow_dir=self.config.workflow_dir,
            )
            self.loader.validate_paths(spec)
            default_inputs = {
                name: definition["default"]
                for name, definition in raw.get("inputs", {}).items()
                if isinstance(definition, dict) and "default" in definition
            }
            self.loader.validate_input_paths(spec, default_inputs)
        except (ConfigError, OSError, ValueError) as exc:
            return {
                "ok": False,
                "errors": [self._semantic_error(exc)],
                "warnings": [],
                "referenced_assets": referenced_assets,
            }

        return {
            "ok": True,
            "errors": [],
            "warnings": [],
            "referenced_assets": referenced_assets,
            "workflow": {
                "id": spec.workflow_id,
                "version": spec.version,
                "node_count": len(spec.nodes),
                "resolution": list(spec.resolution),
            },
        }

    def save_workflow(
        self,
        raw: Any,
        name: str,
        description: str | None = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """Validate and atomically save a generated workflow template."""

        if not isinstance(name, str) or WORKFLOW_NAME_PATTERN.fullmatch(name) is None:
            return {
                "ok": False,
                "saved": False,
                "errors": [{
                    "path": "name",
                    "code": "invalid_name",
                    "message": "name must match [a-z0-9][a-z0-9_-]{0,63}",
                }],
                "warnings": [],
            }
        if description is not None and not isinstance(description, str):
            return {
                "ok": False,
                "saved": False,
                "errors": [{
                    "path": "description",
                    "code": "invalid_description",
                    "message": "description must be a string or null",
                }],
                "warnings": [],
            }
        if not isinstance(overwrite, bool):
            return {
                "ok": False,
                "saved": False,
                "errors": [{
                    "path": "overwrite",
                    "code": "invalid_overwrite",
                    "message": "overwrite must be a boolean",
                }],
                "warnings": [],
            }
        if not isinstance(raw, dict):
            validation = self.validate_workflow(raw)
            validation["saved"] = False
            return validation

        candidate = deepcopy(raw)
        if description is not None:
            candidate["description"] = description
        validation = self.validate_workflow(candidate)
        if not validation.get("ok", False):
            validation["saved"] = False
            return validation

        payload = json.dumps(candidate, ensure_ascii=False, indent=2) + "\n"
        payload_bytes = payload.encode("utf-8")
        if len(payload_bytes) > MAX_WORKFLOW_BYTES:
            return {
                "ok": False,
                "saved": False,
                "errors": [{
                    "path": "workflow",
                    "code": "workflow_too_large",
                    "message": f"workflow JSON exceeds {MAX_WORKFLOW_BYTES} bytes",
                }],
                "warnings": [],
                "workflow": validation.get("workflow", {}),
            }

        generated_dir = (self.config.workflow_dir / "generated").resolve()
        try:
            generated_dir.relative_to(self.project_root)
        except ValueError:
            return {
                "ok": False,
                "saved": False,
                "errors": [{
                    "path": "workflows/generated",
                    "code": "path_outside_project",
                    "message": "generated workflow directory must stay below the project root",
                }],
                "warnings": [],
            }

        target = generated_dir / f"{name}.json"
        if target.exists() and not overwrite:
            return {
                "ok": False,
                "saved": False,
                "errors": [{
                    "path": "name",
                    "code": "file_exists",
                    "message": f"workflow template already exists: {self._relative(target)}",
                }],
                "warnings": [],
                "path": self._relative(target),
            }

        temporary_path: Path | None = None
        try:
            generated_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=f".{name}.",
                suffix=".tmp",
                dir=generated_dir,
                delete=False,
            ) as temporary:
                temporary.write(payload_bytes)
                temporary.flush()
                os.fsync(temporary.fileno())
                temporary_path = Path(temporary.name)
            os.replace(temporary_path, target)
        except OSError as exc:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
            return {
                "ok": False,
                "saved": False,
                "errors": [{
                    "path": self._relative(target),
                    "code": "write_failed",
                    "message": f"unable to save workflow template: {exc}",
                }],
                "warnings": [],
            }

        return {
            "ok": True,
            "saved": True,
            "path": self._relative(target),
            "workflow_id": candidate.get("id"),
            "version": candidate.get("version"),
            "validation": validation,
        }


__all__ = ["PROJECT_GUIDE", "ProjectContextService"]
