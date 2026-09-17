"""Unit tests for the knowledge parser."""

from __future__ import annotations

from pathlib import Path

from app.modules.knowledge.parser import KnowledgeParser, parse_md_directory


def test_parse_knowledge_with_files(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "INDEX.md").write_text(
        "# Knowledge Index\n\nSome index text.", encoding="utf-8"
    )
    (knowledge_dir / "cors.md").write_text("# CORS Notes\n\nCross-origin stuff.", encoding="utf-8")

    entries = parse_md_directory(knowledge_dir, tmp_path, ".sillyspec/knowledge")
    assert len(entries) == 2
    filenames = [e.filename for e in entries]
    assert "INDEX.md" in filenames
    assert "cors.md" in filenames
    idx_entry = next(e for e in entries if e.filename == "INDEX.md")
    assert idx_entry.title == "Knowledge Index"
    cors_entry = next(e for e in entries if e.filename == "cors.md")
    assert "CORS" in (cors_entry.content or "")


def test_parse_empty_directory(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    entries = parse_md_directory(knowledge_dir, tmp_path, ".sillyspec/knowledge")
    assert entries == []


def test_parse_nonexistent_directory(tmp_path: Path) -> None:
    entries = parse_md_directory(tmp_path / "nope", tmp_path, ".sillyspec/knowledge")
    assert entries == []


def test_parse_knowledge_recursive_with_zones(tmp_path: Path) -> None:
    """task-01（2026-09-17-knowledge-precipitation / D-004@v1）：parse_knowledge
    递归 rglob 扫子目录，zone 由 filename 首段派生，四值全覆盖。"""
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    (knowledge_dir / "decisions").mkdir(parents=True)
    (knowledge_dir / "generated").mkdir()
    (knowledge_dir / "proposed").mkdir()
    (knowledge_dir / "INDEX.md").write_text("# Index\nTop level.", encoding="utf-8")
    (knowledge_dir / "decisions" / "daemon.md").write_text("# 决策\nD-001", encoding="utf-8")
    (knowledge_dir / "generated" / "daemon-client.md").write_text("# 自动\nG", encoding="utf-8")
    (knowledge_dir / "proposed" / "agent-proposal.md").write_text("# 候选\nP", encoding="utf-8")

    entries = parser.parse_knowledge(tmp_path)
    assert len(entries) == 4
    by_filename = {e.filename: e for e in entries}
    assert set(by_filename) == {
        "INDEX.md",
        "decisions/daemon.md",
        "generated/daemon-client.md",
        "proposed/agent-proposal.md",
    }
    # zone 由 filename 首段派生：decisions/generated/proposed 之外归 top
    assert by_filename["INDEX.md"].zone == "top"
    assert by_filename["decisions/daemon.md"].zone == "decisions"
    assert by_filename["generated/daemon-client.md"].zone == "generated"
    assert by_filename["proposed/agent-proposal.md"].zone == "proposed"
    # path 保留 .sillyspec/knowledge/ 前缀拼完整相对路径
    assert by_filename["INDEX.md"].path == ".sillyspec/knowledge/INDEX.md"
    assert by_filename["decisions/daemon.md"].path == ".sillyspec/knowledge/decisions/daemon.md"
    assert (
        by_filename["generated/daemon-client.md"].path
        == ".sillyspec/knowledge/generated/daemon-client.md"
    )
    assert (
        by_filename["proposed/agent-proposal.md"].path
        == ".sillyspec/knowledge/proposed/agent-proposal.md"
    )
    # 子目录条目标题仍取正文第一个 # 行
    assert by_filename["decisions/daemon.md"].title == "决策"


def test_parse_knowledge_top_level_values_regression(tmp_path: Path) -> None:
    """回归断言：顶层条目 filename 与 path 值和改造前逐字一致（D-007@v1 兼容承诺）。"""
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "INDEX.md").write_text("# Knowledge Index\n\n> Reference.", encoding="utf-8")
    (knowledge_dir / "cors.md").write_text("# CORS Notes\n\nCross-origin stuff.", encoding="utf-8")
    # 加子目录证明递归不污染顶层条目取值
    (knowledge_dir / "decisions").mkdir()
    (knowledge_dir / "decisions" / "d.md").write_text("# D", encoding="utf-8")

    entries = parser.parse_knowledge(tmp_path)
    by_filename = {e.filename: e for e in entries}
    # 顶层条目 filename 仍是裸文件名（不含子目录段），path 前缀/拼接格式不变
    top = by_filename["INDEX.md"]
    assert top.filename == "INDEX.md"
    assert top.path == ".sillyspec/knowledge/INDEX.md"
    assert top.zone == "top"
    top2 = by_filename["cors.md"]
    assert top2.filename == "cors.md"
    assert top2.path == ".sillyspec/knowledge/cors.md"
    # 子目录条目按含子目录段的 filename 呈现
    assert by_filename["decisions/d.md"].filename == "decisions/d.md"
    assert by_filename["decisions/d.md"].path == ".sillyspec/knowledge/decisions/d.md"


def test_cross_zone_same_name_filenames_stay_unique(tmp_path: Path) -> None:
    """跨目录同名文件：含子目录段的 filename 值天然唯一（get 精确匹配无歧义）。"""
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    (knowledge_dir / "decisions").mkdir(parents=True)
    (knowledge_dir / "notes.md").write_text("# Top Notes", encoding="utf-8")
    (knowledge_dir / "decisions" / "notes.md").write_text("# Decision Notes", encoding="utf-8")

    entries = parser.parse_knowledge(tmp_path)
    by_filename = {e.filename: e for e in entries}
    assert set(by_filename) == {"notes.md", "decisions/notes.md"}
    assert by_filename["notes.md"].title == "Top Notes"
    assert by_filename["notes.md"].zone == "top"
    assert by_filename["decisions/notes.md"].title == "Decision Notes"
    assert by_filename["decisions/notes.md"].zone == "decisions"


def test_parse_quicklog_stays_non_recursive(tmp_path: Path) -> None:
    """quicklog 解析零改动：子目录条目不进入解析结果，filename 仍为裸文件名。"""
    parser = KnowledgeParser()
    quicklog_dir = tmp_path / "quicklog"
    (quicklog_dir / "sub").mkdir(parents=True)
    (quicklog_dir / "2026-01-15.md").write_text("# Quicklog\nTop", encoding="utf-8")
    (quicklog_dir / "sub" / "nested.md").write_text("# Nested", encoding="utf-8")

    entries = parser.parse_quicklog(tmp_path)
    assert [e.filename for e in entries] == ["2026-01-15.md"]
    assert entries[0].path == ".sillyspec/quicklog/2026-01-15.md"


def test_parse_md_directory_default_not_recursive(tmp_path: Path) -> None:
    """parse_md_directory 开关默认关：直接调用（既有 quicklog/测试路径）不递归。"""
    knowledge_dir = tmp_path / "knowledge"
    (knowledge_dir / "decisions").mkdir(parents=True)
    (knowledge_dir / "top.md").write_text("# Top", encoding="utf-8")
    (knowledge_dir / "decisions" / "d.md").write_text("# D", encoding="utf-8")

    entries = parse_md_directory(knowledge_dir, tmp_path, ".sillyspec/knowledge")
    assert [e.filename for e in entries] == ["top.md"]
    assert entries[0].path == ".sillyspec/knowledge/top.md"


def test_knowledge_parser_convenience_methods(tmp_path: Path) -> None:
    parser = KnowledgeParser()
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "test.md").write_text("# Test\nContent", encoding="utf-8")

    quicklog_dir = tmp_path / "quicklog"
    quicklog_dir.mkdir()
    (quicklog_dir / "log.md").write_text("# Log\nEntry", encoding="utf-8")

    k_entries = parser.parse_knowledge(tmp_path)
    assert len(k_entries) == 1
    assert k_entries[0].filename == "test.md"

    q_entries = parser.parse_quicklog(tmp_path)
    assert len(q_entries) == 1
    assert q_entries[0].filename == "log.md"


def test_path_traversal_rejected(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    (outside_dir / "evil.md").write_text("# Evil\nContent", encoding="utf-8")

    entries = parse_md_directory(outside_dir, knowledge_dir, ".sillyspec/knowledge")
    assert entries == []


def test_read_file_safe_small_file(tmp_path: Path) -> None:
    from app.modules.knowledge.parser import _read_file_safe

    f = tmp_path / "small.md"
    f.write_text("# Small\nContent", encoding="utf-8")
    content, truncated = _read_file_safe(f)
    assert truncated is False
    assert content == "# Small\nContent"


def test_read_file_safe_large_file_truncates_without_full_read(tmp_path: Path) -> None:
    """超大文件只读取前 MAX_CONTENT_BYTES // 4 字节，不整文件读入内存（OOM 防护）。"""
    from app.modules.knowledge.parser import MAX_CONTENT_BYTES, _read_file_safe

    f = tmp_path / "large.md"
    # 纯 ASCII（1 字节 = 1 字符），超过 MAX_CONTENT_BYTES
    f.write_bytes(b"a" * (MAX_CONTENT_BYTES + 100))
    content, truncated = _read_file_safe(f)
    limit = MAX_CONTENT_BYTES // 4
    assert truncated is True
    # 只读了前 limit 字节，而不是整文件后再切片
    assert len(content) == limit
