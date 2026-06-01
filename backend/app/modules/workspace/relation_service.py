"""CRUD + validation for WorkspaceRelation."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import (
    RelationDuplicate,
    RelationNotFound,
    RelationSelfLoop,
    WorkspaceNotFound,
)
from app.core.logging import get_logger
from app.modules.workspace.model import Workspace, WorkspaceRelation
from app.modules.workspace.relation_schema import RelationCreate, RelationListResponse
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)


class RelationService:
    """Handles CRUD operations and validation for workspace relations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_workspace(self, workspace_id: uuid.UUID) -> RelationListResponse:
        """Query all outgoing + incoming relations for a workspace."""
        # Verify workspace exists
        ws_service = WorkspaceService(self._session)
        await ws_service.get(workspace_id)

        outgoing_stmt = select(WorkspaceRelation).where(
            col(WorkspaceRelation.source_id) == workspace_id,
        )
        incoming_stmt = select(WorkspaceRelation).where(
            col(WorkspaceRelation.target_id) == workspace_id,
        )

        outgoing = list((await self._session.execute(outgoing_stmt)).scalars().all())
        incoming = list((await self._session.execute(incoming_stmt)).scalars().all())

        return RelationListResponse(outgoing=outgoing, incoming=incoming)

    async def create(self, source_id: uuid.UUID, payload: RelationCreate) -> WorkspaceRelation:
        """Create a relation with full validation."""
        # 1. Self-loop check
        if source_id == payload.target_id:
            raise RelationSelfLoop(
                "Cannot create a self-referencing relation.",
                details={
                    "workspace_id": str(source_id),
                },
            )

        # 2. Source workspace must exist (and not be soft-deleted)
        ws_service = WorkspaceService(self._session)
        await ws_service.get(source_id)

        # 3. Target workspace must exist (and not be soft-deleted)
        target_ws = await self._session.get(Workspace, payload.target_id)
        if target_ws is None or target_ws.deleted_at is not None:
            raise WorkspaceNotFound(
                "Workspace not found.",
                details={"workspace_id": str(payload.target_id)},
            )

        # 4. Duplicate triplet check
        dup_stmt = select(WorkspaceRelation).where(
            col(WorkspaceRelation.source_id) == source_id,
            col(WorkspaceRelation.target_id) == payload.target_id,
            col(WorkspaceRelation.relation_type) == payload.relation_type,
        )
        existing = (await self._session.execute(dup_stmt)).scalars().first()
        if existing is not None:
            raise RelationDuplicate(
                "This relation already exists.",
                details={
                    "source_id": str(source_id),
                    "target_id": str(payload.target_id),
                    "relation_type": payload.relation_type,
                },
            )

        # 5. Insert
        relation = WorkspaceRelation(
            id=uuid.uuid4(),
            source_id=source_id,
            target_id=payload.target_id,
            relation_type=payload.relation_type,
            description=payload.description,
        )
        self._session.add(relation)

        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            msg = str(exc.orig or exc).lower()
            if "ux_workspace_relations_triplet" in msg:
                raise RelationDuplicate(
                    "This relation already exists.",
                    details={
                        "source_id": str(source_id),
                        "target_id": str(payload.target_id),
                        "relation_type": payload.relation_type,
                    },
                ) from exc
            raise

        await self._session.commit()
        await self._session.refresh(relation)
        log.info(
            "relation.created",
            relation_id=str(relation.id),
            source_id=str(source_id),
            target_id=str(payload.target_id),
            relation_type=payload.relation_type,
        )
        return relation

    async def delete(self, relation_id: uuid.UUID) -> WorkspaceRelation:
        """Delete a relation by its id."""
        relation = await self._session.get(WorkspaceRelation, relation_id)
        if relation is None:
            raise RelationNotFound(
                "Relation not found.",
                details={"relation_id": str(relation_id)},
            )
        # Capture data before deletion for response
        deleted = WorkspaceRelation(
            id=relation.id,
            source_id=relation.source_id,
            target_id=relation.target_id,
            relation_type=relation.relation_type,
            description=relation.description,
            created_at=relation.created_at,
        )
        await self._session.delete(relation)
        await self._session.commit()
        log.info("relation.deleted", relation_id=str(relation_id))
        return deleted
