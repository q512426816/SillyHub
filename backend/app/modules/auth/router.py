"""``/api/auth`` HTTP shell over :class:`AuthService`."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import ApiKeyNotFound, AuthInvalidCredentials, LoginCaptchaRequired
from app.modules.auth.api_key_schema import (
    ApiKeyCreated,
    ApiKeyCreateRequest,
    ApiKeyListResponse,
    ApiKeyRead,
)
from app.modules.auth.api_key_service import ApiKeyService
from app.modules.auth.captcha_service import CaptchaService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import collect_permissions_everywhere, list_user_workspace_roles
from app.modules.auth.schema import (
    CaptchaVerifyRequest,
    CaptchaVerifyResponse,
    ChangePasswordRequest,
    ConfirmCaptchaResponse,
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


def _client_ip(request: Request) -> str | None:
    """客户端 IP:nginx 反代下取 X-Forwarded-For 最右段(可信代理追加的末跳),直连回退 client.host。

    ⚠️ 2026-08-20 审计 BS-3:原实现取最左段(客户端自报可伪造,换假 IP 即绕过
    登录限流/失败计数/验证码)。nginx ``$proxy_add_x_forwarded_for`` 是**追加**语义,
    最右段才是离我们最近的可信代理实际看到的来源 IP,伪造只能影响左侧历史段。
    残余风险:无反代直连时攻击者仍可自报整条 XFF(部署拓扑含 nginx 时不成立)。
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        segments = [s.strip() for s in xff.split(",") if s.strip()]
        if segments:
            return segments[-1]
    return request.client.host if request.client else None


def _client_metadata(request: Request) -> tuple[str | None, str | None]:
    ua = request.headers.get("user-agent")
    return ua, _client_ip(request)


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
) -> TokenPair:
    ua, ip = _client_metadata(request)
    captcha = CaptchaService(settings=settings)
    # 1) 限流(同一 IP 60s 窗口);2) 若该 IP 累计失败达阈值,强制校验滑块 token。
    #    captcha_verified=True 表示本次已通过人机验证(消费了有效一次性 token)。
    await captcha.check_rate_limit(ip)
    captcha_verified = await captcha.assert_captcha_if_needed(ip, payload.captcha_token)
    try:
        _, pair = await AuthService(session, settings=settings).login(
            account=payload.account, password=payload.password, user_agent=ua, ip=ip
        )
    except AuthInvalidCredentials:
        # 凭证错:累计失败次数。
        fails = await captcha.record_login_failure(ip)
        # 本次已通过人机验证(带了有效 captcha_token)→ 密码错应明确提示密码错(401),
        # 不再绕回"要验证码"(423):token 一次性已被消费,若再要求验证码会让用户陷入
        # "验证→又让验证"循环,永远看不到密码错误。爆破防护不降——每次试密码仍须先过
        # 验证码(token 一次性)且受 IP 限流约束,只是把真实失败原因(密码错)如实反馈。
        if captcha_verified:
            raise
        # 未过验证:达阈值则要求人机确认(前端据 423 need_captcha 弹确认)。
        if fails >= settings.auth_login_fail_threshold:
            raise LoginCaptchaRequired(
                "登录失败次数过多,请完成滑块验证后重试。",
                details={"need_captcha": True},
            ) from None
        raise
    # 登录成功:清失败计数。
    await captcha.clear_login_failures(ip)
    return pair


@router.get("/captcha/confirm", response_model=ConfirmCaptchaResponse)
async def get_confirm_captcha(settings: SettingsDep) -> ConfirmCaptchaResponse:
    """签发一次性 captcha_id,前端点「我不是机器人」时取。

    无需鉴权(登录前调用);前端在收到 423 need_captcha 后调用。
    """
    data = await CaptchaService(settings=settings).create_confirmation()
    return ConfirmCaptchaResponse(**data)


@router.post("/captcha/verify", response_model=CaptchaVerifyResponse)
async def verify_captcha(
    payload: CaptchaVerifyRequest, settings: SettingsDep
) -> CaptchaVerifyResponse:
    """校验 captcha_id(一次性)→ 通过签发一次性 captcha_token,登录时回传。"""
    token = await CaptchaService(settings=settings).verify_confirmation(payload.captcha_id)
    if not token:
        return CaptchaVerifyResponse(success=False)
    return CaptchaVerifyResponse(success=True, captcha_token=token)


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


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: SessionDep,
    settings: SettingsDep,
) -> None:
    """用户自助修改密码：验证旧密码后更新，并撤销该用户其他设备的登录会话。"""
    await AuthService(session, settings=settings).change_password(
        user_id=user.id,
        old_password=payload.old_password,
        new_password=payload.new_password,
    )


@router.get("/me", response_model=MeResponse)
async def me(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_user)],
) -> MeResponse:
    rows = await list_user_workspace_roles(session, user_id=user.id)
    perms = await collect_permissions_everywhere(session, user_id=user.id)
    return MeResponse(
        user=UserRead.model_validate(user),
        workspaces=[
            WorkspaceRoleAssignment(workspace_id=wid, role_key=key, role_name=name)
            for wid, key, name in rows
        ],
        permissions=sorted(perms),
    )


# ── API Keys (settings:admin-only) ─────────────────────────────────────


ApiKeyAdminUser = Annotated[User, Depends(require_permission_any(Permission.API_KEY_ADMIN))]


@router.post(
    "/api-keys",
    response_model=ApiKeyCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_key(
    payload: ApiKeyCreateRequest,
    session: SessionDep,
    settings: SettingsDep,
    user: ApiKeyAdminUser,
) -> ApiKeyCreated:
    """Issue a new long-lived API key for the daemon.

    Plaintext is returned **only** here; subsequent GETs will only expose
    ``key_prefix``. ``api_key:admin``-gated.
    """
    row, plaintext = await ApiKeyService(session, settings=settings).create(
        user_id=user.id,
        name=payload.name,
        expires_at=payload.expires_at,
    )
    return ApiKeyCreated(
        id=row.id,
        name=row.name,
        key_prefix=row.key_prefix,
        last_used_at=row.last_used_at,
        expires_at=row.expires_at,
        created_at=row.created_at,
        revoked_at=row.revoked_at,
        plaintext=plaintext,
    )


@router.get("/api-keys", response_model=ApiKeyListResponse)
async def list_api_keys(
    session: SessionDep,
    settings: SettingsDep,
    user: ApiKeyAdminUser,
) -> ApiKeyListResponse:
    """List the caller's API keys (plaintext never included)."""
    rows = await ApiKeyService(session, settings=settings).list_for_user(user_id=user.id)
    return ApiKeyListResponse(items=[ApiKeyRead.model_validate(r) for r in rows])


@router.delete(
    "/api-keys/{api_key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_api_key(
    api_key_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    settings: SettingsDep,
    user: ApiKeyAdminUser,
) -> None:
    """Revoke an API key. Idempotent for unknown / already-revoked ids → 404."""
    updated = await ApiKeyService(session, settings=settings).revoke(
        api_key_id=api_key_id,
        user_id=user.id,
    )
    if not updated:
        raise ApiKeyNotFound("API 密钥不存在或已被吊销。")
