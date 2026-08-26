"""Cross-process instance locks."""

from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO


class InstanceLockError(RuntimeError):
    """The instance is already controlled by another process."""


class InstanceLock:
    """A small advisory lock held for the lifetime of a controller process."""

    def __init__(self, lock_dir: Path | str, instance_id: str) -> None:
        safe_id = "".join(char if char.isalnum() or char in "._-" else "_" for char in instance_id)
        self.path = Path(lock_dir) / f"{safe_id}.lock"
        self._handle: BinaryIO | None = None

    def acquire(self) -> None:
        if self._handle is not None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        try:
            handle.seek(0)
            if handle.read(1) == b"":
                handle.seek(0)
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                flock = getattr(fcntl, "flock")
                flock(handle.fileno(), getattr(fcntl, "LOCK_EX") | getattr(fcntl, "LOCK_NB"))
        except (BlockingIOError, OSError) as exc:
            handle.close()
            raise InstanceLockError(f"instance '{self.path.stem}' is already locked") from exc
        handle.seek(0)
        handle.truncate()
        handle.write(b"\0")
        handle.seek(0)
        handle.write(f"pid={os.getpid()}\n".encode("ascii"))
        handle.flush()
        self._handle = handle

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            return
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
        else:
            import fcntl

            getattr(fcntl, "flock")(handle.fileno(), getattr(fcntl, "LOCK_UN"))
        handle.close()
        self._handle = None

    def __enter__(self) -> "InstanceLock":
        self.acquire()
        return self

    def __exit__(self, *_: object) -> None:
        self.release()


__all__ = ["InstanceLock", "InstanceLockError"]
