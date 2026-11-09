"""Train an experimental single-class Hyakki detector from a YOLO dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("datasets/hyakki/candidates/dataset.yaml"))
    parser.add_argument("--base", type=str, default="yolo11n.pt",
                        help="local pretrained checkpoint or Ultralytics model ID")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="0")
    parser.add_argument("--output", type=Path, default=Path("artifacts/hyakki-training"))
    parser.add_argument("--allow-pseudo-labels", action="store_true",
                        help="required for datasets explicitly marked as unreviewed pseudo-labels")
    args = parser.parse_args()
    if not args.data.is_file():
        parser.error(f"dataset config not found: {args.data}")
    status_path = args.data.parent / "review_status.json"
    status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.is_file() else {}
    if status.get("status") == "pseudo_labels_require_review" and not args.allow_pseudo_labels:
        parser.error("candidate labels require review; pass --allow-pseudo-labels only for an experimental run")
    try:
        import torch
        from ultralytics import YOLO
    except ImportError as exc:
        parser.error(f"install CUDA PyTorch and requirements-yolo.txt first: {exc}")
    if not torch.cuda.is_available() and args.device != "cpu":
        parser.error("CUDA is unavailable; pass --device cpu to use CPU training")
    args.output.mkdir(parents=True, exist_ok=True)
    model = YOLO(args.base, task="detect")
    model.train(data=str(args.data.resolve()), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
                device=args.device, project=str(args.output.resolve()), name="hyakki-experimental",
                workers=4, patience=15, seed=42, deterministic=True, plots=True, exist_ok=True,
                pretrained=True, cache=False)
    weights = args.output / "hyakki-experimental" / "weights" / "best.pt"
    metrics = model.val(data=str(args.data.resolve()), split="val", imgsz=args.imgsz, device=args.device)
    report = {"weights": str(weights.resolve()), "dataset": str(args.data.resolve()),
              "labels_status": status.get("status", "user_dataset"), "device": args.device,
              "map50": float(metrics.box.map50), "map50_95": float(metrics.box.map),
              "precision": float(metrics.box.mp), "recall": float(metrics.box.mr),
              "warning": "Motion-derived labels are unreviewed; metrics measure agreement with pseudo-labels, not true target accuracy."}
    (args.output / "training-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
