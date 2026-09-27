"""Gated project file access for the MCP server.

The read-only tool set never needed this module.  These helpers exist for the
tools that go beyond it — reading source/logs/artifacts, and writing or deleting
project files — so all of them share one boundary:

* paths must resolve inside the project root;
* ``.git/``, ``.venv/`` and the approval state directory are never writable, so a
  model cannot quietly disable the gate or rewrite its own audit trail;
* every overwrite and every delete is copied to a timestamped backup first, and
  an overwrite is refused when the existing file is too large to back up.
"""

from __future__ import annotations

import codecs
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .approval import backup_file

MAX_READ_BYTES = 400_000
MAX_WRITE_BYTES = 1_000_000
MAX_BACKUP_BYTES = 8_000_000
MAX_ARTIFACT_ENTRIES = 200
DEFAULT_TAIL_LINES = 200

# 永不允许写入 / 删除的目录（相对项目根）。
PROTECTED_DIRS = (".git", ".venv", "artifacts/mcp-approvals")
# 大目录不做备份，写入会被拒绝而不是"备份失败还照写"。
_SKIP_BACKUP_NAMES = ("node_modules",)


@dataclass(frozen=True)
class FileError(Exception):
    """A refusal with a machine readable code, surfaced through the tool payload."""

    code: str
    message: str

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.message

    def payload(self) -> dict[str, Any]:
        return {"ok": False, "code": self.code, "error": self.message}


class ProjectFiles:
    """Read, write, delete and inspect files below the project root."""

    def __init__(self, project_root: Path | str, *, log_dir: Path | str | None = None) -> None:
        self.project_root = Path(project_root).resolve()
        self.log_dir = Path(log_dir).resolve() if log_dir is not None else self.project_root / "logs"
        self.backup_root = self.project_root / "artifacts" / "mcp-backups"

    # ---- path boundary -------------------------------------------------

    def resolve(self, path: str | Path) -> Path:
        candidate = Path(path)
        resolved = candidate.resolve() if candidate.is_absolute() else (self.project_root / candidate).resolve()
        try:
            resolved.relative_to(self.project_root)
        except ValueError as exc:
            raise FileError("path_outside_project", f"path must stay below the project root: {path}") from exc
        return resolved

    def _guard(self, resolved: Path, *, writing: bool) -> None:
        if not writing:
            return
        relative = resolved.relative_to(self.project_root)
        parts = relative.parts
        for protected in PROTECTED_DIRS:
            protected_parts = Path(protected).parts
            if parts[: len(protected_parts)] == protected_parts:
                raise FileError("path_protected", f"refusing to modify protected location: {relative.as_posix()}")

    def relative(self, resolved: Path) -> str:
        return resolved.relative_to(self.project_root).as_posix()

    # ---- read ----------------------------------------------------------

    def read_text(self, path: str, *, max_bytes: int = MAX_READ_BYTES) -> dict[str, Any]:
        if not isinstance(path, str) or not path.strip():
            raise FileError("invalid_path", "path must be a non-empty string")
        resolved = self.resolve(path)
        self._guard(resolved, writing=False)
        if not resolved.is_file():
            raise FileError("not_found", f"file does not exist: {path}")
        if resolved.is_symlink():
            raise FileError("symlink_refused", f"refusing to follow a symlink: {path}")
        size = resolved.stat().st_size
        limit = max(1, min(int(max_bytes), MAX_READ_BYTES))
        payload = resolved.read_bytes()[:limit]
        truncated = size > len(payload)
        # 截断会把最后一个多字节字符切开，而那不是"二进制文件"：用增量解码器
        # 把不完整的尾巴丢掉；只有正文里真的出现非法字节才判为二进制。
        decoder = codecs.getincrementaldecoder("utf-8")()
        try:
            content = decoder.decode(payload, final=not truncated)
        except UnicodeDecodeError as exc:
            raise FileError("binary_unsupported", f"file is not UTF-8 text: {path}") from exc
        return {
            "ok": True,
            "path": self.relative(resolved),
            "size_bytes": size,
            "returned_bytes": len(payload),
            "truncated": truncated,
            "content": content,
        }

    # ---- write ---------------------------------------------------------

    def write_text(self, path: str, content: str, *, overwrite: bool = False) -> dict[str, Any]:
        if not isinstance(path, str) or not path.strip():
            raise FileError("invalid_path", "path must be a non-empty string")
        if not isinstance(content, str):
            raise FileError("invalid_content", "content must be a string")
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_WRITE_BYTES:
            raise FileError("content_too_large", f"content exceeds {MAX_WRITE_BYTES} bytes")
        resolved = self.resolve(path)
        self._guard(resolved, writing=True)
        if resolved.is_dir():
            raise FileError("is_directory", f"path is a directory: {path}")
        if resolved.exists() and not overwrite:
            return {
                "ok": False,
                "code": "file_exists",
                "saved": False,
                "path": self.relative(resolved),
                "message": "file already exists; pass overwrite=true to replace it",
            }
        backup = self._backup(resolved)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        payload = encoded
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=f".{resolved.stem}.",
                suffix=".tmp",
                dir=resolved.parent,
                delete=False,
            ) as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
                temporary_path = Path(handle.name)
            os.replace(temporary_path, resolved)
        except OSError as exc:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
            raise FileError("write_failed", f"unable to write {path}: {exc}") from exc
        return {
            "ok": True,
            "saved": True,
            "path": self.relative(resolved),
            "size_bytes": len(payload),
            "overwritten": backup is not None,
            "backup": self.relative(backup) if backup is not None else None,
        }

    def delete(self, path: str) -> dict[str, Any]:
        if not isinstance(path, str) or not path.strip():
            raise FileError("invalid_path", "path must be a non-empty string")
        resolved = self.resolve(path)
        self._guard(resolved, writing=True)
        if resolved.is_dir():
            raise FileError("is_directory", f"refusing to delete a directory: {path}")
        if not resolved.exists():
            raise FileError("not_found", f"file does not exist: {path}")
        backup = self._backup(resolved)
        try:
            resolved.unlink()
        except OSError as exc:
            raise FileError("delete_failed", f"unable to delete {path}: {exc}") from exc
        return {
            "ok": True,
            "deleted": True,
            "path": self.relative(resolved),
            "backup": self.relative(backup) if backup is not None else None,
        }

    def _backup(self, resolved: Path) -> Path | None:
        if not resolved.is_file():
            return None
        size = resolved.stat().st_size
        if size > MAX_BACKUP_BYTES:
            raise FileError(
                "backup_too_large",
                f"refusing to replace {self.relative(resolved)}: {size} bytes exceeds the {MAX_BACKUP_BYTES} byte backup limit",
            )
        if any(part in _SKIP_BACKUP_NAMES for part in resolved.parts):
            raise FileError("backup_skipped_location", f"refusing to replace files below {_SKIP_BACKUP_NAMES[0]}")
        return backup_file(resolved, self.backup_root)

    # ---- inspection ----------------------------------------------------

    def list_artifacts(self, *, subdir: str | None = None, limit: int = 50) -> dict[str, Any]:
        root = self.project_root / "artifacts"
        target = root if not subdir else self.resolve(f"artifacts/{subdir}")
        if not target.is_dir():
            return {"ok": True, "root": self.relative(root), "entries": [], "count": 0}
        try:
            target.relative_to(root.resolve())
        except ValueError as exc:
            raise FileError("path_outside_artifacts", "subdir must stay below artifacts/") from exc

        entries: list[dict[str, Any]] = []
        for path in target.rglob("*"):
            if not path.is_file():
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            entries.append(
                {
                    "path": self.relative(path),
                    "size_bytes": stat.st_size,
                    "modified_at": int(stat.st_mtime),
                }
            )
        entries.sort(key=lambda item: item["modified_at"], reverse=True)
        capped = entries[: max(1, min(int(limit), MAX_ARTIFACT_ENTRIES))]
        return {"ok": True, "root": self.relative(root), "count": len(entries), "entries": capped, "truncated": len(entries) > len(capped)}

    def tail_log(self, *, name: str | None = None, lines: int = DEFAULT_TAIL_LINES) -> dict[str, Any]:
        count = max(1, min(int(lines), 2000))
        if name:
            resolved = self.resolve(name)
            try:
                resolved.relative_to(self.log_dir)
            except ValueError as exc:
                raise FileError("path_outside_logs", "name must point to a file below the configured log directory") from exc
        else:
            candidates = sorted(
                (path for path in self.log_dir.glob("**/*") if path.is_file()),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            ) if self.log_dir.is_dir() else []
            if not candidates:
                return {"ok": True, "log_dir": str(self.log_dir), "log": None, "lines": []}
            resolved = candidates[0]
        if not resolved.is_file():
            raise FileError("not_found", f"log file does not exist: {name}")
        with resolved.open("r", encoding="utf-8", errors="replace") as handle:
            tail = handle.readlines()[-count:]
        return {
            "ok": True,
            "log_dir": str(self.log_dir),
            "log": str(resolved),
            "size_bytes": resolved.stat().st_size,
            "lines": [line.rstrip("\n") for line in tail],
        }

    def backup_index(self, *, limit: int = 50) -> dict[str, Any]:
        """List backups taken by gated writes and deletes."""

        if not self.backup_root.is_dir():
            return {"ok": True, "backups": [], "count": 0}
        entries: list[dict[str, Any]] = []
        for path in sorted(self.backup_root.rglob("*")):
            if path.is_file():
                entries.append({"path": self.relative(path), "size_bytes": path.stat().st_size, "modified_at": int(path.stat().st_mtime)})
        entries.sort(key=lambda item: item["modified_at"], reverse=True)
        return {"ok": True, "count": len(entries), "backups": entries[: max(1, min(int(limit), MAX_ARTIFACT_ENTRIES))]}


def summarize_payload(payload: Any, limit: int = 300) -> str:
    """One-line rendering used inside approval summaries."""

    text = json.dumps(payload, ensure_ascii=False, default=str)
    return text if len(text) <= limit else f"{text[:limit]}…"


__all__ = [
    "DEFAULT_TAIL_LINES",
    "FileError",
    "MAX_BACKUP_BYTES",
    "MAX_READ_BYTES",
    "MAX_WRITE_BYTES",
    "PROTECTED_DIRS",
    "ProjectFiles",
    "summarize_payload",
]
