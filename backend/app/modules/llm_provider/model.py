"""LlmProvider table.

用户级 LLM 供应商凭证（design §7 / §8）。owner = ``user_id``（D-002 用户级作用域）；
``encrypted_api_key`` + ``key_id`` 复用 ``core/crypto.py`` 的 ``CredentialCipher``
（xchacha20-poly1305，D-009，照 git_identity）；``is_default`` 在
``(user_id, agent_kind)`` 维度互斥（service 层事务内保证，R-05）。

列定义须与 ``migrations/versions/20260725_create_llm_providers.py`` 一一对应（防漂移）；
``multimodal`` 列对应 ``migrations/versions/20260820100000_session_attachments_multimodal.py``。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, LargeBinary, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class LlmProvider(BaseModel, table=True):
    """A user-scoped LLM provider credential (claude first; codex/gemini/pi reserved)."""

    __tablename__ = "llm_providers"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str = Field(
        max_length=128,
        sa_column=Column(String(128), nullable=False),
    )
    agent_kind: str = Field(
        max_length=32,
        sa_column=Column(String(32), nullable=False),
    )
    base_url: str | None = Field(
        default=None,
        max_length=512,
        sa_column=Column(String(512), nullable=True),
    )
    encrypted_api_key: bytes = Field(
        sa_column=Column(LargeBinary, nullable=False),
    )
    key_id: str = Field(
        max_length=64,
        sa_column=Column(String(64), nullable=False),
    )
    model: str | None = Field(
        default=None,
        max_length=128,
        sa_column=Column(String(128), nullable=True),
    )
    # 多模态能力三态门控（D-9）：auto=按模型名启发式推断 / true/false=手动覆盖
    # （中转站别名的权威来源）；server_default='auto' 存量行为零回归。
    multimodal: str = Field(
        default="auto",
        max_length=8,
        sa_column=Column(String(8), nullable=False, server_default="auto"),
    )
    notes: str | None = Field(
        default=None,
        max_length=512,
        sa_column=Column(String(512), nullable=True),
    )
    website_url: str | None = Field(
        default=None,
        max_length=512,
        sa_column=Column(String(512), nullable=True),
    )
    auth_field: str = Field(
        default="ANTHROPIC_AUTH_TOKEN",
        max_length=64,
        sa_column=Column(String(64), nullable=False),
    )
    api_format: str = Field(
        default="anthropic",
        max_length=32,
        sa_column=Column(String(32), nullable=False, server_default="anthropic"),
    )
    model_role_mappings: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    default_fallback_model: str | None = Field(
        default=None,
        max_length=128,
        sa_column=Column(String(128), nullable=True),
    )
    extra_env: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    settings_config: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    is_default: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime, nullable=False, default=datetime.utcnow),
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(
            DateTime,
            nullable=False,
            default=datetime.utcnow,
            onupdate=datetime.utcnow,
        ),
    )

    __table_args__ = (
        Index("ix_llm_providers_user", "user_id"),
        Index("ix_llm_providers_user_agent_default", "user_id", "agent_kind", "is_default"),
    )
