"""LlmProvider table.

用户级 LLM 供应商凭证（design §7 / §8）。owner = ``user_id``（D-002 用户级作用域）；
``encrypted_api_key`` + ``key_id`` 复用 ``core/crypto.py`` 的 ``CredentialCipher``
（xchacha20-poly1305，D-009，照 git_identity）；``is_default`` 在
``(user_id, 引擎)`` 维度互斥——多引擎行对 agent_kinds 集合内每个引擎各占一个默认位
（service 层事务内保证，R-05；D-003/D-006）。

``agent_kinds`` JSON 数组列（change 2026-10-06-provider-multi-agent-kind / D-004）：
一条凭证可服务多个引擎（claude/codex/pi...），解析链按「引擎 ∈ 集合」命中。列定义须与
``migrations/versions/20261006120000_provider_agent_kinds.py`` 迁移终态一一对应（防漂移）；
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
    # 引擎集合（D-004 单列改数组）：至少一个引擎；解析链按「引擎 ∈ agent_kinds」命中。
    agent_kinds: list[str] = Field(
        sa_column=Column(JSON, nullable=False),
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
        # 原 (user_id, agent_kind, is_default) 复合索引随 agent_kind 列删除而退役
        # （迁移 20261006120000）；默认/引擎过滤转行级 Python 判断（每用户行数几十级）。
        Index("ix_llm_providers_user", "user_id"),
    )
