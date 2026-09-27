"""审批门：批准、会话授权、拒绝与失败即关闭。"""

from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path

from src.oooonmyoji.mcp.approval import (
    CHANNEL_AUTO,
    CHANNEL_DESKTOP,
    CHANNEL_WINDOW,
    MODE_ALLOW,
    MODE_DENY,
    RISK_DELETE,
    RISK_EXECUTE,
    RISK_READ,
    RISK_WRITE,
    ApprovalBroker,
    ApprovalDecision,
    ApprovalRequest,
    backup_file,
)


def make_broker(tmp_path: Path, **kwargs: object) -> ApprovalBroker:
    return ApprovalBroker(project_root=tmp_path, state_dir=tmp_path / "state", **kwargs)  # type: ignore[arg-type]


def test_deny_mode_refuses_without_asking(tmp_path: Path) -> None:
    asked: list[str] = []

    def provider(request: object, timeout: float) -> ApprovalDecision:  # pragma: no cover - 不应被调用
        asked.append("asked")
        return ApprovalDecision(approved=True)

    broker = make_broker(tmp_path, mode=MODE_DENY, provider=provider)
    decision = broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击 (1, 2)", payload={"x": 1, "y": 2})

    assert decision.approved is False
    assert asked == []
    payload = broker.denial_payload(decision, tool="tap", risk=RISK_EXECUTE)
    assert payload["ok"] is False
    assert payload["code"] == "approval_required"
    assert payload["approved"] is False
    assert "弹窗" in payload["message"]


def test_allow_mode_skips_the_window(tmp_path: Path) -> None:
    asked: list[str] = []

    def provider(request: object, timeout: float) -> ApprovalDecision:  # pragma: no cover - 不应被调用
        asked.append("asked")
        return ApprovalDecision(approved=False)

    broker = make_broker(tmp_path, mode=MODE_ALLOW, provider=provider)
    decision = broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})

    assert decision.approved is True
    assert decision.decided_by == "policy"
    assert asked == []
    assert broker.is_granted_for_session(tool="tap", risk=RISK_EXECUTE) is True


def test_session_grant_is_scoped_to_one_tool_and_risk(tmp_path: Path) -> None:
    asked: list[str] = []

    def provider(request: object, timeout: float) -> ApprovalDecision:
        asked.append("asked")
        return ApprovalDecision(approved=True, scope="session", reason="用户勾选本会话允许")

    broker = make_broker(tmp_path, provider=provider)
    first = broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})
    second = broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})
    other_tool = broker.request(tool="read_project_file", risk=RISK_READ, summary="读文件", payload={})

    assert first.approved is True and first.scope == "session"
    assert second.approved is True and second.decided_by == "session-grant"
    assert len(asked) == 2  # tap 问过一次，第二次直接放行；另一个工具必须重新询问
    assert other_tool.approved is True
    assert broker.is_granted_for_session(tool="tap", risk=RISK_EXECUTE) is True
    assert broker.is_granted_for_session(tool="tap", risk=RISK_WRITE) is False


def test_session_scope_is_downgraded_when_not_offered(tmp_path: Path) -> None:
    broker = make_broker(
        tmp_path,
        provider=lambda request, timeout: ApprovalDecision(approved=True, scope="session"),
    )
    decision = broker.request(tool="delete_project_file", risk=RISK_WRITE, summary="删除", payload={}, allow_session=False)

    assert decision.approved is True
    assert decision.scope == "once"
    assert broker.is_granted_for_session(tool="delete_project_file", risk=RISK_WRITE) is False


def test_provider_failure_and_denial_both_refuse(tmp_path: Path) -> None:
    def boom(request: object, timeout: float) -> ApprovalDecision:
        raise RuntimeError("provider exploded")

    failing = make_broker(tmp_path, provider=boom)
    assert failing.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={}).approved is False

    denying = make_broker(tmp_path, provider=lambda request, timeout: ApprovalDecision(approved=False, reason="用户点了拒绝"))
    decision = denying.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})
    assert decision.approved is False
    assert decision.reason == "用户点了拒绝"


def _dialog_result(path: Path, decision: str) -> subprocess.CompletedProcess[str]:
    path.write_text(json.dumps({"decision": decision}), encoding="utf-8")
    return subprocess.CompletedProcess(args=["dialog"], returncode=0, stdout="", stderr="")


def test_dialog_decisions_are_translated(tmp_path: Path) -> None:
    for raw, expected_approval, expected_scope in (
        ("allow", True, "once"),
        ("allow_session", True, "session"),
        ("deny", False, "once"),
        ("something-else", False, "once"),
    ):
        broker = make_broker(tmp_path)
        broker._dialog_runner = lambda request_path, result_path, timeout, raw=raw: _dialog_result(result_path, raw)  # type: ignore[assignment]
        decision = broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})
        assert decision.approved is expected_approval, raw
        assert decision.scope == expected_scope, raw


def test_dialog_failures_fail_closed(tmp_path: Path) -> None:
    failing = make_broker(tmp_path)
    failing._dialog_runner = lambda request_path, result_path, timeout: subprocess.CompletedProcess(  # type: ignore[assignment]
        args=["dialog"], returncode=1, stdout="", stderr="Tk is unavailable"
    )
    decision = failing.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})
    assert decision.approved is False
    assert "Tk is unavailable" in decision.reason

    silent = make_broker(tmp_path)
    silent._dialog_runner = lambda request_path, result_path, timeout: subprocess.CompletedProcess(  # type: ignore[assignment]
        args=["dialog"], returncode=0, stdout="", stderr=""
    )
    assert silent.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={}).approved is False

    timeout_broker = make_broker(tmp_path, timeout_seconds=1.0)

    def raise_timeout(request_path: Path, result_path: Path, timeout: float) -> subprocess.CompletedProcess[str]:
        raise subprocess.TimeoutExpired(cmd="dialog", timeout=timeout)

    timeout_broker._dialog_runner = raise_timeout  # type: ignore[assignment]
    decision = timeout_broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})
    assert decision.approved is False
    assert "no answer within" in decision.reason


def test_every_decision_is_audited(tmp_path: Path) -> None:
    broker = make_broker(
        tmp_path,
        provider=lambda request, timeout: ApprovalDecision(approved=request.tool == "tap", scope="once"),
    )
    broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={"x": 1})
    broker.request(tool="write_project_file", risk=RISK_WRITE, summary="写文件", payload={"path": "a.txt"})

    lines = broker.audit_path.read_text(encoding="utf-8").strip().splitlines()
    entries = [json.loads(line) for line in lines]
    assert [entry["tool"] for entry in entries] == ["tap", "write_project_file"]
    assert [entry["approved"] for entry in entries] == [True, False]
    assert entries[0]["risk"] == RISK_EXECUTE
    assert entries[0]["payload_hash"] and entries[0]["summary"] == "点击"
    assert len(broker.describe_state()["recent_decisions"]) == 2


def test_backup_file_copies_existing_file(tmp_path: Path) -> None:
    source = tmp_path / "workflows" / "demo.owf"
    source.parent.mkdir(parents=True)
    source.write_text("original", encoding="utf-8")

    backup = backup_file(source, tmp_path / "artifacts" / "mcp-backups", stamp="20260101T000000Z")

    assert backup is not None
    assert backup.read_text(encoding="utf-8") == "original"
    assert backup.parent.name == "20260101T000000Z"
    assert backup_file(tmp_path / "missing.txt", tmp_path / "backups") is None


# ---- 桌面端通道（复用应用自己的确认弹窗）-------------------------------


def publish_heartbeat(broker: ApprovalBroker, *, age_seconds: float = 0.0) -> None:
    broker.heartbeat_path.parent.mkdir(parents=True, exist_ok=True)
    broker.heartbeat_path.write_text(json.dumps({"ts": time.time() - age_seconds, "pid": 4242}), encoding="utf-8")


def answer_as_desktop_app(broker: ApprovalBroker, decision: str, *, delay: float = 0.0) -> threading.Thread:
    """模拟应用的文件信箱：发现请求文件后写回一个决定。"""

    def run() -> None:
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            pending = broker.pending_dir
            requests = sorted(pending.glob("*.request.json")) if pending.is_dir() else []
            if requests:
                path = requests[0]
                if delay:
                    time.sleep(delay)
                result = path.with_name(path.name.replace(".request.json", ".result.json"))
                result.write_text(json.dumps({"decision": decision, "reason": "test"}), encoding="utf-8")
                return
            time.sleep(0.02)
        raise AssertionError("应用没有等到审批请求文件")

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


def test_fresh_heartbeat_selects_the_desktop_channel(tmp_path: Path) -> None:
    broker = make_broker(tmp_path, channel=CHANNEL_AUTO)
    assert broker.effective_channel() == CHANNEL_WINDOW
    publish_heartbeat(broker)
    assert broker.desktop_is_fresh() is True
    assert broker.effective_channel() == CHANNEL_DESKTOP
    assert broker.info()["approval_desktop_connected"] is True

    publish_heartbeat(broker, age_seconds=60.0)
    assert broker.desktop_is_fresh() is False
    assert broker.effective_channel() == CHANNEL_WINDOW


def test_desktop_answer_is_used_and_audited(tmp_path: Path) -> None:
    broker = make_broker(tmp_path, channel=CHANNEL_DESKTOP, timeout_seconds=8.0)
    publish_heartbeat(broker)
    thread = answer_as_desktop_app(broker, "allow_session")

    decision = broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击 (1, 2)", payload={"x": 1})

    thread.join(timeout=5.0)
    assert decision.approved is True
    assert decision.scope == "session"
    assert decision.decided_by == "desktop-app"
    assert broker.is_granted_for_session(tool="tap", risk=RISK_EXECUTE) is True

    entry = json.loads(broker.audit_path.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert entry["decided_by"] == "desktop-app" and entry["approved"] is True
    # 请求与回执文件都不留残渣。
    assert list(broker.pending_dir.glob("*.json")) == []


def test_desktop_deny_is_respected(tmp_path: Path) -> None:
    broker = make_broker(tmp_path, channel=CHANNEL_DESKTOP, timeout_seconds=8.0)
    publish_heartbeat(broker)
    thread = answer_as_desktop_app(broker, "deny")

    decision = broker.request(tool="write_project_file", risk=RISK_WRITE, summary="写文件", payload={"path": "a.txt"})

    thread.join(timeout=5.0)
    assert decision.approved is False
    assert decision.decided_by == "desktop-app"


def test_desktop_channel_times_out_and_fails_closed(tmp_path: Path) -> None:
    broker = make_broker(tmp_path, channel=CHANNEL_DESKTOP, timeout_seconds=1.0)
    publish_heartbeat(broker)

    decision = broker.request(tool="run_workflow", risk=RISK_EXECUTE, summary="运行工作流", payload={})

    assert decision.approved is False
    assert "没有给出答复" in decision.reason
    assert list(broker.pending_dir.glob("*.json")) == []


def test_desktop_channel_without_heartbeat_refuses_without_asking(tmp_path: Path) -> None:
    asked: list[str] = []
    broker = make_broker(
        tmp_path,
        channel=CHANNEL_DESKTOP,
        timeout_seconds=1.0,
        provider=lambda request, timeout: asked.append("window") or ApprovalDecision(approved=True),
    )

    decision = broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})

    assert decision.approved is False
    assert "桌面端审批通道不可用" in decision.reason
    assert asked == []


def test_auto_channel_falls_back_to_the_standalone_window(tmp_path: Path) -> None:
    asked: list[str] = []
    broker = make_broker(
        tmp_path,
        channel=CHANNEL_AUTO,
        provider=lambda request, timeout: asked.append(request.tool) or ApprovalDecision(approved=True, scope="once"),
    )

    decision = broker.request(tool="tap", risk=RISK_EXECUTE, summary="点击", payload={})

    assert decision.approved is True
    assert asked == ["tap"]


def test_dialog_document_is_ready_for_the_desktop_component() -> None:
    for risk, danger in ((RISK_EXECUTE, True), (RISK_DELETE, True), (RISK_WRITE, False), (RISK_READ, False)):
        request = ApprovalRequest(request_id="abc123", tool="tap", risk=risk, summary="点击 (1, 2)", payload={"x": 1})
        dialog = request.dialog_document()

        assert dialog["title"].startswith("MCP 操作确认 · ")
        assert dialog["summary"] == "点击 (1, 2)"
        assert dialog["confirmLabel"] == "允许一次"
        assert dialog["cancelLabel"] == "拒绝"
        assert dialog["extraLabel"] == "本会话都允许此类"
        assert dialog["danger"] is danger
        assert dialog["preview"] and '"x": 1' in dialog["preview"]
        labels = [item["label"] for item in dialog["items"]]
        assert labels[0] == "影响" and dialog["items"][0]["detail"]
        assert {"工具", "载荷指纹", "MCP 服务进程", "请求号"} <= set(labels)
        assert json.loads(json.dumps(dialog))  # 必须是可序列化的纯 JSON

    no_session = ApprovalRequest(request_id="abc123", tool="tap", risk=RISK_READ, summary="读", payload={}, allow_session=False)
    assert no_session.dialog_document()["extraLabel"] is None
