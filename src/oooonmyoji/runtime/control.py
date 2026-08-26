"""Local Windows named-pipe control channel for the long-running supervisor."""

from __future__ import annotations

import json
import multiprocessing.connection
import threading
from collections.abc import Callable
from typing import Any


PIPE_NAME = r"\\.\pipe\oooonmyoji-supervisor"
AUTH_KEY = b"oooonmyoji-local-v1"


class ControlServer:
    def __init__(self, handler: Callable[[dict[str, Any]], dict[str, Any]], *, address: str = PIPE_NAME) -> None:
        self.handler = handler
        self.address = address
        self._listener: multiprocessing.connection.Listener | None = None
        self._stop = threading.Event()

    def serve_forever(self) -> None:
        self._listener = multiprocessing.connection.Listener(self.address, family="AF_PIPE", authkey=AUTH_KEY)
        while not self._stop.is_set():
            try:
                connection = self._listener.accept()
            except (OSError, EOFError):
                if self._stop.is_set():
                    break
                continue
            threading.Thread(target=self._handle, args=(connection,), daemon=True).start()

    def _handle(self, connection: Any) -> None:
        try:
            request = connection.recv()
            response = self.handler(request if isinstance(request, dict) else {})
            connection.send(response)
        except (EOFError, OSError) as exc:
            try:
                connection.send({"ok": False, "error": str(exc)})
            except OSError:
                pass
        except Exception as exc:
            try:
                connection.send({"ok": False, "error": str(exc)})
            except OSError:
                pass
        finally:
            connection.close()

    def close(self) -> None:
        self._stop.set()
        if self._listener is not None:
            self._listener.close()
            self._listener = None


def send_control(request: dict[str, Any], *, address: str = PIPE_NAME, timeout_seconds: float = 2.0) -> dict[str, Any]:
    connection = multiprocessing.connection.Client(address, family="AF_PIPE", authkey=AUTH_KEY)
    try:
        connection.send(request)
        if timeout_seconds and not connection.poll(timeout_seconds):
            raise TimeoutError("supervisor control request timed out")
        response = connection.recv()
    finally:
        connection.close()
    return response


__all__ = ["ControlServer", "PIPE_NAME", "send_control"]
