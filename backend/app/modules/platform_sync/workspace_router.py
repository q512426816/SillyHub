"""platform_sync workspace_router — workspace-scoped token 签发端点（design §7）。

Change 2026-08-11-change-progress-projection task-07 / D-005@v1 / D-006@v1。两个端点：

- ``POST /workspaces/{workspace_id}/platform-sync-tokens``
    workspace 成员签发同步 token（``require_permission(WORKSPACE_WRITE)``，
    owner/developer 可签，viewer → 403）。明文 token **仅 201 一次**返回。
- ``POST /workspaces/resolve-by-root-path``
    connect 换发：用 user 级凭证（``shk_live_`` API key 或 JWT）+ body ``root_path``
    反查活跃 workspace → 反查不到 404 → 校验调用者对该 workspace 有
    ``WORKSPACE_WRITE``（手动 ``has_permission``，非 ``require_permission``——因
    workspace_id 不在路径，是 body 反查出来的，D-006@v1 安全闭环）→ 无权限 403 →
    签发 ``shpsync_`` token（created_by=调用者）返 200。

router **自带 prefix=/workspaces**，与无前缀 ``changes`` router（router.py）分离——
避免 FastAPI 对 ``GET /changes`` 的尾斜杠 redirect（307）互相干扰（task-07 constraints）。
main 挂 ``prefix="/api"`` 落地 ``/api/workspaces/...``。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import _extract_bearer, get_current_user, require_permission
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import AuthTokenInvalid, AuthTokenMissing
from app.modules.auth.api_key_service import API_KEY_PREFIX, ApiKeyService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.platform_sync.schema import (
    PlatformSyncTokenCreateRequest,
    PlatformSyncTokenCreateResponse,
    ResolveByRootPathRequest,
    ResolveByRootPathResponse,
)
from app.modules.platform_sync.token_service import PlatformSyncTokenService
from app.modules.workspace.service import WorkspaceService

router = APIRouter(prefix="/workspaces", tags=["platform-sync-tokens"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
# POST /{workspace_id}/platform-sync-tokens：require_permission 自动从路径取 {workspace_id}
# 注入 has_permission 闭包（与 mcp_gateway router 同模式），WORKSPACE_WRITE 层级满足。
WorkspaceWriter = Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))]


def _token_service(session: AsyncSession, settings: Settings) -> PlatformSyncTokenService:
    return PlatformSyncTokenService(session, settings=settings)


async def _resolve_caller(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> User:
    """resolve-by-root-path 鉴权：接受 ``shk_live_`` API key 或 JWT（design §7）。

    **不接受 ``shpsync_``**：换发是 user 级一次性操作，应用 user 凭证证明身份；
    shpsync_ 是产品级 token（已绑 workspace），用它换发无意义。客户端 connect 固化传
    ``shk_live_``。

    与 :func:`require_platform_sync` 的区别：后者三路分流含 shpsync_（收件箱上行用），
    本依赖只两路（shk_live_ / JWT），不派生 workspace_id（resolve 从 body root_path 反查）。
    """
    token = _extract_bearer(request)
    if not token:
        raise AuthTokenMissing(
            "Bearer token is required.",
            details={"hint": "Send 'Authorization: Bearer <api_key_or_access_token>'."},
        )
    if token.startswith(API_KEY_PREFIX):
        user = await ApiKeyService(session, settings=settings).authenticate(plaintext=token)
        if user is None:
            raise AuthTokenInvalid("API key is invalid, expired, or revoked.")
        return user
    return await get_current_user(request, session, settings)


@router.post(
    "/{workspace_id}/platform-sync-tokens",
    status_code=status.HTTP_201_CREATED,
    response_model=PlatformSyncTokenCreateResponse,
)
async def create_platform_sync_token(
    workspace_id: uuid.UUID,
    body: PlatformSyncTokenCreateRequest,
    session: SessionDep,
    user: WorkspaceWriter,
    settings: SettingsDep,
) -> PlatformSyncTokenCreateResponse:
    """签发 workspace-scoped 同步 token（WORKSPACE_WRITE，明文仅 201 一次返回）。

    ``created_by=调用者``（authenticate 已校验的 user）；库存 sha256，明文不入日志。
    """
    row, plaintext = await _token_service(session, settings).create(
        workspace_id=workspace_id,
        name=body.name,
        created_by=user.id,
    )
    return PlatformSyncTokenCreateResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        key_prefix=plaintext[:12],
        token=plaintext,
        name=row.name,
        created_at=row.created_at,
    )


@router.post(
    "/resolve-by-root-path",
    response_model=ResolveByRootPathResponse,
)
async def resolve_by_root_path(
    body: ResolveByRootPathRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> ResolveByRootPathResponse:
    """connect 换发：root_path 反查 workspace + WORKSPACE_WRITE 校验 + 签发 shpsync_ token。

    - 反查不到活跃 workspace（root_path 未绑/已软删）→ 404
    - 反查到但调用者无 WORKSPACE_WRITE → 403（D-006@v1 安全闭环）
    - 通过 → 签发 shpsync_ token（created_by=调用者，workspace_id=反查到的 wid）→ 200
    """
    caller = await _resolve_caller(request, session, settings)

    workspace = await WorkspaceService(session)._find_active_by_root_path(body.root_path)
    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active workspace bound to this root_path.",
        )

    # 手动 has_permission（非 require_permission）：workspace_id 是 body 反查出来的，
    # 不在路径，无法用 Depends 注入 RBAC 闭包（D-006@v1）。
    allowed = await has_permission(
        session,
        user=caller,
        permission=Permission.WORKSPACE_WRITE,
        workspace_id=workspace.id,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Caller lacks WORKSPACE_WRITE on this workspace.",
        )

    row, plaintext = await _token_service(session, settings).create(
        workspace_id=workspace.id,
        name=f"sync-{body.root_path[:60]}",  # 标签含来源 root_path 片段，便于管理 UI 识别
        created_by=caller.id,
    )
    return ResolveByRootPathResponse(
        workspace_id=row.workspace_id,
        token=plaintext,
    )
