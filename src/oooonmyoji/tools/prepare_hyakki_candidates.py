"""Create review-required motion-box proposals from captured Hyakki sequences.

These pseudo-labels are deliberately written to a separate directory and must
not be treated as verified annotations for gameplay training.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def boxes_for(image: np.ndarray, previous: np.ndarray) -> list[tuple[int, int, int, int]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    old = cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(cv2.absdiff(gray, old), 24, 255, cv2.THRESH_BINARY)
    mask[:180] = 0
    mask[860:] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 13)), iterations=2)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    boxes = []
    for index in range(1, count):
        x, y, width, height, area = (int(value) for value in stats[index])
        if 500 < area < 60000 and 35 < height < 420 and 24 < width < 320:
            # Exclude the stationary player's sprite, which is the main moving-frame false positive.
            if 790 < x < 1110 and y > 520:
                continue
            boxes.append((x, y, width, height))
    return boxes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("datasets/hyakki/raw"))
    parser.add_argument("--output", type=Path, default=Path("datasets/hyakki/candidates"))
    parser.add_argument("--stride", type=int, default=12)
    args = parser.parse_args()
    if args.stride < 3:
        raise SystemExit("stride must be at least 3 frames")

    args.output.mkdir(parents=True, exist_ok=True)
    names = {"train": "\u9634\u9633\u5e08_7", "val": "\u9634\u9633\u5e08_8"}
    names_path = {value: key for key, value in names.items()}
    summary = {"status": "pseudo_labels_require_review", "class": "target", "stride": args.stride,
               "sequences": {}, "warning": "Motion boxes can include UI/effects and miss stationary targets."}
    preview: dict[str, list[np.ndarray]] = {"train": [], "val": []}
    for sequence in sorted(item for item in args.source.iterdir() if item.is_dir()):
        split = names_path.get(sequence.name)
        if split is None:
            continue
        images_out = args.output / "images" / split
        labels_out = args.output / "labels" / split
        images_out.mkdir(parents=True, exist_ok=True)
        labels_out.mkdir(parents=True, exist_ok=True)
        files = sorted(sequence.glob("*.jpg"))
        saved = with_boxes = 0
        for index in range(0, len(files), args.stride):
            image = cv2.imdecode(np.fromfile(files[index], dtype=np.uint8), cv2.IMREAD_COLOR)
            previous_index = max(0, index - 2)
            previous = cv2.imdecode(np.fromfile(files[previous_index], dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None or previous is None or image.shape[:2] != (1080, 1920):
                continue
            # Both recordings start on the pre-game character selection screen.
            # Keep those screens as negative samples instead of learning the
            # silhouettes and start button as throw targets.
            boxes = boxes_for(image, previous) if index >= 600 else []
            stem = f"{sequence.name}_{index:06d}"
            cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tofile(str(images_out / f"{stem}.jpg"))
            lines = []
            for x, y, width, height in boxes:
                cx, cy = (x + width / 2) / 1920, (y + height / 2) / 1080
                lines.append(f"0 {cx:.6f} {cy:.6f} {width / 1920:.6f} {height / 1080:.6f}")
                cv2.rectangle(image, (x, y), (x + width, y + height), (0, 255, 0), 3)
            (labels_out / f"{stem}.txt").write_text("\n".join(lines), encoding="utf-8")
            saved += 1
            with_boxes += bool(boxes)
            if index % max(args.stride, len(files) // 12) == 0 and len(preview[split]) < 12:
                cv2.putText(image, files[index].name, (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 2,
                            (0, 255, 255), 3, cv2.LINE_AA)
                preview[split].append(cv2.resize(image, (480, 270)))
        summary["sequences"][sequence.name] = {"split": split, "source_frames": len(files),
                                               "sampled_frames": saved, "frames_with_proposals": with_boxes}

    for split, thumbs in preview.items():
        if thumbs:
            while len(thumbs) % 3:
                thumbs.append(np.full_like(thumbs[0], 60))
            sheet = np.vstack([np.hstack(thumbs[index:index + 3]) for index in range(0, len(thumbs), 3)])
            cv2.imencode(".jpg", sheet)[1].tofile(str(args.output / f"{split}_review.jpg"))
    (args.output / "dataset.yaml").write_text(
        f"path: {args.output.resolve().as_posix()}\ntrain: images/train\nval: images/val\nnames:\n  0: target\n",
        encoding="utf-8")
    (args.output / "review_status.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
