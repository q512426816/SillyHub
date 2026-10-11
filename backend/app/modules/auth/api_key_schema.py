"""Pydantic DTOs for the API Key endpoints.

Plaintext surfaces in two places only: ``ApiKeyCreated`` (POST 201, the
canonical one-time return) and ``ApiKeyPlaintextResponse`` (per-id
re-fetch, gated to active keys with a stored ``encrypted_key`` —
2026-10-11-apikey-mcp-copy-delete). ``ApiKeyRead`` (list rows) never
contains the plaintext or the hash, only the ``plaintext_recoverable``
hint so the UI can enable its copy button.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = Field(default=None)


class ApiKeyRead(BaseModel):
    """List-row shape — safe to return on every GET."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    key_prefix: str
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime
    revoked_at: datetime | None
    # 明文是否可再取回（签发时加密存档；存量行/未配主密钥 = False）。吊销/过期
    # 状态由 revoked_at / expires_at 表达，前端组合判断是否显示复制按钮。
    plaintext_recoverable: bool


class ApiKeyCreated(ApiKeyRead):
    """Returned once on POST 201. Carries the full plaintext key."""

    plaintext: str


class ApiKeyPlaintextResponse(BaseModel):
    """GET /api-keys/{id}/plaintext 响应——管理端「复制密钥」按需取回明文。"""

    plaintext: str = Field(description="完整密钥明文，仅复制入口使用，勿入日志")


class ApiKeyListResponse(BaseModel):
    items: list[ApiKeyRead]
