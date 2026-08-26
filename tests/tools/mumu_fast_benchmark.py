#!/usr/bin/env python3
"""测试可复用的 MuMu 原生设备层。"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

# 同时支持模块方式和从 tests/tools 目录直接执行。
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.oooonmyoji.devices.mumu import MumuDevice, MumuDeviceError, discover_mumu_path


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
    if args.rounds < 1 or args.warmup < 0 or args.hold_ms < 0:
        parser.error("rounds must be positive; warmup and hold-ms cannot be negative")

    try:
        print(f"MuMu: {args.mumu_path.resolve()}")
        with MumuDevice(args.mumu_path, args.index, args.package) as device:
            print(f"DLL: {device.dll_path}")
            print(f"Instance: {args.index}, display: {device.display_id}")
            print(f"Resolution: {device.width}x{device.height}, buffer: {device.width * device.height * 4} bytes")

            for _ in range(args.warmup):
                device.capture()
            capture_samples = []
            frame = None
            for _ in range(args.rounds):
                started = time.perf_counter_ns()
                frame = device.capture()
                capture_samples.append((time.perf_counter_ns() - started) / 1_000_000)
            print_stats("mumu_capture_display", capture_samples)
            if frame:
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
    except (MumuDeviceError, OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
