"""Human approval gate for MCP tools that reach outside the safe read-only scope.

Every tool that executes device input, reads project files, writes files or
deletes files must pass through :class:`ApprovalBroker` first.  The gate is
deliberately **not** an MCP tool: an MCP tool would be callable by the model
itself, so the model could approve its own request.

Two channels can ask the human, and neither can be answered by the model:

* ``desktop`` — the running AutoFlow Studio window, which reuses its own
  ``impact-confirm`` dialog.  The broker drops a request file into
  ``artifacts/mcp-approvals/pending/`` and waits for the user's answer file.
  That directory is in ``files.PROTECTED_DIRS``, so no MCP tool can forge an
  answer; only the desktop app (or the human) writes there.
* ``window`` — a standalone Tk confirmation window, used when the desktop app
  is not running so the factory still works on its own.

The desktop channel is chosen only while the app refreshes its heartbeat file,
and the gate always fails closed: a timeout, a crashed dialog, an unavailable
display or any unexpected error resolve to "denied".
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable

# 风险等级：决定弹窗里的措辞与会话授权的粒度。
RISK_EXECUTE = "execute"
RISK_READ = "read"
RISK_WRITE = "write"
RISK_DELETE = "delete"

RISK_LABELS = {
    RISK_EXECUTE: "执行设备操作（点击 / 滑动 / 输入 / 运行工作流）",
    RISK_READ: "读取项目文件（源码 / 日志 / 运行产物）",
    RISK_WRITE: "写入或覆盖项目文件",
    RISK_DELETE: "删除项目文件",
}

RISK_TITLES = {
    RISK_EXECUTE: "执行设备操作",
    RISK_READ: "读取项目文件",
    RISK_WRITE: "写入项目文件",
    RISK_DELETE: "删除项目文件",
}

RISK_HINTS = {
    RISK_EXECUTE: "批准后会向模拟器发送真实输入事件或启动运行，AI 无法撤销。",
    RISK_READ: "批准后会把选中的文件内容读进对话。",
    RISK_WRITE: "批准后会在项目内写入文件；覆盖前会先备份。",
    RISK_DELETE: "批准后会在项目内删除文件；删除前会先备份。",
}

# 审批模式：ask 询问；allow 自动放行（仅用于本机可信场景与测试）；deny 一律拒绝。
MODE_ASK = "ask"
MODE_ALLOW = "allow"
MODE_DENY = "deny"
MODES = (MODE_ASK, MODE_DENY, MODE_ALLOW)

# 询问通道：auto = 桌面端在跑就用它的弹窗，否则退回独立窗口。
CHANNEL_AUTO = "auto"
CHANNEL_DESKTOP = "desktop"
CHANNEL_WINDOW = "window"
CHANNELS = (CHANNEL_AUTO, CHANNEL_DESKTOP, CHANNEL_WINDOW)

DEFAULT_TIMEOUT_SECONDS = 120.0
_PAYLOAD_PREVIEW_CHARS = 2000

# 与桌面端 src/main/mcpApproval.ts 约定的文件名与有效期。
HEARTBEAT_FILE = "desktop.json"
PENDING_DIRNAME = "pending"
# 桌面端每 2 秒续一次心跳；容忍 10 秒抖动，超过就认为应用已经不在了。
HEARTBEAT_STALE_SECONDS = 10.0
RESULT_POLL_SECONDS = 0.2


@dataclass(frozen=True)
class ApprovalRequest:
    """One pending decision: what the model wants to do, in human words."""

    request_id: str
    tool: str
    risk: str
    summary: str
    payload: dict[str, Any]
    allow_session: bool = True

    @property
    def payload_hash(self) -> str:
        canonical = json.dumps(self.payload, ensure_ascii=False, sort_keys=True, default=str)
        return sha256(canonical.encode("utf-8")).hexdigest()

    def as_document(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "tool": self.tool,
            "risk": self.risk,
            "risk_label": RISK_LABELS.get(self.risk, self.risk),
            "summary": self.summary,
            "payload": self.payload,
            "payload_hash": self.payload_hash,
            "allow_session": self.allow_session,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "server_pid": os.getpid(),
            # 桌面端直接把它交给 createImpactConfirm，因此内容在这里成形，
            # 应用侧不需要知道风险分类与措辞。
            "dialog": self.dialog_document(),
        }

    def dialog_document(self) -> dict[str, Any]:
        """Renderer-ready payload for the desktop app's confirm dialog."""

        items: list[dict[str, str]] = [
            {"label": "影响", "detail": RISK_HINTS.get(self.risk, "")},
            {"label": "工具", "detail": self.tool},
            {"label": "载荷指纹", "detail": self.payload_hash[:12]},
            {"label": "MCP 服务进程", "detail": str(os.getpid())},
            {"label": "请求号", "detail": self.request_id},
        ]
        return {
            "title": f"MCP 操作确认 · {RISK_TITLES.get(self.risk, self.risk)}",
            "summary": self.summary,
            "items": items,
            "preview": preview_text(self.payload),
            "confirmLabel": "允许一次",
            "cancelLabel": "拒绝",
            "extraLabel": "本会话都允许此类" if self.allow_session else None,
            "danger": self.risk in {RISK_EXECUTE, RISK_DELETE},
        }


@dataclass(frozen=True)
class ApprovalDecision:
    approved: bool
    scope: str = "once"
    reason: str = ""
    decided_by: str = "human"

    def as_payload(self) -> dict[str, Any]:
        return {
            "approved": self.approved,
            "scope": self.scope,
            "reason": self.reason,
        }


@dataclass
class ApprovalBroker:
    """Ask the human before a gated tool touches anything outside safe scope."""

    project_root: Path
    state_dir: Path | None = None
    mode: str = MODE_ASK
    channel: str = CHANNEL_AUTO
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    provider: Callable[[ApprovalRequest, float], ApprovalDecision] | None = None
    _session_grants: set[str] = field(default_factory=set, init=False)
    _decisions: list[dict[str, Any]] = field(default_factory=list, init=False)
    _dialog_runner: Callable[[Path, Path, float], subprocess.CompletedProcess[str]] | None = field(default=None, init=False)
    _base: Path = field(default=Path(), init=False)

    def __post_init__(self) -> None:
        self.project_root = Path(self.project_root).resolve()
        base = Path(self.state_dir) if self.state_dir is not None else self.project_root / "artifacts" / "mcp-approvals"
        self._base = base.resolve()
        self.state_dir = self._base
        if self.mode not in MODES:
            raise ValueError(f"unknown approval mode: {self.mode}")
        if self.channel not in CHANNELS:
            raise ValueError(f"unknown approval channel: {self.channel}")

    # ---- introspection -------------------------------------------------

    @property
    def audit_path(self) -> Path:
        return self._base / "audit.jsonl"

    @property
    def pending_dir(self) -> Path:
        return self._base / "pending"

    def session_grants(self) -> list[str]:
        return sorted(self._session_grants)

    def is_granted_for_session(self, *, tool: str, risk: str) -> bool:
        return self._session_key(tool=tool, risk=risk) in self._session_grants

    def info(self) -> dict[str, Any]:
        return {
            "approval_mode": self.mode,
            "approval_channel": self.effective_channel(),
            "approval_channel_setting": self.channel,
            "approval_desktop_connected": self.desktop_is_fresh(),
            "approval_timeout_seconds": self.timeout_seconds,
            "approval_session_grants": self.session_grants(),
            "approval_audit_log": str(self.audit_path),
        }

    # ---- the gate ------------------------------------------------------

    def request(
        self,
        *,
        tool: str,
        risk: str,
        summary: str,
        payload: dict[str, Any],
        allow_session: bool = True,
    ) -> ApprovalDecision:
        """Return the human's decision, defaulting to denial."""

        request = ApprovalRequest(
            request_id=secrets.token_hex(12),
            tool=tool,
            risk=risk,
            summary=summary,
            payload=payload,
            allow_session=allow_session,
        )
        if self.mode == MODE_ALLOW:
            decision = ApprovalDecision(approved=True, scope="session", reason="approval mode is 'allow'", decided_by="policy")
        elif self.mode == MODE_DENY:
            decision = ApprovalDecision(approved=False, scope="once", reason="approval mode is 'deny'", decided_by="policy")
        elif self.is_granted_for_session(tool=tool, risk=risk):
            decision = ApprovalDecision(approved=True, scope="session", reason="granted earlier in this session", decided_by="session-grant")
        else:
            decision = self._ask_human(request)
        self._record(request, decision)
        return decision

    # ---- internals -----------------------------------------------------

    @staticmethod
    def _session_key(*, tool: str, risk: str) -> str:
        return f"{risk}:{tool}"

    def _ask_human(self, request: ApprovalRequest) -> ApprovalDecision:
        """Route the question to the desktop app, or to a standalone window."""

        if self.channel == CHANNEL_WINDOW or (self.channel == CHANNEL_AUTO and not self.desktop_is_fresh()):
            return self._ask_window(request)
        if self.desktop_is_fresh():
            return self._ask_desktop(request)
        return ApprovalDecision(
            approved=False,
            reason="桌面端审批通道不可用（应用未在运行）",
            decided_by="desktop-app",
        )

    # ---- desktop channel ----------------------------------------------

    @property
    def heartbeat_path(self) -> Path:
        return self._base / HEARTBEAT_FILE

    def effective_channel(self) -> str:
        """Which channel a new request would actually use."""

        if self.channel == CHANNEL_WINDOW:
            return CHANNEL_WINDOW
        if self.desktop_is_fresh():
            return CHANNEL_DESKTOP
        return CHANNEL_WINDOW if self.channel == CHANNEL_AUTO else CHANNEL_DESKTOP

    def desktop_is_fresh(self) -> bool:
        """True while the desktop app keeps refreshing its heartbeat file."""

        try:
            payload = json.loads(self.heartbeat_path.read_text(encoding="utf-8"))
            timestamp = float(payload["ts"])
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return False
        return (time.time() - timestamp) <= HEARTBEAT_STALE_SECONDS

    def _ask_desktop(self, request: ApprovalRequest) -> ApprovalDecision:
        """Hand the request to the desktop app and wait for the user's answer."""

        pending = self.pending_dir
        request_path = pending / f"{request.request_id}.request.json"
        result_path = pending / f"{request.request_id}.result.json"
        try:
            pending.mkdir(parents=True, exist_ok=True)
            _atomic_write_json(request_path, request.as_document())
            deadline = time.monotonic() + self.timeout_seconds
            while time.monotonic() < deadline:
                payload = _read_json(result_path)
                if payload is not None:
                    return self._decision_from_payload(payload, requested_by="desktop-app")
                time.sleep(RESULT_POLL_SECONDS)
            return ApprovalDecision(
                approved=False,
                reason=f"桌面端 {self.timeout_seconds:.0f} 秒内没有给出答复",
                decided_by="desktop-app",
            )
        except OSError as exc:
            return ApprovalDecision(approved=False, reason=f"桌面端审批通道不可用：{exc}", decided_by="desktop-app")
        finally:
            for path in (request_path, result_path):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass

    def _decision_from_payload(self, payload: dict[str, Any], *, requested_by: str) -> ApprovalDecision:
        raw = str(payload.get("decision", "deny"))
        if raw == "allow":
            return ApprovalDecision(approved=True, scope="once", reason="用户允许一次", decided_by=requested_by)
        if raw == "allow_session":
            return ApprovalDecision(approved=True, scope="session", reason="用户允许本会话内同类操作", decided_by=requested_by)
        return ApprovalDecision(approved=False, reason=str(payload.get("reason") or "用户拒绝"), decided_by=requested_by)

    def _ask_window(self, request: ApprovalRequest) -> ApprovalDecision:
        runner = self.provider
        if runner is not None:
            try:
                decision = runner(request, self.timeout_seconds)
            except Exception as exc:  # pragma: no cover - defensive
                return ApprovalDecision(approved=False, reason=f"approval provider failed: {exc}")
            return self._normalize(decision, request)

        request_path: Path | None = None
        result_path: Path | None = None
        try:
            self.pending_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                suffix=".request.json",
                prefix=f"{request.request_id}-",
                dir=self.pending_dir,
                delete=False,
            ) as handle:
                json.dump(request.as_document(), handle, ensure_ascii=False, indent=2)
                request_path = Path(handle.name)
            result_path = request_path.with_name(request_path.name.replace(".request.json", ".result.json"))
            completed = self._run_dialog(request_path, result_path)
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout or "").strip()[-400:]
                return ApprovalDecision(approved=False, reason=f"approval window failed: {detail or completed.returncode}")
            if not result_path.is_file():
                return ApprovalDecision(approved=False, reason="approval window returned no decision")
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                return ApprovalDecision(approved=False, reason="approval window returned an invalid decision")
            raw = str(payload.get("decision", "deny"))
            if raw == "allow":
                return ApprovalDecision(approved=True, scope="once", reason="allowed once by the user")
            if raw == "allow_session":
                return ApprovalDecision(approved=True, scope="session", reason="allowed for this session by the user")
            return ApprovalDecision(approved=False, reason=str(payload.get("reason") or "denied by the user"))
        except subprocess.TimeoutExpired:
            return ApprovalDecision(approved=False, reason=f"no answer within {self.timeout_seconds:.0f}s")
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            return ApprovalDecision(approved=False, reason=f"approval window unavailable: {exc}")
        finally:
            for path in (request_path, result_path):
                if path is not None:
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        pass

    def _normalize(self, decision: ApprovalDecision, request: ApprovalRequest) -> ApprovalDecision:
        if decision.approved and decision.scope == "session" and not request.allow_session:
            return ApprovalDecision(approved=True, scope="once", reason=decision.reason, decided_by=decision.decided_by)
        return decision

    def _run_dialog(self, request_path: Path, result_path: Path) -> subprocess.CompletedProcess[str]:
        if self._dialog_runner is not None:  # pragma: no cover - test seam
            return self._dialog_runner(request_path, result_path, self.timeout_seconds)
        command = [
            sys.executable,
            "-m",
            "src.oooonmyoji.mcp.approval_dialog",
            "--request",
            str(request_path),
            "--result",
            str(result_path),
            "--timeout",
            str(self.timeout_seconds),
        ]
        return subprocess.run(
            command,
            cwd=str(self.project_root),
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds + 15.0,
            check=False,
        )

    def _record(self, request: ApprovalRequest, decision: ApprovalDecision) -> None:
        if decision.approved and decision.scope == "session":
            self._session_grants.add(self._session_key(tool=request.tool, risk=request.risk))
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "request_id": request.request_id,
            "tool": request.tool,
            "risk": request.risk,
            "summary": request.summary,
            "payload_hash": request.payload_hash,
            "approved": decision.approved,
            "scope": decision.scope,
            "reason": decision.reason,
            "decided_by": decision.decided_by,
            "pid": os.getpid(),
        }
        self._decisions.append(entry)
        try:
            self.audit_path.parent.mkdir(parents=True, exist_ok=True)
            with self.audit_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError:
            # 审计写不进去不能阻断流程，但会在 server_info 里显式报告。
            pass

    # ---- helpers used by tools ----------------------------------------

    def denial_payload(self, decision: ApprovalDecision, *, tool: str, risk: str) -> dict[str, Any]:
        return {
            "ok": False,
            "code": "approval_required",
            "approved": False,
            "tool": tool,
            "risk": risk,
            "reason": decision.reason,
            "message": "该操作需要在本机弹窗中由用户确认，本次未获批准。",
        }

    def describe_state(self) -> dict[str, Any]:
        """Return a compact view of recent decisions for diagnostics."""

        return {
            "mode": self.mode,
            "timeout_seconds": self.timeout_seconds,
            "session_grants": self.session_grants(),
            "recent_decisions": self._decisions[-10:],
        }


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write a JSON document the desktop app can pick up without reading half of it."""

    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def preview_text(value: Any, limit: int = _PAYLOAD_PREVIEW_CHARS) -> str:
    """Render a payload for the approval window without flooding it."""

    text = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n… （已截断，共 {len(text)} 字符）"


def backup_file(path: Path, backup_root: Path, *, stamp: str | None = None) -> Path | None:
    """Copy an existing file aside so a gated overwrite/delete stays undoable."""

    if not path.is_file():
        return None
    moment = stamp or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = backup_root / moment / path.name
    counter = 1
    while target.exists():
        target = backup_root / moment / f"{path.stem}.{counter}{path.suffix}"
        counter += 1
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    return target


__all__ = [
    "ApprovalBroker",
    "ApprovalDecision",
    "ApprovalRequest",
    "CHANNEL_AUTO",
    "CHANNEL_DESKTOP",
    "CHANNEL_WINDOW",
    "CHANNELS",
    "HEARTBEAT_FILE",
    "HEARTBEAT_STALE_SECONDS",
    "MODE_ALLOW",
    "MODE_ASK",
    "MODE_DENY",
    "MODES",
    "PENDING_DIRNAME",
    "RISK_DELETE",
    "RISK_EXECUTE",
    "RISK_HINTS",
    "RISK_LABELS",
    "RISK_READ",
    "RISK_TITLES",
    "RISK_WRITE",
    "backup_file",
    "preview_text",
]
