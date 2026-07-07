"""Pydantic DTOs for the platform-settings API.

User-related schemas were moved to :mod:`app.modules.admin.schema`
(change ``2026-06-16-admin-org-role-center`` task-06). They are
re-exported here so historical imports keep working.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# ── Platform settings (still owned here) ───────────────────────────────


class SettingRead(BaseModel):
    key: str
    value: str
    updated_at: datetime | None = None


class SettingsBulkRead(BaseModel):
    settings: list[SettingRead]


class SettingsUpdateRequest(BaseModel):
    settings: dict[str, str] = Field(min_length=1)


class SettingsUpdateResponse(BaseModel):
    updated: list[str]


# ── MCP 平台配置 / 白名单（change 2026-07-07-skills-mcp-management-ui task-04）──
# 结构校验（D-009）：{mcpServers: {name: {command, args, env?}}}；非法 → 422。
# 存储复用 PlatformSetting（D-003），key=mcp.platform_default / mcp.whitelist。


class McpServerEntry(BaseModel):
    """单个 MCP server 定义（仿 claude ``.mcp.json`` 结构）。"""

    command: str = Field(min_length=1)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] | None = None


class McpServersSchema(BaseModel):
    """``PUT /api/platform-settings/mcp`` 请求体。"""

    mcpServers: dict[str, McpServerEntry] = Field(default_factory=dict)  # noqa: N815 - JSON 契约字段名（claude .mcp.json / design §7，不可改 snake_case）


# ── User schemas — re-exported from admin.schema (task-06) ─────────────


from app.modules.admin.schema import (  # noqa: E402
    AuditLogRead,
    OrganizationBrief,
    ResetPasswordRequest,
    ResetPasswordResponse,
    RevokeAllResponse,
    RoleBrief,
    UserCreateRequest,
    UserListResponse,
    UserQueryParams,
    UserRead,
    UserSessionRead,
    UserUpdateRequest,
    UserWorkspaceRead,
)

__all__ = [
    "AuditLogRead",
    "McpServerEntry",
    "McpServersSchema",
    "OrganizationBrief",
    "ResetPasswordRequest",
    "ResetPasswordResponse",
    "RevokeAllResponse",
    "RoleBrief",
    "SettingRead",
    "SettingsBulkRead",
    "SettingsUpdateRequest",
    "SettingsUpdateResponse",
    "UserCreateRequest",
    "UserListResponse",
    "UserQueryParams",
    "UserRead",
    "UserSessionRead",
    "UserUpdateRequest",
    "UserWorkspaceRead",
]
