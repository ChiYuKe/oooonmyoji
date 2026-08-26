#!/usr/bin/env python3
"""测试 ADB 往返和截图延迟。

默认测试只读。只有传入 --tap X,Y 时才会执行点击测试。
"""

from __future__ import annotations

import argparse
import re
import shutil
import statistics
import struct
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


class BenchmarkError(RuntimeError):
    pass


@dataclass
class Stats:
    name: str
    samples_ms: list[float]

    def as_dict(self) -> dict[str, float | int | str]:
        values = sorted(self.samples_ms)
        return {
            "name": self.name,
            "count": len(values),
            "min_ms": round(values[0], 2),
            "avg_ms": round(statistics.fmean(values), 2),
            "p50_ms": round(percentile(values, 0.50), 2),
            "p95_ms": round(percentile(values, 0.95), 2),
            "max_ms": round(values[-1], 2),
        }


def percentile(values: Sequence[float], quantile: float) -> float:
    if not values:
        raise ValueError("cannot calculate a percentile without samples")
    if len(values) == 1:
        return values[0]
    rank = (len(values) - 1) * quantile
    lower = int(rank)
    upper = min(lower + 1, len(values) - 1)
    fraction = rank - lower
    return values[lower] + (values[upper] - values[lower]) * fraction


def now_ns() -> int:
    return time.perf_counter_ns()


def elapsed_ms(start_ns: int) -> float:
    return (now_ns() - start_ns) / 1_000_000


def run_command(
    adb: str,
    serial: str,
    args: Sequence[str],
    timeout: float,
) -> subprocess.CompletedProcess[bytes]:
    command = [adb, "-s", serial, *args]
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise BenchmarkError(f"ADB executable not found: {adb}") from exc
    except subprocess.TimeoutExpired as exc:
        raise BenchmarkError(f"ADB command timed out: {' '.join(command)}") from exc

    if result.returncode != 0:
        error = result.stderr.decode(errors="replace").strip()
        raise BenchmarkError(
            f"ADB command failed ({result.returncode}): {' '.join(command)}"
            + (f"\n{error}" if error else "")
        )
    return result


def list_devices(adb: str, timeout: float) -> list[str]:
    try:
        result = subprocess.run(
            [adb, "devices"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise BenchmarkError(
            f"ADB executable not found: {adb}. Install Android platform-tools or pass --adb."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise BenchmarkError("adb devices timed out") from exc

    if result.returncode != 0:
        raise BenchmarkError(result.stderr.decode(errors="replace").strip())

    devices: list[str] = []
    for line in result.stdout.decode(errors="replace").splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[1] == "device":
            devices.append(fields[0])
    return devices


def choose_device(adb: str, requested: str | None, timeout: float) -> str:
    devices = list_devices(adb, timeout)
    if requested:
        if requested not in devices:
            raise BenchmarkError(
                f"Device {requested!r} is not online. Online devices: {', '.join(devices) or 'none'}"
            )
        return requested
    if not devices:
        raise BenchmarkError(
            "No online ADB device found. Enable USB debugging and check `adb devices`."
        )
    if len(devices) > 1:
        raise BenchmarkError(
            "Multiple devices found; choose one with --serial: " + ", ".join(devices)
        )
    return devices[0]


def run_latency_test(
    adb: str,
    serial: str,
    rounds: int,
    warmup: int,
    timeout: float,
) -> Stats:
    for _ in range(warmup):
        run_command(adb, serial, ["shell", "true"], timeout)

    samples = []
    for _ in range(rounds):
        started = now_ns()
        run_command(adb, serial, ["shell", "true"], timeout)
        samples.append(elapsed_ms(started))
    return Stats("one_shot_shell_true", samples)


class PersistentShell:
    def __init__(self, adb: str, serial: str, timeout: float) -> None:
        self.timeout = timeout
        try:
            self.process = subprocess.Popen(
                [adb, "-s", serial, "shell"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
        except FileNotFoundError as exc:
            raise BenchmarkError(f"ADB executable not found: {adb}") from exc

    def command(self, command: str) -> float:
        if not self.process.stdin or not self.process.stdout:
            raise BenchmarkError("persistent shell streams are unavailable")
        marker = f"__ADB_BENCH_{uuid.uuid4().hex}__"
        started = now_ns()
        self.process.stdin.write(f"{command}; printf '%s\\n' '{marker}'\n".encode())
        self.process.stdin.flush()

        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            line = self.process.stdout.readline()
            if not line:
                break
            if marker.encode() in line:
                return elapsed_ms(started)
        raise BenchmarkError("persistent shell did not return its marker")

    def close(self) -> None:
        if self.process.stdin:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=self.timeout)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()

    def __enter__(self) -> "PersistentShell":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def persistent_shell_test(
    adb: str,
    serial: str,
    rounds: int,
    warmup: int,
    timeout: float,
) -> Stats:
    with PersistentShell(adb, serial, timeout) as shell:
        for _ in range(warmup):
            shell.command("true")
        samples = [shell.command("true") for _ in range(rounds)]
    return Stats("persistent_shell_true", samples)


def screenshot_test(
    adb: str,
    serial: str,
    rounds: int,
    warmup: int,
    timeout: float,
) -> tuple[Stats, tuple[int, int] | None, int]:
    for _ in range(warmup):
        run_command(adb, serial, ["exec-out", "screencap", "-p"], timeout)

    samples = []
    last_size = 0
    last_resolution = None
    for _ in range(rounds):
        started = now_ns()
        result = run_command(adb, serial, ["exec-out", "screencap", "-p"], timeout)
        samples.append(elapsed_ms(started))
        last_size = len(result.stdout)
        last_resolution = png_resolution(result.stdout)
    return Stats("exec_out_screencap_png", samples), last_resolution, last_size


def raw_screenshot_test(
    adb: str,
    serial: str,
    rounds: int,
    warmup: int,
    timeout: float,
) -> tuple[Stats, tuple[int, int] | None, int]:
    command = ["exec-out", "screencap"]
    for _ in range(warmup):
        run_command(adb, serial, command, timeout)

    samples = []
    last_size = 0
    last_resolution = None
    for _ in range(rounds):
        started = now_ns()
        result = run_command(adb, serial, command, timeout)
        samples.append(elapsed_ms(started))
        last_size = len(result.stdout)
        last_resolution = raw_screenshot_resolution(result.stdout)
    return Stats("exec_out_screencap_raw", samples), last_resolution, last_size


def tap_test(
    adb: str,
    serial: str,
    x: int,
    y: int,
    rounds: int,
    warmup: int,
    timeout: float,
) -> Stats:
    command = ["shell", "input", "tap", str(x), str(y)]
    for _ in range(warmup):
        run_command(adb, serial, command, timeout)

    samples = []
    for _ in range(rounds):
        started = now_ns()
        run_command(adb, serial, command, timeout)
        samples.append(elapsed_ms(started))
    return Stats(f"one_shot_input_tap_{x}_{y}", samples)


def png_resolution(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


def raw_screenshot_resolution(data: bytes) -> tuple[int, int] | None:
    if len(data) < 8:
        return None
    width, height = struct.unpack("<II", data[:8])
    if width < 1 or height < 1 or width > 10000 or height > 10000:
        return None
    return width, height


def parse_tap(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*,\s*(\d+)\s*", value)
    if not match:
        raise argparse.ArgumentTypeError("tap must use X,Y format, for example 500,800")
    return int(match.group(1)), int(match.group(2))


def default_adb_path() -> str:
    from_path = shutil.which("adb")
    if from_path:
        return from_path

    candidates = []
    for drive in ("C:\\", "D:\\", "E:\\"):
        candidates.extend(
            [
                Path(drive) / "Program Files" / "Netease" / "MuMuPlayer-12.0" / "nx_main" / "adb.exe",
                Path(drive) / "Program Files" / "Netease" / "MuMu Player 12" / "shell" / "adb.exe",
                Path(drive) / "Program Files (x86)" / "Netease" / "MuMuPlayer-12.0" / "nx_main" / "adb.exe",
            ]
        )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return "adb"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--adb",
        default=default_adb_path(),
        help="path to adb.exe; default: adb from PATH",
    )
    parser.add_argument("--serial", help="device serial when more than one device is connected")
    parser.add_argument("--rounds", type=int, default=20, help="measured rounds per test")
    parser.add_argument("--warmup", type=int, default=3, help="discarded warmup rounds")
    parser.add_argument("--timeout", type=float, default=10.0, help="per-command timeout in seconds")
    parser.add_argument(
        "--tap",
        type=parse_tap,
        help="also measure input tap at X,Y; this changes the device screen",
    )
    parser.add_argument(
        "--no-screenshot",
        action="store_true",
        help="skip screenshot measurement",
    )
    return parser


def print_stats(stats: Stats) -> None:
    values = stats.as_dict()
    print(
        f"{values['name']}: count={values['count']} "
        f"min={values['min_ms']:.2f}ms avg={values['avg_ms']:.2f}ms "
        f"p50={values['p50_ms']:.2f}ms p95={values['p95_ms']:.2f}ms "
        f"max={values['max_ms']:.2f}ms"
    )


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.rounds < 1 or args.warmup < 0:
        parser.error("--rounds must be positive and --warmup cannot be negative")

    try:
        serial = choose_device(args.adb, args.serial, args.timeout)
        print(f"ADB: {args.adb}")
        print(f"Device: {serial}")
        print(f"Rounds: {args.rounds}, warmup: {args.warmup}")

        print_stats(run_latency_test(args.adb, serial, args.rounds, args.warmup, args.timeout))
        print_stats(persistent_shell_test(args.adb, serial, args.rounds, args.warmup, args.timeout))

        if not args.no_screenshot:
            stats, resolution, byte_count = screenshot_test(
                args.adb, serial, args.rounds, args.warmup, args.timeout
            )
            print_stats(stats)
            if resolution:
                print(f"Screenshot: {resolution[0]}x{resolution[1]}, {byte_count} bytes")
            else:
                print("Screenshot: PNG header was not recognized")

            raw_stats, raw_resolution, raw_byte_count = raw_screenshot_test(
                args.adb, serial, args.rounds, args.warmup, args.timeout
            )
            print_stats(raw_stats)
            if raw_resolution:
                print(f"Raw screenshot: {raw_resolution[0]}x{raw_resolution[1]}, {raw_byte_count} bytes")
            else:
                print("Raw screenshot: header was not recognized")

        if args.tap:
            x, y = args.tap
            print_stats(tap_test(args.adb, serial, x, y, args.rounds, args.warmup, args.timeout))
        else:
            print("Tap test: skipped; pass --tap X,Y to enable")
    except BenchmarkError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
