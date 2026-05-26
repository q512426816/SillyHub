"""Filesystem parser for ``changes/{location}/{change_key}/tasks/``.

Reads ``task-*.md`` files from a change's tasks subdirectory, parses their
frontmatter, and returns structured records for DB persistence. Also reads
``tasks.md`` for supplementary table data (though frontmatter in individual
files takes precedence).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import frontmatter

from app.core.logging import get_logger

log = get_logger(__name__)

VALID_STATUSES = frozenset(
    {"draft", "ready", "in_progress", "review", "done", "cancelled"}
)


@dataclass
class TaskParseWarning:
    code: str
    detail: str
    task_key: str | None = None


@dataclass
class ParsedTask:
    task_key: str
    title: str | None = None
    status: str = "draft"
    phase: str | None = None
    priority: str | None = None
    owner_key: str | None = None
    estimated_hours: float | None = None
    affected_components: list[str] = field(default_factory=list)
    allowed_paths: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    blocks: list[str] = field(default_factory=list)
    path: str | None = None
    content: str | None = None


@dataclass
class TaskParserResult:
    tasks: list[ParsedTask] = field(default_factory=list)
    warnings: list[TaskParseWarning] = field(default_factory=list)


class TaskParser:
    """Parses task files from a change's ``tasks/`` subdirectory."""

    def parse_tasks(
        self,
        sillyspec_root: Path,
        change_rel_path: str,
    ) -> TaskParserResult:
        """Parse all task files under ``{sillyspec_root}/{change_rel_path}/tasks/``.

        Args:
            sillyspec_root: Absolute path to workspace root.
            change_rel_path: Relative path like ``.sillyspec/changes/change/{key}``.
        """
        result = TaskParserResult()
        tasks_dir = sillyspec_root / change_rel_path / "tasks"

        if not tasks_dir.is_dir():
            return result

        seen_keys: set[str] = set()

        for md_file in sorted(tasks_dir.glob("task-*.md")):
            # Path traversal guard
            try:
                resolved = md_file.resolve()
                root_resolved = sillyspec_root.resolve()
                if not str(resolved).startswith(str(root_resolved)):
                    result.warnings.append(
                        TaskParseWarning(
                            code="PATH_TRAVERSAL",
                            detail=f"Skipping file outside root: {md_file}",
                        )
                    )
                    continue
            except (OSError, ValueError):
                continue

            # Extract task_key from filename (e.g. task-01.md -> task-01)
            task_key = md_file.stem
            if task_key in seen_keys:
                result.warnings.append(
                    TaskParseWarning(
                        code="DUPLICATE_TASK_KEY",
                        detail=f"Duplicate task key '{task_key}', skipping",
                        task_key=task_key,
                    )
                )
                continue
            seen_keys.add(task_key)

            parsed = self._parse_task_file(
                md_file,
                rel_path=f"{change_rel_path}/tasks/{md_file.name}",
            )
            result.tasks.append(parsed)
            if parsed.status not in VALID_STATUSES:
                result.warnings.append(
                    TaskParseWarning(
                        code="INVALID_STATUS",
                        detail=f"Unknown status '{parsed.status}' for {task_key}",
                        task_key=task_key,
                    )
                )

        return result

    def _parse_task_file(
        self,
        md_file: Path,
        rel_path: str,
    ) -> ParsedTask:
        """Parse a single task-xx.md file."""
        task_key = md_file.stem
        fallback_title = task_key

        # Try to read file content
        try:
            raw = md_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ParsedTask(
                task_key=task_key,
                title=fallback_title,
                path=rel_path,
            )

        # Try frontmatter parsing
        try:
            post = frontmatter.loads(raw)
            has_frontmatter = bool(post.metadata)
        except Exception:
            post = None
            has_frontmatter = False

        if has_frontmatter and post is not None:
            meta = post.metadata
            # Extract title from frontmatter or first H1 in body
            title = meta.get("title")
            if not title:
                title = self._extract_h1(post.content) or fallback_title

            # Parse estimated_hours
            est_hours = meta.get("estimated_hours")
            if est_hours is not None:
                try:
                    est_hours = float(est_hours)
                except (ValueError, TypeError):
                    est_hours = None

            return ParsedTask(
                task_key=meta.get("id", task_key) if isinstance(meta.get("id"), str) else task_key,
                title=str(title),
                status=str(meta.get("status", "draft")),
                phase=meta.get("phase"),
                priority=meta.get("priority"),
                owner_key=meta.get("owner"),
                estimated_hours=est_hours,
                affected_components=meta.get("affected_components", []) or [],
                allowed_paths=meta.get("allowed_paths", []) or [],
                depends_on=meta.get("depends_on", []) or [],
                blocks=meta.get("blocks", []) or [],
                path=rel_path,
                content=post.content,
            )

        # No frontmatter: extract from content
        body = raw
        title = self._extract_h1(body) or fallback_title
        return ParsedTask(
            task_key=task_key,
            title=title,
            status="draft",
            path=rel_path,
            content=body,
        )

    @staticmethod
    def _extract_h1(content: str) -> str | None:
        """Extract the first H1 heading from markdown content."""
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("# ") and not stripped.startswith("## "):
                return stripped[2:].strip()
        return None
