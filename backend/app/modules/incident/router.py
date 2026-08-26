"""Incident API endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal, require_permission
from app.core.db import get_session
from app.core.errors import PermissionDenied
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.incident.model import Incident
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


async def _require_incident_permission(
    session: AsyncSession,
    *,
    user: User,
    permission: Permission,
    incident_id: uuid.UUID,
) -> Incident:
    """对象级鉴权：取故障单并按其归属 workspace 复查权限，跨工作区 403。

    by-id 端点没有 workspace 路径参数可锚定，``require_permission_any`` 只能
    验证「任意工作区有权限」，无法阻止 A 工作区用户操作 B 工作区故障单；
    必须在对象归属的 workspace 上复查（对齐 agent / file 模块的
    ``has_permission(workspace_id=obj.workspace_id)`` 对象级校验惯例）。
    """
    svc = IncidentService(session)
    incident = await svc.get(incident_id)
    ok = await has_permission(
        session, user=user, permission=permission, workspace_id=incident.workspace_id
    )
    if not ok:
        raise PermissionDenied(
            "无权执行此操作。",
            details={
                "permission": permission.value,
                "workspace_id": str(incident.workspace_id),
            },
        )
    return incident


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
    user: Annotated[User, Depends(get_current_principal)],
) -> IncidentResponse:
    incident = await _require_incident_permission(
        session, user=user, permission=Permission.INCIDENT_READ, incident_id=incident_id
    )
    return IncidentResponse.model_validate(incident)


@router.patch(
    "/incidents/{incident_id}",
    response_model=IncidentResponse,
)
async def update_incident(
    incident_id: uuid.UUID,
    body: IncidentUpdate,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> IncidentResponse:
    await _require_incident_permission(
        session, user=user, permission=Permission.DEPLOY_PRODUCTION, incident_id=incident_id
    )
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
    user: Annotated[User, Depends(get_current_principal)],
) -> PostmortemResponse:
    await _require_incident_permission(
        session, user=user, permission=Permission.DEPLOY_PRODUCTION, incident_id=incident_id
    )
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
    user: Annotated[User, Depends(get_current_principal)],
) -> PostmortemResponse:
    await _require_incident_permission(
        session, user=user, permission=Permission.INCIDENT_READ, incident_id=incident_id
    )
    svc = IncidentService(session)
    postmortem = await svc.get_postmortem(incident_id)
    return PostmortemResponse.model_validate(postmortem)
