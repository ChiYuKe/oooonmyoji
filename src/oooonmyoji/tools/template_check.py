"""Capture one frame and run the production template matcher for editor diagnostics."""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Any, Sequence

from ..config import load_config
from ..devices.coordinates import CoordinateMapper, Rect
from ..devices.factory import connect_at_task_boundary
from ..devices.protocol import DeviceFrame
from ..exceptions import AutomationError, VisionError
from ..runtime.instances import ensure_runtime_instance, expand_runtime_instances
from ..vision.template import TemplateMatcher


def _read_image(path: Path) -> Any:
    try:
        import cv2
        import numpy as np
    except ImportError as exc:  # pragma: no cover - declared runtime dependencies
        raise VisionError("OpenCV and numpy are required for template checks") from exc
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise VisionError(f"unable to read image: {path}") from exc
    image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise VisionError(f"image is unreadable: {path}")
    return image


def _encode_png_base64(image: Any) -> str:
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - declared runtime dependency
        raise VisionError("OpenCV is required for template checks") from exc
    encoded, payload = cv2.imencode(".png", image)
    if not encoded:
        raise VisionError("unable to encode template check frame")
    return base64.b64encode(payload.tobytes()).decode("ascii")


def resolve_template_path(project_root: Path, template: str) -> Path:
    root = project_root.resolve()
    candidate = Path(template)
    resolved = candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("template path must stay below the project root") from exc
    if not resolved.is_file():
        raise VisionError(f"template image does not exist: {template}")
    return resolved


def check_image(
    image: Any,
    template_path: Path,
    *,
    reference_resolution: tuple[int, int],
    roi: Sequence[int] | None = None,
    threshold: float = 0.85,
    max_results: int = 20,
    scale_search: bool = False,
) -> dict[str, Any]:
    if getattr(image, "ndim", 0) != 3 or image.shape[2] not in (3, 4):
        raise VisionError("template check frame must be a color image")
    image_height, image_width = image.shape[:2]
    mapper = CoordinateMapper(reference_resolution[0], reference_resolution[1], image_width, image_height)
    reference_roi: tuple[int, int, int, int] | None = None
    if roi is not None:
        values = tuple(int(value) for value in roi)
        if len(values) != 4:
            raise ValueError("ROI must contain x, y, width, height")
        reference_roi = values
        actual_roi = mapper.rect(Rect(*values)).as_tuple()
    else:
        actual_roi = (0, 0, image_width, image_height)

    frame = DeviceFrame(image_width, image_height, image, format="bgr")
    matches = TemplateMatcher(mapper).find(
        frame,
        template_path,
        roi=reference_roi,
        threshold=threshold,
        max_results=max_results,
        scale_search=scale_search,
    )
    return {
        "image_base64": _encode_png_base64(image),
        "image_size": [image_width, image_height],
        "reference_resolution": list(reference_resolution),
        "roi": list(reference_roi) if reference_roi is not None else None,
        "roi_image": list(actual_roi),
        "threshold": threshold,
        "matches": [match.to_dict() for match in matches],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="runtime config used to connect the selected instance")
    parser.add_argument("--instance", default="mumu-0")
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--image", type=Path, help="use an existing image instead of capturing a device")
    parser.add_argument("--template", required=True)
    parser.add_argument("--roi", nargs=4, type=int, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    parser.add_argument("--threshold", type=float, default=0.85)
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument("--scale-search", action="store_true")
    parser.add_argument("--reference-width", type=int, default=1920)
    parser.add_argument("--reference-height", type=int, default=1080)
    parser.add_argument("--result-file", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.reference_width < 1 or args.reference_height < 1:
        print("reference resolution must be positive", file=sys.stderr)
        return 2
    if not 0.0 <= args.threshold <= 1.0:
        print("threshold must be between 0 and 1", file=sys.stderr)
        return 2
    if not 1 <= args.max_results <= 100:
        print("max-results must be between 1 and 100", file=sys.stderr)
        return 2
    if args.image is None and args.config is None:
        print("--config is required when --image is not provided", file=sys.stderr)
        return 2

    device = None
    try:
        project_root = args.project_root.resolve()
        if args.image is not None:
            image = _read_image(args.image)
        else:
            config = ensure_runtime_instance(expand_runtime_instances(load_config(args.config)), args.instance)
            try:
                instance = config.instance(args.instance)
            except StopIteration as exc:
                raise ValueError(f"unknown runtime instance: {args.instance}") from exc
            project_root = config.root_dir.resolve()
            device, _ = connect_at_task_boundary(
                config,
                instance,
                attempts=config.retry.connection_attempts,
                base_delay_seconds=config.retry.base_delay_seconds,
                max_delay_seconds=config.retry.max_delay_seconds,
            )
            from ..vision.image import frame_to_bgr

            image = frame_to_bgr(device.capture()).copy()
        template_path = resolve_template_path(project_root, args.template)
        result = check_image(
            image,
            template_path,
            reference_resolution=(args.reference_width, args.reference_height),
            roi=args.roi,
            threshold=args.threshold,
            max_results=args.max_results,
            scale_search=args.scale_search,
        )
        args.result_file.parent.mkdir(parents=True, exist_ok=True)
        args.result_file.write_text(json.dumps(result, ensure_ascii=False) + "\n", encoding="utf-8")
        return 0
    except (AutomationError, OSError, ValueError) as exc:
        print(f"template check error: {exc}", file=sys.stderr)
        return 2
    finally:
        if device is not None:
            device.close()


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["build_parser", "check_image", "main", "resolve_template_path"]
