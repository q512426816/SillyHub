"""``changes`` and ``change_documents`` tables.

Schema follows ``references/17-db-schema.md`` §2.4.
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
)
from sqlmodel import Field

from app.models.base import BaseModel


class StageEnum(enum.StrEnum):
    """变更流程阶段枚举：5 主阶段（scan 已移除，回归 workspace 初始化）。"""

    # ── 变更流程主阶段（scan 不在变更流程，由 workspace 初始化承载） ──
    BRAINSTORM = "brainstorm"
    PLAN = "plan"
    EXECUTE = "execute"
    VERIFY = "verify"
    ARCHIVE = "archive"

    @classmethod
    def spec_stages(cls) -> list[StageEnum]:
        """SillySpec 主阶段列表。"""
        return [
            cls.BRAINSTORM,
            cls.PLAN,
            cls.EXECUTE,
            cls.VERIFY,
            cls.ARCHIVE,
        ]


class ChangeStatus(enum.StrEnum):
    """变更状态枚举，对齐 sillyspec progress.js。"""

    ACTIVE = "active"
    ARCHIVED = "archived"


class StageStatus(enum.StrEnum):
    """阶段状态枚举，对齐 sillyspec progress.js:44。"""

    PENDING = "pending"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"
    REVISING = "revising"
    STALE = "stale"


class StepStatus(enum.StrEnum):
    """步骤状态枚举，对齐 sillyspec progress.js:41。"""

    PENDING = "pending"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"
    WAITING = "waiting"
    STALE = "stale"


TRANSITIONS: dict[StageEnum, dict[StageEnum, list[str]]] = {
    # ── 变更主线流程（scan 已移除，brainstorm 为入口） ──
    StageEnum.BRAINSTORM: {StageEnum.PLAN: ["agent"]},
    StageEnum.PLAN: {StageEnum.EXECUTE: ["agent"]},
    StageEnum.EXECUTE: {StageEnum.VERIFY: ["agent"]},
    StageEnum.VERIFY: {StageEnum.ARCHIVE: ["agent"]},
}


def can_transition(current: StageEnum, target: StageEnum) -> bool:
    """检查从 current 到 target 的流转是否合法（仅检查边是否存在，不检查角色）。"""
    return target in TRANSITIONS.get(current, {})


class Change(BaseModel, table=True):
    """A change record parsed from ``.sillyspec/changes/{location}/{change_key}/``."""

    __tablename__ = "changes"
    __table_args__ = (
        Index(
            "ux_changes_workspace_key",
            "workspace_id",
            "change_key",
            unique=True,
        ),
        Index("ix_changes_workspace", "workspace_id", "location", "status"),
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
    change_key: str = Field(sa_column=Column(String(200), nullable=False))
    title: str | None = Field(default=None, sa_column=Column(String(500), nullable=True))
    status: str = Field(
        default="draft", sa_column=Column(String(30), nullable=False, default="draft")
    )
    location: str = Field(sa_column=Column(String(20), nullable=False))
    path: str = Field(sa_column=Column(Text, nullable=False))
    affected_components: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    change_type: str | None = Field(default=None, sa_column=Column(String(50), nullable=True))
    owner_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    archived_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    current_stage: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True, default=None),
    )
    stages: dict = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=True, default=dict),
    )
    approval_status: str = Field(
        default="not_required",
        sa_column=Column(String, nullable=False, default="not_required"),
    )
    approved_by: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True, default=None),
    )
    approved_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True, default=None),
    )
    rejection_reason: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True, default=None),
    )
    feedback_category: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True, default=None),
    )
    feedback_text: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True, default=None),
    )


class ChangeDocument(BaseModel, table=True):
    """A document within a change directory."""

    __tablename__ = "change_documents"
    __table_args__ = (
        Index(
            "ux_change_docs_type_path",
            "change_id",
            "doc_type",
            "path",
            unique=True,
        ),
        Index("ix_change_docs_change", "change_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    change_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    doc_type: str = Field(sa_column=Column(String(30), nullable=False))
    path: str = Field(sa_column=Column(Text, nullable=False))
    exists: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))
    status: str | None = Field(default=None, sa_column=Column(String(30), nullable=True))
    last_modified_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    word_count: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
