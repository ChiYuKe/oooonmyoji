"""Inspect every source frame. Pixel positions are observations, never inferred gauge percentages.

Uses only bundled Pillow/NumPy; uncertainty and missing/overlapping portraits are retained.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("C:/Users/Administrator/Documents/MuMu共享文件夹/VideoRecords/14点场")
NAMES = {391: "寻香行", 247: "海坊主", 306: "虫师", 396: "修罗鬼童丸", 600: "市加美",
         356: "千姬", 331: "御怨般若", 362: "蝉冰雪女", 392: "季", 395: "流光追月神"}
# Manually inspected full-size current-actor portraits. Bounds exclude the camp border.
ANCHORS = [(391, 425), (247, 500), (306, 575), (396, 650), (600, 675),
           (356, 775), (331, 900), (362, 1000), (392, 1175), (395, 1250)]


def descriptor(pixels):
    a = pixels.astype(np.float32).reshape(pixels.shape[0], -1)
    a -= a.mean(axis=1, keepdims=True)
    return a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-6)


def templates(source, size):
    images = []
    for hero, frame in ANCHORS:
        with Image.open(source / f"{frame:06}.jpg") as im:
            images.append(np.asarray(im.crop((1830, 685, 1900, 755)).resize((size, size)), dtype=np.float32))
    return descriptor(np.stack(images))


def scan(im, template, size, width, top=140, bottom=770):
    # Keep the native portrait center fixed horizontally; search every vertical position at quarter scale.
    strip = np.asarray(im.crop((1865-width//2, top, 1865+width//2, bottom))
                       .resize((size, (bottom-top)//4)), dtype=np.float32)
    windows = np.lib.stride_tricks.sliding_window_view(strip, (size, size), axis=(0, 1))[:, 0]
    windows = windows.transpose(0, 2, 3, 1)
    scores = descriptor(windows) @ template.T
    return scores, top + size*2 + np.arange(scores.shape[0])*4


def candidates(scores, ys, threshold=.68):
    found = []
    for index, (hero, _) in enumerate(ANCHORS):
        column = scores[:, index]
        for y in range(len(column)):
            if column[y] < threshold or column[y] < column[max(0, y-4):min(len(column), y+5)].max():
                continue
            # A hero match must exceed alternative heroes at that same location.
            ordered = np.sort(scores[y])
            if column[y] < ordered[-1] or ordered[-1] - ordered[-2] < .04:
                continue
            found.append({"heroId": hero, "name": NAMES[hero], "y": int(ys[y]), "score": round(float(column[y]), 4)})
    return sorted(found, key=lambda row: -row["score"])


def run(source, output, limit=None):
    output.mkdir(parents=True, exist_ok=True)
    files = sorted(source.glob("*.jpg"))
    if limit:
        files = files[:limit]
    big = templates(source, 18)
    small = templates(source, 11)
    rows = []
    for index, file in enumerate(files):
        raw = file.read_bytes()
        with Image.open(file) as im:
            im = im.convert("RGB")
            bscore, by = scan(im, big, 18, 70)
            sscore, sy = scan(im, small, 11, 44)
            large = candidates(bscore, by, .70)
            queue = candidates(sscore, sy, .68)
            # Large portraits identify display animation of the current actor, not a newly elapsed turn.
            current_candidates = [item for item in large if item["y"] >= 680 and item["score"] >= .80]
            active = current_candidates[0] if current_candidates else None
            accepted = []
            for item in queue:
                if active and abs(item["y"]-active["y"]) < 48:
                    continue
                if any(abs(item["y"]-prior["y"]) < 20 for prior in accepted):
                    continue
                accepted.append(item)
            accepted.sort(key=lambda item: item["y"])
            rows.append({"frame": int(file.stem), "file": str(file), "sha256": hashlib.sha256(raw).hexdigest(),
                         "active": active, "queue": accepted,
                         "status": "actor-observed" if active else "no-confident-large-portrait",
                         "queueComplete": False})
        if (index+1) % 200 == 0:
            print(f"processed {index+1}/{len(files)}", flush=True)
    (output / "frames.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    with (output / "frames.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["frame", "sha256", "activeHero", "activeName", "activeY", "confidence", "queueTopToBottom", "status"])
        for row in rows:
            actor = row["active"] or {}
            writer.writerow([row["frame"], row["sha256"], actor.get("heroId"), actor.get("name"), actor.get("y"), actor.get("score"),
                             "|".join(f'{item["name"]}@{item["y"]}:{item["score"]}' for item in row["queue"]), row["status"]])
    # Raw uninterrupted observations, not turn IDs. Gaps and brief animation detections remain visible.
    segments = []
    for row in rows:
        hero = (row["active"] or {}).get("heroId")
        if segments and segments[-1]["heroId"] == hero:
            segments[-1]["end"] = row["frame"]
        else:
            segments.append({"start": row["frame"], "end": row["frame"], "heroId": hero, "name": NAMES.get(hero)})
    (output / "segments.json").write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {"source": str(source), "framesRead": len(rows), "first": rows[0]["frame"], "last": rows[-1]["frame"],
               "confidentActorFrames": sum(row["active"] is not None for row in rows), "segments": len(segments),
               "battleRange": [417, 2972],
               "battleActorFrames": sum(row["active"] is not None for row in rows if 417 <= row["frame"] <= 2972),
               "battleUncertainActorFrames": sum(row["active"] is None for row in rows if 417 <= row["frame"] <= 2972),
               "method": "every frame decoded; native portrait templates; raw y coordinates; no percentage conversion"}
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=ROOT / "out/fourteen-match/full-frame")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(args.source, args.output, args.limit)
