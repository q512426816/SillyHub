"""Pydantic DTOs for the auth API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security import assert_password_strength


class LoginRequest(BaseModel):
    # 登录账号:邮箱或 username(含 @ 走 email 查,否则走 username 查)。
    account: str = Field(min_length=3)
    password: str = Field(min_length=1)
    # 人机确认 token:同一 IP 失败≥threshold 时必填(前端点按确认通过后回传)。
    captcha_token: str | None = None


class ConfirmCaptchaResponse(BaseModel):
    """GET /auth/captcha/confirm 返回:一次性 captcha_id(点「我不是机器人」时取)。"""

    captcha_id: str


class CaptchaVerifyRequest(BaseModel):
    captcha_id: str = Field(min_length=1)


class CaptchaVerifyResponse(BaseModel):
    """校验通过 → 返回一次性 captcha_token,登录时回传。"""

    success: bool
    captcha_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    """Body of ``POST /api/auth/change-password``（用户自助修改密码）。

    ``old_password`` 必填（旧密码，verify 通过才允许改）；``new_password`` 至少 8 位
    （对齐 ``UserCreateRequest.password`` 的 min_length=8）。``confirm_password`` 仅前端
    校验，后端不收（``extra="forbid"`` 拒绝多余字段）。
    """

    model_config = ConfigDict(extra="forbid")

    old_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)

    @field_validator("new_password")
    @classmethod
    def _check_strength(cls, v: str) -> str:
        return assert_password_strength(v)


class TokenPair(BaseModel):
    """Issued on login + refresh."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    access_expires_in: int  # seconds
    refresh_expires_in: int  # seconds


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    username: str | None
    display_name: str | None
    employee_no: str | None
    status: str
    is_platform_admin: bool
    last_login_at: datetime | None
    created_at: datetime


class WorkspaceRoleAssignment(BaseModel):
    workspace_id: uuid.UUID
    role_key: str
    role_name: str


class MeResponse(BaseModel):
    user: UserRead
    workspaces: list[WorkspaceRoleAssignment]
    permissions: list[str] = Field(default_factory=list)
