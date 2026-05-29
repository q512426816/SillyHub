"""Filesystem parser for ``.sillyspec/knowledge/`` and ``.sillyspec/quicklog/`` directories."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

MAX_CONTENT_BYTES = 1_000_000


@dataclass
class ParsedEntry:
    filename: str
    path: str
    title: str | None = None
    content: str | None = None
    last_modified_at: datetime | None = None


def _extract_title(content: str) -> str | None:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("# ").strip() or None
    return None


def _read_file_safe(path: Path) -> tuple[str, bool]:
    size = path.stat().st_size
    if size > MAX_CONTENT_BYTES:
        return path.read_text(encoding="utf-8", errors="replace")[: MAX_CONTENT_BYTES // 4], True
    return path.read_text(encoding="utf-8", errors="replace"), False


def parse_md_directory(directory: Path, sillyspec_root: Path, rel_prefix: str) -> list[ParsedEntry]:
    """Parse all ``*.md`` files in a directory, sorted by name."""
    if not directory.is_dir():
        return []

    entries: list[ParsedEntry] = []
    for md_file in sorted(directory.glob("*.md")):
        try:
            resolved = md_file.resolve()
            if not str(resolved).startswith(str(sillyspec_root.resolve())):
                continue
        except (OSError, ValueError):
            continue

        if not md_file.is_file():
            continue

        try:
            content, _ = _read_file_safe(md_file)
        except OSError:
            continue

        rel_path = f"{rel_prefix}/{md_file.name}"
        title = _extract_title(content)
        try:
            mtime = datetime.utcfromtimestamp(md_file.stat().st_mtime)
        except OSError:
            mtime = None

        entries.append(ParsedEntry(
            filename=md_file.name,
            path=rel_path,
            title=title,
            content=content,
            last_modified_at=mtime,
        ))

    return entries


class KnowledgeParser:
    """Parses ``.sillyspec/knowledge/`` and ``.sillyspec/quicklog/`` directories."""

    def parse_knowledge(self, sillyspec_root: Path) -> list[ParsedEntry]:
        return parse_md_directory(
            sillyspec_root / "knowledge", sillyspec_root, ".sillyspec/knowledge"
        )

    def parse_quicklog(self, sillyspec_root: Path) -> list[ParsedEntry]:
        return parse_md_directory(
            sillyspec_root / "quicklog", sillyspec_root, ".sillyspec/quicklog"
        )
