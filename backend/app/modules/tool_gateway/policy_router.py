"""HTTP routes for ToolPolicy CRUD."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import AppError
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.tool_gateway.policy_schema import ToolPolicyCreate, ToolPolicyRead, ToolPolicyUpdate
from app.modules.tool_gateway.tool_policy import ToolPolicy

router = APIRouter(tags=["tool_policy"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


# ── Error classes ────────────────────────────────────────────────────────────


class ToolPolicyNotFound(AppError):
    code = "HTTP_404_TOOL_POLICY_NOT_FOUND"
    http_status = 404


class ToolPolicyNameDuplicate(AppError):
    code = "HTTP_409_TOOL_POLICY_NAME_DUPLICATE"
    http_status = 409


# ── CRUD endpoints ───────────────────────────────────────────────────────────


@router.post(
    "/workspaces/{workspace_id}/tool-policies",
    response_model=ToolPolicyRead,
    status_code=201,
)
async def create_policy(
    workspace_id: uuid.UUID,
    data: ToolPolicyCreate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> ToolPolicyRead:
    policy = ToolPolicy(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        **data.model_dump(),
    )
    try:
        session.add(policy)
        await session.commit()
        await session.refresh(policy)
    except IntegrityError:
        await session.rollback()
        raise ToolPolicyNameDuplicate(
            f"Policy name '{data.name}' already exists in this workspace.",
            details={"workspace_id": str(workspace_id), "name": data.name},
        ) from None
    return ToolPolicyRead.model_validate(policy)


@router.get(
    "/workspaces/{workspace_id}/tool-policies",
    response_model=list[ToolPolicyRead],
)
async def list_policies(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> list[ToolPolicyRead]:
    stmt = (
        select(ToolPolicy)
        .where(ToolPolicy.workspace_id == workspace_id)
        .order_by(ToolPolicy.created_at.desc())
    )
    results = (await session.execute(stmt)).scalars().all()
    return [ToolPolicyRead.model_validate(p) for p in results]


@router.get(
    "/workspaces/{workspace_id}/tool-policies/{policy_id}",
    response_model=ToolPolicyRead,
)
async def get_policy(
    workspace_id: uuid.UUID,
    policy_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> ToolPolicyRead:
    policy = await session.get(ToolPolicy, policy_id)
    if policy is None or policy.workspace_id != workspace_id:
        raise ToolPolicyNotFound(
            f"ToolPolicy '{policy_id}' not found in workspace '{workspace_id}'.",
        )
    return ToolPolicyRead.model_validate(policy)


@router.patch(
    "/workspaces/{workspace_id}/tool-policies/{policy_id}",
    response_model=ToolPolicyRead,
)
async def update_policy(
    workspace_id: uuid.UUID,
    policy_id: uuid.UUID,
    data: ToolPolicyUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> ToolPolicyRead:
    policy = await session.get(ToolPolicy, policy_id)
    if policy is None or policy.workspace_id != workspace_id:
        raise ToolPolicyNotFound(
            f"ToolPolicy '{policy_id}' not found in workspace '{workspace_id}'.",
        )
    update_data = data.model_dump(exclude_unset=True)
    if not update_data:
        return ToolPolicyRead.model_validate(policy)
    for key, value in update_data.items():
        setattr(policy, key, value)
    policy.updated_at = datetime.now(timezone.utc)
    try:
        await session.commit()
        await session.refresh(policy)
    except IntegrityError:
        await session.rollback()
        raise ToolPolicyNameDuplicate(
            "Policy name already exists in this workspace.",
            details={"workspace_id": str(workspace_id), "name": data.name},
        ) from None
    return ToolPolicyRead.model_validate(policy)


@router.delete(
    "/workspaces/{workspace_id}/tool-policies/{policy_id}",
    status_code=204,
)
async def delete_policy(
    workspace_id: uuid.UUID,
    policy_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_ADMIN))],
) -> Response:
    policy = await session.get(ToolPolicy, policy_id)
    if policy is None or policy.workspace_id != workspace_id:
        raise ToolPolicyNotFound(
            f"ToolPolicy '{policy_id}' not found in workspace '{workspace_id}'.",
        )
    await session.delete(policy)
    await session.commit()
    return Response(status_code=204)
