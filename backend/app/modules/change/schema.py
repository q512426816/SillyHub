"""Pydantic DTOs for the change module."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PendingReview(enum.StrEnum):
    """当前变更等待用户审核的面板类型（只读投影）。"""

    PROPOSAL_REVIEW = "proposal_review"
    PLAN_REVIEW = "plan_review"
    HUMAN_TEST = "human_test"
    ARCHIVE_CONFIRM = "archive_confirm"


class ChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    change_key: str
    title: str | None
    status: str
    location: str
    path: str
    affected_components: list[str]
    change_type: str | None
    owner_id: uuid.UUID | None
    current_stage: str | None = None
    pending_review: PendingReview | None = None
    stages: dict | None = None
    approval_status: str | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None
    rejection_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class ChangeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    change_key: str
    title: str | None
    status: str
    location: str
    change_type: str | None
    affected_components: list[str]
    owner_id: uuid.UUID | None
    current_stage: str | None = None
    updated_at: datetime


class ChangeList(BaseModel):
    items: list[ChangeSummary]
    total: int


class ChangeDocMatrixEntry(BaseModel):
    doc_type: str
    exists: bool
    path: str | None
    status: str | None
    last_modified_at: datetime | None


class ChangeDocMatrix(BaseModel):
    change_id: uuid.UUID
    documents: list[ChangeDocMatrixEntry]
    prototypes: list[str]
    references: list[str]


class ChangeDocContent(BaseModel):
    doc_type: str
    path: str
    content: str | None
    exists: bool


# ── File tree DTOs（2026-07-02-change-detail-file-tree-editor）──────────


class ChangeFileEntry(BaseModel):
    """变更目录下的单个文件（list_files 返回项）。"""

    path: str  # 相对变更目录 posix，如 "tasks/task-01.md"
    name: str
    size: int
    last_modified_at: datetime | None = None
    is_text: bool


class ChangeFileList(BaseModel):
    change_id: uuid.UUID
    items: list[ChangeFileEntry]


class ChangeFileContent(BaseModel):
    path: str
    content: str | None
    exists: bool


class ChangeFileWriteRequest(BaseModel):
    path: str
    content: str


class ChangeFileWriteResponse(BaseModel):
    status: str  # "done" | "pending"
    task_id: uuid.UUID | None = None


class PendingFileEntry(BaseModel):
    path: str
    status: str  # pending | claimed
    created_at: datetime


class PendingFileList(BaseModel):
    items: list[PendingFileEntry]


class ChangeWarning(BaseModel):
    code: str
    detail: str
    change_key: str | None
    doc_type: str | None


class ChangeReparseStats(BaseModel):
    parsed: int = 0
    created: int = 0
    updated: int = 0
    deleted: int = 0


class ChangeReparseResponse(BaseModel):
    workspace_id: uuid.UUID
    stats: ChangeReparseStats
    warnings: list[ChangeWarning] = Field(default_factory=list)


# ── Progress ────────────────────────────────────────────────────────────


class ProgressUpdate(BaseModel):
    currentStage: str  # noqa: N815
    stages: dict
    lastActive: str  # noqa: N815


class OkResponse(BaseModel):
    ok: bool = True


# ── Approval ────────────────────────────────────────────────────────────


class ApprovalRead(BaseModel):
    status: str
    reason: str | None = None


class ApproveRequest(BaseModel):
    approved_by: str


class RejectRequest(BaseModel):
    reason: str


# ── Documents sync ─────────────────────────────────────────────────────


class DocumentsSyncRequest(BaseModel):
    """Key is filename, value is file content."""

    model_config = ConfigDict(extra="allow")

    def iter_documents(self) -> list[tuple[str, str]]:
        """Return list of (filename, content) pairs."""
        return [(k, v) for k, v in self.model_extra.items()] if self.model_extra else []


class DocumentsSyncResponse(BaseModel):
    synced: int


# ── Workflow (task-03) ──────────────────────────────────────────────────


class TransitionRequest(BaseModel):
    """状态流转请求。"""

    target_stage: str = Field(..., description="目标阶段，对应 StageEnum 值")
    reason: str | None = Field(default=None, description="流转原因（可选）")
    # Optional explicit agent provider override for the dispatched stage run;
    # when None the dispatch layer falls through to workspace.default_agent
    # (FR-02, change 2026-06-14-agent-runtime-selection).
    provider: str | None = Field(
        default=None, max_length=64, description="指定 agent provider（可选）"
    )
    model: str | None = Field(
        default=None, max_length=128, description="Optional agent model override"
    )


class FeedbackRequest(BaseModel):
    """反馈提交请求。"""

    category: str = Field(
        ...,
        pattern=r"^[A-D]$",
        description="反馈类别: A=Bug, B=设计错误, C=信息不足, D=衍生新change",
    )
    text: str = Field(..., min_length=1, max_length=2000, description="反馈内容")
    target_stage: str | None = Field(
        default=None, description="自定义返工目标（覆盖类别默认值，可选）"
    )


class ArchiveCheckItem(BaseModel):
    """归档门禁单项检查结果。"""

    name: str = Field(..., description="检查项名称")
    passed: bool
    detail: str = Field(default="", description="未通过时的说明信息")


class ArchiveGateResponse(BaseModel):
    """归档门禁检查结果。"""

    can_archive: bool
    checks: list[ArchiveCheckItem] = Field(default_factory=list)


# ── Agent Dispatch (task-04) ─────────────────────────────────────────────


class DispatchResponse(BaseModel):
    """Agent dispatch status for a change."""

    change_id: uuid.UUID
    current_stage: str
    has_active_run: bool = False
    config_enabled: bool = False
    last_dispatch: dict | None = None
    dispatch_result: dict | None = None


# ── Transition Response (task-13) ──────────────────────────────────────────


class TransitionDispatchResponse(BaseModel):
    """Transition 专用的 agent dispatch 结果。

    与 DispatchResponse（agent-status/manual-dispatch 端点使用）不同，
    此 schema 仅描述 transition 触发 dispatch 的结果。
    """

    dispatched: bool = Field(
        ...,
        description="是否成功 dispatch 了 AgentRun",
    )
    agent_run_id: str | None = Field(
        default=None,
        description="AgentRun ID（dispatched=True 时有值）",
    )
    stage: str | None = Field(
        default=None,
        description="目标 SillySpec 阶段",
    )
    reason: str | None = Field(
        default=None,
        description="未 dispatch 的原因（dispatched=False 时有值）",
    )


class TransitionResponse(BaseModel):
    """POST /changes/{id}/transition 的返回类型。

    包含变更状态和 agent dispatch 信息。
    """

    change: dict[str, Any] = Field(
        ...,
        description="变更数据（ChangeRead 的 dict 表示）",
    )
    agent_dispatch: TransitionDispatchResponse | None = Field(
        default=None,
        description="Agent dispatch 结果（无 dispatch 时为 null）",
    )


# ── Review Gate DTOs ───────────────────────────────────────────────────


class ProposalReviewRequest(BaseModel):
    decision: str = Field(..., pattern=r"^(approve|revise|unclear)$")
    comment: str | None = None


class PlanReviewRequest(BaseModel):
    decision: str = Field(..., pattern=r"^(approve|replan|back_to_propose|back_to_brainstorm)$")
    comment: str | None = None


class HumanTestRequest(BaseModel):
    result: str = Field(..., pattern=r"^(pass|bug|doc_mismatch)$")
    comment: str | None = None


class ReviewResponse(BaseModel):
    change: dict[str, Any]
    agent_dispatch: TransitionDispatchResponse | None = None


class ArchiveConfirmRequest(BaseModel):
    """归档确认请求。"""

    comment: str | None = Field(default=None, description="归档备注（可选）")
