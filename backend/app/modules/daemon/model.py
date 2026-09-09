"""DaemonRuntime and DaemonTaskLease SQLModel tables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
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


class DaemonInstance(BaseModel, table=True):
    """A physical daemon process with a stable identity (design §4.1 / D-001).

    身份由 daemon 上报的本地 uuid 承载（``id`` = daemon 侧 ``daemon_local_id``，
    后端不自生成）。一行 = 一个用户在一台机器上、连某一个后端的守护进程。
    多 provider 由子表 :class:`DaemonRuntime` 承载，本表只管机器级字段。
    """

    __tablename__ = "daemon_instances"
    __table_args__ = (
        Index("ix_daemon_instances_user_server", "user_id", "server_url", "hostname"),
    )

    # daemon 上报的 daemon_local_id 作主键，后端不自生成（无 default_factory）。
    id: uuid.UUID = Field(
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    hostname: str = Field(sa_column=Column(String(255), nullable=False))
    # admin 自定义机器别名（从旧 runtime.display_alias 提升到此，design §4.1）。
    display_alias: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    server_url: str = Field(sa_column=Column(String(255), nullable=False))
    os: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    arch: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    version: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    # daemon 构建标识（git short SHA，release 注入；dev="dev"）。
    # 2026-07-04-daemon-version-management D-003：用于精确版本比对与升级判断
    # （区别于 version 的语义版本；self-update preflight 按 build_id 比对）。
    build_id: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    # 机器级沙箱（从旧 runtime.allowed_roots 提升到此，design §4.1 / §4.2）。
    allowed_roots: list[str] = Field(
        default_factory=lambda: ["~/.sillyhub"],
        sa_column=Column(JSON, nullable=False, server_default=text("'[\"~/.sillyhub\"]'")),
    )
    capabilities: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 心跳上报的待升级状态（2026-08-29-daemon-selfupdate-safety FR-04 / D-004@v1）：
    # daemon 忙、推迟自升级期间心跳携带 {reason, current_version, target_version}
    # （backend 落库时补 since，语义同 daemon 侧 pending-update.json）；
    # NULL=无待升级。写入/清除（心跳无该字段即置 NULL）在 task-06 心跳端点。
    pending_update: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 本机 sillyspec 工具版本（2026-08-31-machine-sillyspec-version FR-05 / D-002@v1）：
    # register 无条件直写（含 None=未安装/未知，本机卸载后重启收敛为 NULL）；心跳仅
    # 非 None 覆盖（兄弟字段语义：缺省/null=保留——pydantic 下二者不可区分）。
    # NULL=未安装或未知，机器卡显示「sillyspec 未安装」徽标。
    sillyspec_version: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    # daemon 探测到的 npm 最新 sillyspec 版本（FR-05）；NULL=未知。
    # 落库语义同 sillyspec_version（D-002@v1 双通道）。
    sillyspec_latest_version: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    # 心跳上报的 sillyspec 升级状态机快照（FR-05 / design §接口定义）：
    # {state, trigger, from_version, to_version, error}（backend 落库时补 since、
    # error 截断 200）；NULL=无进行中/近期升级。语义同 pending_update——心跳无该键
    # 即置 NULL 清除，同内容重放保留原 since；register 直写 None（daemon 侧状态机
    # 在内存，进程重启即失，重启后 register 清除遗留快照）。
    sillyspec_update: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 心跳上报的 sillyspec 全局进度总览快照（2026-09-02-changes-overview-card
    # FR-05 / Grill B1）：daemon 周期采集 ``progress show --json`` envelope 的摘要
    # 投影（ok/errors_count/warnings_count/generated_at/active_changes/
    # healthy_count/ghost_count/conflict_count/conflict_types/changes[]/
    # pending_conflicts[]，design §4）。语义同 sillyspec_update（权威注释见上）——
    # 心跳载荷该键为 null 即置 NULL（None=清除；daemon 侧 CLI 能力缺失上报 null，
    # 采集瞬态失败则保留上次快照上报、不清除）；NULL=总览不可用（sillyspec 未安装
    # 或版本过低）。32KB 载荷预算与 changes N=50 截断在 daemon 侧执行，backend
    # JSON 原样落库（写入/清除逻辑在心跳 handler）。
    sillyspec_status: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 心跳上报的 sillyspec 总览采集失败状态（2026-09-08，temp 投毒排障衍生）：
    # daemon 周期采集 ``progress show --json`` 的三态③（超时/非零退出/spawn 失败）持续发生时的
    # 错误快照 {reason, detail, since}——since=daemon 侧首次失败时刻（恢复成功
    # 即清，内存态）。语义同 sillyspec_status——心跳该键为 null 即置 NULL（采集
    # 正常/能力缺失②均清），非 None 整包直写（detail 落库前截 200）；register
    # 恒清（daemon 内存态，进程重启即失）。用途：区分「数据源查询失败」与
    # 「sillyspec 未安装/版本过低」——NULL 且 sillyspec_status 亦 NULL 才是后者
    # （三态②），本列非 NULL 说明总览缺失源于查询失败（三态③，2026-09-08
    # temp 投毒实证：残留声明令 exit 1 持续，旧 UI 误显「未安装/版本过低」）。
    sillyspec_status_error: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 心跳上报的工作区级总览 map（2026-09-08 总览工作区级化）：daemon 按
    # wsId→主仓根映射逐目标采集 ``progress show --json``（仅成功项），心跳
    # ``sillyspec_status_map`` 整包直写（{wsId: 摘要}）。键不出现=daemon 未启用
    # 工作区级采集（保留旧值，旧 daemon 兼容）；register 恒清。用途：工作台总览
    # 卡片按当前工作区取数，修「多工作区串台」（机器级 sillyspec_status 单槽位
    # 是最近一次采集，所有工作台页面共享同一份数据）。
    sillyspec_status_map: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 心跳上报的 sillyspec 命令执行结果槽（2026-09-04-conflict-resolve-entry
    # FR-05 / D-004@v1）：daemon 侧 resolve / ghost_cleanup 执行器的最新结果
    # （{action, change, strategy, state, exit_code, error, executed_at}，
    # latest-wins 只留最新一条，R-07）。语义同 sillyspec_update（权威注释见上）——
    # 心跳载荷该键为对象即整包直写，键不出现即置 NULL 清除（daemon 终态窗口
    # 过期后停发该键，不发显式 null，X-04 两态）；register 恒清（结果槽在
    # 内存，进程重启即失）。NULL=无近期命令结果。
    sillyspec_command_result: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    status: str = Field(
        default="online",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("'online'"),
        ),
    )
    last_heartbeat_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # daemon 进程启动时间（FR-02 / D-002@v1）：daemon 上报自身进程启动时刻，
    # 用于精确计算 uptime 与诊断长时间运行漂移。旧 daemon 不上报则为 NULL。
    started_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class DaemonRuntime(BaseModel, table=True):
    """A registered local daemon runtime (e.g. Claude Code CLI instance).

    Change 2026-07-03-daemon-entity-binding (design §4.2 / D-002): 退化为
    :class:`DaemonInstance` 的从属清单——一行 = 某个 daemon 实体下的一种
    provider。机器级字段（os/arch/allowed_roots/capabilities/display_alias）
    已上提到 daemon_instances，本表只保留 provider 维度信息。
    """

    __tablename__ = "daemon_runtimes"
    __table_args__ = (
        Index("idx_daemon_runtimes_user_id", "user_id"),
        Index("idx_daemon_runtimes_status", "status"),
        Index("idx_daemon_runtimes_instance", "daemon_instance_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 所属守护进程实体（design §4.2 / D-002）。迁移期 nullable=True 过渡
    # （D-007 重置：旧 runtime 行无对应 daemon_instance，task-13 清空后再 NOT NULL）。
    daemon_instance_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_instances.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    provider: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    version: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    # per-runtime 沙箱（2026-07-06-allowed-roots-per-runtime：从 instance 下沉回 runtime，
    # CC/Hermes 互不影响；新 runtime 注册 copy instance.default，之后独立演化）。
    allowed_roots: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=True),
    )
    status: str | None = Field(
        default="online",
        sa_column=Column(String(20), nullable=True),
    )
    last_heartbeat_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    metadata_: dict | None = Field(
        default=None,
        sa_column=Column("metadata", JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class SessionDialogRequest(BaseModel, table=True):
    """Persisted AskUserQuestion-style dialog request (dialog extension).

    Ordinary canUseTool approvals stay ephemeral (in-memory ``_permission_timers``
    + 5min timeout). AskUserQuestion-style requests, in contrast, may wait
    indefinitely for a human answer and must survive frontend refresh — hence
    this table. One row per ``request_id``; lifecycle::

        pending   → row written by handle_permission_request (dialog_kind set)
        answered  → respond_permission recorded the user's ``answer``
        cancelled → session ended / run aborted before the user replied

    ``dialog_payload`` mirrors ``PermissionRequestPayload.dialog_payload``
    (the full question+options blob, JSON); ``answer`` mirrors
    ``PermissionResponsePayload.dialog_result``.
    """

    __tablename__ = "session_dialog_requests"
    __table_args__ = (
        Index("idx_session_dialog_requests_session_id", "session_id"),
        Index("idx_session_dialog_requests_run_id", "run_id"),
        Index("idx_session_dialog_requests_status", "status"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    session_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    run_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # Daemon-generated; unique per session so a replay/bug can't fork a dialog.
    request_id: str = Field(
        sa_column=Column(String(128), nullable=False, unique=True),
    )
    tool_name: str = Field(
        sa_column=Column(String(128), nullable=False),
    )
    dialog_kind: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    dialog_payload: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    status: str = Field(
        default="pending",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("pending"),
        ),
    )
    answer: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    answered_by: uuid.UUID | None = Field(
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
    answered_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class DaemonTaskLease(BaseModel, table=True):
    """A task lease claimed by a daemon runtime for execution."""

    __tablename__ = "daemon_task_leases"
    __table_args__ = (
        Index("idx_daemon_task_leases_runtime_id", "runtime_id"),
        Index("idx_daemon_task_leases_status", "status"),
        Index("idx_daemon_task_leases_agent_run_id", "agent_run_id"),
        Index(
            "idx_daemon_task_leases_expires_at",
            "lease_expires_at",
            postgresql_where=text("status IN ('claimed', 'pending')"),
        ),
        # Wave B（性能）：daemon 高频轮询 get_pending_leases 按 runtime_id+status 过滤并
        # ORDER BY created_at，复合索引覆盖避免每轮 polling 回表+排序。
        Index(
            "idx_daemon_task_leases_runtime_status_created",
            "runtime_id",
            "status",
            "created_at",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    agent_run_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    kind: str = Field(
        default="batch",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("batch"),
        ),
    )
    # batch: existing batch path via TaskRunner (FR-09, zero change)
    # interactive: long-lived SDK driver session (D-002@v3)
    # String(20) covers all values incl. reconnecting (task-10 / design §8.1);
    # no schema migration needed — status is a free-form string column.
    # Values: pending, claimed, completed, expired, cancelled (lease lifecycle).
    status: str | None = Field(
        default="pending",
        sa_column=Column(String(20), nullable=True),
    )
    claimed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    lease_expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # Phase 4 轻量终态确认观测点（design §5 Phase4 / D-007 / R-05）：
    # cancel_lease 发出取消信号后写入，daemon 回传终态后清空；为 sweeper 提供
    # "已标 cancelled、等 daemon 回传确认" 的间隙观测窗口。**仅观测时间戳**，
    # 不改 status 状态机取值集合（方案 C 无中间态）；写入/清理/sweeper 逻辑在
    # task-11。默认 None，现有 lease 不受影响（§9 兼容策略）。
    terminating_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    attempt_number: int | None = Field(
        default=1,
        sa_column=Column(Integer, nullable=True, server_default=text("1")),
    )
    metadata_: dict | None = Field(
        default=None,
        sa_column=Column("metadata", JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class DaemonChangeWrite(BaseModel, table=True):
    """A change-write task queued for a daemon runtime to execute (D-004@v1).

    daemon-client workspace 的 change 代写任务队列：daemon 经 lease-polling 轮询
    (GET /runtimes/{rid}/pending-change-writes → claim → 本地写 changes/<key>/ →
    complete 回执)，**不启动 agent**（与 DaemonTaskLease 的 agent-run 语义区分，
    故独立新表而非复用 lease.kind）。
    """

    __tablename__ = "daemon_change_writes"
    __table_args__ = (
        # 复合索引：daemon 轮询热路径 WHERE runtime_id=? AND status='pending' (FR-08)
        Index("idx_daemon_change_writes_runtime_status", "runtime_id", "status"),
        Index("idx_daemon_change_writes_workspace_id", "workspace_id"),
        Index("idx_daemon_change_writes_status", "status"),
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
    runtime_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    change_key: str = Field(
        sa_column=Column(String(128), nullable=False),
    )
    # 任务类型：create=proxy_create_change 创建新变更（MASTER/proposal/request），
    # edit=变更详情文件树手动编辑现有文件（2026-07-02-change-detail-file-tree-editor）。
    # daemon 侧 runChangeWrite 不区分（通用写 files），kind 仅 backend 用于 pending
    # 列表过滤（避免 edit 查询误纳 create 行）。
    kind: str = Field(
        default="create",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("'create'"),
        ),
    )
    # [{path, content}, ...]，path 相对 changes/<key>/（与 changes.key 对齐）
    files: list = Field(
        sa_column=Column(JSON, nullable=False),
    )
    # pending / claimed / done / failed — free-form string column（与 lease.status
    # 同风格，免后续加值迁移）
    status: str = Field(
        default="pending",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("pending"),
        ),
    )
    claim_token: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    # claim 落点时间，供 NFR-03 超时 gc（claimed_at < now-60s → failed）。
    # task-08 建表时遗漏，task-09 端点依赖此列（claim 置值 + gc 读取）。
    claimed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    error: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    # FR-05/FR-06（ql-20260813-spec-sync-visibility）：同步进度计数列。nullable 兼容
    # 旧行（D-002）。D-004 单一写者——只由 PATCH /api/daemon/change-writes/{id}/progress
    # 端点写，complete_change_write 不碰计数列。files_total=文件总数，files_processed=已处理数。
    files_total: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    files_processed: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )


class DaemonControlCommand(BaseModel, table=True):
    """A control command queued for reliable delivery to a daemon runtime.

    2026-08-29-daemon-platform-resilience A2 / D-004@v1：控制指令（inject /
    interrupt / end / resume / 审批结果 / provider 切换）先落库 pending，再经
    ws_hub 推送，推送成功标 delivered；daemon 断线期间不丢——重连后补拉仅取
    pending（**delivered 一律不重发**，D-006 零重复执行优先），消费成功 ack。
    服务层 :class:`~app.modules.daemon.control_commands.ControlCommandService`。
    """

    __tablename__ = "daemon_control_commands"
    __table_args__ = (
        # 复合索引：daemon 补拉热路径 WHERE runtime_id=? AND status='pending'
        # ORDER BY created_at（照 idx_daemon_task_leases_runtime_status_created 先例）。
        Index(
            "idx_daemon_control_commands_runtime_status_created",
            "runtime_id",
            "status",
            "created_at",
        ),
        Index("idx_daemon_control_commands_status", "status"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    runtime_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # 指令类型（design A2 词表）：session_inject / session_interrupt /
    # session_end / session_resume / permission_response / provider_config_changed。
    # 亦决定 enqueue 缺省 expires_at（inject 10min、permission_response 6min、
    # 其余 30min，常量落 control_commands.py）。
    kind: str = Field(
        sa_column=Column(String(32), nullable=False),
    )
    # 与现有 WS 消息 payload 同构，下发时注入 command_id（=本表 id）作幂等键。
    payload: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    # 投递状态机（design A2，free-form string column 免后续加值迁移）：
    # pending（落库待发/待补拉）→ delivered（WS 推送成功，不重发）
    # → acked（daemon 消费回执）；expired（pending 过期 / delivered 未 ack 超时，
    # 由 GC 收敛）。acked 保留 1h 后由 GC 删除。
    status: str = Field(
        default="pending",
        sa_column=Column(
            String(20),
            nullable=False,
            server_default=text("'pending'"),
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
    delivered_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    ack_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class AgentSessionTask(BaseModel, table=True):
    """Persisted agent task status within a session (task execution panel).

    2026-09-04-session-task-execution-panel task-01（FR-05 / D-006@v1）：
    agent 任务粒度状态（SSE ``agent_task_status`` 事件契约，schema.py
    :class:`AgentTaskStatusEvent`）的服务端持久化——此前只存在前端组件
    内存态，刷新/切会话即丢。一行 = 会话内一个 ``task_id``（(session_id,
    task_id) 唯一约束即 upsert 定位键）。

    数据流：producer=上报端点 ``notify_agent_task_status`` 调 upsert 服务
    （task-03 ``agent_task_store.py``：无则插入 started_at=now，有则刷新，
    终态定格不再回退）；consumer=``GET /sessions/{id}/tasks`` 快照端点
    （task-02，updated_at desc 最近 200 条）+ 前端 SSE 实时合并。

    刻意**不做逐事件流水表**——upsert 单行承载任务全生命周期即可支撑
    清单展示与刷新恢复，控写放大（design §数据模型 / R-03）；``run_id``
    随事件入库（事件必填字段）但**不建对 agent_runs 的硬外键**（避免与
    agent_runs 删除链耦合），仅建索引支撑后续按 run 分组增强。
    """

    __tablename__ = "agent_session_task"
    __table_args__ = (
        # upsert 定位键：同会话同 task 一行。模型与迁移建表两侧同语义
        # （grants/model.py 先例注释口径，20260905004300）。
        UniqueConstraint(
            "session_id",
            "task_id",
            name="uq_agent_session_task_session_task",
        ),
        Index("idx_agent_session_task_session_id", "session_id"),
        Index("idx_agent_session_task_run_id", "run_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    session_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # 事件必填字段（schema.py AgentTaskStatusEvent.run_id），随事件入库；
    # 无 FK 硬约束（design §数据模型——避免与 agent_runs 删除链耦合）。
    run_id: uuid.UUID = Field(
        sa_column=Column(Uuid(as_uuid=True), nullable=False),
    )
    task_id: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    task_name: str = Field(
        sa_column=Column(String(512), nullable=False),
    )
    # running / completed / failed / stopped（free-form string column，
    # 与 lease.status 同风格免后续加值迁移）；终态定格语义在 upsert 服务。
    status: str = Field(
        default="running",
        sa_column=Column(String(20), nullable=False),
    )
    # 事件契约字段（int，schema.py progress）；当前后端无总量基准恒 NULL，
    # 列保留对齐契约防漂移（design 字段取舍说明 / D-006@v1）。
    progress: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # 「正在做什么」摘要（task_progress.summary），逐次覆盖。
    summary: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    # 终态消息（task_notification 失败/完成文案，前端归约消费）。
    message: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    last_tool_name: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    # 与前端 tool 段 id 关联（卡片定位 / 跨轮归位关联键）。
    tool_use_id: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    elapsed_ms: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    total_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    tool_uses: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # 事件契约 ``async``（Python 关键字，DB/ORM 侧更名 is_async）。
    is_async: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False),
    )
    # 首次 upsert 插入时置 now（task-03）。
    started_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # 终态时置 now（task-03）。
    finished_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
