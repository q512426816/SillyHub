"""Pydantic schemas for agent endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    # task-12 / 2026-08-02-agent-profile-layer：用户指定 AgentProfile（软约束兜底，
    # design §8）。None → service.start_run 走 workspace.default_agent_profile_id →
    # 平台默认档案 → 无 profile 原路径（不阻断）。非空时经 _resolve_dispatch_profile
    # 加载并快照到 AgentRun.agent_profile_snapshot + lease.metadata。
    agent_profile_id: uuid.UUID | None = None


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
    # 2026-07-08：stage/scan run 返回 kind='interactive'，让 daemon 走 SessionManager
    # （实时转发），不走 batch task-runner（adapter 对 claude 2.1.193 解析不全）。
    kind: str | None = Field(default=None, description="lease 类型：interactive=走 SessionManager")
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
    # task-06（2026-07-25-llm-provider-management / D-005@v1 / FR-03）：用户默认 LLM
    # 供应商配置（含解密 api_key），claim/create 阶段下发给 daemon 注入 ANTHROPIC_* env。
    # 来源：build_claim_payload 按 lease→user_id 查 is_default 且 agent_kind 对齐的
    # LlmProvider，命中才填（8 字段 contract，见 task-06 provides）；用户未配默认
    # provider → None（absent，D-007 零回归，daemon spawn-env 第0层跳过）。
    # R-02：明文 api_key 仅在 claim/create 阶段下发；submit/complete/end 链路与
    # AuditLog / 日志严禁回传（audit_hooks 只读 ORM 列，明文不入 ORM 故捕获不到）。
    provider_config: dict | None = Field(
        default=None,
        description=(
            "用户默认 LLM 供应商配置。含 agent_kind/base_url/api_key(明文)/auth_field/"
            "model/model_role_mappings/default_fallback_model/extra_env。仅 claim/create "
            "阶段下发；submit/complete 链路与审计日志严禁回传 api_key（R-02）。"
        ),
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
    # ql-20260824-020：Edit 工具结果 structuredPatch JSON 串（真实文件行号 hunks），
    # 经 model_validate 自动透传，调用点不改。
    edit_patch: str | None = None
    # 2026-07-30-daemon-heartbeat-dedup-fix task-14 / FR-02：流式 partial 半截行
    # segment_id（complete 行 NULL）。此前只落库未进 DTO——回放读不到半截标记，
    # 前端按完整行渲染；经 model_validate 自动透传，调用点不改。
    segment_id: str | None = None
    # 2026-09-01-session-group-chat 收口：身份 metadata（DB 列 ``metadata``，
    # SQLAlchemy 保留名属性 ``metadata_``）经 validation_alias 直映（SessionListItem
    # .failure_summary 同款先例）——群桥接投影行 ``{member_id, member_name,
    # source_log_id, projection}`` 供前端刷新回放还原发言者，群链路 user_input 行
    # 另有 source_group_id/sender_user_id 等审计键；存量单聊行 NULL 零影响。
    metadata: dict | None = Field(default=None, validation_alias="metadata_")
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
            raise ValueError("内容不能为空。")
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


# ── task-03 / 2026-08-24-session-team-mission-context / FR-02 / design §7：─────
# mission_status 查询响应 DTO。数据流：producer=mcp_tools 组装（Workspace+任一
# 成员 binding+daemon 实例+探测 helper）→ consumer=daemon mcp-server 转发 MCP
# 工具响应 → 主控 agent（task-11）。


class WorkerListItem(BaseModel):
    """mission worker run 概要（原居 mcp_tools.py，task-03 上移至此）。

    上移原因：schema.py 顶部 import mcp_tools 会成环（mcp_tools→service，
    service.py 已反向 import schema），反向（mcp_tools→schema）无环。mcp_tools
    改 from-import 并保留模块级重导出，既有
    ``from app.modules.agent.mcp_tools import WorkerListItem`` 消费方零改动；
    字段定义单源在此，禁止复制造成漂移。
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str | None = None
    status: str
    objective: str | None = None
    total_cost_usd: float | None = None


class ScopeWorkspaceStatus(BaseModel):
    """scope 工作区状态条目（design §7 逐字）。

    组装源：``orchestrator.collect_scope_workspace_statuses``（task-01）——
    ``daemon_name`` 取任一成员 binding 的 ``display_alias||hostname``（不限本人，
    UB-2 口径）；``git_mode`` 为 task-02 ``probe_workspace_git_mode`` 实时探测
    三态。
    """

    id: str
    name: str
    type: str | None
    description: str | None
    root_path: str | None = None  # 工作区本地绝对路径（供主控 agent 只读调研定位）
    daemon_online: bool
    daemon_name: str | None  # display_alias||hostname（任一成员 binding）
    git_mode: str  # "git"|"direct"|"unknown"


class MissionStatusResponse(BaseModel):
    """``GET /missions/status`` 响应（design §7，默认值逐字对齐）。

    无活跃 mission 时仅 ``active=false`` + ``hint``（D-005/D-012，不走 404），
    其余字段保持默认值，不泄露 scope/binding 信息。
    """

    active: bool
    hint: str | None = None  # active=false 时引导文案
    mission_id: str | None = None
    status: str | None = None  # 派生状态（derive_status）
    objective: str | None = None
    anchor_workspace: ScopeWorkspaceStatus | None = None
    scope_workspaces: list[ScopeWorkspaceStatus] = []
    workers: list[WorkerListItem] = []  # 复用 _list_workers_core
    budget_usd: float | None = None


# ── 群聊 DTO（2026-09-01-session-group-chat task-01，design §6.1/§3.2/§3.3）──
# 数据流：producer/consumer=daemon 群聊子路由（task-02 建群/成员/消息端点）。
# 本卡只定契约（模型 + DTO），端点挂载后经 pnpm gen:types 同步前端类型。
# agent 成员六要素：机器(runtime_id)/工作区(workspace_id)/引擎类型(provider)/
# 模型(llm_provider_id)/智能体方案(agent_profile_id)/群内昵称(display_name，
# @提及词，群内全局唯一——用户与 agent 共用命名空间，design §3.3）。


class GroupMemberAgentConfig(BaseModel):
    """agent 成员六要素写体（建群 / 加成员 / 改配置共用，design §6.1）。

    ``workspace_id=None`` 表示沿用群工作区（cwd 锚默认与群一致，可后续热切换
    为其它工作区实现"一项目多工作区"分工）；``provider`` 为引擎类型
    （claude/codex 等，派发 AgentSession.provider 同口径）。
    """

    display_name: str = Field(min_length=1, max_length=40, description="群内昵称=@提及词，群内唯一")
    avatar: str | None = Field(
        default=None, max_length=512, description="群内头像 URL（文件中心上传产出）"
    )
    runtime_id: uuid.UUID = Field(description="机器（daemon runtime，pinned 派发）")
    workspace_id: uuid.UUID | None = Field(
        default=None, description="工作区（cwd 锚）；None=沿用群工作区"
    )
    provider: str = Field(min_length=1, max_length=20, description="引擎类型（claude/codex）")
    llm_provider_id: uuid.UUID | None = Field(default=None, description="模型（LLM 供应商）")
    agent_profile_id: uuid.UUID | None = Field(
        default=None, description="智能体方案（AgentProfile）"
    )


class GroupMemberUserCreate(BaseModel):
    """用户成员邀请写体（design §6.1 加用户成员）。"""

    user_id: uuid.UUID
    display_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=40,
        description="群内昵称；None=沿用用户显示名（service 层解析并查重）",
    )
    avatar: str | None = Field(
        default=None, max_length=512, description="群内头像 URL（文件中心上传产出）"
    )


class GroupChatCreate(BaseModel):
    """``POST /api/group-chats`` 建群体（design §6.1）。

    初始成员分两数组：用户成员（邀请）+ agent 成员（六要素）。建群时同步创建
    群时间线会话（AgentSession.session_kind='group'）。

    quick 群 PPM 项目化口径：``project_id`` 必填——群挂 PPM 项目，群工作区由
    项目关联工作区集推导（``workspace_id`` 可选：显式传入时须在项目关联集内，
    未传取首个关联工作区；项目无关联工作区 → 400）。邀请人员范围=项目成员。
    """

    title: str = Field(min_length=1, max_length=120)
    project_id: uuid.UUID = Field(description="PPM 项目（群归属；工作区由项目关联集推导）")
    workspace_id: uuid.UUID | None = Field(
        default=None,
        description="工作区；None=自动取项目首个关联工作区（显式传入须在项目关联集内）",
    )
    agent_cross_mention: bool = Field(default=True, description="agent 互@协作开关（默认开）")
    cross_mention_depth: int = Field(
        default=4, ge=1, le=8, description="协作链深度上限（防环护栏）"
    )
    context_window: int = Field(default=20, ge=1, le=100, description="群背景摘要条数")
    user_members: list[GroupMemberUserCreate] = Field(default_factory=list)
    agent_members: list[GroupMemberAgentConfig] = Field(default_factory=list)


class GroupChatUpdate(BaseModel):
    """``PATCH /api/group-chats/{id}`` 改群体（design §6.1：群名/开关/护栏参数）。

    None=不改（逐字段局部更新）。
    """

    title: str | None = Field(default=None, min_length=1, max_length=120)
    agent_cross_mention: bool | None = None
    cross_mention_depth: int | None = Field(default=None, ge=1, le=8)
    context_window: int | None = Field(default=None, ge=1, le=100)


class GroupMemberCreate(BaseModel):
    """``POST /api/group-chats/{id}/members`` 加成员体（二选一，design §6.1）。"""

    user: GroupMemberUserCreate | None = None
    agent: GroupMemberAgentConfig | None = None


class GroupMemberUpdate(BaseModel):
    """``PATCH /api/group-chats/{id}/members/{mid}`` 改成员体（design §6.1）。

    agent 成员六要素热切换（provider/llm_provider/agent_profile 下轮生效；
    runtime/workspace 切换重建影子会话重置记忆，design §4.5）与用户/agent 成员
    改昵称共用。None=不改。
    """

    display_name: str | None = Field(default=None, min_length=1, max_length=40)
    avatar: str | None = Field(default=None, max_length=512, description="群内头像 URL；None=不改")
    runtime_id: uuid.UUID | None = None
    workspace_id: uuid.UUID | None = None
    provider: str | None = Field(default=None, min_length=1, max_length=20)
    llm_provider_id: uuid.UUID | None = None
    agent_profile_id: uuid.UUID | None = None


class GroupMemberRead(BaseModel):
    """成员读体（群详情/成员面板，design §6.1）。

    agent 成员六要素全量返回（用户成员对应列为 None）；``shadow_status``
    供面板绿点（none/pending/active/failed）；``avatar`` 为群内头像 URL
    （用户与 agent 成员共用，None=未自定义）。
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    member_type: str
    display_name: str
    avatar: str | None = None
    user_id: uuid.UUID | None = None
    runtime_id: uuid.UUID | None = None
    workspace_id: uuid.UUID | None = None
    provider: str | None = None
    llm_provider_id: uuid.UUID | None = None
    agent_profile_id: uuid.UUID | None = None
    config_snapshot: dict | None = None
    invited_by: uuid.UUID | None = None
    joined_at: datetime
    removed_at: datetime | None = None
    shadow_session_id: uuid.UUID | None = None
    shadow_status: str


class GroupChatRead(BaseModel):
    """群读体（``GET /api/group-chats`` / ``{id}``，design §6.1）。

    ``members`` 由 service 层组装（AgentGroupMember 行序列化；群列表可裁剪为
    成员摘要 chips，task-02 决定裁剪口径）。
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None = None
    title: str
    created_by: uuid.UUID | None = None
    agent_cross_mention: bool
    cross_mention_depth: int
    context_window: int
    created_at: datetime
    ended_at: datetime | None = None
    deleted_at: datetime | None = None
    members: list[GroupMemberRead] = Field(default_factory=list)
