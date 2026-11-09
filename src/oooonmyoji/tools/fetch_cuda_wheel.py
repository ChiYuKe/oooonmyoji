"""Parallel, range-based fetch of an official CUDA wheel with SHA-256 verification."""

from __future__ import annotations

import argparse
import hashlib
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests


def fetch_part(url: str, start: int, end: int, destination: Path, attempts: int = 5) -> Path:
    expected = end - start + 1
    for attempt in range(attempts):
        try:
            response = requests.get(url, headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"},
                                    stream=True, timeout=(60, 300))
            response.raise_for_status()
            content_range = response.headers.get("Content-Range", "")
            if not content_range.startswith(f"bytes {start}-{end}/"):
                raise RuntimeError(f"server returned an unexpected range: {content_range}")
            written = 0
            with destination.open("wb") as stream:
                for chunk in response.iter_content(1024 * 1024):
                    if chunk:
                        stream.write(chunk)
                        written += len(chunk)
            response.close()
            if written != expected:
                raise RuntimeError(f"range {start}-{end}: expected {expected} bytes, got {written}")
            return destination
        except Exception:
            if attempt + 1 == attempts:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        parser.error("workers must be between 1 and 32")
    url = "https://download-r2.pytorch.org/whl/cu128/torch-2.11.0%2Bcu128-cp312-cp312-win_amd64.whl"
    probe = requests.get(url, headers={"Range": "bytes=0-0", "Accept-Encoding": "identity"},
                         stream=True, timeout=(60, 300))
    if probe.status_code != 206:
        raise RuntimeError(f"server does not honor byte ranges (HTTP {probe.status_code})")
    total = int(probe.headers["Content-Range"].rsplit("/", 1)[1])
    probe.close()
    part_size = 64 * 1024 * 1024
    parts = [(start, min(start + part_size, total) - 1) for start in range(0, total, part_size)]
    workdir = args.output.with_suffix(args.output.suffix + ".parts")
    workdir.mkdir(parents=True, exist_ok=True)
    futures = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for index, (start, end) in enumerate(parts):
            part = workdir / f"{index:03d}.part"
            if part.is_file() and part.stat().st_size == end - start + 1:
                continue
            futures.append(pool.submit(fetch_part, url, start, end, part))
        for done, future in enumerate(as_completed(futures), 1):
            future.result()
            print(f"completed range {done}/{len(futures)}", flush=True)
    tmp = args.output.with_suffix(args.output.suffix + ".assembling")
    with tmp.open("wb") as output:
        for index, (start, end) in enumerate(parts):
            part = workdir / f"{index:03d}.part"
            if part.stat().st_size != end - start + 1:
                raise RuntimeError(f"bad cached range {part}")
            with part.open("rb") as source:
                while chunk := source.read(8 * 1024 * 1024):
                    output.write(chunk)
    hasher = hashlib.sha256()
    with tmp.open("rb") as assembled:
        while chunk := assembled.read(8 * 1024 * 1024):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    if digest.lower() != args.sha256.lower():
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"SHA-256 mismatch: expected {args.sha256}, got {digest}")
    os.replace(tmp, args.output)
    print(f"verified {args.output} ({total} bytes, sha256={digest})", flush=True)


if __name__ == "__main__":
    main()
