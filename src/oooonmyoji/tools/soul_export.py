"""Desktop soul acquisition: one selected instance, newline JSON progress on stdout."""
import argparse
import json
import sys
import threading
import time

from ..config import load_config
from ..devices.factory import resolve_adb_path
from ..runtime.instances import discover_runtime_instances
from ..souls.acquisition import Adb, Cancelled, DEFAULT_PACKAGE, acquire


def emit(event):
    print(json.dumps(event, ensure_ascii=True, allow_nan=False), flush=True)


def main(acquirer=acquire, label="御魂"):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--instance", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    cancelled = threading.Event()
    deadline = time.monotonic() + 180

    def listen():
        for line in sys.stdin:
            if line.strip() == "cancel": cancelled.set(); return
        cancelled.set()

    threading.Thread(target=listen, daemon=True).start()

    def check():
        if cancelled.is_set(): raise Cancelled()
        if time.monotonic() > deadline: raise ValueError(f"读取{label}超时，请稍后重试")

    def progress(message, completed=None, total=None):
        emit({"type": "progress", "instanceId": args.instance, "message": message,
              "completed": completed, "total": total})

    try:
        progress("正在连接所选实例")
        config = load_config(args.config)
        instances = discover_runtime_instances(config)
        instance = next((item for item in instances if item.id == args.instance), None)
        if instance is None: raise ValueError("所选实例已离线，请刷新实例列表")
        if not instance.adb_serial: raise ValueError("此实例没有可用的 ADB 地址，请检查实例配置")
        adb = Adb(resolve_adb_path(config), instance.adb_serial, check)
        if ":" in instance.adb_serial:
            adb.command("connect", instance.adb_serial)
        if acquirer is acquire:
            result = acquirer(adb, instance.package or DEFAULT_PACKAGE, instance.id, args.output, progress, icon_root=config.root_dir)
        else:
            result = acquirer(adb, instance.package or DEFAULT_PACKAGE, instance.id, args.output, progress)
        emit({"type": "result", "result": result})
    except Cancelled:
        emit({"type": "cancelled"})
    except (Exception,) as exc:
        message = str(exc) if isinstance(exc, ValueError) else "读取失败，当前客户端可能不受支持，请检查游戏和实例后重试"
        emit({"type": "error", "message": message})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
