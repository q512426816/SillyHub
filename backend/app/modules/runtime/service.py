"""Runtime service — reads .sillyspec/.runtime/ files."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.runtime.schema import (
    ArtifactEntry,
    RuntimeProgress,
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

    def _resolve_runtime_dir(self, workspace_id: uuid.UUID, workspace, spec_ws) -> Path | None:
        if spec_ws and spec_ws.strategy != "repo-native":
            return Path(spec_ws.spec_root) / ".sillyspec" / ".runtime"
        if workspace.root_path:
            return Path(workspace.root_path) / ".sillyspec" / ".runtime"
        return None

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

        progress_path = runtime_dir / "progress.json"
        if not progress_path.is_file():
            return None

        try:
            raw = json.loads(progress_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            log.warning("runtime.progress_read_failed", error=str(exc))
            return None

        return RuntimeProgress.model_validate(raw)

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

                entries.append(ArtifactEntry(
                    filename=f.name,
                    size_bytes=stat.st_size,
                    last_modified=dt.fromtimestamp(stat.st_mtime).isoformat(),
                ))
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
