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
    UniqueConstraint,
    Uuid,
    literal,
    select,
    text,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import TypeDecorator
from sqlmodel import Field, col

from app.models.base import BaseModel

# 活跃 run 状态词表（2026-08-25 会话路径二审 #3）：单一定义、全 backend 共享。
#
# 语义：AgentRun 处于「会话活跃轮」——``pending``（已派发未 claim）/
# ``running`` / ``pending_approval``（coordinator 写入，等待用户审批，仍是
# 当前轮）。注意 **不含** ``interrupting``（仅前端展示态，backend 从不落库，
# 词表里的 "interrupting" 恒不命中）与 ``completed`` 等终态。
#
# 消费点统一 import 本常量（daemon/session/service.ACTIVE_TURN_STATUSES 为其
# 别名；daemon/router current_run 查询与 _session_has_active_turn、agent/
# finalizer、agent/patrol、agent/mcp_tools 均同源），勿再内联状态元组。本模块
# 是叶子（仅依赖 SQLAlchemy/Base），各消费方 import 方向安全无环。
ACTIVE_RUN_STATUSES = frozenset({"pending", "running", "pending_approval"})


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
    # ── Context ring numerator (2026-08-27-session-token-usage-fix task-04) ──
    # 该 run 期间最近一次 API 调用的提示词大小（= input_tokens + cache_read_tokens
    # + cache_creation_tokens 之和，daemon 计算后经既有 usage 附带管线透传，
    # D-002@v1）。NULL = 老数据 / 未上报 → 前端上下文环显示未知态（D-003）。
    # nullable 写法对齐 input_tokens 等既有 token 列；无索引（无该列查询诉求）。
    ctx_tokens: int | None = Field(
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


class AgentRunModelUsage(BaseModel, table=True):
    """Run × 模型维度的 token 用量明细行（2026-08-29-usage-by-provider-model task-01，design §1.1）。

    一次 run 内按模型拆分的四维 token 消耗 + 调用次数——run 终态时由 daemon
    上报的 modelUsage 明细落库（task-03/04 upsert，UNIQUE(run_id, model) 同 run
    同模型覆盖）；统计侧按 model GROUP BY 聚合出「按供应商/模型」用量（task-05）。
    run 删除级联清理明细行（FK CASCADE），不残留孤儿行。
    """

    __tablename__ = "agent_run_model_usage"
    __table_args__ = (
        # 同 run 同模型至多一行（终态 upsert 覆盖语义，design §1.1）；该约束
        # 同时充当前导列 run_id 的查询索引（uq_daemon_runtime_grants 先例）。
        # 模型与迁移建表两侧同语义（20260829010000）。
        UniqueConstraint("run_id", "model", name="uq_agent_run_model_usage_run_model"),
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
    # 模型名（daemon modelUsage key / ProviderConfig.model / "unknown"，design §1.1）。
    model: str = Field(sa_column=Column(String(128), nullable=False))
    # 该模型四维 token 消耗（列名/口径与 agent_runs 既有 token 列同义；新表
    # 无历史包袱，直接 NOT NULL default 0，不像 run 级列留 nullable 旧债）。
    input_tokens: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    output_tokens: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    cache_read_tokens: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    cache_creation_tokens: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    # 该模型调用次数（口径 design §2：interactive 各模型按消耗占比分摊估算、
    # batch 单模型精确；default 1——行存在即至少一次调用）。
    api_requests: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, default=1),
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
    # 2026-09-01-session-group-chat task-01（design §3.4 / §5.2）：投影行身份
    # JSON（DB 列名 ``metadata``——SQLAlchemy ``metadata`` 保留名，属性名用
    # ``metadata_``，daemon/model.py 同款先例）。群聊桥接投影行双写时落
    # ``{member_id, member_name, source_log_id}``，前端回放据此还原发言者；
    # 存量行 NULL（单聊日志不写本列，零回归）。
    metadata_: dict | None = Field(
        default=None,
        sa_column=Column("metadata", JSON, nullable=True),
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
        # 2026-08-25-team-subsession-governance task-01（design §5.A / D-001@v1）：
        # 会话树父指针索引——mission_worker_sessions 按根查直接子会话 /
        # resolve_mission_for_session 归属解析的查询键（迁移 20260825210000
        # 同步建；对齐 ix_agent_runs_mission_id 补声明惯例，防 autogenerate 漂移）。
        Index("ix_agent_sessions_parent", "parent_session_id"),
        # 2026-08-26-team-subsession-recursion task-01（design §5.A）：会话树深度
        # 索引——派发门 / 治理口径按深度过滤的查询键（迁移 20260826020000 同步建；
        # 对齐 ix_agent_runs_mission_id 补声明惯例，防 autogenerate 漂移）。
        Index("ix_agent_sessions_tree_depth", "tree_depth"),
        # 2026-09-01-session-group-chat task-01（design §3.1）：会话形态索引——
        # list_agent_sessions 的 session_kind 谓词过滤查询键（task-02 消费；
        # 迁移 20260902010000 同步建，防 autogenerate 漂移）。
        Index("ix_agent_sessions_session_kind", "session_kind"),
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
    # ql-20260831-002：会话级上下文窗口大小覆盖（token 数）。NULL = 未覆盖，走
    # 前端自动派生链（供应商 one_m → 模型常量表 → 1M 兜底）；非 NULL = 用户在
    # 会话页环浮层显式指定，优先级最高（本地模型/本机默认供应商派生不出分母的
    # 主场景）。纯展示配置，不参与 daemon 注入链。
    ctx_window_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    status: str = Field(
        default="pending",
        sa_column=Column(String(20), nullable=False, default="pending"),
    )  # pending, active, reconnecting, suspended, ended, failed
    # suspended（2026-08-29-daemon-platform-resilience task-05 / design A5 / D-001@v1）：
    # daemon 优雅停止（suspend-batch）或 offline sweep 收敛的挂起态——非终态、可
    # 经 recover → reconnecting 恢复（非白名单语义，D-007）；超 SUSPENDED_MAX_AGE_SEC
    # （sweep.py，默认 24h）由 offline sweep 顺带 GC 置 failed。**不入**终态集合
    # （session/service 的 ACTIVE_SESSION_STATUSES 语义为「可 inject/审批的活跃态」，
    # suspended 不可 inject、lease 已 cancelled，故也不加入该集合）。
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
    # ── 会话树两列（2026-08-25-team-subsession-governance task-01，design §5.A）──
    # 分身子会话挂载（D-001@v1 会话树）：指向父会话（团队场景父 = 主控会话）；
    # NULL = 非分身会话（存量 chat/会话形态零回归，不回填）。自引用 FK 无
    # ondelete——会话软删不硬删（同 agent_missions.session_id 先例）；脏数据
    # 成环由 resolve_mission_for_session visited 截断兜底。
    parent_session_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id"),
            nullable=True,
        ),
    )
    # 分身完成信号落点（D-002@v1 显式标记，否决 run 终态/会话 end 判据）：
    # 分身经受限 MCP worker_done 工具置位；可重复置位（追问重开工后再完成，
    # 取最新时间）；非分身会话恒 NULL。
    worker_done_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # 会话树深度（2026-08-26-team-subsession-recursion task-01，design §5.A）：
    # 主控/普通会话 0、分身 1、孙 2——派发门 O(1) 深度读的落库口径。写入规则：
    # 分身派发路径显式落 ``parent.tree_depth + 1``（task-02 消费）；daemon create
    # 路径不传落默认 0（主控/普通会话）——server_default '0' 让 raw INSERT 不传
    # 本列也落 0（placement.py stage 派发先例，对齐 origin 列 server_default 写法；
    # 迁移 20260826020000 同值）。迁移全表 CASE 回填（parent NULL→0 / 非空→1），
    # NOT NULL 保证无 NULL 读值——不写任何「NULL 按 1 计」运行时兜底规则（Grill B1）。
    tree_depth: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0, server_default=text("0")),
    )
    # ── 会话形态（2026-09-01-session-group-chat task-01，design §3.1）──
    # 'chat'（默认，存量单聊零回归）| 'group'（群时间线会话）| 'group_member'
    # （agent 成员影子会话——§5.1：影子 parent_session_id 刻意 NULL，群↔影子
    # 关联只经成员表 shadow_session_id 反向指针）。server_default 'chat' 对齐
    # origin 列写法，迁移 20260902010000 对存量行免回填即得 chat 语义
    # （约束：存量行为零变更）；列表过滤走 ix_agent_sessions_session_kind。
    session_kind: str = Field(
        default="chat",
        sa_column=Column(
            String(16),
            nullable=False,
            server_default=text("'chat'"),
        ),
    )


# ── 会话树辅助查询（2026-08-25-team-subsession-governance task-01，design §5.A）──
# 本模块保持叶子（顶层仅依赖 SQLAlchemy/Base）；需要 mission.py 的
# get_active_mission_for_session 时走函数内延迟 import（先例见 finalizer.py）。

# 会话树递归展开的深度截断上限（2026-08-26-team-subsession-recursion task-01，
# design §5.A，model.py 单源）：``mission_worker_sessions_tree`` 递归 CTE 对脏数据
# 深环（环 + UNION 去重仍会逐层加深）的硬护栏——深度 ≥ MAX_TREE_DEPTH 的子树不再
# 展开。刻意大于业务侧派发门 MAX_DISPATCH_DEPTH（=2，task-02 定义）：合法树最深
# 2（主控→分身→孙），4 是查询侧对脏数据的宽容余量，两者不同名不同值勿混用。
MAX_TREE_DEPTH = 4


async def mission_worker_sessions(db: AsyncSession, mission_id: uuid.UUID) -> list[AgentSession]:
    """枚举 mission 的分身子会话（design §5.A 单一真相源）。

    按 ``mission.session_id`` 取根会话（团队场景根 = 主控会话），返回
    ``parent_session_id = 根`` 的**直接子会话**行——热路径一层最快，刻意不递归；
    治理口径的全树枚举（含孙层）用 ``mission_worker_sessions_tree``
    （2026-08-26-team-subsession-recursion task-01，design §5.A）。mission 不存在 /
    external mission（session_id 为 NULL）/ 根下无子会话均返回空列表。
    按 created_at 升序稳定枚举。消费方：list_workers / 成本 union /
    converge·cancel 收口名单（task-09/13 等）。注意本查询不做
    status/deleted 过滤——过滤语义归调用方。
    """
    mission = (
        (await db.execute(select(AgentMission).where(col(AgentMission.id) == mission_id)))
        .scalars()
        .first()
    )
    if mission is None or mission.session_id is None:
        return []
    stmt = (
        select(AgentSession)
        .where(col(AgentSession.parent_session_id) == mission.session_id)
        .order_by(col(AgentSession.created_at))
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def mission_worker_sessions_tree(
    db: AsyncSession,
    mission_id: uuid.UUID,
    *,
    root_session_id: uuid.UUID | None = None,
) -> list[AgentSession]:
    """枚举 mission 的会话树全树分身（design §5.A / D-003@v2 方案A 双源之 DB 源）。

    以 ``mission.session_id`` 为根，沿 ``parent_session_id`` 递归 CTE 展开
    **全树**（分身 + 孙 + 更深后代），供治理口径消费（task-03/04/08：derive/
    control/finalizer/patrol 等含孙层的分身全集）。与 P1 的
    ``mission_worker_sessions``（一层枚举）并存——热路径子会话行化仍一层最快，
    勿混用口径。

    - **不含根（主控）会话行**：根是派发者非分身，枚举只含后代；
    - **防环**：递归 CTE 用 ``UNION``（非 UNION ALL）按 (id, depth) 元组去重，
      叠加 ``MAX_TREE_DEPTH``(=4) 深度截断兜底——脏数据 parent 成环时环上会话
      逐层加深重入，UNION 元组去重 + 深度截断保证不死循环，末端回表按 PK
      集合成员（IN 子查询）保证同一会话行不重复返回；parent 指向不存在的行
      → 不可达即不入树；
    - mission 不存在 / external mission（session_id 为 NULL）/ 根下无子树均
      返回空列表；
    - 按 created_at 升序稳定枚举；不做 status/deleted 过滤——过滤语义归调用方
      （P1 口径，``mission_worker_sessions`` 同）。

    2026-08-26 审计 F03/F08（docs/qa/subsession-backend-audit-2026-08-26.md）：

    - ``root_session_id`` 可选参——调用方已持有 mission 行时直接传
      ``mission.session_id`` 跳过内部 mission get（同一请求内多次树口径的
      查询复用锚）；缺省（None）保持旧行为：内部查 mission 行取根，
      external / mission 缺失返回 []。
    - 末端 join 从 ``JOIN tree ON id = sid`` 改 ``id IN (SELECT sid FROM tree
      WHERE sid != root)``——EXPLAIN 实证旧形态在 PG 走 Hash Join + Seq Scan
      on agent_sessions（树结果集小、sessions 表大时每次树调用退化 O(全表)
      哈希扫描）；IN 形态由 PK 索引驱动，代价 O(树大小)。语义等价：同一
      sid 集合（UNION 元组去重 → IN 成员天然去重，原 DISTINCT 随之不再需要）。
    """
    if root_session_id is None:
        mission = (
            (await db.execute(select(AgentMission).where(col(AgentMission.id) == mission_id)))
            .scalars()
            .first()
        )
        if mission is None or mission.session_id is None:
            return []
        root_id = mission.session_id
    else:
        root_id = root_session_id
    # WITH RECURSIVE：锚=根会话(depth 0)；递归项=parent 指向已入树行的子会话
    # (depth+1)，depth >= MAX_TREE_DEPTH 不再展开（脏数据深环截断）。UNION 去重
    # 防（同深度）重复元组；双方言可执行（SQLite 测试方言 + PG 生产）。
    tree = (
        select(
            col(AgentSession.id).label("sid"),
            literal(0, type_=Integer).label("depth"),
        )
        .where(col(AgentSession.id) == root_id)
        .cte(name="mission_session_tree", recursive=True)
    )
    tree = tree.union(
        select(
            col(AgentSession.id).label("sid"),
            (tree.c.depth + 1).label("depth"),
        ).where(
            col(AgentSession.parent_session_id) == tree.c.sid,
            tree.c.depth < MAX_TREE_DEPTH,
        )
    )
    # F08：PK 驱动回表——IN 子查询（半连接）形态在大表下让规划器走
    # Nested Loop + Index Scan using agent_sessions_pkey（本机 PG EXPLAIN 实证；
    # 小表时哈希半连接代价本就低，规划器按成本择优），不再固定 Hash Join +
    # Seq Scan O(全表)；IN 成员测试天然去重（替代原 DISTINCT，顺带免疫
    # ``config`` 等 json 列在 PG 下无相等算子导致 DISTINCT 报错的问题）。
    stmt = (
        select(AgentSession)
        .where(col(AgentSession.id).in_(select(tree.c.sid).where(tree.c.sid != root_id)))
        .order_by(col(AgentSession.created_at))
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def resolve_mission_for_session(
    db: AsyncSession, session_id: uuid.UUID, *, include_terminal: bool = False
) -> AgentMission | None:
    """会话 → mission 归属解析（design §5.A，沿 parent 链爬根）。

    分身子会话自身不落 ``AgentMission.session_id``——本函数沿
    ``parent_session_id`` 链逐级爬到根会话（parent 为 NULL 的会话），
    根按 ``get_active_mission_for_session`` 既有口径命中 mission
    （活跃 = converged_at / cancelled_at 均 NULL，命中多条取 created_at
    最新，无命中返回 None）。

    - 环检测：visited 集合逐级记录；parent 指向自身/后代（脏数据成环）或
      parent 指向不存在的会话行时**截断返回 None 不抛异常**；
    - ``include_terminal=False``（默认）：只匹配活跃 mission（既有口径，
      不动 get_active_mission_for_session 签名与语义）；``include_terminal=True``：
      含已终态 mission（取根上最新一条）——task-07 worker_done 迟到调用用
      于区分 404（无 mission）与 409（mission 已终态）；
    - 传入会话即根（parent NULL）时等价 get_active_mission_for_session 直查。
    """
    # 延迟 import 避免循环（model 是叶子，mission.py 顶层 import 本模块）
    from app.modules.agent.mission import get_active_mission_for_session

    current: uuid.UUID = session_id
    visited: set[uuid.UUID] = set()
    while True:
        if current in visited:
            return None  # 环：脏数据 parent 指向后代，截断不抛
        visited.add(current)
        session = (
            (await db.execute(select(AgentSession).where(col(AgentSession.id) == current)))
            .scalars()
            .first()
        )
        if session is None:
            return None  # parent 指向不存在的行（脏数据），截断不抛
        if session.parent_session_id is None:
            root_id = session.id
            break
        current = session.parent_session_id

    if not include_terminal:
        return await get_active_mission_for_session(db, root_id)
    stmt = (
        select(AgentMission)
        .where(col(AgentMission.session_id) == root_id)
        .order_by(col(AgentMission.created_at).desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


# ql-20260825-011：会话排队消息上限（单会话 pending 条目数）。前后端同值，
# 前端 use-message-queue / MessageQueueBar 的满员判定以本常量经 OpenAPI 类型
# 对齐（前端硬编码同值 5，见 frontend/src/hooks/use-message-queue.ts）。
SESSION_QUEUE_MAX_PENDING = 5


class AgentSessionQueuedMessage(BaseModel, table=True):
    """会话排队消息（ql-20260825-011，后端真实排队）。

    忙轮（会话已有活跃 run）时用户发送的追问不再被 409 拒绝，而是落本表
    排队；run 终态后由后台任务 ``dispatch_next_queued_message`` 依
    ``position, created_at`` 顺序自动派发（2026-08-31-session-queue-ux
    D-002：拖拽排序可持久化重排派发序）。排队是**会话级**的（单会话至多
    一个活跃 run 的不变式不变，排队只是把「等上一轮结束」从浏览器内存
    挪到服务端——刷新页面不丢）。

    - ``status``：pending（待派发）/ failed（派发失败，留在队列供用户重试或
      删除）；派发成功即删行（turn 已落 AgentRun，队列不重复存史）。
    - ``sender_user_id``：入队用户（派发时作为 run_sender_user_id 与归属
      校验身份；多成员工作台同会话不同人排队各自记账）。
    - ``attachment_ids`` / ``page_context`` / ``agent_profile_id`` /
      ``llm_provider_id``：发送时的完整参数快照，派发时原样重放（页面上下文
      取**发送时刻**的快照，语义与即时发送一致）。
    """

    __tablename__ = "agent_session_queued_messages"
    __table_args__ = (
        Index(
            "ix_agent_session_queued_messages_session_status",
            "agent_session_id",
            "status",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    agent_session_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    sender_user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    prompt: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    # 附件引用快照（SessionAttachment id 的字符串列表；派发时转回 uuid 走
    # _inject_into_session 的锁内附件校验兜底——附件可能已被删除，校验失败
    # 该条目转 failed，不影响后续条目）。
    attachment_ids: list | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 页面上下文快照（PageContextCreateBlock 的 dict 形态）。
    page_context: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 切档案/切供应商快照（str 形态的 uuid；None = 发送时未携带）。
    agent_profile_id: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    llm_provider_id: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    status: str = Field(
        default="pending",
        sa_column=Column(String(16), nullable=False, default="pending"),
    )  # pending / failed
    # 2026-08-31-session-queue-ux D-002（ql-20260831 change / design §6）：派发
    # 序键——**仅排序用，审计时间线仍是 created_at**。入队在会话行锁内取
    # MAX(position)+1（空队列首条=0）；行锁已保证串行，故不加唯一约束。
    # 迁移 20260831130000 已加列并按 created_at 序回填。
    position: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    error_msg: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


# ── 群聊（2026-09-01-session-group-chat task-01，design §3.2/§3.3）──
# 群会话桥接架构（design §2）：agent_group_chats 行 = 群聚合根（session_id
# UNIQUE 指向群时间线 AgentSession(kind='group')）；agent_group_members 行 =
# 成员（用户成员 + agent 成员六要素）；群↔影子会话关联只经成员表
# shadow_session_id 反向指针（§5.1 硬约束：影子会话不挂 parent_session_id）。


class AgentGroupChat(BaseModel, table=True):
    """群聊聚合根（design §3.2）——一行一个群，1:1 挂群时间线会话。

    群会话（kind='group'）承载统一消息时间线（复用现有 SSE/日志/软删管线）；
    本表只存群维度元数据与护栏参数（互@开关/深度/背景摘要窗口）。成员
    见 ``AgentGroupMember``。
    """

    __tablename__ = "agent_group_chats"
    __table_args__ = (
        # 群时间线会话 1:1（design §3.2：session_id UNIQUE FK agent_sessions）。
        UniqueConstraint("session_id", name="uq_agent_group_chats_session"),
        # 权限锚工作区维度的群列表兜底查询（§5.3 workspace admin 分支）。
        Index("ix_agent_group_chats_workspace", "workspace_id"),
        # 群挂 PPM 项目（quick 群 PPM 项目化：建群必填；存量行 NULL=存量群）。
        Index("ix_agent_group_chats_project", "project_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 群时间线会话（AgentSession.session_kind='group'）。会话硬删随删群
    # （CASCADE）；既有会话管理是软删（deleted_at），不触发本 FK。
    session_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # 权限锚：群挂在一个工作空间下（成员校验的 workspace admin 兜底分支，§5.3）。
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # 群挂的 PPM 项目（quick 群 PPM 项目化：建群必填，工作区由项目关联集推导；
    # 项目删则 SET NULL——存量群 project_id 为 NULL 时邀请范围回退 workspace 口径）。
    project_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("ppm_project_maintenance.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    title: str = Field(sa_column=Column(String(120), nullable=False))
    # 群主（影子会话 user_id 同源，计量归属 design §9.2）。
    created_by: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # agent 互@协作开关（design §4.4，默认开；关闭=严格 openclaw 模式，
    # agent 回复中的 @ 为纯文本）。
    agent_cross_mention: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    # 协作链深度上限（§4.4 防环护栏 1，默认 2；达深度不再触发只作纯文本）。
    cross_mention_depth: int = Field(
        default=4,
        sa_column=Column(Integer, nullable=False, default=4),
    )
    # 群背景摘要条数（§4.2，默认 20——触发成员时查群时间线最近 N 条）。
    context_window: int = Field(
        default=20,
        sa_column=Column(Integer, nullable=False, default=20),
    )
    # 预留护栏参数等（§3.2 settings_json；首期空置）。
    settings_json: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    # 解散群（group.ended）置位；软删（deleted_at）与之正交（对齐
    # AgentSession.ended_at/deleted_at 语义）。
    ended_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class AgentGroupMember(BaseModel, table=True):
    """群成员行（design §3.3）——用户成员与 agent 成员共用一张表。

    - 用户成员：``member_type='user'`` + ``user_id``（NOT NULL 由 service 层
      校验——DB 无法做条件 NOT NULL；防重复邀请由部分唯一索引兜底）；
    - agent 成员：``member_type='agent'`` + 六要素（机器 runtime / 工作区
      workspace / 引擎 provider / 模型 llm_provider / 智能体方案
      agent_profile / 群内昵称 display_name——即 @提及词，群内全局唯一）；
    - ``shadow_session_id``：该成员影子会话的反向指针（懒创建后回填，
      design §3.3/§5.1）；``shadow_status`` 供成员面板绿点展示。
    """

    __tablename__ = "agent_group_members"
    __table_args__ = (
        # 群内昵称全局唯一（design §3.3：UNIQUE(group_id, display_name)，用户
        # 与 agent 共用同一命名空间——@路由无歧义，用户与 agent 不可同名）。
        # 前导列 group_id 兼充按群取成员的查询索引。
        UniqueConstraint(
            "group_id",
            "display_name",
            name="uq_agent_group_members_group_display_name",
        ),
        # user 成员防重复邀请（design §3.3：UNIQUE(group_id, user_id)）——
        # agent 成员 user_id NULL 不参与唯一约束（部分唯一索引，
        # uq_agent_missions_session_active 先例：postgresql_where 供 PG、
        # sqlite_where 供测试侧 create_all，双方言同语义）。
        Index(
            "uq_agent_group_members_group_user",
            "group_id",
            "user_id",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
            sqlite_where=text("user_id IS NOT NULL"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 群删除级联清成员（design §3.3：FK agent_group_chats CASCADE）。
    group_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_group_chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    member_type: str = Field(sa_column=Column(String(8), nullable=False))
    # 'user' | 'agent'
    # 群内昵称 = @提及词（群内唯一，见 __table_args__ 约束；六要素之一）。
    display_name: str = Field(sa_column=Column(String(40), nullable=False))
    # 群内头像（quick 成员头像：文件中心上传端点产出的 URL；用户与 agent 成员
    # 共用同一列，NULL=未自定义（前端回退默认昵称首字头像））。
    avatar: str | None = Field(
        default=None,
        sa_column=Column(String(512), nullable=True),
    )
    # 用户成员归属（member_type='user' 时由 service 层保证非 NULL；用户删
    # 则成员行随删）。
    user_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # ── agent 成员六要素（member_type='agent'；用户成员全 NULL）──
    # ① 机器（pinned，§4.3 懒建走 grants 授权分支；对齐 AgentSession.runtime_id）。
    runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    # ② 工作区（cwd 锚，可与群工作区不同——"一项目多工作区"分工；
    # 对齐 AgentSession.workspace_id SET NULL 语义）。
    workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # ③ 引擎类型（claude/codex 等）。
    provider: str | None = Field(
        default=None,
        sa_column=Column(String(20), nullable=True),
    )
    # ④ 模型（llm_providers；删则 SET NULL，成员配置保留，对齐
    # AgentRun.llm_provider_id 先例）。
    llm_provider_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("llm_providers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # ⑤ 智能体方案（人格/技能/工具集，AgentProfile；删则 SET NULL）。
    agent_profile_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # 团队能力开关（quick 群成员团队能力）：开启后影子会话懒建 lease stage
    # 用 'orchestrator'——daemon isMainAgentSession 谓词（cli.ts）命中即注入
    # dispatch_worker 等 5 主控工具（仅 provider=claude 有效，建群/改配置时
    # service 层校验 400）；stage 是 lease 建时定的，热切换该开关走机器组
    # 重建分支（end 影子 + pending 重懒建）。用户成员行恒 false 不消费。
    team_enabled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    # ⑥ 群内昵称 = 上方 display_name（六要素归并到同一列，不重复存）。
    # 冗余快照（machine_name/agent_name/profile_name 等，供成员列表 chips
    # 免 N+1，对齐 AgentSession.config_snapshot 先例）。
    config_snapshot: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 影子会话反向指针（§3.3/§5.1：懒创建后回填；影子会话不挂
    # parent_session_id，本列是群↔影子唯一关联通道；无 ondelete——会话软删
    # 不硬删，同 agent_missions.session_id 先例）。
    shadow_session_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id"),
            nullable=True,
        ),
    )
    # none/pending/active/failed（成员面板绿点，§7）。
    shadow_status: str = Field(
        default="none",
        sa_column=Column(String(16), nullable=False, default="none"),
    )
    # 邀请人（nullable：群主建群初始成员可不记；用户删则 SET NULL）。
    invited_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    joined_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    # removed_at 非空=已移除（成员生命周期软标记，design §3.3）。
    removed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class ConstraintsJSON(TypeDecorator):
    """mission.constraints 列的类型装饰器（ql-20260831-008-6876）。

    constraints 语义上恒为 dict-or-NULL（创建路径只写 dict / None），非 dict
    即损坏残留——根因是 patrol 合并 SQL 的 COALESCE 挡不住 JSON 类型的 null，
    PG 下 ``json-null || 对象`` 产出数组并逐轮追加（生产两条滚到 760KB，
    读取端 ``.get`` 连环 AttributeError / converge 500；合并 SQL 已同 ql 加
    object 守卫修复 + 合并自愈）。本装饰器是**读取端兜底**：

    - ``process_result_value``：非 dict（数组 / 字符串等）归一为 ``{}``；
      ``None``（SQL NULL 与 json null 反序列化后同为 None）保持 ``None``——
      ``mission.constraints is not None`` 守卫（mission.py 虚拟映射）语义不变，
      ``(...) or {}`` 读取模式对 None 本就安全；
    - ``process_bind_param``：非 dict 非 None 落 ``{}``（防御——修复后代码
      不再写非 dict，此处兜住其它潜在写者）。

    impl 仍为 JSON：DDL 零变化（迁移不动），只影响 Python 侧出入参。中心化
    覆盖 finalizer / orchestrator / patrol / mcp_tools 全部
    ``(mission.constraints or {})`` 读取点，无需逐点改。
    """

    impl = JSON
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None or isinstance(value, dict):
            return value
        return {}

    def process_result_value(self, value, dialect):
        if value is None or isinstance(value, dict):
            return value
        return {}


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
    # ConstraintsJSON（ql-20260831-008）：读取端非 dict 归一 {}（损坏兜底），
    # DDL 仍为 JSON 零迁移。# { max_workers, read_only_scope, ... }
    constraints: dict | None = Field(
        default=None,
        sa_column=Column(ConstraintsJSON, nullable=True),
    )
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
    # Change 2026-08-28-daemon-agent-share task-01 / D-006@v1：关联 daemon_runtime_grants
    # 行（task-03/task-06 起借用路径写入）。nullable：旧行无此值；无 FK 硬约束——
    # grant 物理删除后审计行仍可读（区别于上方 CASCADE/RESTRICT 实体外键）。
    grant_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
