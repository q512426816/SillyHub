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
    current_step_desc: (
        str | None
    )  # 当前步 output 截断 200（列表摘要专用；明细全量，Phase 2.4 两层分离）


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
    output: str | None  # 全量透传（Phase 2.4 / D-004@v1：截断仅列表摘要 current_step_desc）
    completed_at: str | None  # 归一化 ISO 8601 UTC（解析失败保留原串）
    ordering: int
    wait_reason: str | None
    # 2026-08-16-change-owner-from-token task-03（design §7）：条目类型区分
    # （计算投影语义）。kind 默认 "step"——旧数据/旧组件不读新字段渲染不变
    # （§9 兼容策略）；"event" 由 task-04 时间线合成 owner_change 事件条目时
    # 置位。event_type 首类值 'owner_change'，后续事件类型零 schema 变更接入
    # （D-002@v1 扩展点）。全 optional 零 breaking。
    kind: str = "step"  # "step" | "event"
    event_type: str | None = None


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
    # 2026-08-16-change-owner-from-token task-03（design §7）：owner_id 的用户
    # 可读投影（计算字段，DTO 层），非 changes 表列（零 migration）；由 service
    # enrich 批量 join users 填充（display_name 优先 username fallback，R-06
    # 与事件 A/B 名字共用一次 IN 查询）。填充逻辑是 task-04 领地，本处仅落契约。
    # optional default None（brownfield 安全，旧客户端不读不受影响，§9）。
    owner_name: str | None = None


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
    # 2026-08-16-change-owner-from-token task-03（design §7）：owner_id 的用户
    # 可读投影（计算字段，DTO 层），非 changes 表列（零 migration）；由 service
    # enrich_summaries 批量 join users 填充（display_name 优先 username
    # fallback，R-06 与事件 A/B 名字共用一次 IN 查询）。填充逻辑是 task-04
    # 领地，本处仅落契约。optional default None（brownfield 安全，§9）。
    owner_name: str | None = None
    # 2026-08-29-change-delete-closure-and-spec-pull task-11（design §8.1 Layer 1）：
    # 「最后信号」投影（纯 CLI 模式进行中可见性，前端活动徽标数据源）。计算字段
    # （DTO 层），非 changes 表列（零 migration）；数据源 =
    # platform_change_progress.last_pushed_at 既有列（platform_sync/model.py:90-95，
    # String ISO 原文），由 service.enrich_summaries 在既有复合 IN join 的 SELECT
    # 列表顺带取值（零新增查询，R-03）。join 不命中（无 progress 行）保持 None
    # （D-003 fallback，与 current_stage 同款）。服务端零解析：ISO 原文透传，
    # 畸形串防御解析归前端（task-12）。optional default None（brownfield 安全，
    # 旧客户端不读不受影响）。
    last_pushed_at: str | None = None
    # 2026-08-30-change-center-usage-stats task-01（design 接口定义）：变更执行
    # 用量摘要（列表「执行」列：耗时 + token 总量 + 调用次数）。计算字段
    # （DTO 层），非 changes 表列（零 migration，D-003@v1 实时聚合）；producer
    # = change/usage_service.py ChangeUsageQueryService（summarize_changes 批量
    # 聚合，经 service.enrich_summaries 管道填充，R-03 禁 N+1），consumer = 前端
    # api-types.ts 生成物（gen:types）。无关联执行保持 None（D-001@v1，不回退
    # created_at 生命周期口径）。填充逻辑是 task-02/03 领地，本处仅落契约。
    # optional default None（brownfield 安全，旧客户端不读不受影响）。
    usage: UsageSummaryRead | None = None
    updated_at: datetime


class ChangeList(BaseModel):
    items: list[ChangeSummary]
    total: int


class ChangeDeleteResponse(BaseModel):
    """DELETE /changes/{cid} 响应（task-06 / design §11，FR-05a）。

    - ``ok``：恒 True（失败路径走 403/404/409 错误体，不进本 DTO）；
    - ``backup_dir``：镜像软删落地的备份目录绝对路径（30 天保留，人工恢复兜底）；
    - ``file_count``：实际移入备份区的文件数（零文件幂等删除为 0）。
    """

    ok: bool
    backup_dir: str
    file_count: int


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


# ── Usage stats DTOs（2026-08-30-change-center-usage-stats task-01，design 接口定义）──


class UsageByModelItemRead(BaseModel):
    """分模型用量明细项（ChangeUsageRead.by_model 列表行）。

    明细段 = agent_run_model_usage 按 model GROUP BY（SUM 四维 token +
    api_requests）；兜底段 = 集合中无明细行的 run 归并到 run.model（缺失归
    「未记录」桶）。数据流：producer = change/usage_service.py
    ChangeUsageQueryService（详情两段聚合）→ router usage 端点 → consumer =
    前端 api-types.ts 生成物（gen:types，change-usage-card 折叠明细）。
    """

    model: str  # 模型名；兜底桶 = run.model 或 "未记录"（排序恒末位）
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    # 兜底桶（无 agent_run_model_usage 明细的老 run）api_requests 无来源，
    # 恒 0 诚实值（R-04，前端注脚声明，对齐 by_provider「未记录」先例）。
    api_requests: int = 0


class UsageTotalsRead(BaseModel):
    """用量汇总（四维 token + 调用次数 + 轮次；详情与列表摘要共用）。"""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    api_requests: int = 0
    num_turns: int = 0  # 轮次 = SUM(agent_runs.num_turns)（SQL 聚合忽略 NULL）


class ChangeUsageRead(BaseModel):
    """变更/快速修复完整用量（两个 usage 详情端点响应，D-005@v1）。

    时间口径 = 执行时间口径（D-001@v1）：首次执行 started_at → 最近执行
    finished_at，duration_ms = 纯执行时长累加。时间三元组 NULL 语义（R-05，
    前端「进行中」标记依据）：started_at 有值且 finished_at 缺 = 进行中；
    started_at / finished_at / duration_ms 全 None = 无执行。
    """

    started_at: datetime | None = None  # 集合 MIN(started_at)；无执行 → None
    finished_at: datetime | None = None  # 集合 MAX(finished_at)；进行中/无执行 → None
    duration_ms: int | None = None  # SUM(duration_ms)；无任何非 NULL 值 → None
    totals: UsageTotalsRead
    # 分模型明细：input+output 降序；「未记录」兜底桶恒末位。
    by_model: list[UsageByModelItemRead] = []


class UsageSummaryRead(BaseModel):
    """用量摘要（ChangeSummary.usage / QuicklogEntryListItem.usage，列表「执行」列）。

    列表批量投影只带时间三元组 + totals，不算 by_model（R-02 复杂度控制）；
    NULL 组合语义同 ChangeUsageRead（R-05：started 有值 finished 缺 = 进行中；
    全 None = 无执行）。
    """

    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    totals: UsageTotalsRead


class QuicklogFileItem(BaseModel):
    """quicklog 条目文件行（path + 可选括注，design §5.1）。"""

    path: str
    note: str | None = None


class QuicklogEntryListItem(BaseModel):
    """快速修复列表行（FR-04；body/raw 不带——详情走 QuicklogEntryRead）。"""

    ql_id: str
    timestamp: datetime | None = None
    title: str
    status: str  # completed | in_progress | partial_done | stale（派生后 4 态）
    status_note: str | None = None
    placeholder: bool = False
    author_raw: str
    author_name: str | None = None
    # ql-20260818-006：关联变更 owner 解析名（与进行中/已归档列表 owner 同源，
    # owner_id → users display_name 优先）；None 时前端回退 author_name/author_raw。
    owner_name: str | None = None
    linked_changes: list[str] = []
    files: list[QuicklogFileItem] = []
    affected_modules: list[str] = []
    source: str = "file"  # pushed | file
    # 2026-08-30-change-center-usage-stats task-01（design 接口定义）：执行用量
    # 摘要（列表「执行」列，含「进行中」标记）。计算字段（DTO 层），非
    # quicklog_entries 表列（零 migration，D-003@v1 实时聚合）；producer =
    # change/usage_service.py ChangeUsageQueryService（summarize_quicklogs 批量
    # 聚合，经 router quicklog 列表组装填充，R-03 禁 N+1），consumer = 前端
    # api-types.ts 生成物（gen:types）。文件源条目无会话绑定时保持 None。
    # 填充逻辑是 task-02/03 领地，本处仅落契约。optional default None
    # （brownfield 安全，旧客户端不读不受影响）。
    usage: UsageSummaryRead | None = None


class QuicklogEntryList(BaseModel):
    items: list[QuicklogEntryListItem]
    total: int


class QuicklogEntryRead(QuicklogEntryListItem):
    """快速修复详情（FR-06：四段正文 + raw_block 原文切换）。"""

    body_sections: dict[str, str] = {}
    raw_block: str | None = None
    truncated: bool = False
