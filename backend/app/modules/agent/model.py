"""AgentRun and AgentRunLog tables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class AgentRun(BaseModel, table=True):
    """Tracks a single agent execution within a task lease."""

    __tablename__ = "agent_runs"
    __table_args__ = (
        Index("ix_agent_runs_task", "task_id"),
        Index("ix_agent_runs_lease", "lease_id"),
        Index("ix_agent_runs_change_id", "change_id"),
        Index(
            "ix_agent_runs_agent_session_id",
            "agent_session_id",
        ),
        Index(
            "ix_agent_runs_idempotency_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
        Index(
            "ix_agent_runs_resume_token",
            "resume_token",
            postgresql_where=text("resume_token IS NOT NULL"),
        ),
        Index(
            "ix_agent_runs_context_fingerprint",
            "context_fingerprint",
            postgresql_where=text("context_fingerprint IS NOT NULL"),
        ),
        # 性能优化 Wave 1(2026-07-22 系统性能审计):status reconcile/listing 高频过滤
        # + created_at 列表排序(见迁移 202607222330)。
        Index("ix_agent_runs_status", "status"),
        Index("ix_agent_runs_created_at", "created_at"),
        # 多 agent 编排索引(迁移 202607060900 建,此前漏声明致 model↔迁移漂移,
        # autogenerate 会误生成 drop_index;补声明对齐,无 DB 改动)。
        Index("ix_agent_runs_mission_id", "mission_id"),
        Index("ix_agent_runs_parent_run_id", "parent_run_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    task_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    lease_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("worktree_leases.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    agent_type: str = Field(sa_column=Column(String(30), nullable=False))  # claude_code, etc.
    provider: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    model: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    status: str = Field(
        default="pending",
        sa_column=Column(String(20), nullable=False, default="pending"),
    )  # pending, running, completed, failed, killed
    started_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    finished_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    exit_code: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    output_redacted: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    error_code: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )  # e.g. no_online_daemon (task-01)
    error_detail: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )  # 模型层 ModelError 序列化（auth_failed/quota_exceeded/...）；与 error_code 正交（D-009）
    spec_strategy: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )
    profile_version: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    # ── AgentProfile 配置层（2026-08-02-agent-profile-layer, design §3.2） ──
    # 显式绑定的智能体档案；NULL = 走兜底链（workspace.default_agent_profile_id →
    # 平台默认 → workspace.default_agent，design §8）。档案删则 SET NULL，run 历史保留。
    # 与上方 profile_version/spec_strategy 共存（向后兼容，不删，design §3.2）。
    agent_profile_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # dispatch 落地时冻结的 profile 快照（含 version），让 run 历史独立于档案后续编辑。
    agent_profile_snapshot: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # ── 会话配置层（2026-08-14-sessions-portal task-01 / D-008@v1 轮次快照） ──
    # 本轮 dispatch 实际生效的 llm_provider（会话级覆盖，design §5 Wave1）。
    # 与 agent_profile_snapshot 共同构成轮次配置快照；供应商删则 SET NULL，
    # run 历史保留。NULL = 走现状链（bound/全局默认），零回归。
    llm_provider_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("llm_providers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # ── 轮次发送者（ql-20260817-003：守护进程可共享，同一会话可能多用户发言） ──
    # 记录本轮 turn 的发起者（create=会话创建者；inject=实际注入者；service 路径
    # =会话属主）。前端消息时间线据此显示「用户名 · 时间」；用户删则 SET NULL
    # （历史保留）。旧 run 行 NULL=历史无发送者数据，前端不显示发送行（零回归）。
    user_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    diff_summary: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    # ── Execution Coordinator fields ──
    idempotency_key: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    resume_token: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    checkpoint_version: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    version: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, default=1),
    )
    approval_token: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    context_fingerprint: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    checkpoint_data: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    max_retries: int = Field(
        default=3,
        sa_column=Column(Integer, nullable=False, default=3),
    )
    retry_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    tool_policy_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("tool_policies.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    change_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # ── Usage / cost tracking fields ──
    total_cost_usd: float | None = Field(
        default=None,
        sa_column=Column(Float, nullable=True),
    )
    duration_ms: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    duration_api_ms: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    num_turns: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    session_id: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    agent_session_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Points at the interactive AgentSession this run belongs to (D-005@v1,
    # session<->runs 1:N). Distinct from session_id above, which holds the
    # claude resume id (D-001@v1) and is left untouched.
    conversation_events: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    input_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    output_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # ── Cache token tracking (prompt cache read/creation; 2026-06-24-runtime-usage-stats) ──
    # Claude(Anthropic)有 cache_creation_input_tokens / cache_read_input_tokens;
    # codex/OpenAI 系无 cache,对应 NULL(D-001@v1)。nullable 对齐 task-04 迁移。
    cache_read_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    cache_creation_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # ── Post-scan validation fields ──
    post_scan_status: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )  # success, failed_post_check, completed_with_warnings
    # ── Driver Gate (P3 pilot) ── gate 客观核验结果与状态（design §8 / task-04）
    # gate_status 由 task-05 close 写 pending、task-07 cas running→decided/failed、
    # task-10 reconcile 启动时把孤儿 pending/running 重置 pending。gate_result 由
    # task-06 _read_gate_result 产出（{exit_code, errors, raw_envelope}），model 层
    # 只定义容器不约束内部 schema。两列 nullable 默认 None —— 老 agent_run 行兼容
    # （design §9 brownfield），task-08 非 verify stage fallback 当前声明态。
    gate_status: str | None = Field(
        default=None,
        sa_column=Column(String(20), nullable=True),
    )  # pending / running / decided / failed
    gate_result: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )  # { exit_code: int, errors: list[str], raw_envelope: dict }
    source_commit: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    is_resume: bool | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )  # Stored as 0/1 in DB
    resumed_from_step: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # ── Public MCP read_only flag (2026-08-06-public-mcp-server task-01, design §8.3 / D-005@v2) ──
    # 第三方经对外 MCP dispatch 时是否要求 worker 只读。物制走 daemon SDK --allowedTools
    # 单腿（backend 不强制，CC-02），本列只做审计/前端查询载体。nullable 兼容老 run 行
    # （NULL = 非只读，design §9 brownfield 零回归）；风格对齐 gate_status / is_resume
    # 等 nullable 兼容列。Python default=None —— 读侧把 NULL 当 False（design §8.3）。
    read_only: bool | None = Field(
        default=None,
        sa_column=Column(Boolean, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    # ── Multi-agent orchestration (2026-06-19-multi-agent-orchestration, Wave 1) ──
    mission_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_missions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # ── 目标工作区（2026-08-19-cross-workspace-team-mission design §4.1） ──
    # worker run 落哪个工作区派发/收敛；NULL = anchor（零回归存量行为）。
    # target_workspace_id 作为 worktree 建立 / provider 读取 / placement 派发的路由键；
    # 执行路径按此字段 resolve Workspace 并路由到对应 daemon。
    target_workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    parent_run_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    role: str | None = Field(
        default=None,
        sa_column=Column(String(30), nullable=True),
    )  # Role within a Mission: worker (arch | impl | test | integration | ...)
    #   或 orchestrator（主 agent, 2026-07-12-team-main-agent-orchestration D-001@v2）
    # 2026-07-12-team-main-agent-orchestration task-02 / D-005@v2: per-worker 独立
    # worktree 分支名（git worktree add 临时分支）。orchestrator 不写；worker dispatch
    # 时填，converge 合并后保留供审计。nullable 兼容老 run 行。
    worktree_branch: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    objective: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )  # what this Run was delegated to achieve
    attempt: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )


class AgentRunLog(BaseModel, table=True):
    """Individual log lines from an agent run."""

    __tablename__ = "agent_run_logs"
    __table_args__ = (
        Index("ix_agent_run_logs_run", "run_id"),
        # P0 性能优化(2026-06-27):timestamp 时间范围查询 + (run_id,timestamp) 联合
        # 索引优化「按 run 查日志并按时间排序」的高频读。该表无 started_at 字段
        # (属 agent_runs),故仅补这两项。见迁移 202606271300。
        Index("ix_agent_run_logs_timestamp", "timestamp"),
        Index("ix_agent_run_logs_run_timestamp", "run_id", "timestamp"),
        # 2026-06-24-daemon-network-resilience task-20（FR-08 / R-12 / D-001@v2）：
        # 部分唯一索引——仅 dedup_key IS NOT NULL 时约束唯一，让 submit_messages
        # 用 INSERT ON CONFLICT DO NOTHING 幂等去重（重复 (run_id, dedup_key) 仅落一行）。
        # postgresql_where 仅 PG 生效（SQLite 忽略，测试侧靠 service 层去重兜底）。
        Index(
            "ux_agent_run_logs_dedup",
            "run_id",
            "dedup_key",
            unique=True,
            postgresql_where=text("dedup_key IS NOT NULL"),
        ),
        # 2026-06-28-daemon-subagent-transcript task-07 / D-004@v1：子代理归属索引，
        # 支持按 parent_tool_use_id 聚合查询某子代理的所有日志行（方案 B 列式承载
        # 的核心优势，见 design §8）。主 agent 行 parent_tool_use_id=NULL 不受索引影响。
        Index("ix_agent_run_logs_parent", "parent_tool_use_id"),
        # 2026-07-05-agent-log-type-tags task-01 / D-003@v1 方案 B：结构化 tool_kind
        # 列索引，支撑 Phase3 两层筛选（tool_kind / parent_tool_use_id 维度筛日志）。
        # None 表示非工具调用（user_input 等），不受筛选影响。
        Index("ix_agent_run_logs_tool_kind", "tool_kind"),
        # 2026-07-30-daemon-heartbeat-dedup-fix task-14：流式 partial 去重 segment_id
        # 索引。override 信号到达时按 (run_id, segment_id) 跨 submit_messages 调用 DELETE
        # 已 commit 的 partial 行（task-08 expunge 只覆盖单调用内 pending）。仅 partial 行
        # 写值（complete 行 NULL），故 DELETE by segment_id 天然只命中 partial。
        Index("ix_agent_run_logs_segment_id", "segment_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    channel: str = Field(
        sa_column=Column(String(20), nullable=False),
    )  # stdout, stderr, tool_call
    content_redacted: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    # 2026-06-24-daemon-network-resilience task-20（FR-08）：幂等去重键。
    # daemon ResilienceService.submitWithRetry 注入（Claude msg.id 或 runId:seq）。
    # None 表示无去重（旧消息/未注入路径），不受唯一索引约束（部分索引 WHERE IS NOT NULL）。
    dedup_key: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    # 2026-06-28-daemon-subagent-transcript task-07 / D-001@v1 / D-004@v1 / D-008@v1：
    # 子代理归属字段（来自 SDK message 顶层 parent_tool_use_id/subagent_type/depth）。
    # 主 agent 行三列为 NULL（向后兼容，前端按主 agent 渲染，FR-09）。daemon
    # session-manager 维护 depth 透传（D-007@v1），backend _extract_sdk_messages
    # 注入每条 flat record（D-008@v1），submit_messages 落库三列（task-09）。
    parent_tool_use_id: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    subagent_type: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    depth: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # 2026-07-05-agent-log-type-tags task-01 / D-003@v1 方案 B：结构化工具类型列，
    # 由 task-04/05 在落库时从 SDK message 解析注入（如 Read/Edit/Bash/...）。
    # None 表示非工具调用日志（user_input / 纯文本 assistant 输出 / stderr 等），
    # 依赖 default=None 兜底，user_input 构造点无需改动。
    tool_kind: str | None = Field(
        default=None,
        sa_column=Column(String(32), nullable=True),
    )
    # 2026-07-30-daemon-heartbeat-dedup-fix task-14 / FR-02 / D-002@v1：流式 partial
    # 去重 segment_id。daemon partial flush 的半截行带 metadata.segmentId + isPartial，
    # 此处持久化 segment_id；complete 行不写（NULL）。override 信号
    # （[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE]）跨 submit_messages 调用到达时，按
    # segment_id DELETE 已落库 partial（task-08 expunge 只撤单调用内 pending，跨调用
    # 已 commit 的 partial 删不掉——本列解决）。None = 非 partial / 旧消息，不受影响。
    segment_id: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    # ql-20260824-020：Edit 工具结果的结构化 diff（SDK tool_use_result.structuredPatch
    # JSON 串，hunks 含 oldStart/newStart 真实文件行号）。_extract_sdk_messages 从
    # tool_result 消息提取注入 flat record，submit_messages 落库本列；前端进度视图
    # Edit 工具卡展开区优先用它渲染带文件内真实行号的 diff（无值回退 LCS 自算）。
    # None = 非 Edit 结果 / 旧数据 / 无 patch，不受影响。
    edit_patch: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )


class AgentSession(BaseModel, table=True):
    """An interactive agent session (D-001@v1) backed by the SDK driver.

    Spans multiple AgentRun turns (D-005@v1 session<->runs 1:N) and is bound
    to a single long-lived DaemonTaskLease with kind="interactive" (D-002@v3).
    The ``agent_session_id`` column stores the SDK-returned session id used for
    resume; it is intentionally distinct from AgentRun.session_id (claude
    resume id, untouched per D-001@v1).

    2026-08-23-agent-activity-sessions task-03（design §3.3.1 / FR-03）：加
    ``origin`` / ``aggregation_key`` / ``title`` 三列支撑工具上报日志会话化。
    ``origin`` 区分平台对话会话（chat，存量行为）与 CLI 工具上报自动聚合的
    「本地 Agent 会话」（tool_report）；``aggregation_key`` 是 tool_report 会话
    的聚合键文本（D-001），只建普通索引**不做唯一约束**（D-006 容错：
    workspace_id nullable，并发撞键靠 find-then-insert，极小概率重复行按
    last_active_at 取最新、后续上报自然收敛，败者僵尸行不清理）；``title``
    NULL 兼容（Grill P1-1）：chat 会话保持 NULL 走 router 首条 user_input 派生
    标题的既有路径，tool_report 会话由服务端写入自动标题（task-04）。
    """

    __tablename__ = "agent_sessions"
    __table_args__ = (
        Index("ix_agent_sessions_user_id", "user_id"),
        Index("ix_agent_sessions_runtime_id", "runtime_id"),
        Index("ix_agent_sessions_status", "status"),
        Index("ix_agent_sessions_lease_id", "lease_id"),
        Index("ix_agent_sessions_change_id", "change_id"),
        Index("ix_agent_sessions_deleted_at", "deleted_at"),
        Index("ix_agent_sessions_archived_at", "archived_at"),
        # 性能优化 Wave 1(2026-07-22):change/workspace 维度 session listing 兜底查询。
        Index("ix_agent_sessions_workspace", "workspace_id"),
        # 2026-08-23-agent-activity-sessions task-03（design §3.3.1 / D-006）：
        # tool_report 会话 find-or-create 查找键。普通索引非唯一——workspace_id
        # nullable 无法建复合唯一，并发撞键容错见 aggregation_key 列注释。
        Index("ix_agent_sessions_ws_agg", "workspace_id", "aggregation_key"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    lease_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_task_leases.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # 2026-07-09-change-detail-session / D-001@v1: change-bound interactive
    # session. nullable keeps existing runtime-level sessions regression-free;
    # change deletion clears the FK (no cascade delete of session rows).
    change_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Redundant workspace binding for change-scoped session listing & cwd
    # resolution (D-003@v1).
    workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    provider: str = Field(
        sa_column=Column(String(30), nullable=False),
    )
    # ── 会话配置三列（2026-08-14-sessions-portal task-01 / FR-04 / D-008@v1） ──
    # 会话独立持有配置（design §5 Wave1 / §8）：显式绑定的智能体档案与供应商；
    # 均 NULL = 未选配置 = 现状行为（全局默认供应商、无人格，R-01 零回归）。
    # 档案/供应商删则 SET NULL，会话历史保留；config_snapshot 冻结当前生效
    # 配置摘要（profile_name/provider_name/model/engine/machine_name/agent_name），
    # 供列表 chips 直显免二次查询（Grill C-12）。producer=backend session
    # service（task-03/04 写入）；consumer=会话列表/详情（task-05）。
    agent_profile_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    llm_provider_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("llm_providers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    config_snapshot: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    status: str = Field(
        default="pending",
        sa_column=Column(String(20), nullable=False, default="pending"),
    )  # pending, active, reconnecting, ended, failed
    # ── 会话化三列（2026-08-23-agent-activity-sessions task-03 / FR-03 / design §3.3.1）──
    # 会话来源：'chat'（平台对话会话，存量行为；server_default 'chat' 使迁移对存量
    # 行免回填即得 chat 语义）| 'tool_report'（CLI 工具上报聚合出的本地 Agent 会话，
    # task-04 find-or-create 写入）。
    origin: str = Field(
        default="chat",
        sa_column=Column(
            String(16),
            nullable=False,
            server_default=text("'chat'"),
        ),
    )
    # tool_report 会话聚合键 "{harness}|{ctx_key}"（ctx_key = change_key 或
    # quick_id 或空，D-001）。NULL = chat 会话（不参与聚合查找）。
    aggregation_key: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    # 会话标题（Grill P1-1：AgentSession 原无 title 列）。NULL = 无标题：chat 会话
    # 由 router 首条 user_input 派生（既有路径不变）；tool_report 会话由服务端写
    # 自动标题（task-04），列表 router 改 title 优先在 task-05。
    title: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    agent_session_id: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )  # SDK session_id (spike D3); NOT AgentRun.session_id (D-001@v1)
    config: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )  # { manual_approval, model, ... }
    turn_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    cwd: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )  # SessionManager working dir for resume (R-cwd, spike D3)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    last_active_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )  # D-004 idle 30min sweep (sweep logic in task-07)
    ended_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )  # written by service.end_session (task-05)
    # 2026-07-11-unify-runtime-session-dialog / D-003: soft-delete timestamp.
    # NULL = 可见行；非空 = 用户已删除（list/get 过滤隐藏，行保留供审计，
    # agent_runs.agent_session_id 外键刻意不断，run/log 历史仍可查）。
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # 2026-08-24：会话归档时间戳（archived_at）。NULL = 可见；非 NULL = 已归档
    # （默认列表隐藏，筛选「已归档会话」时展示）。与 deleted_at 正交——
    # 可归档后删除，也可直接删除。
    archived_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class AgentMission(BaseModel, table=True):
    """Aggregation root for a multi-agent delegation.

    2026-06-19-multi-agent-orchestration (Wave 1). Status is NOT persisted — it
    is derived from child AgentRuns (see ``agent.mission.derive_status``). Only
    intent metadata is stored; the source of truth remains AgentRun + Lease.
    """

    __tablename__ = "agent_missions"
    __table_args__ = (
        Index("ix_agent_missions_workspace", "workspace_id"),
        Index("ix_agent_missions_change", "change_id"),
        # 2026-08-22-team-session-unify task-01（design §8 / D-006@v1 / Grill NEW-3）：
        # 活跃态部分唯一索引——一个会话同时至多一个未收敛（converged_at IS NULL）未
        # 取消（cancelled_at IS NULL）的 mission（R-07 单活跃约束，懒建并发守卫的
        # 数据库侧兜底）。session_id IS NOT NULL 守卫：external mission（无发起会话，
        # 如 change 执行链/GLM fallback/扫描引导）session_id 为 NULL 不参与唯一约束，
        # 多个 NULL 互不冲突。postgresql_where 供 PG、sqlite_where 供测试侧
        # create_all（SQLite 3.8+ 支持部分索引），双方言同语义。
        Index(
            "uq_agent_missions_session_active",
            "session_id",
            unique=True,
            postgresql_where=text(
                "session_id IS NOT NULL AND converged_at IS NULL AND cancelled_at IS NULL"
            ),
            sqlite_where=text(
                "session_id IS NOT NULL AND converged_at IS NULL AND cancelled_at IS NULL"
            ),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # ── Anchor（主工作区，2026-08-19-cross-workspace-team-mission D-009@v1） ──
    # workspace_id 保持 NOT NULL 不动，语义收窄为 anchor：主 agent 运行的工作区、
    # 鉴权锚；单 ws mission 时即原 workspace_id（Grill B-03）。
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # ── 发起会话（2026-08-22-team-session-unify task-01 / D-006@v1，design §5
    #    Phase1/§8；验收返工改 nullable）── 会话内团队的 mission 绑定发起会话
    #    （FK agent_sessions.id + 索引）；external mission（change 执行链/GLM
    #    fallback/扫描引导等无会话入口）为 NULL——非 NULL 即「绑定会话」，会话
    #    维度判别（finalizer/patrol 的 _mission_bound_session）据此查表确认。
    session_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id"),
            nullable=True,
            index=True,
        ),
    )
    # ── 项目关联（2026-08-19-cross-workspace-team-mission design §4.1） ──
    # 跨工作区 mission 必填（圈选 scope 须 ⊆ 项目关联工作区）；单 ws mission 可空
    # （不强制挂项目）。项目删则 SET NULL，mission 历史保留。
    project_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("ppm_project_maintenance.id", ondelete="SET NULL"),
            nullable=True,
            # BE-P2-2（2026-08-21 审查）：list_project_missions 按 project_id 过滤，
            # 补索引（migration 20260821100000 同步建）。
            index=True,
        ),
    )
    # ── 派发范围快照（2026-08-19-cross-workspace-team-mission D-007@v1） ──
    # 创建时冻结的工作区 id 列表（uuid-hex），worker 可按 target 落地；NULL 或缺省
    # = [workspace_id]（单 ws）。跨 ws mission 必填，scope ⊇ {anchor} 且 ⊆ ppm_project_workspace。
    scope_workspace_ids: list[str] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    change_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("changes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    objective: str = Field(sa_column=Column(Text, nullable=False))
    constraints: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )  # { max_workers, read_only_scope, ... }
    budget_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    budget_usd: float | None = Field(
        default=None,
        sa_column=Column(Float, nullable=True),
    )
    # 2026-07-12-team-main-agent-orchestration task-02 / D-002@v2: 用户预设 worker 列表。
    # 每条 {agent_type: str, model: str, objective: str, role: str}。mode=team 时由 UI
    # 传入，主 agent 按列表派 worker（不自动拆，D-002）。nullable 兼容老 mission（single 零回归）。
    worker_preset: list[dict] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 2026-07-12-team-main-agent-orchestration task-02 / D-003@v2: 主 agent 配置
    # {agent_type: str, provider: str, model: str}。mode=team 时主 agent AgentRun 用此配置
    # 走 daemon lease。nullable 兼容老 mission（single 零回归）。
    main_agent_config: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    created_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    cancelled_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # 2026-07-25 Wave C / R5：mission 收敛守卫列。converge_mission_for_completed_run
    # 在 finalize 前用原子 UPDATE...WHERE converged_at IS NULL 抢占置位，防两个 worker
    # 同时 complete 触发重复 finalize（重复 GLM 合并 / 重复 merge artifact）。
    # nullable 兼容历史 mission（None = 未收敛）。
    converged_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class AgentRunDependency(BaseModel, table=True):
    """DAG edge between AgentRuns in a Mission (worker ordering dependencies)."""

    __tablename__ = "agent_run_dependencies"
    __table_args__ = (
        Index("ix_agent_run_dep_run", "run_id"),
        Index("ix_agent_run_dep_depends", "depends_on_run_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    depends_on_run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class AgentArtifact(BaseModel, table=True):
    """Structured output from a Worker Run (summary / patch / test_result / evidence).

    Raw logs stay in AgentRunLog; only structured artifacts are fed back to the
    Coordinator (proposal §4 — Coordinator never ingests raw logs).
    """

    __tablename__ = "agent_artifacts"
    __table_args__ = (Index("ix_agent_artifacts_run", "run_id"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    kind: str = Field(sa_column=Column(String(30), nullable=False))
    # summary | patch | test_result | evidence
    content_ref: str = Field(sa_column=Column(Text, nullable=False))
    # file path (e.g. .sillyspec/docs/arch.md) or inline structured summary
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class DaemonBorrowAudit(BaseModel, table=True):
    """审计表：业务/管理人员借用开发人员 daemon 的每一次调用（FR-07 / D-004@v1）。

    仅审计不限额（design §3 非目标 / D-004）。每次借用落一行；额度/限额明细
    后续变更补，当前 usage_summary 暂存 token/turn 数等基础字段（nullable）。

    FK 语义（design §8）：
      - borrower_user_id / lender_user_id / workspace_id / agent_run_id → CASCADE
        （随主体清理，不残留孤儿审计行）
      - daemon_instance_id → RESTRICT（审计红线：daemon 实例被引用时禁止删除，
        保留审计链完整，区别于其它 CASCADE 外键）
    """

    __tablename__ = "daemon_borrow_audit"
    __table_args__ = (
        Index("ix_daemon_borrow_audit_borrower", "borrower_user_id"),
        Index("ix_daemon_borrow_audit_lender", "lender_user_id"),
        Index("ix_daemon_borrow_audit_daemon", "daemon_instance_id"),
        Index("ix_daemon_borrow_audit_workspace", "workspace_id"),
        Index("ix_daemon_borrow_audit_run", "agent_run_id"),
        Index("ix_daemon_borrow_audit_borrowed_at", "borrowed_at"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    borrower_user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    lender_user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    daemon_instance_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_instances.id", ondelete="RESTRICT"),
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    agent_run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    borrowed_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    # D-004 仅审计：先记基础字段，后续额度明细变更再补 schema。
    usage_summary: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
