"""Pydantic DTOs for the change module."""

from __future__ import annotations

import enum
import re
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


# ── Step progress DTOs（2026-08-15-change-step-visibility task-02，design §7）──


class StepProgressSummary(BaseModel):
    """step 级进度摘要（计算投影，非 changes 表列，零 migration）。

    数据源=platform_change_progress.latest_progress 的 steps[]（CLI 六表
    上行已落库，D-002@v1 零上报改动）；由 service._extract_step_progress
    跨全部 stage 提取，enrich_summaries / enrich_with_workspace_ids 填充。
    steps 缺失 / 空数组 / 结构异常时不赋值（None），前端降级现有
    current_stage 展示（D-003@v1）。列表接口只带本摘要（~200B/行）。
    """

    step_total: int  # 全 stage 步骤总数
    steps_completed: int  # 已完成数
    current_step_name: str | None  # 第一个非 completed 步名（全完成→None）
    current_step_status: str | None  # "active" | "waiting" | None(全完成)
    current_step_desc: str | None  # 当前步 output 截断（无→None）


class StepTimelineEntry(BaseModel):
    """step 级时间线明细项（计算投影，非表列）。

    数据源同 StepProgressSummary（latest_progress steps[]，service
    _extract_step_progress 填充，enrich_with_workspace_ids 挂到
    ChangeRead.steps）。明细随 ChangeRead 形状出现在所有返回 ChangeRead
    的端点（详情 + transition/review 复用，additive 无害）。
    """

    name: str
    stage: str
    status: str  # CLI 原值透传（7 值枚举：completed/pending/in-progress/failed/blocked/waiting/stale，前端白名单色映射）
    output: str | None  # 截断 200 字
    completed_at: str | None  # 归一化 ISO 8601 UTC（解析失败保留原串）
    ordering: int
    wait_reason: str | None


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
    # 2026-08-15-change-step-visibility task-02（design §7）：step 级进度
    # 计算投影（DTO 层），非 changes 表列（零 migration）；由 service
    # enrich_with_workspace_ids 从 PG latest_progress steps[] 提取填充
    # （steps 缺失→None，前端降级现有展示，D-003@v1）。optional default
    # None（brownfield 安全，旧客户端不读不受影响）。
    step_progress: StepProgressSummary | None = None
    steps: list[StepTimelineEntry] | None = None


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
    # D-008（2026-08-13-change-center-rework task-01）：列表项携带 pending_review。
    # 计算字段（DTO 层），非 changes 表列（零 migration）；由 service.enrich_summaries
    # 从 PG latest_progress 镜像解析 (current_stage, completed_stages) 经
    # StageProjectionService._map 纯函数映射得出，与 current_stage 同源。optional
    # default None（brownfield 安全，旧前端不读此字段不受影响）。
    pending_review: PendingReview | None = None
    # 2026-08-15-change-step-visibility task-02（design §7）：列表项携带 step 级
    # 进度摘要。计算字段（DTO 层），非 changes 表列（零 migration）；由
    # service.enrich_summaries 从 latest_progress steps[] 提取填充（steps 缺失→
    # None，前端降级现有展示，D-003@v1）。只带摘要（~200B/行），不带 steps 明细
    # （明细随 ChangeRead.steps）。optional default None（brownfield 安全）。
    step_progress: StepProgressSummary | None = None
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


class StageProfileUpdate(BaseModel):
    """task-03（2026-08-13-profile-system-prompt-injection）：存每阶段独立 profile_id。

    profile_id=None 表示清除（跟随工作区默认）。存 change.stages[<current_stage>]["profile_id"]。
    """

    profile_id: str | None = None


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

#: 单段文件名白名单（task-07）：字母数字点下划线连字符；禁路径分隔符（/ \）。
_FILENAME_PATTERN: re.Pattern[str] = re.compile(r"^[A-Za-z0-9._\-]+$")


class DocumentsSyncRequest(BaseModel):
    """Key is filename, value is file content.

    security-audit-remediation task-07：``iter_documents`` 前逐键校验单段文件名
    白名单（字母数字点下划线连字符，禁路径分隔符与全点段）。CLI 契约只推四件套
    单段名（platform_sync 侧 DOCUMENT_FILES 已收敛），本层兜底 + service 层
    relative_to 守卫双层防御。非法键 → 422，错误信息只含键名不回显内容。
    """

    model_config = ConfigDict(extra="allow")

    def iter_documents(self) -> list[tuple[str, str]]:
        """Return list of (filename, content) pairs（先校验文件名白名单）."""
        from app.core.errors import AppError

        invalid = [
            k
            for k in (self.model_extra or {})
            if not _FILENAME_PATTERN.match(k) or k.strip(".") == ""
        ]
        if invalid:
            raise AppError(
                "documents 含非法文件名（仅允许单段文件名）。",
                code="invalid_document_filename",
                http_status=422,
                details={"invalid_filenames": sorted(invalid)},
            )
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
    # 2026-08-12-dispatch-bind-agent-profile task-01：显式指定本次派发用的 AgentProfile。
    # None（默认）= 跟随工作区默认（不选档案），走 _resolve_dispatch_profile 兜底链的
    # workspace.default_agent_profile_id 分支；非 None = 本次 dispatch 用该档案的
    # provider/model/凭证/allowed_roots（system_prompt/skill/mcp 链路下个变更修）。
    # 作用域=单次 dispatch 入参，不持久化到 change（D-001@v1）。
    agent_profile_id: uuid.UUID | None = Field(
        default=None, description="指定本次派发用的 AgentProfile（可选，None=跟随默认）"
    )
    # execute/verify 阶段是否用团队执行（D-004@v2，默认 single 零回归）
    team_mode: bool = Field(
        default=False,
        description="execute/verify 阶段是否用团队执行（D-004@v2，默认 single 零回归）",
    )
    # task-09（D-002@v2）：team_mode=True 时携带的用户预设 worker 列表。
    # 每条 {profile_id, objective, role}（2026-08-12-dispatch-bind-agent-profile：每 worker
    # 选档案，替换原 {agent_type, model, ...} 手动字段，向后兼容旧形态）。透传到
    # change.stages.team_worker_preset 供 _dispatch_execute_team →
    # OrchestratorService.team_mission_entry / dispatch_worker 读取。
    worker_preset: list[dict] | None = Field(
        default=None, description="team_mode 用户预设 worker 列表（D-002@v2，可选）"
    )
    # task-09（D-003@v2）：team_mode=True 时主 agent 配置 {agent_type, provider, model}。
    # 透传到 change.stages.team_main_agent_config。nullable 零回归。
    main_agent_config: dict | None = Field(
        default=None, description="team_mode 主 agent 配置（D-003@v2，可选）"
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
    # task-09（D-004@v2）：team_mode dispatch 时返回 mission_id + mode="team"，
    # 前端用 mission_id 驱动 TeamProgress 组件展示团队进度。single 路径两字段均 None。
    mission_id: str | None = Field(
        default=None,
        description="team_mode dispatch 的 Mission ID（仅 mode=team 时有值）",
    )
    mode: str | None = Field(
        default=None,
        description="dispatch 模式（team / None=single）",
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


class VerifyGateResponse(BaseModel):
    """POST /changes/{id}/run-verify-gate 的返回类型（task-11，design §6.3）。

    gate 软调用结果，与 task-09 ``run_verify_gate`` MCP tool 对齐（design §6.2）。
    不硬阻塞、不改 change 状态（结果交调用方决策）：

    - ``source="gate_result"``：读最近 completed AgentRun.gate_result
      （dispatch.py:_read_latest_gate_result）。
    - ``source="gate_cmd"``：gate_result 缺时经 dispatch.py:_run_gate_via_delegate
      软调 ``sillyspec gate verify``（复用 task-06 RPC 骨架，不自动阻塞推进）。
    - ``source="unavailable"``：两者均不可用，``exit_code=None`` 交调用方决策。
    """

    exit_code: int | None = Field(
        default=None,
        description="gate exit code（0=通过 / 1=打回 / 2=异常；unavailable 时为 None）",
    )
    errors: list[str] = Field(
        default_factory=list,
        description="gate errors 列表（已 str 强转）",
    )
    source: str = Field(
        ...,
        description="结果来源：gate_result / gate_cmd / unavailable",
    )


# ── Review Gate DTOs ───────────────────────────────────────────────────


class ProposalReviewRequest(BaseModel):
    decision: str = Field(..., pattern=r"^(approve|revise|unclear)$")
    comment: str | None = None
    # D-006@v2（2026-08-14-change-center-conversation-driven task-04）：审批后是否
    # 以服务身份向绑定会话注入审批消息。默认 true（design §7 契约）；false 跳过注入。
    notify_session: bool = True


class PlanReviewRequest(BaseModel):
    decision: str = Field(..., pattern=r"^(approve|replan|back_to_propose|back_to_brainstorm)$")
    comment: str | None = None
    notify_session: bool = True


class HumanTestRequest(BaseModel):
    result: str = Field(..., pattern=r"^(pass|bug|doc_mismatch)$")
    comment: str | None = None
    notify_session: bool = True


class ReviewResponse(BaseModel):
    change: dict[str, Any]
    agent_dispatch: TransitionDispatchResponse | None = None
    # D-006@v2（task-04）：注入结果随审批响应返回。notified_session=false 时
    # notify_error 语义化（turn_conflict / session_inactive / inject_failed）。
    # 注入 best-effort（R-03）：失败不回滚审批，仅降级提示。
    notified_session: bool = False
    notify_error: str | None = None


class ArchiveConfirmRequest(BaseModel):
    """归档确认请求。"""

    comment: str | None = Field(default=None, description="归档备注（可选）")
    notify_session: bool = True
