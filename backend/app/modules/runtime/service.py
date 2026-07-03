"""Runtime service — reads ``.sillyspec/.runtime/`` state files.

SillySpec v4 uses ``sillyspec.db`` (SQLite) as the canonical state source.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.spec_paths import SpecPathResolver
from app.modules.runtime.schema import (
    ArtifactEntry,
    RuntimeProgress,
    StageProgress,
    StageStep,
    UserInputEntry,
)
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)


class RuntimeService:
    """Read-only service that parses runtime files from spec_root."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._ws_service = workspace_service or WorkspaceService(session)

    @staticmethod
    def _resolver_for(workspace, spec_ws) -> SpecPathResolver | None:
        """构造正确 root + mode 的 resolver（D-005@v1, task-16 fix: daemon-client 兜底）。

        root 与 mode 是**正交**的两个维度：

        - **root 选择**：
          1. **daemon-client**（``path_source == "daemon-client"``）→ 强制走
             ``spec_ws.spec_root``（服务器可读路径，如 ``/data/spec-workspaces/<id>/``），
             忽略 ``strategy``。修复：daemon-client + ``repo-native`` 组合下
             ``strategy != "repo-native"`` 不成立，root 本会落到 ``workspace.root_path``
             （Windows 宿主路径，后端容器访问不到）。
          2. 其余（server-local 平台镜像等）：``spec_ws.strategy != "repo-native"``
             （即 platform-managed）→ ``spec_ws.spec_root``。
          3. 其余（repo-native / 无 spec_ws）→ ``workspace.root_path``。
        - **mode 选择**：daemon-client → ``platform_managed=True``（扁平，daemon spec-sync
          产物无 ``.sillyspec`` 包裹，``.runtime/`` 直接在其下）；其余 → False（包裹
          ``.sillyspec/.runtime/``，既有写入约定）。
        """
        from app.modules.workspace.service import is_daemon_client_path_source

        is_daemon_client = is_daemon_client_path_source(workspace.path_source)

        if is_daemon_client:
            # task-16: daemon-client workspace 无视 strategy，强制用 spec_root
            # （服务器可访问路径），避免 fallback 到 workspace.root_path（宿主机路径）。
            if spec_ws and spec_ws.spec_root:
                root = spec_ws.spec_root
            else:
                return None
        elif spec_ws and spec_ws.strategy != "repo-native":
            root = spec_ws.spec_root
        elif workspace.root_path:
            root = workspace.root_path
        else:
            return None
        return SpecPathResolver(
            root,
            platform_managed=is_daemon_client,
        )

    def _resolve_runtime_dir(self, workspace_id: uuid.UUID, workspace, spec_ws) -> Path | None:
        resolver = self._resolver_for(workspace, spec_ws)
        return resolver.runtime_dir() if resolver else None

    async def _get_base(self, workspace_id: uuid.UUID):
        workspace = await self._ws_service.get(workspace_id)
        stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == workspace_id)
        spec_ws = (await self._session.execute(stmt)).scalars().first()
        return workspace, spec_ws

    async def get_progress(self, workspace_id: uuid.UUID) -> RuntimeProgress | None:
        workspace, spec_ws = await self._get_base(workspace_id)
        runtime_dir = self._resolve_runtime_dir(workspace_id, workspace, spec_ws)
        if not runtime_dir:
            return None

        resolver = self._resolver_for(workspace, spec_ws)
        assert resolver is not None  # runtime_dir 非 None 蕴含 resolver 非 None

        # --- Read from sillyspec.db (SQLite) ---
        db_path = resolver.db_path()
        if db_path.is_file():
            return self._read_sqlite_progress(db_path, runtime_dir)

        return None

    # ------------------------------------------------------------------
    # SQLite reader
    # ------------------------------------------------------------------

    def _read_sqlite_progress(self, db_path: Path, runtime_dir: Path) -> RuntimeProgress | None:
        """Read the most recent active change from ``sillyspec.db`` and map to RuntimeProgress."""
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            try:
                # Get the most recently active change
                row = conn.execute(
                    "SELECT name, current_stage, status, last_active, created_at "
                    "FROM changes ORDER BY last_active DESC LIMIT 1"
                ).fetchone()
                if row is None:
                    return None

                change_name = row["name"]
                current_stage = row["current_stage"]
                _change_status = row["status"]
                last_active = row["last_active"]

                # Get project info
                project_row = conn.execute("SELECT name FROM project LIMIT 1").fetchone()
                project_name = project_row["name"] if project_row else None

                # Get stages for this change
                stages: dict[str, StageProgress] = {}
                stage_rows = conn.execute(
                    "SELECT stage, status, started_at, completed_at "
                    "FROM stages WHERE change_id = "
                    "(SELECT id FROM changes WHERE name = ?) "
                    "ORDER BY stage",
                    (change_name,),
                ).fetchall()

                for sr in stage_rows:
                    stage_name = sr["stage"]
                    stage_progress = StageProgress(
                        status=sr["status"] or "pending",
                        started_at=self._parse_dt(sr["started_at"]),
                        completed_at=self._parse_dt(sr["completed_at"]),
                    )

                    # Get steps for this stage
                    step_rows = conn.execute(
                        "SELECT name, status, output, completed_at "
                        "FROM steps WHERE stage_id = "
                        "(SELECT s.id FROM stages s "
                        " JOIN changes c ON s.change_id = c.id "
                        " WHERE c.name = ? AND s.stage = ?) "
                        "ORDER BY ordering",
                        (change_name, stage_name),
                    ).fetchall()

                    for stp in step_rows:
                        stage_progress.steps.append(
                            StageStep(
                                name=stp["name"],
                                status=stp["status"] or "pending",
                                output=stp["output"],
                                completed_at=self._parse_dt(stp["completed_at"]),
                            )
                        )

                    stages[stage_name] = stage_progress

                return RuntimeProgress(
                    _version=4,
                    project=project_name,
                    currentStage=current_stage,
                    currentChange=change_name,
                    stages=stages,
                    lastActive=self._parse_dt(last_active),
                )

            finally:
                conn.close()

        except sqlite3.Error as exc:
            log.warning("runtime.sqlite_read_failed", error=str(exc), db=str(db_path))
            return None

    @staticmethod
    def _parse_dt(value: str | None) -> datetime | None:
        """Parse ISO-format datetime string."""
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except (ValueError, TypeError):
            return None

    # ------------------------------------------------------------------
    # User inputs & artifacts (unchanged, file-based)
    # ------------------------------------------------------------------

    async def get_user_inputs(self, workspace_id: uuid.UUID) -> list[UserInputEntry]:
        workspace, spec_ws = await self._get_base(workspace_id)
        runtime_dir = self._resolve_runtime_dir(workspace_id, workspace, spec_ws)
        if not runtime_dir:
            return []

        ui_path = runtime_dir / "user-inputs.md"
        if not ui_path.is_file():
            return []

        try:
            content = ui_path.read_text(encoding="utf-8")
        except OSError:
            return []

        entries: list[UserInputEntry] = []
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            entries.append(UserInputEntry(timestamp="", content=line))

        return entries

    async def get_user_inputs_raw(self, workspace_id: uuid.UUID) -> str | None:
        workspace, spec_ws = await self._get_base(workspace_id)
        runtime_dir = self._resolve_runtime_dir(workspace_id, workspace, spec_ws)
        if not runtime_dir:
            return None

        ui_path = runtime_dir / "user-inputs.md"
        if not ui_path.is_file():
            return None

        try:
            return ui_path.read_text(encoding="utf-8")
        except OSError:
            return None

    async def get_artifacts(self, workspace_id: uuid.UUID) -> list[ArtifactEntry]:
        workspace, spec_ws = await self._get_base(workspace_id)
        runtime_dir = self._resolve_runtime_dir(workspace_id, workspace, spec_ws)
        if not runtime_dir:
            return []

        artifacts_dir = runtime_dir / "artifacts"
        if not artifacts_dir.is_dir():
            return []

        entries: list[ArtifactEntry] = []
        for f in sorted(artifacts_dir.iterdir()):
            if f.is_file():
                stat = f.stat()
                from datetime import datetime as dt

                entries.append(
                    ArtifactEntry(
                        filename=f.name,
                        size_bytes=stat.st_size,
                        last_modified=dt.fromtimestamp(stat.st_mtime).isoformat(),
                    )
                )
        return entries

    async def get_artifact_content(self, workspace_id: uuid.UUID, filename: str) -> str | None:
        workspace, spec_ws = await self._get_base(workspace_id)
        runtime_dir = self._resolve_runtime_dir(workspace_id, workspace, spec_ws)
        if not runtime_dir:
            return None

        artifact_path = (runtime_dir / "artifacts" / filename).resolve()
        artifacts_dir = (runtime_dir / "artifacts").resolve()
        if not str(artifact_path).startswith(str(artifacts_dir)):
            return None
        if not artifact_path.is_file():
            return None

        try:
            return artifact_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
