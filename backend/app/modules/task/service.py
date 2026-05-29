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
from app.modules.task.schema import TaskRead, TaskSummary
from app.modules.workspace.model import TaskWorkspace, Workspace
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

        # Query via primary workspace FK OR M:N association table
        mn_subq = select(TaskWorkspace.task_id).where(
            col(TaskWorkspace.workspace_id) == workspace_id,
        )
        stmt = select(Task).where(
            (col(Task.workspace_id) == workspace_id)
            | (col(Task.id).in_(mn_subq)),
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
        # De-duplicate
        seen: set[uuid.UUID] = set()
        unique_items: list[Task] = []
        for item in items:
            if item.id not in seen:
                seen.add(item.id)
                unique_items.append(item)
        return unique_items, len(unique_items)

    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task:
        # Try primary workspace match first
        stmt = select(Task).where(
            col(Task.id) == task_id,
            col(Task.workspace_id) == workspace_id,
        )
        task = (await self._session.execute(stmt)).scalars().first()

        # If primary workspace doesn't match, check M:N table
        if task is None:
            mn_stmt = select(TaskWorkspace).where(
                col(TaskWorkspace.task_id) == task_id,
                col(TaskWorkspace.workspace_id) == workspace_id,
            )
            mn = (await self._session.execute(mn_stmt)).scalars().first()
            if mn is not None:
                task = await self._session.get(Task, task_id)

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

            # Sync M:N workspace associations
            target_id = (
                existing_by_key[parsed.task_key].id
                if parsed.task_key in existing_by_key
                else row.id
            )
            await self._sync_task_workspaces(
                task_id=target_id,
                workspace_id=workspace_id,
                parsed=parsed,
            )

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

    # ── M:N Enrichment ──────────────────────────────────────────────────

    async def enrich_with_workspace_ids(self, task: Task) -> TaskRead:
        """Build TaskRead with workspace_ids populated from M:N table."""
        stmt = select(TaskWorkspace.workspace_id).where(
            col(TaskWorkspace.task_id) == task.id,
        )
        all_mn = [row[0] for row in (await self._session.execute(stmt)).all()]
        # Exclude primary workspace_id to avoid duplication
        secondary = [wid for wid in all_mn if wid != task.workspace_id]
        data = TaskRead.model_validate(task)
        data.workspace_ids = [task.workspace_id] + secondary
        return data

    async def enrich_summaries(self, tasks: list[Task]) -> list[TaskSummary]:
        """Build TaskSummary list with workspace_ids populated."""
        result: list[TaskSummary] = []
        for t in tasks:
            stmt = select(TaskWorkspace.workspace_id).where(
                col(TaskWorkspace.task_id) == t.id,
            )
            all_mn = [row[0] for row in (await self._session.execute(stmt)).all()]
            secondary = [wid for wid in all_mn if wid != t.workspace_id]
            data = TaskSummary.model_validate(t)
            data.workspace_ids = [t.workspace_id] + secondary
            result.append(data)
        return result

    # ── M:N Sync ────────────────────────────────────────────────────────

    async def _sync_task_workspaces(
        self,
        task_id: uuid.UUID,
        workspace_id: uuid.UUID,
        parsed: Any,
    ) -> None:
        """Sync M:N associations for a task based on affected_components."""
        ws_ids: set[uuid.UUID] = {workspace_id}
        if parsed.affected_components:
            stmt = select(Workspace.id).where(
                col(Workspace.component_key).in_(parsed.affected_components),
                col(Workspace.deleted_at).is_(None),
            )
            extra = [row[0] for row in (await self._session.execute(stmt)).all()]
            ws_ids.update(extra)

        existing_stmt = select(TaskWorkspace).where(
            col(TaskWorkspace.task_id) == task_id,
        )
        existing = list(
            (await self._session.execute(existing_stmt)).scalars().all()
        )
        existing_ws_ids = {tw.workspace_id for tw in existing}

        for tw in existing:
            if tw.workspace_id not in ws_ids:
                await self._session.delete(tw)

        for wid in ws_ids - existing_ws_ids:
            role = "primary" if wid == workspace_id else "affected"
            self._session.add(
                TaskWorkspace(
                    task_id=task_id,
                    workspace_id=wid,
                    role=role,
                )
            )

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
