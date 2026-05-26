"""``/api/auth`` HTTP shell over :class:`AuthService`."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.rbac import list_user_workspace_roles
from app.modules.auth.schema import (
    LoginRequest,
    MeResponse,
    RefreshRequest,
    TokenPair,
    UserRead,
    WorkspaceRoleAssignment,
)
from app.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _client_metadata(request: Request) -> tuple[str | None, str | None]:
    ua = request.headers.get("user-agent")
    ip = request.client.host if request.client else None
    return ua, ip


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> TokenPair:
    ua, ip = _client_metadata(request)
    _, pair = await AuthService(session, settings=settings).login(
        email=payload.email, password=payload.password, user_agent=ua, ip=ip
    )
    return pair


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    payload: RefreshRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> TokenPair:
    ua, ip = _client_metadata(request)
    _, pair = await AuthService(session, settings=settings).refresh(
        refresh_token=payload.refresh_token, user_agent=ua, ip=ip
    )
    return pair


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: RefreshRequest,
    session: SessionDep,
    settings: SettingsDep,
    _user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Revoke the current session.

    Caller must present both the bearer access token (proves it's *this* user
    asking) and the refresh token (identifies the exact session to drop).
    """
    await AuthService(session, settings=settings).logout_session_by_refresh(
        refresh_token=payload.refresh_token
    )


@router.get("/me", response_model=MeResponse)
async def me(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_user)],
) -> MeResponse:
    rows = await list_user_workspace_roles(session, user_id=user.id)
    return MeResponse(
        user=UserRead.model_validate(user),
        workspaces=[
            WorkspaceRoleAssignment(workspace_id=wid, role_key=key, role_name=name)
            for wid, key, name in rows
        ],
    )
