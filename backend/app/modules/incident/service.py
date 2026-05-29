"""Incident Service.

Manages incident lifecycle: open → investigating → mitigated → resolved.
Postmortem creation and knowledge distillation from resolved incidents.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.incident.model import Incident, Postmortem
from app.modules.incident.schema import IncidentCreate, IncidentUpdate, PostmortemCreate

log = get_logger(__name__)

VALID_STATUSES = frozenset({"open", "investigating", "mitigated", "resolved"})
VALID_SEVERITIES = frozenset({"low", "medium", "high", "critical"})


class IncidentError(AppError):
    code = "INCIDENT_ERROR"
    http_status = 400


class IncidentNotFound(AppError):
    code = "INCIDENT_NOT_FOUND"
    http_status = 404


class PostmortemNotFound(AppError):
    code = "POSTMORTEM_NOT_FOUND"
    http_status = 404


class IncidentService:
    """CRUD + lifecycle for incidents and postmortems."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        workspace_id: uuid.UUID,
        reporter_id: uuid.UUID,
        data: IncidentCreate,
    ) -> Incident:
        if data.severity not in VALID_SEVERITIES:
            raise IncidentError(
                f"Invalid severity: {data.severity}",
                details={"severity": data.severity},
            )

        release_id = uuid.UUID(data.release_id) if data.release_id else None

        incident = Incident(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            title=data.title,
            severity=data.severity,
            status="open",
            description=data.description,
            affected_components=data.affected_components,
            reporter_id=reporter_id,
            release_id=release_id,
        )
        self._session.add(incident)
        await self._session.commit()
        await self._session.refresh(incident)

        log.info("incident_created", incident_id=str(incident.id), severity=data.severity)
        return incident

    async def list_incidents(
        self,
        workspace_id: uuid.UUID,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Incident]:
        stmt = select(Incident).where(Incident.workspace_id == workspace_id)
        if status:
            stmt = stmt.where(Incident.status == status)
        stmt = stmt.order_by(Incident.created_at.desc()).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, incident_id: uuid.UUID) -> Incident:
        incident = await self._session.get(Incident, incident_id)
        if incident is None:
            raise IncidentNotFound(f"Incident '{incident_id}' not found.")
        return incident

    async def update(
        self,
        incident_id: uuid.UUID,
        data: IncidentUpdate,
    ) -> Incident:
        incident = await self.get(incident_id)

        if data.status is not None:
            if data.status not in VALID_STATUSES:
                raise IncidentError(
                    f"Invalid status: {data.status}",
                    details={"status": data.status},
                )
            incident.status = data.status

            if data.status == "resolved":
                incident.resolved_at = datetime.utcnow()
                if data.resolved_by:
                    incident.resolved_by = uuid.UUID(data.resolved_by)

        if data.severity is not None:
            incident.severity = data.severity
        if data.description is not None:
            incident.description = data.description
        if data.root_cause is not None:
            incident.root_cause = data.root_cause
        if data.resolution is not None:
            incident.resolution = data.resolution

        incident.updated_at = datetime.utcnow()
        await self._session.commit()
        await self._session.refresh(incident)

        log.info("incident_updated", incident_id=str(incident_id))
        return incident

    async def create_postmortem(
        self,
        incident_id: uuid.UUID,
        author_id: uuid.UUID,
        data: PostmortemCreate,
    ) -> Postmortem:
        incident = await self.get(incident_id)
        if incident.status != "resolved":
            raise IncidentError(
                "Postmortem can only be created for resolved incidents.",
                details={"current_status": incident.status},
            )

        existing = await self._session.execute(
            select(Postmortem).where(Postmortem.incident_id == incident_id)
        )
        if existing.scalars().first() is not None:
            raise IncidentError("Postmortem already exists for this incident.")

        postmortem = Postmortem(
            id=uuid.uuid4(),
            incident_id=incident_id,
            timeline=data.timeline,
            impact=data.impact,
            root_cause_analysis=data.root_cause_analysis,
            action_items=data.action_items,
            lessons_learned=data.lessons_learned,
            author_id=author_id,
        )
        self._session.add(postmortem)
        await self._session.commit()
        await self._session.refresh(postmortem)

        log.info("postmortem_created", incident_id=str(incident_id))
        return postmortem

    async def get_postmortem(self, incident_id: uuid.UUID) -> Postmortem:
        stmt = select(Postmortem).where(Postmortem.incident_id == incident_id)
        result = await self._session.execute(stmt)
        postmortem = result.scalars().first()
        if postmortem is None:
            raise PostmortemNotFound(f"No postmortem for incident '{incident_id}'.")
        return postmortem
