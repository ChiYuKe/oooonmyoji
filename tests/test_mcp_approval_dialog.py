"""审批弹窗：主题 token 同步、无需界面的入口路径。"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from src.oooonmyoji.mcp import approval_dialog
from src.oooonmyoji.ui import theme

PROJECT_ROOT = Path(__file__).resolve().parents[1]
THEME_CSS = PROJECT_ROOT / "desktop" / "public" / "theme" / "theme.css"

# theme.py 的键 → theme.css 深色块里的变量名。
TOKEN_SOURCES = {
    "chrome": "--dark-chrome",
    "canvas": "--dark-canvas",
    "header": "--dark-header",
    "selection": "--dark-selection",
    "selection_text": "--dark-selection-text",
    "bg": "--ui-bg",
    "panel": "--ui-panel",
    "field": "--ui-field",
    "surface": "--ui-surface",
    "hover": "--ui-hover",
    "line": "--ui-line",
    "text": "--ui-text",
    "muted": "--ui-muted",
    "focus": "--ui-focus",
    "border": "--border",
    "button": "--button",
    "button_hover": "--button-hover",
    "green": "--green",
    "red": "--red",
    "yellow": "--yellow",
}


def dark_theme_variables() -> dict[str, str]:
    css = THEME_CSS.read_text(encoding="utf-8")
    start = css.index(':root[data-theme="dark"] {')
    block = css[start : css.index("}", start)]
    return {
        match.group(1): match.group(2).strip()
        for match in re.finditer(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", block)
    }


def test_tk_theme_tokens_match_the_desktop_theme() -> None:
    variables = dark_theme_variables()
    mismatched = {
        key: (theme.DARK[key], variables.get(source))
        for key, source in TOKEN_SOURCES.items()
        if variables.get(source, "").lower() != theme.DARK[key].lower()
    }
    assert mismatched == {}, f"src/oooonmyoji/ui/theme.py 与 theme.css 深色主题不一致: {mismatched}"


def test_risk_accents_stay_inside_the_semantic_palette() -> None:
    allowed = {theme.DARK["red"], theme.DARK["yellow"], theme.DARK["muted"], theme.DARK["focus"]}
    assert set(theme.RISK_ACCENT.values()) <= allowed
    assert theme.accent_for("unknown-risk") == theme.DARK["muted"]


def request_document(**overrides: object) -> dict[str, object]:
    document: dict[str, object] = {
        "request_id": "abc123",
        "tool": "run_action",
        "risk": "execute",
        "summary": "执行 Action input.tap：点击 (960, 540)",
        "payload": {"action_name": "input.tap"},
        "payload_hash": "deadbeef",
        "allow_session": True,
        "created_at": "2026-09-27T00:00:00+00:00",
        "server_pid": 1234,
    }
    document.update(overrides)
    return document


def test_auto_deny_writes_a_decision_without_opening_a_window(tmp_path: Path) -> None:
    request_path = tmp_path / "request.json"
    result_path = tmp_path / "result.json"
    request_path.write_text(json.dumps(request_document()), encoding="utf-8")

    exit_code = approval_dialog.main(["--request", str(request_path), "--result", str(result_path), "--auto-deny"])

    assert exit_code == 0
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    assert payload["decision"] == "deny"
    assert payload["reason"] == "auto-deny requested"


def test_unreadable_request_exits_with_code_two(tmp_path: Path) -> None:
    result_path = tmp_path / "result.json"

    missing = tmp_path / "missing.json"
    assert approval_dialog.main(["--request", str(missing), "--result", str(result_path)]) == 2

    invalid = tmp_path / "invalid.json"
    invalid.write_text("{not json", encoding="utf-8")
    assert approval_dialog.main(["--request", str(invalid), "--result", str(result_path)]) == 2

    # 两种情况都必须在开窗之前失败，不能留下任何决定文件。
    assert not result_path.exists()


def test_load_request_rejects_non_objects(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    path.write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(ValueError, match="JSON object"):
        approval_dialog.load_request(path)


def test_write_result_is_atomic_and_keeps_the_reason(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "result.json"
    approval_dialog.write_result(target, "allow_session", "allowed for this session by the user")

    payload = json.loads(target.read_text(encoding="utf-8"))
    assert payload["decision"] == "allow_session"
    assert payload["reason"] == "allowed for this session by the user"
    assert payload["decided_at"]
    assert not list(target.parent.glob("*.tmp"))
