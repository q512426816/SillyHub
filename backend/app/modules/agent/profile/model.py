"""``agent_profiles`` table model — AgentProfile 配置层。

Change 2026-08-02-agent-profile-layer task-02 / design §3.1 / D-001~D-009.
管「模型 + 系统提示词 + MCP/技能引用 + 工具策略引用」，作为现有 dispatch
spec_bundle 的**增强层**（非替代）。profile=None 走原 dispatch 路径零回归
（design §8 软约束兜底链）。agent 层严禁存密钥（design §10 红线）。

字段 / nullability / FK ondelete / 索引名与迁移 ``20260802_agent_profile``
一一对齐（task-01 建表）。visibility 枚举校验在 model/service 层，DB 层存
String（与 status 等列同风格，免后续加值迁移）。
"""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class AgentProfileVisibility(enum.StrEnum):
    """智能体档案三级可见性（D-009）。

    ``StrEnum`` 成员即 ``str``：写入 DB 落 ``.value``，读出由 Pydantic 自动
    还原为枚举。DB 层 String(20)，与 status 等列同风格免后续加值迁移。
    """

    PRIVATE = "private"  # 仅 owner 可见
    WORKSPACE = "workspace"  # workspace 成员可见
    PLATFORM = "platform"  # 全平台可见（仅 admin 可改）


class AgentProfile(BaseModel, table=True):
    """一个可复用、可管理的「智能体档案」(design §3.1)。

    管人格（provider/model/system_prompt）+ 工具能力（tool_policy/mcp_refs/
    skill_refs/allowed_roots_overlay）。dispatch 时由 profile service 解析并
    快照进 :class:`~app.modules.agent.model.AgentRun`；``system_prompt`` 经
    backend prepend 进 claudeMd（D-012@v2），``allowed_roots_overlay`` 由
    backend 算 ``∩ daemon.allowed_roots`` 后下推（D-013，**只能收紧**）。
    """

    __tablename__ = "agent_profiles"
    __table_args__ = (
        Index("ix_agent_profiles_owner_user_id", "owner_user_id"),
        Index("ix_agent_profiles_workspace_id", "workspace_id"),
        Index("ix_agent_profiles_visibility", "visibility"),
        Index("ix_agent_profiles_provider", "provider"),
        Index("ix_agent_profiles_is_system_default", "is_system_default"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    name: str = Field(sa_column=Column(String(200), nullable=False))
    # 创建者；平台预置档案（is_system_default=True）owner 为 NULL，故 nullable。
    # 用户注销 SET NULL 保留档案供审计（迁移 ondelete=SET NULL）。
    owner_user_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # workspace 级归属；private / platform 级为 NULL。workspace 删则 CASCADE 清档案。
    workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    visibility: AgentProfileVisibility = Field(
        default=AgentProfileVisibility.PRIVATE,
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("'private'"),
        ),
    )
    # 供应商偏好（claude/codex/…），作 target_provider（D-014，优先于 workspace.default_agent）。
    provider: str = Field(sa_column=Column(String(64), nullable=False))
    model: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    system_prompt: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    # v1 仅引用不叠加（D-016）。policy 删则 SET NULL，档案保留。
    tool_policy_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tool_policies.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # 勾选的 MCP server name 列表（引用 workspace/平台 MCP 配置，非内联凭证）；
    # 空列表 = 不勾选任何引用。NOT NULL，默认空列表。
    mcp_refs: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, server_default=text("'[]'")),
    )
    # 勾选的技能 ref 列表（引用 user 技能池）；空列表 = 不勾选。NOT NULL，默认空列表。
    skill_refs: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, server_default=text("'[]'")),
    )
    # 能力白名单可写目录（**只能收紧**，backend 算 ∩ daemon.allowed_roots 后下推，D-013）。
    # NULL = 不叠加 overlay，用 daemon 原值。
    allowed_roots_overlay: list[str] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    version: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, server_default=text("1")),
    )
    is_system_default: bool = Field(
        default=False,
        sa_column=Column(
            Boolean,
            nullable=False,
            server_default=text("false"),
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
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
