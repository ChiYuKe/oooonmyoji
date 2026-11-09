"""Persistent YOLO worker used by the desktop live-view detector."""

from __future__ import annotations

import argparse
import base64
import contextlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    args = parser.parse_args()
    if not args.model.is_file():
        emit({"type": "fatal", "error": f"模型文件不存在：{args.model}"})
        return 2

    config_directory = Path.cwd() / "artifacts" / "yolo-config"
    config_directory.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(config_directory))

    try:
        import cv2
        import numpy as np
        import torch
        from ultralytics import YOLO

        if not torch.cuda.is_available():
            emit({"type": "fatal", "error": "CUDA 不可用。YOLO 实时监测需要已配置的 NVIDIA GPU 环境。"})
            return 3
        with contextlib.redirect_stdout(sys.stderr):
            model = YOLO(str(args.model), task="detect")
            model.predict(np.zeros((640, 640, 3), dtype=np.uint8), conf=0.25,
                          imgsz=640, device=0, verbose=False)
        torch.cuda.synchronize()
        emit({"type": "ready", "model": str(args.model), "device": torch.cuda.get_device_name(0)})
    except Exception as exc:
        emit({"type": "fatal", "error": f"YOLO 模型加载失败：{exc}"})
        return 4

    for line in sys.stdin:
        request: Any = {}
        try:
            request = json.loads(line)
            request_id = request.get("id")
            encoded = request.get("image")
            if not isinstance(request_id, int) or not isinstance(encoded, str):
                raise ValueError("无效的检测请求")
            raw = base64.b64decode(encoded, validate=True)
            image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                raise ValueError("无法读取实时画面")
            confidence = min(0.95, max(0.05, float(request.get("confidence", 0.25))))
            started = time.perf_counter()
            with contextlib.redirect_stdout(sys.stderr):
                results = model.predict(image, conf=confidence, imgsz=640, device=0, verbose=False)
            torch.cuda.synchronize()
            result = results[0]
            names = result.names
            detections = []
            if result.boxes is not None:
                for box in result.boxes:
                    xyxy = [round(float(value), 2) for value in box.xyxy[0].tolist()]
                    class_id = int(box.cls.item())
                    detections.append({
                        "classId": class_id,
                        "label": str(names.get(class_id, class_id) if isinstance(names, dict) else names[class_id]),
                        "confidence": round(float(box.conf.item()), 4),
                        "box": xyxy,
                    })
            emit({
                "type": "result",
                "id": request_id,
                "detections": detections,
                "inferenceMs": round((time.perf_counter() - started) * 1000, 2),
            })
        except Exception as exc:
            emit({"type": "error", "id": request.get("id") if isinstance(request, dict) else None,
                  "error": f"YOLO 检测失败：{exc}"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
