"""Per-user custom skills persisted in ``custom_skills`` table.

Change: 2026-07-31-custom-skill-per-user (task-01)

设计决策:
- D-001（2026-07-31@v2）: 单文件 DB model（本模块只有一张表，无跨表关系，无需拆分多 model 文件）。
- D-001（2026-07-31-custom-skill-per-user）: 归属键复用 ``created_by``（NOT NULL + ON DELETE
  CASCADE）——创建即归属，用户注销级联删其技能；不再新加 owner_user_id（YAGNI）。
- D-002@v2: ``name`` 改为 ``(created_by, name)`` 联合唯一（每用户内唯一，不同用户可同名）；
  字符集 [a-z0-9-] 2-40 的校验仍留业务层（service），DB 只保证唯一性而非字符集。
- D-007: 废弃旧决策——D-010（平台级全局共享，所有工作区/用户共享同一份）已废弃，改 per-user；
  原 D-002（``name`` 全局唯一）已废弃，改联合唯一（见 D-002@v2）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class CustomSkill(BaseModel, table=True):
    """A user-authored skill owned per-user (SKILL.md body stored as ``content``).

    per-user 强归属：``created_by`` NOT NULL + ON DELETE CASCADE，用户注销级联删其技能（D-001）；
    ``name`` 在 ``(created_by, name)`` 联合唯一约束下每用户内唯一（D-002@v2）。
    """

    __tablename__ = "custom_skills"
    # D-002@v2: name 从列级全局 unique 改为 (created_by, name) 联合唯一。
    __table_args__ = (
        UniqueConstraint("created_by", "name", name="uq_custom_skills_created_by_name"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # D-002@v2: DB 层只管长度上限 40；唯一性由表级 (created_by, name) 联合约束承担，
    # 字符集 [a-z0-9-] 校验在 service。
    name: str = Field(
        sa_column=Column(String(40), nullable=False),
    )
    description: str = Field(
        sa_column=Column(String(200), nullable=False),
    )
    # SKILL.md 正文 body（YAML frontmatter 由打包层 skills_bundle_service 组装，DB 只存 body）。
    content: str = Field(sa_column=Column(Text, nullable=False))
    # D-001: per-user 强归属——NOT NULL + ON DELETE CASCADE，用户注销级联删其技能。
    created_by: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
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
