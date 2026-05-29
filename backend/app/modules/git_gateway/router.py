"""HTTP routes for git gateway."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.git_gateway.schema import GitOperationRequest, GitOperationResponse
from app.modules.git_gateway.service import GitGatewayService

router = APIRouter(tags=["git_gateway"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post(
    "/worktrees/{lease_id}/git",
    response_model=GitOperationResponse,
)
async def execute_git_operation(
    lease_id: uuid.UUID,
    data: GitOperationRequest,
    session: SessionDep,
    user: CurrentUser,
) -> GitOperationResponse:
    service = GitGatewayService(session)
    op_log = await service.execute(lease_id, user.id, data.operation, data.args)
    return GitOperationResponse.model_validate(op_log)
