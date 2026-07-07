"""Platform-level custom skills persisted in ``custom_skills`` table.

Change: 2026-07-07-skills-mcp-management-ui (task-01)

设计决策:
- D-001: 单文件 DB model（本模块只有一张表，无跨表关系，无需拆分多 model 文件）。
- D-002: ``name`` 在 DB 层 UNIQUE + 长度上限 40；字符集 [a-z0-9-] 2-40 的校验留业务层
  （task-02 service），DB 只保证唯一性而非字符集。
- D-010: 平台级 skill，无 ``workspace_id``——所有工作区共享同一份平台 skill 库。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class CustomSkill(BaseModel, table=True):
    """A user-authored platform-level skill (SKILL.md body stored as ``content``).

    平台级共享：不绑定 workspace，所有工作区可见同一份（D-010）。
    """

    __tablename__ = "custom_skills"
    __table_args__ = ()

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # D-002: DB 层只管唯一 + 长度；字符集 [a-z0-9-] 校验在 service（task-02）。
    name: str = Field(
        sa_column=Column(String(40), unique=True, nullable=False),
    )
    description: str = Field(
        sa_column=Column(String(200), nullable=False),
    )
    # SKILL.md 正文（YAML frontmatter 由业务层组装，DB 只存 body）。
    content: str = Field(sa_column=Column(Text, nullable=False))
    # 平台级，但记录创建者以便审计；用户删除时 SET NULL（与 agent_missions.created_by 同风格）。
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
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
