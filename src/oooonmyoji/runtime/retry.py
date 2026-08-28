"""Bounded exponential retry helpers."""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def retry_call(
    operation: Callable[[], T],
    *,
    attempts: int,
    base_delay_seconds: float = 0.25,
    max_delay_seconds: float = 3.0,
    retry_if: Callable[[BaseException], bool] | None = None,
    sleep: Callable[[float], None] = time.sleep,
    jitter: bool = False,
) -> T:
    if attempts < 1:
        raise ValueError("attempts must be at least 1")
    if base_delay_seconds < 0 or max_delay_seconds < base_delay_seconds:
        raise ValueError("invalid retry delay bounds")
    last_error: BaseException | None = None
    for attempt in range(attempts):
        try:
            return operation()
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            last_error = exc
            if attempt + 1 >= attempts or (retry_if is not None and not retry_if(exc)):
                raise
            delay = min(max_delay_seconds, base_delay_seconds * (2**attempt))
            if jitter and delay > 0:
                delay = random.uniform(0, delay)
            sleep(delay)
    assert last_error is not None
    raise last_error


__all__ = ["retry_call"]
