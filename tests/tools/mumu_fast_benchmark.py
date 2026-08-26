#!/usr/bin/env python3
"""测试可复用的 MuMu 原生设备层。"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# 同时支持模块方式和从 tests/tools 目录直接执行。
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.oooonmyoji.devices.mumu import MumuDevice, discover_mumu_path
from src.oooonmyoji.exceptions import DeviceError


P95_LIMIT_MS = 20.0


def percentile(values: list[float], quantile: float) -> float:
    values = sorted(values)
    if len(values) == 1:
        return values[0]
    rank = (len(values) - 1) * quantile
    low = int(rank)
    high = min(low + 1, len(values) - 1)
    return values[low] + (values[high] - values[low]) * (rank - low)


def print_stats(name: str, values: list[float]) -> None:
    print(
        f"{name}: count={len(values)} min={min(values):.3f}ms "
        f"avg={statistics.fmean(values):.3f}ms p50={percentile(values, 0.50):.3f}ms "
        f"p95={percentile(values, 0.95):.3f}ms max={max(values):.3f}ms"
    )


@dataclass(frozen=True)
class CaptureBatch:
    samples_ms: tuple[float, ...]
    dll_call_ms: tuple[float, ...]
    validation_ms: tuple[float, ...]

    @property
    def p95_ms(self) -> float:
        return percentile(list(self.samples_ms), 0.95)


def measure_capture_batch(device: MumuDevice, warmup: int, rounds: int) -> CaptureBatch:
    for _ in range(warmup):
        device.capture()
    samples: list[float] = []
    dll_call: list[float] = []
    validation: list[float] = []
    for _ in range(rounds):
        started = time.perf_counter_ns()
        device.capture()
        samples.append((time.perf_counter_ns() - started) / 1_000_000)
        timing = device.last_capture_timing
        if timing is None:
            raise RuntimeError("capture timing was not recorded")
        dll_call.append(timing.dll_call_ms)
        validation.append(timing.validation_ms)
    return CaptureBatch(tuple(samples), tuple(dll_call), tuple(validation))


def print_capture_batch(index: int, batch: CaptureBatch) -> None:
    print_stats(f"mumu_capture_display_batch_{index}", list(batch.samples_ms))
    print_stats(f"mumu_capture_dll_call_batch_{index}", list(batch.dll_call_ms))
    print_stats(f"mumu_capture_validation_batch_{index}", list(batch.validation_ms))


def parse_tap(value: str) -> tuple[int, int]:
    try:
        x, y = (int(part.strip()) for part in value.split(",", 1))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("tap must use X,Y format") from exc
    if x < 0 or y < 0:
        raise argparse.ArgumentTypeError("tap coordinates cannot be negative")
    return x, y


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mumu-path", type=Path, default=discover_mumu_path())
    parser.add_argument("--index", type=int, default=0, help="MuMu multi-instance index")
    parser.add_argument("--package", help="optional package for display lookup")
    parser.add_argument("--rounds", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--batches", type=int, default=3, help="capture batches used by the P95 gate")
    parser.add_argument("--tap", type=parse_tap, help="also measure a real touch at X,Y")
    parser.add_argument("--hold-ms", type=int, default=0)
    parser.add_argument("--touch-api", choices=("finger", "basic"), default="finger")
    parser.add_argument("--save", type=Path, help="save the final native frame as PNG")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.mumu_path is None:
        parser.error("MuMu path was not found; pass --mumu-path")
    if args.rounds < 1 or args.warmup < 0 or args.hold_ms < 0 or args.batches < 1:
        parser.error("rounds and batches must be positive; warmup and hold-ms cannot be negative")

    performance_failed = False
    try:
        print(f"MuMu: {args.mumu_path.resolve()}")
        with MumuDevice(args.mumu_path, args.index, args.package, capture_timing=True) as device:
            print(f"DLL: {device.dll_path}")
            print(f"Instance: {args.index}, display: {device.display_id}")
            print(f"Resolution: {device.width}x{device.height}, buffer: {device.width * device.height * 4} bytes")

            print(f"Capture gate: {args.batches} batches x {args.rounds} rounds, P95 <= {P95_LIMIT_MS:.1f} ms")
            batches = [measure_capture_batch(device, args.warmup, args.rounds) for _ in range(args.batches)]
            for index, batch in enumerate(batches, start=1):
                print_capture_batch(index, batch)
            failed_batches = [index for index, batch in enumerate(batches, start=1) if batch.p95_ms > P95_LIMIT_MS]
            performance_failed = bool(failed_batches)
            if failed_batches:
                print(
                    "PERFORMANCE FAIL: capture P95 exceeded "
                    f"{P95_LIMIT_MS:.1f} ms in batch(es) {', '.join(map(str, failed_batches))}",
                    file=sys.stderr,
                )
            else:
                print(f"PERFORMANCE PASS: all capture batches have P95 <= {P95_LIMIT_MS:.1f} ms")

            frame = device.capture()
            print(f"Frame bytes: {frame.byte_count}")
            if args.save:
                device.capture_png(args.save)
                print(f"Saved frame: {args.save.resolve()}")

            if args.tap:
                x, y = args.tap
                for _ in range(args.warmup):
                    device.tap(x, y, args.hold_ms, args.touch_api)
                touch_samples = []
                for _ in range(args.rounds):
                    started = time.perf_counter_ns()
                    device.tap(x, y, args.hold_ms, args.touch_api)
                    touch_samples.append((time.perf_counter_ns() - started) / 1_000_000)
                print_stats(
                    f"mumu_touch_{args.touch_api}_{x}_{y}_hold_{args.hold_ms}ms",
                    touch_samples,
                )
            else:
                print("Touch test: skipped; pass --tap X,Y to enable")
    except (DeviceError, OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        return 130
    return 3 if performance_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
