"""HTTP routes for project components.

Permissions land with task-04 (RBAC). For now every route is open inside the
deployment; the V0 dev-only ``X-Debug-User`` header is **not** consulted here.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.component.model import ComponentRelation, ProjectComponent
from app.modules.component.parser import ParseResult
from app.modules.component.schema import (
    ComponentList,
    ComponentRead,
    ParseIssueRead,
    RelationRead,
    ReparseResponse,
    ReparseStats,
    TopologyEdge,
    TopologyNode,
    TopologyResponse,
)
from app.modules.component.service import ComponentService

router = APIRouter(prefix="/workspaces/{workspace_id}/components", tags=["component"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _issue(issues: list) -> list[ParseIssueRead]:
    return [
        ParseIssueRead(code=i.code, file=i.file, detail=i.detail, severity=i.severity)
        for i in issues
    ]


def _build_reparse_response(
    *,
    workspace_id: uuid.UUID,
    parse: ParseResult,
    stats: dict[str, int],
    components: list[ProjectComponent],
    relations: list[ComponentRelation],
) -> ReparseResponse:
    return ReparseResponse(
        workspace_id=workspace_id,
        stats=ReparseStats(**stats),
        components=[ComponentRead.model_validate(c) for c in components],
        relations=[RelationRead.model_validate(r) for r in relations],
        warnings=_issue(parse.warnings),
        errors=_issue(parse.errors),
    )


@router.get("", response_model=ComponentList)
async def list_components(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.COMPONENT_READ))],
) -> ComponentList:
    service = ComponentService(session)
    items, total = await service.list_(workspace_id)
    return ComponentList(
        items=[ComponentRead.model_validate(c) for c in items],
        total=total,
    )


@router.get("/topology", response_model=TopologyResponse)
async def get_topology(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.COMPONENT_READ))],
) -> TopologyResponse:
    service = ComponentService(session)
    components, relations = await service.topology(workspace_id)
    return TopologyResponse(
        workspace_id=workspace_id,
        nodes=[
            TopologyNode(
                id=c.id,
                component_key=c.component_key,
                name=c.name,
                type=c.type,
                status=c.status,
            )
            for c in components
        ],
        edges=[
            TopologyEdge(
                source=r.source_component_id,
                target=r.target_component_id,
                relation_type=r.relation_type,
                description=r.description,
            )
            for r in relations
        ],
    )


@router.post(
    "/reparse",
    response_model=ReparseResponse,
    status_code=status.HTTP_200_OK,
)
async def reparse_components(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.COMPONENT_WRITE))],
) -> ReparseResponse:
    service = ComponentService(session)
    parse, stats, components, relations = await service.reparse(workspace_id)
    return _build_reparse_response(
        workspace_id=workspace_id,
        parse=parse,
        stats=stats,
        components=components,
        relations=relations,
    )


@router.get("/{component_id}", response_model=ComponentRead)
async def get_component(
    workspace_id: uuid.UUID,
    component_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.COMPONENT_READ))],
) -> ComponentRead:
    service = ComponentService(session)
    return ComponentRead.model_validate(await service.get(workspace_id, component_id))
