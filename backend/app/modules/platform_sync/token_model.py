"""``platform_sync_tokens`` table — workspace 级进度同步鉴权 token。

Change 2026-08-11-change-progress-projection task-01 / design §8.1 / D-001@v1。

本模块只落 schema（表 + ORM），不写任何业务行为（task-01 goal）：
- ``platform_sync_tokens``：sillyspec 工具客户端上行进度时用的 workspace-scoped token。
  字段集参照 ``mcp_gateway.McpTokenORM``（workspace_id / token_hash / created_by /
  created_at / last_used_at / revoked_at）+ ``auth.ApiKey``（name），职责分离独立新表
  （MCP 派发 ≠ 进度同步，design §1.3）。明文仅签发时返回一次，库存 sha256 hex
  （``token_hash``），可独立吊销（``revoked_at``），``last_used_at`` 供审计。

与 ``McpTokenORM`` 的关键差异（task-01 constraints / design §8.1）：
- ``created_by`` 为 **NOT NULL**（McpTokenORM 可空 SET NULL）。``authenticate`` 需据此
  派生非空 ``User``，作为收件箱上行请求的归属用户。
- 不含 ``key_prefix`` / ``expires_at``（McpTokenORM 无此二列；如需展示前缀后续再加）。
- ``scope`` 可空（预留，进度同步暂不按 scope 分级，区别 MCP 的 read/dispatch/converge）。

写法对齐 ``app/modules/mcp_gateway/model.py``（SQLModel Field + sa_column 风格、
DateTime(timezone=True)、created_at 带 server_default text(now())）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, String, Uuid, text
from sqlmodel import Field

from app.models.base import BaseModel


class PlatformSyncTokenORM(BaseModel, table=True):
    """workspace 级进度同步 token（design §8.1 / D-001@v1）。

    明文 token 仅签发时返回一次（前缀 ``shpsync_``）；库存
    ``token_hash = sha256(明文)``，不存明文。``require_platform_sync`` 校验：hash 传入
    token → 等值查本表 → 未吊销（``revoked_at`` IS NULL）才放行，命中后回写
    ``last_used_at``，并据此行派生 ``(user=created_by, workspace_id)`` 供收件箱隔离。
    """

    __tablename__ = "platform_sync_tokens"
    __table_args__ = (
        # token_hash 唯一索引：校验按 hash 等值定位单行（design §8.1 索引要求）。
        Index("ix_platform_sync_tokens_token_hash", "token_hash", unique=True),
        # workspace_id 普通索引：owner 列出自己 token 走 workspace 维度查。
        Index("ix_platform_sync_tokens_workspace_id", "workspace_id"),
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
    # authenticate 据此派生非空 User（区别 McpTokenORM 可空 SET NULL，task-01 constraints）。
    created_by: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str = Field(sa_column=Column(String(100), nullable=False))  # 人类可读标签
    # sha256(明文 token) hex；不存明文。唯一性由 ix_platform_sync_tokens_token_hash 承担。
    token_hash: str = Field(sa_column=Column(String(255), nullable=False))
    # scope 预留（进度同步暂不分级，区别 MCP read/dispatch/converge）。
    scope: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    # 审计：require_platform_sync 最近一次命中校验的时间（NULL = 从未用过）。
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # 吊销时间戳（NULL = 有效）；吊销后 require_platform_sync 拒绝。
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
