"""Pydantic DTOs for git identity."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# security-audit-remediation task-10 / FR-11：git_username / git_email 会原样拼进
# lease 隔离目录的 gitconfig（exec_env.write_gitconfig），换行 / 回车 / 方括号 /
# 控制字符可注入伪造 gitconfig 段（如 ``[credential] helper = !<cmd>``）。入口
# pattern 阻断：username 单行、无方括号、无控制字符、≤64；email 单行且形如
# local@domain。两字段仍可选（None 合法）；GitIdentityRead（出参）不加校验——
# 存量历史数据读取不因历史值不合规而 500。
_GIT_USERNAME_PATTERN = r"^[\w.\- ]{1,64}$"
# 简单 email 形状校验（local@domain，各侧字母数字加常用符号，无空白/换行）。
# 项目未依赖 email-validator，不用 pydantic.EmailStr（引入依赖不合算，见 task-10）。
_GIT_EMAIL_PATTERN = r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)+$"


class GitIdentityCreate(BaseModel):
    provider: str = Field(..., pattern=r"^(github|gitlab|gitea|generic)$")
    credential_type: str = Field(default="pat", pattern=r"^(pat|oauth|ssh_key|app)$")
    git_username: str | None = Field(default=None, pattern=_GIT_USERNAME_PATTERN)
    git_email: str | None = Field(default=None, pattern=_GIT_EMAIL_PATTERN)
    credential: str
    allowed_repositories: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None


class GitIdentityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    provider: str
    git_username: str | None
    git_email: str | None
    credential_type: str
    key_id: str
    allowed_repositories: list[str]
    expires_at: datetime | None
    revoked_at: datetime | None
    last_used_at: datetime | None
    created_at: datetime


class GitIdentityList(BaseModel):
    items: list[GitIdentityRead]
    total: int


class AccessCheckRequest(BaseModel):
    identity_id: uuid.UUID
    repo_url: str


class AccessCheckResult(BaseModel):
    identity_id: uuid.UUID
    repo_url: str
    accessible: bool
    reason: str | None = None
