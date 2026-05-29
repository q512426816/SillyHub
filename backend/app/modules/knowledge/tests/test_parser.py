"""Unit tests for the knowledge parser."""

from __future__ import annotations

from pathlib import Path

from app.modules.knowledge.parser import KnowledgeParser, parse_md_directory


def test_parse_knowledge_with_files(tmp_path: Path) -> None:
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "INDEX.md").write_text("# Knowledge Index\n\nSome index text.", encoding="utf-8")
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
