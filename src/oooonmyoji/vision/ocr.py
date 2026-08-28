"""OCR interface, PaddleOCR adapter, and one shared worker pool."""

from __future__ import annotations

import multiprocessing as mp
import json
import threading
import time
from concurrent.futures import TimeoutError
from dataclasses import dataclass
from typing import Any, Protocol, Sequence

from ..exceptions import OcrError


@dataclass(frozen=True)
class OcrResult:
    text: str
    confidence: float
    box: tuple[tuple[int, int], tuple[int, int], tuple[int, int], tuple[int, int]]

    @property
    def x(self) -> int:
        return min(point[0] for point in self.box)

    @property
    def y(self) -> int:
        return min(point[1] for point in self.box)

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "confidence": round(self.confidence, 6), "box": [list(point) for point in self.box]}

    def translated(self, dx: int, dy: int) -> "OcrResult":
        return OcrResult(
            self.text,
            self.confidence,
            tuple((x + dx, y + dy) for x, y in self.box),  # type: ignore[arg-type]
        )


class OcrEngine(Protocol):
    def recognize(self, image: object) -> list[OcrResult]: ...

    def close(self) -> None: ...


def _box(value: object) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int], tuple[int, int]]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, (list, tuple)) or len(value) < 4:
        raise OcrError(f"invalid OCR box: {value!r}")
    if len(value) == 4 and all(isinstance(item, (int, float)) for item in value):
        x1, y1, x2, y2 = (int(round(item)) for item in value)
        return ((x1, y1), (x2, y1), (x2, y2), (x1, y2))
    points = []
    for point in value[:4]:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            raise OcrError(f"invalid OCR point: {point!r}")
        points.append((int(round(point[0])), int(round(point[1]))))
    return tuple(points)  # type: ignore[return-value]


def normalize_ocr_result(raw: object, *, min_confidence: float = 0.0) -> list[OcrResult]:
    """Normalize PaddleOCR 3.x prediction dictionaries and legacy records."""

    if hasattr(raw, "json"):
        raw = raw.json
        if callable(raw):
            raw = raw()
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise OcrError("PaddleOCR result JSON is invalid") from exc
    if isinstance(raw, dict) and isinstance(raw.get("res"), dict):
        # PaddleOCR 3.x OCRResult.json wraps the pipeline payload in `res`.
        raw = raw["res"]
    records: list[OcrResult] = []
    if isinstance(raw, dict):
        texts = raw.get("rec_texts", raw.get("texts", []))
        scores = raw.get("rec_scores", raw.get("scores", []))
        boxes = raw.get("rec_boxes", raw.get("rec_polys", raw.get("boxes", [])))
        if isinstance(texts, str):
            texts, scores, boxes = [texts], [scores], [boxes]

        def sequence(value: object) -> list[Any]:
            if value is None:
                return []
            if hasattr(value, "tolist"):
                value = value.tolist()
            if isinstance(value, list):
                return value
            if isinstance(value, tuple):
                return list(value)
            return [value]

        for text, score, box in zip(sequence(texts), sequence(scores), sequence(boxes)):
            confidence = float(score)
            if confidence >= min_confidence and str(text).strip():
                records.append(OcrResult(str(text), confidence, _box(box)))
        return records
    if isinstance(raw, (list, tuple)):
        for item in raw:
            if isinstance(item, (list, tuple)) and len(item) >= 2 and isinstance(item[1], (list, tuple)):
                box, value = item[0], item[1]
                if isinstance(value, (list, tuple)) and len(value) >= 2:
                    text, confidence = str(value[0]), float(value[1])
                else:
                    continue
                if confidence >= min_confidence and text.strip():
                    records.append(OcrResult(text, confidence, _box(box)))
            else:
                records.extend(normalize_ocr_result(item, min_confidence=min_confidence))
    return records


class PaddleOcrEngine:
    def __init__(self, *, language: str = "ch", use_gpu: bool = False, min_confidence: float = 0.0) -> None:
        try:
            import paddle  # noqa: F401
        except ImportError as exc:
            raise OcrError("PaddlePaddle inference engine is not installed") from exc
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise OcrError("PaddleOCR 3.x is not installed") from exc
        self.min_confidence = min_confidence
        options: dict[str, Any] = {
            "lang": language,
            "device": "gpu:0" if use_gpu else "cpu",
            # Emulator frames are UI canvases, not document pages. Full-page
            # orientation classification can rotate a landscape game frame
            # and suppress otherwise readable UI text.
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": True,
        }
        if not use_gpu:
            # PaddleOCR 3.x's default oneDNN path is not compatible with the
            # PP-OCRv6 CPU model on some PaddlePaddle Windows wheels.
            options["enable_mkldnn"] = False
        try:
            self._ocr = PaddleOCR(**options)
        except TypeError:
            options.pop("device", None)
            options.pop("enable_mkldnn", None)
            options["use_angle_cls"] = True
            self._ocr = PaddleOCR(**options)

    def recognize(self, image: object) -> list[OcrResult]:
        try:
            prediction = self._ocr.predict(image)
            output: list[OcrResult] = []
            for item in prediction:
                output.extend(normalize_ocr_result(item, min_confidence=self.min_confidence))
            return output
        except Exception as exc:
            raise OcrError(f"PaddleOCR prediction failed: {exc}", cause=exc) from exc

    def close(self) -> None:
        self._ocr = None


_worker_engine: PaddleOcrEngine | None = None


def _ocr_worker_init(language: str, use_gpu: bool, min_confidence: float) -> None:
    global _worker_engine
    _worker_engine = PaddleOcrEngine(language=language, use_gpu=use_gpu, min_confidence=min_confidence)


def _ocr_worker(image: object) -> list[OcrResult]:
    if _worker_engine is None:
        raise OcrError("OCR worker was not initialized")
    return _worker_engine.recognize(image)


class SharedOcrPool:
    """A single spawn-based OCR process pool shared by all instance workers."""

    def __init__(self, *, language: str = "ch", workers: int = 1, timeout_seconds: float = 15.0, min_confidence: float = 0.0, use_gpu: bool = False) -> None:
        self.language = language
        self.workers = workers
        self.timeout_seconds = timeout_seconds
        self.min_confidence = min_confidence
        self.use_gpu = use_gpu
        self._pool: mp.pool.Pool | None = None
        self._restart_lock = threading.Lock()
        self._start()

    def _start(self) -> None:
        context = mp.get_context("spawn")
        self._pool = context.Pool(
            processes=self.workers,
            initializer=_ocr_worker_init,
            initargs=(self.language, self.use_gpu, self.min_confidence),
        )

    def recognize(self, roi_image: object) -> list[OcrResult]:
        if self._pool is None:
            raise OcrError("OCR pool is closed")
        request = self._pool.apply_async(_ocr_worker, (roi_image,))
        try:
            return request.get(timeout=self.timeout_seconds)
        except (TimeoutError, mp.TimeoutError, OSError, EOFError) as exc:
            self.restart()
            raise OcrError("OCR request timed out or worker exited; pool was rebuilt", cause=exc) from exc
        except Exception as exc:
            self.restart()
            raise OcrError(f"OCR worker failed: {exc}", cause=exc) from exc

    def restart(self) -> None:
        # 多个调用方并发超时可能同时触发热重建，串行化避免互相踩踏
        with self._restart_lock:
            self.close(force=True)
            self._start()

    def close(self, *, force: bool = False) -> None:
        pool, self._pool = self._pool, None
        if pool is None:
            return
        if not force:
            pool.close()
            pool.join()
            return
        self._terminate_pool(pool)

    @staticmethod
    def _terminate_pool(pool: mp.pool.Pool, *, timeout_seconds: float = 2.0) -> None:
        """Terminate and bound child-process joins before rebuilding the pool."""

        pool.terminate()
        processes = list(getattr(pool, "_pool", []))
        deadline = time.monotonic() + timeout_seconds
        for process in processes:
            remaining = max(0.0, deadline - time.monotonic())
            process.join(remaining)
            if process.is_alive():
                process.kill()
                process.join(timeout_seconds)
        pool.join()

    def __enter__(self) -> "SharedOcrPool":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


__all__ = ["OcrEngine", "OcrResult", "PaddleOcrEngine", "SharedOcrPool", "normalize_ocr_result"]
