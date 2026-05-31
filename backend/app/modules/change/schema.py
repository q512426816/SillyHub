"""Pydantic DTOs for the change module."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    workspace_ids: list[uuid.UUID] = []
    change_key: str
    title: str | None
    status: str
    location: str
    path: str
    affected_components: list[str]
    change_type: str | None
    owner_id: uuid.UUID | None
    current_stage: str | None = None
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
    workspace_ids: list[uuid.UUID] = []


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
    currentStage: str
    stages: dict
    lastActive: str


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


class FeedbackRequest(BaseModel):
    """反馈提交请求。"""
    category: str = Field(..., pattern=r"^[A-D]$", description="反馈类别: A=Bug, B=设计错误, C=信息不足, D=衍生新change")
    text: str = Field(..., min_length=1, max_length=2000, description="反馈内容")
    target_stage: str | None = Field(default=None, description="自定义返工目标（覆盖类别默认值，可选）")


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
