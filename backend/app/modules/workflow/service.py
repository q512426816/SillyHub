"""WorkflowService — state transitions, reviews, and audit logging."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ChangeNotFound, TaskNotFound
from app.core.logging import get_logger
from app.modules.change.model import Change
from app.modules.task.model import Task
from app.modules.workflow.fsm import ChangeFSM, TaskFSM
from app.modules.workflow.model import AuditLog, ChangeReview
from app.modules.workflow.spec_guardian import run_guard

log = get_logger(__name__)


class WorkflowService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Change transitions ──────────────────────────────────────────────

    async def transition_change(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        user_id: uuid.UUID,
        target: str,
    ) -> tuple[Change, str]:
        """Transition a change to *target* state. Returns (change, previous_status)."""
        change = await self._get_change(change_id, workspace_id)
        previous = change.status
        ChangeFSM.validate_transition(previous, target)

        violations = await run_guard(self._session, change, target)
        if violations:
            from app.modules.workflow.fsm import TransitionError

            raise TransitionError(
                "Guard rules prevent this transition.",
                details={"violations": violations},
            )

        change.status = target
        change.updated_at = datetime.now(timezone.utc)
        self._session.add(change)
        await self._record_audit(
            workspace_id=workspace_id,
            actor_id=user_id,
            action="change.transition",
            resource_type="change",
            resource_id=change.id,
            details={"from": previous, "to": target},
        )
        await self._session.commit()
        await self._session.refresh(change)
        log.info("change_transitioned", change_id=str(change_id), from_=previous, to=target)
        return change, previous

    # ── Task transitions ────────────────────────────────────────────────

    async def transition_task(
        self,
        workspace_id: uuid.UUID,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        target: str,
    ) -> tuple[Task, str]:
        """Transition a task to *target* state. Returns (task, previous_status)."""
        task = await self._get_task(task_id, workspace_id)
        previous = task.status
        TaskFSM.validate_transition(previous, target)

        task.status = target
        task.updated_at = datetime.now(timezone.utc)
        self._session.add(task)
        await self._record_audit(
            workspace_id=workspace_id,
            actor_id=user_id,
            action="task.transition",
            resource_type="task",
            resource_id=task.id,
            details={"from": previous, "to": target},
        )
        await self._session.commit()
        await self._session.refresh(task)
        log.info("task_transitioned", task_id=str(task_id), from_=previous, to=target)
        return task, previous

    # ── Reviews ─────────────────────────────────────────────────────────

    async def submit_review(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        verdict: str,
        comment: str | None = None,
    ) -> ChangeReview:
        change = await self._get_change(change_id, workspace_id)
        review = ChangeReview(
            id=uuid.uuid4(),
            change_id=change.id,
            reviewer_id=reviewer_id,
            verdict=verdict,
            comment=comment,
        )
        self._session.add(review)

        # Auto-transition based on verdict
        if verdict == "reject":
            can_reject = ChangeFSM.can_transition(change.status, "rejected")
            if can_reject:
                change.status = "rejected"
                change.updated_at = datetime.now(timezone.utc)
                self._session.add(change)

        await self._record_audit(
            workspace_id=workspace_id,
            actor_id=reviewer_id,
            action="change.review",
            resource_type="change",
            resource_id=change.id,
            details={"verdict": verdict},
        )
        await self._session.commit()
        await self._session.refresh(review)
        log.info("review_submitted", change_id=str(change_id), verdict=verdict)
        return review

    async def list_reviews(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> list[ChangeReview]:
        await self._get_change(change_id, workspace_id)
        stmt = (
            select(ChangeReview)
            .where(col(ChangeReview.change_id) == change_id)
            .order_by(col(ChangeReview.created_at))
        )
        return list((await self._session.execute(stmt)).scalars().all())

    # ── Audit logs ──────────────────────────────────────────────────────

    async def list_audit_logs(
        self,
        workspace_id: uuid.UUID,
        *,
        resource_type: str | None = None,
        limit: int = 100,
    ) -> list[AuditLog]:
        stmt = (
            select(AuditLog)
            .where(col(AuditLog.workspace_id) == workspace_id)
            .order_by(col(AuditLog.timestamp).desc())
            .limit(limit)
        )
        if resource_type:
            stmt = stmt.where(col(AuditLog.resource_type) == resource_type)
        return list((await self._session.execute(stmt)).scalars().all())

    # ── Helpers ─────────────────────────────────────────────────────────

    async def _get_change(
        self, change_id: uuid.UUID, workspace_id: uuid.UUID,
    ) -> Change:
        stmt = select(Change).where(
            col(Change.id) == change_id,
            col(Change.workspace_id) == workspace_id,
        )
        change = (await self._session.execute(stmt)).scalars().first()
        if change is None:
            raise ChangeNotFound(
                f"Change '{change_id}' not found.",
                details={"change_id": str(change_id)},
            )
        return change

    async def _get_task(
        self, task_id: uuid.UUID, workspace_id: uuid.UUID,
    ) -> Task:
        stmt = select(Task).where(
            col(Task.id) == task_id,
            col(Task.workspace_id) == workspace_id,
        )
        task = (await self._session.execute(stmt)).scalars().first()
        if task is None:
            raise TaskNotFound(
                f"Task '{task_id}' not found.",
                details={"task_id": str(task_id)},
            )
        return task

    async def _record_audit(
        self,
        *,
        workspace_id: uuid.UUID,
        actor_id: uuid.UUID,
        action: str,
        resource_type: str,
        resource_id: uuid.UUID,
        details: dict | None = None,
    ) -> None:
        entry = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details_json=json.dumps(details) if details else None,
        )
        self._session.add(entry)
