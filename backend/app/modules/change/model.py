"""``changes`` and ``change_documents`` tables.

Schema follows ``references/17-db-schema.md`` §2.4.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy import JSON
from sqlmodel import Field

from app.models.base import BaseModel


class StageEnum(str, enum.Enum):
    """统一工作流阶段枚举：SillySpec 8 主阶段 + Hub 3 业务扩展。"""

    # ── SillySpec 主阶段（由 CLI 管理） ──
    SCAN = "scan"
    BRAINSTORM = "brainstorm"
    PROPOSE = "propose"
    PLAN = "plan"
    EXECUTE = "execute"
    VERIFY = "verify"
    ARCHIVE = "archive"
    QUICK = "quick"

    # ── Hub 业务扩展阶段 ──
    DRAFT = "draft"
    REWORK_REQUIRED = "rework_required"
    ACCEPTED = "accepted"

    @classmethod
    def spec_stages(cls) -> list["StageEnum"]:
        """SillySpec 主阶段列表。"""
        return [
            cls.SCAN, cls.BRAINSTORM, cls.PROPOSE, cls.PLAN,
            cls.EXECUTE, cls.VERIFY, cls.ARCHIVE, cls.QUICK,
        ]

    @classmethod
    def hub_stages(cls) -> list["StageEnum"]:
        """Hub 业务扩展阶段列表。"""
        return [cls.DRAFT, cls.REWORK_REQUIRED, cls.ACCEPTED]

    @classmethod
    def all_stages(cls) -> list["StageEnum"]:
        """全部阶段列表。"""
        return cls.spec_stages() + cls.hub_stages()


TRANSITIONS: dict[StageEnum, dict[StageEnum, list[str]]] = {
    # ── Hub: draft → SillySpec 入口 ──
    StageEnum.DRAFT: {
        StageEnum.PROPOSE: ["business_user", "agent"],
        StageEnum.QUICK: ["business_user", "agent"],
        StageEnum.EXECUTE: ["admin"],
        StageEnum.SCAN: ["agent"],
    },
    # ── SillySpec 主线流程 ──
    StageEnum.SCAN: {
        StageEnum.BRAINSTORM: ["agent"],
    },
    StageEnum.BRAINSTORM: {
        StageEnum.PROPOSE: ["agent"],
    },
    StageEnum.PROPOSE: {
        StageEnum.PLAN: ["reviewer", "agent"],
        StageEnum.BRAINSTORM: ["reviewer"],
    },
    StageEnum.PLAN: {
        StageEnum.EXECUTE: ["reviewer", "agent"],
        StageEnum.PROPOSE: ["reviewer"],
    },
    StageEnum.EXECUTE: {
        StageEnum.VERIFY: ["agent"],
    },
    StageEnum.VERIFY: {
        StageEnum.ACCEPTED: ["reviewer"],
        StageEnum.REWORK_REQUIRED: ["reviewer"],
    },
    StageEnum.QUICK: {
        StageEnum.ACCEPTED: ["reviewer"],
        StageEnum.REWORK_REQUIRED: ["reviewer"],
    },
    # ── Hub 业务扩展 ──
    StageEnum.REWORK_REQUIRED: {
        StageEnum.PROPOSE: ["reviewer"],
        StageEnum.PLAN: ["reviewer"],
        StageEnum.EXECUTE: ["reviewer"],
    },
    StageEnum.ACCEPTED: {
        StageEnum.ARCHIVE: ["system"],
    },
    StageEnum.ARCHIVE: {},
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
    status: str = Field(default="draft", sa_column=Column(String(30), nullable=False, default="draft"))
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
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
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
