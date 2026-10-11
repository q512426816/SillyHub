"""McpToken 与 McpWebhook ORM 模型（对外 MCP 鉴权 + webhook 通知）。

Change 2026-08-06-public-mcp-server task-01 / design §8.1 §8.2 / D-002 / D-003。

本模块只落 schema（表 + ORM），不写任何业务行为（task-01 goal）：
- ``mcp_tokens``：第三方接入平台的 MCP token。绑单个 workspace + scope 集合
  （read/dispatch/converge），明文仅签发时返回一次，库存 sha256 hex（``token_hash``），
  可独立吊销（``revoked_at``），``last_used_at`` 供审计。下游 token service
  （签发/校验/吊销）与 Starlette middleware 直接 import 本类。
- ``mcp_webhooks``：worker 终态回调注册。绑单个 token（级联删）+ 冗余 workspace_id
  （便于查询）。投递器按 ``events`` 过滤后 POST ``url``，body 用 ``secret`` 做
  HMAC-SHA256 签名。``secret`` 列本任务只定 String，加密归 task-11 service 层
  （design §8.2 / task-01 constraints）。

写法对齐 ``app/modules/agent/model.py``（SQLModel Field + sa_column 风格、
DateTime(timezone=True)、created_at 带 server_default text(now())）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class McpTokenORM(BaseModel, table=True):
    """第三方接入平台的 MCP token（design §8.1）。

    鉴权库存 ``token_hash = sha256(明文)``；middleware 校验：hash 传入 token →
    等值查本表 → 未吊销（``revoked_at`` IS NULL）才放行，命中后回写
    ``last_used_at``。``scope`` 决定可调用的 tool 集合。自
    2026-10-11-apikey-mcp-copy-delete 起明文另存可逆加密列 ``encrypted_token``
    （libsodium secretbox + KEK）供管理端「复制令牌」按需取回；存量行为 NULL
    （不可恢复，R-06 原语义仅对此类行继续成立）。
    """

    __tablename__ = "mcp_tokens"
    __table_args__ = (
        # token_hash 唯一索引：校验按 hash 等值定位单行（design §8.1 索引要求）。
        Index("ix_mcp_tokens_token_hash", "token_hash", unique=True),
        # workspace_id 普通索引：owner 列出自己 token 走 workspace 维度查。
        Index("ix_mcp_tokens_workspace_id", "workspace_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str = Field(sa_column=Column(String(100), nullable=False))  # 人类可读标签
    # sha256(明文 token) hex；鉴权按 hash 等值 O(1) 查表。唯一性由 ix_mcp_tokens_token_hash 承担。
    token_hash: str = Field(sa_column=Column(String(128), nullable=False))
    # 可逆加密的明文（``{key_id}:{hex(ciphertext)}``，libsodium secretbox + KEK=
    # SILLYSPEC_MASTER_KEY，与 mcp_webhooks.secret 同构）：管理端「复制令牌」按需
    # 解密返回（2026-10-11-apikey-mcp-copy-delete）。NULL = 存量行或签发时未配置
    # 主密钥——明文不可恢复，UI 复制入口降级禁用。token_hash 鉴权路径不依赖本列。
    encrypted_token: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    # scope 集合：["read","dispatch","converge"]。middleware 按 scope 拒绝越界 tool。
    scope: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    # 审计：middleware 最近一次命中校验的时间（NULL = 从未用过）。
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # 吊销时间戳（NULL = 有效）；吊销后 middleware 拒绝。
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    @property
    def plaintext_recoverable(self) -> bool:
        """明文是否可再取回（签发时加密存档）。吊销状态由 revoked_at 自表达。"""
        return self.encrypted_token is not None


class McpWebhookORM(BaseModel, table=True):
    """第三方 webhook 回调注册（design §8.2）。

    绑单个 token（token 删则级联删 webhook）+ 冗余 workspace_id（便于管理 API 查询）。
    投递器在 worker 终态钩子触发（``complete_lease``，CC-08），按 ``events`` 过滤后
    POST ``url``，body 用 ``secret`` 做 HMAC-SHA256 签名。``active=false`` 软停用
    （不再投递，行保留供审计）。
    """

    __tablename__ = "mcp_webhooks"
    __table_args__ = (
        # token_id 普通索引：投递器按 token 查其下所有 webhook。
        Index("ix_mcp_webhooks_token_id", "token_id"),
        # workspace_id 普通索引：管理 API 列出 workspace 下 webhook。
        Index("ix_mcp_webhooks_workspace_id", "workspace_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    token_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("mcp_tokens.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    url: str = Field(sa_column=Column(String(500), nullable=False))  # 回调地址
    # HMAC 密钥；加密归 task-11 service 层，本任务只定 String 列（design §8.2 / constraints）。
    secret: str = Field(sa_column=Column(String(128), nullable=False))
    # 订阅事件集合：["worker.completed","worker.failed"] 或 ["*"] 全订阅。
    events: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )  # 软停用（false = 不再投递，行保留）
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
