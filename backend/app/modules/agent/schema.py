"""Pydantic schemas for agent endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class AgentRunCreate(BaseModel):
    task_id: uuid.UUID
    lease_id: uuid.UUID
    agent_type: str = Field(default="claude_code", max_length=30)
    profile_version: str | None = None
    idempotency_key: str | None = Field(default=None, max_length=64)
    preferred_backend: str | None = Field(default=None, max_length=20)
    # Explicit agent provider override; when None the dispatch layer falls
    # through to workspace.default_agent (FR-02, change
    # 2026-06-14-agent-runtime-selection).
    provider: str | None = Field(default=None, max_length=64)
    # Per-run model override; when None the dispatch layer falls through to
    # workspace.default_model, then provider/CLI defaults.
    model: str | None = Field(default=None, max_length=128)


class ExecutionContextResponse(BaseModel):
    """daemon 执行所需的完整上下文（GET /agent-runs/{run_id}/execution-context）。

    对应 ``2026-06-14-unified-agent-execution`` task-02 / design §Phase 2。
    ``claude_md`` 由 ``render_bundle_to_claude_md`` 实时渲染（不入 lease.metadata），
    其余字段从活跃 lease.metadata 恢复（task-03 持久化）。
    """

    agent_run_id: str
    claude_md: str = Field(
        ...,
        description="render_bundle_to_claude_md 输出，daemon 写入 {workDir}/.claude/CLAUDE.md",
    )
    prompt: str | None = None
    provider: str | None = None
    model: str | None = None
    resume_session_id: str | None = None
    repo_url: str | None = None
    branch: str | None = None
    allowed_paths: list[str] | None = None
    tool_config: dict | None = None
    session_id: str | None = None
    # ql-20260617-009：workspace 标识（daemon 用 root_path 作真实 cwd，跳过 mirror clone）。
    # quick-chat 无 workspace → 全部 None，daemon 兜底 'default'。
    workspace_name: str | None = None
    workspace_slug: str | None = None
    root_path: str | None = Field(
        default=None,
        description="真实代码目录（host path）；daemon 收到后若本地可访问直接用作 cwd。",
    )
    # task-07 / change 2026-06-18-workspace-client-path（grill X-001）：
    # workspace_id 顶层透传供 daemon task-runner 调 bundle/sync；
    # spec_root 按 path_source 条件赋值——daemon-client 留空（backend 路径对 daemon
    # 不可达，daemon 自决本地 spec_root），server-local scan 维持 lease_meta 来源。
    workspace_id: uuid.UUID | None = Field(
        default=None,
        description=(
            "run 关联的 workspace 标识。daemon-client 时 daemon task-runner 用它调 "
            "GET /api/spec-workspaces/{workspace_id}/bundle 与 POST .../sync。"
            "quick-chat 等无 workspace 关联的 run 返回 None，daemon 兜底不拉 bundle。"
        ),
    )
    spec_root: str | None = Field(
        default=None,
        description=(
            "执行 spec 文档根目录提示。server-local 时透传 lease_meta 的 backend 机器路径"
            "（与 scan bundle 内一致）；daemon-client 时留空（None）——backend 路径对 "
            "daemon 不可达，daemon 自行经 bundle 端点拉到本地。grill X-001 修正。"
        ),
    )
    # task-02（2026-07-07-daemon-skill-execution / D-007）：stage 投递元数据。
    # StageDispatchMeta：{change_id, stage, skill_name, workspace_id, spec_root_ref}。
    # 仅 stage 类型 run 非空（build_stage_bundle 构造）；task/scan run 为 None。
    # daemon 注入 STAGE_META 环境变量 + 构造 skill 调用 prompt。
    stage_meta: dict | None = Field(
        default=None,
        description=(
            "stage 投递元数据（StageDispatchMeta）。仅 stage 类型 run 携带；daemon 注入 "
            "STAGE_META 环境变量并据此构造 skill 调用 prompt。task/scan run 为 None。"
        ),
    )
    stage_dispatch: bool | None = Field(
        default=None,
        description="是否 stage 投递（daemon 用它判定是否构造 skill 调用 prompt）。",
    )


class QuickChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    provider: str = Field(default="claude", max_length=30)
    model: str | None = Field(default=None, max_length=128)
    workspace_id: uuid.UUID | None = None


class AgentRunResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID | None
    lease_id: uuid.UUID | None
    agent_type: str
    provider: str | None = None
    model: str | None = None
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    exit_code: int | None
    output_redacted: str | None
    spec_strategy: str | None = None
    profile_version: str | None = None
    diff_summary: str | None = None
    change_id: uuid.UUID | None = None
    idempotency_key: str | None = None
    resume_token: str | None = None
    version: int | None = None
    context_fingerprint: str | None = None
    checkpoint_version: int | None = None
    workspace_ids: list[uuid.UUID] = []  # all associated workspaces
    total_cost_usd: float | None = None
    duration_ms: int | None = None
    duration_api_ms: int | None = None
    num_turns: int | None = None
    session_id: str | None = None
    agent_session_id: uuid.UUID | None = (
        None  # AgentSession 表 id（区别于 session_id=daemon 内部 id）
    )
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_creation_tokens: int | None = None
    # Post-scan validation fields
    post_scan_status: str | None = None
    source_commit: str | None = None
    is_resume: bool | None = None
    resumed_from_step: int | None = None
    model_config = {"from_attributes": True}


class AgentRunLogEntry(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    timestamp: datetime
    channel: str
    content_redacted: str | None
    # 2026-06-28-daemon-subagent-transcript task-07 / D-004@v1：子代理归属字段，
    # 经 model_validate 自动透传（main.py / agent router / daemon router 调用点不改）。
    parent_tool_use_id: str | None = None
    subagent_type: str | None = None
    depth: int | None = None
    # 2026-07-05-agent-log-type-tags task-01 / D-003@v1 方案 B：结构化工具类型，
    # 经 model_validate 自动透传（落库侧 task-04/05 注入，调用点不改）。
    tool_kind: str | None = None
    model_config = {"from_attributes": True}


class AgentKillResponse(BaseModel):
    id: uuid.UUID
    status: str
    model_config = {"from_attributes": True}


class WorkspaceSpecSummaryDTO(BaseModel):
    """Pydantic DTO for WorkspaceSpecSummary in API responses."""

    workspace_id: uuid.UUID
    name: str
    slug: str
    component_key: str | None = None
    relation_type: str
    direction: str
    spec_root: str | None = None
    doc_summaries: dict[str, str] = Field(default_factory=dict)


class AgentRunInputRequest(BaseModel):
    """Request DTO for submitting user guidance to an AgentRun."""

    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def _content_not_blank(cls, value: str) -> str:
        content = value.strip()
        if not content:
            raise ValueError("content must not be blank")
        return content


class AgentRunInputResponse(BaseModel):
    """Response DTO for user input submission."""

    run_id: uuid.UUID
    accepted: bool


# ── task-09 / FR-08b / D-008 / R-GLM：tool failure rate monitoring DTO ────────


class ToolFailureStats(BaseModel):
    """Aggregated tool failure statistics for a session (task-09 §4.4).

    Counts persisted AgentRunLog entries that represent tool_result events.
    The persisted schema is flat (channel + content_redacted); is_error is
    inferred from content error markers (daemon does not persist a structured
    is_error field — see service.aggregate_tool_failure).
    """

    tool_total: int = Field(
        default=0,
        description="Number of tool_result log entries in the session.",
    )
    tool_failed: int = Field(
        default=0,
        ge=0,
        description="Subset of tool_total whose content indicates a tool failure.",
    )
    failure_rate: float = Field(
        default=0.0,
        description="tool_failed / tool_total (0.0 when tool_total == 0).",
    )
