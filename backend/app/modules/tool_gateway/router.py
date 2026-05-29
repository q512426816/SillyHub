"""HTTP routes for tool gateway."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.tool_gateway.schema import ToolExecuteRequest, ToolExecuteResponse
from app.modules.tool_gateway.service import ToolGatewayService

router = APIRouter(tags=["tool_gateway"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post(
    "/worktrees/{lease_id}/tools",
    response_model=ToolExecuteResponse,
)
async def execute_tool(
    lease_id: uuid.UUID,
    data: ToolExecuteRequest,
    session: SessionDep,
    user: CurrentUser,
) -> ToolExecuteResponse:
    service = ToolGatewayService(session)
    op_log = await service.execute(lease_id, user.id, data.tool_type, data.params)
    return ToolExecuteResponse.model_validate(op_log)


# ── Approval stubs (V1) ─────────────────────────────────────────────────────


@router.get(
    "/workspaces/{workspace_id}/approvals/pending",
    response_model=list[dict],
)
async def list_pending_approvals(
    workspace_id: uuid.UUID,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> list[dict]:
    """V1 stub — returns empty list. Full approval workflow pending V2."""
    return []


@router.get(
    "/workspaces/{workspace_id}/approvals/history",
    response_model=list[dict],
)
async def list_approval_history(
    workspace_id: uuid.UUID,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> list[dict]:
    """V1 stub — returns empty list. Full approval workflow pending V2."""
    return []


@router.post(
    "/workspaces/{workspace_id}/approvals/{request_id}/approve",
    response_model=dict,
)
async def approve_tool_request(
    workspace_id: uuid.UUID,
    request_id: uuid.UUID,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_APPROVE))],
) -> dict:
    """V1 stub — no-op approval. Full approval workflow pending V2."""
    return {"id": str(request_id), "status": "approved"}


@router.post(
    "/workspaces/{workspace_id}/approvals/{request_id}/reject",
    response_model=dict,
)
async def reject_tool_request(
    workspace_id: uuid.UUID,
    request_id: uuid.UUID,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_APPROVE))],
) -> dict:
    """V1 stub — no-op rejection. Full approval workflow pending V2."""
    return {"id": str(request_id), "status": "rejected"}
