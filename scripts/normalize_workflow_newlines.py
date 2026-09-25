"""把 `workflows/*.owf` 的换行统一成 LF（规范定的落盘换行）。

Python 在 Windows 上用文本模式写文件会把 `\\n` 翻译成 `\\r\\n`，迁移脚本早期版本因此写出了
CRLF：解析没问题（读的时候按通用换行处理），但桌面端 emit 出来是 LF，于是**编辑器每次保存
都会重写整个文件**。这个脚本把已有文件就地转回 LF，且内容（除换行外）一字不改。
"""

from __future__ import annotations

import pathlib
import sys

targets = sorted(pathlib.Path("workflows").rglob("*.owf"))
changed = 0
for path in targets:
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if normalized.encode("utf-8") == raw:
        print(f"[跳过] {path}：已经是 LF")
        continue
    path.write_text(normalized, encoding="utf-8", newline="\n")
    changed += 1
    print(f"[改写] {path}：{raw.count(b'\\r\\n')} 处 CRLF → LF")

# 验证：重新读回来必须与 LF 规范化结果一致
for path in targets:
    raw = path.read_bytes()
    if b"\r" in raw:
        raise SystemExit(f"{path} 仍然含 CR")
print(f"\n完成：{changed} 个文件改写，{len(targets)} 个文件确认是 LF。")
sys.exit(0)
