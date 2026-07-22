"""Runtime service — reads ``.sillyspec/.runtime/`` state files.

SillySpec v4 uses ``sillyspec.db`` (SQLite) as the canonical state source.
"""

from __future__ import annotations

import asyncio
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

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

if TYPE_CHECKING:
    from app.modules.daemon.host_fs import HostFsDelegate

log = get_logger(__name__)


class RuntimeService:
    """Read-only service that parses runtime files from spec_root."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        workspace_service: WorkspaceService | None = None,
        host_fs: HostFsDelegate | None = None,
    ) -> None:
        """Initialize runtime reader.

        Args:
            session: Active async DB session.
            workspace_service: Optional injected ``WorkspaceService`` (tests).
            host_fs: Optional :class:`HostFsDelegate`. When provided, all
                host-filesystem access (stat / read / list) goes through it so
                daemon-client workspaces read ``.runtime/`` over WS RPC. When
                ``None`` (default — server-local / existing tests), the service
                falls back to direct ``Path`` / ``sqlite3`` access on the
                resolved container path (D-004 zero-regression).
        """
        self._session = session
        self._ws_service = workspace_service or WorkspaceService(session)
        self._host_fs = host_fs

    @staticmethod
    def _resolver_for(workspace, spec_ws) -> SpecPathResolver | None:
        """构造正确 root + mode 的 resolver。

        2026-07-10-remove-server-local-workspace-mode（D-005 / D-007）：
        ``workspaces.path_source`` 列已删除，所有 workspace 恒为 daemon-client
        （源码物理位于 daemon 宿主）。root 强制走 ``spec_ws.spec_root``（服务器
        可读路径，如 ``/data/spec-workspaces/<id>/``），mode 恒为
        ``platform_managed=True``（扁平布局，daemon spec-sync 产物无
        ``.sillyspec`` 包裹，``.runtime/`` 直接在其下）。

        无 spec_ws 或 spec_root 时返回 None（调用方降级为「无运行时数据」）。
        """
        if spec_ws and spec_ws.spec_root:
            root = spec_ws.spec_root
        else:
            return None
        return SpecPathResolver(root, platform_managed=True)

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
        # task-12：db 读取保持容器 sqlite3.connect 直读（task-16 fix 后 daemon-client
        # 的 root 强制 spec_ws.spec_root 服务器可读路径，容器可达；HostFsDelegate 的
        # read_file 返 str 不能传二进制 sqlite db，扩接口超出 task-12 allowed_paths）。
        db_path = resolver.db_path()
        if db_path.is_file():
            # 性能优化 Wave 2 / S1-4:sqlite3 直读是同步阻塞 IO,包 to_thread 避免
            # 阻塞 event loop(_read_sqlite_progress 纯 sqlite3 读,不碰 async session)。
            return await asyncio.to_thread(self._read_sqlite_progress, db_path, runtime_dir)

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
                    version=4,
                    project=project_name,
                    current_stage=current_stage,
                    current_change=change_name,
                    stages=stages,
                    last_active=self._parse_dt(last_active),
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
        content = await self._read_text(workspace, ui_path)
        if content is None:
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
        return await self._read_text(workspace, ui_path)

    async def get_artifacts(self, workspace_id: uuid.UUID) -> list[ArtifactEntry]:
        workspace, spec_ws = await self._get_base(workspace_id)
        runtime_dir = self._resolve_runtime_dir(workspace_id, workspace, spec_ws)
        if not runtime_dir:
            return []

        artifacts_dir = runtime_dir / "artifacts"
        entries: list[ArtifactEntry] = []

        if self._host_fs is not None:
            # daemon-client / 注入 delegate 分支：list_dir + stat 走 RPC（D-006 RPC 失败
            # delegate 返语义安全空值，不抛）。root=spec_root 已是服务器/宿主侧能解析路径。
            names = await self._host_fs.list_dir(workspace, str(artifacts_dir))
            for name in sorted(names):
                child = str(artifacts_dir / name)
                st = await self._host_fs.stat(workspace, child)
                if not st.get("exists") or st.get("is_dir"):
                    continue
                from datetime import datetime as dt

                # delegate.stat 不返 mtime（task-01 契约只 exists/is_dir/size），
                # last_modified 退化为 None（前端展示 size 仍可用；mtime 需扩接口）。
                entries.append(
                    ArtifactEntry(
                        filename=name,
                        size_bytes=int(st.get("size", 0)),
                        last_modified=None,
                    )
                )
            return entries

        # server-local 旧分支（host_fs=None）：容器 Path 直读。
        if not artifacts_dir.is_dir():
            return []
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
        # 越界校验保留本地做（路径规范化不依赖 fs，task-12 constraints）。
        if not str(artifact_path).startswith(str(artifacts_dir)):
            return None
        return await self._read_text(workspace, artifact_path, errors="replace")

    async def _read_text(self, workspace, abs_path: Path, *, errors: str = "strict") -> str | None:
        """读 UTF-8 文本文件，host_fs 可用时走 delegate RPC，否则容器 Path 直读。

        统一了 user-inputs.md / artifact 内容读取：host_fs=None（server-local 默认 +
        既有测试）走旧 ``Path.is_file`` + ``read_text``；host_fs 注入时走
        ``delegate.stat`` + ``delegate.read_file``，daemon-client 经 WS RPC。

        ``errors`` 仅作用于 server-local 容器分支（delegate.read_file 返 daemon
        侧解码后的 str，无 errors 概念）。默认 ``strict`` 与原 user-inputs 行为一致；
        artifact 内容传 ``replace`` 与原行为一致。
        """
        path_str = str(abs_path)
        if self._host_fs is not None:
            st = await self._host_fs.stat(workspace, path_str)
            if not st.get("exists") or st.get("is_dir"):
                return None
            try:
                return await self._host_fs.read_file(workspace, path_str)
            except Exception:
                return None
        if not abs_path.is_file():
            return None
        # server-local 容器分支：errors="replace" 时 UnicodeDecodeError 被替换字符吞
        # （原 get_artifact_content 行为）；errors="strict" 时坏编码 UnicodeDecodeError
        # 传播（原 get_user_inputs 行为，except OSError 不接 UnicodeDecodeError）。
        if errors == "replace":
            try:
                return abs_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                return None
        try:
            return abs_path.read_text(encoding="utf-8")
        except OSError:
            return None
