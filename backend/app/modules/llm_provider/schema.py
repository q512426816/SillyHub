"""Pydantic DTOs for LLM provider.

api_key 仅以 masked 形式出参（``api_key_masked``），明文 / 密文永不暴露（R-02/R-04）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class LlmProviderCreate(BaseModel):
    name: str
    agent_kind: Literal["claude"] = "claude"
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    notes: str | None = None
    website_url: str | None = None
    auth_field: Literal["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] = "ANTHROPIC_AUTH_TOKEN"
    model_role_mappings: dict[str, Any] | None = None
    default_fallback_model: str | None = None
    extra_env: dict[str, Any] | None = None
    is_default: bool = False


class LlmProviderUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None  # None = 不动原密钥
    model: str | None = None
    notes: str | None = None
    website_url: str | None = None
    auth_field: Literal["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] | None = None
    model_role_mappings: dict[str, Any] | None = None
    default_fallback_model: str | None = None
    extra_env: dict[str, Any] | None = None
    is_default: bool | None = None


class LlmProviderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    agent_kind: str
    base_url: str | None
    model: str | None
    notes: str | None
    website_url: str | None
    auth_field: str
    model_role_mappings: dict[str, Any] | None
    default_fallback_model: str | None
    extra_env: dict[str, Any] | None
    is_default: bool
    # service _to_read 算后注入（默认 None = 安全方向，绝不泄漏明文，规则 X-09）
    api_key_masked: str | None = None
    created_at: datetime
    updated_at: datetime


class LlmProviderList(BaseModel):
    items: list[LlmProviderRead]
    total: int
