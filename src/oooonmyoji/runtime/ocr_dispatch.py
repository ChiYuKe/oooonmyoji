"""OCR 请求派发：识别请求的排队、执行与共享 OCR 池的生命周期。

Supervisor 只保留协调（谁发起、回执进哪个队列），识别细节与线程池/信号量
都收在这里，可以脱离进程管理单独测试。
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, Callable

from ..config.model import AppConfig
from ..vision.ocr import SharedOcrPool
from .logging import EventLogger

if TYPE_CHECKING:  # pragma: no cover - 只为类型标注
    from .worker import _Worker


class OcrDispatcher:
    """Owns the shared OCR pool and the request thread pool for one supervisor."""

    def __init__(self, config: AppConfig, logger: EventLogger, *, is_stopping: Callable[[], bool]) -> None:
        self.config = config
        self.logger = logger
        self._is_stopping = is_stopping
        self.pool: SharedOcrPool | None = None
        self._lock = threading.Lock()
        self._executor: ThreadPoolExecutor | None = None
        self._slots: threading.BoundedSemaphore | None = None

    def handle(self, event: dict[str, Any], worker: _Worker | None) -> None:
        """把工作进程的 ocr_request 排进线程池，结果写回该进程的响应队列。"""

        instance_id = event.get("instance_id")
        request_id = event.get("id")
        if not isinstance(instance_id, str) or not isinstance(request_id, str) or worker is None:
            return
        if not self.config.ocr.enabled:
            worker.response_queue.put({"id": request_id, "error": "OCR is disabled"})
            return
        workers = max(1, int(getattr(self.config.ocr, "workers", 1)))
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="supervisor-ocr")
            self._slots = threading.BoundedSemaphore(workers * 2)
        slots = self._slots
        if slots is None or not slots.acquire(blocking=False):
            worker.response_queue.put({"id": request_id, "error": "OCR queue is full"})
            self.logger.emit("ocr.queue_full", instance_id=instance_id, request_id=request_id)
            return
        started = time.monotonic()
        self.logger.emit("ocr.request_started", instance_id=instance_id, request_id=request_id)

        def process() -> None:
            try:
                results = self.recognize(event.get("image"))
                worker.response_queue.put({"id": request_id, "results": results})
                self.logger.emit(
                    "ocr.request_completed",
                    instance_id=instance_id,
                    request_id=request_id,
                    duration_ms=round((time.monotonic() - started) * 1000, 3),
                )
            except Exception as exc:
                worker.response_queue.put({"id": request_id, "error": str(exc)})
                self.logger.emit(
                    "ocr.request_failed",
                    level=40,
                    instance_id=instance_id,
                    request_id=request_id,
                    duration_ms=round((time.monotonic() - started) * 1000, 3),
                    error=str(exc),
                )
            finally:
                slots.release()

        try:
            executor = self._executor
            if executor is None:
                raise RuntimeError("OCR is unavailable")
            executor.submit(process)
        except RuntimeError:
            slots.release()
            worker.response_queue.put({"id": request_id, "error": "OCR is unavailable"})

    def recognize(self, image: object) -> list[Any]:
        """同步识别一张图：首次调用时才创建共享 OCR 池。"""

        if not self.config.ocr.enabled:
            raise RuntimeError("OCR is disabled")
        if self._is_stopping():
            raise RuntimeError("supervisor is stopping")
        with self._lock:
            if self._is_stopping():
                raise RuntimeError("supervisor is stopping")
            if self.pool is None:
                self.pool = SharedOcrPool(
                    language=self.config.ocr.language,
                    workers=self.config.ocr.workers,
                    timeout_seconds=self.config.ocr.request_timeout_seconds,
                    min_confidence=self.config.ocr.min_confidence,
                    use_gpu=self.config.ocr.use_gpu,
                )
            return self.pool.recognize(image)

    def close(self) -> None:
        """收尾：强制关闭共享 OCR 池并停掉请求线程池。"""

        if self.pool is not None:
            self.pool.close(force=True)
            self.pool = None
        if self._executor is not None:
            self._executor.shutdown(wait=True)
            self._executor = None
            self._slots = None


__all__ = ["OcrDispatcher"]
