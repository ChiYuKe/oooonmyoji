"""Concrete TaskContext implementation."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Callable, Sequence

from ..devices.coordinates import CoordinateMapper, Rect
from ..devices.protocol import DeviceBackend, DeviceFrame, frame_from_backend
from ..exceptions import CancelledError, DeviceError, WorkflowError
from ..vision.image import crop_frame, write_frame
from ..vision.ocr import OcrEngine, OcrResult
from ..vision.template import TemplateMatch, TemplateMatcher
from .logging import EventLogger
from .retry import retry_call


class TaskContextImpl:
    def __init__(
        self,
        *,
        device: DeviceBackend,
        mapper: CoordinateMapper,
        template_matcher: TemplateMatcher,
        ocr_engine: OcrEngine | None,
        artifact_dir: Path,
        template_root: Path | None,
        logger: EventLogger,
        cancel_event: threading.Event | Any | None = None,
        capture_attempts: int = 3,
        ocr_attempts: int = 2,
        retry_base_delay: float = 0.25,
        retry_max_delay: float = 3.0,
        subworkflow_runner: Callable[..., Any] | None = None,
    ) -> None:
        self.device = device
        self.mapper = mapper
        self.template_matcher = template_matcher
        self.ocr_engine = ocr_engine
        self.artifact_dir = artifact_dir
        self.template_root = template_root
        self.logger = logger
        self.cancel_event = cancel_event if cancel_event is not None else threading.Event()
        self.capture_attempts = capture_attempts
        self.ocr_attempts = ocr_attempts
        self.retry_base_delay = retry_base_delay
        self.retry_max_delay = retry_max_delay
        self.subworkflow_runner = subworkflow_runner
        self._last_frame: DeviceFrame | None = None
        self._action_cancel_event = threading.Event()
        self._deadline: float | None = None

    @property
    def last_frame(self) -> DeviceFrame | None:
        return self._last_frame

    def capture(self) -> DeviceFrame:
        self.check_cancelled()
        frame = retry_call(
            lambda: frame_from_backend(self.device.capture()),
            attempts=self.capture_attempts,
            base_delay_seconds=self.retry_base_delay,
            max_delay_seconds=self.retry_max_delay,
            retry_if=lambda error: isinstance(error, DeviceError),
        )
        self._last_frame = frame
        return frame

    def find_template(
        self,
        template: Path | str,
        *,
        roi: Sequence[int] | None = None,
        threshold: float = 0.85,
        max_results: int = 20,
    ) -> list[TemplateMatch]:
        self.check_cancelled()
        frame = self._last_frame or self.capture()
        reference_roi = None
        if roi is not None:
            values = tuple(int(value) for value in roi)
            if len(values) != 4:
                raise ValueError("ROI must contain x, y, width, height")
            reference_roi = values
        template_path = Path(template)
        if self.template_root is not None:
            if template_path.is_absolute():
                template_path = template_path.resolve()
            else:
                template_path = (self.template_root / template_path).resolve()
            try:
                template_path.relative_to(self.template_root.resolve())
            except ValueError as exc:
                raise ValueError("template path must stay below the project root") from exc
        return self.template_matcher.find(frame, template_path, roi=reference_roi, threshold=threshold, max_results=max_results)

    def ocr(self, *, roi: Sequence[int] | None = None) -> list[OcrResult]:
        self.check_cancelled()
        if self.ocr_engine is None:
            raise RuntimeError("OCR is disabled or unavailable")
        frame = self._last_frame or self.capture()
        actual_roi = None
        if roi is not None:
            actual_roi = self.mapper.rect(Rect(*tuple(int(value) for value in roi))).as_tuple()
        cropped = crop_frame(frame, actual_roi)
        engine = self.ocr_engine
        assert engine is not None
        results = retry_call(
            lambda: engine.recognize(cropped),
            attempts=self.ocr_attempts,
            base_delay_seconds=self.retry_base_delay,
            max_delay_seconds=self.retry_max_delay,
        )
        if actual_roi is None:
            return results
        return [result.translated(actual_roi[0], actual_roi[1]) for result in results]

    def run_subworkflow(self, workflow: Path | str, inputs: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
        """运行另一个工作流（由 runner 注入执行器），返回其状态回执。

        Returns: (status, output, error, error_category) —— status 为
        succeeded / failed / cancelled，作为“回执”给调用方步骤使用。
        """

        if self.subworkflow_runner is None:
            raise WorkflowError("subworkflow execution is unavailable")
        return self.subworkflow_runner(workflow, inputs)

    def tap(self, x: int, y: int, *, hold_ms: int = 0) -> None:
        self.check_cancelled()
        actual_x, actual_y = self.mapper.point(x, y)
        self.device.tap(actual_x, actual_y, hold_ms=hold_ms)

    def wait_for(
        self,
        target: object,
        *,
        timeout_seconds: float,
        present: bool = True,
        roi: Sequence[int] | None = None,
        threshold: float = 0.85,
    ) -> list[TemplateMatch]:
        deadline = time.monotonic() + timeout_seconds
        while True:
            self.check_cancelled()
            if isinstance(target, (str, Path)):
                self.capture()
                matches = self.find_template(target, roi=roi, threshold=threshold)
            else:
                matches = []
            if bool(matches) is present:
                return matches
            if time.monotonic() >= deadline:
                state = "appear" if present else "disappear"
                raise TimeoutError(f"timed out waiting for template to {state}: {target}")
            time.sleep(0.1)

    def check_cancelled(self) -> None:
        if self.cancel_event.is_set() or self._action_cancel_event.is_set():
            raise CancelledError("task cancellation requested")

    def begin_action(self) -> None:
        self._action_cancel_event.clear()

    def request_action_cancel(self) -> None:
        self._action_cancel_event.set()

    def set_deadline(self, deadline: float) -> None:
        self._deadline = deadline

    def log(self, message: str, **fields: Any) -> None:
        self.logger.emit("task.log", message=message, **fields)

    def save_frame(self, frame: DeviceFrame, name: str) -> Path:
        safe_name = Path(name)
        if safe_name.is_absolute() or ".." in safe_name.parts:
            raise ValueError("artifact name must stay below the artifact directory")
        destination = self.artifact_dir / safe_name
        write_frame(destination, frame)
        return destination


__all__ = ["TaskContextImpl"]
