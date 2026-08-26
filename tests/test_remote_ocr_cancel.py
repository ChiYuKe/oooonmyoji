from __future__ import annotations

import threading
import time
import queue

import pytest

from src.oooonmyoji.exceptions import CancelledError
from src.oooonmyoji.runtime.runner import RemoteOcrEngine


class NeverRespondingQueue:
    def put(self, value: object) -> None:
        return None

    def get(self, timeout: float) -> object:
        time.sleep(min(timeout, 0.01))
        raise queue.Empty


def test_remote_ocr_stops_waiting_when_run_is_cancelled() -> None:
    cancel_event = threading.Event()
    engine = RemoteOcrEngine(NeverRespondingQueue(), NeverRespondingQueue(), "fake", cancel_event=cancel_event)

    def cancel() -> None:
        time.sleep(0.03)
        cancel_event.set()

    thread = threading.Thread(target=cancel)
    thread.start()
    try:
        with pytest.raises(CancelledError):
            engine.recognize(object())
    finally:
        thread.join()
