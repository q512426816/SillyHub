"""Centralised path resolver for SillySpec v4 directory layout.

All modules should resolve ``.sillyspec`` paths through this class so that
the layout stays consistent across read, write, archive, and runtime
operations.

v4 layout::

    <workspace_root>/
      .sillyspec/
        changes/<name>/                 ← active changes
        changes/archive/<name>/         ← archived changes
        .runtime/
          sillyspec.db                  ← SQLite state
          gate-status.json
          progress.json                 ← legacy fallback
        docs/<project>/
          scan/
          modules/
"""

from __future__ import annotations

from pathlib import Path


class SpecPathResolver:
    """Resolve SillySpec v4 paths relative to *workspace_root*."""

    # ------------------------------------------------------------------
    # Change document file-name constants (aligned with SillySpec CLI)
    # ------------------------------------------------------------------
    PROPOSAL = "proposal.md"
    DESIGN = "design.md"
    REQUIREMENTS = "requirements.md"
    TASKS = "tasks.md"
    PLAN = "plan.md"
    VERIFY_RESULT = "verify-result.md"
    MODULE_IMPACT = "module-impact.md"
    MASTER = "MASTER.md"

    # Standard doc_type → filename mapping
    STANDARD_FILENAMES: dict[str, str] = {
        "MASTER": MASTER,
        "proposal": PROPOSAL,
        "requirements": REQUIREMENTS,
        "design": DESIGN,
        "plan": PLAN,
        "tasks": TASKS,
        "verify_result": VERIFY_RESULT,
        "module_impact": MODULE_IMPACT,
    }

    # Legacy alias: old name → canonical name
    LEGACY_FILENAME_MAP: dict[str, str] = {
        "verification.md": VERIFY_RESULT,
    }

    # Standard doc_type list used by the parser
    STANDARD_DOC_TYPES: frozenset[str] = frozenset(STANDARD_FILENAMES.keys())

    # scan doc types (aligned with scan_docs module)
    SCAN_DOC_TYPES: list[str] = [
        "ARCHITECTURE",
        "CONVENTIONS",
        "STRUCTURE",
        "INTEGRATIONS",
        "TESTING",
        "CONCERNS",
        "PROJECT",
    ]

    # Default documents created for a new change
    DEFAULT_CHANGE_DOCS: list[str] = [
        PROPOSAL,
        DESIGN,
        REQUIREMENTS,
        TASKS,
    ]

    # ------------------------------------------------------------------
    # Instance methods
    # ------------------------------------------------------------------

    def __init__(self, workspace_root: str | Path) -> None:
        self.root = Path(workspace_root)

    # -- Change directories ------------------------------------------------

    def changes_root(self) -> Path:
        """``.sillyspec/changes/``"""
        return self.root / ".sillyspec" / "changes"

    def change_dir(self, name: str) -> Path:
        """Active change directory: ``.sillyspec/changes/<name>/``"""
        return self.changes_root() / name

    def archive_dir(self, name: str | None = None) -> Path:
        """Archive base or specific archived change.

        ``.sillyspec/changes/archive/``  (name is None)
        ``.sillyspec/changes/archive/<name>/``  (name given)
        """
        base = self.changes_root() / "archive"
        if name is not None:
            return base / name
        return base

    def legacy_change_dir(self, name: str) -> Path:
        """Legacy active change directory: ``.sillyspec/changes/change/<name>/``"""
        return self.changes_root() / "change" / name

    # -- Runtime -----------------------------------------------------------

    def runtime_dir(self) -> Path:
        """``.sillyspec/.runtime/``"""
        return self.root / ".sillyspec" / ".runtime"

    def db_path(self) -> Path:
        """SQLite DB: ``.sillyspec/.runtime/sillyspec.db``"""
        return self.runtime_dir() / "sillyspec.db"

    def gate_status_path(self) -> Path:
        """Gate status: ``.sillyspec/.runtime/gate-status.json``"""
        return self.runtime_dir() / "gate-status.json"

    def legacy_progress_path(self) -> Path:
        """Legacy progress: ``.sillyspec/.runtime/progress.json``"""
        return self.runtime_dir() / "progress.json"

    # -- Docs / scan -------------------------------------------------------

    def docs_dir(self, project: str) -> Path:
        """``.sillyspec/docs/<project>/``"""
        return self.root / ".sillyspec" / "docs" / project

    def scan_dir(self, project: str) -> Path:
        """``.sillyspec/docs/<project>/scan/``"""
        return self.docs_dir(project) / "scan"

    def modules_dir(self, project: str) -> Path:
        """``.sillyspec/docs/<project>/modules/``"""
        return self.docs_dir(project) / "modules"
