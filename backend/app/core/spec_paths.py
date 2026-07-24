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

    # ------------------------------------------------------------------
    # Instance methods
    # ------------------------------------------------------------------

    def __init__(self, workspace_root: str | Path, *, platform_managed: bool = False) -> None:
        """Resolve SillySpec paths relative to *workspace_root*.

        ``platform_managed``（D-005@v1，平台托管场景）为 True 时，
        ``workspace_root`` 本身就是 ``.sillyspec`` 内容根（扁平布局：``docs/``、
        ``changes/``、``.runtime/`` 直接在其下），所有路径方法省略 ``.sillyspec`` 段。
        默认 False（repo-native：``<root>/.sillyspec/...`` 包裹语义），
        向后兼容现有调用方。
        """
        self.root = Path(workspace_root)
        self.platform_managed = platform_managed

    # -- Factory ------------------------------------------------------------

    @classmethod
    def for_spec_workspace(cls, spec_ws: object) -> "SpecPathResolver":
        """按 ``spec_workspaces.strategy`` 自动选 mode 构造 resolver（D-005@v1）。

        鸭子类型：只要对象有 ``spec_root`` 与 ``strategy`` 属性即可，不硬依赖
        ``SpecWorkspace`` ORM 模型（避免 core → modules 反向 import）。
        ``strategy == "platform-managed"`` → 扁平；其余（repo-native）
        → ``.sillyspec`` 包裹。
        """
        return cls(
            spec_ws.spec_root,
            platform_managed=(getattr(spec_ws, "strategy", None) == "platform-managed"),
        )

    # -- Internal helper ----------------------------------------------------

    def _spec_root(self) -> Path:
        """``.sillyspec`` 内容根：platform_managed 时即 ``self.root``，否则 ``self.root/.sillyspec``。"""
        return self.root if self.platform_managed else self.root / ".sillyspec"

    # -- Change directories ------------------------------------------------

    def changes_root(self) -> Path:
        """``.sillyspec/changes/``"""
        return self._spec_root() / "changes"

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

    # -- Runtime -----------------------------------------------------------

    def runtime_dir(self) -> Path:
        """``.sillyspec/.runtime/``"""
        return self._spec_root() / ".runtime"

    def db_path(self) -> Path:
        """SQLite DB: ``.sillyspec/.runtime/sillyspec.db``"""
        return self.runtime_dir() / "sillyspec.db"

    def gate_status_path(self) -> Path:
        """Gate status: ``.sillyspec/.runtime/gate-status.json``"""
        return self.runtime_dir() / "gate-status.json"

    # -- Docs / scan -------------------------------------------------------

    def docs_dir(self, project: str) -> Path:
        """``.sillyspec/docs/<project>/``"""
        return self._spec_root() / "docs" / project

    def scan_dir(self, project: str) -> Path:
        """``.sillyspec/docs/<project>/scan/``"""
        return self.docs_dir(project) / "scan"

    def modules_dir(self, project: str) -> Path:
        """``.sillyspec/docs/<project>/modules/``"""
        return self.docs_dir(project) / "modules"
