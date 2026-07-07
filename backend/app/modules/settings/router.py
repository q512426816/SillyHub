"""``/api/settings`` and ``/api/users`` — platform configuration & user management.

``/api/users/*`` handlers forward to :class:`app.modules.admin.users_service.UserService`
(change ``2026-06-16-admin-org-role-center`` task-06). Signatures, response
shape, and ``require_platform_admin`` permission are preserved so existing
clients keep working.
"""

from __future__ import annotations

import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any, require_platform_admin
from app.core.db import get_session
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.settings.model import PlatformSetting
from app.modules.settings.schema import (
    AuditLogRead,
    McpServersSchema,
    ResetPasswordRequest,
    ResetPasswordResponse,
    RevokeAllResponse,
    SettingRead,
    SettingsBulkRead,
    SettingsUpdateRequest,
    SettingsUpdateResponse,
    UserCreateRequest,
    UserListResponse,
    UserRead,
    UserSessionRead,
    UserUpdateRequest,
    UserWorkspaceRead,
)

log = get_logger(__name__)
router = APIRouter(tags=["settings"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_platform_admin)]
SettingsAdminUser = Annotated[User, Depends(require_permission_any(Permission.SETTINGS_ADMIN))]


def _svc(session: AsyncSession, actor_id: uuid.UUID):
    """Lazy import to avoid the settings↔admin circular reference at module load."""
    from app.modules.admin.users_service import UserService

    return UserService(session, actor_id)


async def _enrich(session: AsyncSession, user: User) -> UserRead:
    """Reuse the admin router's relations helper without importing it eagerly."""
    from app.modules.admin.router import _user_with_relations

    return await _user_with_relations(session, user)


# ── Platform settings ──────────────────────────────────────────────────


@router.get("/settings", response_model=SettingsBulkRead)
async def list_settings(
    session: SessionDep,
    _user: SettingsAdminUser,
) -> SettingsBulkRead:
    rows = (await session.execute(select(PlatformSetting))).scalars().all()
    return SettingsBulkRead(
        settings=[SettingRead(key=r.key, value=r.value, updated_at=r.updated_at) for r in rows],
    )


@router.put("/settings", response_model=SettingsUpdateResponse)
async def update_settings(
    payload: SettingsUpdateRequest,
    session: SessionDep,
    user: SettingsAdminUser,
) -> SettingsUpdateResponse:
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    updated: list[str] = []
    for key, value in payload.settings.items():
        existing = await session.get(PlatformSetting, key)
        if existing is not None:
            existing.value = value
            existing.updated_by = user.id
            existing.updated_at = now
            session.add(existing)
        else:
            session.add(
                PlatformSetting(
                    key=key,
                    value=value,
                    updated_by=user.id,
                    updated_at=now,
                )
            )
        updated.append(key)
    await session.commit()
    return SettingsUpdateResponse(updated=updated)


# ── MCP 平台配置 / 白名单（change 2026-07-07-skills-mcp-management-ui task-04）──
# 存储（D-003）：复用 PlatformSetting。
#   key=mcp.platform_default → value=JSON {"mcpServers": {...}}
#   key=mcp.whitelist        → value=JSON ["server_name", ...]
# 权限：design §5.4 / D-005 写 ``MANAGE_PLATFORM``，但 ``Permission`` 枚举中
# 不存在该权限点（系统 settings 子菜单专用 admin 权限为 ``SETTINGS_ADMIN``，
# 见 permissions.py:45 注释）。本任务扩展的是 settings/router，沿用该文件
# 现有的 ``SettingsAdminUser``（``require_permission_any(SETTINGS_ADMIN)``），
# 零迁移风险且语义自洽（MCP 配置即 platform settings 子项）。

MCP_PLATFORM_DEFAULT_KEY = "mcp.platform_default"
MCP_WHITELIST_KEY = "mcp.whitelist"

# env 中含以下子串（大小写不敏感）的 key 视为 secret，admin GET 时遮蔽（D-008）。
_SECRET_KEY_MARKERS = ("token", "key", "secret", "password")
_SECRET_REDACTED_PLACEHOLDER = "<set>"


def _redact_mcp_env(mcp_servers: dict) -> dict:
    """返回 ``mcpServers`` 的深拷贝，env 中 secret 类 key 的 value 遮蔽为 ``<set>``。

    仅按 env key 名判断（含 token/key/secret/password 子串，大小写不敏感），
    与 git_gateway.redact_output 的正则文本扫描不同——后者针对 diff 输出，
    这里是结构化字段按名规则遮蔽。daemon 拉取端点（``GET /api/daemon/mcp/config``，
    task-05）返回原始值，本 admin GET 返回遮蔽值（D-008）。
    """
    redacted: dict[str, dict] = {}
    for name, server in (mcp_servers or {}).items():
        if not isinstance(server, dict):
            redacted[name] = server
            continue
        out = dict(server)
        env = out.get("env")
        if isinstance(env, dict):
            out_env: dict[str, str] = {}
            for k, v in env.items():
                lowered = str(k).lower()
                if any(marker in lowered for marker in _SECRET_KEY_MARKERS):
                    out_env[k] = _SECRET_REDACTED_PLACEHOLDER
                else:
                    out_env[k] = v
            out["env"] = out_env
        redacted[name] = out
    return redacted


async def _read_setting_json(session: AsyncSession, key: str, default):
    """读 PlatformSetting(key) 并 JSON 解码；缺失返回 default。"""
    row = await session.get(PlatformSetting, key)
    if row is None:
        return default
    try:
        return json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return default


async def _write_setting_json(session: AsyncSession, key: str, value, actor_id: uuid.UUID) -> None:
    """upsert PlatformSetting(key) = JSON.dumps(value)。"""
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    payload = json.dumps(value, ensure_ascii=False)
    existing = await session.get(PlatformSetting, key)
    if existing is not None:
        existing.value = payload
        existing.updated_by = actor_id
        existing.updated_at = now
        session.add(existing)
    else:
        session.add(
            PlatformSetting(
                key=key,
                value=payload,
                updated_by=actor_id,
                updated_at=now,
            )
        )
    await session.commit()


@router.get("/platform-settings/mcp")
async def get_mcp_platform_config(
    session: SessionDep,
    _user: SettingsAdminUser,
) -> dict:
    """读平台默认 MCP 配置，env secret 已遮蔽（admin 视图，D-008）。"""
    data = await _read_setting_json(session, MCP_PLATFORM_DEFAULT_KEY, {"mcpServers": {}})
    mcp_servers = (data or {}).get("mcpServers", {}) if isinstance(data, dict) else {}
    return {"mcpServers": _redact_mcp_env(mcp_servers)}


@router.put("/platform-settings/mcp")
async def put_mcp_platform_config(
    payload: McpServersSchema,
    session: SessionDep,
    user: SettingsAdminUser,
) -> dict:
    """写平台默认 MCP 配置（接收原值存储，不脱敏；D-008）。"""
    raw = payload.model_dump()
    await _write_setting_json(session, MCP_PLATFORM_DEFAULT_KEY, raw, user.id)
    return {"mcpServers": _redact_mcp_env(raw["mcpServers"])}


@router.get("/platform-settings/mcp-whitelist")
async def get_mcp_whitelist(
    session: SessionDep,
    _user: SettingsAdminUser,
) -> list[str]:
    """读 MCP server 白名单（server 名列表）。"""
    data = await _read_setting_json(session, MCP_WHITELIST_KEY, [])
    if isinstance(data, list):
        return [str(x) for x in data]
    return []


@router.put("/platform-settings/mcp-whitelist")
async def put_mcp_whitelist(
    session: SessionDep,
    user: SettingsAdminUser,
    servers: list[str] = Body(default_factory=list, embed=False),
) -> list[str]:
    """写 MCP server 白名单。请求体为顶层 JSON 数组（design §7 契约）。"""
    cleaned = [s for s in (servers or []) if isinstance(s, str)]
    await _write_setting_json(session, MCP_WHITELIST_KEY, cleaned, user.id)
    return cleaned


# ── User management — forwarded to admin.users_service ────────────────


@router.get("/users", response_model=UserListResponse)
async def list_users(
    session: SessionDep,
    user: AdminUser,
    q: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    role: str | None = Query(None),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> UserListResponse:
    svc = _svc(session, user.id)
    rows, total = await svc.list_users(
        q=q,
        status=status_filter,
        role=role,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )
    items = [await _enrich(session, u) for u in rows]
    return UserListResponse(items=items, total=total)


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateRequest,
    session: SessionDep,
    user: AdminUser,
) -> UserRead:
    svc = _svc(session, user.id)
    target = await svc.create_user(
        email=payload.email,
        password=payload.password,
        username=payload.username,
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        login_enabled=payload.login_enabled,
        organization_ids=payload.organization_ids or None,
        role_ids=payload.role_ids or None,
    )
    return await _enrich(session, target)


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    session: SessionDep,
    user: AdminUser,
) -> UserRead:
    svc = _svc(session, user.id)
    target = await svc.update_user(
        uuid.UUID(user_id),
        display_name=payload.display_name,
        is_platform_admin=payload.is_platform_admin,
        status=payload.status,
        login_enabled=payload.login_enabled,
        username=payload.username,
        email=payload.email,
        organization_ids=payload.organization_ids,
        role_ids=payload.role_ids,
    )
    return await _enrich(session, target)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    session: SessionDep,
    user: AdminUser,
) -> None:
    svc = _svc(session, user.id)
    await svc.delete_user(uuid.UUID(user_id))


# ── User detail endpoints ──────────────────────────────────────────────


@router.get("/users/{user_id}/sessions", response_model=list[UserSessionRead])
async def list_user_sessions(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> list[UserSessionRead]:
    svc = _svc(session, _user.id)
    rows = await svc.list_sessions(uuid.UUID(user_id))
    return [UserSessionRead.model_validate(s) for s in rows]


@router.delete("/users/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_session(
    user_id: str,
    session_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> None:
    svc = _svc(session, _user.id)
    await svc.revoke_session(uuid.UUID(user_id), uuid.UUID(session_id))


@router.post("/users/{user_id}/sessions/revoke-all", response_model=RevokeAllResponse)
async def revoke_all_user_sessions(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> RevokeAllResponse:
    svc = _svc(session, _user.id)
    count = await svc.revoke_all_sessions(uuid.UUID(user_id))
    return RevokeAllResponse(revoked_count=count)


@router.get("/users/{user_id}/audit", response_model=list[AuditLogRead])
async def list_user_audit(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> list[AuditLogRead]:
    svc = _svc(session, _user.id)
    rows = await svc.list_audit_logs(uuid.UUID(user_id))
    return [AuditLogRead.model_validate(a) for a in rows]


@router.get("/users/{user_id}/workspaces", response_model=list[UserWorkspaceRead])
async def list_user_workspaces(
    user_id: str,
    session: SessionDep,
    _user: AdminUser,
) -> list[UserWorkspaceRead]:
    svc = _svc(session, _user.id)
    return await svc.list_workspaces(uuid.UUID(user_id))


@router.post("/users/{user_id}/reset-password", response_model=ResetPasswordResponse)
async def reset_user_password(
    user_id: str,
    payload: ResetPasswordRequest,
    session: SessionDep,
    _user: AdminUser,
) -> ResetPasswordResponse:
    svc = _svc(session, _user.id)
    plaintext = await svc.reset_password(
        uuid.UUID(user_id),
        payload.new_password,
        force_change_on_next_login=payload.force_change_on_next_login,
    )
    return ResetPasswordResponse(plaintext_password=plaintext)
