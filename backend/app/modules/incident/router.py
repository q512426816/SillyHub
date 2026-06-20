"""Incident API endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.incident.schema import (
    IncidentCreate,
    IncidentResponse,
    IncidentUpdate,
    PostmortemCreate,
    PostmortemResponse,
)
from app.modules.incident.service import IncidentService

router = APIRouter(tags=["incidents"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "/workspaces/{workspace_id}/incidents",
    response_model=IncidentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_incident(
    workspace_id: uuid.UUID,
    body: IncidentCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.DEPLOY_STAGING))],
) -> IncidentResponse:
    svc = IncidentService(session)
    incident = await svc.create(workspace_id, user.id, body)
    return IncidentResponse.model_validate(incident)


@router.get(
    "/workspaces/{workspace_id}/incidents",
    response_model=list[IncidentResponse],
)
async def list_incidents(
    workspace_id: uuid.UUID,
    user: Annotated[User, Depends(require_permission(Permission.INCIDENT_READ))],
    session: SessionDep,
    status_filter: str | None = Query(None, alias="status"),
) -> list[IncidentResponse]:
    svc = IncidentService(session)
    incidents = await svc.list_incidents(workspace_id, status=status_filter)
    return [IncidentResponse.model_validate(i) for i in incidents]


@router.get(
    "/incidents/{incident_id}",
    response_model=IncidentResponse,
)
async def get_incident(
    incident_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.INCIDENT_READ))],
) -> IncidentResponse:
    svc = IncidentService(session)
    incident = await svc.get(incident_id)
    return IncidentResponse.model_validate(incident)


@router.patch(
    "/incidents/{incident_id}",
    response_model=IncidentResponse,
)
async def update_incident(
    incident_id: uuid.UUID,
    body: IncidentUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.DEPLOY_PRODUCTION))],
) -> IncidentResponse:
    svc = IncidentService(session)
    incident = await svc.update(incident_id, body)
    return IncidentResponse.model_validate(incident)


@router.post(
    "/incidents/{incident_id}/postmortem",
    response_model=PostmortemResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_postmortem(
    incident_id: uuid.UUID,
    body: PostmortemCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.DEPLOY_PRODUCTION))],
) -> PostmortemResponse:
    svc = IncidentService(session)
    postmortem = await svc.create_postmortem(incident_id, user.id, body)
    return PostmortemResponse.model_validate(postmortem)


@router.get(
    "/incidents/{incident_id}/postmortem",
    response_model=PostmortemResponse,
)
async def get_postmortem(
    incident_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.INCIDENT_READ))],
) -> PostmortemResponse:
    svc = IncidentService(session)
    postmortem = await svc.get_postmortem(incident_id)
    return PostmortemResponse.model_validate(postmortem)
