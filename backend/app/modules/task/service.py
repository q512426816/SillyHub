"""Task use cases.

Coordinates the filesystem parser with DB persistence. Tasks belong to a
specific change within a workspace. Reparse reads the tasks/ subdirectory
and reconciles DB rows via UPSERT pattern.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import TaskNotFound
from app.core.logging import get_logger
from app.modules.change.service import ChangeService
from app.modules.task.model import Task
from app.modules.task.parser import TaskParser, TaskParserResult
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)

BOARD_STATUSES = ["draft", "ready", "in_progress", "review", "done"]


class TaskService:
    """List, fetch, board, and reparse tasks for a change."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: TaskParser | None = None,
        change_service: ChangeService | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._parser = parser or TaskParser()
        self._change_service = change_service or ChangeService(session)
        self._workspace_service = workspace_service or WorkspaceService(session)

    # ── Queries ───────────────────────────────────────────────────────────

    async def list_(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        *,
        status: str | None = None,
        owner: str | None = None,
        priority: str | None = None,
        phase: str | None = None,
    ) -> tuple[list[Task], int]:
        await self._change_service.get(workspace_id, change_id)
        stmt = select(Task).where(
            col(Task.workspace_id) == workspace_id,
            col(Task.change_id) == change_id,
        )
        if status:
            stmt = stmt.where(col(Task.status) == status)
        if owner:
            stmt = stmt.where(col(Task.owner_key) == owner)
        if priority:
            stmt = stmt.where(col(Task.priority) == priority)
        if phase:
            stmt = stmt.where(col(Task.phase) == phase)
        stmt = stmt.order_by(col(Task.task_key).asc())
        items = list((await self._session.execute(stmt)).scalars().all())
        return items, len(items)

    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task:
        stmt = select(Task).where(
            col(Task.id) == task_id,
            col(Task.workspace_id) == workspace_id,
        )
        task = (await self._session.execute(stmt)).scalars().first()
        if task is None:
            raise TaskNotFound(
                f"Task '{task_id}' not found.",
                details={
                    "workspace_id": str(workspace_id),
                    "task_id": str(task_id),
                },
            )
        return task

    async def get_board(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> list[dict[str, Any]]:
        await self._change_service.get(workspace_id, change_id)
        items, _ = await self.list_(workspace_id, change_id)
        by_status: dict[str, list[Task]] = {s: [] for s in BOARD_STATUSES}
        for t in items:
            by_status.setdefault(t.status, []).append(t)
        columns = []
        for s in BOARD_STATUSES:
            col_items = by_status.get(s, [])
            columns.append({"status": s, "count": len(col_items), "items": col_items})
        # Add any statuses not in BOARD_STATUSES
        for s, col_items in by_status.items():
            if s not in BOARD_STATUSES and col_items:
                columns.append({"status": s, "count": len(col_items), "items": col_items})
        return columns

    # ── Reparse ───────────────────────────────────────────────────────────

    async def reparse(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> tuple[dict[str, int], TaskParserResult]:
        change = await self._change_service.get(workspace_id, change_id)
        workspace = await self._workspace_service.get(workspace_id)
        sillyspec_root = Path(workspace.root_path)

        result = self._parser.parse_tasks(sillyspec_root, change.path)
        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}

        existing_tasks = await self._fetch_existing_tasks(change_id)
        existing_by_key = {t.task_key: t for t in existing_tasks}

        seen_keys: set[str] = set()

        for parsed in result.tasks:
            seen_keys.add(parsed.task_key)
            stats["parsed"] += 1

            if parsed.task_key in existing_by_key:
                row = existing_by_key[parsed.task_key]
                self._apply_parsed(row, parsed, workspace_id=workspace_id, change_id=change_id)
                stats["updated"] += 1
            else:
                row = self._build_task(parsed, workspace_id=workspace_id, change_id=change_id)
                self._session.add(row)
                stats["created"] += 1

        for key, row in existing_by_key.items():
            if key not in seen_keys:
                await self._session.delete(row)
                stats["deleted"] += 1

        await self._session.commit()
        log.info(
            "tasks.reparsed",
            workspace_id=str(workspace_id),
            change_id=str(change_id),
            **stats,
        )
        return stats, result

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _fetch_existing_tasks(self, change_id: uuid.UUID) -> list[Task]:
        stmt = select(Task).where(col(Task.change_id) == change_id)
        return list((await self._session.execute(stmt)).scalars().all())

    @staticmethod
    def _build_task(
        parsed: Any,
        *,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> Task:
        return Task(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_id=change_id,
            task_key=parsed.task_key,
            title=parsed.title,
            status=parsed.status,
            phase=parsed.phase,
            priority=parsed.priority,
            owner_key=parsed.owner_key,
            estimated_hours=parsed.estimated_hours,
            affected_components=parsed.affected_components,
            allowed_paths=parsed.allowed_paths,
            depends_on=parsed.depends_on,
            blocks=parsed.blocks,
            path=parsed.path,
            content=parsed.content,
        )

    @staticmethod
    def _apply_parsed(
        row: Task,
        parsed: Any,
        *,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> None:
        row.title = parsed.title
        row.status = parsed.status
        row.phase = parsed.phase
        row.priority = parsed.priority
        row.owner_key = parsed.owner_key
        row.estimated_hours = parsed.estimated_hours
        row.affected_components = parsed.affected_components
        row.allowed_paths = parsed.allowed_paths
        row.depends_on = parsed.depends_on
        row.blocks = parsed.blocks
        row.path = parsed.path
        row.content = parsed.content
