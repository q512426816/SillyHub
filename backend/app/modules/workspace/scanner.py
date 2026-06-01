"""Filesystem scanner for SillySpec workspaces.

The scanner is intentionally **shallow** in task-02: it only checks whether the
``.sillyspec/`` skeleton is present and counts top-level entries. Deep parsing
of components / changes / tasks lives in task-03 through task-06.

Performance target (AC-08): ``< 200ms`` on a workspace with 10 components and
20 changes — the implementation only reads directory entries, never opens
individual files, which keeps it well below the budget.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.modules.workspace.parser import ParsedRelation, ParsedWorkspace, ParseIssue

# Public warning codes — stable identifiers shipped to API consumers.
WARN_NO_SILLYSPEC = "no_sillyspec_dir"
WARN_MISSING_PROJECTS_DIR = "missing_projects_dir"
WARN_MISSING_CHANGES_DIR = "missing_changes_dir"
WARN_MISSING_CHANGE_SUBDIR = "missing_changes_change_dir"
WARN_MISSING_ARCHIVE_SUBDIR = "missing_changes_archive_dir"


@dataclass(slots=True)
class WorkspaceStructure:
    """Structural summary of a candidate workspace."""

    has_projects_dir: bool = False
    has_changes_dir: bool = False
    has_docs_dir: bool = False
    has_runtime_dir: bool = False
    has_local_yaml: bool = False
    projects_count: int = 0
    active_changes_count: int = 0
    archived_changes_count: int = 0

    def as_dict(self) -> dict[str, bool | int]:
        return {
            "has_projects_dir": self.has_projects_dir,
            "has_changes_dir": self.has_changes_dir,
            "has_docs_dir": self.has_docs_dir,
            "has_runtime_dir": self.has_runtime_dir,
            "has_local_yaml": self.has_local_yaml,
            "projects_count": self.projects_count,
            "active_changes_count": self.active_changes_count,
            "archived_changes_count": self.archived_changes_count,
        }


@dataclass(slots=True)
class ScanResult:
    """The outcome of a single workspace scan -- used for both dry-run and persist flows."""

    root_path: str
    sillyspec_path: str
    is_sillyspec: bool
    structure: WorkspaceStructure = field(default_factory=WorkspaceStructure)
    warnings: list[str] = field(default_factory=list)
    # Parser integration (task-05)
    parsed_workspaces: list[ParsedWorkspace] = field(default_factory=list)
    parsed_relations: list[ParsedRelation] = field(default_factory=list)
    parse_warnings: list[ParseIssue] = field(default_factory=list)
    parse_errors: list[ParseIssue] = field(default_factory=list)


class WorkspaceScanner:
    """Detect and summarise a `.sillyspec` workspace skeleton."""

    REQUIRED_TOP_LEVEL = ("projects", "changes")
    OPTIONAL_TOP_LEVEL = ("docs", "knowledge", "quicklog", ".runtime")
    OPTIONAL_FILES = ("local.yaml",)

    def scan(self, root: Path) -> ScanResult:
        root = self._normalise(root)
        sillyspec = root / ".sillyspec"
        result = ScanResult(
            root_path=str(root),
            sillyspec_path=str(sillyspec),
            is_sillyspec=False,
        )

        if not sillyspec.is_dir():
            result.warnings.append(WARN_NO_SILLYSPEC)
            return result

        result.is_sillyspec = True
        struct = result.structure

        projects_dir = sillyspec / "projects"
        struct.has_projects_dir = projects_dir.is_dir()
        if struct.has_projects_dir:
            struct.projects_count = _count_yaml(projects_dir)
        else:
            result.warnings.append(WARN_MISSING_PROJECTS_DIR)

        changes_dir = sillyspec / "changes"
        struct.has_changes_dir = changes_dir.is_dir()
        if struct.has_changes_dir:
            change_dir = changes_dir / "change"
            archive_dir = changes_dir / "archive"
            if change_dir.is_dir():
                struct.active_changes_count = _count_changes(change_dir)
            else:
                result.warnings.append(WARN_MISSING_CHANGE_SUBDIR)
            if archive_dir.is_dir():
                struct.archived_changes_count = _count_changes(archive_dir)
            else:
                result.warnings.append(WARN_MISSING_ARCHIVE_SUBDIR)
        else:
            result.warnings.append(WARN_MISSING_CHANGES_DIR)

        struct.has_docs_dir = (sillyspec / "docs").is_dir()
        struct.has_runtime_dir = (sillyspec / ".runtime").is_dir()
        struct.has_local_yaml = (sillyspec / "local.yaml").is_file()

        # --- task-05: parser integration ---
        from app.modules.workspace.parser import WorkspaceParser as _WP  # noqa: N814

        parse_result = _WP().parse(root)
        result.parsed_workspaces = parse_result.workspaces
        result.parsed_relations = parse_result.relations
        result.parse_warnings = parse_result.warnings
        result.parse_errors = parse_result.errors

        return result

    @staticmethod
    def _normalise(root: Path) -> Path:
        """Resolve to an absolute, symlink-free path. Falls back if root doesn't exist
        so the caller can produce a clean `path_not_found` error instead of OSError.
        """
        try:
            return root.resolve(strict=False)
        except OSError:
            return root.absolute()


def _count_yaml(directory: Path) -> int:
    """Count immediate ``*.yaml`` and ``*.yml`` files (non-recursive)."""
    return sum(
        1
        for entry in _iter_dir(directory)
        if entry.is_file() and entry.suffix.lower() in {".yaml", ".yml"}
    )


def _count_changes(directory: Path) -> int:
    """Count immediate change folders under ``changes/change`` or ``changes/archive``.

    A "change" is *either* a directory (the canonical SillySpec layout — each
    change is its own folder) *or* a top-level ``.md`` file (lightweight changes).
    Dotfiles like ``.gitkeep`` are ignored so an empty workspace counts as 0.
    """
    count = 0
    for entry in _iter_dir(directory):
        if entry.name.startswith("."):
            continue
        if entry.is_dir() or (entry.is_file() and entry.suffix.lower() == ".md"):
            count += 1
    return count


def _iter_dir(directory: Path) -> list[Path]:
    """Defensive iterdir: returns ``[]`` if the directory disappears mid-scan."""
    try:
        return list(directory.iterdir())
    except OSError:
        return []
