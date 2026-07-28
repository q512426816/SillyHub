"""Pydantic DTOs for the auth API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    # 登录账号:邮箱或 username(含 @ 走 email 查,否则走 username 查)。
    account: str = Field(min_length=3)
    password: str = Field(min_length=1)
    # 滑块验证码 token:同一 IP 失败≥threshold 时必填(前端 verify 通过后回传)。
    captcha_token: str | None = None


class SliderCaptchaResponse(BaseModel):
    """GET /auth/captcha/slider 返回:背景图 + 滑块块(base64 data-URI),target_x 仅存后端。"""

    captcha_id: str
    bg_image: str  # data:image/png;base64,....（前端 <img src=> 直接用）
    slider_image: str


class SliderCaptchaVerifyRequest(BaseModel):
    captcha_id: str = Field(min_length=1)
    x: int = Field(ge=0, le=1000)  # 用户拖动停止时滑块左边缘 x 坐标(px)


class SliderCaptchaVerifyResponse(BaseModel):
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
