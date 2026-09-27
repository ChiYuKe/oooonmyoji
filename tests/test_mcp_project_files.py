"""受控文件访问：边界、备份与保护目录。"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.oooonmyoji.mcp.files import MAX_WRITE_BYTES, FileError, ProjectFiles


def make_files(tmp_path: Path) -> ProjectFiles:
    (tmp_path / "artifacts").mkdir(exist_ok=True)
    (tmp_path / "logs").mkdir(exist_ok=True)
    return ProjectFiles(tmp_path, log_dir=tmp_path / "logs")


def test_read_returns_text_and_flags_truncation(tmp_path: Path) -> None:
    files = make_files(tmp_path)
    target = tmp_path / "src" / "demo.py"
    target.parent.mkdir()
    target.write_text("print('hello')\n" * 10, encoding="utf-8")

    full = files.read_text("src/demo.py")
    assert full["ok"] is True
    assert full["path"] == "src/demo.py"
    assert full["truncated"] is False
    assert "print('hello')" in full["content"]

    partial = files.read_text("src/demo.py", max_bytes=8)
    assert partial["truncated"] is True
    assert partial["returned_bytes"] == 8


def test_read_truncation_never_splits_a_character_into_a_binary_error(tmp_path: Path) -> None:
    files = make_files(tmp_path)
    target = tmp_path / "notes.md"
    target.write_text("中文内容很长" * 20, encoding="utf-8")

    # 逐字节尝试所有截断点：切开多字节字符时也必须给出可读文本，而不是报二进制。
    full_text = "中文内容很长" * 20
    for limit in range(1, 30):
        result = files.read_text("notes.md", max_bytes=limit)
        assert result["ok"] is True, limit
        assert result["truncated"] is True, limit
        assert full_text.startswith(result["content"]), limit
        # 只允许丢掉被切开的那 0–2 个尾字节，不能多丢。
        assert len(result["content"].encode("utf-8")) > limit - 3, limit

    full = files.read_text("notes.md", max_bytes=10_000)
    assert full["truncated"] is False
    assert full["content"] == "中文内容很长" * 20


def test_read_refuses_outside_project_binary_and_missing(tmp_path: Path) -> None:
    files = make_files(tmp_path)
    (tmp_path / "blob.bin").write_bytes(b"\xff\xfe\x00\x00")

    with pytest.raises(FileError) as outside:
        files.read_text("../outside.txt")
    assert outside.value.code == "path_outside_project"

    with pytest.raises(FileError) as binary:
        files.read_text("blob.bin")
    assert binary.value.code == "binary_unsupported"

    with pytest.raises(FileError) as missing:
        files.read_text("nope.txt")
    assert missing.value.code == "not_found"


def test_write_creates_then_requires_overwrite_and_keeps_backup(tmp_path: Path) -> None:
    files = make_files(tmp_path)

    created = files.write_text("notes/hello.txt", "first")
    assert created["ok"] is True and created["saved"] is True
    assert (tmp_path / "notes" / "hello.txt").read_text(encoding="utf-8") == "first"
    assert created["backup"] is None

    refused = files.write_text("notes/hello.txt", "second")
    assert refused["ok"] is False and refused["code"] == "file_exists"
    assert (tmp_path / "notes" / "hello.txt").read_text(encoding="utf-8") == "first"

    replaced = files.write_text("notes/hello.txt", "second", overwrite=True)
    assert replaced["ok"] is True and replaced["overwritten"] is True
    assert (tmp_path / "notes" / "hello.txt").read_text(encoding="utf-8") == "second"
    backup = tmp_path / replaced["backup"]
    assert backup.read_text(encoding="utf-8") == "first"


def test_write_refuses_protected_paths_and_oversized_content(tmp_path: Path) -> None:
    files = make_files(tmp_path)
    for path in (".git/config", ".venv/pyvenv.cfg", "artifacts/mcp-approvals/audit.jsonl"):
        with pytest.raises(FileError) as refused:
            files.write_text(path, "tampering")
        assert refused.value.code == "path_protected", path
        assert not (tmp_path / path).exists()

    with pytest.raises(FileError) as too_large:
        files.write_text("big.txt", "x" * (MAX_WRITE_BYTES + 1))
    assert too_large.value.code == "content_too_large"


def test_write_refuses_escaping_the_project(tmp_path: Path) -> None:
    files = make_files(tmp_path)
    with pytest.raises(FileError) as escaped:
        files.write_text("../escape.txt", "nope")
    assert escaped.value.code == "path_outside_project"
    assert not (tmp_path.parent / "escape.txt").exists()


def test_delete_keeps_a_backup(tmp_path: Path) -> None:
    files = make_files(tmp_path)
    target = tmp_path / "workflows" / "generated" / "demo.owf"
    target.parent.mkdir(parents=True)
    target.write_text("workflow", encoding="utf-8")

    result = files.delete("workflows/generated/demo.owf")
    assert result["ok"] is True and result["deleted"] is True
    assert not target.exists()
    assert (tmp_path / result["backup"]).read_text(encoding="utf-8") == "workflow"

    with pytest.raises(FileError) as missing:
        files.delete("workflows/generated/demo.owf")
    assert missing.value.code == "not_found"


def test_delete_refuses_directories_protected_paths_and_escape(tmp_path: Path) -> None:
    files = make_files(tmp_path)
    (tmp_path / "somewhere").mkdir()
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "HEAD").write_text("ref: refs/heads/main", encoding="utf-8")

    with pytest.raises(FileError) as directory:
        files.delete("somewhere")
    assert directory.value.code == "is_directory"

    with pytest.raises(FileError) as protected:
        files.delete(".git/HEAD")
    assert protected.value.code == "path_protected"

    with pytest.raises(FileError) as escaped:
        files.delete("../outside.txt")
    assert escaped.value.code == "path_outside_project"


def test_large_file_is_not_overwritten_without_a_backup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import src.oooonmyoji.mcp.files as files_module

    files = make_files(tmp_path)
    target = tmp_path / "huge.bin"
    target.write_bytes(b"0" * 10)
    # 把备份上限压到 4 字节，验证"备份不了就不许覆盖"。
    monkeypatch.setattr(files_module, "MAX_BACKUP_BYTES", 4)

    with pytest.raises(FileError) as refused:
        files.write_text("huge.bin", "small", overwrite=True)
    assert refused.value.code == "backup_too_large"
    assert target.read_bytes() == b"0" * 10


def test_list_artifacts_and_tail_log(tmp_path: Path) -> None:
    files = make_files(tmp_path)
    run_dir = tmp_path / "artifacts" / "runs"
    run_dir.mkdir(parents=True)
    (run_dir / "abc.json").write_text("{}", encoding="utf-8")
    (run_dir / "events.jsonl").write_text("{}", encoding="utf-8")
    log = tmp_path / "logs" / "events-2026-09-27.jsonl"
    log.write_text("\n".join(f"line-{index}" for index in range(20)), encoding="utf-8")

    listed = files.list_artifacts(subdir="runs", limit=10)
    assert listed["ok"] is True
    assert listed["count"] == 2
    assert {entry["path"] for entry in listed["entries"]} == {"artifacts/runs/abc.json", "artifacts/runs/events.jsonl"}

    tail = files.tail_log(lines=3)
    assert tail["ok"] is True
    assert tail["lines"] == ["line-17", "line-18", "line-19"]
    assert tail["log"].endswith("events-2026-09-27.jsonl")

    empty = ProjectFiles(tmp_path, log_dir=tmp_path / "no-logs").tail_log()
    assert empty["lines"] == []

    with pytest.raises(FileError) as outside_logs:
        files.tail_log(name="src/oooonmyoji/mcp/files.py")
    assert outside_logs.value.code == "path_outside_logs"
