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
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class StageEnum(enum.StrEnum):
    """变更流程阶段枚举：5 主阶段 + quick 辅助阶段。

    quick（2026-08-12-quick-independent-stage）是 SillySpec 的独立辅助阶段
    （``VALID_STAGES`` 含 quick，``auxiliary: true``），与主线 5 阶段平行，自己
    跑三步就结束，**不走** brainstorm→plan→execute→verify→archive 主线，
    故不进 :data:`TRANSITIONS`，也不进 :meth:`spec_stages`（主线上下游判定）。
    """

    # ── 变更流程主阶段（scan 不在变更流程，由 workspace 初始化承载） ──
    BRAINSTORM = "brainstorm"
    PLAN = "plan"
    EXECUTE = "execute"
    VERIFY = "verify"
    ARCHIVE = "archive"
    # ── 辅助阶段（独立流程，不进主线上下游判定） ──
    QUICK = "quick"

    @classmethod
    def spec_stages(cls) -> list[StageEnum]:
        """SillySpec 主线 5 阶段（不含辅助 quick）。

        用于 :data:`dispatch.STAGE_ORDER` 断言与上下游 cascade / 一致性判定——
        quick 是独立流程，不参与主线判定，故排除。
        """
        return [
            cls.BRAINSTORM,
            cls.PLAN,
            cls.EXECUTE,
            cls.VERIFY,
            cls.ARCHIVE,
        ]

    @classmethod
    def spec_auxiliary_stages(cls) -> list[StageEnum]:
        """SillySpec 辅助阶段（quick 等，独立流程，不进主线上下游判定）。

        与 :meth:`spec_stages` 互补：主线靠 ``spec_stages``，辅助阶段（无后继
        转换、跑完即终态）靠本方法，二者并集 = 本平台支持的 SillySpec 全量阶段。
        """
        return [cls.QUICK]


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
        # 2026-08-30 生产事故对齐：202605300900 建 PG 表时定义了本约束而模型漏声明
        # （模型↔迁移漂移，SQLite create_all 测试全绿掩盖）——软删 location='deleted'
        # 线上 CheckViolation。值集三值与迁移 20260829230000 对齐，防再漂移。
        CheckConstraint(
            "location IN ('active', 'archive', 'deleted')",
            name="ck_changes_location",
        ),
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


class ChangeSessionLink(BaseModel, table=True):
    """变更-会话绑定（change 2026-08-14-change-center-conversation-driven / D-007）。

    reparse 发现新变更（created）时自动绑定该 workspace 最近活跃会话
    （design §8 绑定查询，跨成员、不限 status）。多对多：一会话可承载多变更、
    一变更可绑定多会话，``unique(change_id, session_id)`` 防同对重复行。
    审批/详情页取该 change 最新一条 link 的 session（design §8）。
    """

    __tablename__ = "change_session_links"
    __table_args__ = (
        Index(
            "ux_change_session_link_pair",
            "change_id",
            "session_id",
            unique=True,
        ),
        Index("ix_change_session_link_change", "change_id"),
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
    session_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class QuicklogSessionLink(BaseModel, table=True):
    """快速修复-会话绑定（change 2026-08-25-session-spec-binding / D-001@v1）。

    会话内执行 ``sillyspec run quick``（agent-logs 上报 quick_id）或从快速修复
    门户/悬浮球发起会话时写 link 行（design §5 W2/W4 写入口）。多对多：一条
    快速修复可关联多会话、一会话可关联多条目，幂等 upsert 由
    ``unique(workspace_id, ql_id, session_id)`` 兜底（design §8）。

    - ``ql_id`` 为自然键（``ql-YYYYMMDD-NNN-后缀``），**无 FK 到 quicklog_entries**
      （D-001@v1）：quicklog 条目双源合并（DB 推送行 + QUICKLOG.md 文件解析行），
      文件源条目没有 DB 行；且 agent-logs（带 quick_id）与条目推送到达顺序不
      保证——条目行不存在也允许先绑。
    - ``workspace_id`` FK→workspaces(id) CASCADE、``session_id`` FK→
      agent_sessions(id) CASCADE：会话删除清绑定，workspace 级联经 FK 保证。
    - 索引：``ix_quicklog_session_link_ql(workspace_id, ql_id)`` 供条目→会话
      列表查询；``ix_quicklog_session_link_session(session_id)`` 供会话侧反查。
    """

    __tablename__ = "quicklog_session_links"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "ql_id",
            "session_id",
            name="uq_quicklog_session_link_pair",
        ),
        Index("ix_quicklog_session_link_ql", "workspace_id", "ql_id"),
        Index("ix_quicklog_session_link_session", "session_id"),
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
    ql_id: str = Field(sa_column=Column(String(128), nullable=False))
    session_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("now()")),
    )


class ChangeEventORM(BaseModel, table=True):
    """变更通用事件表（change 2026-08-16-change-owner-from-token / D-002@v1）。

    通用 ``event_type`` + ``detail`` JSON 扩展模型，首个消费方是 owner_change
    责任人变更留痕（design §5 Phase 1 / §7）：``_sync_change_owner`` 在
    owner_id 现值 != token 用户时写一条 ``event_type='owner_change'``、
    ``detail={from_user_id, to_user_id}`` 的行，供详情页时间线合成展示。

    - ``workspace_id`` FK→workspaces(id) CASCADE（隔离，对齐 platform_change_progress
      复合键语义）；``change_id`` FK→changes(id) CASCADE。
    - ``created_by`` 语义引用触发者（=token 用户），无外键——仅留痕可读性，
      不因用户删除受阻（design §7 "无外键仅语义引用"）。
    - ``detail`` 落地用 :class:`sqlalchemy.JSON` 非 postgresql.JSONB（SQLite 测试
      兼容，先例 20260810150000 Grill X-009；语义即 §7 JSONB 透传 dict）。
    - 幂等不靠唯一约束（owner_id 现值复查天然拦截，task-02 口径）：无任何
      unique 约束，追加型事件流按 ``created_at`` 时间序消费。
    """

    __tablename__ = "change_events"
    __table_args__ = (
        # 时间线合成查询：按 change 取事件流按 created_at 序（design §5 Phase 2.2）
        Index("ix_change_events_change_created", "change_id", "created_at"),
        Index("ix_change_events_workspace", "workspace_id"),
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
    change_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    event_type: str = Field(sa_column=Column(String(50), nullable=False))
    detail: dict = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False, default=dict),
    )
    # 触发者 = push_progress token 用户（design §7）；无 FK 仅语义引用
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=text("now()")),
    )
